// Holders of an ERC-721 at one block, as a drop allowlist (api/_lib/allowlist.ts). Read-only: it sends nothing.
//
//   node scripts/allowlist-snapshot.mts --contract 0x… --name "Milady holders" [--block finalized|latest|<n>]
//        [--ids 0-9999] [--publish] [--out scripts/out]
//
// Reads ownerOf(id) for every id at the pinned block (multicall3, allowFailure: a burned or unminted id has no owner),
// de-duplicates the owners and builds the Merkle tree exactly as the drop checks it. --ids defaults to 0..totalSupply()
// inclusive (covers collections that start at 0 or at 1); if fewer tokens answer than totalSupply() says exist, the
// range missed some and the script stops rather than ship a short list (pass --ids to cover them).
//
// Writes to --out (default scripts/out, not committed):
//   <slug>-<block>.json         source, root, holders with their token ids, contract holders
//   <slug>-<block>.txt          one address per line
//   <slug>-<block>.proofs.json  { address: proof[] } for every holder
// --publish also writes public/allowlists/<root>.json (served by the Worker's proof route, and loadable by
// @openzeppelin/merkle-tree as is) and puts the list in src/miyamints/snapshots.ts for the Launch window, replacing
// that collection's earlier entry there (earlier files stay in public/allowlists/ so a drop using them keeps working).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { Address, Hex, PublicClient } from 'viem'
import { getAddress, parseAbi } from 'viem'

import type { AllowlistDump, AllowlistFile, AllowlistSource } from '../api/_lib/allowlist.ts'
import { buildTree, proofAt, verifyProof } from '../api/_lib/allowlist.ts'
import { APP, args, client, pinBlock, rpcHost, rpcUrl, short } from './lib/chain.mts'

const erc721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
])
const MULTICALL_BATCH = 500

export type Holders = Map<string, bigint[]>

/** Owner of every id in [from, to] at `block`: holder (lowercase) → ids. Ids without an owner are skipped. */
export async function readHolders(c: PublicClient, contract: Address, from: bigint, to: bigint, block: bigint) {
  const holders: Holders = new Map()
  const owners = new Map<bigint, string>()
  let failed = 0
  for (let start = from; start <= to; start += BigInt(MULTICALL_BATCH)) {
    const ids: bigint[] = []
    for (let id = start; id <= to && id < start + BigInt(MULTICALL_BATCH); id += 1n) ids.push(id)
    const res = await c.multicall({
      contracts: ids.map((id) => ({ address: contract, abi: erc721, functionName: 'ownerOf' as const, args: [id] })),
      allowFailure: true,
      blockNumber: block,
      batchSize: 0,
    })
    res.forEach((r, i) => {
      const id = ids[i] as bigint
      if (r.status !== 'success') {
        failed += 1
        return
      }
      const owner = (r.result as string).toLowerCase()
      if (/^0x0{40}$/.test(owner)) return
      owners.set(id, owner)
      const list = holders.get(owner) ?? []
      list.push(id)
      holders.set(owner, list)
    })
    process.stderr.write(`  ownerOf ${start}..${ids[ids.length - 1]}: ${owners.size} tokens so far\r`)
  }
  process.stderr.write('\n')
  return { holders, owners, failed }
}

/** Holders with contract code at `block`. An EIP-7702 delegation (0xef0100…) is a wallet, not a contract. */
export async function contractHolders(c: PublicClient, addresses: string[], block: bigint): Promise<string[]> {
  const out: string[] = []
  const BATCH = 10
  const code = async (a: string) => {
    for (let tries = 0; ; tries += 1) {
      try {
        return await c.getCode({ address: a as Address, blockNumber: block })
      } catch (e) {
        if (tries >= 5) throw e
        await new Promise((r) => setTimeout(r, 500 * 2 ** tries))
      }
    }
  }
  for (let i = 0; i < addresses.length; i += BATCH) {
    const slice = addresses.slice(i, i + BATCH)
    const codes = await Promise.all(slice.map(code))
    codes.forEach((hex, j) => {
      if (hex && hex !== '0x' && !hex.toLowerCase().startsWith('0xef0100')) out.push(slice[j] as string)
    })
    process.stderr.write(`  code checked ${Math.min(i + BATCH, addresses.length)}/${addresses.length}\r`)
  }
  process.stderr.write('\n')
  return out
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list'

const SNAPSHOTS_TS = `${APP}src/miyamints/snapshots.ts`
const START = '/* snapshots:start */'
const END = '/* snapshots:end */'

export type SnapshotEntry = {
  name: string
  chainId: number
  contract: string
  block: number
  blockTime: number
  root: string
  count: number
  contracts: number
}

export function readSnapshotEntries(): SnapshotEntry[] {
  const text = readFileSync(SNAPSHOTS_TS, 'utf8')
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  if (a < 0 || b < 0) throw new Error('src/miyamints/snapshots.ts lost its markers')
  return JSON.parse(text.slice(a + START.length, b)) as SnapshotEntry[]
}

export function writeSnapshotEntries(entries: SnapshotEntry[]) {
  const text = readFileSync(SNAPSHOTS_TS, 'utf8')
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  writeFileSync(SNAPSHOTS_TS, `${text.slice(0, a + START.length)}${JSON.stringify(entries, null, 2)}${text.slice(b)}`)
}

async function main() {
  const o = args()
  if (!o.contract || !o.name) {
    console.error('usage: node scripts/allowlist-snapshot.mts --contract 0x… --name "Milady holders" [--block n] [--ids a-b] [--publish]')
    process.exit(2)
  }
  const url = rpcUrl()
  const c = client(url)
  const contract = getAddress(o.contract)
  const block = await pinBlock(c, o.block)
  console.log(`RPC ${rpcHost(url)}; ${contract} at block ${block.number} (${new Date(Number(block.timestamp) * 1000).toISOString()})`)

  const supply = await c
    .readContract({ address: contract, abi: erc721, functionName: 'totalSupply', blockNumber: block.number })
    .catch(() => undefined)
  let from = 0n
  let to: bigint
  if (o.ids) {
    const m = /^(\d+)-(\d+)$/.exec(o.ids)
    if (!m) throw new Error('--ids looks like 0-9999')
    from = BigInt(m[1] as string)
    to = BigInt(m[2] as string)
  } else if (supply !== undefined) {
    to = supply
  } else throw new Error('totalSupply() did not answer: pass --ids a-b')
  console.log(`totalSupply ${supply ?? 'n/a'}; reading ownerOf for ids ${from}..${to}`)

  const { holders, owners, failed } = await readHolders(c, contract, from, to, block.number)
  if (supply !== undefined && BigInt(owners.size) < supply && !o.ids) {
    throw new Error(`Only ${owners.size} of ${supply} tokens answered in ${from}..${to}: pass --ids to cover every id.`)
  }
  const addresses = [...holders.keys()].sort()
  const contracts = await contractHolders(c, addresses, block.number)
  const { root, ...dump } = buildTree(addresses)

  // Every proof is checked against the root before anything is written.
  const proofs: Record<string, Hex[]> = {}
  for (const v of dump.values) {
    const proof = proofAt(dump.tree, v.treeIndex)
    if (!verifyProof(root, v.value[0], proof)) throw new Error(`proof for ${v.value[0]} does not verify`)
    proofs[v.value[0]] = proof
  }

  const source: AllowlistSource = {
    name: o.name,
    chainId: 1,
    contract,
    block: Number(block.number),
    blockTime: Number(block.timestamp),
    idsRead: `${from}-${to}`,
    tokens: owners.size,
    contracts: contracts.length,
  }
  const out = o.out || `${APP}scripts/out`
  mkdirSync(out, { recursive: true })
  const base = `${out}/${slug(o.name)}-${block.number}`
  writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        source,
        root,
        count: addresses.length,
        holders: Object.fromEntries(
          addresses.map((a) => [getAddress(a), (holders.get(a) ?? []).map(String)])
        ),
        contractHolders: contracts.map((a) => getAddress(a)),
      },
      null,
      1
    )
  )
  writeFileSync(`${base}.txt`, `${addresses.map((a) => getAddress(a)).join('\n')}\n`)
  writeFileSync(`${base}.proofs.json`, JSON.stringify(proofs))

  console.log(`tokens with an owner: ${owners.size} (ids that did not answer: ${failed})`)
  console.log(`unique holders: ${addresses.length} (${contracts.length} of them contracts at the block: kept, a pool can't claim)`)
  console.log(`root ${root}`)
  console.log(`wrote ${base}.{json,txt,proofs.json}`)

  if (o.publish) {
    publishList({ ...dump, root }, source)
    console.log(`published public/allowlists/${root}.json and src/miyamints/snapshots.ts`)
  }
}

/**
 * Ships a list with the build: public/allowlists/<root>.json (what the proof route serves) and its entry in
 * src/miyamints/snapshots.ts, replacing that collection's earlier entry. Earlier files are kept, so a drop still using
 * an older root keeps working.
 */
export function publishList(tree: AllowlistDump & { root: Hex }, source: AllowlistSource) {
  const { root, ...dump } = tree
  const file: AllowlistFile = { ...dump, miya: { root, count: dump.values.length, source } }
  mkdirSync(`${APP}public/allowlists`, { recursive: true })
  writeFileSync(`${APP}public/allowlists/${root}.json`, JSON.stringify(file))
  const entries = readSnapshotEntries().filter(
    (e) => e.contract.toLowerCase() !== source.contract.toLowerCase() || e.name !== source.name
  )
  entries.push({
    name: source.name,
    chainId: source.chainId,
    contract: source.contract,
    block: source.block,
    blockTime: source.blockTime,
    root,
    count: dump.values.length,
    contracts: source.contracts,
  })
  writeSnapshotEntries(entries)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(short(e), String((e as { details?: string })?.details ?? "").slice(0, 200), String((e as { status?: number })?.status ?? ""))
    process.exit(1)
  })
}

// Holders of an ERC-721 at one block, as a drop allowlist (api/_lib/allowlist.ts). Read-only: it sends nothing.
//
//   node scripts/allowlist-snapshot.mts --contract 0x… --name "Milady holders" [--block finalized|latest|<n>]
//        [--ids 0-9999] [--allow-supply-mismatch] [--publish] [--out scripts/out]
//
// Reads ownerOf(id) for every id at the pinned block through multicall3's aggregate3, de-duplicates the owners and
// builds the Merkle tree exactly as the drop checks it. Inside a batch, a call that reverts is an id without an owner
// (burned or never minted). A batch that fails as a whole (the RPC, a timeout) is NOT read as "no owners": it is tried
// again, and the script stops if it keeps failing. --ids defaults to 0..totalSupply() inclusive (covers collections
// that start at 0 or at 1). The tokens with an owner must number exactly totalSupply() at the block, or the script
// stops rather than ship a wrong list (--allow-supply-mismatch only for a collection whose totalSupply() counts burned
// tokens; pass --ids to cover ids past totalSupply()).
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
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

import type { AllowlistDump, AllowlistFile, AllowlistSource } from '../api/_lib/allowlist.ts'
import { buildTree, proofAt, verifyProof } from '../api/_lib/allowlist.ts'
import { APP, args, client, pinBlock, rpcHost, rpcUrl, short } from './lib/chain.mts'

const erc721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
])
const multicall3 = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
const MULTICALL3 = mainnet.contracts.multicall3.address
const MULTICALL_BATCH = 500
/** How often a batch that failed as a whole is tried again before the script stops. */
const BATCH_TRIES = 6
/** Burn addresses: tokens sent there are gone, and nobody can claim for them. Left off every list. */
export const BURN = new Set(['0x000000000000000000000000000000000000dead'])

export type Holders = Map<string, bigint[]>
/** Only what readHolders needs of a client, so a test can stand in for the RPC. */
export type Reader = Pick<PublicClient, 'readContract'>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Owner of every id in [from, to] at `block`: holder (lowercase) → ids. An id whose ownerOf reverts has no owner (burned
 * or not minted) and is counted in `reverted`. A batch whose aggregate3 call fails as a whole is tried again
 * (BATCH_TRIES); after that, or on an answer that doesn't decode as an address, it throws: a failed read is never a
 * shorter list.
 */
export async function readHolders(c: Reader, contract: Address, from: bigint, to: bigint, block: bigint, wait = sleep) {
  const holders: Holders = new Map()
  const owners = new Map<bigint, string>()
  let reverted = 0
  for (let start = from; start <= to; start += BigInt(MULTICALL_BATCH)) {
    const ids: bigint[] = []
    for (let id = start; id <= to && id < start + BigInt(MULTICALL_BATCH); id += 1n) ids.push(id)
    const calls = ids.map((id) => ({
      target: contract,
      allowFailure: true,
      callData: encodeFunctionData({ abi: erc721, functionName: 'ownerOf', args: [id] }),
    }))
    let res: readonly { success: boolean; returnData: Hex }[] | undefined
    for (let tries = 1; !res; tries += 1) {
      try {
        res = (await c.readContract({
          address: MULTICALL3,
          abi: multicall3,
          functionName: 'aggregate3',
          args: [calls],
          blockNumber: block,
        })) as readonly { success: boolean; returnData: Hex }[]
      } catch (e) {
        if (tries >= BATCH_TRIES) throw new Error(`ownerOf ${start}..${ids[ids.length - 1]} failed ${tries} times: ${short(e)}`)
        await wait(500 * 2 ** (tries - 1))
      }
    }
    if (res.length !== ids.length) throw new Error(`ownerOf ${start}..: ${res.length} answers for ${ids.length} ids`)
    res.forEach((r, i) => {
      const id = ids[i] as bigint
      if (!r.success) {
        reverted += 1
        return
      }
      let owner: string
      try {
        owner = (decodeFunctionResult({ abi: erc721, functionName: 'ownerOf', data: r.returnData }) as string).toLowerCase()
      } catch {
        throw new Error(`ownerOf(${id}) answered something that is not an address: ${r.returnData.slice(0, 80)}`)
      }
      if (/^0x0{40}$/.test(owner)) return
      owners.set(id, owner)
      const list = holders.get(owner) ?? []
      list.push(id)
      holders.set(owner, list)
    })
    process.stderr.write(`  ownerOf ${start}..${ids[ids.length - 1]}: ${owners.size} tokens so far\r`)
  }
  process.stderr.write('\n')
  return { holders, owners, reverted }
}

/**
 * Every holder of `contract` at `block`, checked: ids 0..max(totalSupply(), `atLeastTo`) unless `ids` is given, and the
 * tokens with an owner must number totalSupply() at that block (unless `allowMismatch`). Throws otherwise.
 */
export async function readAllHolders(
  c: Reader,
  contract: Address,
  block: bigint,
  opts: { ids?: [bigint, bigint]; atLeastTo?: bigint; allowMismatch?: boolean; wait?: typeof sleep } = {}
) {
  let supply: bigint | undefined
  try {
    supply = (await c.readContract({ address: contract, abi: erc721, functionName: 'totalSupply', blockNumber: block })) as bigint
  } catch (e) {
    if (!opts.ids) throw new Error(`totalSupply() of ${contract} at block ${block} did not answer (${short(e)}): pass --ids a-b`)
  }
  const [from, to] = opts.ids ?? [0n, supply! > (opts.atLeastTo ?? 0n) ? supply! : (opts.atLeastTo ?? 0n)]
  const read = await readHolders(c, contract, from, to, block, opts.wait)
  if (supply !== undefined && BigInt(read.owners.size) !== supply && !opts.allowMismatch) {
    throw new Error(
      `${read.owners.size} tokens have an owner in ids ${from}..${to} at block ${block}, but totalSupply() is ${supply}: ` +
        'the list would be wrong. Pass --ids to cover every id, or --allow-supply-mismatch if totalSupply() counts burned tokens.'
    )
  }
  return { ...read, supply, from, to }
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

  let ids: [bigint, bigint] | undefined
  if (o.ids) {
    const m = /^(\d+)-(\d+)$/.exec(o.ids)
    if (!m) throw new Error('--ids looks like 0-9999')
    ids = [BigInt(m[1] as string), BigInt(m[2] as string)]
  }
  const { holders, owners, reverted, supply, from, to } = await readAllHolders(c, contract, block.number, {
    ids,
    allowMismatch: o['allow-supply-mismatch'] === 'true',
  })
  console.log(`totalSupply ${supply ?? 'n/a'}; read ownerOf for ids ${from}..${to}`)
  const burned = [...holders.keys()].filter((a) => BURN.has(a))
  const addresses = [...holders.keys()].filter((a) => !BURN.has(a)).sort()
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

  console.log(`tokens with an owner: ${owners.size} (ids without one, ownerOf reverted: ${reverted})`)
  if (burned.length) console.log(`left off: ${burned.join(', ')} (burn address, ${burned.map((a) => holders.get(a)?.length).join(', ')} tokens)`)
  console.log(
    `unique holders: ${addresses.length} (${contracts.length} of them contracts at the block, kept: a Safe or smart wallet ` +
      "can claim; a pool, vault or escrow can't, so its spots go unused)"
  )
  console.log(`root ${root}`)
  console.log(`wrote ${base}.{json,txt,proofs.json}`)

  if (o.publish) {
    publishList({ ...dump, root }, source)
    console.log(`published public/allowlists/${root}.json and src/miyamints/snapshots.ts`)
  }
}

/**
 * Ships a list with the build: public/allowlists/<root>.json (what the proof route serves) and its entry in
 * src/miyamints/snapshots.ts, replacing the earlier entry of the same name for that collection. Earlier files are kept,
 * so a drop still using an older root keeps working. `entryName` names the Launch window's entry when it should not be
 * the list's own name (a refresh made for one drop must not replace the collection's general holder list); `miya`
 * adds a refresh's record to the file.
 */
export function publishList(
  tree: AllowlistDump & { root: Hex },
  source: AllowlistSource,
  opts: { entryName?: string; miya?: Pick<NonNullable<AllowlistFile['miya']>, 'refresh' | 'excluded'> } = {}
) {
  const { root, ...dump } = tree
  const file: AllowlistFile = { ...dump, miya: { root, count: dump.values.length, source, ...opts.miya } }
  mkdirSync(`${APP}public/allowlists`, { recursive: true })
  writeFileSync(`${APP}public/allowlists/${root}.json`, JSON.stringify(file))
  const name = opts.entryName ?? source.name
  const entries = readSnapshotEntries().filter(
    (e) => e.contract.toLowerCase() !== source.contract.toLowerCase() || e.name !== name
  )
  entries.push({
    name,
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

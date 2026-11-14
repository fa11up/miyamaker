// Who referred which mints of a drop. It READS ONLY and SENDS NOTHING: it prints a table and writes
// scripts/out/referrals-<drop>-<block>.json and .csv for the owner to pay from.
//
//   node scripts/referrals.mts --drop 0x… [--block <n>] [--bps <n: one flat rate instead of the decided ones>]
//
// THE TAG: a mint made from a ref link carries the referrer after the call's arguments (src/miyamints/referral.ts).
// The drop never reads it, so this script reads it back from each mint's transaction input.
//
// WHICH MINTS: every token the drop minted from 0x0 up to the pinned block, from alchemy_getAssetTransfers (the keyed
// RPC's plan allows eth_getLogs over 10 blocks only), then each transaction's receipt for the drop's Minted events
// (quantity, token, what was paid). ownerMint pieces (phase max uint) are never credited. Before anything is printed
// the pieces found are checked against the drop's own totalSupply at that block: if they don't add up, it stops.
//
// NOT CREDITED: a mint whose tag names the minting wallet (tx sender) or the wallet it minted to, and free mints count
// as pieces but earn nothing. REWARD: paid × rate / 10000, per mint, in the token it paid in. The rate is refBps(block
// timestamp) from src/miyamints/referral.ts (25% before REF_EARLY_UNTIL, 10% after) unless --bps sets one flat rate.
// Referrers are paid from the owner's share; this script only works out what each is owed.
import { mkdirSync, writeFileSync } from 'node:fs'

import type { Address, Hash, Hex } from 'viem'
import { decodeEventLog, getAddress, parseAbi, toHex, zeroAddress } from 'viem'

import { creditFor, OWNER_PHASE, refFromInput } from '../src/miyamints/referral.ts'

import { APP, args, client, rpcHost, rpcUrl } from './lib/chain.mts'

const DROP_ABI = parseAbi([
  'event Minted(address indexed to, uint256 indexed phaseId, uint256 firstId, uint256 quantity, address token, uint256 paid)',
  'function totalSupply() view returns (uint256)',
  'function ownerMinted() view returns (uint256)',
])

type Transfer = { hash: Hash; blockNum: Hex }
type Row = {
  referrer: Address
  mints: number
  pieces: number
  paid: Record<string, bigint>
  reward: Record<string, bigint>
}

const a = args()
if (!a.drop) throw new Error('Usage: node scripts/referrals.mts --drop 0x… [--block <n>] [--bps <n>]')
const drop = getAddress(a.drop)
const flat = a.bps === undefined ? undefined : BigInt(a.bps)
if (flat !== undefined && (flat < 0n || flat > 10_000n)) throw new Error('--bps is 0..10000')

const url = rpcUrl()
const c = client(url)
const block = a.block ? BigInt(a.block) : await c.getBlockNumber()
console.log(`drop ${drop} at block ${block} via ${rpcHost(url)}`)

// Every mint transaction, all pages: a missing page would silently drop referrals.
const hashes = new Set<Hash>()
let pageKey: string | undefined
let pages = 0
do {
  const res = (await c.request({
    method: 'alchemy_getAssetTransfers' as never,
    params: [
      {
        fromBlock: '0x0',
        toBlock: toHex(block),
        fromAddress: zeroAddress,
        contractAddresses: [drop],
        category: ['erc721'],
        excludeZeroValue: false,
        maxCount: '0x3e8',
        ...(pageKey ? { pageKey } : {}),
      },
    ] as never,
  })) as { transfers: Transfer[]; pageKey?: string }
  for (const t of res.transfers) hashes.add(t.hash)
  pageKey = res.pageKey
  pages += 1
} while (pageKey)
console.log(`${hashes.size} mint transactions (${pages} page${pages === 1 ? '' : 's'})`)

const times = new Map<bigint, number>()
const blockTime = async (n: bigint) => {
  if (!times.has(n)) times.set(n, Number((await c.getBlock({ blockNumber: n })).timestamp))
  return times.get(n) as number
}

const rows = new Map<string, Row>()
let pieces = 0n
let ownerPieces = 0n
let tagged = 0
let selfTagged = 0
for (const hash of hashes) {
  const [tx, receipt] = await Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash })])
  const isTagged = refFromInput(tx.input) !== undefined
  const timestamp = isTagged ? await blockTime(receipt.blockNumber) : 0
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== drop) continue
    let ev
    try {
      ev = decodeEventLog({ abi: DROP_ABI, data: log.data, topics: log.topics })
    } catch {
      continue
    }
    if (ev.eventName !== 'Minted') continue
    const { to, phaseId, quantity, token, paid } = ev.args
    pieces += quantity
    if (phaseId === OWNER_PHASE) {
      ownerPieces += quantity
      continue
    }
    if (!isTagged) continue
    const credit = creditFor({ input: tx.input, txFrom: tx.from, to, phaseId, paid, timestamp }, flat)
    if (!credit) {
      selfTagged += 1
      continue
    }
    tagged += 1
    const ref = credit.referrer
    const row = rows.get(ref) ?? { referrer: ref, mints: 0, pieces: 0, paid: {}, reward: {} }
    row.mints += 1
    row.pieces += Number(quantity)
    const t = getAddress(token)
    row.paid[t] = (row.paid[t] ?? 0n) + paid
    row.reward[t] = (row.reward[t] ?? 0n) + credit.reward
    rows.set(ref, row)
  }
}

const [supply, ownerMinted] = await Promise.all([
  c.readContract({ address: drop, abi: DROP_ABI, functionName: 'totalSupply', blockNumber: block }),
  c.readContract({ address: drop, abi: DROP_ABI, functionName: 'ownerMinted', blockNumber: block }),
])
if (pieces !== supply || ownerPieces !== ownerMinted) {
  throw new Error(
    `Incomplete: found ${pieces} pieces (${ownerPieces} owner) but the drop says ${supply} (${ownerMinted} owner) at block ${block}. Nothing written.`
  )
}

const list = [...rows.values()].sort((x, y) => y.pieces - x.pieces)
const tokens = [...new Set(list.flatMap((r) => Object.keys(r.paid)))].sort()
const name = (t: string) => (t === zeroAddress ? 'ETH' : t)

console.log(`${supply} pieces, ${tagged} tagged mints, ${selfTagged} self-tagged (not credited), ${list.length} referrers`)
console.log(flat === undefined ? 'rates: refBps (25% early, 10% after)' : `rate: flat ${flat} bps`)
for (const r of list) {
  const owed = tokens
    .filter((t) => r.paid[t])
    .map((t) => `${name(t)}: paid ${r.paid[t]} → owed ${r.reward[t]}`)
    .join(', ')
  console.log(`  ${r.referrer}  ${r.pieces} pieces in ${r.mints} mints  ${owed || 'free'}`)
}

const out = `${APP}scripts/out`
mkdirSync(out, { recursive: true })
const base = `${out}/referrals-${drop.toLowerCase()}-${block}`
const strings = (m: Record<string, bigint>) => Object.fromEntries(Object.entries(m).map(([t, v]) => [t, v.toString()]))
writeFileSync(
  `${base}.json`,
  JSON.stringify(
    {
      drop,
      block: block.toString(),
      rates: flat === undefined ? 'refBps' : `flat ${flat}`,
      supply: supply.toString(),
      referrers: list.map((r) => ({ ...r, paid: strings(r.paid), reward: strings(r.reward) })),
    },
    null,
    2
  )
)
const head = ['referrer', 'mints', 'pieces', ...tokens.flatMap((t) => [`paid ${name(t)}`, `owed ${name(t)}`])]
const csv = [
  head.join(','),
  ...list.map((r) =>
    [r.referrer, r.mints, r.pieces, ...tokens.flatMap((t) => [r.paid[t] ?? 0n, r.reward[t] ?? 0n])].join(',')
  ),
].join('\n')
writeFileSync(`${base}.csv`, `${csv}\n`)
console.log(`wrote ${base}.json and .csv`)

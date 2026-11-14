/**
 * Ref link stats for the share box: how many mints a referrer's link brought and what they are owed so far.
 *
 * The cron (runReferralCron, after the reveal's) reads each mint transaction the reveal stored in reveal_mints (only
 * confirmed blocks, already checked against totalSupply there), once: its input for the ref tag and its receipt for the
 * drop's Minted events, credited by creditFor (src/miyamints/referral.ts, passed in), the same rule the payout script uses. A
 * transaction and its credited rows go in one batch, so a failed run leaves it unread, never half-read.
 *
 * GET /api/referrals?drop=0x…&ref=0x… answers { mints, pieces, paid, owed, pending }: paid and owed per token (base
 * units, decimal strings), pending = mint transactions not read yet (the numbers may grow when they are).
 */
import type { Address, Hash, Hex } from 'viem'
import { decodeEventLog, getAddress, isAddress, parseAbi } from 'viem'

import type { creditFor, RefStats } from '../../src/miyamints/referral'

import type { RevealDb } from './reveal'

/** creditFor from src/miyamints/referral.ts, passed in by the worker (node's test runner can't follow its import). */
export type Credit = typeof creditFor

const jsonReply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

export const REFERRALS_PATH = '/api/referrals'
/** Mint transactions read per cron run, per drop: three RPC calls each at most. */
export const REF_TX_BUDGET = 30

const MINTED = parseAbi([
  'event Minted(address indexed to, uint256 indexed phaseId, uint256 firstId, uint256 quantity, address token, uint256 paid)',
])

/** The chain reads this needs. The worker passes a viem client's. */
export type ReferralChain = {
  tx: (hash: Hash) => Promise<{ input: Hex; from: Address }>
  receipt: (hash: Hash) => Promise<{ blockNumber: bigint; logs: { address: string; topics: Hex[]; data: Hex; logIndex: number }[] }>
  blockTime: (n: bigint) => Promise<number>
}

/** Reads up to `budget` unread mint transactions of each attached drop. Returns how many it read. */
export async function runReferralCron(
  db: RevealDb,
  chain: (chainId: number) => ReferralChain | undefined,
  credit: Credit,
  log: (l: string) => void = (l) => console.log(l),
  budget = REF_TX_BUDGET
): Promise<number> {
  const { results } = await db
    .prepare('SELECT slug, chain_id, address FROM reveal_collections WHERE address IS NOT NULL')
    .all()
  let read = 0
  for (const col of results) {
    const slug = String(col.slug)
    const drop = getAddress(String(col.address))
    const ch = chain(Number(col.chain_id))
    if (!ch) continue
    const pending = await db
      .prepare(
        `SELECT m.tx_hash, MIN(m.block_number) AS b FROM reveal_mints m
         WHERE m.slug = ? AND NOT EXISTS (SELECT 1 FROM ref_txs r WHERE r.slug = m.slug AND r.tx_hash = m.tx_hash)
         GROUP BY m.tx_hash ORDER BY b LIMIT ?`
      )
      .bind(slug, budget)
      .all()
    const times = new Map<bigint, number>()
    for (const row of pending.results) {
      const hash = String(row.tx_hash) as Hash
      const [tx, receipt] = await Promise.all([ch.tx(hash), ch.receipt(hash)])
      if (!times.has(receipt.blockNumber)) times.set(receipt.blockNumber, await ch.blockTime(receipt.blockNumber))
      const timestamp = times.get(receipt.blockNumber) as number
      const stmts = [db.prepare('INSERT OR IGNORE INTO ref_txs (slug, tx_hash) VALUES (?, ?)').bind(slug, hash)]
      for (const l of receipt.logs) {
        if (!isAddress(l.address) || getAddress(l.address) !== drop) continue
        let ev
        try {
          ev = decodeEventLog({ abi: MINTED, data: l.data, topics: l.topics as [Hex, ...Hex[]] })
        } catch {
          continue
        }
        const { to, phaseId, quantity, token, paid } = ev.args
        const c = credit({ input: tx.input, txFrom: tx.from, to, phaseId, paid, timestamp })
        if (!c) continue
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO ref_mints
               (slug, tx_hash, log_index, referrer, quantity, token, paid, bps, reward, block_number)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              slug,
              hash,
              l.logIndex,
              c.referrer.toLowerCase(),
              Number(quantity),
              getAddress(token).toLowerCase(),
              paid.toString(),
              Number(c.bps),
              c.reward.toString(),
              Number(receipt.blockNumber)
            )
        )
      }
      await db.batch(stmts)
      read += 1
    }
    if (pending.results.length) log(`referrals ${slug}: read ${pending.results.length} mint tx(s)`)
  }
  return read
}

/** A referrer's totals for a drop, or undefined when the drop isn't one the reveal follows. */
export async function referralStats(db: RevealDb, drop: string, referrer: string): Promise<RefStats | undefined> {
  const c = await db
    .prepare('SELECT slug FROM reveal_collections WHERE lower(address) = ?')
    .bind(drop.toLowerCase())
    .first()
  if (!c) return undefined
  const slug = String(c.slug)
  const [rows, pending] = await Promise.all([
    db
      .prepare('SELECT quantity, token, paid, reward FROM ref_mints WHERE slug = ? AND referrer = ?')
      .bind(slug, referrer.toLowerCase())
      .all(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT m.tx_hash) AS n FROM reveal_mints m
         WHERE m.slug = ? AND NOT EXISTS (SELECT 1 FROM ref_txs r WHERE r.slug = m.slug AND r.tx_hash = m.tx_hash)`
      )
      .bind(slug)
      .first(),
  ])
  const paid: Record<string, bigint> = {}
  const owed: Record<string, bigint> = {}
  let pieces = 0
  for (const r of rows.results) {
    const t = String(r.token)
    pieces += Number(r.quantity)
    paid[t] = (paid[t] ?? 0n) + BigInt(String(r.paid))
    owed[t] = (owed[t] ?? 0n) + BigInt(String(r.reward))
  }
  const str = (m: Record<string, bigint>) => Object.fromEntries(Object.entries(m).map(([t, v]) => [t, v.toString()]))
  return { mints: rows.results.length, pieces, paid: str(paid), owed: str(owed), pending: Number(pending?.n ?? 0) }
}

export async function handleReferralsRequest(
  request: Request,
  deps: { db?: RevealDb; clientKey: (h: Headers) => string; limiter: (key: string) => boolean }
): Promise<Response> {
  if (request.method !== 'GET') return jsonReply(405, { error: 'GET only.' })
  if (!deps.limiter(deps.clientKey(request.headers))) return jsonReply(429, { error: 'Too many requests.' })
  const q = new URL(request.url).searchParams
  const drop = q.get('drop') ?? ''
  const ref = q.get('ref') ?? ''
  if (!isAddress(drop, { strict: false }) || !isAddress(ref, { strict: false })) {
    return jsonReply(400, { error: 'Send ?drop=0x…&ref=0x….' })
  }
  if (!deps.db) return jsonReply(503, { error: 'Stats are not set up here.' })
  try {
    const stats = await referralStats(deps.db, drop, ref)
    if (!stats) return jsonReply(404, { error: 'No ref stats for this drop.' })
    return new Response(JSON.stringify(stats), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
    })
  } catch (e) {
    // Before migrations/0006_referrals.sql there is no table: say so, never report zero.
    console.log(`referrals: ${String((e as Error)?.message ?? e).slice(0, 300)}`)
    return jsonReply(503, { error: 'Stats are not available right now.' })
  }
}

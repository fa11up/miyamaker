// api/_lib/referrals.ts: the cron credits tagged mints once, and the share box's stats add them up. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { Address, Hash, Hex } from 'viem'
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, zeroAddress } from 'viem'

import type { ReferralChain } from '../api/_lib/referrals.ts'
import { handleReferralsRequest, referralStats, runReferralCron } from '../api/_lib/referrals.ts'
import type { RevealDb, RevealStmt } from '../api/_lib/reveal.ts'
import type { RefStats } from '../src/miyamints/referral.ts'
import { creditFor, OWNER_PHASE, REF_EARLY_UNTIL, refStatsWords, refSuffix } from '../src/miyamints/referral.ts'

type SqliteStmt = {
  all: (...a: unknown[]) => Record<string, unknown>[]
  get: (...a: unknown[]) => Record<string, unknown> | undefined
  run: (...a: unknown[]) => { changes: number | bigint }
}
type Sqlite = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStmt }
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (path: string) => Sqlite }

const MIGRATIONS = ['0004_reveal.sql', '0006_referrals.sql'].map((f) =>
  readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
)

function sqliteD1(): RevealDb & { raw: Sqlite } {
  const raw = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS) raw.exec(m)
  type S = RevealStmt & { exec: () => { meta: { changes: number } } }
  const stmt = (sql: string, args: unknown[] = []): S => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    first: async () => raw.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
    exec: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
  })
  return {
    raw,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      raw.exec('BEGIN')
      try {
        const out = (stmts as S[]).map((s) => s.exec())
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
  }
}

const DROP = getAddress('0xb86b68bca287afd48f81d1f792db69368664a120')
const REF = getAddress('0x1234567890abcdef1234567890abcdef12345634')
const BUYER = getAddress('0x5167d014a056e43883e1bbea5530c3c0dc993281')
const OTHER = getAddress('0x00000000000000000000000000000000000000aa')
const PRICE = 10_000_000_000_000_000n // 0.01 ETH
const EVENT = parseAbi([
  'event Minted(address indexed to, uint256 indexed phaseId, uint256 firstId, uint256 quantity, address token, uint256 paid)',
])
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash

type Mint = { from: Address; to: Address; phaseId: bigint; qty: bigint; paid: bigint; tag?: Address; time: number }

function setup(mints: Mint[]) {
  const db = sqliteD1()
  db.raw.exec(`INSERT INTO reveal_collections (slug, chain_id, supply, provenance_hash, name, description, cover_image, address)
    VALUES ('miyamaker', 1, 10000, 'x', 'Miyamaker', '', '', '${DROP.toLowerCase()}')`)
  mints.forEach((_, i) =>
    db.raw.exec(`INSERT INTO reveal_mints VALUES ('miyamaker', ${i + 1}, ${100 + i}, '0x', '${hash(i + 1)}', 0)`)
  )
  const calls = { n: 0 }
  const chain: ReferralChain = {
    tx: async (h) => {
      calls.n += 1
      const m = mints[Number(BigInt(h)) - 1] as Mint
      const input = `0xdeadbeef${m.tag ? refSuffix(m.tag).slice(2) : ''}` as Hex
      return { input, from: m.from }
    },
    receipt: async (h) => {
      const i = Number(BigInt(h)) - 1
      const m = mints[i] as Mint
      return {
        blockNumber: BigInt(100 + i),
        logs: [
          {
            address: DROP.toLowerCase(),
            topics: encodeEventTopics({ abi: EVENT, eventName: 'Minted', args: { to: m.to, phaseId: m.phaseId } }) as Hex[],
            data: encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
              [1n, m.qty, zeroAddress, m.paid]
            ),
            logIndex: 0,
          },
        ],
      }
    },
    blockTime: async (n) => (mints[Number(n) - 100] as Mint).time,
  }
  return { db, chain, calls }
}

const EARLY = REF_EARLY_UNTIL - 100
const LATE = REF_EARLY_UNTIL + 100

test('tagged mints are credited at the rate of their block time; self, owner and untagged mints are not', async () => {
  const { db, chain } = setup([
    { from: BUYER, to: BUYER, phaseId: 0n, qty: 2n, paid: 2n * PRICE, tag: REF, time: EARLY }, // 25%
    { from: BUYER, to: BUYER, phaseId: 0n, qty: 1n, paid: PRICE, tag: REF, time: LATE }, // 10%
    { from: REF, to: REF, phaseId: 0n, qty: 1n, paid: PRICE, tag: REF, time: EARLY }, // self
    { from: BUYER, to: REF, phaseId: 0n, qty: 1n, paid: PRICE, tag: REF, time: EARLY }, // minted to the referrer
    { from: BUYER, to: BUYER, phaseId: OWNER_PHASE, qty: 5n, paid: 0n, tag: REF, time: EARLY }, // ownerMint
    { from: OTHER, to: OTHER, phaseId: 0n, qty: 1n, paid: PRICE, time: EARLY }, // no tag
    { from: OTHER, to: OTHER, phaseId: 1n, qty: 1n, paid: 0n, tag: REF, time: EARLY }, // free claim: counts, earns 0
  ])
  assert.equal(await runReferralCron(db, () => chain, creditFor, () => undefined), 7)
  const s = (await referralStats(db, DROP, REF)) as RefStats
  assert.equal(s.mints, 3)
  assert.equal(s.pieces, 4)
  assert.equal(s.pending, 0)
  assert.deepEqual(s.paid, { [zeroAddress]: (3n * PRICE).toString() })
  assert.deepEqual(s.owed, { [zeroAddress]: ((2n * PRICE * 2500n) / 10_000n + (PRICE * 1000n) / 10_000n).toString() })
})

test('each transaction is read once, a budget leaves the rest pending, and a failed read leaves it unread', async () => {
  const mints = [1, 2, 3].map(() => ({ from: BUYER, to: BUYER, phaseId: 0n, qty: 1n, paid: PRICE, tag: REF, time: LATE }))
  const { db, chain, calls } = setup(mints)
  assert.equal(await runReferralCron(db, () => chain, creditFor, () => undefined, 2), 2)
  assert.equal((await referralStats(db, DROP, REF))?.pending, 1)
  const broken: ReferralChain = { ...chain, receipt: async () => Promise.reject(new Error('rpc down')) }
  await assert.rejects(runReferralCron(db, () => broken, creditFor, () => undefined))
  assert.equal((await referralStats(db, DROP, REF))?.pending, 1)
  calls.n = 0
  assert.equal(await runReferralCron(db, () => chain, creditFor, () => undefined), 1)
  assert.equal(await runReferralCron(db, () => chain, creditFor, () => undefined), 0)
  assert.equal(calls.n, 1)
  assert.equal((await referralStats(db, DROP, REF))?.mints, 3)
})

test('the endpoint: 404 for a drop it does not follow, 400 for junk, 503 without the table, never a fake zero', async () => {
  const { db } = setup([])
  const deps = { db, clientKey: () => 'k', limiter: () => true }
  const get = (q: string, d = deps) => handleReferralsRequest(new Request(`https://x/api/referrals?${q}`), d)
  assert.equal((await get(`drop=${DROP}&ref=${REF}`)).status, 200)
  assert.equal((await get(`drop=${OTHER}&ref=${REF}`)).status, 404)
  assert.equal((await get(`drop=nope&ref=${REF}`)).status, 400)
  const bare = sqliteD1()
  bare.raw.exec('DROP TABLE ref_txs')
  bare.raw.exec(`INSERT INTO reveal_collections (slug, chain_id, supply, provenance_hash, name, description, cover_image, address)
    VALUES ('m', 1, 1, 'x', 'M', '', '', '${DROP.toLowerCase()}')`)
  const origLog = console.log
  console.log = () => undefined
  try {
    assert.equal((await get(`drop=${DROP}&ref=${REF}`, { ...deps, db: bare })).status, 503)
  } finally {
    console.log = origLog
  }
  assert.equal((await get(`drop=${DROP}&ref=${REF}`, { ...deps, limiter: () => false })).status, 429)
})

test('creditFor is the payout rule: flat --bps overrides the dated rates', () => {
  const m = { input: refSuffix(REF), txFrom: BUYER, to: BUYER, phaseId: 0n, paid: PRICE, timestamp: EARLY }
  assert.equal(creditFor(m)?.reward, (PRICE * 2500n) / 10_000n)
  assert.equal(creditFor(m, 500n)?.reward, (PRICE * 500n) / 10_000n)
  assert.equal(creditFor({ ...m, input: '0x' }), undefined)
})

test('the stats line: counts, owed per token, still-reading, and nothing yet', () => {
  const eth = (_t: string, v: bigint) => `${Number(v) / 1e18} ETH`
  const base = { paid: {}, owed: {}, pending: 0 }
  assert.equal(refStatsWords({ ...base, mints: 0, pieces: 0 }, eth), 'No mints from your link yet.')
  assert.equal(
    refStatsWords({ ...base, mints: 2, pieces: 3, owed: { [zeroAddress]: '5000000000000000' }, pending: 1 }, eth),
    'From your link: 2 mints, 3 pieces. Owed so far: 0.005 ETH. Still reading 1 recent mint.'
  )
  assert.equal(
    refStatsWords({ ...base, mints: 1, pieces: 1, owed: { [zeroAddress]: '0' } }, eth),
    'From your link: 1 mint, 1 piece. Owed so far: nothing (free mints).'
  )
})

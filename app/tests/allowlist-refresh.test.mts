// The allowlist scripts' decisions (scripts/lib/refresh.mts, scripts/allowlist-snapshot.mts, scripts/lib/prices.mts):
// a used-up cap never becomes "no cap", earlier claimers carry over or the refresh stops, a failed holder read is never
// a shorter list, and prices are refused when the quoter disagrees with spot. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from 'viem'
import { encodeAbiParameters } from 'viem'

import type { AllowlistFile } from '../api/_lib/allowlist.ts'
import { buildTree } from '../api/_lib/allowlist.ts'
import { readAllHolders, readHolders } from '../scripts/allowlist-snapshot.mts'
import { assertQuotes, quoteGap } from '../scripts/lib/prices.mts'
import { assertCaps, carriedExclusions, fileFits, nextCap, refreshEntryName } from '../scripts/lib/refresh.mts'

const DROP = '0xB86B68BCa287AFD48F81D1F792db69368664a120'
const MILADY = '0x5af0d9827e0c53e4799bb226655a1de152a425a5'
const A = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'
const B = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf'

// ── caps ─────────────────────────────────────────────────────────────────────

test('a capped phase gets what is left; a used-up cap leaves the phase out, never 0 (the drop reads 0 as no cap)', () => {
  assert.deepEqual(nextCap(333, 2n), { keep: true, cap: 331, words: 'cap 333 - sold 2 -> 331' })
  assert.equal(nextCap(100, 100n).keep, false)
  assert.equal(nextCap(100, 140n).keep, false, 'oversold still counts as used up')
  assert.match(nextCap(100, 100n).words, /cap 100 used up/)
  assert.deepEqual(nextCap(0, 50n), { keep: true, cap: 0, words: 'no cap (stays none)' })
})

test('assertCaps stops a plan that would send a capped phase with 0', () => {
  assert.doesNotThrow(() => assertCaps([{ from: 0, was: 0, phase: { supplyCap: 0 } }, { from: 1, was: 5, phase: { supplyCap: 1 } }]))
  assert.throws(() => assertCaps([{ from: 2, was: 100, phase: { supplyCap: 0 } }]), /phase 2 had a cap of 100/)
})

// ── earlier claimers ─────────────────────────────────────────────────────────

const { root: ROOT, ...DUMP } = buildTree([A, B])
const file = (miya: Partial<NonNullable<AllowlistFile['miya']>> = {}): AllowlistFile => ({
  ...DUMP,
  miya: { root: ROOT, count: 2, ...miya },
})
const list = (f: AllowlistFile, phase = 0) => ({ phase, root: ROOT, source: MILADY, file: f })

test('the first phase list needs no record', () => {
  const r = carriedExclusions({ drop: DROP, epoch: 1n, lists: [list(file())] })
  assert.equal(r.carried.size, 0)
})

test('from the second phase list on, a refresh without a record of earlier claimers stops', () => {
  assert.throws(() => carriedExclusions({ drop: DROP, epoch: 2n, lists: [list(file())] }), /nothing records who claimed/)
  const ok = carriedExclusions({ drop: DROP, epoch: 2n, lists: [list(file())], noRecordOk: true })
  assert.match(ok.notes.join(' '), /may be listed again/)
})

test("a published refresh list carries its own record, read back when it is this drop's and this phase list's", () => {
  const refreshed = file({ refresh: { drop: DROP, liveFromEpoch: 2, block: 1 }, excluded: [A] })
  const r = carriedExclusions({ drop: DROP, epoch: 2n, lists: [list(refreshed)] })
  assert.deepEqual([...(r.carried.get(MILADY) ?? [])], [A])
  // Another drop's record, or one planned for another phase list, doesn't count.
  const other = file({ refresh: { drop: B, liveFromEpoch: 2, block: 1 }, excluded: [A] })
  assert.throws(() => carriedExclusions({ drop: DROP, epoch: 2n, lists: [list(other)] }), /nothing records/)
  assert.throws(() => carriedExclusions({ drop: DROP, epoch: 3n, lists: [list(refreshed)] }), /nothing records/)
})

test('--previous must be for this drop and the phase list now live', () => {
  const prev = { drop: DROP, block: 1, liveFromEpoch: 2, excluded: { [MILADY]: [B] } }
  const r = carriedExclusions({ drop: DROP, epoch: 2n, lists: [list(file())], previous: prev })
  assert.deepEqual([...(r.carried.get(MILADY) ?? [])], [B])
  assert.throws(() => carriedExclusions({ drop: DROP, epoch: 2n, lists: [], previous: { ...prev, drop: A } }), /is for drop/)
  assert.throws(() => carriedExclusions({ drop: DROP, epoch: 3n, lists: [], previous: prev }), /another setPhases/)
  // An older file (claimers only, no epoch) is used, with a warning.
  const old = carriedExclusions({ drop: DROP, epoch: 2n, lists: [], previous: { drop: DROP, block: 1, claimers: { [MILADY]: [A] } } })
  assert.deepEqual([...(old.carried.get(MILADY) ?? [])], [A])
  assert.match(old.notes.join(' '), /older file/)
})

test('a list file is used only when its tree is for the phase root; refresh lists get their own Launch name', () => {
  assert.ok(fileFits(file(), ROOT))
  assert.ok(fileFits(file(), ROOT.toUpperCase().replace('0X', '0x')))
  assert.equal(fileFits(file(), `0x${'1'.repeat(64)}`), false)
  assert.equal(fileFits(undefined, ROOT), false)
  assert.equal(refreshEntryName('Milady holders', DROP, 2), 'Milady holders (drop 0xB86B68 refresh 1)')
})

// ── holder reads ─────────────────────────────────────────────────────────────

const ownerWord = (a: string) => encodeAbiParameters([{ type: 'address' }], [a as Hex])
type Answer = { success: boolean; returnData: Hex }
/** A stand-in for the RPC: totalSupply, and aggregate3 over ownerOf answered by `owner(id)` (undefined = reverts). */
function fakeChain(opts: { supply?: bigint; owner: (id: bigint) => string | undefined; failFirst?: number; failAlways?: boolean }) {
  let failures = opts.failFirst ?? 0
  const calls = { aggregate: 0 }
  const c = {
    readContract: async (p: { functionName: string; args?: readonly unknown[] }) => {
      if (p.functionName === 'totalSupply') {
        if (opts.supply === undefined) throw new Error('reverted')
        return opts.supply
      }
      calls.aggregate += 1
      if (opts.failAlways || failures > 0) {
        failures -= 1
        throw new Error('HTTP request failed. Status: 429')
      }
      const batch = p.args?.[0] as { callData: Hex }[]
      return batch.map((x): Answer => {
        const id = BigInt(`0x${x.callData.slice(10)}`)
        const o = opts.owner(id)
        return o === undefined ? { success: false, returnData: '0x' } : { success: true, returnData: ownerWord(o) }
      })
    },
  }
  return { c: c as never, calls }
}
const noWait = async () => {}

test('a batch that fails as a whole is tried again, not read as "no owners"', async () => {
  const { c, calls } = fakeChain({ supply: 3n, owner: (id) => (id === 0n ? undefined : id === 3n ? B : A), failFirst: 2 })
  const r = await readHolders(c, MILADY as Hex, 0n, 3n, 1n, noWait)
  assert.equal(calls.aggregate, 3)
  assert.equal(r.owners.size, 3)
  assert.deepEqual(r.holders.get(A), [1n, 2n])
  assert.equal(r.reverted, 1, 'id 0 reverts: no owner')
})

test('a batch that keeps failing stops the script', async () => {
  const { c } = fakeChain({ supply: 3n, owner: () => A, failAlways: true })
  await assert.rejects(readHolders(c, MILADY as Hex, 0n, 3n, 1n, noWait), /failed 6 times/)
})

test('the tokens with an owner must number totalSupply(), or the list would be wrong', async () => {
  const ok = fakeChain({ supply: 3n, owner: (id) => (id === 0n || id > 3n ? undefined : A) })
  const r = await readAllHolders(ok.c, MILADY as Hex, 1n, { wait: noWait })
  assert.equal(r.owners.size, 3)
  assert.equal(r.to, 3n)
  const short = fakeChain({ supply: 3n, owner: (id) => (id < 2n ? undefined : A) })
  await assert.rejects(readAllHolders(short.c, MILADY as Hex, 1n, { wait: noWait }), /totalSupply\(\) is 3/)
  const allowed = await readAllHolders(short.c, MILADY as Hex, 1n, { wait: noWait, allowMismatch: true })
  assert.equal(allowed.owners.size, 2)
  // The range is worked out again from totalSupply(), and still reaches an earlier list's last id.
  const wide = await readAllHolders(ok.c, MILADY as Hex, 1n, { wait: noWait, atLeastTo: 9n })
  assert.equal(wide.to, 9n)
  const noSupply = fakeChain({ owner: () => A })
  await assert.rejects(readAllHolders(noSupply.c, MILADY as Hex, 1n, { wait: noWait }), /pass --ids/)
})

// ── prices ───────────────────────────────────────────────────────────────────

test('prices are refused when the quoter is more than 5% off spot on a hop', () => {
  assert.equal(quoteGap(1000n, 990n), 0.01)
  assert.equal(quoteGap(1000n, 1010n), 0.01)
  assert.doesNotThrow(() => assertQuotes([{ name: 'ETH -> IMD', spot: 1000n, quoted: 980n }]))
  assert.throws(() => assertQuotes([{ name: 'IMD -> INFER', spot: 1000n, quoted: 940n }]), /IMD -> INFER: the V4Quoter gives 6\.00%/)
  assert.throws(() => assertQuotes([{ name: 'x', spot: 0n, quoted: 1n }]), /not safe/)
})

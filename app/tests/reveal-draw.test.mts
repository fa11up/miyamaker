// The per-mint reveal's draw (api/_lib/revealdraw.mjs) and the verifier's check (scripts/reveal/lib.mjs). The vectors
// were worked out apart from this code: r with `cast keccak <seed><uint256 t>`, the pool steps in Python. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFIRMATIONS, draw, drawFor, drawNumber, newPool, replay, takePiece } from '../api/_lib/revealdraw.mjs'
import { checkDraws } from '../scripts/reveal/lib.mjs'

// mixHash of mainnet blocks 24000001 and 26394536 (equal to the EVM's PREVRANDAO there, checked with eth_call).
const S1 = '0xaa32f3662bf5321925b2514e670a630d2b8f20b7e39d4dcc932874bc4bc2fa29'
const S2 = '0x1e0ce5b1e11320d3d8319d68d2e6e56104714dab4351d96ed30d5264455b2036'
const ZERO = `0x${'0'.repeat(64)}`

test('r = keccak256(abi.encodePacked(bytes32 seed, uint256 t)), as cast computes it', () => {
  assert.equal(drawNumber(S1, 1), 0x9f20986790c36e33de8d873cf9b47f208f557f80d90db16f7572bcf4bd41bbcdn)
  assert.equal(drawNumber(S1, 2), 0x22bb84281ebbaca93c0a4462e0163663ba3fb1ec439ab450f95686b391d5bf64n)
  assert.equal(drawNumber(S2, 5), 0x7f5a00ccc1d796388224705beeac14082d744d1a3b5307832850c4f24774cc6fn)
  assert.equal(drawNumber(ZERO, 1), 0xa6eef7e35abe7026729641147f7915573c7e97b47efa546f5f6e3230263bcb49n)
  assert.equal(drawNumber(S1, 10000n), 0x775a71e9a68c72664290c5f344fb0c6a1b535bc21e0c13de9fac569708c0e5ban)
  // Upper-case hex is the same seed; anything not 32 bytes is refused.
  assert.equal(drawNumber(S1.toUpperCase().replace('0X', '0x'), 1), drawNumber(S1, 1))
  assert.throws(() => drawNumber('0x1234', 1), /32 bytes/)
  assert.throws(() => drawNumber(S1, 0), /out of range/)
})

test('fixed vectors: five draws from a pool of 10 and of 10,000', () => {
  const seeds = [S1, S1, S1, S2, S2]
  const small = newPool(10)
  assert.deepEqual(
    seeds.map((s, i) => draw(small, s, i + 1)),
    [8, 4, 7, 2, 6]
  )
  assert.deepEqual(small.items, [1, 10, 3, 9, 5])
  const full = newPool(10_000)
  assert.deepEqual(
    seeds.map((s, i) => draw(full, s, i + 1)),
    [158, 2101, 1649, 3241, 4212]
  )
  assert.equal(full.items.length, 9995)
})

test('every piece is drawn exactly once', () => {
  const pool = newPool(1000)
  const seen = new Set<number>()
  for (let t = 1; t <= 1000; t += 1) seen.add(draw(pool, t % 2 ? S1 : S2, t))
  assert.equal(seen.size, 1000)
  assert.equal(pool.items.length, 0)
  assert.throws(() => draw(pool, S1, 1001), /empty/)
})

test('rebuilding the pool from stored pieces gives the pool the draws left', () => {
  const drawn = newPool(500)
  const pieces = Array.from({ length: 300 }, (_, i) => draw(drawn, i % 3 ? S1 : S2, i + 1))
  const rebuilt = newPool(500)
  for (const p of pieces) takePiece(rebuilt, p)
  assert.deepEqual(rebuilt.items, drawn.items)
  assert.deepEqual([...rebuilt.at], [...drawn.at])
  assert.throws(() => takePiece(rebuilt, pieces[0]!), /not in the pool/)
  assert.throws(() => takePiece(rebuilt, 501), /not in the pool/)
})

/** A made-up chain: block n has hash h(n), parent h(n-1), mixHash m(n). */
const h = (n: number) => `0x${n.toString(16).padStart(64, 'a')}`
const mix = (n: number) => `0x${(n * 7919).toString(16).padStart(64, 'c')}`
const header = (n: number) => ({ number: n, hash: h(n), parentHash: h(n - 1), mixHash: mix(n) })
const headersUpTo = (head: number) => new Map(Array.from({ length: head }, (_, i) => [i + 1, header(i + 1)]))
const mintsAt = (blocks: number[]) => blocks.map((block, i) => ({ tokenId: i + 1, block, blockHash: h(block) }))

test('tokens minted in one block share a seed and are drawn in id order, however they are listed', () => {
  const mints = mintsAt([100, 100, 100, 101, 101])
  const head = 120
  const a = replay(50, mints, headersUpTo(head), head)
  const b = replay(50, [...mints].reverse(), headersUpTo(head), head)
  assert.deepEqual(a, b)
  assert.deepEqual(
    a.map((d) => d.tokenId),
    [1, 2, 3, 4, 5]
  )
  assert.equal(a[0]!.seed, mix(101))
  assert.equal(a[2]!.seed, mix(101))
  assert.equal(a[3]!.seed, mix(102))
  assert.equal(new Set(a.map((d) => d.piece)).size, 5)
})

test('a draw waits for block B+1 and B+CONFIRMATIONS, and later tokens wait with it', () => {
  const mints = mintsAt([100, 103, 104])
  const head = 103 + CONFIRMATIONS - 1
  const d = replay(50, mints, headersUpTo(head), head)
  assert.deepEqual(
    d.map((x) => x.tokenId),
    [1]
  )
  // Header B+1 missing (not served yet): stops there.
  const some = headersUpTo(200)
  some.delete(101)
  assert.deepEqual(replay(50, mints, some, 200), [])
  // Mints with a gap, or a B+1 that is not B's child (a reorg), are refused.
  assert.throws(() => replay(50, [mints[0]!, { ...mints[2]!, tokenId: 3 }], headersUpTo(200), 200), /skip/)
  const forked = headersUpTo(200)
  forked.set(101, { ...header(101), parentHash: h(999) })
  assert.throws(() => replay(50, mints, forked, 200), /does not follow/)
})

test('a real mainnet pair: block 24000001 follows 24000000 and seeds a mint made in 24000000', () => {
  const next = {
    number: 24000001,
    hash: '0x1353cf08daa372d4f13d8a95721dbd406650c78a602c0bfa1867042275637c3c',
    parentHash: '0x738cc1716ea1f08adac2d4e2230aedcee2d5cd3f65d66d5d3597e05d710a3d50',
    mixHash: S1,
  }
  const mint = {
    tokenId: 1,
    block: 24000000,
    blockHash: '0x738cc1716ea1f08adac2d4e2230aedcee2d5cd3f65d66d5d3597e05d710a3d50',
  }
  const d = drawFor(newPool(10_000), mint, next)
  assert.deepEqual(d, { tokenId: 1, piece: 158, seedBlock: 24000001, seedBlockHash: next.hash, seed: S1 })
})

test('the verifier: a true list passes; a changed piece, seed, extra or skipped token fails', () => {
  const mints = mintsAt([100, 100, 102, 103, 110])
  const head = 112
  const headers = headersUpTo(head)
  const truth = replay(30, mints, headers, head).map((d) => ({
    token: d.tokenId,
    piece: d.piece,
    mintBlock: mints[d.tokenId - 1]!.block,
    mintBlockHash: mints[d.tokenId - 1]!.blockHash,
    seedBlock: d.seedBlock,
    seedBlockHash: d.seedBlockHash,
    seed: d.seed,
  }))
  assert.equal(truth.length, 4) // token 5 (block 110) is not 5 deep yet
  const check = (published: typeof truth) => checkDraws({ supply: 30, mints, headers, head, published })
  assert.deepEqual(check(truth), { problems: [], checked: 4, pending: 0 })
  // A list that is behind the chain (the cron has not run yet) is fine, and says so.
  assert.deepEqual(check(truth.slice(0, 2)), { problems: [], checked: 2, pending: 2 })

  const swapped = truth.map((a, i) => (i === 1 ? { ...a, piece: truth[2]!.piece } : a))
  assert.match(check(swapped).problems.join('\n'), /token 2: piece/)
  const reseeded = truth.map((a, i) => (i === 0 ? { ...a, seed: ZERO } : a))
  assert.match(check(reseeded).problems.join('\n'), /token 1: seed/)
  const early = [...truth, { ...truth[0]!, token: 5, piece: 29 }]
  assert.match(check(early).problems.join('\n'), /token 5 is listed before the chain can draw it/)
  assert.match(check([truth[0]!, truth[2]!]).problems.join('\n'), /listed after an unlisted token/)
  const ghost = [...truth, { ...truth[0]!, token: 9 }]
  assert.match(check(ghost).problems.join('\n'), /token 9 is listed but was never minted/)
})

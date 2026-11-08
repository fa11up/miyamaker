// Pure logic behind the desktop pet, screensaver, live mint feed and wallet files. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeenSet, mintKey, nextRange, toMintEvents, ZERO_ADDRESS } from '../src/desktop/mints/dedupe.ts'
import {
  groupByCollection,
  heldFromOwnerSweep,
  heldFromTransfers,
  logChunks,
  parseAlchemyOwnedNfts,
} from '../src/desktop/files/indexer/parse.ts'
import { cleanText, decodeDataJson, safeImageUrl, safeLinkUrl, sanitizeMetadata } from '../src/desktop/files/sanitize.ts'
import type { PetState } from '../src/desktop/pet/machine.ts'
import { initialPet, PET_PHYSICS, petEvent, stepPet } from '../src/desktop/pet/machine.ts'
import { clampDelayMinutes, idleRemaining, isTextEntry, movedEnough, shouldStartScreensaver } from '../src/desktop/screensaver/idle.ts'
import { anythingPlaying, setPlaying } from '../src/desktop/screensaver/playing.ts'

const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281'
const OTHER = '0x00000000000000000000000000000000000000aa'
const NFT = '0x375a1911c0c2982f59826c227b7830e5d5985d59'
const TX = '0x' + 'ab'.repeat(32)

/* ---------- mint dedupe ---------- */

const log = (o: Partial<{ from: string; to: string; tokenId: bigint; tx: string; li: number; block: bigint }>) => ({
  address: NFT.toUpperCase().replace('0X', '0x'),
  args: { from: o.from ?? ZERO_ADDRESS, to: o.to ?? ME, tokenId: o.tokenId ?? 1n },
  transactionHash: o.tx ?? TX,
  logIndex: o.li ?? 0,
  blockNumber: o.block ?? 100n,
})

test('only mints (from = 0x0) become events, each once across overlapping polls', () => {
  const seen = createSeenSet()
  const first = toMintEvents(
    [log({ tokenId: 5n, li: 3 }), log({ from: OTHER, tokenId: 6n, li: 4 }), log({ tokenId: 7n, li: 5 })],
    1,
    seen
  )
  assert.deepEqual(
    first.map((e) => e.tokenId),
    ['5', '7']
  )
  assert.equal(first[0]!.collection, NFT)
  assert.equal(first[0]!.key, mintKey(TX, 3))
  // The next poll overlaps the same block: nothing new.
  assert.equal(toMintEvents([log({ tokenId: 5n, li: 3 }), log({ tokenId: 7n, li: 5 })], 1, seen).length, 0)
  // Same tx, new log index: new mint.
  assert.equal(toMintEvents([log({ tokenId: 8n, li: 6 })], 1, seen).length, 1)
})

test('mint events come out in chain order and skip pending/malformed logs', () => {
  const seen = createSeenSet()
  const out = toMintEvents(
    [
      log({ tokenId: 2n, block: 101n, li: 0, tx: '0x02' }),
      log({ tokenId: 1n, block: 100n, li: 9, tx: '0x01' }),
      { ...log({ tokenId: 3n }), transactionHash: null },
      { ...log({ tokenId: 4n }), logIndex: null },
    ],
    1,
    seen
  )
  assert.deepEqual(
    out.map((e) => e.tokenId),
    ['1', '2']
  )
})

test('seen set is bounded and evicts the oldest key', () => {
  const seen = createSeenSet(2)
  assert.equal(seen.add('a'), true)
  assert.equal(seen.add('a'), false)
  seen.add('b')
  seen.add('c')
  assert.equal(seen.size, 2)
  assert.equal(seen.has('a'), false)
  assert.equal(seen.has('c'), true)
})

test('poll range: first poll looks back maxSpan blocks, later polls overlap the cursor, gaps are capped', () => {
  assert.deepEqual(nextRange(undefined, 1000n, { maxSpan: 20n }), { fromBlock: 981n, toBlock: 1000n })
  assert.deepEqual(nextRange(1000n, 1003n, { maxSpan: 20n, overlap: 2n }), { fromBlock: 999n, toBlock: 1003n })
  // Tab was asleep for an hour: don't ask the RPC for 300 blocks.
  assert.deepEqual(nextRange(1000n, 1300n, { maxSpan: 20n }), { fromBlock: 1281n, toBlock: 1300n })
  assert.equal(nextRange(undefined, 0n), undefined)
  // A lagging RPC: nothing to ask for, so the cursor never moves back and fromBlock never passes toBlock.
  assert.equal(nextRange(1000n, 995n, { maxSpan: 20n, overlap: 2n }), undefined)
  assert.deepEqual(nextRange(1000n, 1000n, { maxSpan: 20n, overlap: 2n }), { fromBlock: 999n, toBlock: 1000n })
})

/* ---------- pet state machine ---------- */

const env = { width: 1000, spriteW: 60, reducedMotion: false }
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]!
}

test('pet walks, turns at the edge and stays inside the strip', () => {
  let s: PetState = { ...initialPet(env, seq(0.5)), mode: 'walk', x: 935, facing: 1, until: 60_000 }
  for (let i = 0; i < 200; i++) s = stepPet(s, 16, env, seq(0.9))
  assert.ok(s.x <= env.width - env.spriteW)
  assert.equal(s.facing, -1)
})

test('pet hop goes up then lands back on the ground in idle', () => {
  let s = petEvent(initialPet(env, seq(0.5)), { type: 'click' }, env)
  assert.equal(s.mode, 'hop')
  let peak = 0
  for (let i = 0; i < 120 && s.mode === 'hop'; i++) {
    s = stepPet(s, 16, env, seq(0.5))
    peak = Math.max(peak, s.y)
  }
  assert.ok(peak > 20, `peak ${peak}`)
  assert.equal(s.mode, 'idle')
  assert.equal(s.y, 0)
})

test('dropping the pet from the air makes it fall and bounce before settling', () => {
  let s = petEvent(initialPet(env, seq(0.5)), { type: 'dragStart' }, env)
  s = petEvent(s, { type: 'dragMove', x: 5000, y: 300 }, env)
  assert.equal(s.x, env.width - env.spriteW) // clamped
  s = petEvent(s, { type: 'dragEnd' }, env)
  assert.equal(s.mode, 'fall')
  let bounced = false
  let prevVy = s.vy
  for (let i = 0; i < 400 && s.mode === 'fall'; i++) {
    s = stepPet(s, 16, env, seq(0.5))
    if (prevVy < 0 && s.vy > 0) bounced = true
    prevVy = s.vy
  }
  assert.ok(bounced)
  assert.equal(s.mode, 'idle')
  assert.equal(s.y, 0)
})

test('reduced motion: no walking, no hop physics, drops land instantly', () => {
  const still = { ...env, reducedMotion: true }
  let s = initialPet(still, seq(0.5))
  for (let i = 0; i < 2000; i++) s = stepPet(s, 50, still, seq(0.1))
  assert.notEqual(s.mode, 'walk')
  s = petEvent({ ...s, mode: 'idle' }, { type: 'click' }, still)
  assert.notEqual(s.mode, 'hop')
  s = petEvent(petEvent(petEvent(s, { type: 'dragStart' }, still), { type: 'dragMove', x: 10, y: 200 }, still), { type: 'dragEnd' }, still)
  assert.equal(s.mode, 'idle')
  assert.equal(s.y, 0)
})

test('a bored pet falls asleep and the cursor wakes it, facing the cursor', () => {
  let s: PetState = { ...initialPet(env, seq(0.5)), mode: 'idle', until: Infinity, x: 500 }
  for (let t = 0; t <= PET_PHYSICS.sleepAfter + 100; t += 100) s = stepPet(s, 100, env, seq(0.5))
  assert.equal(s.mode, 'sleep')
  s = petEvent(s, { type: 'cursor', x: 10 }, env)
  assert.equal(s.mode, 'idle')
  assert.equal(s.facing, -1)
})

/* ---------- screensaver idle gate ---------- */

test('screensaver starts after the delay and never while blocked or disabled', () => {
  const base = { now: 200_000, lastActivity: 0, delayMs: 180_000, enabled: true, blocked: false }
  assert.equal(shouldStartScreensaver(base), true)
  assert.equal(shouldStartScreensaver({ ...base, now: 179_999 }), false)
  assert.equal(idleRemaining({ ...base, now: 170_000 }), 10_000)
  assert.equal(shouldStartScreensaver({ ...base, blocked: true }), false)
  assert.equal(shouldStartScreensaver({ ...base, enabled: false }), false)
  assert.equal(clampDelayMinutes('nope'), 3)
  assert.equal(clampDelayMinutes(0.01), 0.25)
  assert.equal(clampDelayMinutes(10), 10)
})

test('text fields block the screensaver, buttons and checkboxes do not', () => {
  assert.equal(isTextEntry({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(isTextEntry({ tagName: 'input' }), true)
  assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTextEntry({ tagName: 'INPUT', type: 'checkbox' }), false)
  assert.equal(isTextEntry({ tagName: 'BUTTON' }), false)
  assert.equal(isTextEntry(null), false)
  assert.equal(movedEnough({ x: 0, y: 0 }, { x: 3, y: 4 }), false)
  assert.equal(movedEnough({ x: 0, y: 0 }, { x: 30, y: 4 }), true)
})

/* ---------- wallet files: sanitizing + indexer fallbacks ---------- */

const gateway = (u: string) => (u.startsWith('ipfs://') ? `https://gw.example/ipfs/${u.slice(7)}` : u)

test('metadata is sanitized: only http(s)/data:image images, http(s) links, plain capped text', () => {
  const m = sanitizeMetadata(
    {
      name: '  <img src=x onerror=alert(1)>‮  ',
      description: 'x'.repeat(1000),
      image: 'ipfs://bafy/1.png',
      external_url: 'javascript:alert(1)',
    },
    gateway
  )
  assert.equal(m.name, '<img src=x onerror=alert(1)>') // stays text; React escapes it
  assert.equal(m.description.length, 600)
  assert.equal(m.image, 'https://gw.example/ipfs/bafy/1.png')
  assert.equal(m.externalUrl, '')
  assert.equal(safeImageUrl('javascript:alert(1)'), '')
  assert.equal(safeImageUrl('data:text/html,<script>'), '')
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(safeImageUrl('vbscript:x'), '')
  assert.equal(safeLinkUrl('https://etherscan.io/x'), 'https://etherscan.io/x')
  assert.equal(safeLinkUrl('ftp://x'), '')
  assert.equal(cleanText({ toString: () => 'x' }), '')
  assert.deepEqual(decodeDataJson('data:application/json;base64,' + btoa('{"name":"a"}')), { name: 'a' })
  assert.equal(decodeDataJson('data:application/json;base64,!!!'), undefined)
})

test('alchemy v3 response parsing skips junk and prefers cached images', () => {
  const { nfts, pageKey } = parseAlchemyOwnedNfts(
    {
      ownedNfts: [
        {
          contract: { address: NFT, name: 'miyamaker mini' },
          tokenId: '12',
          tokenType: 'ERC721',
          name: 'Miya #12',
          image: { cachedUrl: 'https://cdn.example/12.png' },
          raw: { metadata: { image: 'ipfs://bafy/12.png', external_url: 'https://miya.wtf' } },
        },
        { contract: { address: 'not-an-address' }, tokenId: '1' },
        { contract: { address: NFT }, tokenId: '0x1f' },
        { contract: { address: OTHER }, tokenId: '3', tokenType: 'ERC20' },
        null,
        { contract: { address: OTHER }, tokenId: '4', raw: { metadata: { image: 'javascript:alert(1)' } } },
      ],
      pageKey: 'next',
    },
    1,
    { sanitize: sanitizeMetadata, cleanText, resolve: gateway }
  )
  assert.equal(pageKey, 'next')
  assert.equal(nfts.length, 2)
  assert.equal(nfts[0]!.image, 'https://cdn.example/12.png')
  assert.equal(nfts[0]!.externalUrl, 'https://miya.wtf/')
  assert.equal(nfts[0]!.contract, NFT)
  assert.equal(nfts[1]!.image, '')
  assert.equal(nfts[1]!.name, '#4')
})

test('transfer-log replay keeps what the owner still holds', () => {
  const held = heldFromTransfers(
    [
      { from: OTHER, to: ME, tokenId: 9n, blockNumber: 3n, logIndex: 0 },
      { from: ZERO_ADDRESS, to: ME, tokenId: 2n, blockNumber: 1n, logIndex: 0 },
      { from: ME, to: OTHER, tokenId: 2n, blockNumber: 2n, logIndex: 0 },
      { from: ZERO_ADDRESS, to: ME.toUpperCase().replace('0X', '0x'), tokenId: 10n, blockNumber: 1n, logIndex: 1 },
    ],
    ME
  )
  assert.deepEqual(held, ['9', '10'])
})

test('ownerOf sweep keeps successful matches only', () => {
  assert.deepEqual(
    heldFromOwnerSweep(
      [1n, 2n, 3n],
      [
        { status: 'success', result: ME.toUpperCase().replace('0X', '0x') },
        { status: 'failure' },
        { status: 'success', result: OTHER },
      ],
      ME
    ),
    ['1']
  )
})

test('log scan chunks are bounded and report partial scans', () => {
  const full = logChunks(0n, 99n, 50n, 10)
  assert.deepEqual(full.chunks, [
    { fromBlock: 50n, toBlock: 99n },
    { fromBlock: 0n, toBlock: 49n },
  ])
  assert.equal(full.partial, false)
  const capped = logChunks(0n, 999n, 50n, 3)
  assert.equal(capped.chunks.length, 3)
  assert.equal(capped.partial, true)
})

test('nfts group into collection folders sorted by numeric token id', () => {
  const mk = (contract: string, collectionName: string, tokenId: string) => ({
    chainId: 1,
    contract,
    collectionName,
    tokenId,
    name: '',
    description: '',
    image: '',
    externalUrl: '',
  })
  const folders = groupByCollection([mk(NFT, 'mini', '10'), mk(OTHER, 'Aaa', '1'), mk(NFT, 'mini', '9')])
  assert.deepEqual(
    folders.map((f) => f.name),
    ['Aaa', 'mini']
  )
  assert.deepEqual(
    folders[1]!.items.map((i) => i.tokenId),
    ['9', '10']
  )
})

test('the screensaver waits while any one thing is still playing', () => {
  assert.equal(anythingPlaying(), false)
  setPlaying('radio', true)
  setPlaying('tv-youtube', true)
  setPlaying('radio', false)
  assert.equal(anythingPlaying(), true)
  setPlaying('tv-youtube', false)
  assert.equal(anythingPlaying(), false)
})

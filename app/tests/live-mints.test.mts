// src/pages/Mint/liveMints.ts: the Mint home page's card list. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LiveMintEntry } from '../src/pages/Mint/liveMints.ts'
import {
  activePublicPhase,
  buildLiveMintList,
  entryKey,
  formatEthShort,
  LIVE_MINTS,
  mintableNow,
  mintPath,
  registryEntry,
  shelfOf,
  slugFromPath,
  slugify,
  toCard,
} from '../src/pages/Mint/liveMints.ts'

const ETH = '0x0000000000000000000000000000000000000000' as const

const A = '0x1111111111111111111111111111111111111111' as const
const B = '0x2222222222222222222222222222222222222222' as const
const MIYAMINI = LIVE_MINTS[0]!

test('curated list: the Miyamaker drop first, then MIYAMINI, both credited to koolskull.eth', () => {
  const cards = buildLiveMintList(LIVE_MINTS, {})
  assert.deepEqual(cards.slice(0, 2).map((c) => c.slug), ['miyamaker', 'miyamini'])
  for (const c of cards.slice(0, 2)) {
    assert.equal(c.artist, 'koolskull.eth')
    assert.ok(c.artistLogo)
  }
  assert.equal(cards.find((c) => c.slug === 'miyakakis'), undefined)
})

test('shelves: curated drops are Miyamaker, anything from the registry is Community', () => {
  const cards = buildLiveMintList(LIVE_MINTS, {}, [{ entry: registryEntry(1, A, 'Neon Cats'), reads: { mintOpen: true } }])
  assert.deepEqual(
    cards.map((c) => [c.slug, shelfOf(c)]),
    [
      ['miyamaker', 'official'],
      ['miyamini', 'official'],
      ['neon-cats', 'community'],
    ]
  )
  // A registry copy of a curated address stays official (curated wins the dedupe).
  const dup = buildLiveMintList(LIVE_MINTS, {}, [{ entry: registryEntry(1, LIVE_MINTS[0]!.address!, 'Copy') }])
  assert.equal(dup.filter((c) => shelfOf(c) === 'community').length, 0)
})

test('a registry drop credits its owner', () => {
  const owner = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
  const entry = { slug: 'x', name: 'X', kind: 'drop', chainId: 1, address: owner } as const
  const key = entryKey(entry)
  const [card] = buildLiveMintList([entry], { [key]: { owner } })
  assert.equal(card!.artistAddress, owner)
})

test('toCard: status from reads', () => {
  const e: LiveMintEntry = { slug: 'x', name: 'X', kind: 'erc721m', chainId: 1, address: A }
  assert.equal(toCard(e, { mintOpen: true, totalSupply: 1, maxSupply: 10 }, 'curated').status, 'open')
  assert.equal(toCard(e, { mintOpen: false }, 'curated').status, 'closed')
  assert.equal(toCard(e, { mintOpen: true, totalSupply: 10, maxSupply: 10 }, 'curated').status, 'soldout')
  assert.equal(toCard(e, undefined, 'curated').status, 'unknown')
  assert.equal(toCard({ ...e, address: undefined }, { mintOpen: true }, 'curated').status, 'soon')
  // zero address and malformed addresses are treated as unknown contracts
  assert.equal(toCard({ ...e, address: `0x${'0'.repeat(40)}` }, undefined, 'curated').status, 'soon')
  assert.equal(toCard({ ...e, address: '0x123' as `0x${string}` }, undefined, 'curated').clickable, false)
})

test('toCard: progress is clamped and undefined without supply', () => {
  const e: LiveMintEntry = { slug: 'x', name: 'X', kind: 'erc721m', chainId: 1, address: A }
  assert.equal(toCard(e, { totalSupply: 165, maxSupply: 1024 }, 'curated').progress, 165 / 1024)
  assert.equal(toCard(e, { totalSupply: 5 }, 'curated').progress, undefined)
  assert.equal(toCard(e, { totalSupply: 5, maxSupply: 0 }, 'curated').progress, undefined)
  assert.equal(toCard(e, { totalSupply: Number.NaN, maxSupply: 3 }, 'curated').minted, undefined)
})

test('toCard: name and image fall back to chain reads, overrides win', () => {
  const e: LiveMintEntry = { slug: 'x', name: '', kind: 'drop', chainId: 1, address: A }
  const c = toCard(e, { name: 'From chain', image: 'ipfs://cid/1.png' }, 'registry')
  assert.equal(c.name, 'From chain')
  assert.equal(c.image, 'ipfs://cid/1.png')
  assert.equal(
    toCard({ ...e, name: 'Curated', image: 'https://x/y.png' }, { name: 'From chain', image: 'z' }, 'curated').image,
    'https://x/y.png'
  )
})

test('buildLiveMintList: dedupes by chain+address (curated wins) and orders by pin, status, discovery', () => {
  const curated: LiveMintEntry[] = [
    { slug: 'pinned', name: 'Pinned', kind: 'erc721m', chainId: 1, address: A, pin: 0 },
    { slug: 'soon', name: 'Soon', kind: 'erc721m', chainId: 1, pin: -1 },
  ]
  const reads = { [entryKey(curated[0]!)]: { mintOpen: false } }
  const cards = buildLiveMintList(curated, reads, [
    { entry: registryEntry(1, A.toUpperCase().replace('0X', '0x') as `0x${string}`, 'Dup'), reads: { mintOpen: true } },
    { entry: registryEntry(1, B, 'Closed drop'), reads: { mintOpen: false } },
    { entry: registryEntry(1, '0x3333333333333333333333333333333333333333', 'Open drop'), reads: { mintOpen: true } },
    { entry: registryEntry(8453, A, 'Same address other chain'), reads: { mintOpen: true } },
  ])
  assert.deepEqual(
    cards.map((c) => c.name),
    ['Pinned', 'Open drop', 'Same address other chain', 'Closed drop', 'Soon']
  )
  assert.equal(cards[0]!.status, 'closed', 'curated reads are used for the deduped card')
  assert.equal(cards.find((c) => c.name === 'Open drop')!.source, 'registry')
})

test('buildLiveMintList: slugs are unique', () => {
  const cards = buildLiveMintList([], {}, [
    { entry: registryEntry(1, A, 'Same Name') },
    { entry: registryEntry(1, B, 'Same Name') },
  ])
  assert.deepEqual(
    cards.map((c) => c.slug),
    ['same-name', 'same-name-2']
  )
})

test('slugify', () => {
  assert.equal(slugify('Miya Auction Q1 ’24'), 'miya-auction-q1-24')
  assert.equal(slugify('  ---  '), 'collection')
  assert.equal(slugify('Café Ünïcode'), 'cafe-unicode')
})

test('paths: mintPath / slugFromPath round trip', () => {
  assert.equal(mintPath(), '/mint')
  assert.equal(mintPath('miyamini'), '/mint/miyamini')
  assert.equal(slugFromPath('/mint/miyamini'), 'miyamini')
  assert.equal(slugFromPath('/mint/MIYAMINI/'), 'miyamini')
  assert.equal(slugFromPath('/mint'), undefined)
  assert.equal(slugFromPath('/mint/a/b'), undefined)
  assert.equal(slugFromPath('/swap'), undefined)
})

test('activePublicPhase: skips a phase that sold its cap and reports what is left', () => {
  const zero = `0x${'0'.repeat(64)}`
  const phases = [
    { start: 0n, end: 0n, maxPerWallet: 0, merkleRoot: zero, supplyCap: 5, prices: [{ token: ETH, price: 1n }] },
    { start: 0n, end: 0n, maxPerWallet: 0, merkleRoot: zero, supplyCap: 0, prices: [{ token: ETH, price: 2n }] },
  ]
  assert.deepEqual(activePublicPhase(phases, 1, [3n, 0n]), { phaseId: 0, price: 1n, prices: [{ token: ETH, price: 1n }], maxPerWallet: 0, left: 2 })
  assert.equal(activePublicPhase(phases, 1, [5n, 0n])?.phaseId, 1)
  assert.equal(activePublicPhase(phases, 1, [5n, 0n])?.left, undefined)
  // A phase that sells only for USDC has no ETH price, and says what it does sell for.
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
  const usdcOnly = [{ start: 0n, end: 0n, maxPerWallet: 0, merkleRoot: zero, supplyCap: 0, prices: [{ token: usdc, price: 25_000_000n }] }]
  assert.deepEqual(activePublicPhase(usdcOnly, 1), {
    phaseId: 0,
    price: undefined,
    prices: [{ token: usdc, price: 25_000_000n }],
    maxPerWallet: 0,
    left: undefined,
  })
})

test('activePublicPhase: picks the first live public phase', () => {
  const zero = `0x${'0'.repeat(64)}`
  const root = `0x${'a'.repeat(64)}`
  const phases = [
    { start: 0n, end: 100n, maxPerWallet: 0, merkleRoot: zero, supplyCap: 0, prices: [{ token: ETH, price: 1n }] }, // ended
    { start: 100n, end: 0n, maxPerWallet: 0, merkleRoot: root, supplyCap: 0, prices: [{ token: ETH, price: 2n }] }, // allowlist
    { start: 150n, end: 0n, maxPerWallet: 2, merkleRoot: zero, supplyCap: 0, prices: [{ token: ETH, price: 3n }] }, // public, open-ended
  ]
  assert.equal(activePublicPhase(phases, 50)?.phaseId, 0)
  assert.equal(activePublicPhase(phases, 120), undefined)
  assert.deepEqual(activePublicPhase(phases, 200), { phaseId: 2, price: 3n, prices: [{ token: ETH, price: 3n }], maxPerWallet: 2, left: undefined })
  assert.equal(activePublicPhase(undefined, 1), undefined)
  assert.equal(activePublicPhase([], 1), undefined)
})

test('formatEthShort', () => {
  assert.equal(formatEthShort(444400000000000000n), '0.4444 ETH')
  assert.equal(formatEthShort(10n ** 18n), '1 ETH')
  assert.equal(formatEthShort(123456789000000000n), '0.1234 ETH')
  assert.equal(formatEthShort(0n), 'Free')
  assert.equal(formatEthShort(1n), '<0.0001 ETH')
  assert.equal(formatEthShort(undefined), '…')
})

test('mintableNow: the smallest of the transaction, sale and wallet limits', () => {
  assert.equal(mintableNow({ maxPerTx: 10 }), 10)
  assert.equal(mintableNow({ maxPerTx: 10, left: 3 }), 3)
  assert.equal(mintableNow({ maxPerTx: 10, left: 8, maxPerWallet: 5, walletMinted: 3 }), 2)
  assert.equal(mintableNow({ maxPerTx: 10, maxPerWallet: 2, walletMinted: 2 }), 0)
  assert.equal(mintableNow({ maxPerTx: 10, maxPerWallet: 2, walletMinted: 9 }), 0)
  assert.equal(mintableNow({ maxPerTx: 10, maxPerWallet: 0, walletMinted: 9 }), 10)
  assert.equal(mintableNow({ maxPerTx: 10, left: 0 }), 0)
})

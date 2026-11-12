// Trade terminal viewer data: traits, trait counts, the gallery (src/pages/Swap/nft/markets.ts) and metadata attributes
// (src/desktop/files/sanitize.ts). Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanAttributes } from '../src/desktop/files/sanitize.ts'
import { parseCollectionNfts, parseNft, parseTraitCounts, traitShare } from '../src/pages/Swap/nft/markets.ts'

test('an NFT carries its traits and rarity rank; junk traits are dropped', () => {
  const n = parseNft({
    nft: {
      name: 'Miyamaker #7',
      traits: [
        { trait_type: 'Hair', value: 'Pink' },
        { trait_type: 'Level', value: 3, display_type: 'number' },
        { trait_type: '', value: 'x' },
        'nonsense',
        { trait_type: 'Eyes\u0000', value: 'Star' },
      ],
      rarity: { rank: 42 },
    },
  })!
  assert.deepEqual(n.traits, [
    { trait: 'Hair', value: 'Pink' },
    { trait: 'Level', value: '3' },
    { trait: 'Eyes', value: 'Star' },
  ])
  assert.equal(n.rank, 42)
  assert.equal(parseNft({ nft: {} })!.rank, undefined)
})

test('trait counts: shares by any casing, unknown when counts or size are missing', () => {
  const counts = parseTraitCounts({ counts: { Hair: { Pink: 25, Blue: 75 }, Eyes: { Star: 'many' } } })
  assert.equal(traitShare(counts, { trait: 'hair', value: 'PINK' }, 100), 0.25)
  assert.equal(traitShare(counts, { trait: 'Eyes', value: 'Star' }, 100), undefined)
  assert.equal(traitShare(counts, { trait: 'Hair', value: 'Pink' }, undefined), undefined)
  assert.equal(traitShare(undefined, { trait: 'Hair', value: 'Pink' }, 100), undefined)
  assert.deepEqual(parseTraitCounts(null), {})
})

test('gallery page: numbered NFTs only, and the cursor for the next page', () => {
  const p = parseCollectionNfts({
    nfts: [
      { identifier: '1', name: 'One', display_image_url: 'https://x/1.png' },
      { identifier: 'abc' },
      { identifier: '2', image_url: 'https://x/2.png' },
    ],
    next: 'cursor1',
  })
  assert.deepEqual(
    p.items.map((i) => [i.tokenId, i.image]),
    [
      ['1', 'https://x/1.png'],
      ['2', 'https://x/2.png'],
    ]
  )
  assert.equal(p.next, 'cursor1')
  assert.equal(parseCollectionNfts({ nfts: [] }).next, undefined)
})

test('metadata attributes: plain pairs, capped, anything odd dropped', () => {
  assert.deepEqual(
    cleanAttributes([{ trait_type: 'Hat', value: 'Crown' }, { value: 'no trait' }, null, { trait_type: 'Size', value: 9 }]),
    [
      { trait: 'Hat', value: 'Crown' },
      { trait: 'Size', value: '9' },
    ]
  )
  assert.equal(cleanAttributes(Array.from({ length: 99 }, (_, i) => ({ trait_type: `t${i}`, value: 'v' }))).length, 40)
  assert.deepEqual(cleanAttributes('nope'), [])
})

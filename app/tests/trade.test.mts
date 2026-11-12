// Trade window pure logic: src/pages/Swap/tradePath.ts (paths, /swap → /trade) and src/pages/Swap/nft/pool.ts
// (MiyaPool maths, id parsing, deposit plans, random-redeem commits). Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  blocksToReveal,
  commitPhase,
  depositPlan,
  directSendOnly,
  filterPools,
  KIND,
  MODE,
  parseTokenIds,
  pendingFor,
  POOL_UNIT,
  poolIndexes,
  poolTitle,
  redeemCost,
  unitsText,
  wholeUnits,
  revealWords,
} from '../src/pages/Swap/nft/pool.ts'
import { canonicalPath, parseTradePath, tabPath, tradePath } from '../src/pages/Swap/tradePath.ts'

const POOL = '0x1111111111111111111111111111111111111111'
const ME = '0xAbCdEf0000000000000000000000000000000001'

test('old /swap links move to /trade, keeping the rest of the path and query', () => {
  assert.equal(canonicalPath('/swap'), '/trade')
  assert.equal(canonicalPath('/swap/'), '/trade/')
  assert.equal(canonicalPath('/swap/nfts?x=1'), '/trade/nfts?x=1')
  assert.equal(canonicalPath('/swap#top'), '/trade#top')
  assert.equal(canonicalPath('/trade'), undefined)
  assert.equal(canonicalPath('/swapper'), undefined)
  assert.equal(canonicalPath('/mint/miyamini'), undefined)
})

test('trade paths round-trip mode and pool', () => {
  assert.deepEqual(parseTradePath('/trade'), { mode: 'tokens' })
  assert.deepEqual(parseTradePath('/trade/nfts'), { mode: 'nfts' })
  assert.deepEqual(parseTradePath(`/trade/nfts/${POOL}`), { mode: 'nfts', pool: POOL, tab: 'pools' })
  assert.deepEqual(parseTradePath('/trade/nfts/not-an-address'), { mode: 'nfts' })
  assert.deepEqual(parseTradePath('/trade/whatever'), { mode: 'tokens' })
  assert.deepEqual(parseTradePath('/mint'), { mode: 'tokens' })
  assert.equal(tradePath('tokens'), '/trade')
  assert.equal(tradePath('nfts'), '/trade/nfts')
  assert.equal(tradePath('nfts', POOL), `/trade/nfts/${POOL}`)
  assert.deepEqual(parseTradePath(tradePath('nfts', POOL)), { mode: 'nfts', pool: POOL, tab: 'pools' })
  // The terminal's own tabs.
  assert.deepEqual(parseTradePath(tabPath('pools')), { mode: 'nfts', tab: 'pools' })
  assert.deepEqual(parseTradePath(tabPath('activity')), { mode: 'nfts', tab: 'activity' })
  assert.deepEqual(parseTradePath('/trade/activity/x'), { mode: 'tokens' })
})

test('1 NFT is 1e18 pool tokens', () => {
  assert.equal(POOL_UNIT, 1_000_000_000_000_000_000n)
  assert.equal(redeemCost(3), 3n * POOL_UNIT)
  assert.equal(wholeUnits(undefined), 0)
  assert.equal(wholeUnits(POOL_UNIT - 1n), 0)
  assert.equal(wholeUnits(POOL_UNIT * 2n + 5n), 2)
  assert.equal(unitsText(undefined), '–')
  assert.equal(unitsText(0n), '0')
  assert.equal(unitsText(POOL_UNIT * 1234n), '1,234')
  assert.equal(unitsText((POOL_UNIT * 5n) / 2n), '2.5')
  assert.equal(unitsText(1n), '0.0001')
})

test('token ids: lists, ranges, # prefixes, dedupe, and plain errors', () => {
  assert.deepEqual(parseTokenIds('').ids, [])
  assert.deepEqual(parseTokenIds('12').ids, [12n])
  assert.deepEqual(parseTokenIds('#1, 2 3,,2').ids, [1n, 2n, 3n])
  assert.deepEqual(parseTokenIds('4-7').ids, [4n, 5n, 6n, 7n])
  assert.match(parseTokenIds('7-4').error!, /backwards/)
  assert.match(parseTokenIds('1-100000').error!, /too many/)
  assert.match(parseTokenIds('abc').error!, /not a token number/)
  assert.equal(parseTokenIds('0-49').ids.length, 50)
  assert.match(parseTokenIds('0-49 50').error!, /more than 50/)
})

test('deposit plan: direct transfers skip approvals; several ERC-721s need the pool approved once', () => {
  assert.equal(depositPlan(KIND.ERC1155, 5, false), 'transfer-1155')
  assert.equal(depositPlan(KIND.ERC721, 1, false), 'transfer-721')
  assert.equal(depositPlan(KIND.ERC721, 2, false), 'approve')
  assert.equal(depositPlan(KIND.ERC721, 2, true), 'deposit')
  // Robinhood collections refuse approved operators: never ask for an approval that cannot work.
  assert.equal(depositPlan(KIND.ERC721, 2, false, true), 'transfer-721-each')
  assert.equal(depositPlan(KIND.ERC721, 2, true, true), 'transfer-721-each')
  assert.equal(depositPlan(KIND.ERC721, 1, false, true), 'transfer-721')
  assert.equal(depositPlan(KIND.ERC1155, 2, false, true), 'transfer-1155')
  assert.equal(depositPlan(KIND.ERC721, 2, undefined), 'approve')
  assert.equal(depositPlan(KIND.ERC721, 2, true), 'deposit')
})

test('random redeems: my open commits, and when each can be revealed', () => {
  const rows = [
    { id: 3n, recipient: ME.toLowerCase(), targetBlock: 100n, amount: 1 },
    undefined,
    { id: 1n, recipient: ME, targetBlock: 90n, amount: 2 },
    { id: 2n, recipient: POOL, targetBlock: 95n, amount: 1 },
    { id: 0n, recipient: ME, targetBlock: 80n, amount: 0 }, // revealed (deleted)
  ]
  assert.deepEqual(
    pendingFor(rows, ME).map((r) => r.id),
    [1n, 3n],
  )
  assert.deepEqual(pendingFor(rows, undefined), [])

  assert.equal(commitPhase(100n, undefined), 'waiting')
  assert.equal(commitPhase(100n, 100n), 'waiting')
  assert.equal(commitPhase(100n, 101n), 'ready')
  assert.equal(commitPhase(100n, 356n), 'ready')
  assert.equal(commitPhase(100n, 357n), 'late')
  assert.equal(blocksToReveal(100n, 99n), 2)
  assert.equal(blocksToReveal(100n, 100n), 1)
  assert.equal(blocksToReveal(100n, 101n), 0)
})

test('pool list: newest first, filtered by name, ticker or address', () => {
  assert.deepEqual(poolIndexes(5, 3), [4, 3, 2])
  assert.deepEqual(poolIndexes(2, 10), [1, 0])
  assert.deepEqual(poolIndexes(0, 10), [])
  const pools = [
    {
      address: POOL,
      collection: '0x2222222222222222222222222222222222222222',
      kind: KIND.ERC721,
      mode: MODE.TARGETED,
      symbol: 'mMIL',
      name: 'miya pool: Milady',
      collectionName: 'Milady',
      held: 3n,
    },
    {
      address: '0x3333333333333333333333333333333333333333',
      collection: '0x4444444444444444444444444444444444444444',
      kind: KIND.ERC1155,
      mode: MODE.RANDOM,
      symbol: 'mSONG',
      name: 'miya pool: Song',
      held: 1n,
    },
  ]
  assert.equal(filterPools(pools, '').length, 2)
  assert.deepEqual(
    filterPools(pools, 'milady').map((p) => p.symbol),
    ['mMIL'],
  )
  assert.deepEqual(
    filterPools(pools, 'msong').map((p) => p.symbol),
    ['mSONG'],
  )
  assert.deepEqual(
    filterPools(pools, '0x4444').map((p) => p.symbol),
    ['mSONG'],
  )
  assert.equal(poolTitle(pools[0]!), 'Milady')
  assert.equal(poolTitle(pools[1]!), 'Song')
  assert.equal(poolTitle({ name: '', collection: pools[1]!.collection }), '0x4444…4444')
})

test('revealWords: says when the pool is holding an NFT', () => {
  assert.equal(revealWords([1n]), 'You got #1. It is in your wallet.')
  assert.match(revealWords([1n], [1n]), /^The collection refused to send #1/)
  const mixed = revealWords([1n, 2n], [2n])
  assert.match(mixed, /^You got #1, now in your wallet/)
  assert.match(mixed, /refused to send #2/)
})

test('Robinhood Chain sells by direct send', () => {
  assert.equal(directSendOnly(4663), true)
  assert.equal(directSendOnly(1), false)
})

test('token pages have their own paths, and Sepolia links are gone', () => {
  const A = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921'
  assert.equal(tradePath('tokens', undefined, undefined, { chainId: 1, address: A }), `/trade/tokens/1/${A}`)
  assert.deepEqual(parseTradePath(`/trade/tokens/4663/${A}`), { mode: 'tokens', token: { chainId: 4663, address: A } })
  assert.deepEqual(parseTradePath('/trade/tokens/1/nope'), { mode: 'tokens' })
  assert.deepEqual(parseTradePath(`/trade/tokens/11155111/${A}`), { mode: 'tokens' })
  assert.deepEqual(parseTradePath(`/trade/nfts/collection/11155111/${A}`), { mode: 'nfts' })
})

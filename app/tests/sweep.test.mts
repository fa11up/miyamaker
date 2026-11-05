// Sweep: src/pages/Swap/nft/sweep.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWalletRefusal, MAX_SWEEP, pickCheapest, sumPrices, sweepable, sweepTotals } from '../src/pages/Swap/nft/sweep.ts'

const l = (tokenId: string | undefined, amount: bigint, extra = {}) => ({
  hash: `h${tokenId}`,
  tokenId,
  remaining: 1,
  price: { amount, symbol: 'ETH' },
  ...extra,
})

test('sweepable: ETH only, known single NFTs, no duplicates, cheapest first', () => {
  const got = sweepable([
    l('3', 30n),
    l('1', 10n),
    l('2', 20n, { price: { amount: 5n, symbol: 'WETH' } }), // a token price needs its own approval
    l(undefined, 1n),
    l('4', 2n, { remaining: 0 }),
    l('1', 40n), // same NFT again
  ])
  assert.deepEqual(got.map((x) => x.tokenId), ['1', '3'])
})

test('sweepable: never your own listing, whatever the address case', () => {
  const me = '0xAbC0000000000000000000000000000000000001'
  const got = sweepable([l('1', 1n, { maker: me.toLowerCase() }), l('2', 2n, { maker: '0xdef' })], me)
  assert.deepEqual(got.map((x) => x.tokenId), ['2'])
})

test('pickCheapest never passes the cap', () => {
  const many = Array.from({ length: 20 }, (_, i) => i)
  assert.equal(pickCheapest(many, 50).length, MAX_SWEEP)
  assert.deepEqual(pickCheapest(many, 2), [0, 1])
  assert.deepEqual(pickCheapest(many, -1), [])
  assert.equal(sumPrices([l('1', 5n), l('2', 7n)]), 12n)
})

test('sweepTotals adds the checked plans', () => {
  const t = sweepTotals([
    { total: 100n, lines: [{ label: 'To the seller', amount: 99n }, { label: 'OpenSea fee', amount: 1n }] },
    { total: 50n, lines: [{ label: 'To the seller', amount: 49n }, { label: 'OpenSea fee', amount: 1n }] },
  ])
  assert.equal(t.total, 150n)
  assert.deepEqual(t.lines, [{ label: 'To the seller', amount: 148n }, { label: 'OpenSea fee', amount: 2n }])
})

test('only a refusal in the wallet stops the sweep', () => {
  assert.equal(isWalletRefusal('User rejected the request.'), true)
  assert.equal(isWalletRefusal('MetaMask Tx Signature: User denied transaction signature.'), true)
  assert.equal(isWalletRefusal('execution reverted'), false)
  assert.equal(isWalletRefusal('insufficient funds'), false)
})

// src/music/drop.ts: price/supply/alignment parsing and ERC1155 edition args for music drops. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editionArgs, makeSalt, MUSIC_TOKENS, parseAlignmentPct, parseEdition, parsePriceEth, parseSupply, PRICING_MODEL } from '../src/music/drop.ts'

test('prices are parsed exactly with parseEther (no float rounding) and must be > 0', () => {
  assert.deepEqual(parsePriceEth('0.1'), { ok: true, wei: 100000000000000000n })
  assert.deepEqual(parsePriceEth('.0042'), { ok: true, wei: 4200000000000000n })
  assert.deepEqual(parsePriceEth('0.000000000000000001'), { ok: true, wei: 1n })
  // Number('0.30000000000000001') === 0.3; parseEther keeps every digit.
  assert.deepEqual(parsePriceEth('0.30000000000000001'), { ok: true, wei: 300000000000000010n })
  assert.equal(parsePriceEth('0.1234567890123456789').ok, false, 'more than 18 decimals')
  for (const bad of ['', '0', '0.0', '-1', '1e18', '1,5', 'abc', ' . ']) {
    assert.equal(parsePriceEth(bad).ok, false, bad)
  }
})

test('blank or zero supply is an open edition; a whole number is a limited fixed-price edition', () => {
  assert.deepEqual(parseSupply(''), { ok: true, supply: 0n, model: PRICING_MODEL.UNLIMITED })
  assert.deepEqual(parseSupply('0'), { ok: true, supply: 0n, model: PRICING_MODEL.UNLIMITED })
  assert.deepEqual(parseSupply('100'), { ok: true, supply: 100n, model: PRICING_MODEL.LIMITED_FIXED })
  assert.equal(parseSupply('1.5').ok, false)
  assert.equal(parseSupply('-3').ok, false)
})

test('alignment percent → bps respects the registry minimum and the 100% cap', () => {
  assert.deepEqual(parseAlignmentPct('10', 1000), { ok: true, bps: 1000 })
  assert.deepEqual(parseAlignmentPct('12.5', 1000), { ok: true, bps: 1250 })
  assert.equal(parseAlignmentPct('9.99', 1000).ok, false)
  assert.equal(parseAlignmentPct('100', 1000, 100).ok, false)
  assert.equal(parseAlignmentPct('ten', 1000).ok, false)
})

test('editionArgs matches ERC1155Instance.addEdition(title, TokenPrice[], …) and opens immediately', () => {
  const eth = '0x0000000000000000000000000000000000000000'
  const args = editionArgs({ title: 'Song', priceWei: 10n, supply: 0n, model: 0, metadataURI: 'ar://m' })
  assert.deepEqual(args, ['Song', [{ token: eth, price: 10n }], 0n, 'ar://m', 0, 0n, 0n])
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const two = editionArgs({
    title: 'Song',
    prices: [
      { token: eth, price: 10n },
      { token: usdc, price: 5_000_000n },
    ],
    supply: 5n,
    model: 1,
    metadataURI: 'ar://m',
  })
  assert.deepEqual(two[1], [
    { token: eth, price: 10n },
    { token: usdc, price: 5_000_000n },
  ])
  assert.deepEqual(MUSIC_TOKENS, [eth], 'Drop Music releases accept ETH')
  const curved = editionArgs({
    title: 'Song',
    priceWei: 10n,
    supply: 100n,
    model: PRICING_MODEL.LIMITED_DYNAMIC,
    metadataURI: 'ar://m',
    priceIncreaseRate: 100n,
  })
  assert.deepEqual(curved, ['Song', [{ token: eth, price: 10n }], 100n, 'ar://m', PRICING_MODEL.LIMITED_DYNAMIC, 100n, 0n])
})

test('a rise percent turns a limited edition into the on-chain curve', () => {
  assert.deepEqual(parseEdition('', ''), { ok: true, supply: 0n, model: PRICING_MODEL.UNLIMITED, rate: 0n })
  assert.deepEqual(parseEdition('50', ''), { ok: true, supply: 50n, model: PRICING_MODEL.LIMITED_FIXED, rate: 0n })
  assert.deepEqual(parseEdition('50', '1'), {
    ok: true,
    supply: 50n,
    model: PRICING_MODEL.LIMITED_DYNAMIC,
    rate: 100n,
  })
  assert.deepEqual(parseEdition('50', '2.5'), {
    ok: true,
    supply: 50n,
    model: PRICING_MODEL.LIMITED_DYNAMIC,
    rate: 250n,
  })
  assert.equal(parseEdition('', '1').ok, false)
  assert.equal(parseEdition('50', '101').ok, false)
})

test('makeSalt is a CreateX permissioned salt: factory ‖ 0x00 ‖ 11 random bytes', () => {
  const factory = '0x00000000000000000000000000000000000000AA'
  const salt = makeSalt(factory, new Uint8Array(11).fill(0xff))
  assert.equal(salt, '0x00000000000000000000000000000000000000aa00ffffffffffffffffffffff')
  assert.equal(salt.length, 66)
  assert.throws(() => makeSalt('0x1234', new Uint8Array(11)))
})

// Trade terminal command line: src/pages/Swap/terminal/command.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanInput, parseCommand, suggest, tabForKey, tickerOf } from '../src/pages/Swap/terminal/command.ts'

const collections = [
  { chainId: 1, slug: 'miyamaker', name: 'Miyamaker', address: '0xb86b68bca287afd48f81d1f792db69368664a120' },
  { chainId: 1, slug: 'milady', name: 'Milady Maker', address: '0x5Af0D9827E0c53E4799BB226655A1de152A425a5' },
  { chainId: 1, slug: 'identitymd', name: 'Identity MD', address: '0x0000ec93127baa929e58e97dd0095a2bfb38ec1d' },
]
const tokens = [
  { chainId: 1, symbol: 'INFER', name: 'Inference Backed', address: '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921' },
  { chainId: 1, symbol: 'IMD', name: 'Identity.md', address: '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7' },
  { chainId: 1, symbol: 'ETH', name: 'Ether', address: '0x0000000000000000000000000000000000000000' },
]
const ctx = { collections, tokens }

test('<GO> and GO are dropped, spaces collapsed', () => {
  assert.equal(cleanInput('  MIYA   <GO> '), 'MIYA')
  assert.equal(cleanInput('miya go'), 'miya')
  assert.equal(cleanInput('buy  3   miya'), 'buy 3 miya')
})

test('tickers, slugs and names open a collection; MIYA is Miyamaker', () => {
  assert.equal(tickerOf(collections[0]!), 'MIYA')
  for (const input of ['MIYA <GO>', 'miya', 'miyamaker', 'Miyamaker']) {
    const c = parseCommand(input, ctx)
    assert.equal(c.kind, 'collection', input)
    assert.equal(c.kind === 'collection' && c.collection.slug, 'miyamaker')
  }
  const idmd = parseCommand('IDMD', ctx)
  assert.equal(idmd.kind === 'collection' && idmd.collection.slug, 'identitymd')
})

test('a token symbol opens the token; IMD is the token, IDMD the collection', () => {
  const t = parseCommand('INFER <GO>', ctx)
  assert.equal(t.kind === 'token' && t.token.symbol, 'INFER')
  const imd = parseCommand('imd', ctx)
  assert.equal(imd.kind === 'token' && imd.token.symbol, 'IMD')
})

test('BUY n TICKER opens the collection asking for n (1 by default, at most 100)', () => {
  const b = parseCommand('BUY 3 MIYA', ctx)
  assert.deepEqual(b.kind === 'collection' && [b.collection.slug, b.buy], ['miyamaker', 3])
  const one = parseCommand('sweep milady', ctx)
  assert.deepEqual(one.kind === 'collection' && [one.collection.slug, one.buy], ['milady', 1])
  const big = parseCommand('buy 999 miya', ctx)
  assert.equal(big.kind === 'collection' && big.buy, 100)
  assert.equal(parseCommand('buy 3 nothing', ctx).kind, 'search')
})

test('function keys and tab names switch tabs; addresses and other words', () => {
  assert.deepEqual(parseCommand('F3', ctx), { kind: 'tab', tab: 'pools' })
  assert.deepEqual(parseCommand('tokens', ctx), { kind: 'tab', tab: 'tokens' })
  assert.deepEqual(parseCommand('NFTS', ctx), { kind: 'tab', tab: 'nft' })
  assert.equal(parseCommand('0x5Af0D9827E0c53E4799BB226655A1de152A425a5', ctx).kind, 'address')
  assert.deepEqual(parseCommand('remilio', ctx), { kind: 'search', query: 'remilio' })
  assert.deepEqual(parseCommand('   ', ctx), { kind: 'none' })
})

test('suggestions: ticker and symbol prefixes first, BUY prefix ignored', () => {
  assert.deepEqual(
    suggest('mi', ctx).map((s) => s.label),
    ['MIYA', 'MILADY']
  )
  assert.equal(suggest('buy 2 mi', ctx)[0]?.label, 'MIYA')
  assert.deepEqual(
    suggest('i', ctx).map((s) => s.label),
    ['IDMD', 'INFER', 'IMD', 'MIYA', 'MILADY']
  )
  assert.deepEqual(suggest('0x5Af0D9827E0c53E4799BB226655A1de152A425a5', ctx), [])
})

test('F1–F5 and Alt+1–5 pick a tab', () => {
  assert.equal(tabForKey({ key: 'F2' }), 'tokens')
  assert.equal(tabForKey({ key: '4', altKey: true }), 'activity')
  assert.equal(tabForKey({ key: '4' }), undefined)
  assert.equal(tabForKey({ key: 'F6' }), undefined)
  // The browser's and the OS's own: hard reload, Alt+F4, AltGr digits.
  assert.equal(tabForKey({ key: 'F5', ctrlKey: true }), undefined)
  assert.equal(tabForKey({ key: 'F5', shiftKey: true }), undefined)
  assert.equal(tabForKey({ key: 'F5', metaKey: true }), undefined)
  assert.equal(tabForKey({ key: 'F4', altKey: true }), undefined)
  assert.equal(tabForKey({ key: '2', altKey: true, ctrlKey: true }), undefined)
})

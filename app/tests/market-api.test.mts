// api/_lib/market.ts paging and per-unit prices, and the account_nfts cursor (api/_lib/opensea.ts). Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fromOpenSea, handleMarketRequest, LISTING_PAGES, memoryCache, mergeListings, readPages } from '../api/_lib/market.ts'
import { openSeaGet } from '../api/_lib/opensea.ts'

const os = (id: string, value: string, offer: Record<string, unknown> = {}) => ({
  order_hash: `0x${id.padStart(64, '0')}`,
  protocol_address: '0x0000000000000068f116a894984e2db1123eb395',
  status: 'ACTIVE',
  price: { current: { currency: 'ETH', value } },
  protocol_data: {
    parameters: {
      offerer: '0xabc',
      endTime: '2000000000',
      offer: [{ itemType: 3, identifierOrCriteria: id, ...offer }],
      consideration: [{ token: '0x0000000000000000000000000000000000000000' }],
    },
  },
})

test('pages are followed to the cap, and capped or broken reads say partial', async () => {
  const pages: Record<string, unknown> = { a: { rows: [2], next: 'b' }, b: { rows: [3], next: 'c' }, c: { rows: [4] } }
  const read = async (next: string) => pages[next]
  assert.deepEqual(await readPages({ rows: [1], next: 'a' }, 'rows', read, 10), { rows: [1, 2, 3, 4], partial: false })
  assert.deepEqual(await readPages({ rows: [1], next: 'a' }, 'rows', read, 2), { rows: [1, 2], partial: true })
  assert.deepEqual(await readPages({ rows: [1] }, 'rows', read, 1), { rows: [1], partial: false })
  const broken = async () => Promise.reject(new Error('OpenSea 500'))
  assert.deepEqual(await readPages({ rows: [1], next: 'a' }, 'rows', broken, 5), { rows: [1], partial: true })
  const loop = async () => ({ rows: [9], next: 'a' })
  assert.equal((await readPages({ rows: [1], next: 'a' }, 'rows', loop, 10)).partial, true, 'a cursor seen twice stops')
  assert.equal((await readPages({ rows: [], next: 'x'.repeat(2000) }, 'rows', read, 5)).partial, false, 'no sane cursor')
})

test('listings follow next up to LISTING_PAGES and are marked partial when more was left', async () => {
  const asked: (string | undefined)[] = []
  const deps = {
    openSea: async (_path: string, q: Record<string, string>) => {
      asked.push(q.next)
      const page = asked.length
      return { listings: [os(String(page), String(page * 100))], next: `p${page}` }
    },
    cache: memoryCache(),
    sameOrigin: () => true,
    clientKey: () => 'ip',
    limiter: () => true,
  }
  const res = await handleMarketRequest(
    { method: 'GET', url: 'https://x.test/api/market/listings?slug=milady', headers: new Headers() },
    deps
  )
  const body = (await res.json()) as any
  assert.equal(asked.length, LISTING_PAGES)
  assert.deepEqual(asked.slice(0, 2), [undefined, 'p1'])
  assert.equal(body.count, LISTING_PAGES)
  assert.equal(body.partial, true)
})

test('sales read every page of the week when there are few, and say complete', async () => {
  let calls = 0
  const res = await handleMarketRequest(
    { method: 'GET', url: 'https://x.test/api/market/sales?slug=milady', headers: new Headers() },
    {
      openSea: async (_p, q) => {
        calls += 1
        return q.next ? { asset_events: [] } : { asset_events: [], next: 'more' }
      },
      cache: memoryCache(),
      sameOrigin: () => true,
      clientKey: () => 'ip',
      limiter: () => true,
    }
  )
  assert.equal(calls, 2)
  assert.equal(((await res.json()) as any).partial, false)
})

test('an order of several ERC-1155s keeps its quantity, and the floor is per unit', () => {
  const five = fromOpenSea(os('1', '5000', { startAmount: '5' }))!
  assert.equal(five.quantity, 5)
  assert.equal(five.unitPrice, '1000')
  assert.equal(five.price, '5000', 'the whole order stays the price, as before')
  const one = fromOpenSea(os('2', '2000'))!
  assert.equal(one.quantity, 1)
  assert.equal(fromOpenSea(os('3', '10', { startAmount: 'nope' }))!.quantity, 1)
  const merged = mergeListings([one, five], 0)
  assert.deepEqual(
    merged.listings.map((l) => l.tokenId),
    ['1', '2'],
    '1 each beats 2 each'
  )
  assert.equal(merged.floor?.unitPrice, '1000')
  assert.equal(merged.floor?.quantity, 5)
})

test('account_nfts takes a sane next cursor, and nothing else', () => {
  const base = { op: 'account_nfts', chain: 'ethereum', address: `0x${'a'.repeat(40)}` }
  const first = openSeaGet(new URLSearchParams(base))
  assert.equal(first.query?.get('next'), null)
  const next = openSeaGet(new URLSearchParams({ ...base, next: 'LXBrPTEyMzQ1Njc4OQ==' }))
  assert.equal(next.query?.get('next'), 'LXBrPTEyMzQ1Njc4OQ==')
  assert.equal(next.query?.get('limit'), '100')
  assert.ok(openSeaGet(new URLSearchParams({ ...base, next: 'a&limit=200' })).error)
  assert.ok(openSeaGet(new URLSearchParams({ ...base, next: 'x'.repeat(513) })).error)
  assert.ok(openSeaGet(new URLSearchParams({ ...base, cursor: 'abc' })).error)
})

// The one market view: api/_lib/market.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  edgeCache,
  fromOpenSea,
  fromOpenSeaSale,
  handleMarketRequest,
  memoryCache,
  mergeListings,
  STALE_LIMIT_MS,
  summarizeSales,
} from '../api/_lib/market.ts'

const os = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  order_hash: `0x${id.padStart(64, '0')}`,
  protocol_address: '0x0000000000000068f116a894984e2db1123eb395',
  status: 'ACTIVE',
  price: { current: { currency: 'ETH', value } },
  protocol_data: {
    parameters: {
      offerer: '0xABC',
      endTime: '2000000000',
      offer: [{ itemType: 2, identifierOrCriteria: id }],
      consideration: [{ token: '0x0000000000000000000000000000000000000000' }],
    },
  },
  ...extra,
})
const row = (tokenId: string, price: string, extra = {}) => ({
  tokenId,
  price,
  currency: 'ETH',
  source: 'opensea' as const,
  hash: `h${tokenId}`,
  protocol: 'p',
  seller: 's',
  expiry: 0,
  ...extra,
})

test('an OpenSea listing becomes a market row; junk does not', () => {
  const r = fromOpenSea(os('42', '690000000000000000'))
  assert.equal(r?.tokenId, '42')
  assert.equal(r?.price, '690000000000000000')
  assert.equal(r?.source, 'opensea')
  assert.equal(r?.seller, '0xabc')
  assert.equal(r?.expiry, 2000000000)
  assert.equal(fromOpenSea(null), undefined)
  assert.equal(fromOpenSea(os('1', '5', { status: 'CANCELLED' })), undefined)
  assert.equal(fromOpenSea(os('1', '0')), undefined)
  assert.equal(fromOpenSea({ order_hash: '0x1', price: { current: { value: '5' } } }), undefined)
})

test('each NFT once at its cheapest, cheapest first, huge prices compared exactly', () => {
  const m = mergeListings(
    [row('1', '900000000000000001'), row('2', '500'), row('1', '900000000000000000'), row('3', '700')],
    1000
  )
  assert.deepEqual(m.listings.map((l) => [l.tokenId, l.price]), [['2', '500'], ['3', '700'], ['1', '900000000000000000']])
  assert.equal(m.count, 3)
  assert.deepEqual(m.sources, { opensea: 3 })
  assert.deepEqual(m.floor, { price: '500', tokenId: '2', source: 'opensea' })
})

test('a token price never undercuts ETH: it cannot be compared, so ETH comes first and sets the floor', () => {
  const m = mergeListings([row('1', '5', { currency: 'USDC' }), row('2', '900'), row('3', '7', { currency: 'USDC' }), row('3', '800')], 1000)
  assert.deepEqual(m.listings.map((l) => [l.tokenId, l.currency]), [['3', 'ETH'], ['2', 'ETH'], ['1', 'USDC']])
  assert.equal(m.floor?.tokenId, '3')
  assert.equal(mergeListings([row('1', '5', { currency: 'USDC' })], 1000).floor, null)
})

test('expired listings are dropped', () => {
  const m = mergeListings([row('1', '5', { expiry: 999 }), row('2', '9', { expiry: 1001 }), row('3', '9', { expiry: 0 })], 1000)
  assert.deepEqual(m.listings.map((l) => l.tokenId), ['2', '3'])
})

test('sales: newest first, and the last day counted in ETH', () => {
  const good = { nft: { identifier: '7' }, payment: { quantity: '100', symbol: 'ETH' }, transaction: '0xt', event_timestamp: 5000, buyer: 'b', seller: 's' }
  assert.equal(fromOpenSeaSale(good)?.tokenId, '7')
  assert.equal(fromOpenSeaSale({ ...good, transaction: undefined }), undefined)
  const now = 200000
  const s = summarizeSales(
    [
      { tokenId: '1', price: '10', currency: 'ETH', at: now - 90000, buyer: '', seller: '', tx: 'old' },
      { tokenId: '2', price: '20', currency: 'WETH', at: now - 10, buyer: '', seller: '', tx: 'new' },
      { tokenId: '3', price: '999', currency: 'USDC', at: now - 20, buyer: '', seller: '', tx: 'usdc' },
    ],
    now
  )
  assert.deepEqual(s.sales.map((x) => x.tx), ['new', 'usdc', 'old'])
  assert.deepEqual(s.day, { count: 2, volume: '20', other: 1 })
})

function setup() {
  let now = 1_800_000_000_000
  let calls = 0
  let down = false
  const deps = {
    openSea: async (path: string, query: Record<string, string>) => {
      calls += 1
      if (down) throw new Error('upstream')
      assert.match(path, /milady/)
      return path.includes('events') ? { asset_events: [], query } : { listings: [os('1', '100'), os('2', '50')] }
    },
    cache: memoryCache(),
    sameOrigin: (h: Headers | undefined) => h?.get('origin') === 'https://www.miyamaker.com',
    clientKey: () => 'ip',
    limiter: () => true,
    now: () => now,
  }
  const get = async (path: string, origin = 'https://www.miyamaker.com') => {
    const r = await handleMarketRequest({ method: 'GET', url: `https://www.miyamaker.com/api/market/${path}`, headers: new Headers({ origin }) }, deps)
    return { status: r.status, body: (await r.json()) as any }
  }
  return { get, calls: () => calls, advance: (ms: number) => (now += ms), setDown: (v: boolean) => (down = v) }
}

test('everyone shares one copy: the source is asked once per 30 seconds', async () => {
  const s = setup()
  const a = await s.get('listings?slug=milady')
  assert.equal(a.status, 200)
  assert.equal(a.body.stale, false)
  assert.equal(a.body.floor.tokenId, '2')
  await s.get('listings?slug=milady')
  assert.equal(s.calls(), 1)
  s.advance(31_000)
  await s.get('listings?slug=milady')
  assert.equal(s.calls(), 2)
})

test('source down: the last good copy, marked stale, then an honest failure once it is too old', async () => {
  const s = setup()
  await s.get('listings?slug=milady')
  s.setDown(true)
  s.advance(60_000)
  const old = await s.get('listings?slug=milady')
  assert.equal(old.status, 200)
  assert.equal(old.body.stale, true)
  assert.equal(old.body.floor.tokenId, '2')
  s.advance(STALE_LIMIT_MS)
  assert.equal((await s.get('listings?slug=milady')).status, 502)
})

test('guards: another site, a bad slug, an unknown route', async () => {
  const s = setup()
  assert.equal((await s.get('listings?slug=milady', 'https://evil.example')).status, 403)
  assert.equal((await s.get('listings?slug=../etc')).status, 400)
  assert.equal((await s.get('other?slug=milady')).status, 404)
  assert.equal(s.calls(), 0)
  assert.equal((await s.get('sales?slug=milady')).status, 200)
})

test('a refused large page falls back to the smaller one', async () => {
  const limits: string[] = []
  const r = await handleMarketRequest(
    { method: 'GET', url: 'https://www.miyamaker.com/api/market/listings?slug=milady', headers: new Headers() },
    {
      openSea: async (_p, q) => {
        limits.push(q.limit!)
        if (q.limit === '100') throw new Error('OpenSea 400')
        return { listings: [os('1', '100')] }
      },
      cache: memoryCache(),
      sameOrigin: () => true,
      clientKey: () => 'ip',
      limiter: () => true,
    }
  )
  assert.equal(r.status, 200)
  assert.deepEqual(limits, ['100', '20'])
  assert.equal(((await r.json()) as any).count, 1)
})

test('sales in other tokens are counted apart, not added to the ETH figure', () => {
  const now = 1_000_000
  const sale = (currency: string, price: string) => ({ tokenId: '1', price, currency, at: now - 60, buyer: '', seller: '', tx: '0x' })
  const s = summarizeSales([sale('ETH', '10'), sale('WETH', '5'), sale('BETH', '700')], now)
  assert.deepEqual(s.day, { count: 3, volume: '15', other: 1 })
})

test('edgeCache keeps an entry for the time asked, 15 minutes when not asked', async () => {
  const written: (string | null)[] = []
  const fake = {
    match: async () => undefined,
    put: async (_r: Request, res: Response) => {
      written.push(res.headers.get('cache-control'))
    },
  } as unknown as Cache
  const cache = edgeCache(fake)
  await cache.put('a', { at: 1, body: 1 })
  await cache.put('b', { at: 1, body: 1 }, 2_592_000)
  assert.deepEqual(written, ['public, max-age=900', 'public, max-age=2592000'])
})

test('memoryCache honours the same time to live', async () => {
  let now = 1000
  const cache = memoryCache(() => now)
  await cache.put('short', { at: 1, body: 's' })
  await cache.put('long', { at: 1, body: 'l' }, 3600)
  now += 15 * 60_000 - 1
  assert.equal((await cache.get('short'))?.body, 's')
  now += 1
  assert.equal(await cache.get('short'), undefined)
  assert.equal((await cache.get('long'))?.body, 'l')
  now += 3600_000
  assert.equal(await cache.get('long'), undefined)
})

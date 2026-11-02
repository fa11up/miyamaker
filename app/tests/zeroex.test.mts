// api/_lib/zeroex.ts: what /api/0x/swap/allowance-holder/{price,quote} pass to 0x, and the fee the
// proxy adds (never the page). Mirrors infer-pilot tests/swap0x.worker.test.mjs. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createRateLimiter,
  ETH,
  FEE_BPS,
  FEE_TREASURY,
  feeFree,
  handleZeroExRequest,
  IMDUSD,
  zeroXQuery,
} from '../api/_lib/zeroex.ts'
import * as pageFee from '../src/pages/Swap/fee.ts'

const TREASURY = '0x6Ac8fF96Fb8DCF5d79A8eF1E59D9AC23f2BD27Bc'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const MIYA = '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281'
const q = (o: Record<string, string>) => new URLSearchParams(o)
const base = { chainId: '1', sellToken: ETH, buyToken: MIYA, sellAmount: '1000000000000000000' }

test('mainnet swap with no imdUSD side carries 0.1% to the Treasury, in the token bought', () => {
  const { query, error } = zeroXQuery('price', q(base))
  assert.equal(error, undefined)
  assert.equal(query!.get('swapFeeRecipient'), TREASURY)
  assert.equal(query!.get('swapFeeBps'), '10')
  assert.equal(query!.get('swapFeeToken'), MIYA)
  assert.equal(zeroXQuery('price', q({ ...base, sellToken: USDC })).query!.get('swapFeeToken'), MIYA)
})

test('imdUSD on either side, in any letter case, carries no fee', () => {
  for (const pair of [
    { sellToken: IMDUSD, buyToken: USDC },
    { sellToken: USDC, buyToken: IMDUSD.toLowerCase() },
    { sellToken: ETH, buyToken: IMDUSD.toUpperCase().replace('0X', '0x') },
  ]) {
    const { query } = zeroXQuery('quote', q({ ...base, ...pair, taker: ME }))
    assert.ok(query, JSON.stringify(pair))
    for (const k of ['swapFeeRecipient', 'swapFeeBps', 'swapFeeToken']) assert.equal(query.get(k), null, k)
  }
  assert.equal(feeFree(USDC, ETH), false)
})

test('Robinhood Chain (4663) is served but carries no fee until it has a Treasury', () => {
  const { query, error } = zeroXQuery('price', q({ ...base, chainId: '4663', buyToken: USDG }))
  assert.equal(error, undefined)
  assert.equal(query!.get('chainId'), '4663')
  for (const k of ['swapFeeRecipient', 'swapFeeBps', 'swapFeeToken']) assert.equal(query!.get(k), null, k)
  assert.equal(FEE_TREASURY['4663'], undefined)
})

test('the page cannot set or override the fee, or pass any other field', () => {
  for (const k of ['swapFeeRecipient', 'swapFeeBps', 'swapFeeToken', 'buyAmount', 'excludedSources', 'txOrigin', 'recipient'])
    assert.match(zeroXQuery('price', q({ ...base, [k]: '1' })).error ?? '', /not accepted/, k)
  assert.match(zeroXQuery('price', new URLSearchParams(`chainId=1&chainId=1&sellToken=${ETH}`)).error ?? '', /twice/)
})

test('every field is checked', () => {
  const bad: [Record<string, string | undefined>, RegExp][] = [
    [{ chainId: '8453' }, /chainId/],
    [{ chainId: '11155111' }, /chainId/],
    [{ chainId: undefined }, /chainId/],
    [{ sellToken: 'ETH' }, /sellToken/],
    [{ buyToken: '0x123' }, /buyToken/],
    [{ buyToken: ETH.toLowerCase() }, /same/],
    [{ sellAmount: '0' }, /sellAmount/],
    [{ sellAmount: '1.5' }, /sellAmount/],
    [{ sellAmount: '-1' }, /sellAmount/],
    [{ sellAmount: '1e18' }, /sellAmount/],
    [{ slippageBps: '9' }, /slippage/],
    [{ slippageBps: '301' }, /slippage/],
    [{ slippageBps: '50.5' }, /slippage/],
    [{ taker: '0x0000000000000000000000000000000000000000' }, /taker/],
  ]
  for (const [patch, why] of bad) {
    const o: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined) o[k] = v
    assert.match(zeroXQuery('price', q(o)).error ?? '', why, JSON.stringify(patch))
  }
  assert.match(zeroXQuery('quote', q(base)).error ?? '', /taker/)
  for (const s of ['10', '50', '300']) assert.equal(zeroXQuery('price', q({ ...base, slippageBps: s })).query!.get('slippageBps'), s)
  assert.match(zeroXQuery('swap', q(base)).error ?? '', /Unknown/)
})

const req = (path: string, headers: Record<string, string> = {}, method = 'GET') => ({
  method,
  url: `https://miya.example${path}`,
  headers: new Headers({ 'sec-fetch-site': 'same-origin', ...headers }),
})
const PRICE = `/api/0x/swap/allowance-holder/price?${q(base)}`

test('no key: 503 SWAP_NOT_CONFIGURED, and 0x is never called', async () => {
  let called = 0
  const res = await handleZeroExRequest(req(PRICE), {}, (async () => (called++, new Response('{}'))) as typeof fetch)
  assert.equal(res.status, 503)
  assert.equal((await res.json()).name, 'SWAP_NOT_CONFIGURED')
  assert.equal(called, 0)
})

test('with a key: key and version go in headers, the fee in the query, and the answer comes back', async () => {
  let seenUrl = ''
  let seenHeaders: Record<string, string> = {}
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seenUrl = url
    seenHeaders = init.headers as Record<string, string>
    return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '42' }), { status: 200 })
  }) as unknown as typeof fetch
  const res = await handleZeroExRequest(req(PRICE), { ZEROX_API_KEY: 'test-key' }, fetchImpl)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).buyAmount, '42')
  assert.ok(seenUrl.startsWith('https://api.0x.org/swap/allowance-holder/price?'))
  assert.equal(new URL(seenUrl).searchParams.get('swapFeeRecipient'), TREASURY)
  assert.equal(seenHeaders['0x-api-key'], 'test-key')
  assert.equal(seenHeaders['0x-version'], 'v2')
})

test('upstream errors pass through; a refused key becomes 503 without echoing it', async () => {
  const reply = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch
  let res = await handleZeroExRequest(req(PRICE), { ZEROX_API_KEY: 'k' }, reply(400, '{"name":"TOKEN_NOT_SUPPORTED"}'))
  assert.equal(res.status, 400)
  assert.equal((await res.json()).name, 'TOKEN_NOT_SUPPORTED')
  res = await handleZeroExRequest(req(PRICE), { ZEROX_API_KEY: 'secret' }, reply(401, '{"message":"Invalid key secret"}'))
  assert.equal(res.status, 503)
  assert.doesNotMatch(await res.text(), /secret/)
  res = await handleZeroExRequest(req(PRICE), { ZEROX_API_KEY: 'k' }, reply(200, '<html>'))
  assert.equal(res.status, 502)
})

test('only GET, only the two routes, only same-origin', async () => {
  const env = { ZEROX_API_KEY: 'k' }
  assert.equal((await handleZeroExRequest(req(PRICE, {}, 'POST'), env)).status, 405)
  assert.equal((await handleZeroExRequest(req('/api/0x/swap/permit2/price'), env)).status, 404)
  assert.equal((await handleZeroExRequest(req(PRICE, { 'sec-fetch-site': 'cross-site' }), env)).status, 403)
  assert.equal(
    (await handleZeroExRequest(req(PRICE, { 'sec-fetch-site': '', origin: 'https://evil.example' }), env)).status,
    403
  )
})

test('a same-origin signal is required: no Sec-Fetch-Site and no Origin is refused', async () => {
  const env = { ZEROX_API_KEY: 'k' }
  const ok = (async () => new Response('{}', { status: 200 })) as typeof fetch
  const bare = { method: 'GET', url: `https://miya.example${PRICE}`, headers: new Headers() }
  assert.equal((await handleZeroExRequest(bare, env, ok)).status, 403)
  assert.equal((await handleZeroExRequest({ method: 'GET', url: bare.url }, env, ok)).status, 403)
  assert.equal((await handleZeroExRequest(req(PRICE, { 'sec-fetch-site': 'none' }), env, ok)).status, 403)
  assert.equal((await handleZeroExRequest(req(PRICE, { 'sec-fetch-site': 'same-site' }), env, ok)).status, 403)
  // Same-origin by either signal alone passes; a foreign Origin beside same-origin Sec-Fetch-Site does not.
  assert.equal((await handleZeroExRequest(req(PRICE), env, ok, createRateLimiter())).status, 200)
  const originOnly = { ...bare, headers: new Headers({ origin: 'https://miya.example' }) }
  assert.equal((await handleZeroExRequest(originOnly, env, ok, createRateLimiter())).status, 200)
  assert.equal((await handleZeroExRequest(req(PRICE, { origin: 'https://evil.example' }), env, ok)).status, 403)
})

test('requests are rate limited per client IP (token bucket)', async () => {
  const env = { ZEROX_API_KEY: 'k' }
  const ok = (async () => new Response('{}', { status: 200 })) as typeof fetch
  const limiter = createRateLimiter({ capacity: 3, perSecond: 1 })
  const from = (ip: string) => req(PRICE, { 'x-forwarded-for': `${ip}, 10.0.0.1` })
  for (let i = 0; i < 3; i++) assert.equal((await handleZeroExRequest(from('1.1.1.1'), env, ok, limiter)).status, 200)
  const limited = await handleZeroExRequest(from('1.1.1.1'), env, ok, limiter)
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).name, 'RATE_LIMITED')
  // Another client has its own bucket.
  assert.equal((await handleZeroExRequest(from('2.2.2.2'), env, ok, limiter)).status, 200)

  // Tokens refill over time.
  const bucket = createRateLimiter({ capacity: 2, perSecond: 1 })
  assert.equal(bucket('ip', 0), true)
  assert.equal(bucket('ip', 0), true)
  assert.equal(bucket('ip', 0), false)
  assert.equal(bucket('ip', 500), false)
  assert.equal(bucket('ip', 1500), true)
})

test("the page's fee display matches what the proxy enforces", () => {
  assert.equal(pageFee.FEE_BPS, FEE_BPS)
  assert.equal(pageFee.IMDUSD.toLowerCase(), IMDUSD.toLowerCase())
  assert.deepEqual([...pageFee.FEE_CHAIN_IDS].map(String), Object.keys(FEE_TREASURY))
  assert.equal(pageFee.feeApplies(1, ETH, MIYA), true)
  assert.equal(pageFee.feeApplies(4663, ETH, USDG), false)
  assert.equal(pageFee.feeApplies(1, ETH, IMDUSD), false)
})

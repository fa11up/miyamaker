// api/_lib/rpc.ts: the keyed RPC and NFT index behind the Worker. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  handleNftRequest,
  handleRpcRequest,
  logRangeError,
  MAX_BATCH,
  MAX_LOG_BLOCKS,
  METHODS,
  nftQuery,
  RPC_BODY_LIMIT,
} from '../api/_lib/rpc.ts'
import { clientKey, createRateLimiter, sameOrigin } from '../api/_lib/zeroex.ts'

const ORIGIN = 'https://www.miyamaker.com'
const KEYED = 'https://eth-mainnet.g.alchemy.com/v2/test-key'
const env = { RPC_URL_1: KEYED }
const guards = () => ({ sameOrigin, clientKey, limiter: createRateLimiter({ capacity: 1000, perSecond: 100 }) })
const headers = (extra: Record<string, string> = {}) =>
  new Headers({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.9', ...extra })
const call = (method: string, params: unknown[] = [], id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params })
const post = (body: unknown, chain = '1', h = headers()) => ({
  method: 'POST',
  url: `${ORIGIN}/api/rpc/${chain}`,
  headers: h,
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

/** A node that answers every call with its method name, and records what it was sent. */
function node(head = 1_000_000n) {
  const sent: unknown[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(url, KEYED)
    const body = JSON.parse(String(init.body))
    sent.push(body)
    const answer = (c: { id: unknown; method: string }) => ({
      jsonrpc: '2.0',
      id: c.id,
      result: c.method === 'eth_blockNumber' ? `0x${head.toString(16)}` : c.method,
    })
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), { status: 200 })
  }) as typeof fetch
  return { sent, fetchImpl }
}

test('read methods are forwarded with the key the page never sees', async () => {
  const { sent, fetchImpl } = node()
  const res = await handleRpcRequest(post(call('eth_call', [{ to: '0x' + '1'.repeat(40), data: '0x' }, 'latest'])), env, guards(), fetchImpl)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 1, result: 'eth_call' })
  assert.equal(sent.length, 1)
})

test('methods outside the allowlist are answered here, never forwarded', async () => {
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_newFilter', 'debug_traceTransaction', 'admin_peers']) {
    const { sent, fetchImpl } = node()
    const res = await handleRpcRequest(post(call(method)), env, guards(), fetchImpl)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { error?: { code: number } }
    assert.equal(body.error?.code, -32601, method)
    assert.equal(sent.length, 0, method)
  }
  assert.ok(METHODS.has('eth_getLogs') && !METHODS.has('eth_sendRawTransaction'))
})

test('a batch forwards its reads and answers the rest itself', async () => {
  const { sent, fetchImpl } = node()
  const res = await handleRpcRequest(
    post([call('eth_blockNumber', [], 1), call('eth_sendRawTransaction', ['0x00'], 2), call('eth_chainId', [], 3)]),
    env,
    guards(),
    fetchImpl
  )
  const answers = (await res.json()) as { id: number; result?: string; error?: { code: number } }[]
  assert.deepEqual(
    answers.map((a) => a.id).sort(),
    [1, 2, 3]
  )
  assert.equal(answers.find((a) => a.id === 2)?.error?.code, -32601)
  assert.deepEqual((sent[0] as { method: string }[]).map((c) => c.method), ['eth_blockNumber', 'eth_chainId'])
})

test(`batches are capped at ${MAX_BATCH}`, async () => {
  const { sent, fetchImpl } = node()
  const ok = await handleRpcRequest(post(Array.from({ length: MAX_BATCH }, (_, i) => call('eth_chainId', [], i))), env, guards(), fetchImpl)
  assert.equal(ok.status, 200)
  const tooMany = await handleRpcRequest(post(Array.from({ length: MAX_BATCH + 1 }, (_, i) => call('eth_chainId', [], i))), env, guards(), fetchImpl)
  assert.equal(tooMany.status, 400)
  const empty = await handleRpcRequest(post([]), env, guards(), fetchImpl)
  assert.equal(empty.status, 400)
  assert.equal(sent.length, 1)
})

test('bodies over the cap are refused unforwarded', async () => {
  const { sent, fetchImpl } = node()
  // The caller passes undefined when the request said it was larger than RPC_BODY_LIMIT.
  const declared = await handleRpcRequest({ ...post(''), body: undefined }, env, guards(), fetchImpl)
  assert.equal(declared.status, 413)
  // A body read up to the limit was cut there.
  const cut = await handleRpcRequest(post('x'.repeat(RPC_BODY_LIMIT)), env, guards(), fetchImpl)
  assert.equal(cut.status, 413)
  const garbage = await handleRpcRequest(post('{not json'), env, guards(), fetchImpl)
  assert.equal(garbage.status, 400)
  assert.equal(sent.length, 0)
})

test(`eth_getLogs ranges are capped at ${MAX_LOG_BLOCKS} blocks`, async () => {
  const head = async () => 1_000_000n
  const hex = (n: bigint) => `0x${n.toString(16)}`
  assert.equal(await logRangeError([{ fromBlock: hex(1n), toBlock: hex(MAX_LOG_BLOCKS) }], head), undefined)
  assert.match(String(await logRangeError([{ fromBlock: hex(0n), toBlock: hex(MAX_LOG_BLOCKS) }], head)), /limited/)
  assert.match(String(await logRangeError([{ fromBlock: 'earliest', toBlock: 'latest' }], head)), /limited/)
  assert.equal(await logRangeError([{ fromBlock: hex(1_000_000n - 100n), toBlock: 'latest' }], head), undefined)
  assert.match(String(await logRangeError([{ fromBlock: hex(1n) }], head)), /limited/) // toBlock defaults to latest
  assert.equal(await logRangeError([{}], head), undefined) // latest..latest
  assert.equal(await logRangeError([{ blockHash: '0x' + 'a'.repeat(64) }], head), undefined)
  assert.ok(await logRangeError([{ fromBlock: 12 }], head))
  assert.ok(await logRangeError([], head))

  const { sent, fetchImpl } = node()
  const res = await handleRpcRequest(post(call('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest' }])), env, guards(), fetchImpl)
  assert.equal(((await res.json()) as { error?: { code: number } }).error?.code, -32005)
  // Only the head was asked, to size the range; the logs were not.
  assert.deepEqual(sent.map((c) => (c as { method: string }).method), ['eth_blockNumber'])
})

test('with no secret the route says it is off, and the page uses public RPCs', async () => {
  const { sent, fetchImpl } = node()
  const res = await handleRpcRequest(post(call('eth_chainId')), {}, guards(), fetchImpl)
  assert.equal(res.status, 503)
  assert.equal(res.headers.get('x-rpc-proxy'), 'off')
  const http = await handleRpcRequest(post(call('eth_chainId')), { RPC_URL_1: 'http://plain.example' }, guards(), fetchImpl)
  assert.equal(http.status, 503)
  assert.equal(sent.length, 0)
})

test('other sites, other methods, unknown chains and floods are turned away', async () => {
  const { sent, fetchImpl } = node()
  const cross = await handleRpcRequest(post(call('eth_chainId'), '1', headers({ 'sec-fetch-site': 'cross-site' })), env, guards(), fetchImpl)
  assert.equal(cross.status, 403)
  const bare = await handleRpcRequest(post(call('eth_chainId'), '1', new Headers()), env, guards(), fetchImpl)
  assert.equal(bare.status, 403)
  const get = await handleRpcRequest({ ...post(''), method: 'GET' }, env, guards(), fetchImpl)
  assert.equal(get.status, 405)
  const chain = await handleRpcRequest(post(call('eth_chainId'), '137'), env, guards(), fetchImpl)
  assert.equal(chain.status, 404)
  const g = { sameOrigin, clientKey, limiter: createRateLimiter({ capacity: 2, perSecond: 0 }) }
  const codes = []
  for (let i = 0; i < 3; i += 1) codes.push((await handleRpcRequest(post(call('eth_chainId')), env, g, fetchImpl)).status)
  assert.deepEqual(codes, [200, 200, 429])
})

test('a refused key is reported as off, without the node saying anything about it', async () => {
  const fetchImpl = (async () => new Response('{"error":"Must be authenticated! key test-key"}', { status: 401 })) as unknown as typeof fetch
  const res = await handleRpcRequest(post(call('eth_chainId')), env, guards(), fetchImpl)
  assert.equal(res.status, 503)
  assert.doesNotMatch(await res.text(), /test-key/)
})

test('alchemy_getAssetTransfers is a bounded page', async () => {
  const { sent, fetchImpl } = node()
  const ok = await handleRpcRequest(post(call('alchemy_getAssetTransfers', [{ maxCount: '0x8' }])), env, guards(), fetchImpl)
  assert.equal(((await ok.json()) as { result?: string }).result, 'alchemy_getAssetTransfers')
  const big = await handleRpcRequest(post(call('alchemy_getAssetTransfers', [{ maxCount: '0x3e8' }])), env, guards(), fetchImpl)
  assert.equal(((await big.json()) as { error?: { code: number } }).error?.code, -32005)
  assert.equal(sent.length, 1)
})

test('the NFT index takes only its own query and keeps the key server-side', async () => {
  const owner = '0x' + 'b'.repeat(40)
  assert.ok('query' in nftQuery(new URLSearchParams({ owner, withMetadata: 'true', pageSize: '100' })))
  assert.ok('error' in nftQuery(new URLSearchParams({ owner, pageSize: '101' })))
  assert.ok('error' in nftQuery(new URLSearchParams({ owner, apiKey: 'x' })))
  assert.ok('error' in nftQuery(new URLSearchParams({ owner: 'vitalik.eth' })))

  let asked = ''
  const fetchImpl = (async (url: string) => {
    asked = url
    return new Response('{"ownedNfts":[]}', { status: 200 })
  }) as unknown as typeof fetch
  const req = (q: string, h = headers()) => ({ method: 'GET', url: `${ORIGIN}/api/nft/1/getNFTsForOwner?${q}`, headers: h })
  const ok = await handleNftRequest(req(`owner=${owner}`), { ALCHEMY_API_KEY: 'nft-key' }, guards(), fetchImpl)
  assert.equal(ok.status, 200)
  assert.match(asked, /^https:\/\/eth-mainnet\.g\.alchemy\.com\/nft\/v3\/nft-key\/getNFTsForOwner\?owner=/)
  const off = await handleNftRequest(req(`owner=${owner}`), {}, guards(), fetchImpl)
  assert.equal(off.status, 503)
  assert.equal(off.headers.get('x-rpc-proxy'), 'off')
  const cross = await handleNftRequest(req(`owner=${owner}`, headers({ 'sec-fetch-site': 'cross-site' })), { ALCHEMY_API_KEY: 'k' }, guards(), fetchImpl)
  assert.equal(cross.status, 403)
  const other = await handleNftRequest({ ...req(''), url: `${ORIGIN}/api/nft/1/getContractMetadata` }, { ALCHEMY_API_KEY: 'k' }, guards(), fetchImpl)
  assert.equal(other.status, 404)
})

test('no keyed RPC or Alchemy key is read by the page', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  const files = walk(new URL('../src/', import.meta.url).pathname).filter((f) => /\.(ts|tsx|mts)$/.test(f))
  assert.ok(files.length > 100)
  const hits = files.filter((f) => /VITE_RPC_URL|VITE_ALCHEMY|g\.alchemy\.com/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(hits, [])
})

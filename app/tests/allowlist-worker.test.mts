// The Worker's wiring of the allowlist route (api/worker.ts): how a shipped list is read from the asset store, and the
// body cap on saving one. The route itself is tested in allowlist.test.mts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import './ts-paths.mts'
import { ALLOWLIST_BODY_LIMIT, buildTree, clearAllowlistCache } from '../api/_lib/allowlist.ts'

const worker = (await import('../api/worker.ts')).default

const FIXTURE = ['0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF']
const { root: ROOT, ...DUMP } = buildTree(FIXTURE)
const ORIGIN = 'https://www.miyamaker.com'

type Assets = (request: Request) => Promise<Response>
const env = (assets: Assets) => ({ ASSETS: { fetch: assets } }) as never
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ask = (assets: Assets) => {
  clearAllowlistCache()
  return worker.fetch(new Request(`${ORIGIN}/api/allowlist/${ROOT}?address=${FIXTURE[0]}`), env(assets))
}

test('a shipped list is read from /allowlists/<root>.json and proves its wallets', async () => {
  const asked: string[] = []
  const r = await ask(async (req) => {
    asked.push(new URL(req.url).pathname)
    return json(DUMP)
  })
  assert.deepEqual(asked, [`/allowlists/${ROOT}.json`])
  assert.equal(r.status, 200)
  assert.equal((await r.json()).listed, true)
})

test('no file (404, or the app page from the single-page fallback) is "no list": 404 with the root', async () => {
  for (const missing of [new Response('nope', { status: 404 }), new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })]) {
    const r = await ask(async () => missing.clone())
    assert.equal(r.status, 404)
    assert.equal((await r.json()).root, ROOT)
  }
})

test('an asset store that fails or answers broken JSON is 503 without a root, not "no list"', async () => {
  const cases: Assets[] = [
    async () => new Response('busy', { status: 500 }),
    async () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    async () => Promise.reject(new Error('down')),
  ]
  for (const assets of cases) {
    const r = await ask(assets)
    assert.equal(r.status, 503)
    assert.equal((await r.json()).root, undefined)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  }
})

test('saving a list bigger than the body cap is 413, whether or not it says its length', async () => {
  const big = JSON.stringify({ addresses: ['x'.repeat(ALLOWLIST_BODY_LIMIT)] })
  const say = await worker.fetch(
    new Request(`${ORIGIN}/api/allowlist`, { method: 'POST', body: big, headers: { origin: ORIGIN } }),
    env(async () => json({}))
  )
  assert.equal(say.status, 413)
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(big))
      c.close()
    },
  })
  const quiet = await worker.fetch(
    new Request(`${ORIGIN}/api/allowlist`, { method: 'POST', body: stream, headers: { origin: ORIGIN }, duplex: 'half' } as RequestInit),
    env(async () => json({}))
  )
  assert.equal(quiet.status, 413)
})

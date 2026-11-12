// The portable MiyaMusicMaker shell (desktop/miyamusicmaker). Electron is not loaded here: main.js is
// read as text, and serve.js (the app:// file server) has no Electron in it, so it runs for real. Run: yarn test
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const DESKTOP = new URL('../../desktop/miyamusicmaker/', import.meta.url)
const main = readFileSync(new URL('main.js', DESKTOP), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('package.json', DESKTOP), 'utf8'))

type Range = { start: number; end: number } | 'unsatisfiable' | null
type Serve = {
  isApiPath: (p: string) => boolean
  parseRange: (h: string | null | undefined, size: number) => Range
  resolveInRoot: (root: string, p: string) => string | null
  serve: (root: string, req: Request) => Promise<Response>
}
const load = createRequire(import.meta.url)
const srv = load(fileURLToPath(new URL('serve.js', DESKTOP))) as Serve

const root = mkdtempSync(join(tmpdir(), 'miya-desktop-'))
writeFileSync(join(root, 'index.html'), '<!doctype html><title>miya</title>')
writeFileSync(join(root, 'clip.mp3'), '0123456789')
after(() => rmSync(root, { recursive: true, force: true }))

const get = (path: string, headers: Record<string, string> = {}) =>
  srv.serve(root, new Request('app://music' + path, { headers }))

/* ---------- main.js ---------- */

test('main.js uses a fixed app:// origin, not a new port each launch', () => {
  assert.doesNotMatch(main, /listen\(\s*0/)
  assert.doesNotMatch(main, /require\('http'\)/)
  assert.match(main, /registerSchemesAsPrivileged/)
  assert.match(main, /standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true/)
  assert.match(main, /protocol\.handle\(SCHEME/)
  assert.match(main, /app:\/\/|\$\{SCHEME\}:\/\/\$\{APP_HOST\}/)
})

test('main.js keeps the dev URL and tells you when the dev server is down', () => {
  assert.match(main, /http:\/\/localhost:5173\/music/)
  assert.match(main, /dialog\.showErrorBox\([\s\S]*?dev server is not running/)
})

test('the packaged app ships serve.js and reads the generated icon', () => {
  assert.ok(pkg.build.files.includes('serve.js'))
  assert.equal(pkg.build.icon, 'build/generated/icon.png')
})

test('entitlements keep only JIT and the microphone', () => {
  for (const name of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
    const plist = readFileSync(new URL('build/' + name, DESKTOP), 'utf8')
    assert.match(plist, /com\.apple\.security\.cs\.allow-jit/)
    assert.match(plist, /com\.apple\.security\.device\.audio-input/)
    assert.doesNotMatch(plist, /allow-unsigned-executable-memory|disable-library-validation|security\.network\./)
  }
})

/* ---------- serve.js ---------- */

test('/api is a 404, never the page', async () => {
  assert.equal(srv.isApiPath('/api'), true)
  assert.equal(srv.isApiPath('/api/sample-media'), true)
  assert.equal(srv.isApiPath('/apiary'), false)
  const res = await get('/api/video-audio?u=x')
  assert.equal(res.status, 404)
  assert.doesNotMatch(await res.text(), /doctype/i)
})

test('routes without an extension get the page; missing files are 404', async () => {
  const page = await get('/music')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type') ?? '', /text\/html/)
  assert.equal((await get('/nope.png')).status, 404)
})

test('paths cannot leave the root', async () => {
  for (const bad of ['/../secret', '/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/..\\..\\windows', '/a%5c..%5c..%5c..%5cx', '/%00', '/%E0%A4%A']) {
    assert.equal(srv.resolveInRoot(root, bad), null, bad)
  }
  assert.equal(srv.resolveInRoot(root, '/clip.mp3'), join(root, 'clip.mp3'))
  assert.equal((await get('/..%2f..%2fetc%2fpasswd')).status, 400)
})

test('ranges are clamped, and impossible ones are 416', async () => {
  assert.equal(srv.parseRange(undefined, 10), null)
  assert.deepEqual(srv.parseRange('bytes=2-99', 10), { start: 2, end: 9 })
  assert.deepEqual(srv.parseRange('bytes=4-', 10), { start: 4, end: 9 })
  assert.deepEqual(srv.parseRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(srv.parseRange('bytes=-30', 10), { start: 0, end: 9 })
  for (const bad of ['bytes=10-', 'bytes=5-2', 'bytes=-', 'bytes=-0', 'items=0-1', 'bytes=0-1,3-4']) {
    assert.equal(srv.parseRange(bad, 10), 'unsatisfiable', bad)
  }
  assert.equal(srv.parseRange('bytes=0-', 0), 'unsatisfiable')

  const part = await get('/clip.mp3', { range: 'bytes=2-99' })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), 'bytes 2-9/10')
  assert.equal(part.headers.get('content-length'), '8')
  assert.equal(await part.text(), '23456789')

  const none = await get('/clip.mp3', { range: 'bytes=20-' })
  assert.equal(none.status, 416)
  assert.equal(none.headers.get('content-range'), 'bytes */10')
})

test('a missing index is a 404, not a throw', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'miya-desktop-empty-'))
  try {
    assert.equal((await srv.serve(empty, new Request('app://music/music'))).status, 404)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

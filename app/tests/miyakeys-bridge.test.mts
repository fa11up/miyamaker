// Where miyaOS meets miyakeys's sandboxed frame (embed/miyakeys/js/core/host.js, src/pages/Miyakeys): only the parent
// window from the claimed origin is heard, activity goes out at most once a second, an oversized build link is refused,
// the screensaver counts the frame's activity, menus close and windows come to the front on a click into the frame,
// the miyakeys window never crosses the frame's phone breakpoint, and dev uses the site's sandbox. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { ACTIVITY_MS, MAX_HASH, TOO_BIG, activityKind, listenToHost, throttle } from '../embed/miyakeys/js/core/host.js'
import { ACTIVITY_EVENT, frameActivity, pressedFrame, reportActivity } from '../src/desktop/screensaver/activity.ts'

type Listener = (ev: Record<string, unknown>) => void

/** A stand-in for the frame's window: listeners by type, and a parent that records what is posted to it. */
function fakeFrame(search = '?host=http%3A%2F%2Flocalhost%3A5173') {
  const listeners = new Map<string, Set<Listener>>()
  const posted: [unknown, string][] = []
  const parent = { postMessage: (m: unknown, o: string) => posted.push([m, o]) }
  const win = {
    parent,
    location: { search, href: `http://localhost:5173/embed/miyakeys/${search}` },
    addEventListener: (t: string, fn: Listener) => listeners.set(t, (listeners.get(t) ?? new Set()).add(fn)),
    removeEventListener: (t: string, fn: Listener) => listeners.get(t)?.delete(fn),
  }
  const fire = (type: string, ev: Record<string, unknown> = {}) => listeners.get(type)?.forEach((fn) => fn({ type, ...ev }))
  ;(globalThis as { window?: unknown }).window = win
  return { win, parent, posted, fire, listeners }
}

const HOST = 'http://localhost:5173'

test('init is heard only from the parent window, from the origin in ?host=', () => {
  const { parent, fire } = fakeFrame()
  const builds: string[] = []
  const stop = listenToHost({ onBuild: (h: string) => builds.push(h), onVisible: () => {} })
  const init = { type: 'miyakeys:init', shareBase: `${HOST}/miyakeys`, hash: '#abc' }
  fire('message', { source: {}, origin: HOST, data: init })
  fire('message', { source: parent, origin: 'https://evil.example', data: init })
  fire('message', { source: parent, origin: 'null', data: init })
  assert.deepEqual(builds, [])
  fire('message', { source: parent, origin: HOST, data: init })
  fire('message', { source: parent, origin: HOST, data: { ...init, hash: '#again' } })
  assert.deepEqual(builds, ['abc'], 'the first init only, with its # taken off')
  stop()
})

test('a frame claiming a host that is not miyamaker.com or local hears nothing and says nothing', () => {
  const { posted, listeners } = fakeFrame('?host=https%3A%2F%2Fevil.example')
  listenToHost({ onBuild: () => assert.fail('no build'), onVisible: () => {} })
  assert.equal(posted.length, 0)
  assert.equal(listeners.size, 0)
})

test('a build link over MAX_HASH (2 MB) is refused with a plain sentence, never decoded', () => {
  assert.equal(MAX_HASH, 2 * 1024 * 1024)
  const { parent, fire } = fakeFrame()
  const refused: string[] = []
  listenToHost({ onBuild: () => assert.fail('not decoded'), onVisible: () => {}, onRefused: (m: string) => refused.push(m) })
  fire('message', { source: parent, origin: HOST, data: { type: 'miyakeys:init', hash: 'x'.repeat(MAX_HASH + 1) } })
  assert.deepEqual(refused, [TOO_BIG])
  assert.doesNotMatch(TOO_BIG, /hash|MB|bytes|error/i)
})

test('activity goes to the claimed origin only, presses always and the rest once a second, until stopped', () => {
  let t = 10_000
  const { posted, fire } = fakeFrame()
  const stop = listenToHost({ onBuild: () => {}, onVisible: () => {}, now: () => t })
  posted.length = 0 // the ready message
  const sent = (kind: string) => [{ type: 'miyakeys:activity', kind }, HOST]
  fire('pointermove', { buttons: 0 }) // hovering is not activity
  assert.equal(posted.length, 0)
  fire('keydown')
  fire('keydown')
  fire('wheel')
  t += ACTIVITY_MS - 1
  fire('pointermove', { buttons: 1 })
  assert.deepEqual(posted, [sent('key')])
  fire('pointerdown') // a press goes at once: it brings the window to the front
  fire('pointerdown')
  assert.deepEqual(posted, [sent('key'), sent('pointerdown'), sent('pointerdown')])
  t += 1
  fire('pointermove', { buttons: 1 })
  assert.deepEqual(posted.at(-1), sent('drag'))
  stop()
  t += ACTIVITY_MS
  fire('keydown')
  fire('pointerdown')
  assert.equal(posted.length, 4)
  assert.equal(ACTIVITY_MS, 1000)
})

test('activity kinds and the throttle', () => {
  assert.equal(activityKind({ type: 'keydown' }), 'key')
  assert.equal(activityKind({ type: 'wheel' }), 'wheel')
  assert.equal(activityKind({ type: 'pointermove', buttons: 0 }), null)
  assert.equal(activityKind({ type: 'pointermove', buttons: 2 }), 'drag')
  assert.equal(activityKind({ type: 'click' }), null)
  let t = 0
  const due = throttle(1000, () => t)
  assert.equal(due(), true)
  t = 999
  assert.equal(due(), false)
  t = 1000
  assert.equal(due(), true)
})

test('the window passes on activity from its own frame only', () => {
  const frame = {} as Window
  const msg = { type: 'miyakeys:activity', kind: 'key' }
  assert.equal(frameActivity({ source: frame, data: msg }, frame, 'miyakeys:activity'), 'key')
  assert.equal(frameActivity({ source: {}, data: msg }, frame, 'miyakeys:activity'), null)
  assert.equal(frameActivity({ source: null, data: msg }, null, 'miyakeys:activity'), null)
  assert.equal(frameActivity({ source: frame, data: { ...msg, type: 'miyakeys:ready' } }, frame, 'miyakeys:activity'), null)
  assert.equal(frameActivity({ source: frame, data: { ...msg, kind: 'x' } }, frame, 'miyakeys:activity'), null)
  assert.equal(frameActivity({ source: frame, data: 'miyakeys:activity' }, frame, 'miyakeys:activity'), null)
})

test('reported activity reaches the screensaver gate, which counts it and closes a screensaver showing', () => {
  const target = new EventTarget()
  ;(globalThis as { window?: unknown }).window = target
  const heard: (HTMLIFrameElement | null)[] = []
  target.addEventListener(ACTIVITY_EVENT, (e) => heard.push(pressedFrame(e)))
  const frame = {} as HTMLIFrameElement
  reportActivity()
  reportActivity({ kind: 'key', frame })
  reportActivity({ kind: 'pointerdown', frame })
  assert.deepEqual(heard, [null, null, frame], 'only a press names its frame')

  const gate = readFileSync('src/desktop/screensaver/useScreensaverGate.ts', 'utf8')
  assert.match(gate, /window\.addEventListener\(ACTIVITY_EVENT, bump\)/)
  const saver = readFileSync('src/desktop/screensaver/Screensaver.tsx', 'utf8')
  assert.match(saver, /window\.addEventListener\(ACTIVITY_EVENT, onActivity\)/)
  assert.match(saver, /framed\.blur\(\)\s+overlay\?\.focus\(/, 'focus comes out of a frame while the screensaver shows')
  assert.match(saver, /framed\.focus\(\{ preventScroll: true \}\)/, 'and goes back in after')
  const page = readFileSync('src/pages/Miyakeys/index.tsx', 'utf8')
  assert.match(page, /frameActivity\(e, frame\.current\?\.contentWindow, 'miyakeys:activity'\)\s+if \(kind\) reportActivity\(\{ kind, frame: frame\.current \}\)/)
})

test('the Start and skin menus close on a window blur or a press in a frame', () => {
  for (const f of ['src/components/TaskBar/StartButton.tsx', 'src/components/SkinMenu/index.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /window\.addEventListener\('blur', \w+\)/, f)
    assert.match(src, /window\.addEventListener\(ACTIVITY_EVENT, \w+\)/, f)
    assert.match(src, /if \(pressedFrame\(e\)\)/, f)
  }
})

test('a click into a frame brings its window to the front', () => {
  const src = readFileSync('src/pages/OperatingSystem/Windows.tsx', 'utf8')
  assert.match(src, /window\.addEventListener\('blur', onBlur\)/)
  assert.match(src, /active instanceof HTMLIFrameElement && ref\.current\?\.contains\(active\)\) raise\.current\(\)/)
  assert.match(src, /window\.addEventListener\(ACTIVITY_EVENT, onPress\)/)
  assert.match(src, /frame && ref\.current\?\.contains\(frame\)\) raise\.current\(\)/)
})

test('the miyakeys window stays wider than the frame\'s phone breakpoint on a desktop', () => {
  const src = readFileSync('src/pages/OperatingSystem/Windows.tsx', 'utf8')
  const m = src.match(/miyakeys: \{ fine: (\d+), coarse: (\d+) \}/)
  assert.ok(m, 'LAYOUT_MIN_WIDTH has miyakeys')
  // embed/miyakeys/js/shell.js: phone at <= 768px, or <= 1024px with a touch pointer; room left for the window's border.
  assert.ok(Number(m[1]) >= 768 + 24)
  assert.ok(Number(m[2]) >= 1024 + 24)
  assert.match(src, /width: Math\.max\(Math\.min\(baseSize\.width, 480\), layoutMinWidth\(identifier\)\)/)
  assert.match(src, /const size = \{ width: Math\.max\(minSize\.width, picked\.width\)/, 'saved sizes come back at the minimum')
  const shell = readFileSync('embed/miyakeys/js/shell.js', 'utf8')
  assert.match(shell, /w <= 768 \|\| \(w <= 1024 && /, 'the breakpoints this test assumes')
})

test('dev frames miyakeys in the same sandbox as the site, never with its own origin back', () => {
  const dir = 'src/pages/Miyakeys'
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8')
    assert.doesNotMatch(src, /allow-same-origin/, f)
    assert.doesNotMatch(src, /import\.meta\.env\.DEV/, f)
  }
  const page = readFileSync(join(dir, 'index.tsx'), 'utf8')
  assert.match(page, /export const MIYAKEYS_SANDBOX = 'allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox'/)
  assert.match(page, /sandbox=\{MIYAKEYS_SANDBOX\}/)
  const vite = readFileSync('vite.config.ts', 'utf8')
  assert.match(vite, /res\.setHeader\('content-security-policy', EMBED_CSP\)/, 'dev serves the page with the CSP')
  const open = vite.match(/const open = new RegExp\(`([^`]*)`\)/)?.[1] ?? ''
  assert.ok(open.includes('node_modules'), 'the frame may load its packages')
  assert.doesNotMatch(open, /\/src|\/@fs\/\[\^\?\]\*\/(?!node_modules)/, 'the desktop sources stay closed to the frame')
})

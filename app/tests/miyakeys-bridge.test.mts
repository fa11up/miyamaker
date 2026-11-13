// Where miyaOS meets miyakeys's sandboxed frame (embed/miyakeys/js/core/host.js, src/pages/Miyakeys): only the parent
// window from the claimed origin is heard, activity goes out at most once a second, an oversized build link is refused,
// the screensaver counts the frame's activity, menus close and windows come to the front on a click into the frame,
// the miyakeys window never crosses the frame's phone breakpoint, and dev uses the site's sandbox. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as nodeModule from 'node:module'
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
// Node 22.13+; this repo's @types/node predates it.
const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }

/**
 * A self-contained function from a source file (one that uses nothing outside itself), run from the file's text: the
 * file itself (vite.config.ts, a .tsx component) cannot be imported here. Fails, rather than passing on nothing, when
 * the function is not found.
 */
function fromSource<T>(file: string, name: string): T {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} in ${file}`)
  // The body ends at the first line that is just "}" after it starts.
  const end = src.indexOf('\n}\n', start)
  assert.ok(end > start, `the end of ${name}`)
  const text = src.slice(start, end + 2)
  assert.ok(text.length > 40 && text.includes('return'), `${name} is a real function`)
  return new Function(`${stripTypeScriptTypes(text)}; return ${name}`)() as T
}

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
  assert.match(src, /layoutMin: layoutMinWidth\(identifier\)/)
  assert.match(src, /const minSize = \{ width: fit\.minWidth/)
  assert.match(src, /const mobile = fit\.fullScreen/)
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
  assert.match(vite, /req\.headers\.origin === 'null' && miyakeysDevOpen\(url, EMBED_PREFIX\)/, 'Origin null is judged by miyakeysDevOpen')
})

test("dev opens only the embed's files and packages to Origin null: never /@vite/client (its WebSocket token) or a .. path", () => {
  const devOpen = fromSource<(url: string, prefix: string) => boolean>('vite.config.ts', 'miyakeysDevOpen')
  const P = '/embed/miyakeys'
  for (const url of [`${P}/`, `${P}/index.html`, `${P}/js/boot.js?v=1`, '/node_modules/.vite/deps/three.js?v=abc', '/@fs/Users/me/app/node_modules/three/build/three.module.js'])
    assert.equal(devOpen(url, P), true, url)
  for (const url of [
    '/@vite/client',
    '/@vite/client?t=1',
    '/@vite/env',
    '/src/main.tsx',
    '/vite.config.ts?raw',
    '/node_modules/%2e%2e/src/main.tsx',
    '/node_modules/.%2e/src/main.tsx',
    '/node_modules/%2E%2E/vite.config.ts?raw',
    '/node_modules/../src/main.tsx',
    '/node_modules/./../src/main.tsx',
    `${P}/%2e%2e/%2e%2e/src/main.tsx`,
    '/node_modules/%5c..%5csrc/main.tsx',
    '/node_modules/%E0%A4%A',
    '/@fs/Users/me/app/node_modules/%2e%2e/%2e%2e/src/main.tsx',
    '/@fs/Users/me/app/src/main.tsx',
    `${P}x/`,
  ])
    assert.equal(devOpen(url, P), false, url)

  // The page in dev loads no /@vite/client: the script Vite adds is taken out (with the React refresh preamble).
  const vite = readFileSync('vite.config.ts', 'utf8')
  const plugin = vite.slice(vite.indexOf('function miyakeysEmbedDev('), vite.indexOf('function miyakeysGalleryDevProxy('))
  assert.ok(plugin.length > 200, 'the plugin is found')
  assert.match(plugin, /\.replace\(\/<script type="module" src="\[\^"\]\*\\\/@vite\\\/client"><\\\/script>\\s\*\/g, ''\)/)
  assert.doesNotMatch(plugin, /@vite\/\(client/, 'no /@vite/(client|env) allowance is left')
  const strip = new RegExp(plugin.match(/\.replace\(\/(<script type="module" src=[^/]*\\\/@vite\\\/client"><\\\/script>\\s\*)\/g/)![1]!, 'g')
  assert.equal('<head><script type="module" src="/@vite/client"></script>\n<link>'.replace(strip, ''), '<head><link>')
})

test('on a desktop narrower than its layout needs, miyakeys opens full-screen; a window never goes off the left', () => {
  type Fit = (o: { mobile?: boolean; viewWidth: number; baseWidth: number; layoutMin: number }) => { fullScreen: boolean; minWidth: number }
  const fit = fromSource<Fit>('src/pages/OperatingSystem/Windows.tsx', 'windowFit')
  const src = readFileSync('src/pages/OperatingSystem/Windows.tsx', 'utf8')
  const m = src.match(/miyakeys: \{ fine: (\d+), coarse: (\d+) \}/)!
  const [fine, coarse] = [Number(m[1]), Number(m[2])]
  // Mouse: 769..fine-1 px is full-screen (the frame is the whole width, so it does not drop to <= 768 while open).
  for (const viewWidth of [769, 790, fine - 1]) assert.deepEqual(fit({ viewWidth, baseWidth: 1200, layoutMin: fine }), { fullScreen: true, minWidth: viewWidth }, String(viewWidth))
  assert.deepEqual(fit({ viewWidth: fine, baseWidth: 1200, layoutMin: fine }), { fullScreen: false, minWidth: fine })
  assert.deepEqual(fit({ viewWidth: 1440, baseWidth: 1200, layoutMin: fine }), { fullScreen: false, minWidth: fine })
  // Touch: 769..coarse-1 px is full-screen too.
  for (const viewWidth of [769, 1024, coarse - 1]) assert.equal(fit({ viewWidth, baseWidth: 1200, layoutMin: coarse }).fullScreen, true, String(viewWidth))
  assert.equal(fit({ viewWidth: coarse, baseWidth: 1200, layoutMin: coarse }).fullScreen, false)
  // Other windows: never full-screen for width, and never a minimum wider than the desktop.
  assert.deepEqual(fit({ viewWidth: 400, baseWidth: 600, layoutMin: 0 }), { fullScreen: false, minWidth: 400 })
  assert.deepEqual(fit({ viewWidth: 1200, baseWidth: 600, layoutMin: 0 }), { fullScreen: false, minWidth: 480 })
  assert.deepEqual(fit({ viewWidth: 1200, baseWidth: 300, layoutMin: 0 }), { fullScreen: false, minWidth: 300 })
  assert.equal(fit({ mobile: true, viewWidth: 1440, baseWidth: 600, layoutMin: 0 }).fullScreen, true)
  // Before the size is known (0), nothing is forced.
  assert.deepEqual(fit({ viewWidth: 0, baseWidth: 1200, layoutMin: fine }), { fullScreen: false, minWidth: fine })

  // Dragging the W (or N) edge never puts the window past the left (top): held at its minimum, it grows the other way.
  const pinned = fromSource<(start: number, size: number, w: number) => number>('src/pages/OperatingSystem/Windows.tsx', 'pinnedStart')
  assert.equal(pinned(100, 900, 950), 50)
  assert.equal(pinned(10, 820, 900), 0)
  assert.equal(pinned(0, 800, 800), 0)
  assert.equal(pinned(-40, 800, 800), 0, 'a negative start comes back on screen')
  assert.match(src, /left = pinnedStart\(start\.left, start\.w, w\)/)
  assert.match(src, /top = pinnedStart\(start\.top, start\.h, h\)/)
  assert.match(src, /x: Math\.max\(0, Math\.min\(position\.x, maxX\)\)/, 'a saved negative x comes back at 0')
})

test('focus moving straight from one window\'s frame to another\'s still raises it: a poll while a frame has focus, stopped on focus and unmount', () => {
  const src = readFileSync('src/pages/OperatingSystem/Windows.tsx', 'utf8')
  const start = src.indexOf('const raise = useRef(onClick)')
  const effect = src.slice(start, src.indexOf('}, [])', start))
  assert.ok(start > 0 && effect.length > 200, 'the effect is found')
  assert.match(effect, /poll = setInterval\(check, FRAME_FOCUS_POLL_MS\)/)
  assert.match(effect, /if \(!poll && document\.activeElement instanceof HTMLIFrameElement\)/, 'only while a frame has focus')
  assert.match(effect, /window\.addEventListener\('focus', onFocus\)/)
  assert.match(effect, /return \(\) => \{\s*stop\(\)/, 'stopped on unmount')
  assert.match(effect, /window\.removeEventListener\('focus', onFocus\)/)
  assert.match(effect, /if \(active === last\) return/, 'raises once per move, not every tick')
})

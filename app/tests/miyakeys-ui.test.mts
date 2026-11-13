// miyakeys embed UI rules from the re-audit: the window.name carry across a shell reload (shrinker.js acceptCarry), the
// hidden characters taken out of text (validBuild.js cleanText), the gallery's "newest 500" note, the share error copy,
// the inert page behind a dialog, render requests for direct scene changes, and the 32px control floor. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { code } from './source-scan.mts'

;(globalThis as any).window ??= { location: { href: 'https://www.miyamaker.com/embed/miyakeys/index.html' } }

const { CARRY, MAX_CARRY, MAX_SAVED_BUILDS, acceptCarry, carryName } = await import('../embed/miyakeys/js/core/shrinker.js')
const { cleanText } = await import('../embed/miyakeys/js/core/validBuild.js')

const EMBED = 'embed/miyakeys/'
const NONCE = '0123456789abcdef0123456789abcdef'
const payload = (n = 3) => ({
  build: { layout: '75', colorway: 'claude', perKeyOverrides: { '1-1': { customText: 'Hi' } } },
  savedBuilds: Array.from({ length: n }, (_, i) => ({ name: 'Build ' + i, snap: { layout: '60' } })),
})

/** The text between two markers in a file's code, asserted non-empty so a moved marker cannot pass vacuously. */
function slice(path: string, from: string, to: string): string {
  const text = code(path)
  const a = text.indexOf(from)
  assert.ok(a >= 0, `${path}: "${from}" is there`)
  const b = text.indexOf(to, a + from.length)
  assert.ok(b > a, `${path}: "${to}" follows "${from}"`)
  const out = text.slice(a, b)
  assert.ok(out.trim().length > from.length, `${path}: the slice from "${from}" has code in it`)
  return out
}

test('a carry is taken after a reload of this page, checked, and only then', () => {
  const name = carryName(NONCE, payload())
  assert.ok(name.startsWith(CARRY))
  const got: any = acceptCarry(name, 'reload', undefined)
  assert.ok(got, 'accepted on a reload with no storage to check a nonce against')
  assert.equal(got.build.layout, '75')
  assert.equal(got.build.perKeyOverrides['1-1'].customText, 'Hi')
  assert.deepEqual(got.savedBuilds.map((b: any) => b.name), ['Build 0', 'Build 1', 'Build 2'])
  assert.equal(got.savedBuilds[0]!.layout, '60')
  assert.equal(acceptCarry(name, 'reload', NONCE)?.savedBuilds.length, 3, 'accepted with the nonce this page kept')
})

test('a carry another site put in window.name (a fresh open, not a reload) is refused', () => {
  const name = carryName(NONCE, payload())
  for (const nav of ['navigate', 'back_forward', 'prerender', undefined, '']) assert.equal(acceptCarry(name, nav, undefined), null, String(nav))
  // The old format (no nonce) is not a carry either.
  assert.equal(acceptCarry(CARRY + JSON.stringify(payload()), 'reload', undefined), null)
  // Where the page has storage, a nonce it did not keep (or none kept) is refused.
  assert.equal(acceptCarry(name, 'reload', 'f'.repeat(32)), null)
  assert.equal(acceptCarry(name, 'reload', null), null)
  // Not a carry at all, or not JSON / not an object.
  assert.equal(acceptCarry('somethingElse', 'reload', undefined), null)
  assert.equal(acceptCarry(CARRY + NONCE + ':not json', 'reload', undefined), null)
  assert.equal(acceptCarry(CARRY + NONCE + ':[1,2]', 'reload', undefined), null)
  assert.equal(acceptCarry(42 as any, 'reload', undefined), null)
})

test('a carry over the size cap is refused before it is parsed', () => {
  assert.equal(MAX_CARRY, 40 * 1024 * 1024)
  const head = CARRY + NONCE + ':'
  const huge = head + '{"build":{"layout":"75"},"pad":"' + 'x'.repeat(MAX_CARRY - head.length) + '"}'
  assert.ok(huge.length > MAX_CARRY)
  const parse = JSON.parse
  let parsed = 0
  JSON.parse = ((...a: Parameters<typeof JSON.parse>) => { parsed++; return parse(...a) }) as typeof JSON.parse
  try {
    assert.equal(acceptCarry(huge, 'reload', undefined), null)
  } finally {
    JSON.parse = parse
  }
  assert.equal(parsed, 0, 'never parsed')
})

test('a carry keeps at most the newest MAX_SAVED_BUILDS builds, each one rebuilt', () => {
  assert.equal(MAX_SAVED_BUILDS, 50)
  const p: any = payload(MAX_SAVED_BUILDS + 25)
  p.savedBuilds.push({ name: 'Bad', snap: 'nope' }, null, { name: '‮evil​', snap: { layout: '60', __proto__x: 1 }, img: 'javascript:alert(1)' })
  const got = acceptCarry(carryName(NONCE, p), 'reload', undefined)
  assert.ok(got)
  assert.ok(got.savedBuilds.length <= MAX_SAVED_BUILDS)
  const last = got.savedBuilds.at(-1)!
  assert.equal(last.name, 'evil', 'hidden characters are taken out of a carried name')
  assert.equal(last.img, undefined, 'an image that is not a PNG/JPEG data URL is dropped')
  assert.equal(Object.hasOwn(last.snap, '__proto__x'), false)
  assert.equal(got.savedBuilds[0]!.name, 'Build 28', 'the oldest are the ones let go')
})

test('the page reads the carry through acceptCarry, with the navigation type, and always empties window.name', () => {
  const app = EMBED + 'js/app.js'
  const take = slice(app, 'function takeCarry(', 'export function mountModkeys')
  assert.match(take, /performance\.getEntriesByType\('navigation'\)\[0\]\?\.type/)
  assert.match(take, /acceptCarry\(name, navType,/)
  assert.match(take, /window\.name = ''/)
  assert.doesNotMatch(code(app), /JSON\.parse\(raw\)/, 'no parse of window.name outside acceptCarry')
  const share = slice(app, 'if (res.ok) {', 'if (res.status === 504)')
  assert.match(share, /savedBuilds\.splice\(0, savedBuilds\.length - MAX_SAVED_BUILDS\)/, 'sharing keeps the cap too')
})

test('hidden characters are taken out of text: Arabic letter mark, word joiner and invisible operators, separators, tags', () => {
  const hidden = ['؜', '⁠', '⁡', '⁢', '⁣', '⁤', ' ', ' ', '\u{e0000}', '\u{e0001}', '\u{e0041}', '\u{e007f}',
    '​', '‮', '⁦', '﻿', '\u0000', '\u009f']
  for (const c of hidden) assert.equal(cleanText('a' + c + 'b', 64), 'ab', 'U+' + c.codePointAt(0)!.toString(16))
  assert.equal(cleanText('Esc\nline', 64), 'Esc\nline', 'a newline stays')
  assert.equal(cleanText('ünï 字 😀 مرحبا', 64), 'ünï 字 😀 مرحبا', 'ordinary text and emoji stay')
})

test('the gallery says when it shows only the newest builds the server sent', () => {
  const modals = EMBED + 'js/ui/modals.js'
  const src = slice(modals, 'export function galleryNote(', 'export function openGallery')
  const galleryNote = new Function(src.replace('export function', 'return function'))()
  assert.match(galleryNote(60, 500, true), /Showing 60 of the newest 500 builds\./)
  assert.match(galleryNote(40, 40, true), /Showing the newest 40 builds\./)
  assert.match(galleryNote(60, 100, false), /Showing 60 of 100 builds\./)
  assert.equal(galleryNote(10, 10, false), '')
  assert.match(slice(modals, 'export function openGallery', 'export function openSwitchesModal'), /galleryNote\([^)]*community\.more === true\)/)
  assert.match(slice(EMBED + 'js/app.js', 'async function fetchGallery', 'window.__MODKEYS__.loadGallery'), /gc\.more = data\.more === true/)
})

test("share errors show the server's own words for a limit, a failure upstream or a pause", () => {
  const share = slice(EMBED + 'js/app.js', 'if (res.status === 504)', 'window.__MODKEYS__.shareBuild')
  assert.match(share, /res\.status === 429 \|\| res\.status === 502 \|\| res\.status === 503/)
  assert.match(share, /body\?\.error/)
  assert.match(share, /Sharing is paused/)
})

test('a dialog makes the rest of the page inert while it is open', () => {
  const modals = EMBED + 'js/ui/modals.js'
  assert.match(slice(modals, 'function setPageInert(', 'export function closeModal'), /el\.inert = true/)
  assert.match(slice(modals, 'export function closeModal', 'export function isModalOpen'), /setPageInert\(false\)/)
  assert.match(slice(modals, 'export function openModal', 'const cwName'), /setPageInert\(true\)/)
})

test('direct scene changes ask for a frame: thumbnails end with the live board drawn, reduced-motion hover asks for one', () => {
  const end = slice(EMBED + 'js/app.js', 'function endThumbRender(', 'function setFinish(')
  assert.match(end, /ctrl\.apply\(\);\s*uni\.uTime\.value = save\.uTime;\s*renderer\.render\(scene, camera\);/)
  const controls = EMBED + 'js/core/controls.js'
  const hover = slice(controls, 'if (state.selectedKey) {', 'function settleCap')
  assert.ok((hover.match(/requestRender\(\)/g) || []).length >= 2, 'freeze and reduced-motion hover branches')
  assert.match(slice(controls, 'function settleCap(', 'let lastClickKey'), /requestRender\(\)/)
  assert.match(slice(controls, 'export function flyTo(', 'const twoPi'), /requestRender\(\)/)
  assert.match(slice(controls, 'function setExplode(', 'capsGroup.children.forEach((c) => {\n    gsap'), /requestRender\(\)/)
})

test('the keycap colour pickers are at least 32px tall', () => {
  const css = readFileSync(EMBED + 'css/components.css', 'utf8')
  const rule = css.match(/\.hexInput \{[^}]*\}/)
  assert.ok(rule)
  const h = Number(rule[0].match(/height:\s*(\d+)px/)?.[1])
  assert.ok(h >= 32, 'height ' + h)
})

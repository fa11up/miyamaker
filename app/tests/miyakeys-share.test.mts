// miyakeys share links, decoding and the rules for outside text and ids (embed/miyakeys/js/core/shrinker.js and
// validBuild.js), plus source checks for the gallery and the on-demand drawing in app.js. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// shareURL reads the page's own address (host.js) when no window told it one.
;(globalThis as any).window ??= { location: { href: 'https://www.miyamaker.com/embed/miyakeys/index.html' } }

const { MAX_SHARE_URL, decodeState, encodeState, hasKeyImages, shareURL } = await import(
  '../embed/miyakeys/js/core/shrinker.js'
)
const { MAX_LEGEND, MAX_OVERRIDES, cleanText, isGalleryId, isHex, validGalleryEntry } = await import(
  '../embed/miyakeys/js/core/validBuild.js'
)
const { PRESETS } = await import('../embed/miyakeys/js/data/presets.js')

const IMAGE = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024 - 64)
const withImage = {
  layout: '75',
  colorway: 'claude',
  view: '3d',
  perKeyOverrides: { '0-0': { customText: 'Esc', imageData: IMAGE }, '0-1': { bgColor: '#112233' } },
}

test('a share link never carries key images, keeps everything else, and says when images were left out', () => {
  assert.equal(hasKeyImages(withImage), true)
  assert.equal(hasKeyImages({ perKeyOverrides: { '0-1': { bgColor: '#112233' } } }), false)
  const url = shareURL(withImage)
  assert.ok(url, 'a link is made')
  assert.ok(url.length < 2048, `a few hundred bytes, not megabytes (${url.length})`)
  assert.doesNotMatch(url, /data:image|AAAAAAAA/)
  const back = decodeState(new URL(url).hash.slice(1)) as Record<string, any>
  assert.equal(back.layout, '75')
  assert.equal(back.perKeyOverrides['0-0'].customText, 'Esc')
  assert.equal(back.perKeyOverrides['0-0'].imageData, undefined)
  assert.equal(back.perKeyOverrides['0-1'].bgColor, '#112233')
  assert.equal(back.view, undefined, 'viewer state is not in a link')
})

test('the largest build a person can make still fits a link under the cap', () => {
  const perKeyOverrides: Record<string, unknown> = {}
  for (let i = 0; i < MAX_OVERRIDES; i++) {
    // Three UTF-8 bytes a character, and quotes JSON escapes: as long as a legend gets.
    perKeyOverrides[`${Math.floor(i / 20)}-${i % 20}`] = {
      customText: '漢"'.repeat(MAX_LEGEND / 2),
      bgColor: '#112233',
      fgColor: '#445566',
      fontSize: 48,
      imageFit: 'sticker',
      glow: true,
      labelHidden: false,
      imageBehindText: true,
      imageData: IMAGE,
    }
  }
  const url = shareURL({ layout: '75', customColors: null, perKeyOverrides })
  assert.ok(url, 'a link is made')
  assert.ok(url.length <= MAX_SHARE_URL, `${url.length} <= ${MAX_SHARE_URL}`)
  assert.ok(MAX_SHARE_URL < 2 * 1024 * 1024, 'far below the 2 MB browsers refuse')
})

test('a link over the cap is refused (empty), never handed out', () => {
  const huge = 'x'.repeat(MAX_SHARE_URL)
  ;(globalThis as any).window.location.href = 'https://www.miyamaker.com/miyakeys?' + huge
  try {
    assert.equal(shareURL({ layout: '75' }), '')
  } finally {
    ;(globalThis as any).window.location.href = 'https://www.miyamaker.com/embed/miyakeys/index.html'
  }
})

test('encode and decode round-trip UTF-8 legends, and junk is not a build', () => {
  const b = { layout: '60', perKeyOverrides: { '1-1': { customText: 'ключ 漢字 🎹\nzwei' } } }
  const back = decodeState(encodeState(b)) as Record<string, any>
  assert.equal(back.perKeyOverrides['1-1'].customText, 'ключ 漢字 🎹\nzwei')
  assert.equal(decodeState('%%%not base64'), null)
  assert.equal(decodeState(btoa('\xff\xfe{')), null, 'bytes that are not UTF-8')
  assert.equal(decodeState(encodeState({ nothing: 1 })), null)
})

test('a 16 MB hash decodes quickly (no per-character strings)', () => {
  const enc = encodeState(withImage)
  const big = encodeState({ ...withImage, perKeyOverrides: { ...withImage.perKeyOverrides, '0-2': { customText: 'y'.repeat(12 * 1024 * 1024) } } })
  assert.ok(big.length >= 16 * 1024 * 1024, `${big.length}`)
  const t0 = performance.now()
  const back = decodeState(big) as Record<string, any>
  const ms = performance.now() - t0
  assert.equal(back.perKeyOverrides['0-2'].customText.length, MAX_LEGEND)
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`)
  assert.ok(decodeState(enc))
})

test('colours are #rgb or #rrggbb only: alpha and odd lengths (drawn white by three.js) are refused', () => {
  for (const ok of ['#fff', '#FFF', '#a1b2c3', '#A1B2C3']) assert.equal(isHex(ok), true, ok)
  for (const bad of ['#ffff', '#fffff', '#1234567', '#11223344', '#ff', 'fff', '#ggg', '#fff ']) assert.equal(isHex(bad), false, bad)
})

test('text loses control, C1, zero-width, bidi-override and BOM characters; a newline stays', () => {
  const hidden = '\u0007\u0085\u009f​‌‍‎‏‪‫‬‭‮⁦⁧⁨⁩﻿'
  assert.equal(cleanText(`a${hidden}b\nc`, 64), 'ab\nc')
  assert.equal(cleanText('‮gnp.exe', 64), 'gnp.exe')
  assert.equal(cleanText('Café  ok', 64), 'Café  ok', 'ordinary non-ASCII stays')
})

test('gallery ids: no prototype names and no featured build ids', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', ...PRESETS.map((p: { id: string }) => p.id)]) {
    assert.equal(isGalleryId(id), false, id)
    assert.equal(validGalleryEntry({ id, name: 'x', snap: { layout: '75' } }), null, id)
  }
  assert.equal(isGalleryId('abc_123-XYZ'), true)
  assert.equal(validGalleryEntry({ id: 'abc_123', name: 'x', snap: { layout: '75' } })?.id, 'abc_123')
})

const app = readFileSync('embed/miyakeys/js/app.js', 'utf8')
const modals = readFileSync('embed/miyakeys/js/ui/modals.js', 'utf8')

test('the gallery: a list fetched before a share is not kept, and only shares the gallery took join Your builds', () => {
  assert.match(app, /if \(res\.ok\) \{\s*savedBuilds\.push\(mine\);\s*[\s\S]{0,200}galleryGen\+\+/)
  assert.equal((app.match(/savedBuilds\.push\(/g) ?? []).length, 2, 'on success, and when a reload carries them back')
  assert.match(app, /if \(gen === galleryGen\) window\.__MODKEYS__\.galleryCache = gc/)
  assert.match(app, /return gen === galleryGen \? list : loadGallery\(\)/)
  // Thumbnails: Maps, featured and community apart.
  assert.match(app, /const presetThumbs = new Map\(\)/)
  assert.match(app, /const communityThumbs = new Map\(\)/)
  assert.doesNotMatch(app + modals, /thumbs\[/)
})

test('the gallery dialog: a late answer is dropped, and only one thumbnail loop runs', () => {
  assert.match(modals, /if \(mine !== shown \|\| !\$\('modal'\)/)
  assert.match(modals, /if \(stopThumbs\) stopThumbs\(\);\s*stopThumbs = renderThumbs\(/)
})

test('thumbnails follow loadSnap: a build\'s own colours before its colourway', () => {
  const fn = app.slice(app.indexOf('function renderSnapThumb'), app.indexOf('function genThumbs'))
  assert.match(fn, /const cw = keys\.customColors \|\| COLORWAYS\[keys\.colorway\]/)
  assert.match(fn, /rebuildBoard\(\)/)
  assert.match(fn, /approx = true/)
})

test('drawing is on demand: a frame only when something changed, and nothing while hidden or minimised', () => {
  const tick = app.slice(app.indexOf('function tick('), app.indexOf('function startLoop')).trimEnd()
  assert.match(tick, /if \(!running\(\)\) return;/)
  assert.match(tick, /if \(dirty \|\| moved \|\| gliding \|\| animating\) \{[\s\S]*renderer\.render\(scene, camera\)[\s\S]*requestAnimationFrame\(tick\)[\s\S]*\}\s*\}$/)
  // The undo/redo buttons are touched only when what they show changes.
  assert.match(app, /if \(shown === undoShown\) return;/)
  assert.match(app, /!reducedMotion\.matches && \(state\.light\.mode === 'wave' \|\| state\.light\.mode === 'breathe'\)/)
  assert.doesNotMatch(app, /THREE\.Clock/)
})

test('links say when key images are left out', () => {
  assert.match(app, /Key images aren\\'t included in links/)
  assert.match(modals, /Key images aren\\'t included in links/)
})

test('the dialog is a dialog: role, aria-modal, a label, and focus in and back out', () => {
  const html = readFileSync('embed/miyakeys/index.html', 'utf8')
  assert.match(html, /class="modalCard" role="dialog" aria-modal="true" aria-labelledby="modalTitle"/)
  assert.match(modals, /card\.focus\(/)
  assert.match(modals, /opener\.focus\(\)/)
})

test('Share to gallery is a button, not a form submit (the sandbox blocks submission before any submit event)', () => {
  assert.match(modals, /<button type="button" class="libBtn shareGo" id="shareGo">/)
  assert.doesNotMatch(modals, /addEventListener\('submit'/)
  assert.match(app, /ev\.key === 'Enter' && submitDialog\(ev\.target\)/)
})

// embed/miyakeys/js/core/validBuild.js: every build from outside (share links, the gallery, undo) is rebuilt from an
// allowlist. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BRIGHT_MAX,
  FONT_MAX,
  FONT_MIN,
  MAX_IMAGE_DATA,
  MAX_LEGEND,
  MAX_NAME,
  MAX_OVERRIDES,
  validBuild,
  validGalleryEntry,
} from '../embed/miyakeys/js/core/validBuild.js'
import { layoutOf, LAYOUTS } from '../embed/miyakeys/js/data/layouts.js'

type Build = Record<string, any>
const build = (raw: unknown, opts?: { images?: boolean }) => validBuild(raw, opts) as Build | null

const good = {
  layout: '75',
  profile: 'cherry',
  brand: 'claude',
  colorway: 'claude',
  caseColor: 'porcelain',
  caseCustomColor: null,
  finish: 'anodized',
  plate: 'brass',
  plateColor: '#a5813a',
  sw: 'boba',
  switchColor: null,
  material: 'pbt',
  light: { mode: 'breathe', color: '#cc785c', bright: 0.7 },
  extras: { knob: true, cable: false, wrist: true, lube: false },
  customColors: null,
  perKeyOverrides: { '0-0': { bgColor: '#112233', customText: 'Esc', glow: true, fontSize: '32' }, knob: { markId: 'wave' } },
}

test('a real build comes through whole (fontSize strings become numbers)', () => {
  const b = build(good)!
  assert.equal(b.layout, '75')
  assert.equal(b.plateColor, '#a5813a')
  assert.equal(b.caseCustomColor, null)
  assert.deepEqual(b.light, good.light)
  assert.deepEqual(b.extras, good.extras)
  assert.deepEqual({ ...b.perKeyOverrides }, {
    '0-0': { bgColor: '#112233', customText: 'Esc', glow: true, fontSize: 32 },
    knob: { markId: 'wave' },
  })
  // A number layout (an older link) is the same layout.
  assert.equal(build({ layout: 60 })!.layout, '60')
})

test('not an object is not a build', () => {
  for (const raw of [null, undefined, 1, 'x', [], [good], true]) assert.equal(build(raw), null)
})

test('viewer state never comes from outside: view, tool, theme, section, selection are dropped', () => {
  const b = build({ ...good, view: 'top', tool: 'pan', theme: 'dark', section: '<img src=x onerror=alert(1)>', selectedKeys: ['0-0'], selectedKey: '0-0', exploded: true, selectedPreset: 'x', multiSelectMode: true })!
  for (const k of ['view', 'tool', 'theme', 'section', 'selectedKeys', 'selectedKey', 'exploded', 'selectedPreset', 'multiSelectMode'])
    assert.equal(Object.hasOwn(b, k), false, k)
})

test('enums must be own keys of their tables: no prototype names, no unknown values', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '99', '', '<b>', 'claude ']) {
    const b = build({ layout: bad, profile: bad, brand: bad, colorway: bad, caseColor: bad, finish: bad, plate: bad, sw: bad, material: bad })!
    assert.deepEqual(b, {}, bad)
  }
  assert.deepEqual(build({ light: { mode: 'constructor' }, perKeyOverrides: { '0-0': { imageFit: '__proto__', markId: 'toString' } } }), {
    perKeyOverrides: Object.create(null),
  })
})

test('colours are hex only: no url(), names, expressions or markup', () => {
  for (const bad of ['url(https://evil.example/x.png)', 'red', 'expression(alert(1))', '#12', '#1234567890', '#zzzzzz', '#fff;background:url(x)', '"><script>', 'javascript:alert(1)', 42, {}, []]) {
    const b = build({
      caseCustomColor: bad,
      plateColor: bad,
      switchColor: bad,
      light: { color: bad },
      customColors: { a: { bg: bad, fg: '#fff' }, m: { bg: '#000', fg: '#fff' }, x: { bg: '#000', fg: '#fff' } },
      perKeyOverrides: { '0-0': { bgColor: bad, fgColor: bad } },
    })!
    assert.deepEqual({ ...b, perKeyOverrides: { ...b.perKeyOverrides } }, { perKeyOverrides: {} }, String(bad))
  }
  for (const ok of ['#fff', '#FFFFFF']) assert.equal(build({ plateColor: ok })!.plateColor, ok)
  // Alpha and odd lengths: three.js draws them white.
  for (const bad of ['#1234', '#12345', '#1234567', '#11223344']) assert.equal(build({ plateColor: bad })!.plateColor, undefined)
})

test('customColors needs all three roles with both colours, or is left out', () => {
  assert.equal(Object.hasOwn(build({ customColors: { a: { bg: '#fff', fg: '#000' } } })!, 'customColors'), false)
  assert.equal(build({ customColors: null })!.customColors, null)
  const full = { a: { bg: '#fff', fg: '#000' }, m: { bg: '#111', fg: '#eee' }, x: { bg: '#222', fg: '#ddd', extra: 'x' } }
  assert.deepEqual(build({ customColors: full })!.customColors, { a: full.a, m: full.m, x: { bg: '#222', fg: '#ddd' } })
})

test('numbers are finite and clamped', () => {
  assert.equal(build({ light: { bright: 99 } })!.light.bright, BRIGHT_MAX)
  assert.equal(build({ light: { bright: -5 } })!.light.bright, 0)
  assert.equal(build({ light: { bright: 'NaN' } })!.light, undefined)
  assert.equal(build({ light: { bright: Infinity } })!.light, undefined)
  const fs = (v: unknown) => build({ perKeyOverrides: { '1-1': { fontSize: v, glow: true } } })!.perKeyOverrides['1-1'].fontSize
  assert.equal(fs(1e9), FONT_MAX)
  assert.equal(fs(-3), FONT_MIN)
  assert.equal(fs('abc'), undefined)
  assert.equal(fs(null), undefined)
})

test('per-key ids are row-col or knob, and the map has no prototype', () => {
  const raw = JSON.parse(
    '{"perKeyOverrides":{"__proto__":{"glow":true},"constructor":{"glow":true},"prototype":{"glow":true},"0-0":{"glow":true},"knob":{"glow":true},"a-b":{"glow":true},"1-2-3":{"glow":true},"999-1":{"glow":true},"0-0 ":{"glow":true}}}'
  )
  const pk = build(raw)!.perKeyOverrides
  assert.equal(Object.getPrototypeOf(pk), null)
  assert.deepEqual(Object.keys(pk).sort(), ['0-0', 'knob'])
  assert.equal(({} as Record<string, unknown>).glow, undefined, 'Object.prototype untouched')
  // An override with nothing valid in it is left out.
  assert.deepEqual(Object.keys(build({ perKeyOverrides: { '0-0': { nope: 1 } } })!.perKeyOverrides), [])
})

test('a hostile __proto__ at the top of a build does not reach the result or Object.prototype', () => {
  const b = build(JSON.parse('{"__proto__":{"layout":"60","polluted":true},"constructor":{"prototype":{"polluted":true}}}'))!
  assert.deepEqual(b, {})
  assert.equal(b.layout, undefined)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('per-key overrides are capped in number', () => {
  const many: Record<string, unknown> = {}
  for (let r = 0; r < 20; r++) for (let c = 0; c < 20; c++) many[`${r}-${c}`] = { glow: true }
  assert.equal(Object.keys(build({ perKeyOverrides: many })!.perKeyOverrides).length, MAX_OVERRIDES)
})

test('images are PNG/JPEG base64 data URLs under the cap; http, svg and markup are dropped', () => {
  const img = (v: unknown) => build({ perKeyOverrides: { '0-0': { imageData: v, glow: true } } })!.perKeyOverrides['0-0'].imageData
  assert.equal(img('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(img('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ')
  for (const bad of [
    'http://evil.example/x.png',
    'https://evil.example/x.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,abc"><script>alert(1)</script>',
    'data:image/png,rawbytes',
    'javascript:alert(1)',
    'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_DATA),
  ])
    assert.equal(img(bad), undefined, bad.slice(0, 40))
  // The gallery never stores images.
  const noImages = build({ perKeyOverrides: { '0-0': { imageData: 'data:image/png;base64,AAAA' } } }, { images: false })!
  assert.deepEqual(Object.keys(noImages.perKeyOverrides), [])
})

test('text is length-capped and control characters go (a two-line legend keeps its newline)', () => {
  const text = (v: unknown) => build({ perKeyOverrides: { '0-0': { customText: v } } })!.perKeyOverrides['0-0']?.customText
  assert.equal(text('x'.repeat(10_000)).length, MAX_LEGEND)
  assert.equal(text('A\nB'), 'A\nB')
  assert.equal(text('A\u0000\u001b[31mB\u007f'), 'A[31mB')
  assert.equal(text('<b>"`'), '<b>"`', 'legends are real characters; they only reach canvas and escaped markup')
  assert.equal(text(12), undefined)
})

test('gallery entries: a usable id and build, a capped name, layout taken from the build', () => {
  const e = validGalleryEntry({ id: 'd7f36c88-0512-4939-b94f-6b77debe8fbe', name: 'n'.repeat(500) + '\nx', layout: '<script>', createdAt: '2026-11-12T04:21:49.249Z', snap: good, extra: 1 }) as Build
  assert.equal(e.name.length, MAX_NAME)
  assert.equal(e.layout, '75')
  assert.equal(e.createdAt, '2026-11-12T04:21:49.249Z')
  assert.equal(Object.hasOwn(e, 'extra'), false)
  for (const bad of [
    { id: '"><img src=x onerror=alert(1)>', snap: good },
    { id: '', snap: good },
    { id: 7, snap: good },
    { id: 'ok', snap: { layout: 'nope', view: 'top' } },
    { id: 'ok' },
    null,
    'x',
  ])
    assert.equal(validGalleryEntry(bad), null, JSON.stringify(bad))
  assert.equal((validGalleryEntry({ id: 'a', name: '   ', snap: good }) as Build).name, 'Untitled build')
  assert.equal(Object.hasOwn(validGalleryEntry({ id: 'a', createdAt: 'yesterday<b>', snap: good }) as Build, 'createdAt'), false)
})

test('a bad layout id never leaves the board without one', () => {
  assert.equal(layoutOf('75'), LAYOUTS['75'])
  assert.equal(layoutOf(60), LAYOUTS['60'])
  for (const bad of ['__proto__', 'constructor', 'toString', '99', undefined, null]) assert.equal(layoutOf(bad), LAYOUTS['75'])
})

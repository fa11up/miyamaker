// src/pages/Mint/handheld/status.ts: the lamp, the D-pad's sums and how the device fits a screen. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BufferGeometry, Material } from 'three'
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three'

import { HALO } from '../src/pages/Mint/handheld/chimes.ts'
import { DEFAULT_LOOK, parseLook, pathPoints, rightEdge, SHAPES, TINTS } from '../src/pages/Mint/handheld/look.ts'
import { fedWords, parsePet, petImage } from '../src/pages/Mint/handheld/petData.ts'
import { release } from '../src/pages/Mint/handheld/release.ts'
import {
  deviceZoom,
  MAX_ZOOM,
  panBy,
  pixelRatio,
  statusLamp,
  stepQuantity,
  wrapIndex,
  zoomAt,
} from '../src/pages/Mint/handheld/status.ts'

test('an open mint is lit green, and a chain we cannot read says so once loading is over', () => {
  assert.deepEqual(statusLamp('open', false), { tone: 'ok', label: 'Mint open' })
  assert.deepEqual(statusLamp('unknown', true), { tone: 'off', label: 'Checking…' })
  assert.deepEqual(statusLamp('unknown', false), { tone: 'warn', label: 'Can’t reach chain' })
})

test('the D-pad wraps round its choices both ways', () => {
  assert.equal(wrapIndex(3, 2, 1), 0)
  assert.equal(wrapIndex(3, 0, -1), 2)
  assert.equal(wrapIndex(0, 0, 1), 0)
})

test('quantity stays between 1 and what can be minted', () => {
  assert.equal(stepQuantity(1, -1, 10), 1)
  assert.equal(stepQuantity(10, 1, 10), 10)
  assert.equal(stepQuantity(3, 1, 10), 4)
  assert.equal(stepQuantity(1, 1, 0), 1)
})

test('the device only ever shrinks to fit', () => {
  assert.equal(deviceZoom(1440, 900, 432, 800), 1)
  assert.equal(deviceZoom(390, 756, 432, 800), 0.9)
  assert.equal(deviceZoom(0, 0, 432, 800), 1)
})

test('grape is the default shell, and anything unknown in storage falls back to it', () => {
  assert.equal(DEFAULT_LOOK.tint, 'grape')
  assert.equal(TINTS[0]!.id, 'grape')
  assert.deepEqual(parseLook(null), DEFAULT_LOOK)
  assert.deepEqual(parseLook('not json'), DEFAULT_LOOK)
  assert.deepEqual(parseLook('{"tint":"nope","shape":"nope"}'), DEFAULT_LOOK)
  assert.deepEqual(parseLook('{"tint":"lime","shape":"palm"}'), { tint: 'lime', shape: 'palm' })
  assert.deepEqual(parseLook('{"tint":"lime","shape":"pebble"}'), { tint: 'lime', shape: 'palm' })
  assert.equal(DEFAULT_LOOK.shape, 'palm')
})

test('every body is a closed outline, and its side buttons mount on its edge', () => {
  for (const b of SHAPES) {
    const pts = pathPoints(b.path)
    assert.ok(pts.length > 20, b.id)
    assert.ok(
      pts.every(([x, y]) => x >= -1 && x <= b.w + 1 && y >= -12 && y <= b.h + 12),
      b.id,
    )
    const edge = rightEdge(b.path, 200)
    assert.ok(edge > b.w * 0.8 && edge <= b.w, `${b.id} ${edge}`)
    // The screen, 380 wide, has to fit inside the body at every height it spans.
    for (const y of [40, 200, 330, 500]) {
      assert.ok(rightEdge(b.path, y) >= b.w / 2 + 190, `${b.id} at ${y}: ${rightEdge(b.path, y)}`)
    }
  }
})

test('the chime stays quiet and short enough for the opening', () => {
  for (const n of HALO) {
    assert.ok(n.gain <= 0.05)
    assert.ok(n.at + n.len <= 3)
  }
})

test('the hologram zooms round the pointer and never shows past the image', () => {
  const fit = { zoom: 1, x: 0, y: 0 }
  assert.deepEqual(zoomAt(fit, 0.5, 100, 100, 400), fit)
  assert.deepEqual(zoomAt(fit, 2, 200, 200, 400), { zoom: 2, x: -200, y: -200 })
  assert.deepEqual(zoomAt(fit, 2, 0, 0, 400), { zoom: 2, x: 0, y: 0 })
  assert.equal(zoomAt(fit, 100, 0, 0, 400).zoom, MAX_ZOOM)
  // Back to fit, it lands square however far it had been panned.
  assert.deepEqual(zoomAt({ zoom: 2, x: -400, y: -400 }, 0.5, 0, 0, 400), fit)
  assert.deepEqual(panBy(fit, 50, 50, 400), fit)
  assert.deepEqual(panBy({ zoom: 2, x: -100, y: -100 }, -900, 40, 400), { zoom: 2, x: -400, y: -60 })
})

test('Fren Pet: a pet reads plainly, a gone pet says so, and only on-chain art is shown', () => {
  const owner = '0xc2Cd6C982d5Ba787c70d47c5BD2FEdEE21160CC2'
  const zero = '0x0000000000000000000000000000000000000000'
  const pet = parsePet(1, ['Imagine‮', 0n, 10261136697566812713n, 226n, 2000n, 0n, 0n, owner, 0n], [495n, 521n], 1000)
  assert.equal(pet.name, 'Imagine')
  assert.equal(pet.points, 10261136n)
  assert.equal(pet.alive, true)
  assert.equal(fedWords(pet.fedFor), 'Fed for 17m')
  assert.equal(parsePet(5, ['', 4n, 0n, 1n, 0n, 0n, 0n, zero, 0n], [10n, 10n], 1000).alive, false)
  assert.equal(parsePet(5, ['', 4n, 0n, 1n, 0n, 0n, 0n, zero, 0n], [10n, 10n], 1000).name, 'Pet #5')
  assert.equal(fedWords(0), 'Hungry')
  assert.ok(
    petImage(`data:application/json;utf8,{"image": "data:image/svg+xml;utf8,<svg x='1'></svg>"}`)?.startsWith(
      'data:image/svg+xml',
    ),
  )
  assert.equal(petImage('https://evil.example/x.json'), undefined)
})

test('the 3D body keeps a phone at 1.5x and a slow machine at 1x, whatever else changes', () => {
  assert.equal(pixelRatio(3, false, false), 2)
  assert.equal(pixelRatio(3, true, false), 1.5)
  assert.equal(pixelRatio(1, true, false), 1)
  assert.equal(pixelRatio(0, false, false), 1)
  assert.equal(pixelRatio(3, false, true), 1)
  assert.equal(pixelRatio(3, true, true), 1)
})

test('a rebuild frees its own materials and textures but leaves the shared ones for the next build', () => {
  const freed: string[] = []
  const watch = <T extends Texture | Material | BufferGeometry>(name: string, it: T) => {
    it.addEventListener('dispose', () => freed.push(name))
    return it
  }
  const shared = watch('shared', new MeshStandardMaterial())
  const map = watch('map', new Texture())
  const bump = watch('bump', new Texture())
  const own = watch('own', new MeshStandardMaterial({ map, bumpMap: bump }))
  const group = new Group()
  const inner = new Group()
  group.add(new Mesh(watch('geo1', new PlaneGeometry(1, 1)), shared))
  inner.add(new Mesh(watch('geo2', new PlaneGeometry(1, 1)), own))
  inner.add(new Mesh(watch('geo3', new PlaneGeometry(1, 1)), own))
  group.add(inner)

  release(group, new Set([shared]))
  assert.deepEqual(freed.sort(), ['bump', 'geo1', 'geo2', 'geo3', 'map', 'own'])

  freed.length = 0
  release(group)
  assert.ok(freed.includes('shared'))
})

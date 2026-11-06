// How My Files sizes a popup to its artwork. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fitArtwork, isPixelArt } from '../src/desktop/files/fitArtwork.ts'

const DESK = { w: 1400, h: 860 }
const shape = (a: { w: number; h: number }) => a.w / a.h
const near = (a: number, b: number, within = 0.02) => assert.ok(Math.abs(a - b) <= within, `${a} is not near ${b}`)

test('a picture keeps its shape, whatever the shape', () => {
  for (const natural of [
    { w: 4000, h: 1000 },
    { w: 1920, h: 1080 },
    { w: 1000, h: 1000 },
    { w: 1907, h: 2668 },
    { w: 600, h: 1800 },
    { w: 32, h: 32 },
  ]) {
    near(shape(fitArtwork(natural, DESK).art), natural.w / natural.h)
  }
})

test('wide pieces stack, tall and square ones sit beside their details', () => {
  assert.equal(fitArtwork({ w: 1920, h: 1080 }, DESK).layout, 'stacked')
  assert.equal(fitArtwork({ w: 1000, h: 1000 }, DESK).layout, 'beside')
  assert.equal(fitArtwork({ w: 1000, h: 2000 }, DESK).layout, 'beside')
})

test('the box follows the picture', () => {
  assert.ok(fitArtwork({ w: 600, h: 1800 }, DESK).width < fitArtwork({ w: 1000, h: 1000 }, DESK).width)
})

test('small pictures come up to size', () => {
  assert.equal(fitArtwork({ w: 32, h: 32 }, DESK).art.h, 460)
})

test('it never outgrows the desktop', () => {
  for (const room of [
    { w: 800, h: 500 },
    { w: 390, h: 700 },
  ]) {
    for (const natural of [
      { w: 4000, h: 1000 },
      { w: 1000, h: 1000 },
      { w: 600, h: 1800 },
    ]) {
      const fit = fitArtwork(natural, room)
      assert.ok(fit.width <= room.w, `${fit.width} wide in ${room.w}`)
      assert.ok(fit.art.h + 50 <= room.h, `${fit.art.h} tall in ${room.h}`)
      near(shape(fit.art), natural.w / natural.h, 0.6)
    }
  }
})

test('a phone stacks even a tall piece', () => {
  assert.equal(fitArtwork({ w: 600, h: 1800 }, { w: 390, h: 700 }).layout, 'stacked')
})

test('no size yet means a square', () => {
  assert.equal(fitArtwork(undefined, DESK).art.w, fitArtwork(undefined, DESK).art.h)
  assert.equal(fitArtwork({ w: 0, h: 0 }, DESK).art.w, fitArtwork(undefined, DESK).art.w)
})

test('only small pictures are drawn as blocks', () => {
  assert.ok(isPixelArt({ w: 64, h: 64 }))
  assert.ok(!isPixelArt({ w: 1000, h: 1000 }))
  assert.ok(!isPixelArt(undefined))
})

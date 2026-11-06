// The sums behind the Space Station map and the radio's picture. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bearing, compass, destination, mapSegments, nightSide, viewFan } from '../src/pages/TV/issMath.ts'
import { buildPalette, firstMode, seedOf, VIZ_MODES } from '../src/pages/TV/visuals.ts'

const near = (a: number, b: number, within = 1) => assert.ok(Math.abs(a - b) <= within, `${a} is not near ${b}`)

test('bearings and compass words', () => {
  near(bearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 }), 0)
  near(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }), 90)
  near(bearing({ lat: 0, lon: 0 }, { lat: -10, lon: 0 }), 180)
  near(bearing({ lat: 0, lon: 10 }, { lat: 0, lon: 0 }), 270)
  assert.equal(compass(0), 'north')
  assert.equal(compass(359), 'north')
  assert.equal(compass(46), 'northeast')
  assert.equal(compass(180), 'south')
})

test('a bearing crosses the edge of the map the short way', () => {
  near(bearing({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }), 90)
})

test('walking along a bearing', () => {
  const north = destination({ lat: 0, lon: 0 }, 0, 111.2)
  near(north.lat, 1, 0.01)
  near(north.lon, 0, 0.01)
  const over = destination({ lat: 0, lon: 179.5 }, 90, 111.2)
  near(over.lon, -179.5, 0.01)
})

test('a line breaks at the edge of the map', () => {
  const lines = mapSegments([
    { lat: 0, lon: 170 },
    { lat: 1, lon: 178 },
    { lat: 2, lon: -176 },
    { lat: 3, lon: -170 },
  ])
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '170.0,0.0 178.0,-1.0')
})

test('the view fan is dropped rather than drawn across the map', () => {
  assert.ok(viewFan({ lat: 0, lon: 0 }, 90, 2000))
  assert.equal(viewFan({ lat: 0, lon: 178 }, 90, 2000), undefined)
})

test('night is on the far side from the sun, and at the pole tilted away', () => {
  const night = nightSide({ lat: 20, lon: 0 })
  assert.ok(night.startsWith('-180,90'), 'south pole dark when the sun is north')
  assert.ok(nightSide({ lat: -20, lon: 0 }).startsWith('-180,-90'), 'north pole dark when the sun is south')
  assert.ok(!nightSide({ lat: 0, lon: 0 }).includes('NaN'), 'the equinox still draws')
  assert.ok(!night.includes('NaN'))
})

test('a track always gets the same look, and tracks differ', () => {
  assert.equal(seedOf('community:abc'), seedOf('community:abc'))
  assert.notEqual(seedOf('community:abc'), seedOf('community:abd'))
  const first = firstMode(seedOf('community:abc'))
  assert.ok(first >= 0 && first < VIZ_MODES.length)
  const modes = new Set(Array.from({ length: 40 }, (_, i) => firstMode(seedOf(`track-${i}`))))
  assert.ok(modes.size > 1)
})

test('a palette runs from its first colour to its last', () => {
  const palette = buildPalette([
    [0, 0, 0],
    [255, 255, 255],
  ])
  assert.equal(palette.length, 256)
  assert.deepEqual(palette[0], [0, 0, 0])
  assert.deepEqual(palette[255], [255, 255, 255])
})

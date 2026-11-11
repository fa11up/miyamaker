import assert from 'node:assert/strict'
import test from 'node:test'

import { layersTarget } from '../api/_lib/layers.ts'
import { parseLayerIndex } from '../src/pages/MiyaMakerStudio/catalog.ts'

const page = `
<a href="/miyamaker/layers/">Parent Directory</a>
<a href="/_autoindex/assets/css/autoindex.css">css</a>
<a href="?ND">Name</a>
<a href="/miyamaker/layers/BG/">BG</a>
<a href="/miyamaker/layers/Nose/Hangry%20Blush.png">Hangry Blush.png</a>
<a href="/miyamaker/layers/Hat/Cap%2320.png">Cap#20.png</a>
`

test('an autoindex page lists its folders and pictures', () => {
  assert.deepEqual(parseLayerIndex(page, ''), [
    { kind: 'dir', name: 'BG', path: 'BG' },
  ])
  assert.deepEqual(parseLayerIndex(page, 'Nose'), [
    { kind: 'file', name: 'Hangry Blush.png', path: 'Nose/Hangry Blush.png' },
  ])
  assert.deepEqual(parseLayerIndex(page, 'Hat'), [
    { kind: 'file', name: 'Cap#20.png', path: 'Hat/Cap#20.png' },
  ])
})

test('a nested index does not walk back to its parent', () => {
  const nested = `
    <a href="/miyamaker/layers/Hair/">Parent Directory</a>
    <a href="/miyamaker/layers/Hair/Black%20Messy%20Short/Black%20Messy%20Short.png">Black Messy Short.png</a>
    <a href="/miyamaker/layers/Hair/Black%20Messy%20Short/z-3%2CBlack%20Messy%20Short.png">z-3,Black Messy Short.png</a>
  `
  assert.deepEqual(parseLayerIndex(nested, 'Hair/Black Messy Short').map((entry) => entry.name), [
    'Black Messy Short.png',
    'z-3,Black Messy Short.png',
  ])
})

test('the layers proxy stays inside the published folder', () => {
  assert.equal(layersTarget('/miyamaker-layers'), 'https://koolskull.com/miyamaker/layers/')
  assert.equal(layersTarget('/miyamaker-layers/'), 'https://koolskull.com/miyamaker/layers/')
  assert.equal(layersTarget('/miyamaker-layers/BG/'), 'https://koolskull.com/miyamaker/layers/BG/')
  assert.equal(
    layersTarget('/miyamaker-layers/Nose/Hangry%20Blush.png'),
    'https://koolskull.com/miyamaker/layers/Nose/Hangry%20Blush.png'
  )
  assert.equal(layersTarget('/miyamaker-layers/../etc/passwd'), null)
  assert.equal(layersTarget('/other'), null)
})

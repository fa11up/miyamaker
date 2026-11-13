import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aroundActive,
  cycleTrait,
  EMPTY_WEIGHT,
  ensureEmptyOptions,
  isEmptyOption,
  letterbox,
  metaText,
  nameError,
  orderLayers,
  sidebarLayers,
  parseMeta,
  parseTraitFile,
  previewStack,
  randomWorn,
  sidecarName,
  traitClash,
  traitFileName,
  traitPath,
  type Trait,
} from '../src/pages/MiyaMakerStudio/model.ts'
import { fileWeight } from '../src/pages/MiyaMakerStudio/publishedWeights.ts'
import { applyDrafts, type DraftRow } from '../src/pages/MiyaMakerStudio/drafts.ts'
import { unzip, zipStore } from '../src/pages/MiyaMakerStudio/zip.ts'

const trait = (patch: Partial<Trait> & Pick<Trait, 'id' | 'layer' | 'name'>): Trait => ({
  group: '',
  weight: 20,
  notes: '',
  fields: [],
  hidden: false,
  dirty: false,
  diskName: null,
  file: null,
  draft: null,
  sourceUrl: null,
  ...patch,
})

test('a published picture keeps the weight that used to sit after #', () => {
  assert.equal(fileWeight('Top/Miya Metal Shirt.png'), 25)
  assert.equal(fileWeight('Top/Miya Metal Shirt#25.png'), 25)
  assert.equal(fileWeight('Hand/Right/Golden Axe.png'), 12)
  assert.equal(fileWeight('Top/Pink Spiked Cyberpunk Armor.png'), 1)
})

test('a HashLips file name is a name and a weight', () => {
  assert.deepEqual(parseTraitFile('Hat/Miyamaker Cap#20.png'), { name: 'Miyamaker Cap', weight: 20 })
  assert.deepEqual(parseTraitFile('Plain.webp'), { name: 'Plain', weight: 1 })
  assert.equal(parseTraitFile('notes.txt'), null)
  assert.equal(parseTraitFile('.hidden.png'), null)
  assert.deepEqual(parseTraitFile('Weird#nope.png'), { name: 'Weird#nope', weight: 1 })
  assert.equal(traitFileName('Miyamaker Cap', 20), 'Miyamaker Cap#20.png')
  assert.equal(sidecarName('Miyamaker Cap', 20), 'Miyamaker Cap#20.meta.json')
})

test('two traits in one folder cannot share a file name', () => {
  const hat = trait({ id: 'a', layer: 'Hat', name: 'Cap', weight: 20 })
  assert.equal(traitClash([hat], { id: 'b', layer: 'Hat', group: '', name: 'Cap', weight: 20 }), true)
  assert.equal(traitClash([hat], { id: 'a', layer: 'Hat', group: '', name: 'Cap', weight: 20 }), false)
  assert.equal(traitClash([hat], { id: 'b', layer: 'Hat', group: 'extra', name: 'Cap', weight: 20 }), false)
  assert.equal(nameError(''), 'A trait needs a name.')
  assert.equal(nameError('Cap#2'), 'The name cannot contain # or a slash.')
  assert.equal(nameError('Cap'), null)
})

test('layer folders keep the collection order, and unknown ones follow', () => {
  assert.deepEqual(
    orderLayers(['Hat', 'Nope', 'BG', 'BG']).map((layer) => layer.name),
    ['BG', 'Hat', 'Nope']
  )
})

test('the left list puts the front layer on top and the background at the bottom', () => {
  const layers = orderLayers(['BG', 'Body', 'Hat', 'Overlay', 'Eyes'])
  assert.deepEqual(sidebarLayers(layers).map((layer) => layer.name), ['Overlay', 'Hat', 'Eyes', 'Body', 'BG'])
})

test('the sidecar keeps notes and custom fields, and a broken file does not throw', () => {
  const text = metaText({ notes: 'signed', fields: [{ key: 'artist', value: 'miya' }, { key: '', value: '' }] })
  assert.deepEqual(parseMeta(text), { notes: 'signed', fields: [{ key: 'artist', value: 'miya' }] })
  assert.deepEqual(parseMeta('{'), { notes: '', fields: [] })
})

test('a preview stacks one visible trait per layer, back to front', () => {
  const layers = orderLayers(['Hat', 'BG'])
  const bg = trait({ id: 'bg', layer: 'BG', name: 'Sky' })
  const hat = trait({ id: 'hat', layer: 'Hat', name: 'Cap', hidden: true })
  assert.deepEqual(
    previewStack(layers, [hat, bg], { BG: 'bg', Hat: 'hat' }).map((item) => item.id),
    ['bg']
  )
})

test('a hair back piece paints behind the body, and the hair in front of it', () => {
  const layers = orderLayers(['Hair', 'Body', 'BG'])
  const bg = trait({ id: 'bg', layer: 'BG', name: 'Sky' })
  const body = trait({ id: 'body', layer: 'Body', name: 'Base' })
  const front = trait({ id: 'front', layer: 'Hair', group: 'Black Messy Short', name: 'Black Messy Short' })
  const back = trait({ id: 'back', layer: 'Hair', group: 'Black Messy Short', name: 'z-3,Black Messy Short' })
  assert.deepEqual(
    previewStack(layers, [front, back, body, bg], { BG: 'bg', Body: 'body', Hair: 'front' }).map((item) => item.id),
    ['bg', 'back', 'body', 'front']
  )
})

test('stacking follows the miyamaker site, from the background to the hat', () => {
  const layers = orderLayers(['Hat', 'Hair', 'Top', 'Body', 'BG', 'Eyes'])
  const rows = [
    trait({ id: 'bg', layer: 'BG', name: 'Sky' }),
    trait({ id: 'topBack', layer: 'Top', group: 'Jacket', name: 'z-2,Jacket' }),
    trait({ id: 'hatBack', layer: 'Hat', group: 'Cap', name: 'Z-2,Cap' }),
    trait({ id: 'hairBack', layer: 'Hair', group: 'Cut', name: 'z-3,Cut' }),
    trait({ id: 'body', layer: 'Body', name: 'Base' }),
    trait({ id: 'top', layer: 'Top', group: 'Jacket', name: 'Jacket' }),
    trait({ id: 'eyes', layer: 'Eyes', name: 'Look' }),
    trait({ id: 'hair', layer: 'Hair', group: 'Cut', name: 'Cut' }),
    trait({ id: 'hat', layer: 'Hat', group: 'Cap', name: 'Cap' }),
  ]
  const worn = { BG: 'bg', Top: 'top', Body: 'body', Eyes: 'eyes', Hair: 'hair', Hat: 'hat' }
  assert.deepEqual(
    previewStack(layers, rows, worn).map((item) => item.id),
    ['bg', 'topBack', 'hatBack', 'hairBack', 'body', 'top', 'eyes', 'hair', 'hat']
  )
})

test('the trait on the canvas keeps its place between the layers behind and in front', () => {
  const layers = orderLayers(['Hair', 'Body', 'BG'])
  const bg = trait({ id: 'bg', layer: 'BG', name: 'Sky' })
  const blank = trait({ id: 'blank', layer: 'Body', name: 'New trait' })
  const front = trait({ id: 'front', layer: 'Hair', group: 'Black Messy Short', name: 'Black Messy Short' })
  const back = trait({ id: 'back', layer: 'Hair', group: 'Black Messy Short', name: 'z-3,Black Messy Short' })
  const stack = previewStack(layers, [front, back, blank, bg], { BG: 'bg', Body: 'blank', Hair: 'front' })
  const split = aroundActive(stack, 'blank')
  assert.deepEqual(split.behind.map((item) => item.id), ['bg', 'back'])
  assert.deepEqual(split.ahead.map((item) => item.id), ['front'])
})

test('previous and next walk a layer from A to Z and wrap', () => {
  const rows = [
    trait({ id: 'citrus', layer: 'Hat', name: 'Citrus' }),
    trait({ id: 'apple', layer: 'Hat', name: 'Apple' }),
    trait({ id: 'zebra', layer: 'Hat', name: 'Zebra', hidden: true }),
    trait({ id: 'ten', layer: 'Hat', name: 'Cap 10' }),
    trait({ id: 'two', layer: 'Hat', name: 'Cap 2' }),
  ]
  assert.equal(cycleTrait(rows, 'Hat', 'apple', 1)?.id, 'two')
  assert.equal(cycleTrait(rows, 'Hat', 'two', 1)?.id, 'ten')
  assert.equal(cycleTrait(rows, 'Hat', 'citrus', 1)?.id, 'apple')
  assert.equal(cycleTrait(rows, 'Hat', null, -1)?.id, 'citrus')
  assert.equal(cycleTrait(rows, 'Hat', 'zebra', 1)?.id, 'apple')
})

test('a blank roll leaves that layer out of the picture', () => {
  const layers = orderLayers(['Hat', 'BG'])
  const sky = trait({ id: 'sky', layer: 'BG', name: 'Sky', weight: 1 })
  const cap = trait({ id: 'cap', layer: 'Hat', name: 'Cap', weight: 1 })
  const none = trait({ id: 'none', layer: 'Hat', name: 'NONE', weight: 100 })
  assert.equal(isEmptyOption(none), true)
  assert.equal(isEmptyOption(cap), false)
  assert.equal(randomWorn(layers, [cap, none, sky], () => 0.99).Hat, 'none')
  assert.deepEqual(previewStack(layers, [cap, none, sky], { BG: 'sky', Hat: 'none' }).map((item) => item.id), ['sky'])
})

test('a layer without a blank gains one with its own weight', () => {
  const layers = orderLayers(['Hat', 'BG'])
  const cap = trait({ id: 'cap', layer: 'Hat', name: 'Cap' })
  const existing = trait({ id: 'body-none', layer: 'BG', name: 'None', weight: 12 })
  const next = ensureEmptyOptions(layers, [cap, existing])
  const blanks = next.filter((item) => isEmptyOption(item))
  assert.deepEqual(blanks.map((item) => [item.layer, item.weight]), [
    ['BG', 12],
    ['Hat', EMPTY_WEIGHT],
  ])
})

test('a random character wears one weighted trait per layer and skips a back piece', () => {
  const layers = orderLayers(['Hat', 'BG'])
  const sky = trait({ id: 'sky', layer: 'BG', name: 'Sky', weight: 1 })
  const secret = trait({ id: 'secret', layer: 'BG', name: 'Secret', weight: 50, hidden: true })
  const rare = trait({ id: 'rare', layer: 'Hat', name: 'Rare', weight: 1 })
  const common = trait({ id: 'common', layer: 'Hat', name: 'Common', weight: 100 })
  const back = trait({ id: 'back', layer: 'Hat', name: 'z-3,Common', weight: 100 })
  const pool = [rare, common, back, sky, secret]
  assert.deepEqual(randomWorn(layers, pool, () => 0), { BG: 'sky', Hat: 'rare' })
  assert.equal(randomWorn(layers, pool, () => 0.5).Hat, 'common')
  assert.equal(randomWorn(layers, pool, () => 0.5).BG, 'sky')
})

test('letterbox fits a wide picture on the plate without cropping', () => {
  assert.deepEqual(letterbox(100, 50, 1024), { x: 0, y: 256, w: 1024, h: 512 })
  assert.deepEqual(letterbox(1024, 1024), { x: 0, y: 0, w: 1024, h: 1024 })
})

test('the path written on save includes a nested group', () => {
  assert.equal(traitPath({ layer: 'Mask', group: 'LCD Visor#18', name: 'Coin Eyes', weight: 4 }), 'Mask/LCD Visor#18/Coin Eyes#4.png')
})

test('a stored zip round-trips trait bytes and the sidecar', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  const meta = new TextEncoder().encode('{"notes":"hi"}')
  const packed = zipStore([
    { name: 'Hat/Cap#20.png', data: png },
    { name: 'Hat/Cap#20.meta.json', data: meta },
  ])
  const back = await unzip(packed)
  assert.equal(back.length, 2)
  assert.equal(back[0]?.name, 'Hat/Cap#20.png')
  assert.deepEqual(back[0]?.data, png)
  assert.equal(new TextDecoder().decode(back[1]?.data), '{"notes":"hi"}')
})

const draft = (patch: Partial<DraftRow>): DraftRow => ({
  root: 'layers',
  layer: 'Hat',
  group: '',
  diskName: 'Cap#20.png',
  id: 'draft',
  name: 'Cap',
  weight: 20,
  notes: '',
  fields: [],
  png: new Blob(),
  updated: 1,
  ...patch,
})

test('reopening a folder keeps a draft on the trait it was saved from', () => {
  const disk = trait({ id: 'a', layer: 'Hat', name: 'Cap', diskName: 'Cap#20.png' })
  const [merged] = applyDrafts(
    [disk],
    [draft({ weight: 12, notes: 'worn brim', fields: [{ key: 'artist', value: 'miya' }], png: new Blob([Uint8Array.from([1, 2, 3])]) })]
  )
  assert.equal(merged?.notes, 'worn brim')
  assert.equal(merged?.weight, 12)
  assert.equal(merged?.draft?.size, 3)
  assert.equal(merged?.dirty, true)
  assert.deepEqual(merged?.fields, [{ key: 'artist', value: 'miya' }])
})

test('a trait that was never saved is kept, and a draft for a missing file is not invented', () => {
  const next = applyDrafts(
    [],
    [
      draft({ root: 'Untitled', diskName: null, id: 'new-1', name: 'Scratch', weight: 4, notes: 'a test note', png: new Blob([Uint8Array.from([9])]) }),
      draft({ diskName: 'Gone#1.png', id: 'gone', name: 'Gone' }),
    ]
  )
  assert.equal(next.length, 1)
  assert.equal(next[0]?.name, 'Scratch')
  assert.equal(next[0]?.notes, 'a test note')
})

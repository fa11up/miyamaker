// The reveal's metadata cleanup and hashing (api/_lib/revealpiece.mjs), on the HashLips shape the art came with.
// Run: yarn test
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  canonicalJson,
  cleanMetadata,
  isJpeg,
  provenanceHash,
  servedMetadata,
  sha256Hex,
  storedFromServed,
} from '../api/_lib/revealpiece.mjs'

const LAYERS = 'C:\\Users\\juan\\OneDrive\\Documents\\GitHub\\Miyamaker1024-main\\layers'
const hashlips = (edition: number) => ({
  name: `Miyamaker #${edition}`,
  description: 'This is the description of your NFT project, remember to replace this',
  image: `ipfs://NewUriToReplace/${edition}.png`,
  imageHash: 'ee48613098ba2853738a565b9e9d08f1cde6b3e9d80e47f371991fa21b85d2cb',
  edition,
  date: 1736049651252,
  attributes: [
    { trait_type: LAYERS, value: 'Background' },
    { trait_type: 'Background', value: 'Neon Night' },
    { trait_type: 'Wings', value: 'Cyber Angel 1' },
    { trait_type: 'Overlay 3', value: 'Pledge Eternal Love ' },
    { trait_type: 'Eyes', value: 'Heart Eyes' },
  ],
  compiler: 'HashLips Art Engine - NFTChef fork',
})
const opts = { prefix: 'Miyamaker', description: 'DESCRIPTION' }

test('cleanup: the folder-path trait goes, the name is the piece, the rest is kept exactly', () => {
  // Edition 0 is piece 10000.
  const m = cleanMetadata(hashlips(0), 10000, opts)
  assert.deepEqual(m, {
    name: 'Miyamaker #10000',
    description: 'DESCRIPTION',
    attributes: [
      { trait_type: 'Background', value: 'Neon Night' },
      { trait_type: 'Wings', value: 'Cyber Angel 1' },
      { trait_type: 'Overlay 3', value: 'Pledge Eternal Love ' },
      { trait_type: 'Eyes', value: 'Heart Eyes' },
    ],
  })
  assert.ok(!('image' in m) && !('imageHash' in m) && !('edition' in m) && !('date' in m) && !('compiler' in m))
})

test('cleanup refuses what it does not know rather than dropping it', () => {
  assert.throws(() => cleanMetadata({ ...hashlips(1), external_url: 'x' }, 1, opts), /unexpected field "external_url"/)
  assert.throws(() => cleanMetadata({ ...hashlips(1), attributes: [{ trait_type: 'A' }] }, 1, opts), /odd attribute/)
  assert.throws(
    () => cleanMetadata({ ...hashlips(1), attributes: [{ trait_type: 'A', value: null }] }, 1, opts),
    /odd attribute/
  )
  assert.throws(
    () => cleanMetadata({ ...hashlips(1), attributes: [{ trait_type: LAYERS, value: 'Background' }] }, 1, opts),
    /no traits/
  )
  assert.throws(() => cleanMetadata([], 1, opts), /not a JSON object/)
})

test('canonical JSON: keys sorted at every level, arrays in order, no spaces, UTF-8 as is', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ z: 1, y: 'é' }, 2] }), '{"a":[{"y":"é","z":1},2],"b":1}')
  const stored = canonicalJson(cleanMetadata(hashlips(3), 3, opts))
  assert.ok(stored.startsWith('{"attributes":[{"trait_type":"Background","value":"Neon Night"}'))
})

test('the provenance hash is sha256 of "n:image:metadata\\n" lines', async () => {
  const pieces = [1, 2, 3].map((n) => ({ n, image: String(n).repeat(64), metadata: 'f'.repeat(64) }))
  const lines = pieces.map((p) => `${p.n}:${p.image}:${p.metadata}\n`).join('')
  assert.equal(await provenanceHash(pieces), createHash('sha256').update(lines).digest('hex'))
  assert.equal(await sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'))
  await assert.rejects(provenanceHash([pieces[1]!]), /entry 1/)
  await assert.rejects(provenanceHash([{ ...pieces[0]!, image: 'XYZ' }]), /sha256 hex/)
})

test('served metadata adds the image, and dropping it gives back the hashed bytes', () => {
  const stored = canonicalJson(cleanMetadata(hashlips(7), 7, opts))
  const served = servedMetadata(stored, 'ar://abc')
  assert.deepEqual(Object.keys(served), ['name', 'description', 'image', 'attributes'])
  assert.equal(served.image, 'ar://abc')
  assert.equal(storedFromServed(JSON.parse(JSON.stringify(served))), stored)
  assert.throws(() => servedMetadata('{"name":1}', ''), /not \{ name/)
})

test('isJpeg looks at the magic bytes', () => {
  assert.ok(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])))
  assert.ok(!isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
})

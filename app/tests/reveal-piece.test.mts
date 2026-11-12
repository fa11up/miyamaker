// The reveal's metadata cleanup and hashing (api/_lib/revealpiece.mjs), on the HashLips shape the art came with.
// Run: yarn test
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  canonicalJson,
  cleanMetadata,
  HASH_RULE,
  isJpeg,
  metadataHash,
  provenanceHash,
  servedMetadata,
  sha256Hex,
  storedFromServed,
  tokenName,
} from '../api/_lib/revealpiece.mjs'
import { DRAW_RULE } from '../api/_lib/revealdraw.mjs'

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
const opts = { description: 'DESCRIPTION' }

test('cleanup: the folder-path trait goes, the rest is kept exactly, the piece is the last trait, no name', () => {
  // Edition 0 is piece 10000.
  const m = cleanMetadata(hashlips(0), 10000, opts)
  assert.deepEqual(m, {
    description: 'DESCRIPTION',
    attributes: [
      { trait_type: 'Background', value: 'Neon Night' },
      { trait_type: 'Wings', value: 'Cyber Angel 1' },
      { trait_type: 'Overlay 3', value: 'Pledge Eternal Love ' },
      { trait_type: 'Eyes', value: 'Heart Eyes' },
      { trait_type: 'Piece', value: 10000 },
    ],
  })
  assert.ok(
    !('name' in m) &&
      !('image' in m) &&
      !('imageHash' in m) &&
      !('edition' in m) &&
      !('date' in m) &&
      !('compiler' in m)
  )
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
  assert.throws(
    () => cleanMetadata({ ...hashlips(1), attributes: [{ trait_type: 'Piece', value: 3 }] }, 1, opts),
    /already has a "Piece" trait/
  )
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

test('metadata hash = sha256(32 salt bytes || stored UTF-8), as Python computes it', async () => {
  const salt = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
  const a =
    '{"attributes":[{"trait_type":"Eyes","value":"Heart Eyes"},{"trait_type":"Piece","value":7}],"description":"D"}'
  const b =
    '{"attributes":[{"trait_type":"Top","value":"Café "},{"trait_type":"Piece","value":10000}],"description":"D"}'
  assert.equal(await metadataHash(salt, a), '2a8cff86931c6158d63255fdab8b12c3492e11b7ae25ed880a2d19b02285e107')
  assert.equal(await metadataHash(salt, b), 'b3c3d190cf716b425edeecc6df20e9cabc44175b8c536518300345bb4f072262')
  // Unsalted, the same bytes hash to what anyone could compute by guessing traits; salted, they don't.
  assert.equal(await sha256Hex(a), 'fc5c4741bee341b5a5e505cd6d8d7299092a7d18bdb83d69ed482cea0f7b530a')
  assert.notEqual(await metadataHash('ff'.repeat(32), a), await metadataHash(salt, a))
  await assert.rejects(metadataHash('00', a), /32 bytes/)
  await assert.rejects(metadataHash(salt.toUpperCase(), a), /32 bytes/)
})

test('served metadata adds name and image; dropping them gives back the hashed bytes', () => {
  const stored = canonicalJson(cleanMetadata(hashlips(7), 7, opts))
  const served = servedMetadata(stored, { name: tokenName('Miyamaker', 'token', 5, 7), image: 'ar://abc' })
  assert.deepEqual(Object.keys(served), ['name', 'description', 'image', 'attributes'])
  assert.equal(served.name, 'Miyamaker #5')
  assert.equal(tokenName('Miyamaker', 'piece', 5, 7), 'Miyamaker #7')
  assert.equal(served.image, 'ar://abc')
  assert.equal(storedFromServed(JSON.parse(JSON.stringify(served))), stored)
  assert.throws(
    () => servedMetadata('{"name":"x","description":"d","attributes":[]}', { name: '', image: '' }),
    /not \{/
  )
})

test('isJpeg looks at the magic bytes', () => {
  assert.ok(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])))
  assert.ok(!isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
})

test('canonical JSON keeps a "__proto__" key as a key, and keeps non-ASCII raw (as HASH_RULE says)', () => {
  const parsed = JSON.parse('{"b":1,"__proto__":{"x":1},"a":"é😀"}')
  assert.equal(canonicalJson(parsed), '{"__proto__":{"x":1},"a":"é😀","b":1}')
  assert.match(HASH_RULE, /raw UTF-8/)
  assert.ok(!canonicalJson({ a: 'é' }).includes('\\u'))
})

test('storedFromServed refuses fields a piece does not have, so extra content cannot pass as the piece', () => {
  const stored = canonicalJson(cleanMetadata(hashlips(7), 7, opts))
  const served = servedMetadata(stored, { name: 'Miyamaker #7', image: 'ar://abc' })
  assert.equal(storedFromServed(served), stored)
  assert.throws(() => storedFromServed({ ...served, external_url: 'https://x' }), /unexpected field "external_url"/)
  assert.throws(() => storedFromServed(JSON.parse(`{"__proto__":{},${JSON.stringify(served).slice(1)}`)), /__proto__/)
  assert.throws(
    () => storedFromServed({ ...served, attributes: [{ trait_type: 'A', value: 1, extra: 2 }] }),
    /odd attribute/
  )
  assert.throws(() => storedFromServed({ name: 'x', image: 'y' }), /no description/)
  assert.throws(() => storedFromServed([served]), /not an object/)
})

test('the draw rule states its limits: the B proposer can choose, and draws are final to 5 blocks', () => {
  assert.match(DRAW_RULE, /proposer of block B knows B\+1's prevrandao/)
  assert.match(DRAW_RULE, /final to a depth of 5 blocks/)
})

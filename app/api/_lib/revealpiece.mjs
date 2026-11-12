// @ts-check
/**
 * One piece of the per-mint reveal: its cleaned metadata, the salted hash of it, and the provenance hash over all of
 * them. Shared by scripts/reveal/prepare.mjs (which makes the private build), the Worker (which checks what is loaded
 * against the provenance) and scripts/reveal/verify.mjs. No imports: Web Crypto only, so the Worker and `node` both load
 * it as it is.
 *
 *   metadata (stored)   canonical JSON of { description, attributes }: keys sorted at every level, no spaces, UTF-8
 *                       (JSON.stringify's own escaping: non-ASCII stays raw UTF-8, see HASH_RULE). The last trait is
 *                       { "trait_type": "Piece", "value": n }. No name (it may be the token id, known only once
 *                       minted) and no image (known only once uploaded).
 *   salt                32 random bytes per piece, kept private until the piece is drawn, then published (hex) in
 *                       assignments.json. Without it, a piece's traits could be guessed from its hash by trying
 *                       combinations of the traits already revealed.
 *   metadataSha256      sha256(salt || stored): the 32 raw salt bytes, then the stored JSON's UTF-8 bytes.
 *   metadata (served)   { name, description, image, attributes }: name "<collection> #<token id or piece>".
 *   imageSha256         sha256 of the JPG's bytes.
 *   provenanceHash      sha256 of the lines "n:imageSha256:metadataSha256\n" for n = 1..supply, hex.
 */

/** The hashing in words, published in provenance.json. */
export const HASH_RULE = [
  'image = sha256 of the JPG bytes.',
  "metadata = sha256(salt || stored), where salt is the piece's 32 random bytes (published as 64 hex characters in",
  'assignments.json once the piece is drawn) and stored is the UTF-8 bytes of the token metadata without its name and',
  'image fields, i.e. { attributes, description } with the last attribute { "trait_type": "Piece", "value": n }, as JSON',
  "with keys sorted at every level and no spaces, strings escaped exactly as JavaScript's JSON.stringify does:",
  '" and \\ and U+0000..U+001F are escaped (\\b \\t \\n \\f \\r, else \\u00XX), and so is a lone surrogate (\\uXXXX);',
  'every other character (é, emoji, ...) is raw UTF-8, never a \\u escape.',
  'provenanceHash = sha256 of the lines "n:image:metadata\\n" for n = 1..supply.',
].join(' ')

/** The trait that names the piece, last in every piece's attributes. */
export const PIECE_TRAIT = 'Piece'

/** The source's traits whose type is a Windows folder path (HashLips' layers dir): not a trait, dropped. */
const WINDOWS_PATH = /^[A-Za-z]:\\/

/** Fields the HashLips source may have. Anything else is refused rather than dropped without a word. */
const SOURCE_KEYS = new Set(['name', 'description', 'image', 'imageHash', 'edition', 'date', 'compiler', 'attributes'])

/**
 * The stored metadata for piece `piece`: the given description, every trait but the folder path kept exactly (order,
 * spelling, trailing spaces), then { trait_type: "Piece", value: piece }. Throws on anything unexpected.
 * @param {unknown} raw  the HashLips JSON
 * @param {number} piece
 * @param {{ description: string }} opts
 */
export function cleanMetadata(raw, piece, { description }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Piece ${piece}: not a JSON object.`)
  const src = /** @type {Record<string, unknown>} */ (raw)
  for (const k of Object.keys(src)) if (!SOURCE_KEYS.has(k)) throw new Error(`Piece ${piece}: unexpected field "${k}".`)
  if (!Array.isArray(src.attributes)) throw new Error(`Piece ${piece}: no attributes.`)
  /** @type {{ trait_type: string, value: string | number }[]} */
  const attributes = []
  for (const a of src.attributes) {
    const keys = a && typeof a === 'object' ? Object.keys(a).sort().join(',') : ''
    if (keys !== 'trait_type,value' || typeof a.trait_type !== 'string') {
      throw new Error(`Piece ${piece}: odd attribute ${JSON.stringify(a)}.`)
    }
    if (typeof a.value !== 'string' && typeof a.value !== 'number') {
      throw new Error(`Piece ${piece}: odd attribute value ${JSON.stringify(a)}.`)
    }
    if (WINDOWS_PATH.test(a.trait_type)) continue
    if (a.trait_type === PIECE_TRAIT) throw new Error(`Piece ${piece}: already has a "${PIECE_TRAIT}" trait.`)
    attributes.push({ trait_type: a.trait_type, value: a.value })
  }
  if (!attributes.length) throw new Error(`Piece ${piece}: no traits left.`)
  attributes.push({ trait_type: PIECE_TRAIT, value: piece })
  return { description, attributes }
}

/** JSON with keys sorted at every level and no spaces. Arrays keep their order. @param {unknown} value */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value))
}

/**
 * A copy with keys sorted. Built on null-prototype objects, so a "__proto__" key stays a key (on a plain {} it would set
 * the prototype and vanish from the JSON).
 * @param {unknown} v @returns {unknown}
 */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = Object.create(null)
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(/** @type {Record<string, unknown>} */ (v)[k])
    return out
  }
  return v
}

/** sha256, hex. @param {Uint8Array | ArrayBuffer | string} data */
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const SALT = /^[0-9a-f]{64}$/

/**
 * metadataSha256 = sha256(salt || stored): 32 salt bytes, then the stored JSON as UTF-8.
 * @param {string} salt  64 hex characters
 * @param {string} stored  canonical JSON from cleanMetadata
 */
export async function metadataHash(salt, stored) {
  if (typeof salt !== 'string' || !SALT.test(salt))
    throw new Error('A salt is 32 bytes as 64 lower-case hex characters.')
  const body = new TextEncoder().encode(stored)
  const bytes = new Uint8Array(32 + body.length)
  for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16)
  bytes.set(body, 32)
  return sha256Hex(bytes)
}

/** @typedef {{ n: number, image: string, metadata: string }} ProvenanceEntry */

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The provenance hash over `pieces`, which must be exactly n = 1..pieces.length in order with 64-hex hashes.
 * @param {ProvenanceEntry[]} pieces
 */
export async function provenanceHash(pieces) {
  let lines = ''
  pieces.forEach((p, i) => {
    if (!p || p.n !== i + 1 || !HEX64.test(p.image) || !HEX64.test(p.metadata)) {
      throw new Error(`Provenance entry ${i + 1} is not { n: ${i + 1}, image, metadata } with sha256 hex.`)
    }
    lines += `${p.n}:${p.image}:${p.metadata}\n`
  })
  return sha256Hex(lines)
}

/**
 * The metadata a token serves: the stored piece with its name and image link, in the order wallets expect.
 * @param {string} stored  canonical JSON from cleanMetadata
 * @param {{ name: string, image: string }} add
 */
export function servedMetadata(stored, { name, image }) {
  const m = JSON.parse(stored)
  if (!m || typeof m.description !== 'string' || !Array.isArray(m.attributes) || 'name' in m || 'image' in m) {
    throw new Error('Stored metadata is not { description, attributes }.')
  }
  return { name, description: m.description, image, attributes: m.attributes }
}

const SERVED_KEYS = new Set(['name', 'description', 'image', 'attributes'])

/**
 * The stored (hashed) form of served metadata: name and image dropped, canonical again. For checking what is served.
 * Anything but { name, description, image, attributes } with { trait_type, value } traits is refused, so a served file
 * with extra fields can't pass as the piece's.
 */
export function storedFromServed(/** @type {unknown} */ served) {
  if (!served || typeof served !== 'object' || Array.isArray(served)) throw new Error('Metadata is not an object.')
  const m = /** @type {Record<string, unknown>} */ (served)
  for (const k of Object.keys(m)) if (!SERVED_KEYS.has(k)) throw new Error(`Metadata has an unexpected field "${k}".`)
  if (typeof m.description !== 'string' || !Array.isArray(m.attributes)) {
    throw new Error('Metadata has no description or attributes.')
  }
  for (const a of m.attributes) {
    if (!a || typeof a !== 'object' || Object.keys(a).sort().join(',') !== 'trait_type,value') {
      throw new Error(`Metadata has an odd attribute ${JSON.stringify(a)}.`)
    }
  }
  return canonicalJson({ description: m.description, attributes: m.attributes })
}

/** The served name: "<collection> #<token id>" or "#<piece>", as the collection is set up. */
export const tokenName = (
  /** @type {string} */ collection,
  /** @type {'token' | 'piece'} */ by,
  /** @type {number} */ tokenId,
  /** @type {number} */ piece
) => `${collection} #${by === 'piece' ? piece : tokenId}`

/** A JPEG starts FF D8 FF. @param {Uint8Array} bytes */
export const isJpeg = (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

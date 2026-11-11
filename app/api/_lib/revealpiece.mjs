// @ts-check
/**
 * One piece of the per-mint reveal: its cleaned metadata, the canonical form that is hashed, and the provenance hash
 * over all of them. Shared by scripts/reveal/prepare.mjs (which makes the private build), the Worker (which checks
 * what is loaded against the provenance) and scripts/reveal/verify.mjs. No imports: Web Crypto only, so the Worker and
 * `node` both load it as it is.
 *
 *   metadata (stored, hashed)  canonical JSON of { name, description, attributes }: keys sorted at every level, no
 *                              spaces, UTF-8 (JSON.stringify's own escaping). No image: it is not known until upload.
 *   metadata (served)          { name, description, image, attributes }, image = ar://<id> or the site's image link.
 *   imageSha256                sha256 of the JPG's bytes.
 *   provenanceHash             sha256 of the lines "n:imageSha256:metadataSha256\n" for n = 1..supply, hex.
 */

/** The source's traits whose type is a Windows folder path (HashLips' layers dir): not a trait, dropped. */
const WINDOWS_PATH = /^[A-Za-z]:\\/

/** Fields the HashLips source may have. Anything else is refused rather than dropped without a word. */
const SOURCE_KEYS = new Set(['name', 'description', 'image', 'imageHash', 'edition', 'date', 'compiler', 'attributes'])

/**
 * The stored metadata for piece `piece`: name "<prefix> #<piece>", the given description, every trait but the folder
 * path kept exactly (order, spelling, trailing spaces). Throws on anything unexpected.
 * @param {unknown} raw  the HashLips JSON
 * @param {number} piece
 * @param {{ prefix: string, description: string }} opts
 */
export function cleanMetadata(raw, piece, { prefix, description }) {
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
    attributes.push({ trait_type: a.trait_type, value: a.value })
  }
  if (!attributes.length) throw new Error(`Piece ${piece}: no traits left.`)
  return { name: `${prefix} #${piece}`, description, attributes }
}

/** JSON with keys sorted at every level and no spaces. Arrays keep their order. @param {unknown} value */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value))
}

/** @param {unknown} v @returns {unknown} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
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
 * The metadata a token serves: the stored piece with its image link, in the order wallets expect.
 * @param {string} stored  canonical JSON from cleanMetadata
 * @param {string} image
 */
export function servedMetadata(stored, image) {
  const m = JSON.parse(stored)
  if (!m || typeof m.name !== 'string' || typeof m.description !== 'string' || !Array.isArray(m.attributes)) {
    throw new Error('Stored metadata is not { name, description, attributes }.')
  }
  return { name: m.name, description: m.description, image, attributes: m.attributes }
}

/** The stored (hashed) form of served metadata: the image dropped, canonical again. For checking what is served. */
export function storedFromServed(/** @type {unknown} */ served) {
  if (!served || typeof served !== 'object') throw new Error('Metadata is not an object.')
  const { image: _image, ...rest } = /** @type {Record<string, unknown>} */ (served)
  return canonicalJson(rest)
}

/** A JPEG starts FF D8 FF. @param {Uint8Array} bytes */
export const isJpeg = (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

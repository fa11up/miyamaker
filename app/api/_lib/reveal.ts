/**
 * The per-mint reveal: a drop's tokenURI points here (baseURI https://www.miyamaker.com/reveal/<slug>/), and each token
 * shows its piece of art only once it is minted and drawn. Unminted art never leaves the private R2 bucket, and nothing
 * goes to Arweave before its token is drawn (scripts/reveal/arweave.mjs). The drop contract is the unchanged ERC721Drop.
 *
 *   GET /reveal/<slug>/<id>               assigned: the piece's metadata (image ar://… once uploaded, else ours below);
 *                                         anything else in 1..supply: the cover, cached briefly. Never an unminted piece.
 *   GET /reveal/<slug>/image/<id>         assigned tokens only, from R2; 404 otherwise
 *   GET /reveal/<slug>/assignments.json   every draw with what it was drawn from, for scripts/reveal/verify.mjs
 *   GET /reveal/<slug>/provenance.json    every piece's hashes and the rule (published at launch, reveals nothing)
 *   …/admin/*                             Bearer REVEAL_ADMIN_KEY: register, provenance, piece upload, attach, arweave
 *
 * The draw (revealdraw.mjs) runs in the cron (runRevealCron, every minute): Transfer-from-zero logs are read forward in
 * chunks from blocks CONFIRMATIONS deep, checked against totalSupply() at the chunk's last block (so an RPC that drops
 * logs is caught, not believed), stored, then drawn in token order. Writes are D1 batches (one transaction each) guarded
 * by compare-and-set on the collection's counters and the tables' keys, so an overlapping run, a retry or an RPC error
 * leaves the state as it was, never half-written or guessed.
 *
 * Storage, bucket and chain are passed in, so `node --test` runs all of it against SQLite (tests/reveal-worker.test.mts).
 */
import { decodeAbiParameters } from 'viem'

import { CONFIRMATIONS, DRAW_RULE, drawFor, hash32, newPool, takePiece } from './revealdraw.mjs'
import { isJpeg, provenanceHash, servedMetadata, sha256Hex } from './revealpiece.mjs'

export const REVEAL_PREFIX = '/reveal'

/* ---------- bindings ---------- */

export type RevealStmt = {
  bind: (...values: unknown[]) => RevealStmt
  all: () => Promise<{ results: Record<string, unknown>[] }>
  first: () => Promise<Record<string, unknown> | null>
  run: () => Promise<{ meta: { changes: number } }>
}
/** D1, as much of it as this uses. A batch is one transaction: one statement failing undoes them all. */
export type RevealDb = {
  prepare: (sql: string) => RevealStmt
  batch: (stmts: RevealStmt[]) => Promise<{ meta: { changes: number } }[]>
}
type R2Body = { body: ReadableStream; size: number; text: () => Promise<string> }
/** R2, as much of it as this uses. */
export type RevealBucket = {
  get: (key: string) => Promise<R2Body | null>
  head: (key: string) => Promise<{ size: number } | null>
  put: (
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string }; sha256?: string }
  ) => Promise<unknown>
}

export type Header = { number: number; hash: string; parentHash: string; mixHash: string }
export type RawLog = Record<string, unknown>

/** The chain reads the reveal needs. rpcChain below is the real one. */
export type RevealChain = {
  blockNumber: () => Promise<number>
  /** Transfer(0x0, *, *) logs of `address` in [from, to]. */
  mintLogs: (address: string, from: number, to: number) => Promise<RawLog[]>
  /** totalSupply() at the end of `block`. */
  totalSupplyAt: (address: string, block: number) => Promise<number>
  /** Block headers by number; a block not mined yet is left out. */
  headers: (numbers: number[]) => Promise<Map<number, Header>>
  maxSupply: (address: string) => Promise<number>
  baseURI: (address: string) => Promise<string>
  /** Whether the address has code at `block`. */
  hasCode: (address: string, block: number) => Promise<boolean>
}

export type RevealDeps = {
  db?: RevealDb
  bucket?: RevealBucket
  /** REVEAL_ADMIN_KEY. Unset or shorter than MIN_ADMIN_KEY: the admin routes are off. */
  adminKey?: string
  chain?: (chainId: number) => RevealChain | undefined
  now?: () => number
  /** Public JSON lists (assignments.json): per client. */
  clientKey?: (headers: Headers | undefined) => string
  listLimiter?: (key: string) => boolean
}

/* ---------- limits ---------- */

export const MIN_ADMIN_KEY = 32
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_PIECE_JSON_BYTES = 64 * 1024
const MAX_PROVENANCE_BYTES = 8 * 1024 * 1024
const MAX_SMALL_BODY = 4096
/** Cover JSON (minted but not drawn yet, or not minted): marketplaces should come back soon. */
const COVER_CACHE = 'public, max-age=60'
/** A drawn piece before its Arweave upload: final content, but its image link moves to ar:// later. */
const ASSIGNED_CACHE = 'public, max-age=3600'
const IMMUTABLE = 'public, max-age=31536000, immutable'
/** Rows per json_each insert: well under D1's 2 MB per bound value. */
const ROWS_PER_INSERT = 1000

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/
const TOKEN = /^[1-9]\d{0,8}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const AR_ID = /^[A-Za-z0-9_-]{43}$/
const HEX64 = /^[0-9a-f]{64}$/

/* ---------- responses ---------- */

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'access-control-allow-origin': '*',
}

const json = (status: number, body: unknown, cache = 'no-store', extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...extra },
  })
const notFound = () => json(404, { error: 'Not found.' })

/** HEAD gets GET's headers without the body. */
const forMethod = (method: string, res: Response) =>
  method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res

/* ---------- the collection ---------- */

export type Collection = {
  slug: string
  chainId: number
  supply: number
  provenanceHash: string
  name: string
  description: string
  coverImage: string
  address?: string
  deployBlock?: number
  lastScannedBlock?: number
  minted: number
  assigned: number
  lastError?: string
}

const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))
const fromRow = (r: Record<string, unknown>): Collection => ({
  slug: String(r.slug),
  chainId: Number(r.chain_id),
  supply: Number(r.supply),
  provenanceHash: String(r.provenance_hash),
  name: String(r.name),
  description: String(r.description),
  coverImage: String(r.cover_image),
  address: r.address ? String(r.address) : undefined,
  deployBlock: num(r.deploy_block),
  lastScannedBlock: num(r.last_scanned_block),
  minted: Number(r.minted),
  assigned: Number(r.assigned),
  lastError: r.last_error ? String(r.last_error) : undefined,
})

export async function getCollection(db: RevealDb, slug: string): Promise<Collection | undefined> {
  const r = await db.prepare('SELECT * FROM reveal_collections WHERE slug = ?').bind(slug).first()
  return r ? fromRow(r) : undefined
}

/* ---------- public routes ---------- */

export async function handleRevealRequest(request: Request, deps: RevealDeps): Promise<Response> {
  const url = new URL(request.url)
  const [slug = '', ...rest] = url.pathname.slice(REVEAL_PREFIX.length + 1).split('/')
  if (!SLUG.test(slug) || !rest.length) return notFound()

  if (rest[0] === 'admin') return handleAdmin(request, deps, slug, rest.slice(1))

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...BASE_HEADERS,
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-max-age': '86400',
      },
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return json(405, { error: 'GET only.' }, 'no-store', { allow: 'GET, HEAD' })
  if (!deps.db) return json(503, { error: 'The reveal is not set up.' })
  const c = await getCollection(deps.db, slug)
  if (!c) return notFound()

  const [first = '', second, ...more] = rest
  if (more.length) return notFound()
  if (first === 'provenance.json' && second === undefined)
    return forMethod(request.method, await provenanceFile(c, deps))
  if (first === 'assignments.json' && second === undefined) {
    const key = deps.clientKey?.(request.headers) ?? 'unknown'
    if (deps.listLimiter && !deps.listLimiter(key))
      return json(429, { error: 'Too many requests, slow down.' }, 'no-store', { 'retry-after': '10' })
    return forMethod(request.method, await assignmentsFile(c, deps.db))
  }
  if (first === 'image' && second !== undefined) return forMethod(request.method, await imageFile(c, second, deps))
  if (second === undefined) return forMethod(request.method, await tokenMetadata(c, first, url.origin, deps))
  return notFound()
}

/** A token id in 1..supply, written the way tokenURI writes it (no leading zeros). */
function tokenIn(c: Collection, raw: string): number | undefined {
  if (!TOKEN.test(raw)) return undefined
  const id = Number(raw)
  return id <= c.supply ? id : undefined
}

async function assignedPiece(db: RevealDb, slug: string, id: number) {
  const r = await db
    .prepare(
      `SELECT a.piece, p.ar_image FROM reveal_assignments a
       LEFT JOIN reveal_pieces p ON p.slug = a.slug AND p.piece = a.piece
       WHERE a.slug = ? AND a.token_id = ?`
    )
    .bind(slug, id)
    .first()
  return r ? { piece: Number(r.piece), arImage: r.ar_image ? String(r.ar_image) : undefined } : undefined
}

async function tokenMetadata(c: Collection, raw: string, origin: string, deps: RevealDeps): Promise<Response> {
  const id = tokenIn(c, raw)
  if (id === undefined) return notFound()
  const a = await assignedPiece(deps.db!, c.slug, id)
  if (!a) {
    // Not minted, or minted and waiting for its block's confirmations: the cover, the same for every token.
    return json(200, { name: `${c.name} #${id}`, description: c.description, image: c.coverImage }, COVER_CACHE)
  }
  const obj = await deps.bucket?.get(pieceKey(c.slug, a.piece, 'json'))
  // Drawn but its file is not in R2: say so, never something else in its place.
  if (!obj) return json(503, { error: 'This piece is not loaded yet.' }, 'no-store', { 'retry-after': '60' })
  const image = a.arImage ? `ar://${a.arImage}` : `${origin}${REVEAL_PREFIX}/${c.slug}/image/${id}`
  return json(200, servedMetadata(await obj.text(), image), a.arImage ? IMMUTABLE : ASSIGNED_CACHE)
}

async function imageFile(c: Collection, raw: string, deps: RevealDeps): Promise<Response> {
  const id = tokenIn(c, raw)
  if (id === undefined) return notFound()
  const a = await assignedPiece(deps.db!, c.slug, id)
  if (!a) return notFound()
  const obj = await deps.bucket?.get(pieceKey(c.slug, a.piece, 'jpg'))
  if (!obj) return json(503, { error: 'This piece is not loaded yet.' }, 'no-store', { 'retry-after': '60' })
  return new Response(obj.body, {
    headers: {
      ...BASE_HEADERS,
      'content-type': 'image/jpeg',
      'content-length': String(obj.size),
      'cache-control': IMMUTABLE,
    },
  })
}

async function provenanceFile(c: Collection, deps: RevealDeps): Promise<Response> {
  const obj = await deps.bucket?.get(provenanceKey(c.slug))
  if (!obj) return json(404, { error: 'No provenance yet.' }, 'no-store')
  return new Response(obj.body, {
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(obj.size),
      'cache-control': 'public, max-age=300',
    },
  })
}

/** Everything verify.mjs needs to redo each draw from the chain, in token order. */
export async function assignmentsFile(c: Collection, db: RevealDb): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT a.token_id, a.piece, a.seed_block, a.seed_block_hash, a.seed, m.block_number, m.block_hash, m.tx_hash,
              p.ar_image, p.ar_metadata
       FROM reveal_assignments a
       JOIN reveal_mints m ON m.slug = a.slug AND m.token_id = a.token_id
       LEFT JOIN reveal_pieces p ON p.slug = a.slug AND p.piece = a.piece
       WHERE a.slug = ? ORDER BY a.token_id`
    )
    .bind(c.slug)
    .all()
  return json(
    200,
    {
      slug: c.slug,
      chainId: c.chainId,
      address: c.address ?? null,
      deployBlock: c.deployBlock ?? null,
      supply: c.supply,
      provenanceHash: c.provenanceHash,
      confirmations: CONFIRMATIONS,
      rule: DRAW_RULE,
      lastScannedBlock: c.lastScannedBlock ?? null,
      minted: c.minted,
      assigned: results.length,
      assignments: results.map((r) => ({
        token: Number(r.token_id),
        piece: Number(r.piece),
        mintBlock: Number(r.block_number),
        mintBlockHash: String(r.block_hash),
        mintTx: String(r.tx_hash),
        seedBlock: Number(r.seed_block),
        seedBlockHash: String(r.seed_block_hash),
        seed: String(r.seed),
        ...(r.ar_image ? { arImage: String(r.ar_image) } : {}),
        ...(r.ar_metadata ? { arMetadata: String(r.ar_metadata) } : {}),
      })),
    },
    'public, max-age=30'
  )
}

const pieceKey = (slug: string, piece: number, ext: 'jpg' | 'json') => `${slug}/piece/${piece}.${ext}`
const provenanceKey = (slug: string) => `${slug}/provenance.json`

/* ---------- admin ---------- */

/** Compares the two keys' SHA-256s, so the time taken says nothing about how much of the key matched. */
async function sameKey(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!
  return diff === 0
}

/** The body, cut at `limit` bytes; undefined when it is (or says it is) larger. */
export async function readCappedBytes(request: Request, limit: number): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    await request.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) return undefined
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

async function readJson(request: Request, limit: number): Promise<Record<string, unknown> | undefined> {
  const bytes = await readCappedBytes(request, limit)
  if (!bytes) return undefined
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

async function handleAdmin(request: Request, deps: RevealDeps, slug: string, path: string[]): Promise<Response> {
  const key = deps.adminKey?.trim() ?? ''
  if (key.length < MIN_ADMIN_KEY) return json(503, { error: 'Admin is off (REVEAL_ADMIN_KEY is not set).' })
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || !(await sameKey(auth.slice(7), key))) return json(401, { error: 'Wrong key.' })
  const db = deps.db
  if (!db) return json(503, { error: 'No database (DB binding).' })
  const now = (deps.now ?? Date.now)()
  const route = `${request.method} ${path[0] ?? ''}`

  if (route === 'PUT collection') return registerCollection(request, db, slug, now)

  const c = await getCollection(db, slug)
  if (!c) return json(404, { error: `No collection "${slug}". PUT …/admin/collection first.` })

  switch (route) {
    case 'GET status':
      return adminStatus(c, db)
    case 'PUT provenance':
      return loadProvenance(request, c, db, deps.bucket)
    case 'PUT piece':
      return loadPiece(request, c, db, deps.bucket, path[1] ?? '')
    case 'POST attach':
      return attach(request, c, db, deps.chain?.(c.chainId), now)
    case 'POST arweave':
      return recordArweave(request, c, db)
    default:
      return json(404, { error: 'No such admin route.' })
  }
}

/**
 * Creates the collection, or updates its cover. Its chain, supply and provenance hash are fixed from the first call:
 * a different one is refused (a new slug is a new collection).
 */
async function registerCollection(request: Request, db: RevealDb, slug: string, now: number): Promise<Response> {
  const b = await readJson(request, MAX_SMALL_BODY)
  if (!b) return json(400, { error: 'Send JSON.' })
  const chainId = Number(b.chainId)
  const supply = Number(b.supply)
  const hash = String(b.provenanceHash ?? '')
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v : undefined)
  const name = text(b.name, 100)
  const description = text(b.description, 2000)
  const cover = text(b.coverImage, 2048)
  if (!Number.isInteger(chainId) || chainId < 1) return json(400, { error: 'chainId must be a chain id.' })
  if (!Number.isInteger(supply) || supply < 1 || supply > 100_000)
    return json(400, { error: 'supply must be 1..100000.' })
  if (!HEX64.test(hash)) return json(400, { error: 'provenanceHash must be sha256 hex.' })
  if (!name || !description || !cover) return json(400, { error: 'name, description and coverImage are needed.' })
  if (!/^(https:\/\/|ar:\/\/|ipfs:\/\/)\S+$/.test(cover))
    return json(400, { error: 'coverImage must be https://, ar:// or ipfs://.' })

  const was = await getCollection(db, slug)
  if (was && (was.chainId !== chainId || was.supply !== supply || was.provenanceHash !== hash)) {
    return json(409, { error: 'This slug is registered with another chain, supply or provenance. Use a new slug.' })
  }
  await db
    .prepare(
      `INSERT INTO reveal_collections (slug, chain_id, supply, provenance_hash, name, description, cover_image, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description,
         cover_image = excluded.cover_image, updated_at = excluded.updated_at`
    )
    .bind(slug, chainId, supply, hash, name, description, cover, now)
    .run()
  return json(200, { ok: true, collection: await getCollection(db, slug) })
}

async function adminStatus(c: Collection, db: RevealDb): Promise<Response> {
  const { results } = await db
    .prepare('SELECT piece, image_loaded, metadata_loaded FROM reveal_pieces WHERE slug = ? ORDER BY piece')
    .bind(c.slug)
    .all()
  const missingImages: number[] = []
  const missingMetadata: number[] = []
  for (const r of results) {
    if (!Number(r.image_loaded)) missingImages.push(Number(r.piece))
    if (!Number(r.metadata_loaded)) missingMetadata.push(Number(r.piece))
  }
  return json(200, { collection: c, provenanceLoaded: results.length === c.supply, missingImages, missingMetadata })
}

/** provenance.json: checked against the registered hash, then kept in R2 and as one row per piece. Safe to send again. */
async function loadProvenance(request: Request, c: Collection, db: RevealDb, bucket?: RevealBucket): Promise<Response> {
  if (!bucket) return json(503, { error: 'No bucket (REVEAL binding).' })
  const bytes = await readCappedBytes(request, MAX_PROVENANCE_BYTES)
  if (!bytes) return json(413, { error: 'Too large.' })
  let pieces: { n: number; image: string; metadata: string }[]
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    pieces = parsed.pieces
    if (!Array.isArray(pieces) || pieces.length !== c.supply) throw new Error(`pieces must have ${c.supply} entries`)
    const hash = await provenanceHash(pieces)
    if (hash !== c.provenanceHash) throw new Error(`its hash is ${hash}, not the registered ${c.provenanceHash}`)
  } catch (e) {
    return json(400, { error: `Provenance refused: ${(e as Error).message}` })
  }

  const stmts: RevealStmt[] = []
  for (let i = 0; i < pieces.length; i += ROWS_PER_INSERT) {
    const rows = pieces.slice(i, i + ROWS_PER_INSERT).map((p) => ({ n: p.n, i: p.image, m: p.metadata }))
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO reveal_pieces (slug, piece, image_sha256, metadata_sha256)
           SELECT ?, json_extract(value, '$.n'), json_extract(value, '$.i'), json_extract(value, '$.m') FROM json_each(?)`
        )
        .bind(c.slug, JSON.stringify(rows))
    )
  }
  await db.batch(stmts)
  // Rows that were there already must say the same (they can only, given the same hash; this proves it).
  const bad = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reveal_pieces p JOIN json_each(?) j ON p.piece = json_extract(j.value, '$.n')
       WHERE p.slug = ? AND (p.image_sha256 != json_extract(j.value, '$.i') OR p.metadata_sha256 != json_extract(j.value, '$.m'))`
    )
    .bind(JSON.stringify(pieces.map((p) => ({ n: p.n, i: p.image, m: p.metadata }))), c.slug)
    .first()
  if (Number(bad?.n)) return json(409, { error: 'Stored piece hashes differ from this provenance.' })
  await bucket.put(provenanceKey(c.slug), bytes, {
    httpMetadata: { contentType: 'application/json' },
    sha256: await sha256Hex(bytes),
  })
  return json(200, { ok: true, pieces: pieces.length })
}

/** PUT …/admin/piece/<n>.jpg or <n>.json: kept only when its sha256 is the provenance's. */
async function loadPiece(
  request: Request,
  c: Collection,
  db: RevealDb,
  bucket: RevealBucket | undefined,
  file: string
) {
  if (!bucket) return json(503, { error: 'No bucket (REVEAL binding).' })
  const m = /^([1-9]\d{0,8})\.(jpg|json)$/.exec(file)
  const piece = m ? Number(m[1]) : 0
  if (!m || piece > c.supply) return json(404, { error: 'Piece files are <n>.jpg and <n>.json.' })
  const ext = m[2] as 'jpg' | 'json'
  const row = await db
    .prepare('SELECT image_sha256, metadata_sha256 FROM reveal_pieces WHERE slug = ? AND piece = ?')
    .bind(c.slug, piece)
    .first()
  if (!row) return json(409, { error: 'Load provenance.json first.' })

  const bytes = await readCappedBytes(request, ext === 'jpg' ? MAX_IMAGE_BYTES : MAX_PIECE_JSON_BYTES)
  if (!bytes) return json(413, { error: 'Too large.' })
  const hash = await sha256Hex(bytes)
  const want = String(ext === 'jpg' ? row.image_sha256 : row.metadata_sha256)
  if (hash !== want) return json(422, { error: `sha256 ${hash} is not the provenance's ${want}.` })
  if (ext === 'jpg' && !isJpeg(bytes)) return json(422, { error: 'Not a JPEG.' })
  if (ext === 'json') {
    try {
      servedMetadata(new TextDecoder().decode(bytes), '')
    } catch (e) {
      return json(422, { error: (e as Error).message })
    }
  }

  await bucket.put(pieceKey(c.slug, piece, ext), bytes, {
    httpMetadata: { contentType: ext === 'jpg' ? 'image/jpeg' : 'application/json' },
    sha256: hash,
  })
  await db
    .prepare(
      `UPDATE reveal_pieces SET ${ext === 'jpg' ? 'image_loaded' : 'metadata_loaded'} = 1 WHERE slug = ? AND piece = ?`
    )
    .bind(c.slug, piece)
    .run()
  return json(200, { ok: true, piece, file: ext, sha256: hash })
}

/**
 * Sets the drop's address and the block it was created in, once checked on the chain: code first appears in that
 * block, maxSupply is the registered supply, and baseURI is this collection's /reveal/<slug>/ link. Fixed once a mint is
 * stored.
 */
async function attach(request: Request, c: Collection, db: RevealDb, chain: RevealChain | undefined, now: number) {
  const b = await readJson(request, MAX_SMALL_BODY)
  const address = String(b?.address ?? '')
  const deployBlock = Number(b?.deployBlock)
  if (!ADDRESS.test(address) || !Number.isInteger(deployBlock) || deployBlock < 1) {
    return json(400, { error: 'Send { address, deployBlock }.' })
  }
  const lower = address.toLowerCase()
  if (c.minted > 0 && (c.address !== lower || c.deployBlock !== deployBlock)) {
    return json(409, { error: 'Mints of this drop are already stored; it cannot be moved to another address.' })
  }
  if (!chain) return json(503, { error: `No RPC for chain ${c.chainId}.` })
  try {
    const [before, at, max, base] = await Promise.all([
      chain.hasCode(lower, deployBlock - 1),
      chain.hasCode(lower, deployBlock),
      chain.maxSupply(lower),
      chain.baseURI(lower),
    ])
    if (before || !at) return json(422, { error: `The contract was not created in block ${deployBlock}.` })
    if (max !== c.supply) return json(422, { error: `maxSupply is ${max}, the collection's supply is ${c.supply}.` })
    if (!base.endsWith(`${REVEAL_PREFIX}/${c.slug}/`)) {
      return json(422, { error: `baseURI is "${base}", not this collection's ${REVEAL_PREFIX}/${c.slug}/ link.` })
    }
  } catch (e) {
    return json(502, { error: `Chain check failed: ${(e as Error).message}` })
  }
  await db
    .prepare(
      `UPDATE reveal_collections SET address = ?, deploy_block = ?, last_scanned_block = ?, updated_at = ?
       WHERE slug = ? AND minted = 0`
    )
    .bind(lower, deployBlock, deployBlock - 1, now, c.slug)
    .run()
  if (c.minted > 0) return json(200, { ok: true, collection: c }) // the same address again: nothing to change
  return json(200, { ok: true, collection: await getCollection(db, c.slug) })
}

/** Records a drawn piece's Arweave ids (scripts/reveal/arweave.mjs). Set once: a different id later is refused. */
async function recordArweave(request: Request, c: Collection, db: RevealDb) {
  const b = await readJson(request, MAX_SMALL_BODY)
  const piece = Number(b?.piece)
  const image = String(b?.image ?? '')
  const metadata = String(b?.metadata ?? '')
  if (!Number.isInteger(piece) || piece < 1 || piece > c.supply || !AR_ID.test(image) || !AR_ID.test(metadata)) {
    return json(400, { error: 'Send { piece, image, metadata } with Arweave ids.' })
  }
  const drawn = await db
    .prepare('SELECT 1 AS ok FROM reveal_assignments WHERE slug = ? AND piece = ?')
    .bind(c.slug, piece)
    .first()
  if (!drawn) return json(409, { error: 'That piece is not drawn: it must not be on Arweave.' })
  const r = await db
    .prepare(
      `UPDATE reveal_pieces SET ar_image = ?, ar_metadata = ? WHERE slug = ? AND piece = ?
       AND (ar_image IS NULL OR (ar_image = ? AND ar_metadata = ?))`
    )
    .bind(image, metadata, c.slug, piece, image, metadata)
    .run()
  if (!r.meta.changes) return json(409, { error: 'This piece has other Arweave ids already.' })
  return json(200, { ok: true })
}

/* ---------- the cron ---------- */

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const ZERO_TOPIC = `0x${'0'.repeat(64)}`
/** First getLogs span tried; halved on errors (RPCs cap ranges), remembered per isolate. */
const FIRST_SPAN = 2000
const spans = new Map<string, number>()
/** RPC requests per collection per run. A header batch is one. */
const RPC_BUDGET = 40
const HEADERS_PER_CALL = 50
/** Draws written per run: a few thousand rows in one transaction at most. */
const MAX_DRAWS_PER_RUN = 2000
const LOCK_MS = 55_000
const REFRESH_PER_RUN = 20

export type CronDeps = {
  db: RevealDb
  chain: (chainId: number) => RevealChain | undefined
  now?: () => number
  log?: (line: string) => void
  /** Asks a marketplace to read a token's metadata again (OpenSea), best effort. False or a throw: try next run. */
  refresh?: (c: Collection, tokenId: number) => Promise<boolean>
}

/** One run over every attached collection. A collection's error is logged and kept on its row; the others go on. */
export async function runRevealCron(deps: CronDeps): Promise<void> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((l: string) => console.log(l))
  const { results } = await deps.db.prepare('SELECT * FROM reveal_collections WHERE address IS NOT NULL').all()
  for (const c of results.map(fromRow)) {
    const lockUntil = now() + LOCK_MS
    const got = await deps.db
      .prepare('UPDATE reveal_collections SET lock_until = ? WHERE slug = ? AND lock_until < ?')
      .bind(lockUntil, c.slug, now())
      .run()
    if (!got.meta.changes) {
      log(`reveal ${c.slug}: another run has it`)
      continue
    }
    try {
      const chain = deps.chain(c.chainId)
      if (!chain) throw new Error(`no RPC for chain ${c.chainId}`)
      const budget = { calls: RPC_BUDGET }
      const scanned = await scan(deps.db, chain, c.slug, budget, log)
      const drawn = await assign(deps.db, chain, c.slug, budget, now)
      if (scanned || drawn) log(`reveal ${c.slug}: ${scanned} mint(s) stored, ${drawn} drawn`)
      if (deps.refresh) await refreshSome(deps.db, c, deps.refresh, now, log)
      await deps.db
        .prepare('UPDATE reveal_collections SET last_error = NULL WHERE slug = ? AND last_error IS NOT NULL')
        .bind(c.slug)
        .run()
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500)
      log(`reveal ${c.slug}: ${msg}`)
      await deps.db
        .prepare('UPDATE reveal_collections SET last_error = ?, updated_at = ? WHERE slug = ?')
        .bind(msg, now(), c.slug)
        .run()
        .catch(() => undefined)
    } finally {
      await deps.db
        .prepare('UPDATE reveal_collections SET lock_until = 0 WHERE slug = ? AND lock_until = ?')
        .bind(c.slug, lockUntil)
        .run()
        .catch(() => undefined)
    }
  }
}

type Budget = { calls: number }
const spend = (b: Budget) => {
  if (b.calls <= 0) return false
  b.calls -= 1
  return true
}

type StoredMint = { tokenId: number; block: number; blockHash: string; tx: string; logIndex: number }

/** A Transfer-from-zero log of this drop in [from, to], checked field by field. */
export function parseMintLog(log: RawLog, address: string, from: number, to: number, supply: number): StoredMint {
  const topics = log.topics as unknown
  const bad = (why: string) => new Error(`Unexpected log (${why}): ${JSON.stringify(log).slice(0, 300)}`)
  if (log.removed === true) throw bad('removed')
  if (String(log.address).toLowerCase() !== address) throw bad('address')
  if (!Array.isArray(topics) || topics.length !== 4) throw bad('topics')
  if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC || String(topics[1]).toLowerCase() !== ZERO_TOPIC)
    throw bad('not a mint')
  const id = BigInt(hash32(topics[3], 'token id topic'))
  const block = Number(BigInt(String(log.blockNumber)))
  if (id < 1n || id > BigInt(supply)) throw bad('token id')
  if (!(block >= from && block <= to)) throw bad('block')
  return {
    tokenId: Number(id),
    block,
    blockHash: hash32(log.blockHash, 'blockHash'),
    tx: hash32(log.transactionHash, 'transactionHash'),
    logIndex: Number(BigInt(String(log.logIndex))),
  }
}

/**
 * Reads mints forward from last_scanned_block + 1 up to head - CONFIRMATIONS. Each chunk is written only when it is
 * whole: its mints are exactly tokens minted+1 .. totalSupply() at the chunk's last block. Returns the mints stored.
 */
async function scan(db: RevealDb, chain: RevealChain, slug: string, budget: Budget, log: (l: string) => void) {
  let stored = 0
  if (!spend(budget)) return 0
  const head = await chain.blockNumber()
  const safe = head - CONFIRMATIONS
  for (;;) {
    const c = await getCollection(db, slug)
    if (!c?.address || c.lastScannedBlock === undefined) return stored
    const from = c.lastScannedBlock + 1
    if (from > safe) return stored

    let span = spans.get(slug) ?? FIRST_SPAN
    let logs: RawLog[] | undefined
    let to = from
    while (!logs) {
      if (!spend(budget)) return stored
      to = Math.min(safe, from + span - 1)
      try {
        logs = await chain.mintLogs(c.address, from, to)
      } catch (e) {
        if (span === 1) throw e
        span = Math.max(1, Math.floor(span / 2))
        log(
          `reveal ${slug}: getLogs ${from}..${to} failed (${String((e as Error).message).slice(
            0,
            120
          )}), trying ${span} blocks`
        )
      }
    }
    spans.set(slug, span)

    const mints = logs.map((l) => parseMintLog(l, c.address!, from, to, c.supply)).sort((a, b) => a.tokenId - b.tokenId)
    mints.forEach((m, i) => {
      if (m.tokenId !== c.minted + i + 1)
        throw new Error(`Mints in ${from}..${to} are not tokens ${c.minted + 1}.. in order (got ${m.tokenId}).`)
      if (i && m.block < mints[i - 1]!.block)
        throw new Error(`Token ${m.tokenId} is in an earlier block than token ${m.tokenId - 1}.`)
    })
    if (!spend(budget)) return stored
    const total = await chain.totalSupplyAt(c.address, to)
    if (total !== c.minted + mints.length) {
      throw new Error(
        `totalSupply at block ${to} is ${total}, but ${
          c.minted + mints.length
        } mints were found: the logs are incomplete.`
      )
    }

    // One transaction: the counters move only from what this run read (compare-and-set, signed with a fresh writer
    // id), and the rows go in only if that write was this one. Plain INSERT on top: a token stored already fails it all.
    const writer = crypto.randomUUID()
    const stmts: RevealStmt[] = [
      db
        .prepare(
          `UPDATE reveal_collections SET last_scanned_block = ?, minted = ?, writer = ?
           WHERE slug = ? AND last_scanned_block = ? AND minted = ?`
        )
        .bind(to, total, writer, slug, from - 1, c.minted),
    ]
    for (let i = 0; i < mints.length; i += ROWS_PER_INSERT) {
      const rows = mints
        .slice(i, i + ROWS_PER_INSERT)
        .map((m) => ({ t: m.tokenId, b: m.block, h: m.blockHash, x: m.tx, l: m.logIndex }))
      stmts.push(
        db
          .prepare(
            `INSERT INTO reveal_mints (slug, token_id, block_number, block_hash, tx_hash, log_index)
             SELECT ?, json_extract(value, '$.t'), json_extract(value, '$.b'), json_extract(value, '$.h'),
               json_extract(value, '$.x'), json_extract(value, '$.l') FROM json_each(?)
             WHERE EXISTS (SELECT 1 FROM reveal_collections WHERE slug = ? AND writer = ?)`
          )
          .bind(slug, JSON.stringify(rows), slug, writer)
      )
    }
    const res = await db.batch(stmts)
    if (!res[0]?.meta.changes) return stored // another run got there first; it stored the same range
    stored += mints.length
  }
}

/**
 * Draws every stored mint that can be drawn, in token order, from the pool rebuilt from the draws already stored.
 * Returns how many were drawn.
 */
async function assign(db: RevealDb, chain: RevealChain, slug: string, budget: Budget, now: () => number) {
  const c = await getCollection(db, slug)
  if (!c || c.assigned >= c.minted) return 0
  const { results: pending } = await db
    .prepare(
      'SELECT token_id, block_number, block_hash FROM reveal_mints WHERE slug = ? AND token_id > ? ORDER BY token_id LIMIT ?'
    )
    .bind(slug, c.assigned, MAX_DRAWS_PER_RUN)
    .all()
  if (!pending.length) return 0
  if (!spend(budget)) return 0
  const head = await chain.blockNumber()

  // The headers of each pending mint's next block, as many as the budget allows, in order.
  const wanted = [...new Set(pending.map((r) => Number(r.block_number) + 1))]
  const headers = new Map<number, Header>()
  for (let i = 0; i < wanted.length; i += HEADERS_PER_CALL) {
    if (!spend(budget)) break
    const got = await chain.headers(wanted.slice(i, i + HEADERS_PER_CALL))
    for (const [n, h] of got) headers.set(n, h)
  }

  const { results: done } = await db
    .prepare('SELECT token_id, piece FROM reveal_assignments WHERE slug = ? ORDER BY token_id')
    .bind(slug)
    .all()
  if (done.length !== c.assigned) throw new Error(`${done.length} draws stored, the collection says ${c.assigned}.`)
  const pool = newPool(c.supply)
  done.forEach((r, i) => {
    if (Number(r.token_id) !== i + 1) throw new Error(`Stored draws skip token ${i + 1}.`)
    takePiece(pool, Number(r.piece))
  })

  const draws = []
  for (const [i, r] of pending.entries()) {
    const mint = { tokenId: Number(r.token_id), block: Number(r.block_number), blockHash: String(r.block_hash) }
    if (mint.tokenId !== c.assigned + i + 1) throw new Error(`Stored mints skip token ${c.assigned + i + 1}.`)
    if (mint.block + CONFIRMATIONS > head) break
    const next = headers.get(mint.block + 1)
    if (!next) break
    draws.push(drawFor(pool, mint, next))
  }
  if (!draws.length) return 0

  // As in scan: compare-and-set on the counter, rows only if it moved, and a token or piece drawn already fails it all.
  const at = now()
  const writer = crypto.randomUUID()
  const stmts: RevealStmt[] = [
    db
      .prepare('UPDATE reveal_collections SET assigned = ?, writer = ? WHERE slug = ? AND assigned = ?')
      .bind(c.assigned + draws.length, writer, slug, c.assigned),
  ]
  for (let i = 0; i < draws.length; i += ROWS_PER_INSERT) {
    const rows = draws
      .slice(i, i + ROWS_PER_INSERT)
      .map((d) => ({ t: d.tokenId, p: d.piece, b: d.seedBlock, h: d.seedBlockHash, s: d.seed }))
    stmts.push(
      db
        .prepare(
          `INSERT INTO reveal_assignments (slug, token_id, piece, seed_block, seed_block_hash, seed, assigned_at)
           SELECT ?, json_extract(value, '$.t'), json_extract(value, '$.p'), json_extract(value, '$.b'),
             json_extract(value, '$.h'), json_extract(value, '$.s'), ? FROM json_each(?)
           WHERE EXISTS (SELECT 1 FROM reveal_collections WHERE slug = ? AND writer = ?)`
        )
        .bind(slug, at, JSON.stringify(rows), slug, writer)
    )
  }
  const res = await db.batch(stmts)
  return res[0]?.meta.changes ? draws.length : 0 // 0: another run drew them first
}

/** Asks OpenSea to read freshly drawn tokens again: it read the cover at mint time and keeps it otherwise. */
async function refreshSome(
  db: RevealDb,
  c: Collection,
  refresh: NonNullable<CronDeps['refresh']>,
  now: () => number,
  log: (l: string) => void
) {
  const { results } = await db
    .prepare('SELECT token_id FROM reveal_assignments WHERE slug = ? AND refreshed_at = 0 ORDER BY token_id LIMIT ?')
    .bind(c.slug, REFRESH_PER_RUN)
    .all()
  for (const r of results) {
    const id = Number(r.token_id)
    const ok = await refresh(c, id).catch(() => false)
    if (!ok) {
      log(`reveal ${c.slug}: marketplace refresh of ${id} failed; next run tries again`)
      return
    }
    await db
      .prepare('UPDATE reveal_assignments SET refreshed_at = ? WHERE slug = ? AND token_id = ?')
      .bind(now(), c.slug, id)
      .run()
  }
}

/* ---------- the real chain ---------- */

const quantity = (n: number) => `0x${n.toString(16)}`
const SELECTOR = { totalSupply: '0x18160ddd', maxSupply: '0xd5abeb01', baseURI: '0x6c0360eb' } as const

/** JSON-RPC over fetch, one call or a batch. Errors and odd answers throw: nothing is filled in. */
export function rpcChain(url: string, fetchImpl: typeof fetch = fetch): RevealChain {
  let id = 0
  const post = async (body: unknown) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`RPC answered ${res.status}`)
    return res.json() as Promise<unknown>
  }
  const call = async (method: string, params: unknown[]) => {
    const a = (await post({ jsonrpc: '2.0', id: (id += 1), method, params })) as {
      result?: unknown
      error?: { message?: string }
    }
    if (a?.error || !a || !('result' in a)) throw new Error(`${method}: ${a?.error?.message ?? 'no result'}`)
    return a.result
  }
  const ethCall = async (address: string, data: string, block: number | 'latest' = 'latest') => {
    const r = await call('eth_call', [{ to: address, data }, block === 'latest' ? block : quantity(block)])
    if (typeof r !== 'string' || !/^0x[0-9a-fA-F]*$/.test(r)) throw new Error('eth_call: not hex')
    return r as `0x${string}`
  }
  const uint = (hex: string) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Expected one uint256.')
    const v = BigInt(hex)
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Number too large.')
    return Number(v)
  }

  return {
    blockNumber: async () => {
      const r = await call('eth_blockNumber', [])
      if (typeof r !== 'string' || !/^0x[0-9a-f]+$/i.test(r)) throw new Error('eth_blockNumber: not a number')
      return Number(BigInt(r))
    },
    mintLogs: async (address, from, to) => {
      const r = await call('eth_getLogs', [
        { address, fromBlock: quantity(from), toBlock: quantity(to), topics: [TRANSFER_TOPIC, ZERO_TOPIC] },
      ])
      if (!Array.isArray(r)) throw new Error('eth_getLogs: not a list')
      return r as RawLog[]
    },
    totalSupplyAt: async (address, block) => uint(await ethCall(address, SELECTOR.totalSupply, block)),
    maxSupply: async (address) => uint(await ethCall(address, SELECTOR.maxSupply)),
    baseURI: async (address) => {
      const [s] = decodeAbiParameters([{ type: 'string' }], await ethCall(address, SELECTOR.baseURI))
      return s
    },
    hasCode: async (address, block) => {
      const r = await call('eth_getCode', [address, quantity(block)])
      if (typeof r !== 'string') throw new Error('eth_getCode: not hex')
      return r !== '0x' && r !== '0x0'
    },
    headers: async (numbers) => {
      const out = new Map<number, Header>()
      if (!numbers.length) return out
      const first = id + 1
      const batch = numbers.map((n) => ({
        jsonrpc: '2.0',
        id: (id += 1),
        method: 'eth_getBlockByNumber',
        params: [quantity(n), false],
      }))
      const answers = await post(batch)
      if (!Array.isArray(answers)) throw new Error('eth_getBlockByNumber batch: not a list')
      for (const a of answers as {
        id?: number
        result?: Record<string, unknown> | null
        error?: { message?: string }
      }[]) {
        const n = numbers[Number(a?.id) - first]
        if (n === undefined) throw new Error('eth_getBlockByNumber batch: unknown id')
        if (a.error) throw new Error(`eth_getBlockByNumber ${n}: ${a.error.message ?? 'error'}`)
        if (a.result === null) continue // not mined yet
        const b = a.result
        if (!b || Number(BigInt(String(b.number))) !== n) throw new Error(`eth_getBlockByNumber ${n}: wrong block`)
        out.set(n, {
          number: n,
          hash: hash32(b.hash, 'hash'),
          parentHash: hash32(b.parentHash, 'parentHash'),
          mixHash: hash32(b.mixHash, 'mixHash'),
        })
      }
      return out
    },
  }
}

/** OpenSea's "refresh metadata" for one token (chain 1 only), with the Worker's OPENSEA_API_KEY. */
export function openSeaRefresher(apiKey: string | undefined, fetchImpl: typeof fetch = fetch) {
  if (!apiKey) return undefined
  return async (c: Collection, tokenId: number) => {
    if (c.chainId !== 1 || !c.address) return true
    const res = await fetchImpl(
      `https://api.opensea.io/api/v2/chain/ethereum/contract/${c.address}/nfts/${tokenId}/refresh`,
      {
        method: 'POST',
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      }
    )
    await res.body?.cancel().catch(() => undefined)
    return res.ok
  }
}

/**
 * Allowlists for drop phases (contracts/src/factories/erc721drop/ERC721DropInstance.sol): the Merkle tree and the
 * proof route. Pure (viem and Web crypto), so the page, the Worker, the scripts in scripts/ and `node --test` all share it.
 *
 * The tree is OpenZeppelin's StandardMerkleTree for `['address']`, exactly as the drop checks it:
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(minter))))
 *   parent = keccak256(sorted pair)   (solady MerkleProofLib: commutative, smaller hash first)
 * Leaves are sorted by hash and laid out in one array, root first, as StandardMerkleTree.of does, so a saved list
 * (`AllowlistDump`, format 'standard-v1') loads in @openzeppelin/merkle-tree as is. tests/allowlist.test.mts and
 * contracts/test/AllowlistProof.t.sol check the two agree.
 *
 * The proof route (public: a list is who may mint, not a secret):
 *   GET  /api/allowlist/<root>?address=0x…  { root, address, listed, proof? }   404 when miya has no list for <root>
 *   GET  /api/allowlist/<root>              { root, count, source? }
 *   POST /api/allowlist  { addresses }      { root, count }   saves a pasted list (same origin, capped, rate limited)
 * Lists come from the build first (public/allowlists/<root>.json, written by scripts/allowlist-snapshot.mts), then
 * from D1 (migrations/0005_allowlists.sql) for lists pasted in the Launch window. A saved list is keyed by the root
 * the server works out itself, so nobody can file a list under another list's root.
 *
 * A 404 means miya looked and has no such list. When a copy couldn't be read (the asset store or D1 failed, a stored
 * list doesn't rebuild to its root), the answer is 503 without a root, which the page shows as "couldn't check", never
 * as "no list". A list is fixed by its root, so a 200 for a shipped list may be cached.
 */
import type { Address, Hex } from 'viem'
import { bytesToHex, getAddress, hexToBytes, isAddress, keccak256 } from 'viem'

export const ALLOWLIST_PATH = '/api/allowlist'
/**
 * Most addresses a list pasted in the Launch window can have. Bigger lists are built with the snapshot script. Building
 * a 5,000-wallet tree is 10,000 hashes, past the free Workers plan's CPU time per request: Workers Paid is advised
 * once people paste big lists.
 */
export const MAX_PASTED = 5000
/** A POST body: MAX_PASTED addresses as JSON strings, with room to spare. */
export const ALLOWLIST_BODY_LIMIT = 300_000
/** Lists saved through POST in one day, across everyone, and from one client (hashed IP). */
export const MAX_SAVED_PER_DAY = 200
export const MAX_SAVED_PER_CLIENT_PER_DAY = 10
/** What one saved row may hold (MAX_PASTED lowercase addresses as JSON), and all rows saved in a day together. */
export const MAX_ROW_BYTES = MAX_PASTED * 45 + 16
export const MAX_SAVED_BYTES_PER_DAY = 10_000_000

export type AllowlistDump = {
  format: 'standard-v1'
  leafEncoding: ['address']
  tree: Hex[]
  values: { value: [Address]; treeIndex: number }[]
}

/** Where a list came from, written next to it by the snapshot script. */
export type AllowlistSource = {
  name: string
  chainId: number
  /** The collection whose holders were read. */
  contract: Address
  block: number
  blockTime: number
  /** Token ids read (ownerOf over each) and how many had an owner. */
  idsRead: string
  tokens: number
  /** Holders that had contract code at the block (not 7702 delegations): kept, but a pool or vault can't claim. */
  contracts: number
}

/**
 * What a refresh (scripts/refresh-phases.mts) left off a list it made for one drop, so the next refresh carries it
 * without a file kept by hand: `liveFromEpoch` is the drop's phasesEpoch once the setPhases with this list lands.
 */
export type RefreshRecord = { drop: Address; liveFromEpoch: number; block: number }

/** A list file: the OpenZeppelin dump plus our own fields under `miya` (OpenZeppelin ignores extra keys). */
export type AllowlistFile = AllowlistDump & {
  miya?: {
    root: Hex
    count: number
    source?: AllowlistSource
    /** A refresh's list: for which drop, and every wallet (lowercase) it left off because it claimed before. */
    refresh?: RefreshRecord
    excluded?: string[]
  }
}

// ── the tree ─────────────────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const ROOT_RE = /^0x[0-9a-f]{64}$/
const ZERO = `0x${'0'.repeat(40)}`

/** abi.encode(address): 12 zero bytes, then the 20 address bytes. */
function encodeAddress(address: string): Uint8Array {
  const out = new Uint8Array(32)
  out.set(hexToBytes(address as Hex), 12)
  return out
}

/** The leaf the drop checks for `address`: keccak256(bytes.concat(keccak256(abi.encode(address)))). */
export const leafBytes = (address: string): Uint8Array => keccak256(keccak256(encodeAddress(address), 'bytes'), 'bytes')
export const leafHash = (address: string): Hex => bytesToHex(leafBytes(address))

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i += 1) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number)
  return 0
}

/** keccak256 of the two hashes, smaller first (MerkleProofLib and OpenZeppelin's hashPair). */
function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(64)
  const [x, y] = compare(a, b) <= 0 ? [a, b] : [b, a]
  out.set(x)
  out.set(y, 32)
  return keccak256(out, 'bytes')
}

/**
 * The tree of `addresses` (checked, de-duplicated, any case). Throws on an empty list or a bad address: callers parse
 * first (parseAddressList). Values are in address order, so the same list always gives the same file. `checksum: false`
 * leaves the values lowercase (the server: a checksum is a hash per wallet, and only the one asked about is shown).
 */
export function buildTree(addresses: readonly string[], opts: { checksum?: boolean } = {}): AllowlistDump & { root: Hex } {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (!unique.length) throw new Error('An allowlist needs at least one address.')
  for (const a of unique) {
    if (!ADDRESS_RE.test(a) || a === ZERO) throw new Error(`Not an address: ${a}`)
  }
  unique.sort()
  const hashed = unique.map((a, valueIndex) => ({ valueIndex, hash: leafBytes(a) }))
  hashed.sort((a, b) => compare(a.hash, b.hash))
  const n = hashed.length
  const tree: Uint8Array[] = new Array(2 * n - 1)
  hashed.forEach((h, i) => {
    tree[tree.length - 1 - i] = h.hash
  })
  for (let i = tree.length - 1 - n; i >= 0; i -= 1) tree[i] = hashPair(tree[2 * i + 1]!, tree[2 * i + 2]!)
  const checksum = opts.checksum ?? true
  const values: AllowlistDump['values'] = unique.map((a) => ({ value: [(checksum ? getAddress(a) : a) as Address], treeIndex: 0 }))
  hashed.forEach((h, leafIndex) => {
    values[h.valueIndex]!.treeIndex = tree.length - 1 - leafIndex
  })
  const hex = tree.map((t) => bytesToHex(t))
  return { format: 'standard-v1', leafEncoding: ['address'], tree: hex, values, root: hex[0] as Hex }
}

/** The sibling hashes from the leaf at `treeIndex` up to the root (StandardMerkleTree.getProof). */
export function proofAt(tree: readonly Hex[], treeIndex: number): Hex[] {
  const proof: Hex[] = []
  let i = treeIndex
  while (i > 0) {
    const sibling = i % 2 === 1 ? i + 1 : i - 1
    proof.push(tree[sibling] as Hex)
    i = Math.floor((i - 1) / 2)
  }
  return proof
}

/** True when `proof` proves `address` under `root`, as MerkleProofLib.verify does it (sorted pairs). */
export function verifyProof(root: string, address: string, proof: readonly string[]): boolean {
  if (!ADDRESS_RE.test(address) || !/^0x[0-9a-fA-F]{64}$/.test(root)) return false
  let h = leafBytes(address)
  for (const p of proof) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(p)) return false
    h = hashPair(h, hexToBytes(p as Hex))
  }
  return bytesToHex(h) === root.toLowerCase()
}

/** Address (lowercase) → tree index, for proofs without searching. */
export const indexOf = (dump: Pick<AllowlistDump, 'values'>) =>
  new Map(dump.values.map((v) => [v.value[0].toLowerCase(), v.treeIndex]))

/** `address`'s proof in a list, or undefined when it is not on it. */
export function proofFor(dump: AllowlistDump, address: string, index = indexOf(dump)): Hex[] | undefined {
  const at = index.get(address.toLowerCase())
  return at === undefined ? undefined : proofAt(dump.tree, at)
}

/**
 * A list file read back (from the build, D1 or a person's upload), checked for shape: the format, every hash and
 * address well formed, every tree index inside the tree and a leaf. The tree's own hashes are not recomputed here
 * (that is what buildTree is for); a wrong one only gives proofs that fail on chain.
 */
export function readDump(raw: unknown): AllowlistFile | undefined {
  const d = raw as AllowlistFile
  if (!d || typeof d !== 'object' || d.format !== 'standard-v1') return undefined
  if (!Array.isArray(d.leafEncoding) || d.leafEncoding.length !== 1 || d.leafEncoding[0] !== 'address') return undefined
  if (!Array.isArray(d.tree) || !Array.isArray(d.values) || !d.values.length) return undefined
  if (d.tree.length !== 2 * d.values.length - 1) return undefined
  if (!d.tree.every((h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h))) return undefined
  const firstLeaf = d.tree.length - d.values.length
  for (const v of d.values) {
    if (!v || !Array.isArray(v.value) || typeof v.value[0] !== 'string' || !ADDRESS_RE.test(v.value[0])) return undefined
    if (!Number.isInteger(v.treeIndex) || v.treeIndex < firstLeaf || v.treeIndex >= d.tree.length) return undefined
  }
  return d
}

// ── lists people paste ───────────────────────────────────────────────────────

export type ParsedList = {
  /** Checksummed, de-duplicated, in the order first seen. */
  addresses: Address[]
  /** How many addresses were given more than once (kept once). */
  duplicates: number
  /** What looked meant as an address but isn't one (wrong length, bad checksum, a name like x.eth). */
  bad: string[]
}

/**
 * Addresses from pasted text or an uploaded .txt/.csv: anything separated by spaces, new lines, commas or semicolons.
 * Words that are plainly not addresses (a CSV header, an amount column) are skipped; a token that starts with 0x but
 * isn't an address, a mixed-case address whose checksum is wrong, the zero address or an ENS name is `bad`.
 */
export function parseAddressList(text: string): ParsedList {
  const seen = new Set<string>()
  const addresses: Address[] = []
  const bad: string[] = []
  let duplicates = 0
  for (const raw of (text || '').split(/[\s,;"'`|]+/)) {
    const t = raw.trim()
    if (!t) continue
    if (ADDRESS_RE.test(t)) {
      if (!isAddress(t) || t.toLowerCase() === ZERO) {
        bad.push(t)
        continue
      }
      const k = t.toLowerCase()
      if (seen.has(k)) duplicates += 1
      else {
        seen.add(k)
        addresses.push(getAddress(t))
      }
    } else if (/^0x/i.test(t) || /\.eth$/i.test(t)) bad.push(t)
  }
  return { addresses, duplicates, bad }
}

// ── the route ────────────────────────────────────────────────────────────────

type Req = { method: string; url: string; headers?: Headers; body?: string }

export interface AllowlistStore {
  /** The saved list as stored (checked by readStored), or undefined when none is saved. Throws when it can't read. */
  get(root: Hex): Promise<unknown>
  /** False when a list with this root is already saved (same root = same list, so nothing is lost). */
  put(root: Hex, addresses: readonly string[], at: number, client?: string): Promise<boolean>
  /** Lists saved since `at`, and their size, by everyone or by one client (hashed), for the day's caps. */
  usageSince(at: number, client?: string): Promise<{ lists: number; bytes: number }>
}

export type AllowlistDeps = {
  /** A list shipped with the build (public/allowlists/<root>.json), undefined when there is none. Throws on a failed read. */
  readStatic: (root: Hex) => Promise<unknown>
  store?: AllowlistStore
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  /** Its own bucket for saving lists. */
  writeLimiter: (key: string) => boolean
  now?: () => number
}

/** A list is fixed by its root, so a shipped list's answers never change (a pasted one is only cached per isolate). */
const IMMUTABLE = 'public, max-age=3600, s-maxage=86400, immutable'

const reply = (status: number, body: unknown, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  })

/** What a pasted list is saved as: only its addresses, lowercase and sorted (the tree is built again when read). */
export const storedBody = (addresses: readonly string[]) =>
  JSON.stringify([...new Set(addresses.map((a) => a.toLowerCase()))].sort())

/** A saved row read back: lowercase addresses in strict order, at least one and at most MAX_PASTED; else undefined. */
export function readStored(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PASTED) return undefined
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i]
    if (typeof a !== 'string' || !/^0x[0-9a-f]{40}$/.test(a) || a === ZERO) return undefined
    if (i > 0 && !((raw[i - 1] as string) < a)) return undefined
  }
  return raw as string[]
}

/**
 * The client key as D1 keeps it, the same way as station.ts's clientTag (not imported: this file has no imports of its
 * own, so the scripts can run it under plain node). Undefined when there is no real key.
 */
async function clientTag(key: string): Promise<string | undefined> {
  if (!key || key === 'unknown') return undefined
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`miya-client:${key}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

/** Lists read lately, per isolate: a claim rush asks for the same few lists over and over. */
const CACHE_SIZE = 8
type Loaded = { dump: AllowlistFile; index: Map<string, number>; shipped: boolean }
const cache = new Map<string, Loaded>()

function remember(root: string, dump: AllowlistFile, shipped: boolean) {
  const entry = { dump, index: indexOf(dump), shipped }
  cache.delete(root)
  cache.set(root, entry)
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return entry
}

/** Forget the cached lists (tests). */
export const clearAllowlistCache = () => cache.clear()

/** The list for `root`; 'missing' when miya has none; 'failed' when a copy couldn't be read or doesn't check out. */
async function loadList(root: Hex, deps: AllowlistDeps): Promise<Loaded | 'missing' | 'failed'> {
  const hit = cache.get(root)
  if (hit) return hit
  let raw: unknown
  try {
    raw = await deps.readStatic(root)
  } catch {
    return 'failed'
  }
  if (raw !== undefined) {
    // The file's name is its root; one that doesn't read, or whose tree says otherwise, is broken, not missing.
    const shipped = readDump(raw)
    return shipped && shipped.tree[0]?.toLowerCase() === root ? remember(root, shipped, true) : 'failed'
  }
  if (!deps.store) return 'missing'
  let saved: unknown
  try {
    saved = await deps.store.get(root)
  } catch {
    return 'failed'
  }
  if (saved === undefined) return 'missing'
  const addresses = readStored(saved)
  if (!addresses) return 'failed'
  const { root: built, ...dump } = buildTree(addresses, { checksum: false })
  if (built !== root) return 'failed'
  return remember(root, { ...dump, miya: { root, count: dump.values.length } }, false)
}

export async function handleAllowlistRequest(req: Req, deps: AllowlistDeps): Promise<Response> {
  const url = new URL(req.url)
  const key = deps.clientKey(req.headers)

  if (req.method === 'POST' && url.pathname === ALLOWLIST_PATH) {
    if (!deps.sameOrigin(req.headers, url)) return reply(403, { error: 'Lists can only be saved from miyamaker.' })
    if (!deps.store) return reply(503, { error: 'Saving lists is not set up here.' })
    if (!deps.writeLimiter(key)) return reply(429, { error: 'Too many lists at once. Try again in a minute.' })
    let addresses: unknown
    try {
      addresses = (JSON.parse(req.body || '') as { addresses?: unknown }).addresses
    } catch {
      return reply(400, { error: 'Send { addresses: [...] }.' })
    }
    if (!Array.isArray(addresses) || !addresses.length) return reply(400, { error: 'The list is empty.' })
    if (addresses.length > MAX_PASTED) {
      return reply(413, { error: `A pasted list can have at most ${MAX_PASTED.toLocaleString('en-US')} addresses.` })
    }
    if (!addresses.every((a) => typeof a === 'string' && ADDRESS_RE.test(a) && a.toLowerCase() !== ZERO)) {
      return reply(400, { error: 'Every entry must be an address.' })
    }
    const now = (deps.now ?? Date.now)()
    const { root, ...dump } = buildTree(addresses as string[], { checksum: false })
    const values = dump.values.map((v) => v.value[0] as string)
    const bytes = storedBody(values).length
    if (bytes > MAX_ROW_BYTES) return reply(413, { error: 'That list is too large.' })
    const client = await clientTag(key)
    try {
      // The same list again is already saved: nothing to add, and it doesn't count against the day.
      if ((await deps.store.get(root)) !== undefined) return reply(200, { root, count: values.length })
      const day = now - 86_400_000
      const all = await deps.store.usageSince(day)
      if (all.lists >= MAX_SAVED_PER_DAY || all.bytes + bytes > MAX_SAVED_BYTES_PER_DAY) {
        return reply(429, { error: 'miya has saved as many lists as it takes today. Try again tomorrow.' })
      }
      if (client && (await deps.store.usageSince(day, client)).lists >= MAX_SAVED_PER_CLIENT_PER_DAY) {
        return reply(429, { error: 'miya has saved as many lists from here as it takes in a day. Try again tomorrow.' })
      }
      await deps.store.put(root, values, now, client)
    } catch {
      // Most likely migrations/0005_allowlists.sql has not run yet.
      return reply(503, { error: "miya couldn't save the list just now. Nothing was created. Try again." })
    }
    return reply(200, { root, count: values.length })
  }

  if (req.method !== 'GET') return reply(405, { error: 'Use GET, or POST to save a list.' })
  const m = /^\/api\/allowlist\/(0x[0-9a-fA-F]{64})\/?$/.exec(url.pathname)
  if (!m) return reply(404, { error: 'Ask for /api/allowlist/<root>?address=0x…' })
  if (!deps.limiter(key)) return reply(429, { error: 'Too many requests. Try again in a minute.' })
  const root = (m[1] as string).toLowerCase() as Hex
  const address = url.searchParams.get('address')
  if (address !== null && !ADDRESS_RE.test(address)) return reply(400, { error: 'That is not an address.' })
  if (!ROOT_RE.test(root)) return reply(400, { error: 'That is not a list root.' })

  const list = await loadList(root, deps)
  if (list === 'missing') return reply(404, { error: 'miya does not have this list.', root })
  // No root in the body: the page reads that as "couldn't check", not as "no list".
  if (list === 'failed') return reply(503, { error: "miya couldn't read this list just now. Try again." })
  const cache = list.shipped ? IMMUTABLE : 'no-store'
  if (address === null) {
    return reply(200, { root, count: list.dump.values.length, source: list.dump.miya?.source }, cache)
  }
  const at = list.index.get(address.toLowerCase())
  if (at === undefined) return reply(200, { root, address: getAddress(address), listed: false }, cache)
  return reply(200, { root, address: getAddress(address), listed: true, proof: proofAt(list.dump.tree, at) }, cache)
}

// ── storage ──────────────────────────────────────────────────────────────────

type D1Stmt = {
  bind: (...values: unknown[]) => D1Stmt
  first: () => Promise<Record<string, unknown> | null>
  run: () => Promise<{ meta: { changes: number } }>
}

/** Pasted lists in Cloudflare D1 (migrations/0005_allowlists.sql): the addresses only, with who saved them (hashed). */
export const d1AllowlistStore = (db: { prepare: (sql: string) => D1Stmt }): AllowlistStore => ({
  get: async (root) => {
    const row = await db.prepare('SELECT body FROM allowlists WHERE root = ?').bind(root).first()
    // A row that isn't JSON throws: it is a broken copy, not a missing list.
    return row ? (JSON.parse(String(row.body)) as unknown) : undefined
  },
  put: async (root, addresses, at, client) =>
    (
      await db
        .prepare('INSERT OR IGNORE INTO allowlists (root, count, body, created_at, client_hash) VALUES (?, ?, ?, ?, ?)')
        .bind(root, addresses.length, storedBody(addresses), at, client ?? null)
        .run()
    ).meta.changes > 0,
  usageSince: async (at, client) => {
    const sql = 'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(body)), 0) AS bytes FROM allowlists WHERE created_at >= ?'
    const row = client
      ? await db.prepare(`${sql} AND client_hash = ?`).bind(at, client).first()
      : await db.prepare(sql).bind(at).first()
    return { lists: Number(row?.n ?? 0), bytes: Number(row?.bytes ?? 0) }
  },
})

/** For `yarn dev` and tests: lists kept in memory. */
export function memoryAllowlistStore(): AllowlistStore {
  const rows = new Map<string, { body: string; at: number; client?: string }>()
  return {
    get: async (root) => {
      const r = rows.get(root)
      return r ? (JSON.parse(r.body) as unknown) : undefined
    },
    put: async (root, addresses, at, client) => {
      if (rows.has(root)) return false
      rows.set(root, { body: storedBody(addresses), at, client })
      return true
    },
    usageSince: async (at, client) => {
      const mine = [...rows.values()].filter((r) => r.at >= at && (!client || r.client === client))
      return { lists: mine.length, bytes: mine.reduce((n, r) => n + r.body.length, 0) }
    },
  }
}

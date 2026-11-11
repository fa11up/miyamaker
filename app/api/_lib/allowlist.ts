/**
 * Allowlists for drop phases (contracts/src/factories/erc721drop/ERC721DropInstance.sol): the Merkle tree and the
 * proof route. Pure (only viem), so the page, the Worker, the scripts in scripts/ and `node --test` all share it.
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
 */
import type { Address, Hex } from 'viem'
import { bytesToHex, getAddress, hexToBytes, isAddress, keccak256 } from 'viem'

export const ALLOWLIST_PATH = '/api/allowlist'
/** Most addresses a list pasted in the Launch window can have. Bigger lists are built with the snapshot script. */
export const MAX_PASTED = 5000
/** A POST body: MAX_PASTED addresses as JSON strings, with room to spare. */
export const ALLOWLIST_BODY_LIMIT = 300_000
/** Lists saved through POST in one day, across everyone. */
export const MAX_SAVED_PER_DAY = 200

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

/** A list file: the OpenZeppelin dump plus our own fields under `miya` (OpenZeppelin ignores extra keys). */
export type AllowlistFile = AllowlistDump & { miya?: { root: Hex; count: number; source?: AllowlistSource } }

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
 * first (parseAddressList). Values are in address order, so the same list always gives the same file.
 */
export function buildTree(addresses: readonly string[]): AllowlistDump & { root: Hex } {
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
  const values: AllowlistDump['values'] = unique.map((a) => ({ value: [getAddress(a)], treeIndex: 0 }))
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
  get(root: Hex): Promise<AllowlistFile | undefined>
  /** False when a list with this root is already saved (same root = same list, so nothing is lost). */
  put(root: Hex, count: number, json: string, at: number): Promise<boolean>
  /** Lists saved since `at`, for the day's cap. */
  countSince(at: number): Promise<number>
}

export type AllowlistDeps = {
  /** A list shipped with the build (public/allowlists/<root>.json), or undefined. */
  readStatic: (root: Hex) => Promise<unknown>
  store?: AllowlistStore
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  /** Its own bucket for saving lists. */
  writeLimiter: (key: string) => boolean
  now?: () => number
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** Lists read lately, per isolate: a claim rush asks for the same few lists over and over. */
const CACHE_SIZE = 8
const cache = new Map<string, { dump: AllowlistFile; index: Map<string, number> }>()

function remember(root: string, dump: AllowlistFile) {
  const entry = { dump, index: indexOf(dump) }
  cache.delete(root)
  cache.set(root, entry)
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return entry
}

/** Forget the cached lists (tests). */
export const clearAllowlistCache = () => cache.clear()

async function loadList(root: Hex, deps: AllowlistDeps) {
  const hit = cache.get(root)
  if (hit) return hit
  const shipped = readDump(await deps.readStatic(root).catch(() => undefined))
  // The file's name is its root; one whose tree says otherwise is not served under it.
  if (shipped && shipped.tree[0]?.toLowerCase() === root) return remember(root, shipped)
  const saved = deps.store ? readDump(await deps.store.get(root).catch(() => undefined)) : undefined
  if (saved && saved.tree[0]?.toLowerCase() === root) return remember(root, saved)
  return undefined
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
    const { root, ...dump } = buildTree(addresses as string[])
    const file: AllowlistFile = { ...dump, miya: { root, count: dump.values.length } }
    try {
      // The same list again is already saved: nothing to add, and it doesn't count against the day.
      if (readDump(await deps.store.get(root))) return reply(200, { root, count: dump.values.length })
      if ((await deps.store.countSince(now - 86_400_000)) >= MAX_SAVED_PER_DAY) {
        return reply(429, { error: 'miya has saved as many lists as it takes today. Try again tomorrow.' })
      }
      await deps.store.put(root, dump.values.length, JSON.stringify(file), now)
    } catch {
      // Most likely migrations/0005_allowlists.sql has not run yet.
      return reply(503, { error: "miya couldn't save the list just now. Nothing was created. Try again." })
    }
    return reply(200, { root, count: dump.values.length })
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
  if (!list) return reply(404, { error: 'miya does not have this list.', root })
  if (address === null) {
    return reply(200, { root, count: list.dump.values.length, source: list.dump.miya?.source })
  }
  const at = list.index.get(address.toLowerCase())
  if (at === undefined) return reply(200, { root, address: getAddress(address), listed: false })
  return reply(200, { root, address: getAddress(address), listed: true, proof: proofAt(list.dump.tree, at) })
}

// ── storage ──────────────────────────────────────────────────────────────────

type D1Stmt = {
  bind: (...values: unknown[]) => D1Stmt
  first: () => Promise<Record<string, unknown> | null>
  run: () => Promise<{ meta: { changes: number } }>
}

/** Pasted lists in Cloudflare D1 (migrations/0005_allowlists.sql). */
export const d1AllowlistStore = (db: { prepare: (sql: string) => D1Stmt }): AllowlistStore => ({
  get: async (root) => {
    const row = await db.prepare('SELECT body FROM allowlists WHERE root = ?').bind(root).first()
    if (!row) return undefined
    try {
      return JSON.parse(String(row.body)) as AllowlistFile
    } catch {
      return undefined
    }
  },
  put: async (root, count, json, at) =>
    (
      await db
        .prepare('INSERT OR IGNORE INTO allowlists (root, count, body, created_at) VALUES (?, ?, ?, ?)')
        .bind(root, count, json, at)
        .run()
    ).meta.changes > 0,
  countSince: async (at) =>
    Number((await db.prepare('SELECT COUNT(*) AS n FROM allowlists WHERE created_at >= ?').bind(at).first())?.n ?? 0),
})

/** For `yarn dev` and tests: lists kept in memory. */
export function memoryAllowlistStore(): AllowlistStore {
  const rows = new Map<string, { json: string; at: number }>()
  return {
    get: async (root) => {
      const r = rows.get(root)
      return r ? (JSON.parse(r.json) as AllowlistFile) : undefined
    },
    put: async (root, _count, json, at) => {
      if (rows.has(root)) return false
      rows.set(root, { json, at })
      return true
    },
    countSince: async (at) => [...rows.values()].filter((r) => r.at >= at).length,
  }
}

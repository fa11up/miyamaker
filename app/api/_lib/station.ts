/**
 * The radio's community station: anyone adds a track they uploaded to Arweave and it plays for everyone at once. The
 * station's admins (STATION_ADMINS) or whoever added it can take it off. Taking your own off leaves it free to be added
 * again, by anyone: otherwise any wallet could block any track for good by adding and removing it. A track the station
 * removes stays refused until the station restores it.
 *
 *   GET  /api/station         { tracks, admins, nextBefore? }   newest first; ?before=<nextBefore> gets the next page
 *   POST /api/station/add     { txId, title, artist, artworkId?, duration?, wallet, at, signature }
 *   POST /api/station/remove  { txId, wallet, at, signature }
 *   POST /api/station/restore { txId, wallet, at, signature }   admins only
 *
 * A write is a wallet signature over the exact words in addMessage / removeMessage / restoreMessage, fresh within 10 minutes,
 * and used once: the signed words are remembered (hashed) until they are too old anyway, so a copied request cannot be
 * sent again. The add words cover the cover art and length too. No sessions.
 *
 * Caps: MAX_PER_WALLET_PER_DAY per wallet, MAX_PER_CLIENT_PER_DAY per client (IP, IPv6 by /64; stored hashed on the row),
 * MAX_PER_DAY in all, so one person with many wallets cannot take the whole day. The listing is cached for LIST_CACHE_MS
 * and rate limited like the writes (its own bucket).
 * The Arweave file is checked to really be audio before it is listed. The file itself is permanent; only the listing
 * can go. Storage, the signature check and the gateway check are passed in, so `node --test` can run all of it
 * (tests/station.test.mts); the page imports the message builders so both sides sign the same words.
 */

export const STATION_PATH = '/api/station'
const MAX_AGE_MS = 10 * 60_000
const DAY_MS = 86_400_000
export const MAX_PER_WALLET_PER_DAY = 10
export const MAX_PER_DAY = 200
/** Per client (IP): a few wallets' worth, well under the day's total. */
export const MAX_PER_CLIENT_PER_DAY = 20
/** How long a GET of the listing is served from the cache. */
export const LIST_CACHE_MS = 10_000
/** Signed words are remembered for this long: past the 10 minutes either side in which they are accepted. */
export const USED_KEEP_MS = 3 * MAX_AGE_MS
/** One page. Five of the busiest possible days, so tracks only reach a second page once the station is very full. */
export const LIST_LIMIT = 1000
const TX_ID = /^[A-Za-z0-9_-]{43,44}$/
const CURSOR = /^(\d+)_([A-Za-z0-9_-]{43,44})$/
const WALLET = /^0x[0-9a-fA-F]{40}$/

export type StationRow = {
  txId: string
  title: string
  artist: string
  artworkId?: string
  duration?: number
  uploader: string
  addedAt: number
  removedAt?: number
  removedBy?: string
}

/** Where a page of the listing starts: the rows after this one, newest first. */
export type StationCursor = { addedAt: number; txId: string }

export interface StationStore {
  list(limit: number, before?: StationCursor): Promise<StationRow[]>
  /** Removed rows too. */
  get(txId: string): Promise<StationRow | undefined>
  /** False when the id already exists. `client` is the adder's hashed client key, kept for the per-client cap. */
  insert(row: StationRow, client?: string): Promise<boolean>
  /** Puts `row` over one removed at `removedAt`. False when the row has changed since. */
  readd(row: StationRow, removedAt: number, client?: string): Promise<boolean>
  remove(txId: string, by: string, at: number): Promise<void>
  restore(txId: string): Promise<void>
  countSince(since: number, uploader?: string): Promise<number>
  /** Rows added since `since` from this hashed client key. */
  countSinceFrom(since: number, client: string): Promise<number>
  /** Records signed words (hashed) as used; false when they were used already. */
  useSignature(hash: string, at: number): Promise<boolean>
}

/** A cache for the listing (the Worker's edge cache, market.ts); `at` is when it was saved. */
export type ListCache = {
  get: (key: string) => Promise<{ at: number; body: unknown } | undefined>
  put: (key: string, value: { at: number; body: unknown }, ttlSeconds?: number) => Promise<void>
}

export type StationDeps = {
  store?: StationStore
  admins: string[]
  verify: (wallet: string, message: string, signature: string) => Promise<boolean>
  /** The file's Content-Type at the gateway, undefined if it cannot be read. */
  contentType: (txId: string) => Promise<string | undefined>
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  /** For GETs; `limiter` when left out. */
  readLimiter?: (key: string) => boolean
  /** Caches GETs of the listing for LIST_CACHE_MS; none when left out. */
  listCache?: ListCache
  now?: () => number
}

/** The listing's cache key: only what changes the answer, so made-up query params cannot get around the cache. */
export const stationListKey = (url: URL) => `station-list:v1:${url.searchParams.get('before') ?? ''}`

/** Hex SHA-256, for the hashed client keys and signed words. */
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The client key as stored: hashed, so the table holds no IP addresses. Undefined when there is no real key. */
export const clientTag = async (key: string) =>
  key && key !== 'unknown' ? (await sha256Hex(`miya-client:${key}`)).slice(0, 32) : undefined

/** What makes a signature single-use: the wallet and the exact words it signed (the words hold the time). */
export const signedTag = (wallet: string, message: string) => sha256Hex(`${wallet.toLowerCase()}\n${message}`)

/**
 * Whether a daily cap is reached, per wallet, per client and in all: the refusal's words, or undefined. Pure apart from
 * the counts, so tests/station-caps.test.mts checks the rules.
 */
export function capReached(
  counts: { wallet: number; client: number; all: number },
  caps: { wallet: number; client: number; all: number }
): 'wallet' | 'client' | 'all' | undefined {
  if (counts.wallet >= caps.wallet) return 'wallet'
  if (counts.client >= caps.client) return 'client'
  if (counts.all >= caps.all) return 'all'
  return undefined
}

/** Reduces text to one bounded plain line: it is shown to everyone. */
export const cleanLine = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/**
 * The words an add signs. The cover and length lines are there only when given, so an add without them signs the same
 * words as before they were covered.
 */
export const addMessage = (f: {
  txId: string
  title: string
  artist: string
  artworkId?: string
  duration?: number
  wallet: string
  at: number
}) =>
  `Add this track to the miya radio community station.\n\nTitle: ${f.title}\nArtist: ${f.artist}\nTrack: ar://${f.txId}\n${
    f.artworkId ? `Cover: ar://${f.artworkId}\n` : ''
  }${
    typeof f.duration === 'number' && Number.isFinite(f.duration) ? `Length: ${f.duration} seconds\n` : ''
  }Wallet: ${f.wallet.toLowerCase()}\nTime: ${
    f.at
  }\n\nI made this or have the right to share it. This costs nothing and sends no transaction.`

export const removeMessage = (f: { txId: string; wallet: string; at: number }) =>
  `Remove this track from the miya radio community station.\n\nTrack: ar://${
    f.txId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${f.at}\n\nThis costs nothing and sends no transaction.`

export const restoreMessage = (f: { txId: string; wallet: string; at: number }) =>
  `Restore this track to the miya radio community station.\n\nTrack: ar://${
    f.txId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${f.at}\n\nThis costs nothing and sends no transaction.`

/** Removed by the station rather than taken off by the wallet that added it. An unknown remover counts as the station. */
const isBlocked = (r: StationRow, admins: string[]) => {
  if (!r.removedAt) return false
  const by = r.removedBy?.toLowerCase()
  return by !== r.uploader.toLowerCase() || admins.includes(by)
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const fail = (status: number, message: string) => reply(status, { error: message })
const USED = 'That signature was already used. Try again.'

export async function handleStationRequest(
  request: { method: string; url: string; headers: Headers; body?: string },
  deps: StationDeps
): Promise<Response> {
  const url = new URL(request.url)
  const now = deps.now?.() ?? Date.now()
  const admins = deps.admins.map((a) => a.toLowerCase())
  if (!deps.store) return fail(503, 'The community station opens soon.')
  const { store } = deps

  if (url.pathname === STATION_PATH && request.method === 'GET') {
    if (!(deps.readLimiter ?? deps.limiter)(deps.clientKey(request.headers)))
      return fail(429, 'Too many requests. Wait a minute.')
    const cursor = url.searchParams.get('before')
    const at = cursor === null ? undefined : CURSOR.exec(cursor)
    if (at === null) return fail(400, 'Bad request.')
    const key = stationListKey(url)
    const hit = await deps.listCache?.get(key).catch(() => undefined)
    if (hit && hit.body && now - hit.at >= 0 && now - hit.at < LIST_CACHE_MS) return reply(200, hit.body)
    const rows = await store.list(LIST_LIMIT + 1, at && { addedAt: Number(at[1]), txId: at[2]! })
    const tracks = rows.slice(0, LIST_LIMIT)
    const last = tracks[tracks.length - 1]
    const nextBefore = rows.length > LIST_LIMIT && last ? `${last.addedAt}_${last.txId}` : undefined
    const body = { tracks, admins, nextBefore }
    await deps.listCache?.put(key, { at: now, body }, LIST_CACHE_MS / 1000).catch(() => undefined)
    return reply(200, body)
  }

  if (request.method !== 'POST') return fail(405, 'Not allowed.')
  if (!deps.sameOrigin(request.headers, url)) return fail(403, 'Wrong origin.')
  const client = deps.clientKey(request.headers)
  if (!deps.limiter(client)) return fail(429, 'Too many requests. Wait a minute.')
  /** A change lands: the first page of the listing is read fresh next time, here at least (the cache is per data centre). */
  const changed = () =>
    deps.listCache?.put(stationListKey(new URL(STATION_PATH, url)), { at: 0, body: null }, 1).catch(() => undefined)
  /** Signed words count once. */
  const fresh = async (message: string) => store.useSignature(await signedTag(wallet, message), now)

  let body: Record<string, unknown>
  try {
    body = JSON.parse(request.body || '') as Record<string, unknown>
  } catch {
    return fail(400, 'Bad request.')
  }

  const txId = String(body.txId ?? '')
  const wallet = String(body.wallet ?? '')
  const at = Number(body.at)
  const signature = String(body.signature ?? '')
  if (!TX_ID.test(txId)) return fail(400, 'That is not an Arweave file id.')
  if (!WALLET.test(wallet)) return fail(400, 'That is not a wallet address.')
  if (!Number.isFinite(at) || Math.abs(now - at) > MAX_AGE_MS) return fail(400, 'That signature is too old. Try again.')
  const me = wallet.toLowerCase()

  if (url.pathname === `${STATION_PATH}/remove`) {
    const message = removeMessage({ txId, wallet, at })
    if (!(await deps.verify(wallet, message, signature))) return fail(401, 'The signature does not match the wallet.')
    if (!(await fresh(message))) return fail(409, USED)
    const row = await store.get(txId)
    if (!row || row.removedAt) return fail(404, 'That track is not on the station.')
    if (!admins.includes(me) && row.uploader.toLowerCase() !== me)
      return fail(403, 'Only the uploader or the station can remove this track.')
    await store.remove(txId, me, now)
    await changed()
    return reply(200, { ok: true })
  }

  if (url.pathname === `${STATION_PATH}/restore`) {
    const message = restoreMessage({ txId, wallet, at })
    if (!(await deps.verify(wallet, message, signature))) return fail(401, 'The signature does not match the wallet.')
    if (!(await fresh(message))) return fail(409, USED)
    if (!admins.includes(me)) return fail(403, 'Only the station can restore a track.')
    const row = await store.get(txId)
    if (!row || !isBlocked(row, admins)) return fail(404, 'That track has not been blocked.')
    await store.restore(txId)
    await changed()
    return reply(200, { ok: true })
  }

  if (url.pathname !== `${STATION_PATH}/add`) return fail(404, 'Not found.')

  const title = cleanLine(body.title, 120)
  const artist = cleanLine(body.artist, 80)
  if (!title) return fail(400, 'Give the track a title.')
  if (!artist) return fail(400, 'Say who the artist is.')
  const artworkId = body.artworkId === undefined || body.artworkId === null ? undefined : String(body.artworkId)
  if (artworkId !== undefined && !TX_ID.test(artworkId)) return fail(400, 'That cover is not an Arweave file id.')
  const signedDuration = typeof body.duration === 'number' && Number.isFinite(body.duration) ? body.duration : undefined
  // The signature covers the cleaned words, cover and length, so what is signed is exactly what gets listed.
  let message = addMessage({ txId, title, artist, artworkId, duration: signedDuration, wallet, at })
  let covered = true
  if (!(await deps.verify(wallet, message, signature))) {
    // A page loaded before the cover and length were signed signs only the words: still accepted for now, but nothing
    // it did not sign is listed. Drop this once those pages are gone.
    const words = addMessage({ txId, title, artist, wallet, at })
    if (words === message || !(await deps.verify(wallet, words, signature)))
      return fail(401, 'The signature does not match the wallet.')
    message = words
    covered = false
  }
  const cover = covered ? artworkId : undefined
  const duration = covered ? signedDuration : undefined
  if (!(await fresh(message))) return fail(409, USED)

  const existing = await store.get(txId)
  if (existing && isBlocked(existing, admins))
    return fail(409, 'This track was removed from the station and cannot be added again.')
  if (existing && !existing.removedAt) return fail(409, 'This track is already on the station.')
  const tag = await clientTag(client)
  const since = now - DAY_MS
  const [byWallet, byClient, all] = await Promise.all([
    store.countSince(since, me),
    tag ? store.countSinceFrom(since, tag) : 0,
    store.countSince(since),
  ])
  const cap = capReached(
    { wallet: byWallet, client: byClient, all },
    { wallet: MAX_PER_WALLET_PER_DAY, client: MAX_PER_CLIENT_PER_DAY, all: MAX_PER_DAY }
  )
  if (cap === 'wallet') return fail(429, `A wallet can add ${MAX_PER_WALLET_PER_DAY} tracks a day. Come back tomorrow.`)
  if (cap === 'client') return fail(429, `${MAX_PER_CLIENT_PER_DAY} tracks a day can be added from one place. Come back tomorrow.`)
  if (cap === 'all') return fail(429, 'The station has taken all it can today. Come back tomorrow.')

  const type = (await deps.contentType(txId))?.toLowerCase() ?? ''
  if (!type.startsWith('audio/'))
    return fail(400, 'That file is not audio, or it is not readable yet. Try again in a minute.')
  if (cover && !((await deps.contentType(cover))?.toLowerCase() ?? '').startsWith('image/'))
    return fail(400, 'That cover is not an image.')

  const row: StationRow = {
    txId,
    title,
    artist,
    artworkId: cover,
    duration: duration !== undefined && duration > 0 && duration < 86_400 ? duration : undefined,
    uploader: me,
    // Adding your own back keeps its place, so taking off and re-adding is no way to the top of the list.
    addedAt: existing?.uploader === me ? existing.addedAt : now,
  }
  const saved = existing?.removedAt ? await store.readd(row, existing.removedAt, tag) : await store.insert(row, tag)
  if (!saved) return fail(409, 'This track is already on the station.')
  await changed()
  return reply(200, { track: row })
}

/* ---------- storage ---------- */

type D1Stmt = {
  bind: (...values: unknown[]) => D1Stmt
  all: () => Promise<{ results: Record<string, unknown>[] }>
  first: () => Promise<Record<string, unknown> | null>
  run: () => Promise<{ meta: { changes: number } }>
}
export type D1Like = { prepare: (sql: string) => D1Stmt }

const fromDb = (r: Record<string, unknown>): StationRow => ({
  txId: String(r.tx_id),
  title: String(r.title),
  artist: String(r.artist),
  artworkId: r.artwork_id ? String(r.artwork_id) : undefined,
  duration: typeof r.duration === 'number' ? r.duration : undefined,
  uploader: String(r.uploader),
  addedAt: Number(r.added_at),
  removedAt: r.removed_at ? Number(r.removed_at) : undefined,
  removedBy: r.removed_by ? String(r.removed_by) : undefined,
})

/**
 * D1's words for a table or column that is not there yet: a deploy before migrations/0003_hardening.sql. The parts that
 * need it then fall back to what they did before (no per-client cap, no single-use check) rather than failing.
 */
export const missingSchema = (e: unknown) =>
  /no such (table|column)|has no column/i.test(String((e as Error)?.message ?? e))
let toldSchema = false
/** Runs `next`, or `before` when the migration has not run yet (said once in the logs). */
export async function orBeforeMigration<T>(next: () => Promise<T>, before: () => Promise<T> | T): Promise<T> {
  try {
    return await next()
  } catch (e) {
    if (!missingSchema(e)) throw e
    if (!toldSchema) {
      toldSchema = true
      console.warn('station: run the D1 migrations (0003_hardening): per-client caps and single-use signatures are off')
    }
    return before()
  }
}

/** Single-use signed words in D1 (used_signatures), shared by the station and public access. */
export const d1UseSignature = (db: D1Like) => (hash: string, at: number) =>
  orBeforeMigration(
    async () => {
      await db.prepare('DELETE FROM used_signatures WHERE at < ?').bind(at - USED_KEEP_MS).run()
      const r = await db.prepare('INSERT OR IGNORE INTO used_signatures (hash, at) VALUES (?, ?)').bind(hash, at).run()
      return r.meta.changes > 0
    },
    () => true
  )

/** The Worker's store: Cloudflare D1, the `DB` binding (migrations/). */
export const d1Store = (db: D1Like): StationStore => ({
  list: async (limit, before) =>
    (
      await (before
        ? db
            .prepare(
              'SELECT * FROM station_tracks WHERE removed_at IS NULL AND (added_at < ? OR (added_at = ? AND tx_id < ?)) ORDER BY added_at DESC, tx_id DESC LIMIT ?'
            )
            .bind(before.addedAt, before.addedAt, before.txId, limit)
        : db
            .prepare('SELECT * FROM station_tracks WHERE removed_at IS NULL ORDER BY added_at DESC, tx_id DESC LIMIT ?')
            .bind(limit)
      ).all()
    ).results.map(fromDb),
  get: async (txId) => {
    const r = await db.prepare('SELECT * FROM station_tracks WHERE tx_id = ?').bind(txId).first()
    return r ? fromDb(r) : undefined
  },
  insert: async (t, client) => {
    const run = (sql: string, ...extra: unknown[]) =>
      db
        .prepare(sql)
        .bind(t.txId, t.title, t.artist, t.artworkId ?? null, t.duration ?? null, t.uploader, t.addedAt, ...extra)
        .run()
    const r = await orBeforeMigration(
      () =>
        run(
          'INSERT OR IGNORE INTO station_tracks (tx_id, title, artist, artwork_id, duration, uploader, added_at, client_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          client ?? null
        ),
      () =>
        run(
          'INSERT OR IGNORE INTO station_tracks (tx_id, title, artist, artwork_id, duration, uploader, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
    )
    return r.meta.changes > 0
  },
  readd: async (t, removedAt, client) => {
    const set =
      'title = ?, artist = ?, artwork_id = ?, duration = ?, uploader = ?, added_at = ?, removed_at = NULL, removed_by = NULL'
    const values = [t.title, t.artist, t.artworkId ?? null, t.duration ?? null, t.uploader, t.addedAt]
    const r = await orBeforeMigration(
      () =>
        db
          .prepare(`UPDATE station_tracks SET ${set}, client_hash = ? WHERE tx_id = ? AND removed_at = ?`)
          .bind(...values, client ?? null, t.txId, removedAt)
          .run(),
      () =>
        db
          .prepare(`UPDATE station_tracks SET ${set} WHERE tx_id = ? AND removed_at = ?`)
          .bind(...values, t.txId, removedAt)
          .run()
    )
    return r.meta.changes > 0
  },
  remove: async (txId, by, at) => {
    await db
      .prepare('UPDATE station_tracks SET removed_at = ?, removed_by = ? WHERE tx_id = ?')
      .bind(at, by, txId)
      .run()
  },
  restore: async (txId) => {
    await db
      .prepare('UPDATE station_tracks SET removed_at = NULL, removed_by = NULL WHERE tx_id = ?')
      .bind(txId)
      .run()
  },
  countSince: async (since, uploader) => {
    const r = uploader
      ? await db
          .prepare('SELECT COUNT(*) AS n FROM station_tracks WHERE added_at >= ? AND uploader = ?')
          .bind(since, uploader)
          .first()
      : await db.prepare('SELECT COUNT(*) AS n FROM station_tracks WHERE added_at >= ?').bind(since).first()
    return Number(r?.n ?? 0)
  },
  countSinceFrom: (since, client) =>
    orBeforeMigration(
      async () =>
        Number(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM station_tracks WHERE added_at >= ? AND client_hash = ?')
              .bind(since, client)
              .first()
          )?.n ?? 0
        ),
      () => 0
    ),
  useSignature: d1UseSignature(db),
})

/** Tests and the dev server. */
export function memoryStore(): StationStore {
  const rows = new Map<string, StationRow>()
  const clients = new Map<string, string | undefined>()
  const used = new Map<string, number>()
  return {
    list: async (limit, before) =>
      [...rows.values()]
        .filter((r) => !r.removedAt)
        .sort((a, b) => b.addedAt - a.addedAt || (a.txId < b.txId ? 1 : -1))
        .filter(
          (r) => !before || r.addedAt < before.addedAt || (r.addedAt === before.addedAt && r.txId < before.txId)
        )
        .slice(0, limit),
    get: async (txId) => rows.get(txId),
    insert: async (row, client) => {
      if (rows.has(row.txId)) return false
      rows.set(row.txId, row)
      clients.set(row.txId, client)
      return true
    },
    readd: async (row, removedAt, client) => {
      if (rows.get(row.txId)?.removedAt !== removedAt) return false
      rows.set(row.txId, row)
      clients.set(row.txId, client)
      return true
    },
    remove: async (txId, by, at) => {
      const r = rows.get(txId)
      if (r) rows.set(txId, { ...r, removedAt: at, removedBy: by })
    },
    restore: async (txId) => {
      const r = rows.get(txId)
      if (r) rows.set(txId, { ...r, removedAt: undefined, removedBy: undefined })
    },
    countSince: async (since, uploader) =>
      [...rows.values()].filter((r) => r.addedAt >= since && (!uploader || r.uploader === uploader)).length,
    countSinceFrom: async (since, client) =>
      [...rows.values()].filter((r) => r.addedAt >= since && clients.get(r.txId) === client).length,
    useSignature: async (hash, at) => {
      for (const [h, t] of used) if (t < at - USED_KEEP_MS) used.delete(h)
      if (used.has(hash)) return false
      used.set(hash, at)
      return true
    },
  }
}

/** The file's Content-Type at the Irys gateway. Ids are validated before they get here. */
export async function gatewayContentType(txId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://gateway.irys.xyz/${txId}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok ? res.headers.get('content-type') ?? undefined : undefined
  } catch {
    return undefined
  }
}

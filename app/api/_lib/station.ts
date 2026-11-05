/**
 * The radio's community station: anyone adds a track they uploaded to Arweave and it plays for everyone at once. The
 * station's admins (STATION_ADMINS) or the uploader can take it off; a removed track stays refused.
 *
 *   GET  /api/station         { tracks, admins }
 *   POST /api/station/add     { txId, title, artist, artworkId?, duration?, wallet, at, signature }
 *   POST /api/station/remove  { txId, wallet, at, signature }
 *
 * A write is a wallet signature over the exact words in addMessage / removeMessage, fresh within 10 minutes. No sessions.
 * The Arweave file is checked to really be audio before it is listed. The file itself is permanent; only the listing
 * can go. Storage, the signature check and the gateway check are passed in, so `node --test` can run all of it
 * (tests/station.test.mts); the page imports the message builders so both sides sign the same words.
 */

export const STATION_PATH = '/api/station'
const MAX_AGE_MS = 10 * 60_000
const DAY_MS = 86_400_000
export const MAX_PER_WALLET_PER_DAY = 10
export const MAX_PER_DAY = 200
export const LIST_LIMIT = 200
const TX_ID = /^[A-Za-z0-9_-]{43,44}$/
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
}

export interface StationStore {
  list(limit: number): Promise<StationRow[]>
  /** Removed rows too. */
  get(txId: string): Promise<StationRow | undefined>
  /** False when the id already exists. */
  insert(row: StationRow): Promise<boolean>
  remove(txId: string, by: string, at: number): Promise<void>
  countSince(since: number, uploader?: string): Promise<number>
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
  now?: () => number
}

/** Reduces text to one bounded plain line: it is shown to everyone. */
export const cleanLine = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

export const addMessage = (f: { txId: string; title: string; artist: string; wallet: string; at: number }) =>
  `Add this track to the miya radio community station.\n\nTitle: ${f.title}\nArtist: ${f.artist}\nTrack: ar://${
    f.txId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${
    f.at
  }\n\nI made this or have the right to share it. This costs nothing and sends no transaction.`

export const removeMessage = (f: { txId: string; wallet: string; at: number }) =>
  `Remove this track from the miya radio community station.\n\nTrack: ar://${
    f.txId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${f.at}\n\nThis costs nothing and sends no transaction.`

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const fail = (status: number, message: string) => reply(status, { error: message })

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
    const rows = await store.list(LIST_LIMIT)
    return reply(200, { tracks: rows, admins })
  }

  if (request.method !== 'POST') return fail(405, 'Not allowed.')
  if (!deps.sameOrigin(request.headers, url)) return fail(403, 'Wrong origin.')
  if (!deps.limiter(deps.clientKey(request.headers))) return fail(429, 'Too many requests. Wait a minute.')

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
    if (!(await deps.verify(wallet, removeMessage({ txId, wallet, at }), signature)))
      return fail(401, 'The signature does not match the wallet.')
    const row = await store.get(txId)
    if (!row || row.removedAt) return fail(404, 'That track is not on the station.')
    if (!admins.includes(me) && row.uploader.toLowerCase() !== me)
      return fail(403, 'Only the uploader or the station can remove this track.')
    await store.remove(txId, me, now)
    return reply(200, { ok: true })
  }

  if (url.pathname !== `${STATION_PATH}/add`) return fail(404, 'Not found.')

  const title = cleanLine(body.title, 120)
  const artist = cleanLine(body.artist, 80)
  if (!title) return fail(400, 'Give the track a title.')
  if (!artist) return fail(400, 'Say who the artist is.')
  const artworkId = body.artworkId === undefined || body.artworkId === null ? undefined : String(body.artworkId)
  if (artworkId !== undefined && !TX_ID.test(artworkId)) return fail(400, 'That cover is not an Arweave file id.')
  const duration = Number(body.duration)
  // The signature covers the cleaned words, so what is signed is exactly what gets listed.
  if (!(await deps.verify(wallet, addMessage({ txId, title, artist, wallet, at }), signature)))
    return fail(401, 'The signature does not match the wallet.')

  const existing = await store.get(txId)
  if (existing?.removedAt) return fail(409, 'This track was removed from the station and cannot be added again.')
  if (existing) return fail(409, 'This track is already on the station.')
  if ((await store.countSince(now - DAY_MS, me)) >= MAX_PER_WALLET_PER_DAY)
    return fail(429, `A wallet can add ${MAX_PER_WALLET_PER_DAY} tracks a day. Come back tomorrow.`)
  if ((await store.countSince(now - DAY_MS)) >= MAX_PER_DAY)
    return fail(429, 'The station has taken all it can today. Come back tomorrow.')

  const type = (await deps.contentType(txId))?.toLowerCase() ?? ''
  if (!type.startsWith('audio/'))
    return fail(400, 'That file is not audio, or it is not readable yet. Try again in a minute.')
  if (artworkId && !((await deps.contentType(artworkId))?.toLowerCase() ?? '').startsWith('image/'))
    return fail(400, 'That cover is not an image.')

  const row: StationRow = {
    txId,
    title,
    artist,
    artworkId,
    duration: Number.isFinite(duration) && duration > 0 && duration < 86_400 ? duration : undefined,
    uploader: me,
    addedAt: now,
  }
  if (!(await store.insert(row))) return fail(409, 'This track is already on the station.')
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
})

/** The Worker's store: Cloudflare D1, the `DB` binding (migrations/). */
export const d1Store = (db: D1Like): StationStore => ({
  list: async (limit) =>
    (
      await db
        .prepare('SELECT * FROM station_tracks WHERE removed_at IS NULL ORDER BY added_at DESC LIMIT ?')
        .bind(limit)
        .all()
    ).results.map(fromDb),
  get: async (txId) => {
    const r = await db.prepare('SELECT * FROM station_tracks WHERE tx_id = ?').bind(txId).first()
    return r ? fromDb(r) : undefined
  },
  insert: async (t) =>
    (
      await db
        .prepare(
          'INSERT OR IGNORE INTO station_tracks (tx_id, title, artist, artwork_id, duration, uploader, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(t.txId, t.title, t.artist, t.artworkId ?? null, t.duration ?? null, t.uploader, t.addedAt)
        .run()
    ).meta.changes > 0,
  remove: async (txId, by, at) => {
    await db
      .prepare('UPDATE station_tracks SET removed_at = ?, removed_by = ? WHERE tx_id = ?')
      .bind(at, by, txId)
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
})

/** Tests and the dev server. */
export function memoryStore(): StationStore {
  const rows = new Map<string, StationRow>()
  return {
    list: async (limit) =>
      [...rows.values()]
        .filter((r) => !r.removedAt)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, limit),
    get: async (txId) => rows.get(txId),
    insert: async (row) => {
      if (rows.has(row.txId)) return false
      rows.set(row.txId, row)
      return true
    },
    remove: async (txId, _by, at) => {
      const r = rows.get(txId)
      if (r) rows.set(txId, { ...r, removedAt: at })
    },
    countSince: async (since, uploader) =>
      [...rows.values()].filter((r) => r.addedAt >= since && (!uploader || r.uploader === uploader)).length,
  }
}

/** The file's Content-Type at the Irys gateway. Ids are validated before they get here. */
export async function gatewayContentType(txId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://gateway.irys.xyz/${txId}`, { method: 'HEAD', redirect: 'follow' })
    return res.ok ? res.headers.get('content-type') ?? undefined : undefined
  } catch {
    return undefined
  }
}

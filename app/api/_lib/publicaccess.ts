/**
 * miyatv's public access channel: anyone with a wallet sends in a YouTube link, the station's admins (STATION_ADMINS) look
 * at it, and once approved it plays for everyone. Nothing airs unreviewed, because anyone could send anything.
 *
 *   GET  /api/public-access          { tapes, pending, admins }
 *   POST /api/public-access/submit   { videoId, wallet, at, signature }
 *   POST /api/public-access/review   { videoId, decision: 'approve' | 'remove' | 'restore', wallet, at, signature }
 *
 * Whoever sent a video can take it back and it may be sent in again by anyone: taking back your own video says nothing
 * about the video, and anyone could otherwise block any video for good. When the station removes it, it stays refused until
 * the station restores it ('restore': back where it was, on air or waiting).
 *
 * A write is a wallet signature over the exact words below, fresh within 10 minutes and used once (the signed words are
 * remembered, hashed, in the table the station uses too). Sends are capped per wallet, per client (IP, IPv6 by /64; kept
 * hashed on the row) and in all. The listing is cached for LIST_CACHE_MS and rate limited. YouTube's oEmbed check supplies the
 * title and refuses videos that are missing or cannot be embedded. Storage, signature check and lookup are passed in, so
 * `node --test` can run all of it (tests/public-access.test.mts); the page imports the message builders.
 */
import type { D1Like } from './station'

/** One bounded plain line: titles come from YouTube and are shown to everyone. Same rules as the station's. */
const cleanLine = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

export const PUBLIC_ACCESS_PATH = '/api/public-access'
const MAX_AGE_MS = 10 * 60_000
const DAY_MS = 86_400_000
export const MAX_PER_WALLET_PER_DAY = 5
export const MAX_PER_DAY = 50
/** Per client (IP): a couple of wallets' worth, well under the day's total. */
export const MAX_PER_CLIENT_PER_DAY = 10
export const LIST_CACHE_MS = 10_000
/** Signed words are remembered for this long: past the 10 minutes either side in which they are accepted. */
const USED_KEEP_MS = 3 * MAX_AGE_MS
/** Each list has its own limit, so a flood of new submissions cannot push anything off the air or out of the queue. */
const AIR_LIMIT = 200
const QUEUE_LIMIT = 100
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const WALLET = /^0x[0-9a-fA-F]{40}$/

export type Tape = {
  videoId: string
  title: string
  author: string
  submitter: string
  submittedAt: number
  approvedAt?: number
  removedAt?: number
  removedBy?: string
}

/** The station's own tapes, from youtube.com/@miyamaker. Always on air, first in the line-up, and not in the database. */
export const STATION_SUBMITTER = 'station'
const house = (videoId: string, title: string): Tape => ({
  videoId,
  title,
  author: 'miyamaker',
  submitter: STATION_SUBMITTER,
  submittedAt: 0,
  approvedAt: 0,
})
export const HOUSE_TAPES: Tape[] = [
  house('CpcTEPjrWpo', 'Miyamaker and Milady Bootcamp'),
  house('OmQRjRvrt4M', 'Bonkler Bot 1'),
  house('VNsdnq4h6DM', 'Bonkler Bot 2'),
  house('ZAeAfBs-Lco', 'Bonkler Bot 3'),
  house('LFnL-O5PYJU', 'NFT Arbitrage'),
]

/** What plays: the house tapes, then what the station has approved. */
export const airList = (approved: Tape[] = []): Tape[] => [
  ...HOUSE_TAPES,
  ...approved.filter((t) => !HOUSE_TAPES.some((h) => h.videoId === t.videoId)),
]

/** The tape after this one, round to the start again. */
export function nextTapeId(tapes: Tape[], videoId?: string): string | undefined {
  const at = tapes.findIndex((t) => t.videoId === videoId)
  return tapes[(Math.max(at, 0) + 1) % (tapes.length || 1)]?.videoId
}

export interface TapeStore {
  /** The most recently approved, newest submission first. */
  listApproved(limit: number): Promise<Tape[]>
  /** The longest waiting, so the queue drains in turn; newest submission first. */
  listPending(limit: number): Promise<Tape[]>
  /** Removed rows too. */
  get(videoId: string): Promise<Tape | undefined>
  /** False when the id already exists. `client` is the sender's hashed client key, kept for the per-client cap. */
  insert(tape: Tape, client?: string): Promise<boolean>
  /** Puts `tape`, awaiting review, over a row removed at `removedAt`. False when the row has changed since. */
  resubmit(tape: Tape, removedAt: number, client?: string): Promise<boolean>
  approve(videoId: string, at: number): Promise<void>
  remove(videoId: string, by: string, at: number): Promise<void>
  restore(videoId: string): Promise<void>
  countSince(since: number, submitter?: string): Promise<number>
  /** Rows sent since `since` from this hashed client key. */
  countSinceFrom(since: number, client: string): Promise<number>
  /** Records signed words (hashed) as used; false when they were used already. */
  useSignature(hash: string, at: number): Promise<boolean>
}

export type PublicAccessDeps = {
  store?: TapeStore
  admins: string[]
  verify: (wallet: string, message: string, signature: string) => Promise<boolean>
  /** Title and channel of a public video that may be embedded; undefined otherwise. */
  lookup: (videoId: string) => Promise<{ title: string; author: string } | undefined>
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  /** For GETs; `limiter` when left out. */
  readLimiter?: (key: string) => boolean
  /** Caches GETs for LIST_CACHE_MS (the Worker's edge cache, market.ts); none when left out. */
  listCache?: {
    get: (key: string) => Promise<{ at: number; body: unknown } | undefined>
    put: (key: string, value: { at: number; body: unknown }, ttlSeconds?: number) => Promise<void>
  }
  now?: () => number
}

/** The listing takes no query, so one key: made-up query params cannot get around the cache. */
export const PUBLIC_ACCESS_LIST_KEY = 'public-access-list:v1'

/** Hex SHA-256. The same as the station's (no imports here, so `node --test` loads this file on its own). */
async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Same hashing as station.ts clientTag, so one client counts the same in both. */
const clientTag = async (key: string) =>
  key && key !== 'unknown' ? (await sha256Hex(`miya-client:${key}`)).slice(0, 32) : undefined

/** Removed by the station rather than taken back by the wallet that sent it. An unknown remover counts as the station. */
const isBlocked = (t: Tape, admins: string[]) => {
  if (!t.removedAt) return false
  const by = t.removedBy?.toLowerCase()
  return by !== t.submitter.toLowerCase() || admins.includes(by)
}

/** The video id in any usual YouTube link, or undefined. */
export function parseYouTubeId(link: string): string | undefined {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return undefined
  }

  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null | undefined
  if (host === 'youtu.be') [, id] = url.pathname.split('/')
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/')
    id =
      first === 'watch'
        ? url.searchParams.get('v')
        : ['live', 'embed', 'shorts', 'v'].includes(first ?? '')
        ? second
        : undefined
  }

  return id && VIDEO_ID.test(id) ? id : undefined
}

export const submitMessage = (f: { videoId: string; wallet: string; at: number }) =>
  `Send this video to miyatv's public access channel.\n\nVideo: https://youtu.be/${
    f.videoId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${
    f.at
  }\n\nI have the right to share it. This costs nothing and sends no transaction.`

export const reviewMessage = (f: { videoId: string; decision: string; wallet: string; at: number }) =>
  `Public access: ${f.decision} this video.\n\nVideo: https://youtu.be/${
    f.videoId
  }\nWallet: ${f.wallet.toLowerCase()}\nTime: ${f.at}\n\nThis costs nothing and sends no transaction.`

/** Said on the page for anything that went wrong without a reason written for people. */
export const NOT_SENT = 'That didn’t go through. Nothing was sent. Try again in a minute.'

/** A refusal this API wrote for people to read, which the page shows as it is. */
export class TapeRefusal extends Error {}

/** The words for a failed send or review: a cancel, our own refusal, or the plain line. Library text never reaches the page. */
export function tapeProblem(e: unknown): string {
  if (e instanceof TapeRefusal) return e.message
  const m = (e as { shortMessage?: string })?.shortMessage || (e as Error)?.message || ''
  return /user rejected|user denied|rejected the request/i.test(m) ? 'You cancelled it in your wallet.' : NOT_SENT
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const fail = (status: number, message: string) => reply(status, { error: message })
const USED = 'That signature was already used. Try again.'

export async function handlePublicAccessRequest(
  request: { method: string; url: string; headers: Headers; body?: string },
  deps: PublicAccessDeps
): Promise<Response> {
  const url = new URL(request.url)
  const now = deps.now?.() ?? Date.now()
  const admins = deps.admins.map((a) => a.toLowerCase())
  if (!deps.store) return fail(503, 'Public access opens soon.')
  const { store } = deps

  if (url.pathname === PUBLIC_ACCESS_PATH && request.method === 'GET') {
    if (!(deps.readLimiter ?? deps.limiter)(deps.clientKey(request.headers)))
      return fail(429, 'Too many requests. Wait a minute.')
    const hit = await deps.listCache?.get(PUBLIC_ACCESS_LIST_KEY).catch(() => undefined)
    if (hit && hit.body && now - hit.at >= 0 && now - hit.at < LIST_CACHE_MS) return reply(200, hit.body)
    const [tapes, pending] = await Promise.all([store.listApproved(AIR_LIMIT), store.listPending(QUEUE_LIMIT)])
    const listing = { tapes, pending, admins }
    await deps.listCache?.put(PUBLIC_ACCESS_LIST_KEY, { at: now, body: listing }, LIST_CACHE_MS / 1000).catch(() => undefined)
    return reply(200, listing)
  }

  if (request.method !== 'POST') return fail(405, NOT_SENT)
  if (!deps.sameOrigin(request.headers, url)) return fail(403, 'Send tapes from miyamaker.com.')
  const client = deps.clientKey(request.headers)
  if (!deps.limiter(client)) return fail(429, 'Too many requests. Wait a minute.')
  /** A change lands: the listing is read fresh next time, here at least (the cache is per data centre). */
  const changed = () =>
    deps.listCache?.put(PUBLIC_ACCESS_LIST_KEY, { at: 0, body: null }, 1).catch(() => undefined)
  /** Signed words count once: the wallet and the exact words, which hold the time. */
  const fresh = async (message: string) => store.useSignature(await sha256Hex(`${wallet.toLowerCase()}\n${message}`), now)

  let body: Record<string, unknown>
  try {
    body = JSON.parse(request.body || '') as Record<string, unknown>
  } catch {
    return fail(400, NOT_SENT)
  }

  const videoId = String(body.videoId ?? '')
  const wallet = String(body.wallet ?? '')
  const at = Number(body.at)
  const signature = String(body.signature ?? '')
  if (!VIDEO_ID.test(videoId)) return fail(400, 'That is not a YouTube video.')
  if (!WALLET.test(wallet)) return fail(400, 'That is not a wallet address.')
  if (!Number.isFinite(at) || Math.abs(now - at) > MAX_AGE_MS) return fail(400, 'That signature is too old. Try again.')
  const me = wallet.toLowerCase()

  if (url.pathname === `${PUBLIC_ACCESS_PATH}/review`) {
    const decision = String(body.decision ?? '')
    if (decision !== 'approve' && decision !== 'remove' && decision !== 'restore') return fail(400, NOT_SENT)
    const message = reviewMessage({ videoId, decision, wallet, at })
    if (!(await deps.verify(wallet, message, signature))) return fail(401, 'The signature does not match the wallet.')
    if (!(await fresh(message))) return fail(409, USED)
    const tape = await store.get(videoId)
    const isAdmin = admins.includes(me)
    if (decision === 'restore') {
      if (!isAdmin) return fail(403, 'Only the station can restore a video.')
      if (!tape || !isBlocked(tape, admins)) return fail(404, 'That video has not been blocked.')
      await store.restore(videoId)
      await changed()
      return reply(200, { ok: true })
    }
    if (!tape || tape.removedAt) return fail(404, 'That video is not on public access.')
    if (decision === 'approve' && !isAdmin) return fail(403, 'Only the station can approve a video.')
    if (decision === 'remove' && !isAdmin && tape.submitter !== me)
      return fail(403, 'Only whoever sent it or the station can remove this video.')
    if (decision === 'approve') await store.approve(videoId, now)
    else await store.remove(videoId, me, now)
    await changed()
    return reply(200, { ok: true })
  }

  if (url.pathname !== `${PUBLIC_ACCESS_PATH}/submit`) return fail(404, NOT_SENT)
  const message = submitMessage({ videoId, wallet, at })
  if (!(await deps.verify(wallet, message, signature))) return fail(401, 'The signature does not match the wallet.')
  if (!(await fresh(message))) return fail(409, USED)

  if (HOUSE_TAPES.some((t) => t.videoId === videoId)) return fail(409, 'This video is already on the air.')
  const existing = await store.get(videoId)
  if (existing && isBlocked(existing, admins)) return fail(409, 'This video was removed and cannot be sent in again.')
  if (existing && !existing.removedAt) return fail(409, 'This video has already been sent in.')
  const tag = await clientTag(client)
  const since = now - DAY_MS
  if ((await store.countSince(since, me)) >= MAX_PER_WALLET_PER_DAY)
    return fail(429, `A wallet can send ${MAX_PER_WALLET_PER_DAY} videos a day. Come back tomorrow.`)
  if (tag && (await store.countSinceFrom(since, tag)) >= MAX_PER_CLIENT_PER_DAY)
    return fail(429, `${MAX_PER_CLIENT_PER_DAY} videos a day can be sent from one place. Come back tomorrow.`)
  if ((await store.countSince(since)) >= MAX_PER_DAY)
    return fail(429, 'Public access has taken all it can today. Come back tomorrow.')

  const found = await deps.lookup(videoId)
  if (!found) return fail(400, 'That video is private, missing, or does not allow embedding.')
  const tape: Tape = {
    videoId,
    title: cleanLine(found.title, 120) || 'Untitled',
    author: cleanLine(found.author, 80),
    submitter: me,
    // Sending your own back keeps its place, so taking back and resending is no way up the queue.
    submittedAt: existing?.submitter === me ? existing.submittedAt : now,
  }
  const saved = existing?.removedAt ? await store.resubmit(tape, existing.removedAt, tag) : await store.insert(tape, tag)
  if (!saved) return fail(409, 'This video has already been sent in.')
  await changed()
  return reply(200, { tape })
}

/** YouTube's public oEmbed: 200 for a public video that may be embedded, 401 or 404 otherwise. Needs no key. */
export async function youtubeLookup(videoId: string) {
  const res = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { signal: AbortSignal.timeout(8_000) }
  ).catch(() => undefined)
  if (!res?.ok) return undefined
  const json = (await res.json().catch(() => undefined)) as { title?: string; author_name?: string } | undefined
  return json?.title ? { title: json.title, author: json.author_name ?? '' } : undefined
}

/* ---------- storage ---------- */

const fromDb = (r: Record<string, unknown>): Tape => ({
  videoId: String(r.video_id),
  title: String(r.title),
  author: String(r.author),
  submitter: String(r.submitter),
  submittedAt: Number(r.submitted_at),
  approvedAt: r.approved_at ? Number(r.approved_at) : undefined,
  removedAt: r.removed_at ? Number(r.removed_at) : undefined,
  removedBy: r.removed_by ? String(r.removed_by) : undefined,
})

/** D1's words for a table or column that is not there yet: a deploy before migrations/0003_hardening.sql. */
const missingSchema = (e: unknown) => /no such (table|column)|has no column/i.test(String((e as Error)?.message ?? e))
let toldSchema = false
/** Runs `next`, or `before` when the migration has not run yet (said once in the logs). Same as the station's. */
async function orBeforeMigration<T>(next: () => Promise<T>, before: () => Promise<T> | T): Promise<T> {
  try {
    return await next()
  } catch (e) {
    if (!missingSchema(e)) throw e
    if (!toldSchema) {
      toldSchema = true
      console.warn('public access: run the D1 migrations (0003_hardening): per-client caps and single-use signatures are off')
    }
    return before()
  }
}

/** The Worker's store: Cloudflare D1, the `DB` binding (migrations/). */
export const d1TapeStore = (db: D1Like): TapeStore => ({
  listApproved: async (limit) =>
    (
      await db
        .prepare(
          'SELECT * FROM (SELECT * FROM public_access_tapes WHERE removed_at IS NULL AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT ?) ORDER BY submitted_at DESC'
        )
        .bind(limit)
        .all()
    ).results.map(fromDb),
  listPending: async (limit) =>
    (
      await db
        .prepare(
          'SELECT * FROM (SELECT * FROM public_access_tapes WHERE removed_at IS NULL AND approved_at IS NULL ORDER BY submitted_at ASC LIMIT ?) ORDER BY submitted_at DESC'
        )
        .bind(limit)
        .all()
    ).results.map(fromDb),
  get: async (videoId) => {
    const r = await db.prepare('SELECT * FROM public_access_tapes WHERE video_id = ?').bind(videoId).first()
    return r ? fromDb(r) : undefined
  },
  insert: async (t, client) => {
    const values = [t.videoId, t.title, t.author, t.submitter, t.submittedAt]
    const r = await orBeforeMigration(
      () =>
        db
          .prepare(
            'INSERT OR IGNORE INTO public_access_tapes (video_id, title, author, submitter, submitted_at, client_hash) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(...values, client ?? null)
          .run(),
      () =>
        db
          .prepare(
            'INSERT OR IGNORE INTO public_access_tapes (video_id, title, author, submitter, submitted_at) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(...values)
          .run()
    )
    return r.meta.changes > 0
  },
  resubmit: async (t, removedAt, client) => {
    const set =
      'title = ?, author = ?, submitter = ?, submitted_at = ?, approved_at = NULL, removed_at = NULL, removed_by = NULL'
    const values = [t.title, t.author, t.submitter, t.submittedAt]
    const r = await orBeforeMigration(
      () =>
        db
          .prepare(`UPDATE public_access_tapes SET ${set}, client_hash = ? WHERE video_id = ? AND removed_at = ?`)
          .bind(...values, client ?? null, t.videoId, removedAt)
          .run(),
      () =>
        db
          .prepare(`UPDATE public_access_tapes SET ${set} WHERE video_id = ? AND removed_at = ?`)
          .bind(...values, t.videoId, removedAt)
          .run()
    )
    return r.meta.changes > 0
  },
  approve: async (videoId, at) => {
    await db.prepare('UPDATE public_access_tapes SET approved_at = ? WHERE video_id = ?').bind(at, videoId).run()
  },
  remove: async (videoId, by, at) => {
    await db
      .prepare('UPDATE public_access_tapes SET removed_at = ?, removed_by = ? WHERE video_id = ?')
      .bind(at, by, videoId)
      .run()
  },
  restore: async (videoId) => {
    await db
      .prepare('UPDATE public_access_tapes SET removed_at = NULL, removed_by = NULL WHERE video_id = ?')
      .bind(videoId)
      .run()
  },
  countSince: async (since, submitter) => {
    const r = submitter
      ? await db
          .prepare('SELECT COUNT(*) AS n FROM public_access_tapes WHERE submitted_at >= ? AND submitter = ?')
          .bind(since, submitter)
          .first()
      : await db.prepare('SELECT COUNT(*) AS n FROM public_access_tapes WHERE submitted_at >= ?').bind(since).first()
    return Number(r?.n ?? 0)
  },
  countSinceFrom: (since, client) =>
    orBeforeMigration(
      async () =>
        Number(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM public_access_tapes WHERE submitted_at >= ? AND client_hash = ?')
              .bind(since, client)
              .first()
          )?.n ?? 0
        ),
      () => 0
    ),
  // The station's table (station.ts d1UseSignature): one list of used words for both.
  useSignature: (hash, at) =>
    orBeforeMigration(
      async () => {
        await db.prepare('DELETE FROM used_signatures WHERE at < ?').bind(at - USED_KEEP_MS).run()
        const r = await db.prepare('INSERT OR IGNORE INTO used_signatures (hash, at) VALUES (?, ?)').bind(hash, at).run()
        return r.meta.changes > 0
      },
      () => true
    ),
})

/** Tests and the dev server. */
export function memoryTapeStore(): TapeStore {
  const rows = new Map<string, Tape>()
  const clients = new Map<string, string | undefined>()
  const used = new Map<string, number>()
  const newestSent = (a: Tape, b: Tape) => b.submittedAt - a.submittedAt
  return {
    listApproved: async (limit) =>
      [...rows.values()]
        .filter((t) => !t.removedAt && t.approvedAt)
        .sort((a, b) => (b.approvedAt ?? 0) - (a.approvedAt ?? 0))
        .slice(0, limit)
        .sort(newestSent),
    listPending: async (limit) =>
      [...rows.values()]
        .filter((t) => !t.removedAt && !t.approvedAt)
        .sort((a, b) => a.submittedAt - b.submittedAt)
        .slice(0, limit)
        .sort(newestSent),
    get: async (id) => rows.get(id),
    insert: async (t, client) => {
      if (rows.has(t.videoId)) return false
      rows.set(t.videoId, t)
      clients.set(t.videoId, client)
      return true
    },
    resubmit: async (t, removedAt, client) => {
      if (rows.get(t.videoId)?.removedAt !== removedAt) return false
      rows.set(t.videoId, t)
      clients.set(t.videoId, client)
      return true
    },
    approve: async (id, at) => {
      const t = rows.get(id)
      if (t) t.approvedAt = at
    },
    remove: async (id, by, at) => {
      const t = rows.get(id)
      if (t) rows.set(id, { ...t, removedAt: at, removedBy: by })
    },
    restore: async (id) => {
      const t = rows.get(id)
      if (t) rows.set(id, { ...t, removedAt: undefined, removedBy: undefined })
    },
    countSince: async (since, submitter) =>
      [...rows.values()].filter((t) => t.submittedAt >= since && (!submitter || t.submitter === submitter)).length,
    countSinceFrom: async (since, client) =>
      [...rows.values()].filter((t) => t.submittedAt >= since && clients.get(t.videoId) === client).length,
    useSignature: async (hash, at) => {
      for (const [h, t] of used) if (t < at - USED_KEEP_MS) used.delete(h)
      if (used.has(hash)) return false
      used.set(hash, at)
      return true
    },
  }
}

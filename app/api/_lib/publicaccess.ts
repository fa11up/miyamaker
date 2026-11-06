/**
 * miyatv's public access channel: anyone with a wallet sends in a YouTube link, the station's admins (STATION_ADMINS) look
 * at it, and once approved it plays for everyone. Nothing airs unreviewed, because anyone could send anything.
 *
 *   GET  /api/public-access          { tapes, pending, admins }
 *   POST /api/public-access/submit   { videoId, wallet, at, signature }
 *   POST /api/public-access/review   { videoId, decision: 'approve' | 'remove', wallet, at, signature }
 *
 * A write is a wallet signature over the exact words below, fresh within 10 minutes. YouTube's oEmbed check supplies the
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
const LIST_LIMIT = 100
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

export interface TapeStore {
  list(limit: number): Promise<Tape[]>
  /** Removed rows too. */
  get(videoId: string): Promise<Tape | undefined>
  /** False when the id already exists. */
  insert(tape: Tape): Promise<boolean>
  approve(videoId: string, at: number): Promise<void>
  remove(videoId: string, by: string, at: number): Promise<void>
  countSince(since: number, submitter?: string): Promise<number>
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
  now?: () => number
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

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const fail = (status: number, message: string) => reply(status, { error: message })

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
    const rows = await store.list(LIST_LIMIT)
    return reply(200, { tapes: rows.filter((t) => t.approvedAt), pending: rows.filter((t) => !t.approvedAt), admins })
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
    if (decision !== 'approve' && decision !== 'remove') return fail(400, 'Approve or remove.')
    if (!(await deps.verify(wallet, reviewMessage({ videoId, decision, wallet, at }), signature)))
      return fail(401, 'The signature does not match the wallet.')
    const tape = await store.get(videoId)
    if (!tape || tape.removedAt) return fail(404, 'That video is not on public access.')
    const isAdmin = admins.includes(me)
    if (decision === 'approve' && !isAdmin) return fail(403, 'Only the station can approve a video.')
    if (decision === 'remove' && !isAdmin && tape.submitter !== me)
      return fail(403, 'Only whoever sent it or the station can remove this video.')
    if (decision === 'approve') await store.approve(videoId, now)
    else await store.remove(videoId, me, now)
    return reply(200, { ok: true })
  }

  if (url.pathname !== `${PUBLIC_ACCESS_PATH}/submit`) return fail(404, 'Not found.')
  if (!(await deps.verify(wallet, submitMessage({ videoId, wallet, at }), signature)))
    return fail(401, 'The signature does not match the wallet.')

  if (HOUSE_TAPES.some((t) => t.videoId === videoId)) return fail(409, 'This video is already on the air.')
  const existing = await store.get(videoId)
  if (existing?.removedAt) return fail(409, 'This video was removed and cannot be sent in again.')
  if (existing) return fail(409, 'This video has already been sent in.')
  if ((await store.countSince(now - DAY_MS, me)) >= MAX_PER_WALLET_PER_DAY)
    return fail(429, `A wallet can send ${MAX_PER_WALLET_PER_DAY} videos a day. Come back tomorrow.`)
  if ((await store.countSince(now - DAY_MS)) >= MAX_PER_DAY)
    return fail(429, 'Public access has taken all it can today. Come back tomorrow.')

  const found = await deps.lookup(videoId)
  if (!found) return fail(400, 'That video is private, missing, or does not allow embedding.')
  const tape: Tape = {
    videoId,
    title: cleanLine(found.title, 120) || 'Untitled',
    author: cleanLine(found.author, 80),
    submitter: me,
    submittedAt: now,
  }
  if (!(await store.insert(tape))) return fail(409, 'This video has already been sent in.')
  return reply(200, { tape })
}

/** YouTube's public oEmbed: 200 for a public video that may be embedded, 401 or 404 otherwise. Needs no key. */
export async function youtubeLookup(videoId: string) {
  const res = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
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
})

/** The Worker's store: Cloudflare D1, the `DB` binding (migrations/). */
export const d1TapeStore = (db: D1Like): TapeStore => ({
  list: async (limit) =>
    (
      await db
        .prepare('SELECT * FROM public_access_tapes WHERE removed_at IS NULL ORDER BY submitted_at DESC LIMIT ?')
        .bind(limit)
        .all()
    ).results.map(fromDb),
  get: async (videoId) => {
    const r = await db.prepare('SELECT * FROM public_access_tapes WHERE video_id = ?').bind(videoId).first()
    return r ? fromDb(r) : undefined
  },
  insert: async (t) =>
    (
      await db
        .prepare(
          'INSERT OR IGNORE INTO public_access_tapes (video_id, title, author, submitter, submitted_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(t.videoId, t.title, t.author, t.submitter, t.submittedAt)
        .run()
    ).meta.changes > 0,
  approve: async (videoId, at) => {
    await db.prepare('UPDATE public_access_tapes SET approved_at = ? WHERE video_id = ?').bind(at, videoId).run()
  },
  remove: async (videoId, by, at) => {
    await db
      .prepare('UPDATE public_access_tapes SET removed_at = ?, removed_by = ? WHERE video_id = ?')
      .bind(at, by, videoId)
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
})

/** Tests and the dev server. */
export function memoryTapeStore(): TapeStore {
  const rows = new Map<string, Tape>()
  return {
    list: async (limit) =>
      [...rows.values()]
        .filter((t) => !t.removedAt)
        .sort((a, b) => b.submittedAt - a.submittedAt)
        .slice(0, limit),
    get: async (id) => rows.get(id),
    insert: async (t) => {
      if (rows.has(t.videoId)) return false
      rows.set(t.videoId, t)
      return true
    },
    approve: async (id, at) => {
      const t = rows.get(id)
      if (t) t.approvedAt = at
    },
    remove: async (id, _by, at) => {
      const t = rows.get(id)
      if (t) t.removedAt = at
    },
    countSince: async (since, submitter) =>
      [...rows.values()].filter((t) => t.submittedAt >= since && (!submitter || t.submitter === submitter)).length,
  }
}

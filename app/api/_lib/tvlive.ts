/**
 * Which YouTube stream each miyatv channel should play right now. A live stream's id changes whenever it restarts, so the
 * channels ask here instead of trusting a fixed id.
 *
 *   GET /api/tv/live   { ids: { lofi: '<videoId>', ... }, kick: [{ slug, label, viewers }], kickChecked: boolean }
 *
 * `kickChecked` false means Kick gave no full answer: `kick` is then the last good list or empty, and empty does not mean
 * nobody is on (./tvkick.ts).
 *
 * YouTube's daily quota is 10,000 units: checking the known ids costs 1, a channel search costs 100. So everyone reads one
 * cached answer, the ids are re-checked at most every 10 minutes, and a search only runs for a stream that has really
 * stopped, waiting longer each time it finds nothing. When YouTube refuses us outright nothing is asked for a while.
 * Without a key, or if YouTube is down, the last known ids stand. The key stays on the server.
 *
 * "Everyone" means every data centre when the Worker passes the D1-backed cache (./sharedstate.ts): one copy, and a lock
 * so one request anywhere refreshes while the rest read the known ids. Until the shared_state table exists
 * (migrations/0003_hardening.sql), or if D1 fails, that cache falls back to the per-data-centre one. Either way only one
 * refresh runs at a time in an isolate.
 */
import type { SharedCache } from './sharedstate'
import type { KickAnswer } from './tvkick'

export const TV_LIVE_PATH = '/api/tv/live'
const CACHE_KEY = 'tv-live:v2'
export const RECHECK_MS = 10 * 60_000
/** A search that found nothing waits 20 minutes, then twice as long each time, up to this: 4 searches a day per stream. */
export const SEARCH_BACKOFF_MAX_MS = 6 * 3_600_000
/** After a 403 or 429: the quota is spent or the key refused, and asking again would not help. */
export const REFUSED_PAUSE_MS = 3_600_000
/** Last known ids must outlive a quiet spell, or the next visitor starts again from the fallbacks and pays for searches. */
const KEEP_S = 30 * 86_400
/** How long one refresh holds the lock: well past a check and three searches, each with a 10 second timeout. */
const LOCK_MS = 60_000
const API = 'https://www.googleapis.com/youtube/v3'

export const LIVE_TARGETS: { id: string; channelId: string; query: string; fallback: string }[] = [
  { id: 'lofi', channelId: 'UCSJ4gkVC6NrvII8umztf0Ow', query: 'lofi hip hop radio', fallback: 'rFZHOHl-L8A' },
  { id: 'monterey', channelId: 'UCnM5iMGiKsZg-iOlIO2ZkdQ', query: 'Aviary', fallback: 'AWJi0LgyA28' },
  { id: 'iss', channelId: 'UCLA_DiR1FfKNvjuUpBHmylQ', query: 'International Space Station', fallback: 'ROboUHfPUrU' },
]

export type TvLiveDeps = {
  key?: string
  /** The D1-backed cache shared by every data centre (./sharedstate.ts), or a plain per-data-centre one. */
  cache: SharedCache
  /** A YouTube Data API GET returning parsed JSON; throws when it fails, with `refused` set for a 403 or 429. */
  youtube?: (path: string, query: Record<string, string>) => Promise<unknown>
  now?: () => number
  /** The Kick streams on air (./tvkick.ts). */
  kick?: () => Promise<KickAnswer>
}

export const youtubeReader = (key: string) => async (path: string, query: Record<string, string>) => {
  const res = await fetch(`${API}${path}?${new URLSearchParams({ ...query, key })}`, {
    signal: AbortSignal.timeout(10_000),
  })
  // Only the status: the URL holds the key.
  if (!res.ok) throw Object.assign(new Error(`YouTube ${res.status}`), { refused: res.status === 403 || res.status === 429 })
  return res.json()
}

const reply = (status: number, body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` },
  })

const fallbacks = () => Object.fromEntries(LIVE_TARGETS.map((t) => [t.id, t.fallback]))

const isRefused = (e: unknown) => (e as { refused?: boolean })?.refused === true

/** What is kept between checks. `misses` holds the backoff of each stream whose search keeps finding nothing. */
type LiveState = {
  ids: Record<string, string>
  misses: Record<string, { count: number; until: number }>
  pausedUntil?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function refresh(known: LiveState, deps: TvLiveDeps, now: number): Promise<LiveState> {
  const read = deps.youtube ?? (deps.key ? youtubeReader(deps.key) : undefined)
  if (!read) return known
  const ids = { ...known.ids }
  const misses = { ...known.misses }
  let refused = false
  const list = LIVE_TARGETS.map((t) => ids[t.id] ?? t.fallback)
  const found: any = await read('/videos', { part: 'snippet,status', id: list.join(','), maxResults: '50' })
  const onAir = new Set(
    (found?.items ?? [])
      .filter((v: any) => v?.snippet?.liveBroadcastContent === 'live' && v?.status?.embeddable !== false)
      .map((v: any) => v.id)
  )
  await Promise.all(
    LIVE_TARGETS.map(async (t) => {
      if (onAir.has(ids[t.id] ?? t.fallback)) {
        delete misses[t.id]
        return
      }
      const miss = misses[t.id]
      if (miss && now < miss.until) return
      // A failed search keeps what we had: the channel shows its "has moved" card rather than a wrong stream.
      const hit: any = await read('/search', {
        part: 'id',
        channelId: t.channelId,
        eventType: 'live',
        type: 'video',
        videoEmbeddable: 'true',
        q: t.query,
        maxResults: '1',
      }).catch((e: unknown) => {
        refused ||= isRefused(e)
        return undefined
      })
      const next = hit?.items?.[0]?.id?.videoId
      if (typeof next === 'string' && /^[A-Za-z0-9_-]{11}$/.test(next)) {
        ids[t.id] = next
        delete misses[t.id]
      } else if (!refused) {
        // A refusal says nothing about the stream, so it pauses everything below rather than counting against this one.
        const count = (miss?.count ?? 0) + 1
        misses[t.id] = { count, until: now + Math.min(RECHECK_MS * 2 ** count, SEARCH_BACKOFF_MAX_MS) }
      }
    })
  )
  return { ids, misses, ...(refused ? { pausedUntil: now + REFUSED_PAUSE_MS } : {}) }
}

export async function handleTvLiveRequest(request: { method: string }, deps: TvLiveDeps): Promise<Response> {
  if (request.method !== 'GET') return reply(405, { error: 'Not allowed.' })
  const now = deps.now?.() ?? Date.now()
  const cached = await deps.cache.get(CACHE_KEY).catch(() => null)
  const saved = cached?.body as Partial<LiveState> | undefined
  const known: LiveState = {
    ids: { ...fallbacks(), ...saved?.ids },
    misses: saved?.misses ?? {},
    pausedUntil: saved?.pausedUntil,
  }
  // A Kick failure must not take the YouTube ids down with it.
  const kick = await (deps.kick?.() ?? Promise.resolve(undefined)).catch((e: Error) => {
    console.warn(`tv kick: ${e.message}`)
    return undefined
  })
  const answer = (ids: Record<string, string>) =>
    reply(200, { ids, kick: kick?.streams ?? [], kickChecked: kick?.checked ?? false }, 120)

  // With no cache to read, every viewer's request would pay for its own searches, so the known ids stand until it is back.
  if (cached === null) return answer(known.ids)
  if (cached && now - cached.at < RECHECK_MS) return answer(known.ids)
  if (known.pausedUntil && now < known.pausedUntil) return answer(known.ids)

  // One refresh at a time: requests in this isolate share the one running, and other data centres see the lock and
  // answer the known ids, at most one check old.
  let running = refreshing.get(deps.cache)
  if (!running) {
    running = refreshOnce(known, deps, now).finally(() => refreshing.delete(deps.cache))
    refreshing.set(deps.cache, running)
  }
  return answer(((await running) ?? known).ids)
}

const refreshing = new WeakMap<object, Promise<LiveState | undefined>>()

/** The refreshed state, saved; undefined when another request holds the lock. */
async function refreshOnce(known: LiveState, deps: TvLiveDeps, now: number): Promise<LiveState | undefined> {
  const mine = deps.cache.claim
    ? await deps.cache.claim(CACHE_KEY, now, LOCK_MS, now - RECHECK_MS + 1).catch(() => true)
    : true
  if (!mine) return undefined
  let next: LiveState = { ...known, pausedUntil: undefined }
  try {
    next = await refresh(next, deps, now)
  } catch (e) {
    // Keep the last known ids and try again at the next check. Says so in the logs, or a bad key would look like success.
    console.warn(`tv live: ${(e as Error).message}`)
    if (isRefused(e)) next = { ...next, pausedUntil: now + REFUSED_PAUSE_MS }
  }

  await deps.cache.put(CACHE_KEY, { at: now, body: next }, KEEP_S).catch((e: Error) => {
    console.warn(`tv live: could not save: ${e.message}`)
  })
  return next
}

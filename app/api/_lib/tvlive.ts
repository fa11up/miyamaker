/**
 * Which YouTube stream each miyatv channel should play right now. A live stream's id changes whenever it restarts, so the
 * channels ask here instead of trusting a fixed id.
 *
 *   GET /api/tv/live   { ids: { lofi: '<videoId>', ... } }
 *
 * YouTube's daily quota is 10,000 units: checking the known ids costs 1, a channel search costs 100. So everyone reads one
 * cached answer, the ids are re-checked at most every 10 minutes, and a search only runs for a stream that has really
 * stopped. Without a key, or if YouTube is down, the last known ids stand. The key stays on the server.
 */
import type { MarketCache } from './market'

export const TV_LIVE_PATH = '/api/tv/live'
const CACHE_KEY = 'tv-live:v1'
export const RECHECK_MS = 10 * 60_000
const API = 'https://www.googleapis.com/youtube/v3'

export const LIVE_TARGETS: { id: string; channelId: string; query: string; fallback: string }[] = [
  { id: 'lofi', channelId: 'UCSJ4gkVC6NrvII8umztf0Ow', query: 'lofi hip hop radio', fallback: 'rFZHOHl-L8A' },
  { id: 'monterey', channelId: 'UCnM5iMGiKsZg-iOlIO2ZkdQ', query: 'Aviary', fallback: 'AWJi0LgyA28' },
  { id: 'iss', channelId: 'UCLA_DiR1FfKNvjuUpBHmylQ', query: 'International Space Station', fallback: 'ROboUHfPUrU' },
]

export type TvLiveDeps = {
  key?: string
  cache: MarketCache
  /** A YouTube Data API GET returning parsed JSON; throws when it fails. */
  youtube?: (path: string, query: Record<string, string>) => Promise<unknown>
  now?: () => number
}

export const youtubeReader = (key: string) => async (path: string, query: Record<string, string>) => {
  const res = await fetch(`${API}${path}?${new URLSearchParams({ ...query, key })}`, {
    signal: AbortSignal.timeout(10_000),
  })
  // Only the status: the URL holds the key.
  if (!res.ok) throw new Error(`YouTube ${res.status}`)
  return res.json()
}

const reply = (status: number, body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` },
  })

const fallbacks = () => Object.fromEntries(LIVE_TARGETS.map((t) => [t.id, t.fallback]))

/* eslint-disable @typescript-eslint/no-explicit-any */
async function refresh(known: Record<string, string>, deps: TvLiveDeps) {
  const read = deps.youtube ?? (deps.key ? youtubeReader(deps.key) : undefined)
  if (!read) return known
  const ids = { ...known }
  const list = LIVE_TARGETS.map((t) => ids[t.id] ?? t.fallback)
  const found: any = await read('/videos', { part: 'snippet,status', id: list.join(','), maxResults: '50' })
  const onAir = new Set(
    (found?.items ?? [])
      .filter((v: any) => v?.snippet?.liveBroadcastContent === 'live' && v?.status?.embeddable !== false)
      .map((v: any) => v.id)
  )
  await Promise.all(
    LIVE_TARGETS.map(async (t) => {
      if (onAir.has(ids[t.id] ?? t.fallback)) return
      // A failed search keeps what we had: the channel shows its "has moved" card rather than a wrong stream.
      const hit: any = await read('/search', {
        part: 'id',
        channelId: t.channelId,
        eventType: 'live',
        type: 'video',
        videoEmbeddable: 'true',
        q: t.query,
        maxResults: '1',
      }).catch(() => undefined)
      const next = hit?.items?.[0]?.id?.videoId
      if (typeof next === 'string' && /^[A-Za-z0-9_-]{11}$/.test(next)) ids[t.id] = next
    })
  )
  return ids
}

export async function handleTvLiveRequest(request: { method: string }, deps: TvLiveDeps): Promise<Response> {
  if (request.method !== 'GET') return reply(405, { error: 'Not allowed.' })
  const now = deps.now?.() ?? Date.now()
  const cached = (await deps.cache.get(CACHE_KEY)) as { at: number; body: Record<string, string> } | undefined
  const known = { ...fallbacks(), ...cached?.body }
  if (cached && now - cached.at < RECHECK_MS) return reply(200, { ids: known }, 300)
  let ids = known
  try {
    ids = await refresh(known, deps)
  } catch (e) {
    // Keep the last known ids and try again at the next check. Says so in the logs, or a bad key would look like success.
    console.warn(`tv live: ${(e as Error).message}`)
  }

  await deps.cache.put(CACHE_KEY, { at: now, body: ids })
  return reply(200, { ids }, 300)
}

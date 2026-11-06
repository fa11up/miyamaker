/**
 * Who miyatv's Kick channel shows: only streams that are on right now. The creators we list come first when they're live,
 * then the most-watched suitable English streams, up to three, biggest first. Answered through GET /api/tv/live.
 *
 * Kick's official API needs app credentials, so these are the public endpoints its own site uses. They can change or
 * refuse without notice: a failed check keeps the last answer, and with no answer at all the page falls back to the list
 * in channels.ts.
 */
import type { MarketCache } from './market'

const CACHE_KEY = 'tv-kick:v1'
export const KICK_RECHECK_MS = 3 * 60_000
export const KICK_STREAMS = 3
const TOP_URL = 'https://kick.com/stream/livestreams/en?page=1&limit=48&subcategory=&sort=desc'
const SLUG = /^[A-Za-z0-9_-]{1,64}$/
/** Not what a TV in a desktop should tune to by itself. */
const UNSUITABLE = /slots|casino|gambl|betting|crypto|trading/i

export type KickStream = { slug: string; label: string; viewers: number }
export type KickReader = (url: string) => Promise<unknown>

export const kickReader: KickReader = async (url) => {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; miyatv)' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`Kick ${res.status}`)
  return res.json()
}

/** The Kick channel's sources in channels.ts (tests/tv-kick.test.mts keeps them the same). */
export const LISTED_KICK = ['xqc', 'gmhikaru', 'chessbrah']

/* eslint-disable @typescript-eslint/no-explicit-any */
const asStream = (slug: unknown, label: unknown, viewers: unknown): KickStream | undefined =>
  typeof slug === 'string' && SLUG.test(slug)
    ? {
        slug,
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : slug,
        viewers: Number(viewers) || 0,
      }
    : undefined

/** The suitable English streams out of Kick's most-watched list. */
export function suitableStreams(top: any): KickStream[] {
  const rows: any[] = Array.isArray(top?.data) ? top.data : []
  return rows.flatMap((r) => {
    const categories: any[] = Array.isArray(r?.categories) ? r.categories : []
    if (!r?.is_live || r?.is_mature || r?.language !== 'English') return []
    if (categories.some((c) => UNSUITABLE.test(String(c?.name)))) return []
    const stream = asStream(r?.channel?.slug, r?.channel?.user?.username, r?.viewer_count)
    return stream ? [stream] : []
  })
}

/** Listed creators who are on, then the top of the rest, up to three, biggest first. */
export function chooseStreams(listedLive: KickStream[], top: KickStream[]): KickStream[] {
  const taken = new Set(listedLive.map((s) => s.slug.toLowerCase()))
  const rest = [...top].sort((a, b) => b.viewers - a.viewers).filter((s) => !taken.has(s.slug.toLowerCase()))
  return [...listedLive.slice(0, KICK_STREAMS), ...rest].slice(0, KICK_STREAMS).sort((a, b) => b.viewers - a.viewers)
}

async function lookUp(read: KickReader): Promise<KickStream[]> {
  const [top, ...listed] = await Promise.allSettled([
    read(TOP_URL),
    ...LISTED_KICK.map((slug) => read(`https://kick.com/api/v2/channels/${slug}`)),
  ])
  const listedLive = listed.flatMap((r, i) => {
    const c: any = r.status === 'fulfilled' ? r.value : undefined
    if (!c?.livestream?.is_live) return []
    const stream = asStream(LISTED_KICK[i], c?.user?.username, c.livestream.viewer_count)
    return stream ? [stream] : []
  })
  return chooseStreams(listedLive, top!.status === 'fulfilled' ? suitableStreams(top!.value) : [])
}

/** The streams to offer: cached for everyone, and the last good answer stands when Kick has nothing to say. */
export async function kickOnAir(deps: { read?: KickReader; cache: MarketCache; now: number }): Promise<KickStream[]> {
  if (!deps.read) return []
  const cached = (await deps.cache.get(CACHE_KEY)) as { at: number; body: KickStream[] } | undefined
  if (cached && deps.now - cached.at < KICK_RECHECK_MS) return cached.body
  const known = cached?.body ?? []
  let streams = known
  try {
    const found = await lookUp(deps.read)
    if (found.length) streams = found
    else console.warn('tv kick: no streams found')
  } catch (e) {
    console.warn(`tv kick: ${(e as Error).message}`)
  }
  await deps.cache.put(CACHE_KEY, { at: deps.now, body: streams })
  return streams
}

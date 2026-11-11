/**
 * Who miyatv's Kick channel shows: only streams that are on right now. The creators we list come first when they're live,
 * then the most-watched suitable English streams, up to three, biggest first. Answered through GET /api/tv/live.
 *
 * Kick's official API needs app credentials, so these are the public endpoints its own site uses. They can change or
 * refuse without notice: a check that gets no real answer keeps the last good list for a while (KICK_STALE_LIMIT_MS, from
 * when that list was really checked) and says it could not check, so the page never mistakes that for nobody being on.
 *
 * Like the YouTube ids (./tvlive.ts), the list is kept for every data centre when the cache given is the D1-backed one
 * (./sharedstate.ts), with one check at a time anywhere; otherwise per data centre, one check at a time per isolate.
 */
import type { SharedCache } from './sharedstate'

const CACHE_KEY = 'tv-kick:v2'
export const KICK_RECHECK_MS = 3 * 60_000
/** How long a list may stand without Kick confirming it. Dead streams must not be offered for longer. */
export const KICK_STALE_LIMIT_MS = 15 * 60_000
export const KICK_STREAMS = 3
const LOCK_MS = 30_000
const TOP_URL = 'https://kick.com/stream/livestreams/en?page=1&limit=48&subcategory=&sort=desc'
const SLUG = /^[A-Za-z0-9_-]{1,64}$/
/** Not what a TV in a desktop should tune to by itself. */
const UNSUITABLE = /slots|casino|gambl|betting|crypto|trading/i

export type KickStream = { slug: string; label: string; viewers: number }
export type KickReader = (url: string) => Promise<unknown>
/** `checked` false: Kick gave no full answer, so `streams` is a best guess and an empty list does not mean nobody is on. */
export type KickAnswer = { streams: KickStream[]; checked: boolean }
type Saved = KickAnswer & { goodAt: number }

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

type Lookup = {
  listedLive: KickStream[]
  /** Listed creators Kick really said are off. */
  listedOff: string[]
  /** Kick's most-watched list; undefined when it failed or came back with no rows, which a site this size never has. */
  top?: KickStream[]
}

const NO_ANSWER: Lookup = { listedLive: [], listedOff: [] }

async function lookUp(read: KickReader): Promise<Lookup> {
  const [top, ...listed] = await Promise.allSettled([
    read(TOP_URL),
    ...LISTED_KICK.map((slug) => read(`https://kick.com/api/v2/channels/${slug}`)),
  ])
  const found: Lookup = { listedLive: [], listedOff: [] }
  listed.forEach((r, i) => {
    const c: any = r.status === 'fulfilled' ? r.value : undefined
    if (!c || typeof c !== 'object' || !('livestream' in c)) return
    const stream = c.livestream?.is_live ? asStream(LISTED_KICK[i], c.user?.username, c.livestream.viewer_count) : undefined
    if (stream) found.listedLive.push(stream)
    else found.listedOff.push(LISTED_KICK[i]!)
  })
  const answer: any = top!.status === 'fulfilled' ? top!.value : undefined
  if (Array.isArray(answer?.data) && answer.data.length) found.top = suitableStreams(answer)
  return found
}

/** What a check amounts to. Only a full answer counts as checked and resets the age of the list. */
function settle(found: Lookup, last: Saved | undefined, now: number): Saved {
  const { listedLive, listedOff, top } = found
  const streams = top ? chooseStreams(listedLive, top) : []
  // Nobody suitable only means nobody on when every listed creator answered as well.
  if (top && (streams.length || listedLive.length + listedOff.length === LISTED_KICK.length))
    return { streams, checked: true, goodAt: now }

  // Part of an answer tops up the last good list, while that is young enough, rather than replacing it.
  const young = last && now - last.goodAt < KICK_STALE_LIMIT_MS ? last.streams : []
  const off = new Set(listedOff)
  return {
    streams: chooseStreams(
      listedLive,
      young.filter((s) => !off.has(s.slug.toLowerCase()))
    ),
    checked: false,
    goodAt: last?.goodAt ?? 0,
  }
}

/** The streams to offer: cached for everyone, and whether Kick really answered for them. */
const checking = new WeakMap<object, Promise<Saved | undefined>>()

export async function kickOnAir(deps: { read?: KickReader; cache: SharedCache; now: number }): Promise<KickAnswer> {
  if (!deps.read) return { streams: [], checked: false }
  const read = deps.read
  const cached = (await deps.cache.get(CACHE_KEY).catch(() => null)) as { at: number; body: Saved } | undefined | null
  // With no cache every viewer's request would become four calls to Kick, so say we could not check instead.
  if (cached === null) return { streams: [], checked: false }
  if (cached && deps.now - cached.at < KICK_RECHECK_MS)
    return { streams: cached.body.streams, checked: cached.body.checked }

  // One check at a time: in this isolate, and anywhere when the cache can lock.
  let running = checking.get(deps.cache)
  if (!running) {
    running = (async () => {
      const mine = deps.cache.claim
        ? await deps.cache.claim(CACHE_KEY, deps.now, LOCK_MS, deps.now - KICK_RECHECK_MS + 1).catch(() => true)
        : true
      if (!mine) return undefined
      const found = await lookUp(read).catch((e: Error) => {
        console.warn(`tv kick: ${e.message}`)
        return NO_ANSWER
      })
      const next = settle(found, cached?.body, deps.now)
      if (!next.checked) console.warn('tv kick: no full answer')
      await deps.cache.put(CACHE_KEY, { at: deps.now, body: next }, KICK_STALE_LIMIT_MS / 1000).catch(() => undefined)
      return next
    })().finally(() => checking.delete(deps.cache))
    checking.set(deps.cache, running)
  }
  const saved = await running
  if (saved) return { streams: saved.streams, checked: saved.checked }
  // Someone else is checking: the last list while it is young enough, and not as checked.
  const young = cached && deps.now - cached.body.goodAt < KICK_STALE_LIMIT_MS ? cached.body.streams : []
  return { streams: young, checked: false }
}

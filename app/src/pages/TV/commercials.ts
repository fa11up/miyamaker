/**
 * Public access's commercials. Only the station makes these: this list in the code is the only way in, and nothing people
 * send in can become one. A break only ever falls between tapes, never inside one, and at most about twice an hour, so a
 * long tape simply gets its break at the end. Spots run on our own screen with the YouTube player gone, because YouTube's
 * rules forbid placing anything on or in its player. The films are served by the site itself (public/commercials), each
 * under Cloudflare's 25 MiB limit per file, and only load when their break comes. Pure, so `node --test` can run it.
 */
export const BREAK_EVERY_MS = 30 * 60_000
export const DRAWN_SECONDS = 15
export const SKIP_AFTER_SECONDS = 5

export type Commercial =
  /** One of our own films. */
  | { id: string; series: string; kind: 'video'; src: string }
  /** Drawn by miyatv itself. */
  | { id: string; series: string; kind: 'drawn'; headline: string; lines: string[] }

export const COMMERCIALS: Commercial[] = [
  { id: 'trilyun', series: 'imdUSD', kind: 'video', src: '/commercials/trilyun-dollars.mp4' },
  { id: 'who-decides', series: 'imdUSD', kind: 'video', src: '/commercials/who-decides.mp4' },
  { id: 'imd-girls', series: 'imdUSD', kind: 'video', src: '/commercials/imd-girls.mp4' },
  { id: 'pepe-dollars', series: 'imdUSD', kind: 'video', src: '/commercials/pepe-dollars.mp4' },
  { id: 'infer97', series: 'INFER', kind: 'video', src: '/commercials/infer97.mp4' },
  {
    id: 'partners-1',
    series: 'Partner with miyaTV',
    kind: 'drawn',
    headline: 'YOUR AD HERE',
    lines: ['Got something worth showing?', 'Partner with miyaTV.', 'Commercial spots on Public Access, coming soon.'],
  },
]

export type BreakLog = { at: number; index: number }

/** Due when the last break was at least half an hour ago, or there has not been one. */
export const isBreakDue = (now: number, last: BreakLog | undefined, spots = COMMERCIALS.length) =>
  spots > 0 && (!last || now - last.at >= BREAK_EVERY_MS)

/** Which spot comes next, taking turns. */
export const nextSpotIndex = (last: BreakLog | undefined, spots = COMMERCIALS.length) =>
  spots > 0 ? ((last?.index ?? -1) + 1) % spots : -1

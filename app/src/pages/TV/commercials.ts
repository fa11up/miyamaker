/**
 * Public access's commercials. Only the station makes these: this list in the code is the only way in, and nothing people
 * send in can become one. A break only ever falls between tapes, never inside one, and at most about twice an hour, so a
 * long tape simply gets its break at the end. Spots run on our own screen with the YouTube player gone, because YouTube's
 * rules forbid placing anything on or in its player. Pure, so `node --test` can run it.
 */
export const BREAK_EVERY_MS = 30 * 60_000
export const DRAWN_SECONDS = 15
export const SKIP_AFTER_SECONDS = 5

export type Commercial =
  /** A video the station uploaded to its own YouTube channel. Plays through, with no skip drawn over YouTube's player. */
  | { id: string; series: string; kind: 'youtube'; videoId: string }
  /** Drawn by miyatv itself. */
  | { id: string; series: string; kind: 'drawn'; headline: string; lines: string[] }

export const COMMERCIALS: Commercial[] = [
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

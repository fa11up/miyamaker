/**
 * What miyatv reads from its own API, checked for shape before anything draws it, and the rule for giving up on dead
 * tapes. Pure, with type imports only, so `node --test` can load it.
 */
import type { Tape } from '../../../api/_lib/publicaccess'
import type { KickStream } from '../../../api/_lib/tvkick'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type TvLive = { ids: Record<string, string>; kick: KickStream[]; kickChecked?: boolean }

/** The live list: ids are strings by channel, Kick is a list of streams with a slug and a name. Anything else is dropped. */
export function readTvLive(v: unknown): TvLive {
  const o = isObj(v) ? v : {}
  const ids: Record<string, string> = {}
  if (isObj(o.ids)) {
    for (const [k, id] of Object.entries(o.ids)) if (typeof id === 'string' && id) ids[k] = id
  }

  const kick: KickStream[] = Array.isArray(o.kick)
    ? o.kick
        .filter((k): k is Record<string, unknown> => isObj(k) && typeof k.slug === 'string' && !!k.slug)
        .map((k) => ({
          slug: k.slug as string,
          label: typeof k.label === 'string' && k.label ? k.label : (k.slug as string),
          viewers: typeof k.viewers === 'number' && Number.isFinite(k.viewers) ? k.viewers : 0,
        }))
    : []
  return { ids, kick, kickChecked: typeof o.kickChecked === 'boolean' ? o.kickChecked : undefined }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function readTape(v: unknown): Tape | undefined {
  if (!isObj(v) || typeof v.videoId !== 'string' || !/^[\w-]{6,20}$/.test(v.videoId)) return undefined
  return {
    videoId: v.videoId,
    title: str(v.title),
    author: str(v.author),
    submitter: str(v.submitter),
    submittedAt: num(v.submittedAt) ?? 0,
    approvedAt: num(v.approvedAt),
    removedAt: num(v.removedAt),
    removedBy: typeof v.removedBy === 'string' ? v.removedBy : undefined,
  }
}

const tapes = (v: unknown): Tape[] =>
  Array.isArray(v) ? v.map(readTape).filter((t): t is Tape => !!t) : []

/** The public access list: tapes and pending as lists of well-formed tapes, admins as lower-case strings. */
export function readTapeList(v: unknown): { tapes: Tape[]; pending: Tape[]; admins: string[] } {
  const o = isObj(v) ? v : {}
  return {
    tapes: tapes(o.tapes),
    pending: tapes(o.pending),
    admins: Array.isArray(o.admins)
      ? o.admins.filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase())
      : [],
  }
}

/** Wait after a dead tape before the next one: the player's own few seconds, then longer each time, at most 30 s. */
export const DEAD_BASE_MS = 3000
export const DEAD_MAX_MS = 30_000

export type DeadRun = { streak: number }
export type DeadStep = { give: 'next'; afterMs: number } | { give: 'up' }

/**
 * Another tape turned out dead. Once every tape on the list has failed in a row there is nothing playable, so it stops
 * rather than loading a new YouTube player every few seconds for good. Before that it backs off: 0, 3, 6, 12 … s.
 * A tape that plays resets the run (see `tapePlayed`).
 */
export function tapeDied(run: DeadRun, total: number): { run: DeadRun; step: DeadStep } {
  const streak = run.streak + 1
  if (streak >= Math.max(1, total)) return { run: { streak }, step: { give: 'up' } }
  const afterMs = streak <= 1 ? 0 : Math.min(DEAD_MAX_MS, DEAD_BASE_MS * 2 ** (streak - 2))
  return { run: { streak }, step: { give: 'next', afterMs } }
}

export const tapePlayed = (): DeadRun => ({ streak: 0 })

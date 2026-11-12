// The decisions behind scripts/refresh-phases.mts that don't need the chain, so node:test can check them
// (tests/allowlist-refresh.test.mts): what a phase's cap becomes, which earlier claimers carry over, whether a list
// file is the one the phase points at.
import type { AllowlistFile } from '../../api/_lib/allowlist.ts'

/**
 * A phase's cap after setPhases, which starts its sold count again at 0. The drop reads supplyCap 0 as "no cap", so a
 * capped phase whose cap is used up must never be sent with 0: it is left out of the plan instead.
 */
export function nextCap(cap: number, sold: bigint): { keep: true; cap: number; words: string } | { keep: false; words: string } {
  if (cap === 0) return { keep: true, cap: 0, words: 'no cap (stays none)' }
  const left = BigInt(cap) > sold ? BigInt(cap) - sold : 0n
  if (left === 0n) return { keep: false, words: `cap ${cap} used up (sold ${sold}): left out, so it can't reopen without a cap` }
  return { keep: true, cap: Number(left), words: `cap ${cap} - sold ${sold} -> ${left}` }
}

/** Every planned phase whose old phase had a cap still has one (0 would be no cap at all). Throws otherwise. */
export function assertCaps(plan: readonly { from: number; was: number; phase: { supplyCap: number } }[]) {
  for (const p of plan) {
    if (p.was !== 0 && p.phase.supplyCap === 0) {
      throw new Error(`phase ${p.from} had a cap of ${p.was} and would be sent with 0, which the drop reads as no cap: stopped`)
    }
  }
}

/** A list file is only used for a phase when its tree's root is the phase's root. */
export const fileFits = (file: AllowlistFile | undefined, root: string) =>
  !!file && file.tree[0]?.toLowerCase() === root.toLowerCase()

/** What refresh-phases writes after each run (scripts/out/refresh-claimers-<drop>-<block>.json). */
export type ClaimersRecord = {
  drop: string
  block: number
  /** The drop's phasesEpoch the claims were read in, and the one the planned setPhases starts. */
  epoch?: number
  liveFromEpoch?: number
  /** Wallets (lowercase) left off each collection's list: claimers, their tokens' new holders, and earlier ones. */
  excluded?: Record<string, string[]>
  /** Older records: only the claimers. */
  claimers?: Record<string, string[]>
}

/** A list phase whose list is a holder snapshot: its root, its collection, its file. */
export type ListPhase = { phase: number; root: string; source: string; file: AllowlistFile }

/**
 * The wallets earlier refreshes left off, per collection (lowercase), that this refresh must leave off too.
 *
 * phasesEpoch starts at 1 when the drop is made and goes up with every setPhases, and each setPhases starts every
 * wallet's count again. Counts read now only cover the current epoch (`epoch`), so from epoch 2 on, the wallets that
 * claimed before must come from a record: a list file a refresh published for this drop (its miya.refresh says the list
 * went live in this very epoch), or --previous (the claimers file of the run whose setPhases was sent). A list phase in
 * epoch 2 or later with neither stops the refresh, unless `noRecordOk` (the owner accepts that earlier claimers may be
 * listed again).
 */
export function carriedExclusions(opts: {
  drop: string
  epoch: bigint
  lists: readonly ListPhase[]
  previous?: ClaimersRecord
  previousName?: string
  noRecordOk?: boolean
}): { carried: Map<string, Set<string>>; notes: string[] } {
  const { drop, epoch, lists, previous } = opts
  const carried = new Map<string, Set<string>>()
  const notes: string[] = []
  const add = (src: string, wallets: readonly string[]) => {
    const set = carried.get(src.toLowerCase()) ?? new Set<string>()
    for (const w of wallets) set.add(w.toLowerCase())
    carried.set(src.toLowerCase(), set)
  }
  if (previous) {
    if (previous.drop?.toLowerCase() !== drop.toLowerCase()) {
      throw new Error(`--previous ${opts.previousName ?? ''} is for drop ${previous.drop}, not ${drop}: stopped`)
    }
    if (previous.liveFromEpoch === undefined) {
      notes.push(`--previous doesn't say which phase list it was made for (an older file): check it is the run whose setPhases was sent.`)
    } else if (BigInt(previous.liveFromEpoch) !== epoch) {
      throw new Error(
        `--previous was planned for phase list ${previous.liveFromEpoch}, but the drop is on phase list ${epoch}: ` +
          'another setPhases was sent in between, so claimers may be missing. Pass the claimers file of the run that was sent.'
      )
    }
    for (const [src, list] of Object.entries(previous.excluded ?? previous.claimers ?? {})) add(src, list)
  }
  const covered = new Set<number>()
  for (const l of lists) {
    const r = l.file.miya?.refresh
    if (!r) continue
    if (r.drop.toLowerCase() !== drop.toLowerCase()) {
      notes.push(`phase ${l.phase}'s list was made by a refresh of another drop (${r.drop}): its record is not used.`)
      continue
    }
    if (BigInt(r.liveFromEpoch) !== epoch) {
      notes.push(`phase ${l.phase}'s list was planned for phase list ${r.liveFromEpoch}, not ${epoch}: its record is not used.`)
      continue
    }
    add(l.source, l.file.miya?.excluded ?? [])
    covered.add(l.phase)
  }
  if (epoch > 1n && !previous) {
    const missing = lists.filter((l) => !covered.has(l.phase))
    if (missing.length && !opts.noRecordOk) {
      throw new Error(
        `The drop's phases were replaced before (phase list ${epoch}), and nothing records who claimed under the earlier ` +
          `lists for phase${missing.length > 1 ? 's' : ''} ${missing.map((l) => l.phase).join(', ')}. Those wallets could be ` +
          'listed again. Pass --previous <refresh-claimers file of the run that was sent>, or --no-previous-record to ' +
          'accept that.'
      )
    }
    if (missing.length) notes.push(`--no-previous-record: wallets that claimed before phase list ${epoch} may be listed again.`)
  }
  return { carried, notes }
}

/** The Launch window's name for a refresh's list, so it never replaces the collection's general holder list. */
export const refreshEntryName = (name: string, drop: string, liveFromEpoch: number) =>
  `${name} (drop ${drop.slice(0, 8)} refresh ${liveFromEpoch - 1})`

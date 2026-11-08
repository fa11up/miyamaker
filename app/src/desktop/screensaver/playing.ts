/**
 * What is playing right now (the radio, miyaTV's picture, the Drop Music studio), so the screensaver doesn't come down
 * over it, and one owner of sound at a time: when a source starts, the others are asked to pause. Nothing resumes by
 * itself; that stays with the person.
 *
 * A source is named `owner` or `owner-part` ('tv-youtube', 'tv-embed'): the parts of one app never hush each other.
 * Pure, no imports, so `node --test` can load it.
 */
const playing = new Set<string>()
const hushers = new Map<string, () => void>()

export const ownerOf = (source: string) => source.split('-')[0] as string

export function setPlaying(source: string, on: boolean) {
  const started = on && !playing.has(source)
  if (on) playing.add(source)
  else playing.delete(source)
  if (!started) return
  const owner = ownerOf(source)
  // Copied first: a hush can end a source, and that may register or drop others.
  for (const [other, hush] of [...hushers]) {
    if (other === owner) continue
    try {
      hush()
    } catch {
      // One app failing to pause must not stop the rest from being asked.
    }
  }
}

/**
 * `owner` pauses itself with `hush` when another app starts making sound. Returns the undo, for an effect's cleanup.
 * One hush per owner: a newer one replaces the older.
 */
export function onSoundTaken(owner: string, hush: () => void): () => void {
  hushers.set(owner, hush)
  return () => {
    if (hushers.get(owner) === hush) hushers.delete(owner)
  }
}

/** Whether any part of `owner` ('tv' for 'tv-youtube' and the rest) is playing. */
export const ownerPlaying = (owner: string) => [...playing].some((s) => ownerOf(s) === owner)

export const anythingPlaying = () => playing.size > 0

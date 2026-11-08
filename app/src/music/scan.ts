/**
 * How complete a music-drops scan was, and what to say about it. No runtime imports, so `node --test` can load it
 * (tests/music-scan.test.mts).
 */

export type ScanResult<T> = {
  items: T[]
  /** Collections we tried to read. */
  tried: number
  /** Collections whose reads never got an answer (RPC down, timeout). Not the same as "not music". */
  failed: number
  /** Something was left out on purpose: more collections, editions or registry entries than we read. */
  capped: boolean
}

/** Thrown when nothing could be read at all, so the screen says "couldn't load", never "no drops yet". */
export class MusicScanError extends Error {
  constructor(message = "Couldn't load music drops.") {
    super(message)
    this.name = 'MusicScanError'
  }
}

/**
 * Combines per-collection outcomes. Throws when the registry read failed or every collection failed: an empty
 * list would then claim there is no music. `undefined` in `results` means that collection failed.
 */
export function combineScan<T>(
  results: readonly ({ items: T[]; capped?: boolean; someFailed?: boolean } | undefined)[],
  opts: { registryFailed: boolean; capped: boolean }
): ScanResult<T> {
  if (opts.registryFailed) throw new MusicScanError()
  const lost = results.filter((r) => r === undefined).length
  if (results.length > 0 && lost === results.length) throw new MusicScanError()
  const items = results.flatMap((r) => r?.items ?? [])
  const capped = opts.capped || results.some((r) => !!r?.capped)
  // A collection read only in part (some editions unanswered) counts as failed too: its list is not complete.
  const failed = lost + results.filter((r) => !!r?.someFailed).length
  return { items, tried: results.length, failed, capped }
}

/** The short note under a list that is not everything, or undefined when it is. */
export function scanNote(scan: Pick<ScanResult<unknown>, 'failed' | 'capped'>): string | undefined {
  if (scan.failed > 0)
    return `Some drops couldn't load (${scan.failed} collection${scan.failed === 1 ? '' : 's'}). Try again.`
  if (scan.capped) return 'Showing the newest drops only.'
  return undefined
}

/** The edition's price line on the Mint button: an unread price is never a guess. */
export function mintLabel(price: bigint | undefined, format: (wei: bigint) => string): string {
  return price === undefined ? 'Price unavailable' : `Mint · ${format(price)} ETH`
}

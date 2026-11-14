/**
 * "My launches": merging collection lists from several sources (MiyaRegistry scan, collections launched in this
 * browser, legacy collections managed here) into one list. Pure: tested in tests/miyamints-launch.test.mts.
 */

/**
 * What a collection is: one of ours by its registry factory ('drop', 'auction', 'editions', 'curve'), 'other' when the
 * registry names a factory this app doesn't manage, 'legacy' for the old MiyaMints contracts (not in the registry).
 */
export type LaunchKind = 'drop' | 'auction' | 'editions' | 'curve' | 'other' | 'legacy' | 'unknown'

export type LaunchRef = {
  chainId: number
  address: `0x${string}`
  kind: LaunchKind
  /** Higher = newer. Registry index, or a timestamp for local entries. */
  order: number
  source: 'registry' | 'local' | 'legacy'
}

export const keyOf = (r: { chainId: number; address: string }) => `${r.chainId}:${r.address.toLowerCase()}`

const SOURCE_RANK: Record<LaunchRef['source'], number> = { registry: 3, local: 2, legacy: 1 }

/**
 * One entry per chain + address (case-insensitive). The registry wins over local/legacy guesses for `kind`;
 * `order` keeps the largest value seen. Sorted newest first, then by chain id, then address.
 */
export function mergeLaunches(...lists: LaunchRef[][]): LaunchRef[] {
  const map = new Map<string, LaunchRef>()
  lists.flat().forEach((r) => {
    const k = keyOf(r)
    const prev = map.get(k)
    if (!prev) {
      map.set(k, { ...r })
      return
    }

    const better = SOURCE_RANK[r.source] > SOURCE_RANK[prev.source] ? r : prev
    map.set(k, {
      ...better,
      kind: better.kind === 'unknown' ? (better === r ? prev.kind : r.kind) : better.kind,
      order: Math.max(prev.order, r.order),
    })
  })
  return Array.from(map.values()).sort(
    (a, b) =>
      b.order - a.order || a.chainId - b.chainId || a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  )
}

/** Which factory made an instance, from MiyaRegistry.factoryOf and the chain's factory addresses. */
export function kindFromFactory(
  factory: string | undefined,
  f: {
    erc721DropFactory?: string
    erc721AuctionFactory?: string
    erc1155Factory?: string
    curveEditionFactory?: string
  }
): LaunchKind {
  const lc = (factory || '').toLowerCase()
  if (!lc) return 'unknown'
  if (lc === f.erc721DropFactory?.toLowerCase()) return 'drop'
  if (lc === f.erc721AuctionFactory?.toLowerCase()) return 'auction'
  if (lc === f.erc1155Factory?.toLowerCase()) return 'editions'
  if (lc === f.curveEditionFactory?.toLowerCase()) return 'curve'
  return 'unknown'
}

/** Registry indices to scan, newest first: the last `max` of `count`. */
export function scanRange(count: number, max: number): number[] {
  const out: number[] = []
  for (let i = count - 1; i >= 0 && out.length < max; i -= 1) out.push(i)
  return out
}

/** "12 / 100 minted", "3 minted" (open edition), "2 pieces" (auction). */
export function progressLabel(kind: LaunchKind, minted?: bigint, supply?: bigint): string {
  if (minted === undefined) return ''
  if (kind === 'auction') return `${minted} ${minted === 1n ? 'piece' : 'pieces'}`
  if (!supply) return `${minted} minted`
  return `${minted} / ${supply} minted`
}

export const KIND_LABEL: Record<LaunchKind, string> = {
  drop: 'Fixed-price drop',
  auction: 'Auction',
  editions: 'Editions',
  curve: 'Curve editions',
  other: 'Collection',
  legacy: 'Legacy (MiyaMints v1)',
  unknown: 'Collection',
}

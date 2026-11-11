/**
 * The ERC-1155 bonding curves a release can pick. The chain stores one of these as LIMITED_DYNAMIC:
 * the next copy costs base * (1 + percent) ^ copies already sold. Flat is a fixed price (or an open edition).
 * The chart uses the same compounding, truncating to wei after each copy.
 */

export const CURVES = [
  { id: 'flat', label: 'Flat', rise: '', detail: 'One price for every copy' },
  { id: 'gentle', label: 'Gentle', rise: '1', detail: '1% more each copy' },
  { id: 'steady', label: 'Steady', rise: '2.5', detail: '2.5% more each copy' },
  { id: 'steep', label: 'Steep', rise: '5', detail: '5% more each copy' },
] as const

export type CurveId = (typeof CURVES)[number]['id'] | 'custom'

/** Basis points for a typed percent. 0 is flat. null is not a usable percent. */
export function riseBps(rise: string): number | null {
  const s = (rise || '').trim()
  if (!s || /^0+(?:\.0+)?$/.test(s)) return 0
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (bps <= 0 || bps > 10_000) return null
  return bps
}

export function curveId(rise: string): CurveId {
  const bps = riseBps(rise)
  if (bps === 100) return 'gentle'
  if (bps === 250) return 'steady'
  if (bps === 500) return 'steep'
  if (bps === 0) return 'flat'
  return 'custom'
}

/** Price of the copy at `minted` already sold (0 is the first copy). */
export function curvePrice(base: bigint, bps: number, minted: number): bigint {
  if (base <= 0n || minted <= 0 || bps <= 0) return base > 0n ? base : 0n
  const factor = 10_000n + BigInt(bps)
  let price = base
  const steps = Math.min(minted, 100_000)
  for (let i = 0; i < steps; i++) price = (price * factor) / 10_000n
  return price < base ? base : price
}

/** How far the chart draws. A long edition keeps rising past this window. */
export const CURVE_WINDOW = 240

export function curveCaption(rise: string): string {
  const id = curveId(rise)
  const preset = CURVES.find((c) => c.id === id)
  if (preset) return `${preset.label}. ${preset.detail}.`
  const bps = riseBps(rise)
  if (bps == null) return 'Type the rise as a percent, like 1 or 3.5.'
  return `Custom. Each copy costs ${rise.trim()}% more than the one before it.`
}

/**
 * Font sizes (px) the lot description may step down through so long texts fit their box without a scrollbar.
 * W95FA is a pixel font: whole-pixel sizes keep it crisp, and 12px is the smallest that stays readable.
 */
export const DESCRIPTION_SIZES = [15, 14, 13, 12] as const

/**
 * The largest size whose text fits, trying them largest first. `overflow` is true when even the smallest is too
 * long (the box then clips and offers the full text elsewhere).
 */
export function pickFitSize(sizes: readonly number[], fits: (size: number) => boolean) {
  const size = sizes.find(fits)
  if (size !== undefined) return { size, overflow: false }
  return { size: sizes[sizes.length - 1] ?? 12, overflow: true }
}

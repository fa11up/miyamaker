/** The winged heart behind the console, in a 1000 x 735 viewBox. Pure, so tests can check it. */
export const VIEW = { width: 1000, height: 735 } as const

/** The heart, drawn large and centred: the console sits on it, with the lobes and the point showing around it. */
export const HEART_PATH =
  'M500 660C350 540 185 400 185 225C185 110 280 20 375 20C430 20 480 50 500 105C520 50 570 20 625 20C720 20 815 110 815 225C815 400 650 540 500 660Z'

export type Side = 'left' | 'right'

const PIVOT = { left: { x: 300, y: 275 }, right: { x: 700, y: 275 } } as const
export const pivot = (side: Side) => PIVOT[side]

/** One feather from a wing's shoulder. `angle`: degrees above horizontal. Its tip curves up, like the logo's. */
export function feather(side: Side, angle: number, length: number, width: number) {
  const s = side === 'left' ? -1 : 1
  const { x, y } = PIVOT[side]
  const a = (angle * Math.PI) / 180
  const at = (along: number, across: number) => {
    const fx = s * along
    const px = fx * Math.cos(a) + s * across * Math.sin(a)
    const py = -along * Math.sin(a) + across * Math.cos(a)
    return `${(x + px).toFixed(1)} ${(y + py).toFixed(1)}`
  }

  const L = length
  const w = width
  return {
    d: `M${at(0, 0)}C${at(L * 0.3, -w)} ${at(L * 0.72, -w * 1.15)} ${at(L, -w * 0.5)}C${at(L * 0.86, w * 0.5)} ${at(
      L * 0.35,
      w * 0.85
    )} ${at(0, 0)}Z`,
    spine: `M${at(L * 0.3, -w * 0.2)}Q${at(L * 0.6, -w * 0.3)} ${at(L * 0.96, -w * 0.48)}`,
  }
}

/** A feather in the tail, hanging from the heart's point. `angle`: degrees off straight down. */
export function tailFeather(angle: number, length: number, width: number) {
  const a = (angle * Math.PI) / 180
  const cx = 500
  const cy = 600
  const at = (along: number, across: number) =>
    `${(cx + along * Math.sin(a) + across * Math.cos(a)).toFixed(1)} ${(
      cy +
      along * Math.cos(a) -
      across * Math.sin(a)
    ).toFixed(1)}`
  return `M${at(0, -width)}C${at(length * 0.4, -width * 1.1)} ${at(length * 0.8, -width * 0.5)} ${at(length, 0)}C${at(
    length * 0.8,
    width * 0.5
  )} ${at(length * 0.4, width * 1.1)} ${at(0, width)}Z`
}

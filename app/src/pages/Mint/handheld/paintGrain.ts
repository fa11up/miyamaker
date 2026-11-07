/**
 * Which way a painting's brushwork runs, read from its pixels: brightness changes fastest across a stroke and hardly at all
 * along it, so the average direction of change round each point (a structure tensor) gives the grain there.
 */

/** The grain's angle in radians at each cell, from brightness in rows. `radius` is how many cells round each it averages. */
export function grainField(lum: ArrayLike<number>, w: number, h: number, radius: number) {
  const at = (x: number, y: number) => lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!
  const xx = new Float32Array(w * h)
  const yy = new Float32Array(w * h)
  const xy = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const gx = at(x + 1, y) - at(x - 1, y)
      const gy = at(x, y + 1) - at(x, y - 1)
      const i = y * w + x
      xx[i] = gx * gx
      yy[i] = gy * gy
      xy[i] = gx * gy
    }
  }
  const field = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let a = 0
      let b = 0
      let c = 0
      for (let v = Math.max(0, y - radius); v <= Math.min(h - 1, y + radius); v += 1) {
        for (let u = Math.max(0, x - radius); u <= Math.min(w - 1, x + radius); u += 1) {
          const i = v * w + u
          a += xx[i]!
          b += yy[i]!
          c += xy[i]!
        }
      }
      // The direction of most change, turned a quarter: along the stroke, not across it.
      field[y * w + x] = 0.5 * Math.atan2(2 * c, a - b) + Math.PI / 2
    }
  }
  return field
}

const TURN = 0.2

/** A line from x, y that follows the grain for `steps` steps of `step`, never doubling back. `cell` is the field's scale. */
export function traceGrain(
  field: ArrayLike<number>,
  w: number,
  h: number,
  cell: number,
  x: number,
  y: number,
  from: number,
  steps: number,
  step: number,
) {
  const points: [number, number][] = [[x, y]]
  let dx = Math.cos(from)
  let dy = Math.sin(from)
  let px = x
  let py = y
  for (let i = 0; i < steps; i += 1) {
    const col = Math.max(0, Math.min(w - 1, Math.floor(px / cell)))
    const row = Math.max(0, Math.min(h - 1, Math.floor(py / cell)))
    const angle = field[row * w + col]!
    let nx = Math.cos(angle)
    let ny = Math.sin(angle)
    // The grain has no front or back: keep going the way this line is going.
    if (nx * dx + ny * dy < 0) {
      nx = -nx
      ny = -ny
    }
    // A loaded brush turns gradually, whatever the paint under it does.
    dx += (nx - dx) * TURN
    dy += (ny - dy) * TURN
    const length = Math.hypot(dx, dy) || 1
    dx /= length
    dy /= length
    px += dx * step
    py += dy * step
    points.push([px, py])
  }
  return points
}

/** A bristle of a brush whose middle runs along `spine`: the same line, held `side` to one side of it, square to its path. */
export function besideLine(spine: [number, number][], side: number) {
  return spine.map(([x, y], i): [number, number] => {
    const [ax, ay] = spine[Math.max(0, i - 1)]!
    const [bx, by] = spine[Math.min(spine.length - 1, i + 1)]!
    const length = Math.hypot(bx - ax, by - ay) || 1
    return [x - ((by - ay) / length) * side, y + ((bx - ax) / length) * side]
  })
}

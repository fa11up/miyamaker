/**
 * Desktop icon grid: where each icon sits, as grid cells. Pure (no DOM) so `node --test` runs it.
 *
 * The default layout is the old CSS grid: columns of icons, top to bottom, then the next column.
 * Users can drag icons to any free cell; positions are saved per device (localStorage) and
 * re-fitted to the current screen size on load, so a saved layout never puts an icon off screen.
 */

export interface Cell {
  col: number
  row: number
}

export type IconLayout = Record<string, Cell>

export const GRID = {
  cellW: 96,
  cellH: 104,
  gap: 8,
  pad: 16,
} as const

export const pitchX = GRID.cellW + GRID.gap
export const pitchY = GRID.cellH + GRID.gap

/** How many columns and rows of cells fit in a desktop of this size (at least 1x1). */
export function gridDims(width: number, height: number): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - 2 * GRID.pad + GRID.gap) / pitchX)),
    rows: Math.max(1, Math.floor((height - 2 * GRID.pad + GRID.gap) / pitchY)),
  }
}

export function cellToPx(c: Cell): { x: number; y: number } {
  return { x: GRID.pad + c.col * pitchX, y: GRID.pad + c.row * pitchY }
}

/** Nearest cell to a top-left pixel position, clamped into the grid. */
export function pxToCell(x: number, y: number, cols: number, rows: number): Cell {
  return {
    col: Math.min(cols - 1, Math.max(0, Math.round((x - GRID.pad) / pitchX))),
    row: Math.min(rows - 1, Math.max(0, Math.round((y - GRID.pad) / pitchY))),
  }
}

const key = (c: Cell) => `${c.col},${c.row}`

/** Column-major order of every cell; overflow continues into columns past the right edge. */
function* cellsInOrder(rows: number): Generator<Cell> {
  for (let col = 0; ; col++) for (let row = 0; row < rows; row++) yield { col, row }
}

export function defaultLayout(ids: readonly string[], rows: number): IconLayout {
  const out: IconLayout = {}
  ids.forEach((id, i) => {
    out[id] = { col: Math.floor(i / rows), row: i % rows }
  })
  return out
}

const isCell = (c: unknown): c is Cell =>
  !!c &&
  typeof c === 'object' &&
  Number.isInteger((c as Cell).col) &&
  Number.isInteger((c as Cell).row) &&
  (c as Cell).col >= 0 &&
  (c as Cell).row >= 0

/**
 * Fit saved positions to the current grid: every id gets exactly one cell, no two share one,
 * saved cells outside the grid (smaller screen) or clashing are dropped, and icons without a
 * cell fill the first free cells in default order. Unknown ids in `saved` are ignored.
 */
export function resolveLayout(ids: readonly string[], saved: unknown, cols: number, rows: number): IconLayout {
  const out: IconLayout = {}
  const taken = new Set<string>()
  const savedMap = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  for (const id of ids) {
    const c = savedMap[id]
    if (!isCell(c) || c.col >= cols || c.row >= rows || taken.has(key(c))) continue
    out[id] = { col: c.col, row: c.row }
    taken.add(key(c))
  }

  const free = cellsInOrder(rows)
  for (const id of ids) {
    if (out[id]) continue
    let c = free.next().value as Cell
    while (taken.has(key(c))) c = free.next().value as Cell
    out[id] = c
    taken.add(key(c))
  }

  return out
}

/** Put `id` at `to`. An icon already there swaps into `id`'s old cell. */
export function moveIcon(layout: IconLayout, id: string, to: Cell): IconLayout {
  const from = layout[id]
  if (!from || (from.col === to.col && from.row === to.row)) return layout
  const next: IconLayout = { ...layout, [id]: { col: to.col, row: to.row } }
  const other = Object.keys(layout).find((k) => k !== id && layout[k]!.col === to.col && layout[k]!.row === to.row)
  if (other) next[other] = { ...from }
  return next
}

/** Keyboard move: one cell in a direction, clamped to the grid. */
export function stepCell(c: Cell, dir: 'up' | 'down' | 'left' | 'right', cols: number, rows: number): Cell {
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]
  return {
    col: Math.min(cols - 1, Math.max(0, c.col + d[0]!)),
    row: Math.min(rows - 1, Math.max(0, c.row + d[1]!)),
  }
}

/** Only cells that differ from the default are worth saving (keeps "Arrange icons" a clean reset). */
export function sameAsDefault(layout: IconLayout, ids: readonly string[], rows: number): boolean {
  const def = defaultLayout(ids, rows)
  return ids.every((id) => layout[id]?.col === def[id]!.col && layout[id]?.row === def[id]!.row)
}

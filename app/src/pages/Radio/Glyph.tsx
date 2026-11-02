/** Pixel transport glyphs (10×10 grid, currentColor) shared by the radio window and the taskbar tray. */
export type GlyphKind = 'play' | 'pause' | 'stop' | 'prev' | 'next' | 'wait' | 'note'

const PATHS: Record<GlyphKind, string> = {
  play: 'M2 1h1v8H2zM3 2h1v6H3zM4 2h1v6H4zM5 3h1v4H5zM6 3h1v4H6zM7 4h1v2H7z',
  pause: 'M2 1h2v8H2zM6 1h2v8H6z',
  stop: 'M2 2h6v6H2z',
  prev: 'M1 1h1v8H1zM8 1h1v8H8zM7 2h1v6H7zM6 3h1v4H6zM5 4h1v2H5zM4 4h1v2H4zM3 4h1v2H3z',
  next: 'M8 1h1v8H8zM1 1h1v8H1zM2 2h1v6H2zM3 3h1v4H3zM4 4h1v2H4zM5 4h1v2H5zM6 4h1v2H6z',
  wait: 'M2 1h6v1H2zM3 2h4v1H3zM4 3h2v1H4zM4 6h2v1H4zM3 7h4v1H3zM2 8h6v1H2z',
  note: 'M4 1h5v1H4zM4 2h1v5H4zM8 2h1v4H8zM2 6h3v3H2zM6 5h3v3H6z',
}

export function Glyph({ kind }: { kind: GlyphKind }) {
  return (
    <svg viewBox="0 0 10 10" width="12" height="12" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      <path d={PATHS[kind]} />
    </svg>
  )
}

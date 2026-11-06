import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled, { css } from 'styled-components/macro'

import { NormalButton } from '@/components/Button/NormalButton'
import { imageCandidates, prefetchImages } from '@/components/NftImage'
import TitleBar from '@/components/TitleBar'
import damaskSkin from '@/pages/Auction/skin/damask.webp'
import giltSkin from '@/pages/Auction/skin/gilt.webp'
import { paddleButton } from '@/pages/Auction/skin/paddle'
import paperSkin from '@/pages/Auction/skin/paper.webp'
import { bevel, color, font, space, text } from '@/theme/tokens'
import { thumbFor } from '@/utils/artThumbs'
import { ipfsPath } from '@/utils/ipfsGateways'

export type Artwork = {
  src: string
  name: string
  artist?: string
  description?: string
  /** Extra label rows, e.g. ['Dimensions', '5ft x 4ft']. Empty values are skipped. */
  details?: [string, string | undefined][]
  link?: string
}

/** The app the viewer was opened from, whose materials it wears. */
export type ViewerSkin = 'auction'

const MIN_SCALE = 1
const MAX_SCALE = 8
const STEP = 1.5

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

// ── styles ──────────────────────────────────────────────────────────────────

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200000; /* above every window and the sticky note */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${space[5]};
  background: rgba(10, 6, 20, 0.72);

  ${({ theme }) => theme.mediaWidth.upToSmall`
    padding: 0;
  `}
`

const Frame = styled.div<{ $skin?: ViewerSkin }>`
  display: flex;
  flex-direction: column;
  width: min(1400px, 100%);
  height: min(920px, 100%);
  background: ${color.face};
  box-shadow: ${bevel.raised}, 0 20px 60px rgba(0, 0, 0, 0.55);
  padding: 3px;
  outline: none;
  ${({ $skin }) => $skin && SKINS[$skin]}
`

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  gap: ${space[1]};
  padding-top: ${space[1]};

  ${({ theme }) => theme.mediaWidth.upToSmall`
    flex-direction: column;
  `}
`

const Stage = styled.div<{ $grab: boolean; $zoomed: boolean }>`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(ellipse at center, #2a2440 0%, #0d0a16 75%);
  box-shadow: ${bevel.sunken};
  touch-action: none;
  user-select: none;
  cursor: zoom-in;
  ${({ $zoomed }) => $zoomed && 'cursor: grab;'}
  ${({ $grab }) => $grab && 'cursor: grabbing;'}
`

const Art = styled.img`
  position: absolute;
  inset: 0;
  margin: auto;
  /* The site's img rule sets width: 100%. With it, only a picture as wide as the stage keeps its proportions. */
  width: auto;
  height: auto;
  max-width: calc(100% - 48px);
  max-height: calc(100% - 48px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  transform-origin: center center;
  will-change: transform;
  pointer-events: none;
  -webkit-user-drag: none;
`

const StageNote = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${color.faceLight};
  font-family: ${font.ui};
  font-size: ${text.sm};
`

const Toolbar = styled.div`
  position: absolute;
  left: 50%;
  bottom: ${space[3]};
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: ${space[1]};
  padding: ${space[1]};
  background: ${color.face};
  box-shadow: ${bevel.raised};

  button {
    min-width: 36px;
    height: 32px;
    padding: 0 ${space[2]};
    white-space: nowrap;
  }
`

const ZoomReadout = styled.span`
  min-width: 52px;
  text-align: center;
  font-family: ${font.ui};
  font-size: ${text.sm};
  color: ${color.ink};
`

const NavButton = styled(NormalButton)<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  ${({ $side }) => $side}: ${space[3]};
  transform: translateY(-50%);
  width: 40px;
  height: 56px;
  font-size: ${text.lg};
`

const Label = styled.aside`
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: ${space[4]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  color: ${color.ink};
  font-family: ${font.body};

  ${({ theme }) => theme.mediaWidth.upToSmall`
    width: auto;
    max-height: 38%;
  `}
`

const LabelTitle = styled.h2`
  margin: 0;
  font-family: ${font.ui};
  font-size: ${text.lg};
  line-height: 1.2;
`

const LabelArtist = styled.div`
  margin-top: ${space[1]};
  font-family: ${font.ui};
  font-size: ${text.sm};
  color: ${color.accentDark};
`

const LabelRows = styled.dl`
  margin: ${space[4]} 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space[1]} ${space[3]};
  font-size: 13px;

  dt {
    color: ${color.inkMuted};
  }

  dd {
    margin: 0;
  }
`

const LabelText = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-line;
`

const LabelLink = styled.a`
  display: inline-block;
  margin-top: ${space[4]};
  font-size: 13px;
  color: ${color.link};
  word-break: break-all;
`

const Hint = styled.div`
  margin-top: ${space[5]};
  font-size: 12px;
  color: ${color.inkMuted};
`

// ── skins ───────────────────────────────────────────────────────────────────

const SKINS: Record<ViewerSkin, ReturnType<typeof css>> = {
  /* The sale room: a gilt frame, the piece hung on the damask wall, its label on catalogue paper. */
  auction: css`
    padding: 0 6px 6px;
    background: url(${giltSkin}) 0 0 / 128px 128px;
    & *::selection {
      background: #7a1620;
      color: #f4dd9c;
    }
    box-shadow: inset 0 0 0 1px #4a2f08, 0 20px 60px rgba(0, 0, 0, 0.55);

    ${Stage} {
      background: radial-gradient(ellipse at center, transparent 45%, rgba(12, 2, 4, 0.72) 100%),
        #3f0a12 url(${damaskSkin}) 0 0 / 360px 360px;
      box-shadow: 0 0 0 1px #4a2f08;
    }
    ${Art} {
      border: none;
      box-shadow: 0 0 0 1px #4a2f08, 0 0 0 7px #c9a24c, 0 0 0 8px #4a2f08, 0 14px 40px rgba(8, 1, 2, 0.75);
    }
    ${Toolbar}, ${Label} {
      background: #f6eeda url(${paperSkin}) 0 0 / 256px 256px;
      box-shadow: 0 0 0 1px #4a2f08;
      color: #2a1410;
    }
    ${Body} button {
      ${paddleButton}
    }
    ${Label}, ${Label} * {
      font-family: Georgia, 'Times New Roman', serif;
    }
    ${ZoomReadout} {
      color: #2a1410;
      font-family: Georgia, 'Times New Roman', serif;
    }
    ${LabelArtist}, ${LabelLink} {
      color: #7a1620;
    }
    ${LabelRows} dt, ${Hint} {
      color: #5f4030;
    }
  `,
}

// ── component ───────────────────────────────────────────────────────────────

/**
 * Full-screen "zoom and appreciate" viewer for artwork: wheel / pinch / buttons to zoom, drag to pan,
 * double-click to zoom into a spot, arrows to step through a set, and a museum-style label that can be hidden.
 */
export default function ArtViewer({
  items,
  startIndex = 0,
  onClose,
  skin,
}: {
  items: Artwork[]
  startIndex?: number
  onClose: () => void
  skin?: ViewerSkin
}) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(items.length - 1, 0)))
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [showLabel, setShowLabel] = useState(true)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; scale: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)

  const item = items[index]
  const multiple = items.length > 1

  // Keep the image from being dragged off into the void.
  const clampOffset = useCallback((x: number, y: number, s: number) => {
    const stage = stageRef.current
    const art = artRef.current
    if (!stage || !art) return { x, y }
    const maxX = Math.max(0, (art.offsetWidth * s - stage.clientWidth) / 2 + 24)
    const maxY = Math.max(0, (art.offsetHeight * s - stage.clientHeight) / 2 + 24)
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }, [])

  // Latest values for handlers that outlive a render (native wheel listener, pointer gestures).
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  scaleRef.current = scale
  offsetRef.current = offset

  /** Zoom to `next`, keeping the point at (px, py) (relative to the stage centre) still. */
  const zoomTo = useCallback(
    (next: number, px = 0, py = 0) => {
      const s = scaleRef.current
      const o = offsetRef.current
      const target = clampScale(next)
      const ratio = target / s
      const nextOffset =
        target === 1 ? { x: 0, y: 0 } : clampOffset(px - (px - o.x) * ratio, py - (py - o.y) * ratio, target)
      scaleRef.current = target
      offsetRef.current = nextOffset
      setScale(target)
      setOffset(nextOffset)
    },
    [clampOffset]
  )

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const go = useCallback(
    (delta: number) => {
      if (!multiple) return
      setIndex((i) => (i + delta + items.length) % items.length)
    },
    [items.length, multiple]
  )

  useEffect(() => {
    reset()
    setStatus('loading')
    setAttempt(0)
  }, [index, reset])

  // Sources for this artwork: the IPFS gateways in priority order (next one on error), or the URL as given.
  const sources = item ? imageCandidates(item.src) : []
  const src = sources[attempt] ?? (attempt === 0 ? item?.src : undefined)
  const thumb = thumbFor(item?.src)

  // Warm the cache for the neighbours so ‹ › feels instant.
  useEffect(() => {
    if (!multiple) return
    prefetchImages([items[(index + 1) % items.length]?.src, items[(index - 1 + items.length) % items.length]?.src])
  }, [index, items, multiple])

  // Focus the viewer, restore focus on close, and stop the page behind from scrolling.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    frameRef.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === '+' || e.key === '=') zoomTo(scale * STEP)
    else if (e.key === '-' || e.key === '_') zoomTo(scale / STEP)
    else if (e.key === '0') reset()
    else if (e.key === 'i' || e.key === 'I') setShowLabel((v) => !v)
    else if (e.key === 'ArrowRight') go(1)
    else if (e.key === 'ArrowLeft') go(-1)
    else return
    e.preventDefault()
  }

  const pointFromCentre = (clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 }
  }

  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (statusRef.current !== 'ready') return
      const r = stage.getBoundingClientRect()
      // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send larger ones.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      zoomTo(scaleRef.current * factor, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  /** The two active touch points of a pinch, if exactly two are down. */
  const pinchPoints = () => {
    const [a, b] = [...pointers.current.values()]
    return pointers.current.size === 2 && a && b ? ([a, b] as const) : null
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (status !== 'ready') return
    stageRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pinch = pinchPoints()
    if (pinch) {
      const [a, b] = pinch
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scaleRef.current }
    } else {
      last.current = { x: e.clientX, y: e.clientY }
      setDragging(scale > 1)
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const pinch = pinchPoints()
    if (pinch && gesture.current) {
      const [a, b] = pinch
      const mid = pointFromCentre((a.x + b.x) / 2, (a.y + b.y) / 2)
      zoomTo((gesture.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.current.dist, mid.x, mid.y)
      return
    }

    if (last.current && scale > 1) {
      const dx = e.clientX - last.current.x
      const dy = e.clientY - last.current.y
      const o = offsetRef.current
      const nextOffset = clampOffset(o.x + dx, o.y + dy, scaleRef.current)
      offsetRef.current = nextOffset
      setOffset(nextOffset)
    }

    last.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) gesture.current = null
    if (pointers.current.size === 0) {
      last.current = null
      setDragging(false)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (status !== 'ready') return
    if (scale > 1) {
      reset()
      return
    }

    const p = pointFromCentre(e.clientX, e.clientY)
    zoomTo(2.5, p.x, p.y)
  }

  if (!item) return null
  const details = (item.details || []).filter(([, v]) => v && v !== 'undefined')

  return createPortal(
    <Backdrop onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Frame
        $skin={skin}
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${item.name}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <TitleBar skin={skin} closeBtn onClose={onClose}>
          Viewer — {item.name}
          {multiple ? ` (${index + 1} of ${items.length})` : ''}
        </TitleBar>
        <Body>
          <Stage
            ref={stageRef}
            $grab={dragging}
            $zoomed={scale > 1}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            {thumb && status !== 'ready' && (
              <Art
                src={thumb}
                alt=""
                aria-hidden
                draggable={false}
                style={{
                  filter: 'blur(4px)',
                  boxShadow: 'none',
                  width: 'calc(100% - 48px)',
                  height: 'calc(100% - 48px)',
                  objectFit: 'contain',
                }}
              />
            )}
            <Art
              key={src}
              ref={artRef}
              src={src}
              alt={item.name}
              draggable={false}
              decoding="async"
              crossOrigin={ipfsPath(src) ? 'anonymous' : undefined}
              onLoad={() => setStatus('ready')}
              onError={() => (attempt + 1 < sources.length ? setAttempt(attempt + 1) : setStatus('error'))}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: dragging || gesture.current ? 'none' : 'transform 120ms ease-out',
                opacity: status === 'ready' ? 1 : 0,
              }}
            />
            {status === 'loading' && !thumb && <StageNote>Loading artwork…</StageNote>}
            {status === 'error' && <StageNote>This artwork could not be loaded.</StageNote>}

            {multiple && (
              <>
                <NavButton $side="left" aria-label="Previous artwork" onClick={() => go(-1)}>
                  ‹
                </NavButton>
                <NavButton $side="right" aria-label="Next artwork" onClick={() => go(1)}>
                  ›
                </NavButton>
              </>
            )}

            <Toolbar onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <NormalButton aria-label="Zoom out" onClick={() => zoomTo(scale / STEP)} disabled={scale <= MIN_SCALE}>
                −
              </NormalButton>
              <ZoomReadout aria-live="polite">{Math.round(scale * 100)}%</ZoomReadout>
              <NormalButton aria-label="Zoom in" onClick={() => zoomTo(scale * STEP)} disabled={scale >= MAX_SCALE}>
                +
              </NormalButton>
              <NormalButton onClick={reset} disabled={scale === 1}>
                Fit
              </NormalButton>
              <NormalButton aria-pressed={showLabel} onClick={() => setShowLabel((v) => !v)}>
                {showLabel ? 'Hide info' : 'Info'}
              </NormalButton>
            </Toolbar>
          </Stage>

          {showLabel && (
            <Label aria-label="About this artwork">
              <LabelTitle>{item.name}</LabelTitle>
              {item.artist && item.artist !== 'undefined' && <LabelArtist>{item.artist}</LabelArtist>}
              {details.length > 0 && (
                <LabelRows>
                  {details.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </LabelRows>
              )}
              {item.description && <LabelText>{item.description}</LabelText>}
              {item.link && (
                <LabelLink
                  href={item.link.startsWith('http') ? item.link : `https://${item.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.link}
                </LabelLink>
              )}
              <Hint>
                Scroll or pinch to zoom · drag to look around · double-click a spot ·{' '}
                {multiple ? '← → to browse · ' : ''}I hides this label · Esc closes
              </Hint>
            </Label>
          )}
        </Body>
      </Frame>
    </Backdrop>,
    document.body
  )
}

type MetadataLike = {
  name?: string
  description?: string
  image?: string
  external_url?: string
  externalURL?: string
  attributes?: { trait_type: string; value: string }[]
}

/** Build a viewer item from standard NFT metadata (image already resolved to an HTTP URL). */
export function toArtwork(meta: MetadataLike, extra: [string, string | undefined][] = []): Artwork {
  const trait = (t: string) => meta.attributes?.find((a) => a.trait_type === t)?.value
  return {
    src: meta.image || '',
    name: meta.name || 'Untitled',
    artist: trait('Artist'),
    description: meta.description,
    details: [['Collection', trait('Group')], ['Dimensions', trait('Dimensions')], ...extra],
    link: meta.external_url || meta.externalURL,
  }
}

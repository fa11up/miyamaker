import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { font, space } from '@/theme/tokens'

import { pink, raisedButton } from './chrome'

import { brushRadius, dabSpacing, paintDab, smudgeDab, type Brush, type Pixels } from './brush'
import { CANVAS, type Trait } from './model'
import { pixelsToPng } from './pixels'
import { plateCanvas, plateKey, preparePlate } from './plates'
import { clampZoom, panForZoom, ZOOM_STEP } from './view'

export type Tool = 'pen' | 'erase' | 'smudge' | 'pick'

export type CanvasHandle = {
  load: (pixels: Pixels) => void
  toPng: () => Promise<Blob>
  /** The worn stack plus anything painted on the open trait, as one PNG. */
  flattenPng: () => Promise<Blob>
  isPaintDirty: () => boolean
  markSaved: () => void
  undo: () => void
  redo: () => void
  fit: () => void
}

type Props = {
  brush: Brush
  tool: Tool
  color: string
  onPick: (hex: string) => void
  behind: Trait[]
  ahead: Trait[]
}

const Frame = styled.div`
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  background-color: ${pink.mist};
  background-image: linear-gradient(45deg, ${pink.blush} 25%, transparent 25%), linear-gradient(-45deg, ${pink.blush} 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, ${pink.blush} 75%), linear-gradient(-45deg, transparent 75%, ${pink.blush} 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  box-shadow: inset 1px 1px ${pink.deep}, inset -1px -1px #fff;
  cursor: crosshair;
  touch-action: none;

  &:focus {
    outline: none;
  }

  &.grab {
    cursor: grab;
  }

  &.grabbing {
    cursor: grabbing;
  }

  canvas {
    display: block;
    touch-action: none;
  }
`

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  align-items: center;
  padding: ${space[1]};
  background: ${pink.blush};
  color: ${pink.ink};
  font-family: ${font.ui};
  font-size: 12px;

  button,
  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  button {
    min-height: 28px;
    padding: 0 8px;
    font: inherit;
    ${raisedButton}
  }

  input[type='range'] {
    width: 72px;
  }
`

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.replace('#', '')
  const full = body.length === 3 ? body.split('').map((char) => char + char).join('') : body
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return [20, 16, 31]
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) => n.toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function clone(pixels: Pixels): Pixels {
  return { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(pixels.data) }
}

function Plate({ traits, testId, front }: { traits: Trait[]; testId: string; front?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const traitsRef = useRef(traits)
  traitsRef.current = traits
  const key = traits.map((trait) => plateKey(trait)).join('|')
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let cancel = false
    const controller = new AbortController()
    ctx.clearRect(0, 0, CANVAS, CANVAS)
    const stack = traitsRef.current
    ;(async () => {
      for (const trait of stack) {
        if (cancel) return
        const cached = plateCanvas(trait)
        if (!cached) await preparePlate(trait, controller.signal).catch(() => undefined)
        if (cancel) return
        const ready = plateCanvas(trait)
        if (ready) ctx.drawImage(ready, 0, 0)
      }
    })().catch(() => undefined)
    return () => {
      cancel = true
      controller.abort()
    }
  }, [key])
  return <canvas ref={ref} width={CANVAS} height={CANVAS} data-testid={testId} data-front={front || undefined} aria-hidden />
}

const Stack = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  canvas.paint {
    z-index: 1;
    pointer-events: auto;
  }

  canvas[data-front='true'] {
    z-index: 2;
  }
`

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ brush, tool, color, onPick, behind, ahead }, ref) {
  const viewRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const pixelsRef = useRef<Pixels | null>(null)
  const imageRef = useRef<ImageData | null>(null)
  const dirtyRef = useRef(false)
  const undoRef = useRef<Pixels[]>([])
  const redoRef = useRef<Pixels[]>([])
  const drawing = useRef(false)
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const space = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const strokeId = useRef(1)
  const dabIndex = useRef(0)
  const [zoom, setZoom] = useState(0.45)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hand, setHand] = useState<'grab' | 'grabbing' | null>(null)
  const userZoom = useRef(false)
  const zoomRef = useRef(0.45)
  const panRef = useRef({ x: 0, y: 0 })
  const brushRef = useRef(brush)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  brushRef.current = brush
  toolRef.current = tool
  colorRef.current = color

  const adopt = (pixels: Pixels) => {
    imageRef.current = new ImageData(pixels.data, pixels.width, pixels.height)
    pixelsRef.current = pixels
    const ctx = ctxRef.current
    if (ctx && imageRef.current) ctx.putImageData(imageRef.current, 0, 0)
  }

  const paint = () => {
    const ctx = ctxRef.current
    const image = imageRef.current
    if (!ctx || !image) return
    ctx.putImageData(image, 0, 0)
  }

  const applyZoom = (next: number, nextPan: { x: number; y: number }) => {
    zoomRef.current = next
    panRef.current = nextPan
    setZoom(next)
    setPan(nextPan)
  }

  const zoomBy = (factor: number) => {
    const current = zoomRef.current
    const next = clampZoom(current * factor)
    if (next === current) return
    userZoom.current = true
    applyZoom(next, { x: panForZoom(panRef.current.x, current, next), y: panForZoom(panRef.current.y, current, next) })
  }

  const fitTo = (fromUser: boolean) => {
    const view = viewRef.current
    const canvas = canvasRef.current
    if (!view || !canvas) return
    if (fromUser) userZoom.current = false
    const next = Math.min(view.clientWidth / canvas.width, view.clientHeight / canvas.height)
    applyZoom(clampZoom(next || 0.45), { x: 0, y: 0 })
  }

  const fit = () => fitTo(true)

  useImperativeHandle(ref, () => ({
    load(pixels) {
      dirtyRef.current = false
      undoRef.current = []
      redoRef.current = []
      adopt(clone(pixels))
    },
    toPng() {
      const pixels = pixelsRef.current
      if (!pixels) return Promise.reject(new Error('Nothing is open.'))
      return pixelsToPng(pixels)
    },
    flattenPng() {
      const view = viewRef.current
      const out = document.createElement('canvas')
      out.width = CANVAS
      out.height = CANVAS
      const ctx = out.getContext('2d')
      if (!view || !ctx) return Promise.reject(new Error('Nothing to export yet.'))
      ctx.imageSmoothingEnabled = false
      view.querySelectorAll('canvas').forEach((layer) => ctx.drawImage(layer, 0, 0))
      return new Promise((resolve, reject) => {
        out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not build that picture.'))), 'image/png')
      })
    },
    isPaintDirty: () => dirtyRef.current,
    markSaved() {
      dirtyRef.current = false
    },
    undo() {
      const previous = undoRef.current.pop()
      const current = pixelsRef.current
      if (!previous || !current) return
      redoRef.current.push(clone(current))
      dirtyRef.current = true
      adopt(previous)
    },
    redo() {
      const next = redoRef.current.pop()
      const current = pixelsRef.current
      if (!next || !current) return
      undoRef.current.push(clone(current))
      dirtyRef.current = true
      adopt(next)
    },
    fit,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CANVAS
    canvas.height = CANVAS
    ctxRef.current = canvas.getContext('2d', { willReadFrequently: true })
    if (imageRef.current) ctxRef.current?.putImageData(imageRef.current, 0, 0)
    else if (!pixelsRef.current) adopt({ width: CANVAS, height: CANVAS, data: new Uint8ClampedArray(CANVAS * CANVAS * 4) })
    const view = viewRef.current
    if (!view) return
    const onWheel = (event: WheelEvent) => {
      if (!view.contains(event.target as Node)) return
      event.preventDefault()
      zoomBy(event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)
    }
    const typing = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const inStudio = (event: KeyboardEvent) => {
      if (view.getClientRects().length === 0) return false
      const desk = view.closest('[data-testid=trait-studio]')
      const target = event.target
      if (desk && target instanceof Node && desk.contains(target)) return true
      const active = document.activeElement
      if (active && active !== document.body && active !== document.documentElement) return false
      return true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!inStudio(event) || typing(event)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (!space.current) {
          space.current = true
          if (!panning.current) setHand('grab')
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const into = event.code === 'Equal' || event.code === 'NumpadAdd'
      const out = event.code === 'Minus' || event.code === 'NumpadSubtract'
      if (!into && !out) return
      if ((event.code === 'Equal' || event.code === 'Minus') && !event.shiftKey) return
      event.preventDefault()
      zoomBy(into ? ZOOM_STEP : 1 / ZOOM_STEP)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      space.current = false
      if (!panning.current) setHand(null)
    }
    const releaseHand = () => {
      space.current = false
      panning.current = null
      setHand(null)
    }
    const observer = new ResizeObserver(() => {
      if (!userZoom.current) fitTo(false)
    })
    observer.observe(view)
    view.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseHand)
    return () => {
      observer.disconnect()
      view.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseHand)
    }
  }, [])

  const point = (event: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const dabAt = (x: number, y: number, event: React.PointerEvent) => {
    const pixels = pixelsRef.current
    if (!pixels) return
    const current = brushRef.current
    const pen = event.pointerType === 'pen'
    const [r, g, b] = hexToRgb(colorRef.current)
    paintDab(pixels, x, y, current, {
      pen,
      pressure: event.pressure,
      stroke: strokeId.current,
      dab: dabIndex.current,
      color: [r, g, b, 255],
      erase: toolRef.current === 'erase',
    })
    dabIndex.current += 1
    paint()
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pixelsRef.current) return
    if (event.button === 1 || space.current) return
    if (event.button !== 0) return
    const at = point(event)
    if (toolRef.current === 'pick') {
      const pixels = pixelsRef.current
      const x = Math.floor(at.x)
      const y = Math.floor(at.y)
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return
      const index = (y * pixels.width + x) * 4
      onPick(rgbToHex(pixels.data[index] ?? 0, pixels.data[index + 1] ?? 0, pixels.data[index + 2] ?? 0))
      return
    }
    viewRef.current?.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    undoRef.current.push(clone(pixelsRef.current))
    if (undoRef.current.length > 20) undoRef.current.shift()
    redoRef.current = []
    strokeId.current += 1
    dabIndex.current = 0
    drawing.current = true
    dirtyRef.current = true
    last.current = at
    if (toolRef.current !== 'smudge') dabAt(at.x, at.y, event)
  }

  const smear = (x0: number, y0: number, x1: number, y1: number, event: React.PointerEvent) => {
    const pixels = pixelsRef.current
    if (!pixels) return
    smudgeDab(pixels, x0, y0, x1, y1, brushRef.current, {
      pen: event.pointerType === 'pen',
      pressure: event.pressure,
      stroke: strokeId.current,
      dab: dabIndex.current,
      color: [0, 0, 0, 255],
      erase: false,
    })
    dabIndex.current += 1
    paint()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panning.current) return
    if (!drawing.current) return
    const at = point(event)
    const radius = brushRadius(brushRef.current, event.pressure, event.pointerType === 'pen')
    const step = dabSpacing(radius)
    const smudge = toolRef.current === 'smudge'
    let x = last.current.x
    let y = last.current.y
    let dx = at.x - x
    let dy = at.y - y
    let dist = Math.hypot(dx, dy)
    while (dist >= step) {
      const nextX = x + (dx / dist) * step
      const nextY = y + (dy / dist) * step
      if (smudge) smear(x, y, nextX, nextY, event)
      else dabAt(nextX, nextY, event)
      x = nextX
      y = nextY
      dx = at.x - x
      dy = at.y - y
      dist = Math.hypot(dx, dy)
    }
    last.current = { x, y }
  }

  const endStroke = () => {
    drawing.current = false
  }

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !(event.button === 0 && space.current)) return
    event.preventDefault()
    event.stopPropagation()
    panning.current = { x: event.clientX, y: event.clientY, panX: panRef.current.x, panY: panRef.current.y }
    userZoom.current = true
    setHand('grabbing')
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointer has nothing to capture. The move events still bubble.
    }
  }

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panning.current
    if (!drag) return
    const next = { x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) }
    panRef.current = next
    setPan(next)
  }

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panning.current) return
    panning.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setHand(space.current ? 'grab' : null)
  }

  const size = CANVAS * zoom

  return (
    <>
      <Frame
        ref={viewRef}
        tabIndex={0}
        data-testid="trait-view"
        className={hand ?? undefined}
        onPointerDownCapture={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(event) => event.preventDefault()}
      >
        <Stack
          data-testid="trait-stack"
          style={{
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
          }}
        >
          <Plate traits={behind} testId="trait-behind" />
          <canvas
            ref={canvasRef}
            className="paint"
            data-testid="trait-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onContextMenu={(event) => event.preventDefault()}
          />
          <Plate traits={ahead} testId="trait-ahead" front />
        </Stack>
      </Frame>
      <Bar>
        <button type="button" onClick={fit}>
          Fit
        </button>
        <button
          type="button"
          onClick={() => {
            userZoom.current = true
            const current = zoomRef.current
            const next = 1
            applyZoom(next, { x: panForZoom(panRef.current.x, current, next), y: panForZoom(panRef.current.y, current, next) })
          }}
        >
          1:1
        </button>
        <span data-testid="trait-zoom" title="Shift − zooms out. Shift = zooms in. The scroll wheel zooms to the center. Hold Space and drag to pan.">
          {Math.round(zoom * 100)}%
        </span>
      </Bar>
    </>
  )
})

export default Canvas

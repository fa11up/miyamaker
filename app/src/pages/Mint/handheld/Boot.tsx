import logoSrc from 'assets/134321870.png'
import paintSrc from 'assets/explorer/background/background.png'
import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { playChime } from './chimes'
import { besideLine, grainField, traceGrain } from './paintGrain'

/**
 * The opening scene: on a clear sky, the logo's own heart drops, spinning, and settles. Black ink grows out from behind it
 * into the logo's disc while white is brushed in round it, so the face comes up on white with blue left in the corners.
 * Then a broad brush sketches over the lot from the top left on down, along the painting's own grain, and those strokes
 * are the menu's own painted background, in the same place, so the menu just arrives on them. About five seconds; any
 * press skips it.
 */
export const BOOT_MS = 5100
/** When the painting starts and is finished. */
const PAINT_FROM = 3.05
const PAINT_DONE = 4.95
const PAINT_STROKES = 72
const STROKE_S = 0.3
const NAME_TOP = 286
const SIZE = 360
const LOGO = 220
const LOGO_X = (SIZE - LOGO) / 2
const LOGO_Y = 42
const LAND = 1.25
const INK_DONE = 1.75
const FACE_DONE = 2.35
const CHIME_AT = 1.3
const STROKES = 170
/** The heart's box in the logo image, whose side is 426: found by tracing it, so the drop matches exactly. */
const HEART_BOX = { x: 148, y: 65, w: 122, h: 109, side: 426 }

/** The device's lettering, read off the screen once it's up. */
let TYPE = 'sans-serif'
const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t)
const clamp = (t: number) => Math.max(0, Math.min(1, t))

/** Lifts the heart out of the logo: the light pixels joined to its middle, as a white shape on nothing. */
function cutHeart(logo: HTMLImageElement) {
  const { x, y, w, h, side } = HEART_BOX
  const scale = logo.naturalWidth / side
  const cw = Math.round(w * scale)
  const ch = Math.round(h * scale)
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const g = out.getContext('2d', { willReadFrequently: true })!
  g.drawImage(logo, x * scale, y * scale, w * scale, h * scale, 0, 0, cw, ch)
  const data = g.getImageData(0, 0, cw, ch)
  const px = data.data
  // How much of the logo's black is over each pixel: nothing in the heart, all of it round it.
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]! / 255
    const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 765
    const ink = a * (1 - lum)
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
    px[i + 3] = Math.round((1 - ink) * 255)
  }
  g.putImageData(data, 0, 0)
  return out
}

function drawSky(g: CanvasRenderingContext2D) {
  const sky = g.createLinearGradient(0, 0, 0, SIZE)
  sky.addColorStop(0, '#2f6fd6')
  sky.addColorStop(0.62, '#7db8ef')
  sky.addColorStop(1, '#cfe9fb')
  g.fillStyle = sky
  g.fillRect(0, 0, SIZE, SIZE)
}

/** The white, in strokes from the middle outward, each a bundle of dry bristles along the same diagonal as the old paint. */
type Bristle = { x1: number; y1: number; x2: number; y2: number; width: number; alpha: number }
function brushStrokes(): Bristle[][] {
  let seed = 4242
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const centreX = SIZE / 2
  const centreY = LOGO_Y + LOGO / 2
  const strokes: Bristle[][] = []
  for (let i = 0; i < STROKES; i += 1) {
    const f = i / (STROKES - 1)
    const reach = Math.sqrt(f) * 158
    const around = rnd() * Math.PI * 2
    const x = centreX + Math.cos(around) * reach
    const y = centreY + Math.sin(around) * reach
    const angle = -0.85 + (rnd() - 0.5) * 0.7
    const long = 50 + rnd() * 62
    const wide = 16 + rnd() * 18
    const strength = 0.92 - f * 0.62
    const bristles: Bristle[] = []
    for (let b = 0; b < 9; b += 1) {
      const side = (b / 8 - 0.5) * wide
      const px = x - Math.sin(angle) * side
      const py = y + Math.cos(angle) * side
      const a = long * (0.32 + rnd() * 0.18)
      const z = long * (0.32 + rnd() * 0.18)
      bristles.push({
        x1: px - Math.cos(angle) * a,
        y1: py - Math.sin(angle) * a,
        x2: px + Math.cos(angle) * z,
        y2: py + Math.sin(angle) * z,
        width: 1.6 + rnd() * 3.2,
        alpha: strength * (0.45 + rnd() * 0.55),
      })
    }
    strokes.push(bristles)
  }
  return strokes
}

/** Paints only the strokes not yet down, onto a layer that keeps them, so the frame never redraws the lot. */
function makeBrush(ratio: number) {
  const layer = document.createElement('canvas')
  layer.width = SIZE * ratio
  layer.height = SIZE * ratio
  const g = layer.getContext('2d')!
  g.scale(ratio, ratio)
  g.lineCap = 'round'
  const strokes = brushStrokes()
  let done = 0
  return {
    layer,
    upTo(part: number) {
      const end = Math.round(part * strokes.length)
      for (; done < end; done += 1) {
        strokes[done]!.forEach((b) => {
          g.strokeStyle = `rgba(255, 255, 255, ${b.alpha})`
          g.lineWidth = b.width
          g.beginPath()
          g.moveTo(b.x1, b.y1)
          g.lineTo(b.x2, b.y2)
          g.stroke()
        })
      }
    },
  }
}

/** One pull of a wide, loaded brush: bristles side by side, each a line following the painting's own grain. */
type PaintStroke = { from: number; bristles: { points: [number, number][]; width: number; drawn: number }[] }
/** Each grain cell is this many scene pixels. */
const GRAIN_CELL = 4
const GRAIN_STEP = 4
/** Cells averaged round each: the broad run of the brushwork, not every fleck of paint. */
const GRAIN_RADIUS = 10

/** The painting's grain, framed as the menu frames it. */
function readGrain(art: HTMLImageElement) {
  const n = Math.round(SIZE / GRAIN_CELL)
  const small = document.createElement('canvas')
  small.width = n
  small.height = n
  const s = small.getContext('2d', { willReadFrequently: true })!
  const fit = n / Math.min(art.naturalWidth, art.naturalHeight)
  const w = art.naturalWidth * fit
  const h = art.naturalHeight * fit
  s.drawImage(art, (n - w) / 2, (n - h) / 2, w, h)
  const px = s.getImageData(0, 0, n, n).data
  const lum = new Float32Array(n * n)
  for (let i = 0; i < lum.length; i += 1) lum[i] = px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11
  return { field: grainField(lum, n, n, GRAIN_RADIUS), n }
}

function paintStrokes(art: HTMLImageElement): PaintStroke[] {
  const { field, n } = readGrain(art)
  let seed = 90210
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const across = Math.ceil(Math.sqrt(PAINT_STROKES))
  const down = Math.ceil(PAINT_STROKES / across)
  const spots: { x: number; y: number; order: number }[] = []
  for (let i = 0; i < PAINT_STROKES; i += 1) {
    const x = ((i % across) + rnd()) * (SIZE / across)
    const y = (Math.floor(i / across) + rnd()) * (SIZE / down)
    spots.push({ x, y, order: y + x * 0.45 + rnd() * 40 })
  }
  // Sketched from the top left on down.
  spots.sort((a, b) => a.order - b.order)
  const fieldAt = (x: number, y: number) => {
    const col = Math.max(0, Math.min(n - 1, Math.floor(x / GRAIN_CELL)))
    const row = Math.max(0, Math.min(n - 1, Math.floor(y / GRAIN_CELL)))
    return field[row * n + col]!
  }
  return spots.map((spot, i) => {
    // Every pull runs down the page, whichever way the grain's line is stored.
    const grain = fieldAt(spot.x, spot.y)
    const angle = Math.sin(grain) < 0 ? grain + Math.PI : grain
    const long = 90 + rnd() * 70
    const wide = 44 + rnd() * 26
    const count = 16
    const reach = Math.round(long / 2 / GRAIN_STEP)
    // Out each way along the grain from the stroke's middle, then joined up to run start to finish.
    const behind = traceGrain(field, n, n, GRAIN_CELL, spot.x, spot.y, angle + Math.PI, reach, GRAIN_STEP)
    const ahead = traceGrain(field, n, n, GRAIN_CELL, spot.x, spot.y, angle, reach, GRAIN_STEP)
    const spine = [...behind.reverse(), ...ahead.slice(1)]
    const bristles = []
    for (let b = 0; b < count; b += 1) {
      const side = (b / (count - 1) - 0.5) * wide
      // Bristles lift and land a little apart, which is what roughs up the two ends.
      const start = Math.floor(rnd() * 4)
      const stop = spine.length - Math.floor(rnd() * 4)
      bristles.push({
        points: besideLine(spine, side).slice(start, stop),
        width: (wide / count) * (1.1 + rnd() * 0.9),
        drawn: 0,
      })
    }
    return { from: PAINT_FROM + (i / (PAINT_STROKES - 1)) * (PAINT_DONE - PAINT_FROM - STROKE_S - 0.1), bristles }
  })
}

/** Which of the painting is down so far: a mask only ever added to, by each bristle's next stretch. */
function makePainter(ratio: number) {
  const side = SIZE * ratio
  const mask = document.createElement('canvas')
  mask.width = side
  mask.height = side
  const m = mask.getContext('2d')!
  m.scale(ratio, ratio)
  m.lineCap = 'round'
  m.lineJoin = 'round'
  m.strokeStyle = '#000'
  const out = document.createElement('canvas')
  out.width = side
  out.height = side
  const o = out.getContext('2d')!
  let strokes: PaintStroke[] | undefined
  return {
    /** The grain takes a moment to read, so it's done while the picture loads, not in the middle of the show. */
    prepare(art: HTMLImageElement) {
      strokes = strokes ?? paintStrokes(art)
    },
    draw(g: CanvasRenderingContext2D, t: number, art: HTMLImageElement) {
      strokes = strokes ?? paintStrokes(art)
      strokes.forEach((stroke) => {
        const reach = easeOut(clamp((t - stroke.from) / STROKE_S))
        if (!reach) return
        stroke.bristles.forEach((b) => {
          const end = Math.round(reach * (b.points.length - 1))
          if (end <= b.drawn) return
          m.lineWidth = b.width
          m.beginPath()
          m.moveTo(b.points[b.drawn]![0], b.points[b.drawn]![1])
          for (let i = b.drawn + 1; i <= end; i += 1) m.lineTo(b.points[i]![0], b.points[i]![1])
          m.stroke()
          b.drawn = end
        })
      })
      o.globalCompositeOperation = 'copy'
      o.drawImage(mask, 0, 0)
      o.globalCompositeOperation = 'source-in'
      // As CSS's "center / cover", so it lines up with the menu to the pixel.
      const fit = side / Math.min(art.naturalWidth, art.naturalHeight)
      const w = art.naturalWidth * fit
      const h = art.naturalHeight * fit
      o.drawImage(art, (side - w) / 2, (side - h) / 2, w, h)
      g.drawImage(out, 0, 0, SIZE, SIZE)
      // Whatever the bristles missed closes up at the very end.
      const close = clamp((t - (PAINT_DONE - 0.2)) / 0.2)
      if (close) {
        g.save()
        g.globalAlpha = close
        g.drawImage(art, (side - w) / 2 / ratio, (side - h) / 2 / ratio, w / ratio, h / ratio)
        g.restore()
      }
    },
  }
}

function drawFrame(
  g: CanvasRenderingContext2D,
  t: number,
  logo?: HTMLImageElement,
  heart?: HTMLCanvasElement,
  brush?: ReturnType<typeof makeBrush>,
  painter?: ReturnType<typeof makePainter>,
  art?: HTMLImageElement,
) {
  drawSky(g)
  if (brush) {
    // After the heart lands, or a white heart would vanish into it.
    brush.upTo(clamp((t - LAND) / (FACE_DONE + 0.3 - LAND)))
    g.drawImage(brush.layer, 0, 0, SIZE, SIZE)
  }
  if (!logo || !heart) return
  const unit = LOGO / HEART_BOX.side
  const hw = HEART_BOX.w * unit
  const hh = HEART_BOX.h * unit
  const homeX = LOGO_X + (HEART_BOX.x + HEART_BOX.w / 2) * unit
  const homeY = LOGO_Y + (HEART_BOX.y + HEART_BOX.h / 2) * unit
  const centreX = SIZE / 2
  const centreY = LOGO_Y + LOGO / 2

  let y = homeY
  let turn = 1
  if (t < LAND) {
    const f = clamp((t - 0.3) / (LAND - 0.3))
    y = -hh + (homeY + hh) * Math.min(1, f * f * 1.2)
    if (f > 0.84) y -= Math.abs(Math.sin((f - 0.84) * 19.6)) * 8
    // Three turns, slowing to face front exactly as it lands.
    turn = Math.cos((1 - easeOut(f)) * Math.PI * 6)
  }

  if (t >= LAND) {
    const grow = easeOut(clamp((t - LAND) / (INK_DONE - LAND)))
    g.fillStyle = '#000'
    g.beginPath()
    g.arc(
      homeX + (centreX - homeX) * grow,
      homeY + (centreY - homeY) * grow,
      hw * 0.62 + (LOGO / 2 - 1 - hw * 0.62) * grow,
      0,
      Math.PI * 2,
    )
    g.fill()
  }
  if (t >= INK_DONE) {
    g.save()
    g.globalAlpha = easeOut(clamp((t - INK_DONE) / (FACE_DONE - INK_DONE)))
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(centreX, centreY, LOGO / 2 - 1, 0, Math.PI * 2)
    g.fill()
    g.drawImage(logo, LOGO_X, LOGO_Y, LOGO, LOGO)
    g.restore()
  }
  if (t < FACE_DONE) {
    g.save()
    g.translate(homeX, y)
    g.scale(Math.max(0.03, Math.abs(turn)), 1)
    g.drawImage(heart, -hw / 2, -hh / 2, hw, hh)
    g.restore()
  }
  if (t >= 2.3) {
    g.save()
    g.globalAlpha = easeOut(clamp((t - 2.3) / 0.6))
    g.font = `26px ${TYPE}`
    g.textAlign = 'center'
    g.textBaseline = 'top'
    ;(g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '2px'
    g.fillStyle = '#0e2a63'
    g.fillText('miyamaker', SIZE / 2, NAME_TOP)
    g.restore()
  }
  if (t >= PAINT_FROM && painter && art?.complete && art.naturalWidth) painter.draw(g, t, art)
}

const Scene = styled.button`
  all: unset;
  position: absolute;
  inset: 0;
  display: block;
  cursor: pointer;
  background: #2f6fd6;
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`

export default function Boot({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const el = canvas.current
    if (!el) return undefined
    // Drawn at the screen's real pixels, so nothing is stretched.
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    el.width = SIZE * ratio
    el.height = SIZE * ratio
    const g = el.getContext('2d')
    g?.scale(ratio, ratio)
    if (g) {
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
    }
    const brush = makeBrush(ratio)
    const painter = makePainter(ratio)
    const art = new Image()
    art.onload = () => painter.prepare(art)
    art.src = paintSrc
    TYPE = window.getComputedStyle(el).fontFamily
    const logo = new Image()
    let heart: HTMLCanvasElement | undefined
    logo.onload = () => {
      heart = cutHeart(logo)
    }
    logo.src = logoSrc
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      logo.onload = () => {
        heart = cutHeart(logo)
        if (g) drawFrame(g, FACE_DONE + 0.6, logo, heart, brush)
      }
      const t = setTimeout(() => done.current(), 1500)
      return () => clearTimeout(t)
    }
    const stopChime = playChime(CHIME_AT)
    const began = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = (now - began) / 1000
      if (g) drawFrame(g, t, logo, heart, brush, painter, art)
      if (t * 1000 >= BOOT_MS) {
        done.current()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      stopChime()
    }
  }, [])

  return (
    <Scene type="button" aria-label="miyamaker. Press to skip." onClick={() => done.current()}>
      <canvas ref={canvas} />
    </Scene>
  )
}

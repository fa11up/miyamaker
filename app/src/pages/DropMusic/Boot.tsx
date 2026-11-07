import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import waterSkin from './skin/water.webp'

const Button = styled.button`
  all: unset;
  position: absolute;
  inset: 0;
  z-index: 40;
  display: block;
  cursor: progress;
  pointer-events: auto;
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`

const LANDED = 0.72
const MORPH_FROM = 2.05
const MORPH_DONE = 2.75
const REVEAL = 2.7
const END = 3.05
const METER = ['#2a6bff', '#27d3ff', '#b6ff3c', '#ffffff']
const BARS = 25
const MIRROR_RATIO = 0.5
const MIRROR_STEP = 2

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const part = (t: number, from: number, to: number) => clamp((t - from) / (to - from))
const easeOut = (v: number) => 1 - (1 - v) * (1 - v) * (1 - v)
const easeBoth = (v: number) => v * v * (3 - 2 * v)
const mix = (a: number, b: number, f: number) => a + (b - a) * f

type Box = { x: number; y: number; w: number; h: number }
const mixBox = (a: Box, b: Box, f: number): Box => ({
  x: mix(a.x, b.x, f),
  y: mix(a.y, b.y, f),
  w: mix(a.w, b.w, f),
  h: mix(a.h, b.h, f),
})

/** A blank canvas of this size in CSS pixels, with a context drawing in CSS pixels. */
function layer(w: number, h: number, ratio: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * ratio))
  canvas.height = Math.max(1, Math.round(h * ratio))
  const g = canvas.getContext('2d')!
  g.scale(ratio, ratio)
  return { canvas, g }
}

/** A cabinet in the studio's brushed silver, with its two cones. */
function drawSpeaker(g: CanvasRenderingContext2D, w: number, h: number) {
  const body = g.createLinearGradient(0, 0, 0, h)
  body.addColorStop(0, '#f7faff')
  body.addColorStop(0.48, '#d5ddec')
  body.addColorStop(0.52, '#bcc8de')
  body.addColorStop(1, '#e8edf7')
  g.fillStyle = body
  g.beginPath()
  g.roundRect(0.5, 0.5, w - 1, h - 1, 8)
  g.fill()
  g.strokeStyle = '#3b4a6e'
  g.lineWidth = 1
  g.stroke()
  const cone = (cy: number, r: number) => {
    const c = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, r)
    c.addColorStop(0, '#5d4d86')
    c.addColorStop(0.18, '#5d4d86')
    c.addColorStop(0.2, '#1b1430')
    c.addColorStop(0.46, '#1b1430')
    c.addColorStop(0.5, '#3b2f5c')
    c.addColorStop(0.6, '#3b2f5c')
    c.addColorStop(0.64, '#0d0a17')
    c.addColorStop(1, '#0d0a17')
    g.fillStyle = c
    g.beginPath()
    g.arc(w / 2, cy, r, 0, Math.PI * 2)
    g.fill()
  }
  cone(h * 0.27, w * 0.23)
  cone(h * 0.68, w * 0.35)
}

/**
 * Everything on the stage that doesn't change, drawn once: redrawing gradients and hundreds of meter cells every frame is
 * what made this stutter. Each frame only places these.
 */
function makeSprites(w: number, line: number, ratio: number) {
  const room = layer(w, line, ratio)
  const light = room.g.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, line) * 0.9)
  light.addColorStop(0, '#1b57d6')
  light.addColorStop(0.45, '#0a2a7a')
  light.addColorStop(1, '#02071c')
  room.g.fillStyle = light
  room.g.fillRect(0, 0, w, line)

  const beam = layer(w * 0.2, line, ratio)
  const fade = beam.g.createLinearGradient(0, 0, 0, line)
  fade.addColorStop(0, 'rgba(120, 200, 255, 0.22)')
  fade.addColorStop(1, 'rgba(120, 200, 255, 0)')
  beam.g.fillStyle = fade
  beam.g.beginPath()
  beam.g.moveTo(w * 0.1 - 6, 0)
  beam.g.lineTo(w * 0.1 + 6, 0)
  beam.g.lineTo(w * 0.2, line)
  beam.g.lineTo(0, line)
  beam.g.fill()

  const sw = Math.min(w * 0.14, 84)
  const sh = sw * 1.73
  // Twice over, as it's drawn smaller and larger on the way to the real speakers.
  const speaker = layer(sw, sh, ratio * 2)
  drawSpeaker(speaker.g, sw, sh)

  // One full bar of lit cells, from the floor up: each bar shows as much of it as its level.
  const tallest = line * 0.62
  const barW = (w * 0.54) / BARS - 2
  const meter = layer(barW, tallest, ratio)
  const lit = meter.g.createLinearGradient(0, tallest, 0, 0)
  METER.forEach((c, i) => lit.addColorStop([0, 0.5, 0.85, 1][i]!, c))
  meter.g.fillStyle = lit
  for (let y = tallest - 4; y > 0; y -= 6) meter.g.fillRect(0, y, barW, 4)

  return { room: room.canvas, beam: beam.canvas, speaker: speaker.canvas, meter: meter.canvas, sw, sh, tallest }
}
type Sprites = ReturnType<typeof makeSprites>

/** The stage: its light, beams, speakers and meter, in whatever box it has reached. */
function drawStage(
  g: CanvasRenderingContext2D,
  t: number,
  stage: Box,
  speakers: Box[],
  radius: number,
  speakersShown: number,
  art: Sprites,
  fullLine: number,
) {
  g.save()
  g.beginPath()
  if (radius) g.roundRect(stage.x, stage.y, stage.w, stage.h, radius)
  else g.rect(stage.x, stage.y, stage.w, stage.h)
  g.clip()
  g.drawImage(art.room, stage.x, stage.y, stage.w, stage.h)
  g.globalCompositeOperation = 'lighter'
  const bw = stage.w * 0.2
  ;[0.22, 0.5, 0.78].forEach((at, i) => {
    const sway = Math.sin(t * 1.4 + i * 2) * stage.w * 0.05
    g.save()
    // Leans from the top, so the beam swings from its lamp.
    g.transform(1, 0, sway / stage.h, 1, stage.x + stage.w * at - bw / 2 - (sway / stage.h) * stage.y, 0)
    g.drawImage(art.beam, 0, stage.y, bw, stage.h)
    g.restore()
  })
  g.globalCompositeOperation = 'source-over'

  // The meter, off the same ripple as the rings.
  const rise = easeOut(part(t, LANDED + 0.2, LANDED + 0.75))
  if (rise > 0) {
    const scale = stage.h / fullLine
    const span = stage.w * 0.54
    const step = span / BARS
    const base = stage.y + stage.h - 3
    const left = stage.x + stage.w / 2 - span / 2
    const fullH = art.tallest
    const px = art.meter.height / fullH
    for (let i = 0; i < BARS; i += 1) {
      const m = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
      const level = (1 - m * 0.72) * (0.55 + 0.45 * Math.abs(Math.sin(t * 6.5 + i * 1.3))) * rise
      const shown = fullH * level
      const x = left + i * step
      g.drawImage(
        art.meter,
        0,
        (fullH - shown) * px,
        art.meter.width,
        shown * px,
        x,
        base - shown * scale,
        step - 2,
        shown * scale,
      )
      g.fillStyle = '#ffffff'
      g.fillRect(x, base - shown * scale - 3, step - 2, 2)
    }
  }
  g.restore()
  if (speakersShown > 0) {
    g.save()
    g.globalAlpha *= speakersShown
    // A kick of the cones when the drop lands.
    const kick = t > LANDED && t < LANDED + 0.15 ? 1.5 : 0
    speakers.forEach((s) => g.drawImage(art.speaker, s.x - kick, s.y - kick, s.w + kick * 2, s.h + kick * 2))
    g.restore()
  }
}

/**
 * Drop Music's boot, in the app's own parts: one real drop falls into its water, the ripple rises into its level meter with
 * the whole stage mirrored on the surface. Then the stage draws in to the real panel's place, speakers to the real speakers
 * and the name to the real title, and the water goes clear to the app's own water behind it. Any press skips it.
 */
export default function StudioBoot({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const calls = useRef({ onReveal, onDone })
  calls.current = { onReveal, onDone }

  useEffect(() => {
    const el = canvas.current
    const g = el?.getContext('2d')
    const page = el?.parentElement?.parentElement
    if (!el || !g || !page) {
      calls.current.onDone()
      return undefined
    }
    // Sharp enough for something that's moving, at under half the pixels of a full retina canvas.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    const water = new Image()
    water.src = waterSkin
    let art: Sprites | undefined
    let artFor = ''
    // The stage again, at low resolution, to mirror on the water: ripples hide the softness.
    let mirror: ReturnType<typeof layer> | undefined
    let tile: CanvasPattern | null = null
    let depth: CanvasGradient | undefined

    const inPage = (node: Element | null): Box | undefined => {
      const r = node?.getBoundingClientRect()
      if (!r?.width) return undefined
      const o = page.getBoundingClientRect()
      return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }
    }

    let began = 0
    let frame = 0
    let revealed = false
    let waterReady = false
    let waited = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (document.querySelector('[data-boot]')) return
      // Starts once its water has decoded, so that isn't a stall in the middle.
      if (!waterReady) {
        waited ||= now
        if (!(water.complete && water.naturalWidth) && now - waited < 400) return
        waterReady = true
      }
      if (!began) began = now
      const t = (now - began) / 1000
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (!w || !h) return
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
        el.width = Math.round(w * ratio)
        el.height = Math.round(h * ratio)
      }
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      g.clearRect(0, 0, w, h)

      const line = Math.round(h * 0.6)
      const cx = w / 2
      const morph = easeBoth(part(t, MORPH_FROM, MORPH_DONE))
      const fullStage: Box = { x: 0, y: 0, w, h: line }
      const real = t >= MORPH_FROM ? inPage(page.querySelector('.stage')) : undefined
      const stage = real ? mixBox(fullStage, real, morph) : fullStage

      const key = `${w}x${line}`
      if (artFor !== key) {
        art = makeSprites(w, line, ratio)
        mirror = layer(w, line, MIRROR_RATIO)
        depth = g.createLinearGradient(0, line, 0, h)
        depth.addColorStop(0, 'rgba(2, 14, 50, 0.4)')
        depth.addColorStop(0.5, 'rgba(2, 14, 50, 0.12)')
        depth.addColorStop(1, 'rgba(2, 14, 50, 0.4)')
        artFor = key
      }
      const sprites = art!
      const { sw, sh } = sprites
      const wide = [
        { x: w * 0.08, y: line - sh + 4, w: sw, h: sh },
        { x: w * 0.92 - sw, y: line - sh + 4, w: sw, h: sh },
      ]
      const realSpeakers = t >= MORPH_FROM ? Array.from(page.querySelectorAll('[data-speaker]')).map(inPage) : []
      // Phones hide the real speakers, so there the scene's just fade.
      const speakers = wide.map((box, i) => {
        const to = realSpeakers[i]
        return to ? mixBox(box, to, morph) : box
      })
      const speakersShown = realSpeakers[0] || t < MORPH_FROM ? 1 : 1 - morph

      // The water goes clear in the morph, leaving the app's own behind it.
      const seen = 1 - morph
      if (seen > 0) {
        g.save()
        g.globalAlpha = seen
        g.fillStyle = '#125cc4'
        g.fillRect(0, 0, w, h)
        if (water.complete && water.naturalWidth) {
          const flat = 0.42
          g.save()
          g.beginPath()
          g.rect(0, line, w, h - line)
          g.clip()
          g.translate(-((t * 26) % 512), line)
          g.scale(1, flat)
          tile ||= g.createPattern(water, 'repeat')
          if (tile) {
            g.fillStyle = tile
            g.fillRect(0, 0, w + 1024, (h - line) / flat + 2)
          }
          g.restore()
        }
        g.fillStyle = depth!
        g.fillRect(0, line, w, h - line)

        // The stage mirrored on top of the water, each row pushed about by the surface and the rings.
        const back = mirror!
        back.g.clearRect(0, 0, w, line)
        drawStage(back.g, t, fullStage, wide, 0, 1, sprites, line)
        const rows = h - line
        const rippled = t > LANDED ? clamp(1 - (t - LANDED) * 0.5) : 0
        const srcH = Math.max(1, Math.round(MIRROR_STEP * MIRROR_RATIO))
        for (let y = 0; y < rows; y += MIRROR_STEP) {
          const far = y / rows
          const from = line - 1 - y * 1.25
          if (from < 0) break
          const push =
            Math.sin(y * 0.33 + t * 5) * (0.8 + far * 5) +
            Math.sin(y * 0.09 - t * 3) * (1 + far * 3) +
            Math.sin(y * 0.9 - t * 14) * 5 * rippled
          g.globalAlpha = seen * 0.72 * (1 - far) ** 1.4
          g.drawImage(
            back.canvas,
            0,
            Math.round(from * MIRROR_RATIO),
            back.canvas.width,
            srcH,
            push,
            line + y,
            w,
            MIRROR_STEP + 0.5,
          )
        }
        g.globalAlpha = seen
        g.fillStyle = 'rgba(220, 245, 255, 0.5)'
        g.fillRect(0, line, w, 1)

        // Rings on the surface: a bright crest and the dark trough behind it.
        for (let i = 0; i < 5; i += 1) {
          const d = t - LANDED - i * 0.13
          if (d > 0) {
            const rx = d * w * 0.3
            const fade = Math.max(0, 1 - d * 0.62) * seen
            const ry = rx * 0.17
            g.lineWidth = Math.max(1, 3 - d * 1.2)
            g.strokeStyle = `rgba(5, 25, 80, ${fade * 0.45})`
            g.beginPath()
            g.ellipse(cx, line + 14, rx, ry, 0, 0, Math.PI * 2)
            g.stroke()
            g.strokeStyle = `rgba(235, 250, 255, ${fade * 0.85})`
            g.beginPath()
            g.ellipse(cx, line + 12, rx, ry, 0, 0, Math.PI * 2)
            g.stroke()
          }
        }
        g.restore()
      }

      // The stage over it all, so it's what's left when the water clears.
      const outAlpha = 1 - part(t, REVEAL, END - 0.05)
      g.save()
      g.globalAlpha = outAlpha
      drawStage(g, t, stage, speakers, 14 * morph, speakersShown, sprites, line)
      g.restore()

      // The splash: a crown of droplets thrown up and falling back.
      const flung = t - LANDED
      if (flung > 0 && flung < 0.55) {
        for (let i = 0; i < 12; i += 1) {
          const dir = (i / 11 - 0.5) * 2.1
          const speed = 120 + (i % 3) * 50
          const x = cx + Math.sin(dir) * speed * flung
          const y = line + 12 - Math.cos(dir) * speed * 1.5 * flung + 520 * flung * flung
          if (y < line + 14) {
            g.fillStyle = 'rgba(225, 245, 255, 0.92)'
            g.beginPath()
            g.arc(x, y, 3 - (i % 3) * 0.7, 0, Math.PI * 2)
            g.fill()
          }
        }
      }

      // The drop: clear water, lit from above, stretching as it falls.
      const fall = part(t, 0.08, LANDED)
      if (fall < 1) {
        const y = -24 + (line + 36) * fall * fall
        const size = Math.max(12, Math.min(w, h) * 0.035)
        g.save()
        g.translate(cx, y)
        g.scale(1, 1 + fall * 0.35)
        const body = g.createRadialGradient(-size * 0.2, size * 0.15, size * 0.1, 0, size * 0.2, size * 1.1)
        body.addColorStop(0, 'rgba(230, 248, 255, 0.95)')
        body.addColorStop(0.5, 'rgba(90, 180, 255, 0.85)')
        body.addColorStop(1, 'rgba(10, 70, 190, 0.95)')
        g.fillStyle = body
        g.beginPath()
        g.moveTo(0, -size * 1.5)
        g.bezierCurveTo(size * 0.3, -size * 0.6, size, -size * 0.2, size, size * 0.3)
        g.arc(0, size * 0.3, size, 0, Math.PI)
        g.bezierCurveTo(-size, -size * 0.2, -size * 0.3, -size * 0.6, 0, -size * 1.5)
        g.fill()
        g.fillStyle = 'rgba(255, 255, 255, 0.95)'
        g.beginPath()
        g.ellipse(-size * 0.38, -size * 0.02, size * 0.14, size * 0.26, 0.4, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }

      // The name, in the app's chrome lettering, on its way to being the real title.
      const named = part(t, 1.45, 1.85) * outAlpha
      if (named > 0) {
        const title = t >= MORPH_FROM ? inPage(page.querySelector('h1')) : undefined
        const startSize = Math.min(44, w * 0.075)
        const size = title
          ? mix(startSize, parseFloat(getComputedStyle(page.querySelector('h1')!).fontSize), morph)
          : startSize
        g.font = `italic 400 ${size}px 'Revalia', 'W95FA', sans-serif`
        const textW = g.measureText('Drop Music').width
        const x = title ? mix(cx - textW / 2, title.x, morph) : cx - textW / 2
        const y = title ? mix(h * 0.82, title.y + title.h / 2, morph) : h * 0.82
        g.save()
        g.globalAlpha = named
        g.textBaseline = 'middle'
        const chrome = g.createLinearGradient(0, y - size / 2, 0, y + size / 2)
        chrome.addColorStop(0, '#ffffff')
        chrome.addColorStop(0.36, '#dfe8f7')
        chrome.addColorStop(0.49, '#5c74a8')
        chrome.addColorStop(0.53, '#ffffff')
        chrome.addColorStop(0.72, '#9fc4ff')
        chrome.addColorStop(1, '#2a6bff')
        g.fillStyle = 'rgba(2, 14, 50, 0.7)'
        g.fillText('Drop Music', x + 2, y + 2)
        g.fillStyle = chrome
        g.fillText('Drop Music', x, y)
        g.restore()
      }

      if (t >= REVEAL && !revealed) {
        revealed = true
        calls.current.onReveal()
      }
      if (t >= END) calls.current.onDone()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <Button type="button" aria-label="Drop Music is starting. Press to skip." data-testid="drop-boot" onClick={onDone}>
      <canvas ref={canvas} />
    </Button>
  )
}

import { createElement, useEffect } from 'react'
import { livePadMarks } from './audio/engine.js'
import { audioBank } from './model.js'

const COLS = 48
const peaks = new Map()

/** Min and max of the sample, 48 columns, cached until the pad's audio changes. */
export function waveColumns(index) {
  const entry = audioBank.get(index)
  const pcm = entry?.pcm
  if (!pcm?.length) return null
  const key = `${index}:${entry.rev}:${pcm.length}`
  const hit = peaks.get(key)
  if (hit) return hit
  const cols = new Float32Array(COLS * 2)
  const n = pcm.length
  for (let c = 0; c < COLS; c++) {
    const a = Math.floor((c * n) / COLS)
    const b = Math.max(a + 1, Math.floor(((c + 1) * n) / COLS))
    let lo = 0
    let hi = 0
    const step = Math.max(1, Math.floor((b - a) / 24))
    for (let i = a; i < b; i += step) {
      const s = pcm[i]
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
    cols[c * 2] = lo
    cols[c * 2 + 1] = hi
  }
  peaks.set(key, cols)
  if (peaks.size > 80) peaks.delete(peaks.keys().next().value)
  return cols
}

function paintOne(canvas, index, at) {
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, Math.floor(rect.width))
  const h = Math.max(1, Math.floor(rect.height))
  if (w < 2 || h < 2) return
  const dpr = window.devicePixelRatio || 1
  const bw = Math.floor(w * dpr)
  const bh = Math.floor(h * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const cols = waveColumns(index)
  const pcm = audioBank.get(index)?.pcm
  if (!cols || !pcm) return
  const mid = h * 0.5
  const amp = h * 0.42
  ctx.beginPath()
  for (let c = 0; c < COLS; c++) {
    const x = ((c + 0.5) * w) / COLS
    const y = mid - cols[c * 2 + 1] * amp
    if (c === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let c = COLS - 1; c >= 0; c--) {
    ctx.lineTo(((c + 0.5) * w) / COLS, mid - cols[c * 2] * amp)
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(36, 20, 63, 0.42)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#24143f'
  ctx.stroke()
  if (typeof at !== 'number') return
  const x = Math.max(1, Math.min(w - 1, at * w))
  ctx.beginPath()
  ctx.moveTo(x, 1)
  ctx.lineTo(x, h - 1)
  ctx.strokeStyle = '#3d2a6b'
  ctx.lineWidth = 1.5
  ctx.stroke()
  const centre = Math.floor(at * (pcm.length - 1))
  const win = 96
  ctx.beginPath()
  for (let i = 0; i < 64; i++) {
    const idx = centre - win / 2 + Math.floor((i * win) / 63)
    const s = pcm[Math.max(0, Math.min(pcm.length - 1, idx))] || 0
    const px = (i / 63) * w
    const py = mid - Math.max(-1, Math.min(1, s)) * amp
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.lineWidth = 2.25
  ctx.strokeStyle = '#24143f'
  ctx.stroke()
  ctx.lineWidth = 1.25
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
}

/** Draw the sample on every loaded pad. A hit rides that picture; the colour follows the level. */
export function paintPadWaves() {
  const root = document.querySelector('[data-miya-music]')?.shadowRoot
  if (!root) return
  const marks = livePadMarks()
  const hot = new Map()
  for (const mark of marks) hot.set(mark.pad, mark)
  root.querySelectorAll('canvas.pad-wave').forEach((canvas) => {
    const index = Number(canvas.dataset.pad)
    const btn = canvas.closest('.pad')
    const mark = hot.get(index)
    const level = mark ? mark.level : 0
    if (btn) {
      btn.style.setProperty('--hit', level.toFixed(3))
      btn.style.zIndex = level > 0.04 ? '2' : '0'
    }
    const entry = audioBank.get(index)
    if (!entry?.pcm?.length) {
      if (canvas.dataset.stamp || canvas.style.opacity !== '0') {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        delete canvas.dataset.stamp
        canvas.style.opacity = '0'
      }
      return
    }
    // The pad button's class is rewritten on every tap. Inline opacity stays, so the picture does not vanish.
    canvas.style.opacity = '1'
    const moving = !!mark && level > 0.03
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const stamp = `${entry.rev}:${entry.pcm.length}:${Math.round(rect.width)}x${Math.round(rect.height)}`
    if (!moving && canvas.dataset.stamp === stamp) return
    paintOne(canvas, index, moving ? mark.at : null)
    if (!moving) canvas.dataset.stamp = stamp
    else delete canvas.dataset.stamp
  })
}

/** Keep the pad pictures in step with the voices while this screen is open. */
export function usePadVis() {
  useEffect(() => {
    let raf = 0
    let alive = true
    const tick = () => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      const root = document.querySelector('[data-miya-music]')?.shadowRoot
      const canvases = root?.querySelectorAll('canvas.pad-wave')
      if (!canvases?.length) return
      let visible = false
      for (const canvas of canvases) {
        const box = canvas.getBoundingClientRect()
        if (box.width >= 2 && box.height >= 2) {
          visible = true
          break
        }
      }
      if (!visible) return
      paintPadWaves()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])
}

export function PadWave({ index }) {
  return createElement('canvas', {
    className: 'pad-wave',
    'data-pad': index,
    'aria-hidden': true,
  })
}

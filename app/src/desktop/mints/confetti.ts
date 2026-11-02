/* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop, no-plusplus -- bounded, sequential RPC/parse loops read clearer as loops */
/**
 * Tiny canvas confetti: one fixed, click-through canvas created on first use, a particle list,
 * and a rAF loop that only runs while particles are alive. No dependency.
 */

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  color: string
  shape: 'rect' | 'star' | 'heart'
  life: number
  ttl: number
}

const COLORS = ['#d97ada', '#f5c6f6', '#a9a3c9', '#ffffff', '#8f5fd0', '#ffe27a', '#9fe3ff']
const GRAVITY = 900

let canvas: HTMLCanvasElement | undefined
let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let raf = 0
let last = 0

function resize() {
  if (!canvas || !ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function ensureCanvas() {
  if (canvas && document.body.contains(canvas)) return
  canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.confetti = ''
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147482000',
  })
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
  resize()
  window.addEventListener('resize', resize)
}

function drawStar(c: CanvasRenderingContext2D, r: number) {
  c.beginPath()
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.4 : r
    const a = (i * Math.PI) / 4
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }

  c.closePath()
  c.fill()
}

function drawHeart(c: CanvasRenderingContext2D, r: number) {
  // pixel heart, 5x4 cells
  const cell = Math.max(1, Math.round(r / 2.5))
  const rows = ['01010', '11111', '01110', '00100']
  rows.forEach((row, y) =>
    row.split('').forEach((on, x) => on === '1' && c.fillRect((x - 2.5) * cell, (y - 2) * cell, cell, cell))
  )
}

function tick(now: number) {
  if (!ctx || !canvas) return
  const dt = Math.min(now - last, 50) / 1000
  last = now
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  particles.forEach((p) => {
    p.life += dt
  })
  particles = particles.filter((p) => p.life < p.ttl && p.y < window.innerHeight + 40)
  for (const p of particles) {
    p.vy += GRAVITY * dt * (p.shape === 'rect' ? 0.55 : 0.35)
    p.vx *= 1 - 0.9 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot += p.vr * dt
    ctx.save()
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl) ** 0.6
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    ctx.fillStyle = p.color
    if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
    else if (p.shape === 'star') drawStar(ctx, p.size / 2)
    else drawHeart(ctx, p.size / 2)
    ctx.restore()
  }

  if (particles.length) raf = requestAnimationFrame(tick)
  else {
    raf = 0
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Fire a burst. `angle` is the launch direction in degrees (0 = right, -90 = up), `spread` the cone.
 * Does nothing under prefers-reduced-motion.
 */
export function burst({
  x,
  y,
  count = 60,
  power = 700,
  angle = -90,
  spread = 70,
}: {
  x: number
  y: number
  count?: number
  power?: number
  angle?: number
  spread?: number
}) {
  if (prefersReducedMotion() || typeof document === 'undefined') return
  ensureCanvas()
  const cap = 600 - particles.length
  for (let i = 0; i < Math.min(count, cap); i++) {
    const a = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180
    const v = power * (0.45 + Math.random() * 0.65)
    const r = Math.random()
    particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      size: 6 + Math.random() * 7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      shape: r < 0.6 ? 'rect' : r < 0.85 ? 'star' : 'heart',
      life: 0,
      ttl: 1.6 + Math.random() * 1.4,
    })
  }

  if (!raf) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

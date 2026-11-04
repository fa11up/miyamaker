// The share card's toy: a doll surfing waves. No dependencies, so it loads fast inside a tweet.
;(() => {
  const canvas = document.getElementById('sea')
  const ctx = canvas.getContext('2d')
  const flipsEl = document.getElementById('flips')
  const hint = document.getElementById('hint')
  const still = location.hash === '#still' // what the share image is captured from
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

  const doll = new Image()
  doll.src = './fumo.png'

  const COLUMNS = 120
  const GRAVITY = 1500 // px/s²
  const JUMP = 640 // px/s
  const heights = new Float32Array(COLUMNS)
  const speeds = new Float32Array(COLUMNS)
  const foam = []

  let width = 0
  let height = 0
  let dollHeight = 0
  let time = 0
  let last = 0
  let flips = 0
  const me = { x: 0, y: 0, vx: 90, vy: 0, angle: 0, spun: 0, state: 'riding' }
  let pointer = null

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    width = innerWidth
    height = innerHeight
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    dollHeight = Math.min(height * 0.36, width * 0.34, 190)
    if (!me.x) me.x = width * 0.42
  }

  const sea = () => height * 0.66
  const swell = () => (calm ? 0.45 : 1) * Math.min(height * 0.075, 46)

  /** The rolling base of the sea, plus any ripples the player has made. */
  function surface(x, layer = 0) {
    const u = x / Math.max(width, 1)
    const t = time * (calm ? 0.35 : 1)
    const a = swell()
    let y =
      sea() +
      Math.sin(u * 7.5 - t * 1.25 + layer * 1.7) * a +
      Math.sin(u * 15 - t * 2.1 + layer * 0.6) * a * 0.32 +
      Math.sin(u * 3.1 - t * 0.55) * a * 0.55
    if (layer === 0) {
      const p = (((x % width) + width) % width) / width * (COLUMNS - 1)
      const i = Math.floor(p)
      const j = Math.min(i + 1, COLUMNS - 1)
      y += heights[i] + (heights[j] - heights[i]) * (p - i)
    }
    return y
  }

  function poke(x, force) {
    const c = Math.round((((x % width) + width) % width) / width * (COLUMNS - 1))
    for (let i = -3; i <= 3; i += 1) {
      const n = c + i
      if (n >= 0 && n < COLUMNS) speeds[n] += force * (1 - Math.abs(i) / 4)
    }
  }

  function splash(x, y, amount) {
    if (calm) return
    for (let i = 0; i < amount; i += 1) {
      foam.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 260,
        vy: -60 - Math.random() * 240,
        life: 0.5 + Math.random() * 0.5,
        size: 2 + Math.floor(Math.random() * 3),
      })
    }
    if (foam.length > 200) foam.splice(0, foam.length - 200)
  }

  function jump() {
    if (me.state !== 'riding') return
    me.state = 'air'
    me.vy = -JUMP
    me.spun = 0
    me.spin = (me.vx >= 0 ? 1 : -1) * 8.5
    poke(me.x, 240)
    splash(me.x, me.y, 10)
  }

  function land() {
    me.state = 'riding'
    if (Math.abs(me.spun) >= Math.PI * 1.4) {
      flips += Math.max(1, Math.round(Math.abs(me.spun) / (Math.PI * 2)))
      flipsEl.textContent = `${flips} flip${flips === 1 ? '' : 's'}`
    }
    poke(me.x, Math.min(Math.abs(me.vy) * 0.75, 620))
    splash(me.x, me.y, Math.min(24, 6 + Math.abs(me.vy) / 40))
    me.vy = 0
    me.spun = 0
  }

  function stepWater(dt) {
    const steps = 2
    const h = dt / steps
    for (let s = 0; s < steps; s += 1) {
      for (let i = 0; i < COLUMNS; i += 1) {
        const left = heights[i === 0 ? COLUMNS - 1 : i - 1]
        const right = heights[i === COLUMNS - 1 ? 0 : i + 1]
        const pull = (left + right - 2 * heights[i]) * 1500 - heights[i] * 14
        speeds[i] = (speeds[i] + pull * h) * (1 - 1.1 * h)
      }
      for (let i = 0; i < COLUMNS; i += 1) heights[i] += speeds[i] * h
    }
  }

  let stepDoll = (dt) => {
    if (me.state === 'held') {
      me.vx = (pointer.x - me.x) / Math.max(dt, 0.008)
      me.vy = (pointer.y - me.y) / Math.max(dt, 0.008)
      me.x = pointer.x
      me.y = pointer.y
      me.angle *= 1 - Math.min(1, dt * 8)
      return
    }

    if (me.state === 'air') {
      me.vy += GRAVITY * dt
      me.x += me.vx * dt
      me.y += me.vy * dt
      const turn = me.spin * dt
      me.angle += turn
      me.spun += turn
      me.vx *= 1 - 0.25 * dt
      if (me.y >= surface(me.x) && me.vy > 0) land()
    } else {
      const slope = (surface(me.x + 6) - surface(me.x - 6)) / 12
      // Downhill speeds her up, and the swell keeps pushing her along.
      me.vx += (slope * GRAVITY * 0.55 + 70) * dt
      me.vx *= 1 - 0.55 * dt
      me.vx = Math.max(-520, Math.min(520, me.vx))
      me.x += me.vx * dt
      me.y = surface(me.x)
      const target = Math.atan(slope) * 0.9
      // Unwind any leftover spin the short way round.
      const wrapped = Math.atan2(Math.sin(me.angle), Math.cos(me.angle))
      me.angle = wrapped + (target - wrapped) * Math.min(1, dt * 9)
      if (Math.abs(me.vx) > 120 && Math.random() < dt * 22) splash(me.x - Math.sign(me.vx) * 24, me.y, 1)
    }

    const margin = dollHeight * 0.5
    if (me.x > width + margin) me.x = -margin
    if (me.x < -margin) me.x = width + margin
  }

  function stepFoam(dt) {
    for (let i = foam.length - 1; i >= 0; i -= 1) {
      const f = foam[i]
      f.vy += GRAVITY * 0.6 * dt
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.life -= dt
      if (f.life <= 0) foam.splice(i, 1)
    }
  }

  function drawWave(layer, fill, crest) {
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, surface(x, layer) - layer * height * 0.055)
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.beginPath()
    for (let x = 0; x <= width + 8; x += 8) {
      const y = surface(x, layer) - layer * height * 0.055
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = crest
    ctx.lineWidth = layer === 0 ? 3 : 2
    ctx.stroke()
  }

  function drawDoll() {
    const h = dollHeight
    const w = doll.naturalWidth ? h * (doll.naturalWidth / doll.naturalHeight) : h * 0.6
    ctx.save()
    ctx.translate(me.x, me.y)
    ctx.rotate(me.angle)
    // Board
    const board = w * 1.25
    ctx.fillStyle = '#d979d6'
    ctx.strokeStyle = '#2c2547'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(0, -2, board / 2, Math.max(5, h * 0.035), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.fillRect(-board * 0.28, -3, board * 0.56, 2)
    if (doll.complete && doll.naturalWidth) ctx.drawImage(doll, -w / 2, -h - 3, w, h)
    ctx.restore()
  }

  function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, '#6f6894')
    sky.addColorStop(0.62, '#a9a3c9')
    sky.addColorStop(1, '#e6c9ee')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    drawWave(2, 'rgb(217 121 214 / 30%)', 'rgb(255 255 255 / 30%)')
    drawWave(1, 'rgb(111 104 148 / 60%)', 'rgb(255 255 255 / 40%)')
    drawWave(0, 'rgb(62 52 105 / 88%)', '#ffffff')
    drawDoll()

    ctx.fillStyle = '#fff'
    for (const f of foam) ctx.fillRect(f.x, f.y, f.size, f.size)
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0, 1 / 30)
    last = now
    time += dt
    stepWater(dt)
    stepDoll(dt)
    stepFoam(dt)
    draw()
    if (!document.hidden) requestAnimationFrame(frame)
  }

  function grabbing(x, y) {
    const w = dollHeight * 0.45
    return Math.abs(x - me.x) < w && y < me.y + 10 && y > me.y - dollHeight - 10
  }

  function dismissHint() {
    hint.classList.add('hidden')
  }

  canvas.addEventListener('pointerdown', (e) => {
    dismissHint()
    canvas.focus({ preventScroll: true })
    canvas.setPointerCapture(e.pointerId)
    pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, at: performance.now() }
    if (grabbing(e.clientX, e.clientY)) {
      pointer.onDoll = true
      pointer.state = me.state
    } else if (e.clientY > surface(e.clientX) - 30) {
      poke(e.clientX, 520)
      splash(e.clientX, surface(e.clientX), 8)
    } else {
      jump()
    }
  })

  canvas.addEventListener('pointermove', (e) => {
    if (!pointer) return
    pointer.x = e.clientX
    pointer.y = e.clientY
    if (pointer.onDoll && me.state !== 'held' && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 8) {
      me.state = 'held'
      canvas.classList.add('held')
    }
  })

  function release() {
    if (!pointer) return
    if (me.state === 'held') {
      me.state = 'air'
      me.vx = Math.max(-1400, Math.min(1400, me.vx))
      me.vy = Math.max(-1500, Math.min(1500, me.vy))
      me.spun = 0
      me.spin = Math.max(-16, Math.min(16, me.vx / 70)) || 4
      canvas.classList.remove('held')
    } else if (pointer.onDoll) {
      jump()
    }
    pointer = null
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)

  addEventListener('keydown', (e) => {
    if (e.target !== canvas && e.target !== document.body) return
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault()
      dismissHint()
      jump()
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault()
      dismissHint()
      me.vx += e.code === 'ArrowLeft' ? -90 : 90
    }
  })

  addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      last = performance.now()
      requestAnimationFrame(frame)
    }
  })

  resize()
  if (still) {
    document.body.classList.add('still')
    dismissHint()
    me.x = width * 0.62
    me.vx = 0
    stepDoll = () => {
      me.y = surface(me.x)
      me.angle = Math.atan((surface(me.x + 6) - surface(me.x - 6)) / 12) * 0.9
    }
  }
  requestAnimationFrame((now) => {
    last = now
    frame(now)
  })
})()

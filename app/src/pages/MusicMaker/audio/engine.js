import { limitStereo } from './limiter.js'
import { encodeWav, trimSilence } from './wav.js'
import { evenSlices } from './slice.js'
import { workletSource } from './numpadFx.js'
import { cachePcm, ensureLibrary } from '../media/library.js'
import { allowedMediaUrl } from '../media/allow.js'
import { audioBank, model, currentSequence, stepCount, writeEvent, touch, rememberSample } from '../model.js'

const busNodes = []
let ctx = null
let master = null
let limiter = null
let limiterReady = false
let numpadFx = null
let analyser = null
let meterAnalysers = []
let reverbBuffer = null
let voices = []
let patternVoices = []
let held = new Map()
let timer = 0
let nextTime = 0
let nextStep = 0
let origin = 0
let started = false
const meters = { bus: [0, 0, 0, 0], master: 0, gr: 0 }
let meterTimer = 0
let recording = null

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

export function getMeters() {
  return meters
}

export async function resume() {
  await ensure()
  if (ctx.state !== 'running') await ctx.resume()
}

async function ensure() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  ctx = new AC()
  master = ctx.createGain()
  master.channelCount = 2
  master.channelCountMode = 'explicit'
  master.gain.value = model.master
  analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.6
  try {
    await ctx.audioWorklet.addModule('/worklets/limiter.js')
    limiter = new AudioWorkletNode(ctx, 'miya-limiter', { outputChannelCount: [2] })
    limiter.port.onmessage = (e) => {
      if (e.data && typeof e.data.gr === 'number') meters.gr = e.data.gr
    }
    limiterReady = true
  } catch (err) {
    console.warn('limiter worklet failed, hard clip fallback', err)
    limiter = hardClip(ctx)
    limiterReady = false
  }
  try {
    const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    numpadFx = new AudioWorkletNode(ctx, 'miya-numpad-fx', { outputChannelCount: [2], numberOfInputs: 1, numberOfOutputs: 1 })
    numpadFx.channelCount = 2
    numpadFx.channelCountMode = 'explicit'
  } catch (err) {
    console.warn('numpad fx worklet failed', err)
    numpadFx = null
  }
  if (numpadFx) {
    master.connect(numpadFx)
    numpadFx.connect(limiter)
    pushNumpadFx()
  } else {
    master.connect(limiter)
  }
  limiter.connect(analyser)
  analyser.connect(ctx.destination)
  for (let i = 0; i < 4; i++) busNodes.push(makeBus(ctx, master))
  syncMixer(true)
  window.clearInterval(meterTimer)
  meterTimer = window.setInterval(readMeters, 80)
  return ctx
}

function hardClip(context) {
  const shaper = context.createWaveShaper()
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = clamp(x, -1, 1)
  }
  shaper.curve = curve
  shaper.channelCount = 2
  return shaper
}

function impulse(context) {
  if (reverbBuffer && reverbBuffer.sampleRate === context.sampleRate) return reverbBuffer
  const seconds = 1.6
  const len = Math.floor(context.sampleRate * seconds)
  const buf = context.createBuffer(2, len, context.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      const t = i / len
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (c === 0 ? 1 : 0.85)
    }
  }
  reverbBuffer = buf
  return buf
}

function curveDrive(amount) {
  const curve = new Float32Array(1024)
  const k = 1 + amount * 14
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k)
  }
  return curve
}

function curveCrush(amount) {
  const curve = new Float32Array(1024)
  const bits = Math.max(2, Math.round(12 - amount * 8))
  const steps = 2 ** bits
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
}

function makeFx(context, type) {
  if (!type || type === 'none') {
    const g = context.createGain()
    return { input: g, output: g, update() {}, stop() {} }
  }
  if (type === 'filter') {
    const f = context.createBiquadFilter()
    f.type = 'lowpass'
    return {
      input: f,
      output: f,
      update(amount) {
        f.frequency.value = 180 + amount * 9000
        f.Q.value = 0.7 + amount * 4
      },
      stop() {},
    }
  }
  if (type === 'drive') {
    const s = context.createWaveShaper()
    return {
      input: s,
      output: s,
      update(amount) {
        s.curve = curveDrive(Math.max(0.05, amount))
      },
      stop() {},
    }
  }
  if (type === 'crush') {
    const s = context.createWaveShaper()
    return {
      input: s,
      output: s,
      update(amount) {
        s.curve = curveCrush(amount)
      },
      stop() {},
    }
  }
  if (type === 'comp') {
    const c = context.createDynamicsCompressor()
    return {
      input: c,
      output: c,
      update(amount) {
        c.threshold.value = -28 + amount * 10
        c.ratio.value = 2 + amount * 8
        c.attack.value = 0.003
        c.release.value = 0.18
        c.knee.value = 8
      },
      stop() {},
    }
  }
  if (type === 'delay') {
    const input = context.createGain()
    const delay = context.createDelay(1.2)
    const fb = context.createGain()
    const wet = context.createGain()
    const dry = context.createGain()
    const out = context.createGain()
    const tone = context.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 3500
    input.connect(dry)
    dry.connect(out)
    input.connect(delay)
    delay.connect(tone)
    tone.connect(fb)
    fb.connect(delay)
    tone.connect(wet)
    wet.connect(out)
    return {
      input,
      output: out,
      update(amount) {
        const step = 60 / Math.max(40, model.bpm) / 4
        delay.delayTime.value = clamp(step * (1 + Math.round(amount * 6)), 0.04, 0.8)
        fb.gain.value = 0.18 + amount * 0.55
        wet.gain.value = 0.15 + amount * 0.6
        dry.gain.value = 1 - amount * 0.35
      },
      stop() {},
    }
  }
  if (type === 'reverb') {
    const input = context.createGain()
    const conv = context.createConvolver()
    conv.buffer = impulse(context)
    const wet = context.createGain()
    const dry = context.createGain()
    const out = context.createGain()
    input.connect(dry)
    dry.connect(out)
    input.connect(conv)
    conv.connect(wet)
    wet.connect(out)
    return {
      input,
      output: out,
      update(amount) {
        wet.gain.value = amount * 0.85
        dry.gain.value = 1 - amount * 0.4
      },
      stop() {},
    }
  }
  if (type === 'chorus') {
    const input = context.createGain()
    const delay = context.createDelay(0.08)
    const lfo = context.createOscillator()
    const depth = context.createGain()
    const wet = context.createGain()
    const dry = context.createGain()
    const out = context.createGain()
    delay.delayTime.value = 0.018
    lfo.frequency.value = 0.35
    lfo.connect(depth)
    depth.connect(delay.delayTime)
    input.connect(dry)
    dry.connect(out)
    input.connect(delay)
    delay.connect(wet)
    wet.connect(out)
    lfo.start()
    return {
      input,
      output: out,
      update(amount) {
        depth.gain.value = 0.002 + amount * 0.008
        wet.gain.value = 0.2 + amount * 0.5
        lfo.frequency.value = 0.2 + amount * 1.4
      },
      stop() {
        try {
          lfo.stop()
        } catch {
          /* already stopped */
        }
      },
    }
  }
  const g = context.createGain()
  return { input: g, output: g, update() {}, stop() {} }
}

function makeBus(context, dest) {
  const input = context.createGain()
  const fader = context.createGain()
  const panner = context.createStereoPanner()
  const meter = context.createAnalyser()
  meter.fftSize = 256
  input.connect(fader)
  fader.connect(panner)
  panner.connect(meter)
  meter.connect(dest)
  return { input, fader, panner, meter, fx: [], sig: '' }
}

function connectChain(bus, context) {
  bus.fx.forEach((fx) => {
    fx.stop()
    try {
      fx.output.disconnect()
    } catch {
      /* already free */
    }
  })
  try {
    bus.input.disconnect()
  } catch {
    /* first connect */
  }
  const spec = model.buses.map((b) => b.fx.map((s) => s.type).join('.')).join('|')
  const index = busNodes.indexOf(bus)
  const types = model.buses[index].fx.map((s) => s.type)
  const nodes = types.map((type) => makeFx(context, type))
  let prev = bus.input
  nodes.forEach((node) => {
    prev.connect(node.input)
    prev = node.output
  })
  prev.connect(bus.fader)
  bus.fx = nodes
  bus.sig = spec
}

export function syncMixer(force = false) {
  if (!ctx) return
  master.gain.value = model.master
  const sig = model.buses.map((b) => b.fx.map((s) => s.type).join('.')).join('|')
  const anySolo = model.buses.some((b) => b.solo)
  model.buses.forEach((b, i) => {
    const node = busNodes[i]
    if (force || node.sig !== sig) connectChain(node, ctx)
    node.fx.forEach((fx, slot) => fx.update(b.fx[slot].amount))
    const audible = !b.mute && (!anySolo || b.solo)
    node.fader.gain.value = audible ? b.volume : 0
    node.panner.pan.value = clamp(b.pan, -1, 1)
  })
}

function readMeters() {
  if (!ctx) return
  const buf = new Float32Array(128)
  busNodes.forEach((b, i) => {
    b.meter.getFloatTimeDomainData(buf)
    let p = 0
    for (let s = 0; s < buf.length; s++) p = Math.max(p, Math.abs(buf[s]))
    meters.bus[i] = p
  })
  analyser.getFloatTimeDomainData(buf)
  let p = 0
  for (let s = 0; s < buf.length; s++) p = Math.max(p, Math.abs(buf[s]))
  meters.master = p
}

function padAudible(pad) {
  if (!pad || pad.mute) return false
  const any = model.pads.some((p) => p.solo)
  if (any && !pad.solo) return false
  return true
}

function getEntry(index) {
  return audioBank.get(index) || null
}

function makeBuffer(context, entry, reverse) {
  const pcm = entry.pcm
  const buffer = context.createBuffer(1, pcm.length, entry.sr || 44100)
  const ch = buffer.getChannelData(0)
  if (reverse) {
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[pcm.length - 1 - i]
  } else ch.set(pcm)
  return buffer
}

function shaper(context, kind, amount) {
  const s = context.createWaveShaper()
  s.curve = kind === 'crush' ? curveCrush(amount) : curveDrive(amount)
  return s
}

function choke(group, when) {
  if (!group) return
  voices.forEach((v) => {
    if (v.choke === group && !v.dead) silence(v, when, 0.012)
  })
}

function silence(v, when, seconds) {
  if (v.dead) return
  v.dead = true
  const t = Math.max(when, ctx.currentTime)
  try {
    v.amp.gain.cancelScheduledValues(t)
    v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), t)
    v.amp.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    v.src.stop(t + seconds + 0.02)
  } catch {
    /* node already ended */
  }
}

export function releaseHeld(id) {
  const v = held.get(id)
  if (!v) return
  held.delete(id)
  if (!ctx || v.dead) return
  const pad = model.pads[v.pad]
  if (!pad || pad.mode === 'oneshot') return
  const t = ctx.currentTime
  const rel = Math.max(0.02, pad.amp.r || 0.08)
  try {
    v.amp.gain.cancelScheduledValues(t)
    v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), t)
    v.amp.gain.exponentialRampToValueAtTime(0.0001, t + rel)
    v.filter.frequency.cancelScheduledValues(t)
    v.filter.frequency.exponentialRampToValueAtTime(clamp(pad.filter.cutoff, 40, 18000), t + rel)
    v.src.stop(t + rel + 0.03)
  } catch {
    /* ended */
  }
  v.dead = true
}

export function playPad(index, velocity = 0.9, when = 0, opts = {}) {
  const pad = model.pads[index]
  if (!pad || pad.source === 'empty') return
  if (!padAudible(pad) && !opts.ignoreMute) return
  if (!ctx) {
    resume().then(() => playPad(index, velocity, 0, opts))
    return
  }
  const entry = getEntry(index)
  if (!entry || !entry.pcm) return
  const t = when || ctx.currentTime
  if (pad.choke) choke(pad.choke, t)
  const src = ctx.createBufferSource()
  src.buffer = makeBuffer(ctx, entry, pad.reverse)
  const semi = (pad.pitch || 0) + (opts.pitch || 0) + (pad.fine || 0) / 100
  src.playbackRate.value = Math.pow(2, semi / 12)

  const filter = ctx.createBiquadFilter()
  filter.type = pad.filter.type || 'lowpass'
  filter.Q.value = clamp(pad.filter.q || 0.7, 0.1, 18)
  const amp = ctx.createGain()
  const pan = ctx.createStereoPanner()
  pan.pan.value = clamp(pad.pan || 0, -1, 1)

  let node = src
  if (pad.fx.drive > 0.01) {
    const d = shaper(ctx, 'drive', pad.fx.drive)
    node.connect(d)
    node = d
  }
  if (pad.fx.crush > 0.01) {
    const c = shaper(ctx, 'crush', pad.fx.crush)
    node.connect(c)
    node = c
  }
  node.connect(filter)
  filter.connect(amp)
  amp.connect(pan)
  pan.connect(busNodes[pad.bus]?.input || master)

  const dur = src.buffer.duration / src.playbackRate.value
  const offset = clamp(pad.trimStart, 0, 0.99) * src.buffer.duration
  const end = clamp(pad.trimEnd, pad.trimStart + 0.01, 1) * src.buffer.duration
  const region = Math.max(0.01, end - offset)
  const regionDur = region / src.playbackRate.value
  const vel = clamp(velocity, 0, 1) * pad.volume

  const base = clamp(pad.filter.cutoff, 40, 18000)
  const peak = clamp(base * Math.pow(2, (pad.filter.env || 0) / 12), 40, 18000)
  const susHz = clamp(base + (peak - base) * pad.filter.s, 40, 18000)
  filter.frequency.setValueAtTime(base, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, peak), t + Math.max(0.001, pad.filter.a))
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(40, susHz),
    t + Math.max(0.002, pad.filter.a + pad.filter.d),
  )

  const envTotal = pad.mode === 'oneshot' ? regionDur : Math.max(regionDur, 8)
  scheduleAmp(amp, pad.amp, vel, t, envTotal)

  if (pad.mode === 'loop') {
    src.loop = true
    src.loopStart = offset
    src.loopEnd = end
    src.start(t, offset)
  } else if (pad.mode === 'gate') {
    src.start(t, offset)
  } else {
    src.start(t, offset, region)
    src.stop(t + regionDur + 0.02)
  }

  const voice = { src, amp, filter, choke: pad.choke, pad: index, dead: false, pattern: !!opts.pattern }
  voices.push(voice)
  if (voices.length > 48) voices = voices.filter((v) => !v.dead)
  if (opts.pattern) patternVoices.push(voice)
  if (opts.holdId) held.set(opts.holdId, voice)
  src.onended = () => {
    voice.dead = true
  }
  flash(index)
  if (model.recording && model.playing && !opts.fromSeq && opts.pitch == null) {
    const hit = locateHit(t)
    if (hit) writeEvent(index, hit.step, velocity, 0, hit.nudge)
  }
}

function scheduleAmp(amp, env, vel, t, total) {
  const a = Math.max(0.001, env.a || 0.001)
  const d = Math.max(0.001, env.d || 0.001)
  const s = clamp(env.s ?? 1, 0, 1)
  const r = Math.max(0.005, env.r || 0.02)
  const peak = Math.max(0.0001, vel)
  const sus = Math.max(0.0001, vel * s)
  const g = amp.gain
  g.cancelScheduledValues(t)
  g.setValueAtTime(0.0001, t)
  g.exponentialRampToValueAtTime(peak, t + a)
  g.exponentialRampToValueAtTime(sus, t + a + d)
  const relAt = Math.max(t + a + d, t + total - r)
  g.setValueAtTime(sus, relAt)
  g.exponentialRampToValueAtTime(0.0001, relAt + r)
}

function flash(index) {
  const el = document.querySelector(`[data-pad="${index}"]`)
  if (!el) return
  el.classList.add('lit')
  window.setTimeout(() => el.classList.remove('lit'), 80)
}

function locateHit(time) {
  if (!started) return null
  const n = stepCount()
  const base = 60 / model.bpm / 4
  const exact = (time - origin) / base
  let step = Math.round(exact)
  let nudge = 0
  if (model.recNatural) nudge = clamp(Math.round((exact - step) * 100), -50, 50)
  step = ((step % n) + n) % n
  return { step, nudge }
}

function click(time, accent) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'square'
  o.frequency.value = accent ? 1760 : 1180
  const level = (accent ? 0.18 : 0.1) * model.metroVol
  g.gain.setValueAtTime(level, time)
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03)
  o.connect(g)
  g.connect(master)
  o.start(time)
  o.stop(time + 0.04)
}

function fireStep(step, time) {
  const seq = currentSequence()
  const events = seq.steps[step] || []
  const base = 60 / model.bpm / 4
  events.forEach((ev) => {
    if (!ev) return
    const nudge = (clamp(ev.nudge || 0, -50, 50) / 100) * base
    playPad(ev.pad, ev.vel ?? 0.9, time + nudge, { pitch: ev.pitch || 0, fromSeq: true, pattern: true })
  })
  if (model.metro && step % 4 === 0) click(time, step % 16 === 0)
  model.playhead = step
  if (step % 2 === 0) touch(false)
}

function scheduler() {
  if (!ctx || !model.playing) return
  const horizon = ctx.currentTime + 0.12
  const base = 60 / model.bpm / 4
  const seq = currentSequence()
  const n = stepCount(seq)
  while (nextTime < horizon) {
    const swung = nextTime + (nextStep % 2 === 1 ? base * model.swing : 0)
    fireStep(nextStep, swung)
    nextStep = (nextStep + 1) % n
    nextTime += base
  }
}

export async function togglePlay() {
  await resume()
  if (model.playing) stopTransport()
  else startTransport()
}

export function startTransport() {
  if (!ctx) return
  if (model.playing) return
  patternVoices.forEach((v) => silence(v, ctx.currentTime, 0.02))
  patternVoices = []
  model.playing = true
  started = true
  origin = ctx.currentTime + 0.05
  nextTime = origin
  nextStep = 0
  window.clearInterval(timer)
  timer = window.setInterval(scheduler, 25)
  scheduler()
  touch(false)
}

export function stopTransport() {
  model.playing = false
  window.clearInterval(timer)
  if (ctx) patternVoices.forEach((v) => silence(v, ctx.currentTime, 0.03))
  patternVoices = []
  touch(false)
}

export async function toggleRecord() {
  await resume()
  model.recording = !model.recording
  if (model.recording && !model.playing) startTransport()
  touch(false)
}

export function toggleMetro() {
  model.metro = !model.metro
  touch(false)
}

export async function previewPcm(pcm, sr = 44100) {
  await resume()
  const buffer = ctx.createBuffer(1, pcm.length, sr)
  buffer.getChannelData(0).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = 0.8
  src.connect(g)
  g.connect(master)
  src.start()
}

export function noteOn(index, velocity, holdId, pitch = 0) {
  const pad = model.pads[index]
  if (!pad) return
  if (pad.mode !== 'oneshot' && holdId && held.has(holdId)) return
  playPad(index, velocity, 0, { holdId, pitch })
}

export function noteOff(holdId) {
  releaseHeld(holdId)
}

export function releaseKeyboardNotes() {
  for (const id of [...held.keys()]) {
    if (String(id).startsWith('key:')) releaseHeld(id)
  }
}

export async function bounceWav() {
  await resume()
  const seq = currentSequence()
  const bars = seq.bars
  const seconds = bars * 4 * (60 / model.bpm) + 0.6
  const sr = 44100
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr)
  const dest = off.createGain()
  dest.gain.value = model.master
  const gains = model.buses.map((b) => {
    const g = off.createGain()
    const anySolo = model.buses.some((x) => x.solo)
    const audible = !b.mute && (!anySolo || b.solo)
    g.gain.value = audible ? b.volume : 0
    g.connect(dest)
    return g
  })
  dest.connect(off.destination)
  const base = 60 / model.bpm / 4
  let time = 0.05
  for (let step = 0; step < stepCount(seq); step++) {
    const when = time + (step % 2 === 1 ? base * model.swing : 0)
    ;(seq.steps[step] || []).forEach((ev) => {
      if (!ev) return
      const pad = model.pads[ev.pad]
      const nudge = (clamp(ev.nudge || 0, -50, 50) / 100) * base
      const entry = audioBank.get(ev.pad)
      if (!pad || !entry || pad.source === 'empty' || !padAudible(pad)) return
      const buffer = off.createBuffer(1, entry.pcm.length, entry.sr || 44100)
      const ch = buffer.getChannelData(0)
      if (pad.reverse) {
        for (let i = 0; i < entry.pcm.length; i++) ch[i] = entry.pcm[entry.pcm.length - 1 - i]
      } else ch.set(entry.pcm)
      const src = off.createBufferSource()
      src.buffer = buffer
      const semi = (pad.pitch || 0) + (ev.pitch || 0) + (pad.fine || 0) / 100
      src.playbackRate.value = Math.pow(2, semi / 12)
      const amp = off.createGain()
      amp.gain.value = (ev.vel ?? 0.9) * pad.volume
      src.connect(amp)
      amp.connect(gains[pad.bus] || dest)
      const offset = clamp(pad.trimStart, 0, 0.99) * buffer.duration
      const end = clamp(pad.trimEnd, pad.trimStart + 0.01, 1) * buffer.duration
      src.start(Math.max(0, when + nudge), offset, Math.max(0.01, end - offset))
    })
    time += base
  }
  const rendered = await off.startRendering()
  const left = rendered.getChannelData(0).slice()
  const right = rendered.getChannelData(1).slice()
  const limited = limitStereo(left, right, rendered.sampleRate)
  const blob = encodeWav([limited.left, limited.right], rendered.sampleRate)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'miya-music-maker.wav'
  a.click()
  URL.revokeObjectURL(a.href)
}

let midiAccess = null
const midiState = { inputs: [], last: '' }

export function getMidiState() {
  return midiState
}

export async function enableMidi() {
  if (!navigator.requestMIDIAccess) {
    midiState.last = 'Web MIDI is not available in this browser'
    touch(false)
    return
  }
  midiAccess = await navigator.requestMIDIAccess({ sysex: false })
  const refresh = () => {
    midiState.inputs = [...midiAccess.inputs.values()].map((i) => i.name)
    midiAccess.inputs.forEach((input) => {
      input.onmidimessage = onMidi
    })
    touch(false)
  }
  midiAccess.onstatechange = refresh
  refresh()
  midiState.last = midiState.inputs.length ? midiState.inputs.join(', ') : 'No MIDI input yet'
  touch(false)
}

function onMidi(event) {
  const [status, data1, data2] = event.data
  const cmd = status & 0xf0
  if (cmd === 0x90 && data2 > 0) {
    const vel = model.settings.velocity ? data2 / 127 : 1
    if (model.keyboard) {
      const semi = data1 - 60
      playPad(model.selected, vel, 0, { pitch: semi, holdId: `midi:${data1}` })
    } else {
      const index = data1 - (model.settings.midiOffset || 36)
      if (index >= 0 && index < 64) playPad(index, vel, 0, { holdId: `midi:${data1}` })
    }
    midiState.last = `note ${data1} vel ${data2}`
  } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
    releaseHeld(`midi:${data1}`)
  }
}

export async function recordMic() {
  await resume()
  if (recording?.label === 'mic') return stopRecorder()
  if (recording) await stopRecorder()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false },
  })
  return startRecorder(stream, 'mic')
}

export async function resample(which = 'main') {
  await resume()
  const label = which === 'main' ? 'resample' : `bus ${which}`
  if (recording?.label === label) return stopRecorder()
  if (recording) await stopRecorder()
  const tap = ctx.createMediaStreamDestination()
  if (which === 'main') limiter.connect(tap)
  else {
    const index = 'ABCD'.indexOf(which)
    const node = busNodes[index]
    if (node) node.panner.connect(tap)
  }
  return startRecorder(tap.stream, which === 'main' ? 'resample' : `bus ${which}`, () => {
    try {
      if (which === 'main') limiter.disconnect(tap)
      else {
        const index = 'ABCD'.indexOf(which)
        busNodes[index]?.panner.disconnect(tap)
      }
    } catch {
      /* already disconnected */
    }
  })
}

function startRecorder(stream, label, cleanup) {
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  rec.onstop = async () => {
    stream.getTracks().forEach((tr) => {
      if (tr.readyState === 'live' && tr.kind === 'audio' && label === 'mic') tr.stop()
    })
    if (cleanup) cleanup()
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
    const arr = await blob.arrayBuffer()
    const audio = await ctx.decodeAudioData(arr.slice(0))
    const pcm = new Float32Array(audio.length)
    const chs = audio.numberOfChannels
    for (let c = 0; c < chs; c++) {
      const data = audio.getChannelData(c)
      for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / chs
    }
    let trim = { start: 0, end: 1 }
    if (model.settings.autoTrim) trim = trimSilence(pcm, audio.sampleRate)
    const pad = model.pads[model.selected]
    pad.trimStart = trim.start
    pad.trimEnd = trim.end
    if (model.settings.autoNorm) {
      let peak = 0
      const a = Math.floor(trim.start * pcm.length)
      const b = Math.floor(trim.end * pcm.length)
      for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(pcm[i]))
      if (peak > 0.001) {
        const g = 0.89 / peak
        for (let i = 0; i < pcm.length; i++) pcm[i] *= g
      }
    }
    await rememberSample(model.selected, { pcm, sr: audio.sampleRate, name: label })
    recording = null
    touch(true)
  }
  rec.start()
  recording = { rec, label }
  touch(false)
}

export function isRecordingAudio() {
  return !!recording
}

export function audioRecordLabel() {
  return recording ? recording.label : ''
}

function stopRecorder() {
  if (!recording) return Promise.resolve()
  if (recording.done) return recording.done
  const current = recording
  current.done = new Promise((resolve) => {
    const prev = current.rec.onstop
    current.rec.onstop = async (event) => {
      try {
        await prev(event)
      } finally {
        resolve()
      }
    }
    try {
      current.rec.stop()
    } catch {
      resolve()
    }
  })
  return current.done
}

export function stopAudioRecord() {
  return stopRecorder()
}

export function pushNumpadFx(held = model.fxHeld) {
  if (!numpadFx) return
  numpadFx.port.postMessage({
    slots: model.numpadFx,
    bpm: model.bpm,
    held: Number.isFinite(held) ? held : -1,
  })
}

export function holdNumpadFx(digit) {
  model.fxHeld = digit
  model.fxEdit = digit
  pushNumpadFx(digit)
  touch(false)
}

export function releaseNumpadFx(digit) {
  if (digit != null && digit !== model.fxHeld) return
  model.fxHeld = -1
  pushNumpadFx(-1)
  touch(false)
}

function mixdown(audio) {
  const pcm = new Float32Array(audio.length)
  const chs = audio.numberOfChannels
  for (let c = 0; c < chs; c++) {
    const data = audio.getChannelData(c)
    for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / chs
  }
  return { pcm, sr: audio.sampleRate }
}

async function decodeAny(arrayBuffer, name) {
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer.slice(0))
    return mixdown(audio)
  } catch {
    return decodeVideoBytes(arrayBuffer, name)
  }
}

function mimeFromName(name) {
  const lower = String(name || '').toLowerCase()
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  return 'video/mp4'
}

function decodeVideoBytes(arrayBuffer, name) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: mimeFromName(name) })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.src = url
    video.playsInline = true
    video.volume = 0
    const fail = (error) => {
      URL.revokeObjectURL(url)
      reject(error instanceof Error ? error : new Error('Could not read audio from that file'))
    }
    video.onerror = () => fail(new Error('Could not read audio from that file'))
    video.onloadeddata = async () => {
      try {
        const stream = video.captureStream ? video.captureStream() : null
        if (!stream) {
          fail(new Error('This browser cannot read audio out of that video'))
          return
        }
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        const chunks = []
        rec.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        rec.onstop = async () => {
          try {
            const recorded = await new Blob(chunks, { type: rec.mimeType || 'audio/webm' }).arrayBuffer()
            const audio = await ctx.decodeAudioData(recorded.slice(0))
            URL.revokeObjectURL(url)
            resolve(mixdown(audio))
          } catch (error) {
            fail(error)
          }
        }
        rec.start()
        await video.play()
        const cap = Math.min(Number.isFinite(video.duration) ? video.duration : 30, 48)
        const stopAt = () => {
          if (video.currentTime < cap && !video.ended) return
          video.pause()
          try { rec.stop() } catch { /* already stopped */ }
        }
        video.ontimeupdate = stopAt
        video.onended = stopAt
      } catch (error) {
        fail(error)
      }
    }
  })
}

async function fetchMediaBytes(url) {
  try {
    const direct = await fetch(url)
    if (direct.ok) return direct.arrayBuffer()
  } catch {
    /* CORS or a network block: the same-origin proxy is the second try */
  }
  const proxied = await fetch(`/api/sample-media?url=${encodeURIComponent(url)}`)
  if (!proxied.ok) {
    const allowed = allowedMediaUrl(url)
    throw new Error(allowed
      ? 'That file is listed, but the host blocked the browser from reading it. Drop the file on the window, or link the folder that has it.'
      : 'Could not read that file')
  }
  return proxied.arrayBuffer()
}

export async function placePcm(index, pcm, sr, name, { folder = 'imports', forceName = false, ext = 'wav' } = {}) {
  model.selected = index
  const pad = model.pads[index]
  pad.trimStart = 0
  pad.trimEnd = 1
  await rememberSample(index, { pcm, sr, name, forceName })
  ensureLibrary()
  await cachePcm(folder, name, pcm, sr, ext)
  model.browserNote = `${name} on pad ${index + 1}`
  touch(true)
}

export async function importFile(file, index = model.selected) {
  await resume()
  const arr = await file.arrayBuffer()
  const decoded = await decodeAny(arr, file.name)
  const name = file.name.replace(/\.[^.]+$/, '')
  await placePcm(index, decoded.pcm, decoded.sr, name, { forceName: true, ext: (file.name.split('.').pop() || 'wav').toLowerCase() })
}

export async function importRemote(url, index = model.selected, name = 'nft') {
  await resume()
  model.browserNote = `Reading ${name}`
  touch(false)
  const bytes = await fetchMediaBytes(url)
  const decoded = await decodeAny(bytes, url)
  await placePcm(index, decoded.pcm, decoded.sr, name, { forceName: true, ext: 'wav' })
}

export async function sliceOnto(index, count, baseName) {
  await resume()
  const entry = audioBank.get(index)
  if (!entry?.pcm) throw new Error('That pad has no sample to slice')
  const pieces = evenSlices(entry.pcm, count)
  const base = baseName || model.pads[index].name || 'slice'
  for (let i = 0; i < pieces.length; i++) {
    const at = (index + i) % 64
    model.pads[at].trimStart = 0
    model.pads[at].trimEnd = 1
    model.pads[at].mode = 'oneshot'
    await rememberSample(at, { pcm: pieces[i], sr: entry.sr, name: `${base} ${i + 1}`, forceName: true })
    await cachePcm('slices', `${base} ${i + 1}`, pieces[i], entry.sr, 'wav')
  }
  model.browserNote = `${pieces.length} even slices from pad ${index + 1}`
  touch(true)
}

export async function decodePreview(arrayBuffer, name) {
  await resume()
  return decodeAny(arrayBuffer, name)
}

export function limiterIsWorklet() {
  return limiterReady
}

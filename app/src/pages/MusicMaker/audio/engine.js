import { limitStereo } from './limiter.js'
import { encodeWav, trimSilence } from './wav.js'
import { evenPoints, evenSlices } from './slice.js'
import { workletSource } from './numpadFx.js'
import { kneeWorkletSource } from './knee.js'
import { cachePcm, ensureLibrary, newFolder } from '../media/library.js'
import { allowedMediaUrl } from '../media/allow.js'
import { VIDEO_AUDIO_PATH, videoPage } from '../media/videoaudio.js'
import { beginUndo, endUndo, stashUndo } from '../history.js'
import { importKitFile, importSongFile } from './song.js'
import { BUS_COUNT, TRACK_VEL, audioBank, model, currentSequence, stepCount, writeEvent, commitTrackerNote, setUndoBatch, touch, rememberSample, fitLoop, idbSet } from '../model.js'

setUndoBatch({ begin: beginUndo, end: endUndo })

const busNodes = []
let ctx = null
let master = null
let limiter = null
let limiterReady = false
let numpadFx = null
let stockComp = null
let makeup = null
let kneeNode = null
let routed = null
let analyser = null
let meterAnalysers = []
const reverbBuffers = new Map()
let voices = []
let patternVoices = []
let held = new Map()
let timer = 0
let nextTime = 0
let nextStep = 0
let origin = 0
let started = false
const meters = { bus: Array(BUS_COUNT).fill(0), master: 0, gr: 0, compGr: 0 }
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
    numpadFx.connect(limiter)
    pushNumpadFx()
  }
  stockComp = ctx.createDynamicsCompressor()
  makeup = ctx.createGain()
  makeup.gain.value = model.comp?.makeup ?? 1
  try {
    const kneeUrl = URL.createObjectURL(new Blob([kneeWorkletSource()], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(kneeUrl)
    URL.revokeObjectURL(kneeUrl)
    kneeNode = new AudioWorkletNode(ctx, 'miya-knee', { outputChannelCount: [2], numberOfInputs: 1, numberOfOutputs: 1 })
    kneeNode.channelCount = 2
    kneeNode.channelCountMode = 'explicit'
    kneeNode.port.onmessage = (e) => {
      if (e.data && typeof e.data.gr === 'number') meters.compGr = e.data.gr
    }
  } catch (err) {
    console.warn('knee compressor worklet failed', err)
    kneeNode = null
  }
  syncMasterComp()
  limiter.connect(analyser)
  analyser.connect(ctx.destination)
  ensureBuses()
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

function impulse(context, seconds = 1.6) {
  const length = seconds > 1 ? 1.6 : seconds > 0.6 ? 0.9 : 0.4
  const key = `${context.sampleRate}:${length}`
  const cached = reverbBuffers.get(key)
  if (cached) return cached
  const len = Math.floor(context.sampleRate * length)
  const buf = context.createBuffer(2, len, context.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      const t = i / len
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (c === 0 ? 1 : 0.85)
    }
  }
  reverbBuffers.set(key, buf)
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

function curveAmp(amount) {
  const curve = new Float32Array(2048)
  const k = 1 + amount * 30
  const bias = amount * 0.4
  const norm = Math.tanh(k)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = (Math.tanh((x + bias) * k) - Math.tanh(bias * k)) / norm
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

function ensureBuses() {
  const n = Math.max(BUS_COUNT, model.buses.length || 0)
  while (busNodes.length < n) busNodes.push(makeBus(ctx, master))
  while (meters.bus.length < n) meters.bus.push(0)
}

function routeMaster() {
  const next = numpadFx || limiter
  const useKnee = !!(model.comp && model.comp.justice && kneeNode)
  const mode = useKnee ? 'knee' : 'stock'
  if (routed === mode) return
  try { master.disconnect() } catch { /* not yet connected */ }
  try { stockComp.disconnect() } catch { /* not yet connected */ }
  try { makeup.disconnect() } catch { /* not yet connected */ }
  try { kneeNode?.disconnect() } catch { /* not yet connected */ }
  if (useKnee) {
    master.connect(kneeNode)
    kneeNode.connect(next)
  } else {
    master.connect(stockComp)
    stockComp.connect(makeup)
    makeup.connect(next)
  }
  routed = mode
}

export function syncMasterComp() {
  if (!ctx || !stockComp) return
  routeMaster()
  const c = model.comp
  if (!c) return
  const t = ctx.currentTime
  stockComp.threshold.setTargetAtTime(c.threshold, t, 0.02)
  stockComp.knee.setTargetAtTime(c.knee, t, 0.02)
  stockComp.ratio.setTargetAtTime(c.ratio, t, 0.02)
  stockComp.attack.setTargetAtTime(c.attack, t, 0.02)
  stockComp.release.setTargetAtTime(c.release, t, 0.02)
  makeup.gain.setTargetAtTime(c.makeup, t, 0.02)
  if (kneeNode) {
    kneeNode.port.postMessage({
      knee: c.kKnee,
      police: c.kPolice,
      fold: c.kFold,
      pitch: c.kPitch,
      policeLfo: c.lfo?.kPolice,
      foldLfo: c.lfo?.kFold,
    })
  }
}

export function getCompReduction() {
  if (model.comp?.justice) return meters.compGr || 0
  if (stockComp && typeof stockComp.reduction === 'number') return stockComp.reduction
  return 0
}

export function syncMixer(force = false) {
  if (!ctx) return
  ensureBuses()
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

function groupId(value) {
  const n = value | 0
  return n > 0 ? n : 0
}

function choke(group, when) {
  const id = groupId(group)
  if (!id || !ctx) return
  const t = Math.max(when || 0, ctx.currentTime)
  voices.forEach((v) => {
    if (groupId(v.choke) !== id) return
    if (v.startAt > t + 0.0005) return
    silence(v, t, 0.012)
  })
}

function fxEnv(pad, target) {
  const list = pad?.envelopes
  if (!Array.isArray(list)) return null
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.target === target) return list[i]
  }
  return null
}

function scheduleFilter(filter, pad, t) {
  const env = fxEnv(pad, 'filter')
  const base = clamp(pad.filter.cutoff, 40, 18000)
  const depth = env ? Number(env.depth) || 0 : 0
  const attack = Math.max(0.001, env ? env.a : 0.004)
  const decay = Math.max(0.001, env ? env.d : 0.12)
  const sustain = env ? env.s : 0
  const peak = clamp(base * Math.pow(2, depth / 12), 40, 18000)
  const susHz = clamp(base + (peak - base) * (sustain ?? 0), 40, 18000)
  filter.frequency.cancelScheduledValues(t)
  filter.frequency.setValueAtTime(base, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, peak), t + attack)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, susHz), t + attack + decay)
}

function scheduleMix(dry, wet, env, amount, t, total) {
  const wetG = wet.gain
  const dryG = dry.gain
  wetG.cancelScheduledValues(t)
  dryG.cancelScheduledValues(t)
  const level = clamp(amount, 0, 1)
  if (!env) {
    wetG.setValueAtTime(level, t)
    dryG.setValueAtTime(1 - level, t)
    return
  }
  const depth = clamp(env.depth ?? 1, 0, 1)
  const peak = clamp(level * depth, 0, 1)
  const a = Math.max(0.001, env.a || 0.001)
  const d = Math.max(0.001, env.d || 0.001)
  const s = clamp(env.s ?? 0, 0, 1)
  const r = Math.max(0.005, env.r || 0.02)
  const sus = peak * s
  const relAt = Math.max(t + a + d, t + Math.max(0, total) - r)
  wetG.setValueAtTime(0, t)
  wetG.linearRampToValueAtTime(peak, t + a)
  wetG.linearRampToValueAtTime(sus, t + a + d)
  wetG.setValueAtTime(sus, relAt)
  wetG.linearRampToValueAtTime(0, relAt + r)
  dryG.setValueAtTime(1, t)
  dryG.linearRampToValueAtTime(1 - peak, t + a)
  dryG.linearRampToValueAtTime(1 - sus, t + a + d)
  dryG.setValueAtTime(1 - sus, relAt)
  dryG.linearRampToValueAtTime(1, relAt + r)
}

function wantsMix(amount, env) {
  return (amount || 0) > 0.01 || !!env
}

function mixAround(input, amount, env, t, total, connectWet) {
  if (!wantsMix(amount, env)) return input
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const mix = ctx.createGain()
  input.connect(dry)
  dry.connect(mix)
  connectWet(wet)
  wet.connect(mix)
  scheduleMix(dry, wet, env, clamp(amount || 0, 0, 1), t, total)
  return mix
}

function ampModel(input, pad, env, t, total) {
  const amount = pad.fx?.amp || 0
  if (!wantsMix(amount, env)) return input
  const pre = ctx.createGain()
  pre.gain.value = 1 + clamp(amount, 0, 1) * 6
  const sh = ctx.createWaveShaper()
  sh.curve = curveAmp(Math.max(0.02, amount))
  sh.oversample = '2x'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.Q.value = 0.6
  tone.frequency.value = 500 + clamp(pad.fx?.tone ?? 0.65, 0, 1) * 11000
  return mixAround(input, amount, env, t, total, (wet) => {
    input.connect(pre)
    pre.connect(sh)
    sh.connect(tone)
    tone.connect(wet)
  })
}

function chorus(input, amount, env, t, total, stops) {
  if (!wantsMix(amount, env)) return input
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const left = ctx.createDelay(0.05)
  const right = ctx.createDelay(0.05)
  left.delayTime.value = 0.016
  right.delayTime.value = 0.021
  const lfoL = ctx.createOscillator()
  const lfoR = ctx.createOscillator()
  const depthL = ctx.createGain()
  const depthR = ctx.createGain()
  const rate = 0.35 + clamp(amount, 0, 1) * 2.4
  const depth = 0.003 + clamp(amount, 0, 1) * 0.006
  lfoL.frequency.value = rate
  lfoR.frequency.value = rate * 1.07
  depthL.gain.value = depth
  depthR.gain.value = depth
  lfoL.connect(depthL)
  lfoR.connect(depthR)
  depthL.connect(left.delayTime)
  depthR.connect(right.delayTime)
  const node = mixAround(input, amount, env, t, total, (wet) => {
    input.connect(split)
    split.connect(left, 0)
    split.connect(right, 1)
    left.connect(merge, 0, 0)
    right.connect(merge, 0, 1)
    merge.connect(wet)
  })
  const startAt = Math.max(t, ctx.currentTime)
  lfoL.start(startAt)
  lfoR.start(startAt)
  stops.push(() => {
    try { lfoL.stop() } catch { /* ended */ }
    try { lfoR.stop() } catch { /* ended */ }
  })
  return node
}

function widen(input, amount, env, t, total) {
  if (!wantsMix(amount, env)) return input
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const ll = ctx.createGain()
  const lr = ctx.createGain()
  const rl = ctx.createGain()
  const rr = ctx.createGain()
  ll.gain.value = 1.45
  lr.gain.value = -0.45
  rl.gain.value = -0.45
  rr.gain.value = 1.45
  return mixAround(input, amount, env, t, total, (wet) => {
    input.connect(split)
    split.connect(ll, 0)
    split.connect(rl, 0)
    split.connect(lr, 1)
    split.connect(rr, 1)
    ll.connect(merge, 0, 0)
    lr.connect(merge, 0, 0)
    rl.connect(merge, 0, 1)
    rr.connect(merge, 0, 1)
    merge.connect(wet)
  })
}

function padReverb(input, amount, env, t, total) {
  if (!wantsMix(amount, env)) return input
  const conv = ctx.createConvolver()
  const seconds = amount > 0.66 ? 1.7 : amount > 0.33 ? 0.75 : 0.3
  conv.buffer = impulse(ctx, seconds)
  return mixAround(input, amount, env, t, total, (wet) => {
    input.connect(conv)
    conv.connect(wet)
  })
}

function stopExtras(v, when) {
  if (!v?.stops?.length || v.extrasStopped) return
  const run = () => {
    if (v.extrasStopped) return
    v.extrasStopped = true
    for (const fn of v.stops) {
      try { fn() } catch { /* ended */ }
    }
  }
  const now = ctx ? ctx.currentTime : 0
  if (when == null || when <= now + 0.01) run()
  else window.setTimeout(run, Math.max(0, (when - now) * 1000))
}

/** Pull a voice silent at `when`. A released one-shot is still audible until its tail, so this must run even after `dead` is set. */
function silence(v, when, seconds = 0.012) {
  if (!ctx || !v?.gate) return
  const now = ctx.currentTime
  const requested = Math.max(when || 0, now)
  const end = requested + Math.max(0.004, seconds)
  if (v.quietAt != null && v.quietAt <= end + 0.0005) return
  v.dead = true
  v.quietAt = end
  const g = v.gate.gain
  // The envelope gain is already mid-ramp. A cut booked on that same param at
  // the current sample never replaces it. `gate` stays at 1 until this call.
  try {
    if (requested <= now + 0.008) {
      g.cancelScheduledValues(0)
      g.value = 0
    } else {
      g.setValueAtTime(1, requested)
      g.linearRampToValueAtTime(0, end)
    }
  } catch {
    try {
      g.cancelScheduledValues(0)
      g.value = 0
    } catch { /* ended */ }
  }
  try { v.src.stop(end + 0.02) } catch { /* one-shots already scheduled their stop; the gate is what goes quiet */ }
  stopExtras(v, end)
}

export function releaseHeld(id) {
  const v = held.get(id)
  if (!v) return
  held.delete(id)
  if (!ctx || v.dead) return
  const pad = model.pads[v.pad]
  if (!pad) return
  const t = ctx.currentTime
  if (pad.mode === 'oneshot' && v.heldLoop && t < v.introUntil - 0.008) {
    const stopAt = v.introUntil
    const peak = Math.max(0.0001, v.peak || v.amp.gain.value)
    const span = Math.max(0.012, stopAt - t)
    const mid = t + Math.min(0.008, span * 0.2)
    const rel = Math.min(Math.max(0.008, pad.amp.r || 0.015), span * 0.45)
    const fadeAt = Math.max(mid + 0.001, stopAt - rel)
    try {
      v.amp.gain.cancelScheduledValues(t)
      v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), t)
      v.amp.gain.exponentialRampToValueAtTime(peak, mid)
      v.amp.gain.setValueAtTime(peak, fadeAt)
      v.amp.gain.exponentialRampToValueAtTime(0.0001, Math.max(fadeAt + 0.004, stopAt))
      v.src.stop(stopAt + 0.015)
    } catch {
      /* ended */
    }
    v.dead = true
    v.quietAt = stopAt
    stopExtras(v, stopAt)
    return
  }
  if (pad.mode === 'oneshot' && !v.heldLoop) return
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
  v.quietAt = t + rel
  stopExtras(v, t + rel)
}

export function playPad(index, velocity = TRACK_VEL, when = 0, opts = {}) {
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
  if (groupId(pad.choke)) choke(pad.choke, t)
  const src = ctx.createBufferSource()
  src.buffer = makeBuffer(ctx, entry, pad.reverse)
  const semi = (pad.pitch || 0) + (opts.pitch || 0) + (pad.fine || 0) / 100
  src.playbackRate.value = Math.pow(2, semi / 12)

  const filter = ctx.createBiquadFilter()
  filter.type = pad.filter.type || 'lowpass'
  filter.Q.value = clamp(pad.filter.q || 0.7, 0.1, 18)
  const amp = ctx.createGain()
  const gate = ctx.createGain()
  gate.gain.value = 1
  const pan = ctx.createStereoPanner()
  pan.pan.value = clamp(pad.pan || 0, -1, 1)

  const startF = clamp(pad.trimStart, 0, 0.98)
  const endF = clamp(pad.trimEnd, startF + 0.01, 1)
  let loopF = typeof pad.loopPoint === 'number' ? pad.loopPoint : (startF + endF) / 2
  loopF = clamp(loopF, startF, endF - 0.004)
  const offset = startF * src.buffer.duration
  const end = endF * src.buffer.duration
  let loopAt = loopF * src.buffer.duration
  if (end - loopAt < 0.004) loopAt = Math.max(offset, end - 0.004)
  const region = Math.max(0.01, end - offset)
  const regionDur = region / src.playbackRate.value
  const vel = clamp(velocity, 0, 1) * pad.volume
  const heldLive = !!opts.holdId && !opts.pattern
  const envTotal = heldLive || pad.mode !== 'oneshot' ? Math.max(regionDur, 32) : regionDur
  const stops = []
  const fx = pad.fx || {}

  let node = ampModel(src, pad, fxEnv(pad, 'amp'), t, envTotal)
  if (fx.drive > 0.01) {
    const d = shaper(ctx, 'drive', fx.drive)
    node.connect(d)
    node = d
  }
  if (fx.crush > 0.01) {
    const c = shaper(ctx, 'crush', fx.crush)
    node.connect(c)
    node = c
  }
  node.connect(filter)
  filter.connect(amp)
  amp.connect(gate)
  gate.connect(pan)
  let out = chorus(pan, fx.chorus || 0, fxEnv(pad, 'chorus'), t, envTotal, stops)
  out = widen(out, fx.width || 0, fxEnv(pad, 'width'), t, envTotal)
  out = padReverb(out, fx.reverb || 0, fxEnv(pad, 'reverb'), t, envTotal)
  out.connect(busNodes[pad.bus]?.input || master)

  scheduleFilter(filter, pad, t)
  scheduleAmp(amp, pad.amp, vel, t, envTotal)

  if (heldLive) {
    src.loop = true
    src.loopStart = loopAt
    src.loopEnd = end
    src.start(t, offset)
  } else if (pad.mode === 'loop') {
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

  const voice = {
    src,
    amp,
    gate,
    filter,
    choke: groupId(pad.choke),
    pad: index,
    dead: false,
    quietAt: heldLive || pad.mode !== 'oneshot' ? null : t + regionDur + 0.03,
    startAt: t,
    pattern: !!opts.pattern,
    lane: opts.pattern ? (opts.lane ?? null) : null,
    heldLoop: heldLive,
    introUntil: t + regionDur,
    peak: Math.max(0.0001, vel * clamp(pad.amp.s ?? 1, 0, 1)),
    stops,
  }
  voices.push(voice)
  if (voices.length > 64) {
    const now = ctx.currentTime
    voices = voices.filter((v) => v.quietAt == null || v.quietAt > now - 0.03)
  }
  if (opts.pattern) patternVoices.push(voice)
  if (opts.holdId) held.set(opts.holdId, voice)
  src.onended = () => {
    voice.dead = true
    if (voice.quietAt == null) voice.quietAt = ctx.currentTime
    stopExtras(voice, ctx.currentTime)
  }
  flash(index)
  if (!opts.fromSeq && !opts.pattern) captureHit(index, velocity, opts.pitch, t)
}

function captureHit(index, velocity, pitch, when) {
  if (model.screen === 'track') {
    if (!model.tracker.edit) return
    const live = !!(model.playing && model.tracker.follow && started)
    let row = model.tracker.row | 0
    let nudge = 0
    if (live) {
      const hit = locateHit(when)
      if (!hit) return
      row = hit.step
      nudge = hit.nudge
    }
    commitTrackerNote({
      pad: index,
      vel: velocity,
      pitch: typeof pitch === 'number' ? pitch : 0,
      row,
      nudge,
      live,
    })
    return
  }
  if (model.recording && model.playing && typeof pitch !== 'number') {
    const hit = locateHit(when)
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

function silenceLane(lane, when) {
  patternVoices.forEach((v) => {
    if (v.lane === lane) silence(v, when, 0.012)
  })
}

function fireStep(step, time) {
  const seq = currentSequence()
  const events = seq.steps[step] || []
  const base = 60 / model.bpm / 4
  events.forEach((ev, lane) => {
    if (!ev) return
    const nudge = (clamp(ev.nudge || 0, -50, 50) / 100) * base
    const when = time + nudge
    silenceLane(lane, when)
    if (ev.off) return
    playPad(ev.pad, ev.vel ?? 0.9, when, { pitch: ev.pitch || 0, fromSeq: true, pattern: true, lane })
  })
  if (model.metro && step % 4 === 0) click(time, step % 16 === 0)
  model.playhead = step
  if (step % 2 === 0) touch(false)
}

function advanceSong() {
  const order = model.songOrder
  if (!model.songPlay || !Array.isArray(order) || order.length < 2) return
  model.songCursor = ((model.songCursor || 0) + 1) % order.length
  model.pattern = order[model.songCursor] | 0
}

function scheduler() {
  if (!ctx || !model.playing) return
  const horizon = ctx.currentTime + 0.12
  const base = 60 / model.bpm / 4
  while (nextTime < horizon) {
    const seq = currentSequence()
    const n = Math.max(1, stepCount(seq))
    if (nextStep >= n) nextStep = 0
    const swung = nextTime + (nextStep % 2 === 1 ? base * model.swing : 0)
    fireStep(nextStep, swung)
    nextStep += 1
    if (nextStep >= n) {
      nextStep = 0
      advanceSong()
    }
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
  if (model.songPlay && Array.isArray(model.songOrder) && model.songOrder.length) {
    model.songCursor = 0
    model.pattern = model.songOrder[0] | 0
  }
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

export function noteOn(index, velocity, holdId, pitch) {
  const pad = model.pads[index]
  if (!pad) return
  if (pad.mode !== 'oneshot' && holdId && held.has(holdId)) return
  const opts = { holdId }
  if (typeof pitch === 'number') opts.pitch = pitch
  playPad(index, velocity, 0, opts)
}

export function recordTrackerOff() {
  if (model.screen !== 'track' || !model.tracker.edit) return
  const live = !!(model.playing && model.tracker.follow && started && ctx)
  let row = model.tracker.row | 0
  let nudge = 0
  if (live) {
    const hit = locateHit(ctx.currentTime)
    if (hit) {
      row = hit.step
      nudge = hit.nudge
    }
  }
  commitTrackerNote({ pad: model.selected, vel: 0, pitch: 0, off: true, row, nudge, live })
}

export function noteOff(holdId) {
  releaseHeld(holdId)
}

export function releaseKeyboardNotes() {
  for (const id of [...held.keys()]) {
    if (String(id).startsWith('key:')) releaseHeld(id)
  }
}

export async function renderBounce() {
  await resume()
  const seq = currentSequence()
  const seconds = stepCount(seq) * (60 / model.bpm / 4) + 0.6
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
  return encodeWav([limited.left, limited.right], rendered.sampleRate)
}

export async function bounceWav() {
  const blob = await renderBounce()
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

export function onMidi(event) {
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
  const busIndex = which === 'main' ? -1 : Number(which)
  const label = which === 'main' ? 'resample' : `bus ${busIndex}`
  if (recording?.label === label) return stopRecorder()
  if (recording) await stopRecorder()
  const tap = ctx.createMediaStreamDestination()
  if (which === 'main') limiter.connect(tap)
  else if (busNodes[busIndex]) busNodes[busIndex].panner.connect(tap)
  return startRecorder(tap.stream, label, () => {
    try {
      if (which === 'main') limiter.disconnect(tap)
      else busNodes[busIndex]?.panner.disconnect(tap)
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
    fitLoop(pad)
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
  beginUndo()
  try {
    model.selected = index
    const pad = model.pads[index]
    pad.trimStart = 0
    pad.trimEnd = 1
    fitLoop(pad)
    await rememberSample(index, { pcm, sr, name, forceName })
    ensureLibrary()
    await cachePcm(folder, name, pcm, sr, ext)
    model.browserNote = `${name} on pad ${index + 1}`
    touch(true)
  } finally {
    endUndo()
  }
}

export async function importFile(file, index = model.selected) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'k1t') {
    await importKitFile(file)
    return
  }
  if (ext === 'm1ya' || ext === 'mod' || ext === 'xm') {
    await importSongFile(file)
    return
  }
  await resume()
  const arr = await file.arrayBuffer()
  const decoded = await decodeAny(arr, file.name)
  const name = file.name.replace(/\.[^.]+$/, '')
  await placePcm(index, decoded.pcm, decoded.sr, name, { forceName: true, ext })
}

export async function importRemote(url, index = model.selected, name = 'nft') {
  await resume()
  model.browserNote = `Reading ${name}`
  touch(false)
  const bytes = await fetchMediaBytes(url)
  const decoded = await decodeAny(bytes, url)
  await placePcm(index, decoded.pcm, decoded.sr, name, { forceName: true, ext: 'wav' })
}

const SAMPLE_SECONDS = 16

function fitSample(pcm, sr) {
  const rate = sr || 44100
  let start = 0
  let end = pcm.length
  if (model.settings.autoTrim) {
    const trim = trimSilence(pcm, rate)
    start = Math.floor(trim.start * pcm.length)
    end = Math.ceil(trim.end * pcm.length)
  }
  const cap = Math.floor(rate * SAMPLE_SECONDS)
  if (end - start > cap) end = start + cap
  if (end <= start) {
    start = 0
    end = Math.min(pcm.length, cap)
  }
  const out = new Float32Array(Math.max(0, end - start))
  if (out.length) out.set(pcm.subarray(start, end))
  if (model.settings.autoNorm && out.length) {
    let peak = 0
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
    if (peak > 0.001) {
      const gain = 0.98 / peak
      for (let i = 0; i < out.length; i++) out[i] *= gain
    }
  }
  return { pcm: out, sr: rate }
}

function sampleTitle(name) {
  const clean = String(name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean || 'video'
}

async function storeInCache(pcm, sr, name) {
  const fitted = fitSample(pcm, sr)
  const title = sampleTitle(name)
  ensureLibrary()
  await cachePcm('imports', title, fitted.pcm, fitted.sr, 'wav')
  model.browserNote = `${title} is in Cache. Load it onto a pad to keep it in a song.`
  touch(true)
}

export async function cacheRemote(url, name = 'media') {
  await resume()
  model.browserNote = `Reading ${name}`
  touch(false)
  const bytes = await fetchMediaBytes(url)
  const decoded = await decodeAny(bytes, url)
  await storeInCache(decoded.pcm, decoded.sr, name)
}

export async function importVideoLink(raw) {
  const page = videoPage(String(raw || '').trim())
  if (!page) throw new Error('Use a YouTube, Odysee, LBRY, or X link.')
  await resume()
  model.browserNote = 'Reading that video'
  touch(false)
  const res = await fetch(`${VIDEO_AUDIO_PATH}?url=${encodeURIComponent(page.href)}`)
  if (!res.ok) {
    let message = 'Could not read that video'
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      /* the server answered with a page, not a reason */
    }
    throw new Error(message)
  }
  const header = res.headers.get('x-sample-name')
  let name = 'video'
  try {
    name = decodeURIComponent(header || '') || name
  } catch {
    name = header || name
  }
  const bytes = await res.arrayBuffer()
  const decoded = await decodeAny(bytes, `${name}.webm`)
  await storeInCache(decoded.pcm, decoded.sr, name)
}

export async function sliceOnto(index, count, baseName) {
  await resume()
  const entry = audioBank.get(index)
  if (!entry?.pcm) throw new Error('That pad has no sample to slice')
  const pieces = evenSlices(entry.pcm, count)
  const points = evenPoints(count)
  const base = String(baseName || model.pads[index].name || 'slice').slice(0, 40)
  beginUndo()
  try {
    const folderId = newFolder(base, 'slices')
    if (!folderId) throw new Error('Could not make a slice folder')
    const cuts = []
    for (let i = 0; i < pieces.length; i++) {
      const at = (index + i) % 64
      model.pads[at].trimStart = 0
      model.pads[at].trimEnd = 1
      model.pads[at].mode = 'oneshot'
      fitLoop(model.pads[at])
      await rememberSample(at, { pcm: pieces[i], sr: entry.sr, name: `${base} ${i + 1}`, forceName: true })
      const fileId = await cachePcm(folderId, `${base} ${i + 1}`, pieces[i], entry.sr, 'wav')
      cuts.push({ fileId, pad: at, a: points[i], b: points[i + 1] })
    }
    const setId = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
    const library = ensureLibrary()
    library.sliceSets.push({ id: setId, folder: folderId, name: base, sr: entry.sr, cuts })
    stashUndo(`src:${setId}`, null)
    await idbSet(`src:${setId}`, { pcm: entry.pcm, sr: entry.sr, name: base })
    model.sliceView = setId
    model.screen = 'edit'
    model.browserNote = `${pieces.length} even slices in ${base}`
    touch(true)
  } finally {
    endUndo()
  }
}

export async function decodePreview(arrayBuffer, name) {
  await resume()
  return decodeAny(arrayBuffer, name)
}

export function limiterIsWorklet() {
  return limiterReady
}

import { sampleWindow, stitchGrains } from './grain.js'
import { midiAction, midiLayout } from './midi.js'
import { limitStereo } from './limiter.js'
import { encodeWav, trimSilence } from './wav.js'
import { chopRange, evenPoints, evenSlices, nextEmptyPad } from './slice.js'
import { workletSource } from './numpadFx.js'
import { kneeWorkletSource } from './knee.js'
import { cachePcm, ensureLibrary, newFolder } from '../media/library.js'
import { allowedMediaUrl, SAMPLE_MEDIA_LIMIT, SAMPLE_MEDIA_PATH } from '../media/allow.js'
import { fetchCapped } from '../media/capped.js'
import { VIDEO_AUDIO_PATH, videoPage } from '../media/videoaudio.js'
import { nextSongCursor, samplePlayKind } from './playKind.js'
import { shapeSample, sliceSpan, urlSampleHint, VIDEO_FETCH_CAP } from './sampleShape.js'
import { beginUndo, endUndo, stashUndo } from '../history.js'
import { createBufferCache, finiteOr, heldForPort, liveVoices, locateStep, playFraction, scrubPcm, stepSeconds, stepsBehind, voicesToFade } from './voices.js'
import { importKitFile, importSongFile } from './song.js'
import { SongChanged, loadTicket, songId } from '../jobs.js'
import { BUS_COUNT, TRACK_VEL, audioBank, budgetNote, model, currentSequence, ensurePattern, stepCount, trackerFields, writeEvent, commitTrackerNote, setUndoBatch, touch, rememberSample, idbSet, selectPad, flushSave } from '../model.js'

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
/** One convolver per bus and reverb kind. Notes send into it; the tank stays up. */
const reverbTanks = new Map()
/** Sounding notes. Past this, the oldest fades so the audio thread keeps the buffer full. */
const VOICE_CAP = 28
let voices = []
let patternVoices = []
let held = new Map()
let timer = 0
let nextTime = 0
let nextStep = 0
let started = false
const meters = { bus: Array(BUS_COUNT).fill(0), master: 0, gr: 0, compGr: 0 }
let meterTimer = 0
let recording = null
/** A Mic or Resample press waiting on resume() or the permission prompt. */
let starting = null
let ensuring = null
let active = true
/** Bumped by shutdown(). An await that started before it must not wake the engine again. */
let life = 0
/**
 * Held notes whose start waits on resume(), by holdId. A release before the start does not drop the hit: a one-shot
 * still plays once, as a tap, just not held (a held one-shot loops). A gate or loop pad released that early is skipped.
 */
const deferred = new Map()
let deferSeq = 0
let anchor = null
const buffers = createBufferCache()

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

export function getMeters() {
  return meters
}

/**
 * Build or wake the context. Resolves false when the window was closed (shutdown) while it waited:
 * callers must then not play, start the clock, or record.
 */
export async function resume() {
  const gen = life
  await ensure()
  if (gen !== life) return false
  active = true
  if (!meterTimer) meterTimer = window.setInterval(readMeters, 80)
  if (ctx.state !== 'running') await ctx.resume()
  if (gen !== life) {
    // shutdown() ran while the context was waking. Park it again.
    if (ctx.state !== 'closed') ctx.suspend().catch(() => {})
    return false
  }
  return true
}

/** True while the window that started this work is still the open one. */
function alive(gen) {
  return gen === life && active
}

/** One build at a time. `ctx` is only set once the whole graph is wired, so no caller sees half of it. */
function ensure() {
  if (ctx) return Promise.resolve(ctx)
  if (!ensuring) {
    ensuring = build().finally(() => {
      ensuring = null
    })
  }
  return ensuring
}

async function build() {
  const AC = window.AudioContext || window.webkitAudioContext
  const c = new AC()
  master = c.createGain()
  master.channelCount = 2
  master.channelCountMode = 'explicit'
  master.gain.value = model.master
  analyser = c.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.6
  try {
    await c.audioWorklet.addModule('/worklets/limiter.js')
    limiter = new AudioWorkletNode(c, 'miya-limiter', { outputChannelCount: [2] })
    limiter.port.onmessage = (e) => {
      if (e.data && typeof e.data.gr === 'number') meters.gr = e.data.gr
    }
    limiterReady = true
  } catch (err) {
    console.warn('limiter worklet failed, hard clip fallback', err)
    limiter = hardClip(c)
    limiterReady = false
  }
  try {
    const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }))
    await c.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    numpadFx = new AudioWorkletNode(c, 'miya-numpad-fx', { outputChannelCount: [2], numberOfInputs: 1, numberOfOutputs: 1 })
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
  stockComp = c.createDynamicsCompressor()
  makeup = c.createGain()
  makeup.gain.value = model.comp?.makeup ?? 1
  try {
    const kneeUrl = URL.createObjectURL(new Blob([kneeWorkletSource()], { type: 'text/javascript' }))
    await c.audioWorklet.addModule(kneeUrl)
    URL.revokeObjectURL(kneeUrl)
    kneeNode = new AudioWorkletNode(c, 'miya-knee', { outputChannelCount: [2], numberOfInputs: 1, numberOfOutputs: 1 })
    kneeNode.channelCount = 2
    kneeNode.channelCountMode = 'explicit'
    kneeNode.port.onmessage = (e) => {
      if (e.data && typeof e.data.gr === 'number') meters.compGr = e.data.gr
    }
  } catch (err) {
    console.warn('knee compressor worklet failed', err)
    kneeNode = null
  }
  // Synchronous from here on: the graph is complete before anything else can read ctx.
  ctx = c
  syncMasterComp()
  limiter.connect(analyser)
  analyser.connect(ctx.destination)
  ensureBuses()
  syncMixer(true)
  window.clearInterval(meterTimer)
  meterTimer = active ? window.setInterval(readMeters, 80) : 0
  if (!active) ctx.suspend().catch(() => {})
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

function curveClean(amount) {
  const curve = new Float32Array(2048)
  const k = 1 + amount * 4
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k)
  }
  return curve
}

function curveTape(amount) {
  const curve = new Float32Array(2048)
  const k = 1 + amount * 8
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const y = x / (1 + k * Math.abs(x))
    curve[i] = y * (1 + amount * 0.35)
  }
  return curve
}

function curveFold(amount) {
  const curve = new Float32Array(2048)
  const turns = 1 + amount * 3
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.sin(x * turns * Math.PI * 0.5)
  }
  return curve
}

function coloredImpulse(context, kind) {
  const spec = {
    room: [0.42, 3.2, false],
    hall: [1.9, 1.45, false],
    plate: [1.05, 4.8, false],
    spring: [0.62, 1.1, true],
  }[kind] || [0.42, 3.2, false]
  const [seconds, damp, spring] = spec
  const key = `${context.sampleRate}:kind:${kind}`
  const cached = reverbBuffers.get(key)
  if (cached) return cached
  const len = Math.floor(context.sampleRate * seconds)
  const buf = context.createBuffer(2, len, context.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      const t = i / len
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, damp) * (c === 0 ? 1 : 0.82)
    }
    if (spring) {
      for (const tap of [0.017, 0.029, 0.043]) {
        const at = Math.floor(tap * context.sampleRate)
        if (at < len) data[at] += c === 0 ? 0.65 : -0.5
      }
    }
  }
  reverbBuffers.set(key, buf)
  return buf
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

/** Slot indexes that actually make sound. A `none` slot is a straight wire, so it is left out. */
function liveFx(list) {
  const slots = []
  const types = []
  for (let i = 0; i < list.length; i++) {
    const type = list[i]?.type
    if (!type || type === 'none') continue
    slots.push(i)
    types.push(type)
  }
  return { slots, types, sig: types.join('.') }
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
  const index = busNodes.indexOf(bus)
  const live = liveFx(model.buses[index]?.fx || [])
  const nodes = live.types.map((type) => makeFx(context, type))
  let prev = bus.input
  nodes.forEach((node) => {
    prev.connect(node.input)
    prev = node.output
  })
  prev.connect(bus.fader)
  bus.fx = nodes
  bus.slots = live.slots
  bus.sig = live.sig
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

/** Ramp a param instead of jumping, so a mute or fader move does not click. */
function glideParam(param, value, t) {
  const v = finiteOr(value, 0)
  if (Math.abs(param.value - v) < 1e-6) return
  param.cancelScheduledValues(t)
  param.setTargetAtTime(v, t, 0.012)
}

export function syncMixer(force = false) {
  if (!ctx) return
  ensureBuses()
  const t = ctx.currentTime
  glideParam(master.gain, model.master, t)
  const anySolo = model.buses.some((b) => b.solo)
  model.buses.forEach((b, i) => {
    const node = busNodes[i]
    // Only the bus whose real FX list changed is rebuilt. Empty slots are not nodes.
    const live = liveFx(b.fx)
    if (force || node.sig !== live.sig) connectChain(node, ctx)
    node.fx.forEach((fx, iSlot) => {
      const slot = node.slots ? node.slots[iSlot] : iSlot
      const amount = finiteOr(b.fx[slot]?.amount, 0)
      const key = `${amount}:${model.bpm}`
      if (fx.key === key) return
      fx.key = key
      fx.update(amount)
    })
    const audible = !b.mute && (!anySolo || b.solo)
    glideParam(node.fader.gain, audible ? clamp(finiteOr(b.volume, 0), 0, 1) : 0, t)
    glideParam(node.panner.pan, clamp(finiteOr(b.pan, 0), -1, 1), t)
  })
}

function readMeters() {
  if (!ctx) return
  pruneVoices()
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

function padBuffer(context, entry, reverse) {
  return buffers.get(context, entry, reverse, makeBuffer)
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
  const base = clamp(finiteOr(pad.filter?.cutoff, 18000), 40, 18000)
  const depth = env ? finiteOr(env.depth, 0) : 0
  const attack = Math.max(0.001, env ? finiteOr(env.a, 0.004) : 0.004)
  const decay = Math.max(0.001, env ? finiteOr(env.d, 0.12) : 0.12)
  const sustain = env ? clamp(finiteOr(env.s, 0), 0, 1) : 0
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
  const kind = env?.kind || 'tube'
  const pre = ctx.createGain()
  pre.gain.value = 1 + clamp(amount, 0, 1) * (kind === 'clean' ? 2 : kind === 'fold' ? 3 : 6)
  const sh = ctx.createWaveShaper()
  const drive = Math.max(0.02, amount)
  sh.curve = kind === 'clean' ? curveClean(drive) : kind === 'tape' ? curveTape(drive) : kind === 'fold' ? curveFold(drive) : curveAmp(drive)
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
  const rate = 0.35 + clamp(amount, 0, 1) * 2.4
  const depth = 0.003 + clamp(amount, 0, 1) * 0.006
  const startAt = Math.max(t, ctx.currentTime)
  if (env?.kind === 'mono') {
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = 0.018
    const lfo = ctx.createOscillator()
    const depthNode = ctx.createGain()
    lfo.frequency.value = rate
    depthNode.gain.value = depth
    lfo.connect(depthNode)
    depthNode.connect(delay.delayTime)
    const node = mixAround(input, amount, env, t, total, (wet) => {
      input.connect(delay)
      delay.connect(wet)
    })
    lfo.start(startAt)
    stops.push(() => {
      try { lfo.stop() } catch { /* ended */ }
    })
    return node
  }
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
  if (env?.kind === 'haas') {
    const merge = ctx.createChannelMerger(2)
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = 0.014
    return mixAround(input, amount, env, t, total, (wet) => {
      input.connect(merge, 0, 0)
      input.connect(delay)
      delay.connect(merge, 0, 1)
      merge.connect(wet)
    })
  }
  const spread = env?.kind === 'mid' ? 0.18 : 0.45
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const ll = ctx.createGain()
  const lr = ctx.createGain()
  const rl = ctx.createGain()
  const rr = ctx.createGain()
  ll.gain.value = 1 + spread
  lr.gain.value = -spread
  rl.gain.value = -spread
  rr.gain.value = 1 + spread
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

function reverbSpec(amount, env) {
  const kind = env?.kind
  if (kind === 'room' || kind === 'hall' || kind === 'plate' || kind === 'spring') {
    return { key: kind, buffer: () => coloredImpulse(ctx, kind) }
  }
  const seconds = amount > 0.66 ? 1.7 : amount > 0.33 ? 0.75 : 0.3
  return { key: `sec:${seconds}`, buffer: () => impulse(ctx, seconds) }
}

/** Shared tank for this bus. Convolution is linear, so a send gain matches a constant wet mix. An envelope rings in the tank instead of gating the tail. */
function sharedReverb(busIndex, spec) {
  const key = `${busIndex}:${spec.key}`
  const cached = reverbTanks.get(key)
  if (cached) return cached
  const input = ctx.createGain()
  const conv = ctx.createConvolver()
  conv.buffer = spec.buffer()
  input.connect(conv)
  conv.connect(busNodes[busIndex]?.input || master)
  const tank = { input, conv }
  reverbTanks.set(key, tank)
  return tank
}

function padReverb(input, amount, env, t, total, busIndex, sends) {
  if (!wantsMix(amount, env)) return input
  const dry = ctx.createGain()
  const send = ctx.createGain()
  input.connect(dry)
  input.connect(send)
  send.connect(sharedReverb(busIndex, reverbSpec(amount, env)).input)
  if (sends) sends.push(send)
  scheduleMix(dry, send, env, clamp(amount || 0, 0, 1), t, total)
  return dry
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

/** Unhook a voice after it has gone quiet. Calling this at the start of a fade would cut the fade. */
function dropVoice(v) {
  if (!v || v.dropped) return
  v.dropped = true
  stopExtras(v)
  const sources = []
  if (v.src) sources.push(v.src)
  if (v.srcs) {
    for (const item of v.srcs) {
      if (item?.node && item.node !== v.src) sources.push(item.node)
    }
  }
  for (const src of sources) {
    try { src.stop() } catch { /* already stopped */ }
    try { src.disconnect() } catch { /* already free */ }
  }
  try { v.out?.disconnect() } catch { /* already free */ }
  if (v.sends) {
    for (const send of v.sends) {
      try { send.disconnect() } catch { /* already free */ }
    }
  }
}

function pruneVoices(now) {
  if (!ctx) return
  const t = now == null ? ctx.currentTime : now
  const next = liveVoices(voices, t)
  if (next.length !== voices.length) {
    const stay = new Set(next)
    for (const v of voices) if (!stay.has(v)) dropVoice(v)
    voices = next
  }
  const pat = liveVoices(patternVoices, t)
  if (pat.length !== patternVoices.length) {
    const stay = new Set(pat)
    for (const v of patternVoices) if (!stay.has(v)) dropVoice(v)
    patternVoices = pat
  }
}

function makeRoom() {
  for (const oldest of voicesToFade(voices, VOICE_CAP)) {
    silence(oldest, ctx.currentTime + 0.012, 0.02)
    // A note that is already ending keeps its own tail. Mark it so it no longer counts as sounding.
    oldest.dead = true
    if (oldest.quietAt == null) oldest.quietAt = ctx.currentTime
  }
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
  const sources = v.srcs?.length ? v.srcs.map((item) => item.node) : (v.src ? [v.src] : [])
  for (const src of sources) {
    try { src.stop(end + 0.02) } catch { /* one-shots already scheduled their stop; the gate is what goes quiet */ }
  }
  stopExtras(v, end)
}

export function releaseHeld(id) {
  // The press is still waiting on resume(): it must not start later as a held, looping note.
  const waiting = deferred.get(id)
  if (waiting) waiting.released = true
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
  if (!ctx || (ctx.state === 'suspended' && !opts.resumed && !opts.pattern)) {
    const wait = { token: ++deferSeq, released: false }
    if (opts.holdId) deferred.set(opts.holdId, wait)
    resume().then((ok) => {
      if (opts.holdId) {
        if (deferred.get(opts.holdId) !== wait) return
        deferred.delete(opts.holdId)
      }
      if (!ok) return
      if (!wait.released) return playPad(index, velocity, 0, { ...opts, resumed: true })
      if (opts.trackerNote || opts.pattern || model.pads[index]?.mode === 'oneshot') {
        playPad(index, velocity, 0, { ...opts, holdId: undefined, resumed: true })
      }
    }).catch(() => {
      if (opts.holdId && deferred.get(opts.holdId) === wait) deferred.delete(opts.holdId)
    })
    return
  }
  const entry = getEntry(index)
  if (!entry || !entry.pcm || !entry.pcm.length) return
  // A second press on the same key or note must not orphan the first, which may be looping.
  if (opts.holdId && held.has(opts.holdId)) releaseHeld(opts.holdId)
  const t = when || ctx.currentTime
  if (groupId(pad.choke)) choke(pad.choke, t)
  const buffer = padBuffer(ctx, entry, pad.reverse)
  const semi = finiteOr(pad.pitch, 0) + finiteOr(opts.pitch, 0) + finiteOr(pad.fine, 0) / 100
  const rate = clamp(Math.pow(2, semi / 12), 1 / 64, 64)
  const spec = sampleWindow(buffer.length, pad, opts)
  const grainLoop = !!spec?.loop
  const input = ctx.createGain()
  input.gain.value = 1
  let src = null
  if (!grainLoop) {
    src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    src.connect(input)
  }

  const filter = ctx.createBiquadFilter()
  const filterKind = fxEnv(pad, 'filter')?.kind || pad.filter.type || 'lowpass'
  filter.type = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'].includes(filterKind) ? filterKind : 'lowpass'
  filter.Q.value = clamp(finiteOr(pad.filter.q, 0.7) || 0.7, 0.1, 18)
  filter.gain.value = filter.type === 'lowshelf' || filter.type === 'highshelf' ? 9 : 0
  const amp = ctx.createGain()
  const gate = ctx.createGain()
  gate.gain.value = 1
  const pan = ctx.createStereoPanner()
  pan.pan.value = clamp(finiteOr(pad.pan, 0), -1, 1)

  const startF = clamp(finiteOr(pad.trimStart, 0), 0, 0.98)
  const endF = clamp(finiteOr(pad.trimEnd, 1), startF + 0.01, 1)
  let loopF = Number.isFinite(pad.loopPoint) ? pad.loopPoint : (startF + endF) / 2
  loopF = clamp(loopF, startF, endF - 0.004)
  const sr = buffer.sampleRate
  let offset = startF * buffer.duration
  let end = endF * buffer.duration
  if (spec && !grainLoop) {
    offset = spec.start / sr
    end = Math.min(buffer.duration, (spec.start + spec.lenSamples) / sr)
    if (end - offset < 1 / sr) end = Math.min(buffer.duration, offset + 1 / sr)
  }
  let loopAt = loopF * buffer.duration
  if (end - loopAt < 0.004) loopAt = Math.max(offset, end - 0.004)
  const region = Math.max(grainLoop ? 0.03 : 0.01, end - offset)
  const regionDur = region / rate
  const vel = clamp(finiteOr(velocity, 0), 0, 1) * clamp(finiteOr(pad.volume, 0.85), 0, 1)
  const heldLive = !!opts.holdId && !opts.pattern && !opts.trackerNote
  const kind = samplePlayKind({
    grain: grainLoop,
    pattern: !!opts.pattern,
    trackerNote: !!opts.trackerNote,
    held: heldLive,
    mode: pad.mode || 'oneshot',
  })
  const looping = kind === 'loop'
  const gated = kind === 'gate'
  if (opts.trackerNote) silenceLane(opts.lane ?? 0, t)
  const envTotal = grainLoop ? 3600 : (looping || gated ? Math.max(regionDur, 32) : regionDur)
  const stops = []
  const fx = pad.fx || {}

  let node = ampModel(input, pad, fxEnv(pad, 'amp'), t, envTotal)
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
  const sends = []
  let out = chorus(pan, fx.chorus || 0, fxEnv(pad, 'chorus'), t, envTotal, stops)
  out = widen(out, fx.width || 0, fxEnv(pad, 'width'), t, envTotal)
  out = padReverb(out, fx.reverb || 0, fxEnv(pad, 'reverb'), t, envTotal, pad.bus | 0, sends)
  out.connect(busNodes[pad.bus]?.input || master)

  scheduleFilter(filter, pad, t)
  scheduleAmp(amp, pad.amp, vel, t, envTotal)

  if (!grainLoop) {
    if (looping) {
      src.loop = true
      src.loopStart = heldLive ? loopAt : offset
      src.loopEnd = end
      src.start(t, offset)
    } else if (gated) {
      src.start(t, offset)
    } else {
      src.start(t, offset, region)
      src.stop(t + regionDur + 0.02)
    }
  }

  const voice = {
    src,
    srcs: [],
    input,
    amp,
    gate,
    filter,
    choke: groupId(pad.choke),
    pad: index,
    dead: false,
    quietAt: grainLoop || looping || gated ? null : t + regionDur + 0.03,
    startAt: t,
    pattern: !!opts.pattern,
    lane: opts.pattern || opts.trackerNote ? (opts.lane ?? null) : null,
    heldLoop: looping && heldLive,
    introUntil: t + regionDur,
    peak: Math.max(0.0001, vel * clamp(pad.amp.s ?? 1, 0, 1)),
    stops,
    out,
    sends,
    grain: grainLoop,
    pcm: grainLoop ? buffer.getChannelData(0) : null,
    spec: grainLoop ? spec : null,
    rate,
    sr,
    pos: spec ? spec.start : 0,
    nextAt: t,
    play: {
      dur: buffer.duration,
      offset,
      end,
      loopAt,
      mode: grainLoop ? 'grain' : heldLive && looping ? 'held' : kind === 'loop' ? 'loop' : kind,
      reverse: !!pad.reverse,
    },
  }
  pruneVoices()
  makeRoom()
  voices.push(voice)
  if (opts.pattern || opts.trackerNote) patternVoices.push(voice)
  if (opts.holdId && (looping || gated)) held.set(opts.holdId, voice)
  if (src) {
    src.onended = () => {
      voice.dead = true
      voice.ended = true
      const now = ctx ? ctx.currentTime : 0
      if (voice.quietAt == null) voice.quietAt = now
      stopExtras(voice, now)
    }
  }
  if (grainLoop) pumpGrains()
  flash(index)
  if (!opts.noCapture && !opts.fromSeq && !opts.pattern) captureHit(index, velocity, opts.pitch, t)
}

/** Sample fractions (0–1 of the pad's original audio) for each living voice. */
export function voicePositions(padIndex) {
  if (!ctx) return []
  const now = ctx.currentTime
  const out = []
  for (const v of voices) {
    if (v.pad !== padIndex || !v.play) continue
    if (now + 0.0005 < v.startAt) continue
    if (v.quietAt != null && now >= v.quietAt - 0.0005) continue
    out.push(v.play.mode === 'grain' ? grainFraction(v, now) : bufferFraction(v, now))
  }
  return out
}

function bufferFraction(v, now) {
  return playFraction(v.play, v.startAt, v.rate, now)
}

function grainFraction(v, now) {
  const n = v.pcm?.length || 0
  if (!n) return 0
  let live = null
  const list = v.srcs || []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (now + 0.0001 >= item.at && now < item.until) live = item
  }
  if (!live) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].at <= now) {
        live = list[i]
        break
      }
    }
  }
  let index = v.pos || 0
  if (live && live.samples) {
    const elapsed = Math.max(0, Math.min(live.samples, (now - live.at) * (v.rate || 1) * (v.sr || 44100)))
    index = live.backward ? live.origin - elapsed : live.origin + elapsed
  }
  const buf = (((index % n) + n) % n) / n
  return v.play.reverse ? 1 - buf : buf
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
  const a = Math.max(0.001, finiteOr(env?.a, 0.001))
  const d = Math.max(0.001, finiteOr(env?.d, 0.001))
  const s = clamp(finiteOr(env?.s, 1), 0, 1)
  const r = Math.max(0.005, finiteOr(env?.r, 0.02))
  const peak = Math.max(0.0001, finiteOr(vel, 0.0001))
  const sus = Math.max(0.0001, peak * s)
  total = Math.max(0, finiteOr(total, 0))
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

/** Anchored to the last fired step, so a tempo change mid-take does not shift the grid. */
function locateHit(time) {
  if (!started) return null
  return locateStep(time, anchor, stepSeconds(model.bpm), stepCount(), !!model.recNatural)
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
  o.onended = () => {
    try { o.disconnect() } catch { /* free */ }
    try { g.disconnect() } catch { /* free */ }
  }
}

function silenceLane(lane, when) {
  for (const v of patternVoices) {
    if (v.lane === lane && !v.ended) silence(v, when, 0.012)
  }
}

function fireStep(step, time) {
  const seq = currentSequence()
  const events = seq.steps[step] || []
  const base = stepSeconds(model.bpm)
  events.forEach((ev, lane) => {
    if (!ev) return
    // One bad event (from a hand-edited or damaged file) must not stop the clock.
    try {
      const nudge = (clamp(finiteOr(ev.nudge, 0), -50, 50) / 100) * base
      const when = time + nudge
      silenceLane(lane, when)
      if (ev.off) return
      playPad(ev.pad, clamp(finiteOr(ev.vel, 0.9), 0, 1), when, {
        pitch: finiteOr(ev.pitch, 0),
        fromSeq: true,
        pattern: true,
        lane,
        sl: ev.sl,
        move: ev.move,
        len: ev.len,
      })
    } catch (err) {
      console.warn('skipped a step event', err)
    }
  })
  if (model.metro && step % 4 === 0) click(time, step % 16 === 0)
  model.playhead = step
  if (step % 2 === 0) touch(false)
}

function haltClock() {
  model.playing = false
  started = false
  window.clearInterval(timer)
  touch(false)
}

/** True when play-once has finished and the clock should stop without cutting the last notes. */
function advanceSong() {
  const order = model.songOrder
  if (!model.songPlay || !Array.isArray(order) || !order.length) return false
  const next = nextSongCursor(model.songCursor || 0, order.length, model.songLoop || 'wrap')
  if (next < 0) {
    model.songPlay = false
    haltClock()
    return true
  }
  model.songCursor = next
  model.pattern = order[next] | 0
  return false
}

/** Jump to a queued cell at this step. The step time stays where it is. */
function takeLaunch() {
  if (model.launchCursor == null) return false
  const order = model.songOrder
  const at = model.launchCursor | 0
  model.launchCursor = null
  if (!model.songPlay || !Array.isArray(order) || !order.length) return false
  model.songCursor = Math.max(0, Math.min(order.length - 1, at))
  model.pattern = order[model.songCursor] | 0
  nextStep = 0
  return true
}

/** Launch a cell on the next step. From stop, Play starts on that cell. */
export async function launchSongSection(index) {
  const order = model.songOrder
  if (!Array.isArray(order) || !order.length) return
  const at = Math.max(0, Math.min(order.length - 1, index | 0))
  model.songPlay = true
  if (model.playing) {
    model.launchCursor = at
    touch(false)
    return
  }
  model.songCursor = at
  model.pattern = order[at] | 0
  model.launchCursor = null
  // The first tap in a session is what wakes the audio context. Play cannot start before that.
  if (!(await resume())) return
  startTransport({ keepCursor: true })
}

function pumpGrains() {
  if (!ctx) return
  const horizon = ctx.currentTime + 0.2
  for (const v of voices) {
    if (!v.grain || v.dead || !v.pcm) continue
    v.srcs = v.srcs.filter((item) => {
      if (item.until > ctx.currentTime - 0.05) return true
      try { item.node.disconnect() } catch { /* ended */ }
      return false
    })
    let guard = 0
    while (v.nextAt < horizon && guard < 8) {
      const minSamples = Math.max(v.spec.lenSamples, Math.round(0.03 * v.sr))
      const origin = v.pos
      const backward = !!v.spec.backward
      const chunk = stitchGrains(v.pcm, v.pos, v.spec.lenSamples, v.spec.moveSamples, v.spec.backward, minSamples, true)
      if (!chunk.pcm.length) break
      const audio = ctx.createBuffer(1, chunk.pcm.length, v.sr)
      audio.getChannelData(0).set(chunk.pcm)
      const node = ctx.createBufferSource()
      node.buffer = audio
      node.playbackRate.value = v.rate
      node.connect(v.input)
      const when = Math.max(v.nextAt, ctx.currentTime)
      node.start(when)
      const dur = (chunk.pcm.length / v.sr) / Math.max(0.001, v.rate)
      v.nextAt = when + dur
      v.pos = chunk.pos
      v.src = node
      v.srcs.push({ node, until: v.nextAt, at: when, origin, samples: chunk.pcm.length, backward })
      guard += 1
    }
  }
}

function scheduler() {
  if (!ctx || !model.playing) return
  postNumpadClock()
  pumpGrains()
  const now = ctx.currentTime
  pruneVoices(now)
  patternVoices = liveVoices(patternVoices, now)
  const horizon = now + 0.12
  const base = stepSeconds(model.bpm)
  const swing = clamp(finiteOr(model.swing, 0), 0, 0.75)
  // A throttled background tab can fall seconds behind: skip to now instead of firing every missed step at once.
  const skip = stepsBehind(nextTime, now, base)
  if (skip) {
    const n = Math.max(1, stepCount(currentSequence()))
    const total = nextStep + skip
    nextStep = total % n
    if (total >= n) {
      if (!takeLaunch() && advanceSong()) return
    }
    nextTime += skip * base
  }
  let guard = 0
  while (nextTime < horizon && guard < 64) {
    guard += 1
    if (model.launchCursor != null) takeLaunch()
    const seq = currentSequence()
    const n = Math.max(1, stepCount(seq))
    if (nextStep >= n) nextStep = 0
    const swung = nextTime + (nextStep % 2 === 1 ? base * swing : 0)
    anchor = { step: nextStep, time: nextTime }
    try {
      fireStep(nextStep, swung)
    } catch (err) {
      console.warn('step failed', err)
    }
    nextStep += 1
    if (nextStep >= n) {
      nextStep = 0
      if (!takeLaunch() && advanceSong()) return
    }
    nextTime += base
  }
}

export async function togglePlay() {
  if (!(await resume())) return
  if (model.playing) stopTransport()
  else startTransport()
}

export function startTransport(opts = {}) {
  if (!ctx) return
  if (model.playing) return
  patternVoices.forEach((v) => silence(v, ctx.currentTime, 0.02))
  patternVoices = []
  model.playing = true
  started = true
  nextTime = ctx.currentTime + 0.05
  nextStep = 0
  anchor = { step: 0, time: nextTime }
  model.launchCursor = null
  if (model.songPlay && Array.isArray(model.songOrder) && model.songOrder.length) {
    if (!opts.keepCursor) model.songCursor = 0
    const at = Math.max(0, Math.min(model.songOrder.length - 1, model.songCursor | 0))
    model.songCursor = at
    model.pattern = model.songOrder[at] | 0
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
  if (!(await resume())) return
  model.recording = !model.recording
  if (model.recording && !model.playing) startTransport()
  touch(false)
}

export function toggleMetro() {
  model.metro = !model.metro
  touch(false)
}

export async function previewPcm(pcm, sr = 44100) {
  if (!(await resume())) return
  const buffer = ctx.createBuffer(1, pcm.length, sr)
  buffer.getChannelData(0).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = 0.8
  src.connect(g)
  g.connect(master)
  src.start()
  src.onended = () => {
    try { src.disconnect() } catch { /* free */ }
    try { g.disconnect() } catch { /* free */ }
  }
}

export function noteOn(index, velocity, holdId, pitch, extra) {
  const pad = model.pads[index]
  if (!pad) return
  if (holdId && held.has(holdId)) releaseHeld(holdId)
  const opts = { holdId, ...(extra || {}) }
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

/** Hold ids with a sounding voice or a start still waiting on resume(). */
export function heldNotes() {
  return [...held.keys(), ...deferred.keys()]
}

export function releaseKeyboardNotes() {
  for (const id of [...held.keys()]) {
    if (String(id).startsWith('key:')) releaseHeld(id)
  }
}

function laneHold(seq, step, lane, base) {
  const n = stepCount(seq)
  for (let i = 1; i < n - step; i++) {
    if (seq.steps[step + i]?.[lane]) return i * base
  }
  return Math.max(base, (n - step) * base)
}

function scheduleGrains(context, dest, pcm, sr, rate, spec, t0, hold) {
  let pos = spec.start
  let at = t0
  const endAt = t0 + Math.max(0.01, hold)
  let guard = 0
  while (at < endAt - 0.0004 && guard < 400) {
    const minSamples = Math.max(spec.lenSamples, Math.round(0.03 * sr))
    const chunk = stitchGrains(pcm, pos, spec.lenSamples, spec.moveSamples, spec.backward, minSamples, true)
    if (!chunk.pcm.length) break
    const audio = context.createBuffer(1, chunk.pcm.length, sr)
    audio.getChannelData(0).set(chunk.pcm)
    const node = context.createBufferSource()
    node.buffer = audio
    node.playbackRate.value = rate
    node.connect(dest)
    const dur = (chunk.pcm.length / sr) / Math.max(0.001, rate)
    node.start(Math.max(0, at))
    if (at + dur > endAt) {
      try { node.stop(Math.max(0, endAt)) } catch { /* past the hold */ }
    }
    at += dur
    pos = chunk.pos
    guard += 1
  }
}

/** What the WAV bounce plays and what it leaves out. Shown after a bounce. */
export const BOUNCE_NOTE = 'WAV has the song order, swing, volume and pan. Bus FX, pad FX and filters, envelopes, chokes and the master compressor are not in it.'
export const BOUNCE_MAX_SECONDS = 600

/** How long the bounce of `order` runs, in seconds: every pattern's steps at this tempo, plus the tail. */
export function bounceSeconds(order = bounceOrder(), bpm = model.bpm) {
  const base = stepSeconds(bpm)
  let steps = 0
  for (const id of order) steps += stepCount(ensurePattern(id))
  return steps * base + 0.6
}

function clock(seconds) {
  const s = Math.ceil(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The patterns a bounce plays: the song order when the song is playing, else the open pattern. */
export function bounceOrder() {
  const order = Array.isArray(model.songOrder) ? model.songOrder.map((n) => (n | 0) & 255) : []
  if (model.songPlay && order.length) return order
  return [model.pattern | 0]
}

export async function renderBounce() {
  await resume()
  const order = bounceOrder()
  const base = stepSeconds(model.bpm)
  const swing = clamp(finiteOr(model.swing, 0), 0, 0.75)
  const seconds = bounceSeconds(order, model.bpm)
  // A bounce cut short would be published or downloaded as if it were the song. Refuse it instead.
  if (seconds > BOUNCE_MAX_SECONDS) {
    throw new Error(`The song order runs ${clock(seconds)}; a WAV bounce holds ${clock(BOUNCE_MAX_SECONDS)}. Shorten the order (or play one pattern) and bounce again.`)
  }
  const sr = 44100
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr)
  const local = createBufferCache()
  const dest = off.createGain()
  dest.gain.value = clamp(finiteOr(model.master, 0.9), 0, 1)
  const anySolo = model.buses.some((x) => x.solo)
  const buses = model.buses.map((b) => {
    const g = off.createGain()
    const audible = !b.mute && (!anySolo || b.solo)
    g.gain.value = audible ? clamp(finiteOr(b.volume, 0), 0, 1) : 0
    const pan = off.createStereoPanner()
    pan.pan.value = clamp(finiteOr(b.pan, 0), -1, 1)
    g.connect(pan)
    pan.connect(dest)
    return g
  })
  dest.connect(off.destination)
  let time = 0.05
  for (const id of order) {
    const seq = ensurePattern(id)
    const count = stepCount(seq)
    for (let step = 0; step < count; step++) {
      if (time > seconds) break
      const when = time + (step % 2 === 1 ? base * swing : 0)
      ;(seq.steps[step] || []).forEach((ev, lane) => {
        if (!ev || ev.off) return
        try {
          bounceHit(off, local, buses, dest, seq, step, lane, ev, when, base)
        } catch (err) {
          console.warn('bounce skipped an event', err)
        }
      })
      time += base
    }
  }
  const rendered = await off.startRendering()
  const left = rendered.getChannelData(0).slice()
  const right = rendered.getChannelData(1).slice()
  const limited = limitStereo(left, right, rendered.sampleRate)
  model.browserNote = BOUNCE_NOTE
  touch(false)
  return encodeWav([limited.left, limited.right], rendered.sampleRate)
}

function bounceHit(off, cache, buses, dest, seq, step, lane, ev, when, base) {
  const pad = model.pads[ev.pad]
  const entry = audioBank.get(ev.pad)
  if (!pad || !entry?.pcm?.length || pad.source === 'empty' || !padAudible(pad)) return
  const buffer = cache.get(off, entry, pad.reverse, makeBuffer)
  const nudge = (clamp(finiteOr(ev.nudge, 0), -50, 50) / 100) * base
  const spec = sampleWindow(buffer.length, pad, ev)
  const semi = finiteOr(pad.pitch, 0) + finiteOr(ev.pitch, 0) + finiteOr(pad.fine, 0) / 100
  const rate = clamp(Math.pow(2, semi / 12), 1 / 64, 64)
  const amp = off.createGain()
  amp.gain.value = clamp(finiteOr(ev.vel, 0.9), 0, 1) * clamp(finiteOr(pad.volume, 0.85), 0, 1)
  const pan = off.createStereoPanner()
  pan.pan.value = clamp(finiteOr(pad.pan, 0), -1, 1)
  amp.connect(pan)
  pan.connect(buses[pad.bus] || dest)
  const at = Math.max(0, when + nudge)
  if (spec?.loop) {
    scheduleGrains(off, amp, buffer.getChannelData(0), buffer.sampleRate, rate, spec, at, laneHold(seq, step, lane, base))
    return
  }
  const src = off.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate
  src.connect(amp)
  if (spec) {
    const offset = spec.start / buffer.sampleRate
    const region = Math.max(1 / buffer.sampleRate, Math.min(spec.lenSamples / buffer.sampleRate, buffer.duration - offset))
    src.start(at, offset, region)
  } else {
    const startF = clamp(finiteOr(pad.trimStart, 0), 0, 0.99)
    const offset = startF * buffer.duration
    const end = clamp(finiteOr(pad.trimEnd, 1), startF + 0.01, 1) * buffer.duration
    src.start(at, offset, Math.max(0.01, end - offset))
  }
}

export async function bounceWav() {
  const blob = await renderBounce()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'miya-music-maker.wav'
  a.click()
  const href = a.href
  window.setTimeout(() => URL.revokeObjectURL(href), 30000)
}

let midiAccess = null
let midiPromise = null
const midiState = { supported: null, ready: false, denied: false, inputs: [], last: '' }

export function getMidiState() {
  return midiState
}

function portKey(port) {
  return port?.id || port?.name || 'midi'
}

/** Notes held from a controller that was unplugged would otherwise loop forever. */
function releaseMidiPort(portId) {
  for (const id of heldForPort([...held.keys()], portId)) releaseHeld(id)
}

function refreshMidiPorts(event) {
  if (!midiAccess) return
  const gone = event?.port
  if (gone && gone.type === 'input' && gone.state === 'disconnected') {
    releaseMidiPort(portKey(gone))
    try { gone.onmidimessage = null } catch { /* port is gone */ }
  }
  const before = midiState.inputs.map((input) => input.key)
  const live = [...midiAccess.inputs.values()].filter((input) => input.state !== 'disconnected')
  midiState.inputs = live.map((input) => {
    input.onmidimessage = onMidi
    return { id: input.id, key: portKey(input), name: input.name || 'MIDI in', layout: midiLayout(input.name || '') }
  })
  const now = new Set(midiState.inputs.map((input) => input.key))
  before.forEach((key) => {
    if (!now.has(key)) releaseMidiPort(key)
  })
  midiState.ready = true
  midiState.supported = true
  midiState.last = midiState.inputs.length ? midiState.inputs.map((input) => input.name).join(', ') : 'No MIDI input yet'
  touch(false)
}

export function enableMidi() {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    midiState.supported = false
    midiState.ready = true
    midiState.denied = false
    midiState.last = 'Web MIDI is not available in this browser'
    touch(false)
    return Promise.resolve(midiState)
  }
  if (midiAccess) {
    midiAccess.onstatechange = refreshMidiPorts
    refreshMidiPorts()
    return Promise.resolve(midiState)
  }
  if (midiPromise) return midiPromise
  midiPromise = navigator.requestMIDIAccess({ sysex: false }).then((access) => {
    if (!active) {
      midiPromise = null
      return midiState
    }
    midiAccess = access
    midiState.denied = false
    access.onstatechange = refreshMidiPorts
    refreshMidiPorts()
    return midiState
  }).catch((err) => {
    midiPromise = null
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
    midiState.supported = true
    midiState.ready = true
    midiState.denied = denied
    midiState.last = denied ? 'MIDI permission was blocked' : `MIDI did not start${err?.message ? `: ${err.message}` : ''}`
    touch(false)
    return midiState
  })
  return midiPromise
}

export function onMidi(event) {
  const data = event?.data
  if (!data || data.length < 2) return
  const status = data[0]
  const note = data[1]
  const velocityByte = data.length > 2 ? data[2] : 0
  const cmd = status & 0xf0
  if (cmd !== 0x80 && cmd !== 0x90) return
  const port = event.target
  const portId = portKey(port)
  const holdId = `midi:${portId}:${note}`
  if (cmd === 0x80 || velocityByte === 0) {
    releaseHeld(holdId)
    return
  }
  const action = midiAction({
    note,
    layout: midiLayout(port?.name || ''),
    keys: !!model.keyboard,
    offset: model.settings.midiOffset || 36,
  })
  if (!action) return
  const vel = model.settings.velocity ? velocityByte / 127 : 1
  if (model.screen === 'track' && model.tracker.edit) {
    const live = !!(model.playing && model.tracker.follow && started && ctx)
    let row = model.tracker.row | 0
    let nudge = 0
    let write = true
    if (live) {
      const hit = locateHit(ctx.currentTime)
      if (!hit) write = false
      else {
        row = hit.step
        nudge = hit.nudge
      }
    }
    if (write) {
      commitTrackerNote({
        pad: 'pad' in action ? action.pad : model.selected,
        vel,
        pitch: 'pitch' in action ? action.pitch : 0,
        row,
        nudge,
        live,
      })
    }
  }
  const onTrack = model.screen === 'track'
  const track = onTrack ? { trackerNote: true, lane: Math.floor((model.tracker.col || 0) / trackerFields()) } : {}
  if ('pad' in action) {
    if (model.selected !== action.pad || model.selection.length) selectPad(action.pad)
    playPad(action.pad, vel, 0, { holdId, noCapture: onTrack, ...track })
  } else {
    playPad(model.selected, vel, 0, { pitch: action.pitch, holdId, noCapture: onTrack, ...track })
  }
  midiState.last = `${port?.name || 'MIDI'} note ${note}`
}

/**
 * A take is aimed at the pad selected when Rec was pressed, in the song open then. While one is starting
 * (resume or the permission prompt), another press is refused, so no recorder or stream is orphaned.
 */
function beginStart(label) {
  if (starting) return null
  starting = { label, cancelled: false, gen: life, target: { pad: model.selected, song: songId() } }
  touch(false)
  return starting
}

function endStart(pending) {
  if (starting === pending) starting = null
  touch(false)
}

function startFailed(err, label) {
  console.warn(`${label} did not start`, err)
  model.browserNote = err?.name === 'NotAllowedError' ? 'Microphone permission was blocked' : `${label === 'mic' ? 'Mic' : 'Resample'} did not start${err?.message ? `: ${err.message}` : ''}`
}

export async function recordMic() {
  if (starting) return
  if (recording?.label === 'mic') return stopRecorder()
  const pending = beginStart('mic')
  try {
    if (!(await resume()) || pending.cancelled) return
    if (recording) await stopRecorder()
    if (pending.cancelled || !alive(pending.gen)) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
    })
    if (pending.cancelled || !alive(pending.gen)) {
      // The window closed during the prompt: this stream must not keep the mic open.
      stopTracks(stream)
      return
    }
    startRecorder(stream, 'mic', null, pending.target)
  } catch (err) {
    startFailed(err, 'mic')
  } finally {
    endStart(pending)
  }
}

export async function resample(which = 'main') {
  if (starting) return
  const busIndex = which === 'main' ? -1 : Number(which)
  const label = which === 'main' ? 'resample' : `bus ${busIndex}`
  if (recording?.label === label) return stopRecorder()
  const pending = beginStart(label)
  try {
    if (!(await resume()) || pending.cancelled) return
    if (recording) await stopRecorder()
    if (pending.cancelled || !alive(pending.gen)) return
    const tap = ctx.createMediaStreamDestination()
    if (which === 'main') limiter.connect(tap)
    else if (busNodes[busIndex]) busNodes[busIndex].panner.connect(tap)
    startRecorder(tap.stream, label, () => {
      try {
        if (which === 'main') limiter.disconnect(tap)
        else busNodes[busIndex]?.panner.disconnect(tap)
      } catch {
        /* already disconnected */
      }
    }, pending.target)
  } catch (err) {
    startFailed(err, label)
  } finally {
    endStart(pending)
  }
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((tr) => {
    try { tr.stop() } catch { /* already ended */ }
  })
}

function startRecorder(stream, label, cleanup, target = { pad: model.selected, song: songId() }) {
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  let rec
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch (err) {
    if (label === 'mic') stopTracks(stream)
    if (cleanup) cleanup()
    throw err
  }
  const chunks = []
  const current = { rec, label, stream, cleanup, done: null, finish: null, discard: false, released: false }
  const release = () => {
    if (current.released) return
    current.released = true
    if (label === 'mic') stopTracks(stream)
    if (cleanup) {
      try { cleanup() } catch { /* tap already gone */ }
    }
  }
  current.release = release
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  rec.onstop = async () => {
    try {
      release()
      if (current.discard || !ctx) return
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const arr = await blob.arrayBuffer()
      const audio = await ctx.decodeAudioData(arr.slice(0))
      let pcm = new Float32Array(audio.length)
      const chs = audio.numberOfChannels
      for (let c = 0; c < chs; c++) {
        const data = audio.getChannelData(c)
        for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / chs
      }
      if (!pcm.length) throw new Error('That recording was empty')
      let trim = { start: 0, end: 1 }
      if (model.settings.autoTrim) trim = trimSilence(pcm, audio.sampleRate)
      // A take is held to the same length as an import, so one long take cannot fill a song's sample room.
      const cap = Math.floor(audio.sampleRate * TAKE_SECONDS)
      const from = Math.floor(trim.start * pcm.length)
      const to = Math.ceil(trim.end * pcm.length)
      let cut = false
      if (to - from > cap || pcm.length > cap * 2) {
        const end = Math.min(pcm.length, from + cap, Math.max(from + 1, to))
        pcm = pcm.slice(from, end)
        trim = { start: 0, end: 1 }
        cut = to - from > cap
      }
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
      try {
        await rememberSample(target.pad, {
          pcm,
          sr: audio.sampleRate,
          name: label,
          song: target.song,
          padPatch: { trimStart: trim.start, trimEnd: trim.end },
        })
        const left = budgetNote()
        model.browserNote = `${label} take on pad ${target.pad + 1}${cut ? `, cut to ${TAKE_SECONDS} s` : ''}${left ? `. ${left}` : ''}`
      } catch (err) {
        if (!(err instanceof SongChanged)) throw err
        // Another song was opened during the take. It is kept in Imports, not written into that song.
        ensureLibrary()
        await cachePcm('imports', `${label} take`, pcm, audio.sampleRate, 'wav')
        model.browserNote = `The song changed during the take. ${label} take is in Imports.`
      }
    } catch (err) {
      console.warn('recording failed', err)
      model.browserNote = err?.message ? `Recording not kept: ${err.message}` : 'Recording not kept'
    } finally {
      // Whatever happened above, the next Rec press must start a fresh take.
      if (recording === current) recording = null
      if (current.finish) current.finish()
      touch(false)
    }
  }
  rec.onerror = () => {
    try {
      if (rec.state !== 'inactive') rec.stop()
    } catch { /* onstop still runs */ }
  }
  rec.start()
  recording = current
  touch(false)
}

export function isRecordingAudio() {
  return !!recording
}

export function audioRecordLabel() {
  return recording ? recording.label : ''
}

/** The label of a Mic or Resample press still waiting to start, or ''. */
export function audioStartingLabel() {
  return starting ? starting.label : ''
}

function stopRecorder() {
  const current = recording
  if (!current) return Promise.resolve()
  if (current.done) return current.done
  current.done = new Promise((resolve) => {
    current.finish = resolve
  })
  let stopped = false
  try {
    if (current.rec.state !== 'inactive') {
      current.rec.stop()
      stopped = true
    }
  } catch {
    /* recorder already broke */
  }
  if (!stopped) {
    // No onstop is coming. Clear it here so the next take is not blocked by a dead recorder.
    current.release()
    if (recording === current) recording = null
    current.finish()
    touch(false)
  }
  return current.done
}

export function stopAudioRecord() {
  return stopRecorder()
}

/** The window is open again. The context itself is resumed on the next sound. */
export function wakeEngine() {
  active = true
}

/**
 * Window closed: stop the clock, every voice, the recorder and the mic, unhook MIDI, and park the
 * context. The graph is kept, so reopening only needs resume().
 */
export function shutdown() {
  active = false
  life += 1
  model.hold = null
  deferred.clear()
  if (starting) {
    // Its stream may still arrive from the permission prompt. recordMic stops it when it does.
    starting.cancelled = true
    starting = null
  }
  try {
    stopTransport()
  } catch { /* nothing was playing */ }
  model.playing = false
  model.recording = false
  window.clearInterval(timer)
  timer = 0
  window.clearInterval(meterTimer)
  meterTimer = 0
  const current = recording
  if (current) {
    current.discard = true
    current.release()
    try {
      if (current.rec.state !== 'inactive') current.rec.stop()
    } catch { /* already stopped */ }
    recording = null
    current.finish?.()
  }
  for (const id of [...held.keys()]) {
    try { releaseHeld(id) } catch { /* ended */ }
  }
  held.clear()
  if (ctx) {
    const now = ctx.currentTime
    for (const v of voices) {
      try { silence(v, now, 0.005) } catch { /* ended */ }
      dropVoice(v)
    }
  }
  voices = []
  patternVoices = []
  anchor = null
  started = false
  model.fxHeld = -1
  pushNumpadFx(-1)
  if (midiAccess) {
    midiAccess.onstatechange = null
    for (const input of midiAccess.inputs.values()) {
      try { input.onmidimessage = null } catch { /* port is gone */ }
    }
  }
  midiState.inputs = []
  flushSave()
  if (ctx && ctx.state !== 'closed') ctx.suspend().catch(() => {})
}

function numpadTempo() {
  const tempo = model.bpm
  return tempo >= 20 && tempo <= 300 ? tempo : 96
}

/** Audio time of step 0, so a held repeat lands on the song grid. Null while the transport is stopped. */
function numpadOrigin() {
  if (!ctx || !model.playing || !anchor || !Number.isFinite(anchor.time)) return null
  const origin = anchor.time - (anchor.step | 0) * stepSeconds(model.bpm)
  return Number.isFinite(origin) ? origin : null
}

function postNumpadClock() {
  if (!numpadFx || !(model.fxHeld >= 0)) return
  numpadFx.port.postMessage({
    bpm: numpadTempo(),
    origin: numpadOrigin(),
  })
}

export function pushNumpadFx(held = model.fxHeld) {
  if (!numpadFx) return
  numpadFx.port.postMessage({
    slots: model.numpadFx,
    bpm: numpadTempo(),
    held: Number.isFinite(held) ? held : -1,
    origin: numpadOrigin(),
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

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)(\?|#|$)/i

/** A video container by name or by its first bytes (ISO BMFF ftyp, or the EBML header of WebM). */
export function looksLikeVideo(arrayBuffer, name) {
  if (VIDEO_EXT.test(String(name || ''))) return true
  const b = new Uint8Array(arrayBuffer, 0, Math.min(12, arrayBuffer.byteLength))
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true
  return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
}

async function decodeAny(arrayBuffer, name) {
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer.slice(0))
    return mixdown(audio)
  } catch {
    // Only a video gets the slow path (play it and record the sound). Anything else fails now, not in 90 s.
    if (!looksLikeVideo(arrayBuffer, name)) throw new Error('That file is not audio or video this browser can read')
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

const VIDEO_DECODE_MS = 90000

function decodeVideoBytes(arrayBuffer, name) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: mimeFromName(name) })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.src = url
    video.playsInline = true
    video.volume = 0
    let settled = false
    let rec = null
    // A file the browser half-understands can sit forever without loadeddata or error.
    const timeout = window.setTimeout(() => {
      fail(new Error('Reading audio from that file took too long'))
    }, VIDEO_DECODE_MS)
    const fail = (error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      try { video.pause() } catch { /* not playing */ }
      try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* already stopped */ }
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
      reject(error instanceof Error ? error : new Error('Could not read audio from that file'))
    }
    const done = (value) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve(value)
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
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        const chunks = []
        rec.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        rec.onstop = async () => {
          if (settled) return
          try {
            const recorded = await new Blob(chunks, { type: rec.mimeType || 'audio/webm' }).arrayBuffer()
            const audio = await ctx.decodeAudioData(recorded.slice(0))
            done(mixdown(audio))
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

const MEDIA_FETCH_MS = 45000

/** Bytes of a remote sample, never more than SAMPLE_MEDIA_LIMIT, and given up on after MEDIA_FETCH_MS. */
export async function fetchMediaBytes(url, fetchImpl = fetch) {
  const opts = { limit: SAMPLE_MEDIA_LIMIT, timeoutMs: MEDIA_FETCH_MS, fetchImpl }
  try {
    const direct = await fetchCapped(url, opts)
    if (direct.buffer) return direct.buffer
  } catch (err) {
    // Too big is too big on the proxy as well. CORS or a network block: the proxy is the second try.
    if (err?.name === 'TooLarge') throw err
  }
  const proxied = await fetchCapped(`${SAMPLE_MEDIA_PATH}?url=${encodeURIComponent(url)}`, opts)
  if (!proxied.buffer) {
    if (proxied.res.status === 429) throw new Error('Too many requests to the sample reader: wait a moment and try again.')
    const allowed = allowedMediaUrl(url)
    throw new Error(allowed
      ? 'That file is listed, but the host blocked the browser from reading it. Drop the file on the window, or link the folder that has it.'
      : 'Could not read that file')
  }
  return proxied.buffer
}

/**
 * Put decoded audio on a pad and in the library. `song` is the songId() from when the import started:
 * if another song was opened since, the sound only goes to the library.
 */
export async function placePcm(index, pcm, sr, name, { folder = 'imports', forceName = false, ext = 'wav', song = null } = {}) {
  beginUndo()
  try {
    let onPad = true
    try {
      await rememberSample(index, { pcm, sr, name, forceName, song, padPatch: { trimStart: 0, trimEnd: 1 } })
      model.selected = index
    } catch (err) {
      if (!(err instanceof SongChanged)) throw err
      onPad = false
    }
    ensureLibrary()
    await cachePcm(folder, name, pcm, sr, ext)
    const left = onPad ? budgetNote() : ''
    model.browserNote = onPad ? `${name} on pad ${index + 1}${left ? `. ${left}` : ''}` : `The song changed during the import. ${name} is in the library, not on a pad.`
    touch(true)
  } finally {
    endUndo()
  }
}

/** `song` defaults to the song open now. A batch passes the one from when it started. */
export async function importFile(file, index = model.selected, song = songId()) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'k1t') {
    await importKitFile(file)
    return
  }
  if (ext === 'm1ya' || ext === 'mod' || ext === 'xm') {
    await importSongFile(file, loadTicket())
    return
  }
  await resume()
  const arr = await file.arrayBuffer()
  const decoded = await decodeAny(arr, file.name)
  const name = file.name.replace(/\.[^.]+$/, '')
  // Same trim and length cap as the cache, so a long file still fits in a saved song.
  const fitted = fitSample(decoded.pcm, decoded.sr)
  if (!fitted.pcm.length) throw new Error('That file has no audio')
  await placePcm(index, fitted.pcm, fitted.sr, name, { forceName: true, ext, song })
}

export async function importRemote(url, index = model.selected, name = 'nft') {
  const song = songId()
  await resume()
  model.browserNote = `Reading ${name}`
  touch(false)
  const bytes = await fetchMediaBytes(url)
  const decoded = await decodeAny(bytes, url)
  const fitted = fitSample(decoded.pcm, decoded.sr)
  if (!fitted.pcm.length) throw new Error('That file has no audio')
  await placePcm(index, fitted.pcm, fitted.sr, name, { forceName: true, ext: 'wav', song })
}

const SAMPLE_SECONDS = 16
const TAKE_SECONDS = SAMPLE_SECONDS

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
  scrubPcm(out)
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

export async function readVideoLink(raw) {
  const page = videoPage(String(raw || '').trim())
  if (!page) throw new Error('Use a YouTube, Odysee, LBRY, or X link.')
  const hint = urlSampleHint(raw)
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
  let name = hint.name || 'video'
  try {
    name = decodeURIComponent(header || '') || name
  } catch {
    name = header || name
  }
  const bytes = await res.arrayBuffer()
  const decoded = await decodeAny(bytes, `${name}.webm`)
  const sr = decoded.sr || 44100
  const seconds = decoded.pcm.length / sr
  return {
    pcm: decoded.pcm,
    sr,
    name: sampleTitle(name),
    seconds,
    capped: bytes.byteLength >= VIDEO_FETCH_CAP - 4096,
    hint,
  }
}

function peakNorm(pcm) {
  if (!model.settings.autoNorm || !pcm?.length) return pcm
  let peak = 0
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]))
  if (peak <= 0.001) return pcm
  const gain = 0.98 / peak
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain
  return out
}

async function cacheShaped(pcm, sr, name) {
  const title = sampleTitle(name)
  const out = peakNorm(pcm)
  ensureLibrary()
  await cachePcm('imports', title, out, sr || 44100, 'wav')
  return { title, pcm: out, sr: sr || 44100 }
}

/**
 * Keep a cropped video take. `where` is `cache`, `pad`, or `slices`.
 * One pad is capped at 16 seconds. Slices split the crop and each piece is capped the same way.
 */
export async function commitVideoSample(take, opts = {}) {
  if (!take?.pcm?.length) throw new Error('That video has no audio')
  const song = songId()
  const name = sampleTitle(opts.name || take.name)
  const pad = Math.max(0, Math.min(63, (opts.pad ?? model.selected) | 0))
  if (opts.where === 'slices') {
    const cut = sliceSpan(take.pcm, take.sr, opts)
    beginUndo()
    try {
      for (let i = 0; i < cut.pieces.length; i++) {
        const piece = peakNorm(cut.pieces[i].pcm)
        const at = (pad + i) % 64
        await rememberSample(at, {
          pcm: piece,
          sr: cut.pieces[i].sr,
          name: cut.pieces.length > 1 ? `${name} ${i + 1}` : name,
          forceName: true,
          song,
          padPatch: { trimStart: 0, trimEnd: 1, mode: 'oneshot' },
        })
        ensureLibrary()
        await cachePcm('imports', cut.pieces.length > 1 ? `${name} ${i + 1}` : name, piece, cut.pieces[i].sr, 'wav')
      }
      model.selected = pad
      const left = budgetNote()
      const tail = cut.clipped ? ' Each slice keeps 16 seconds.' : ''
      model.browserNote = `${cut.count} slices from ${name} on pad ${pad + 1}${tail}${left ? ` ${left}` : ''}`
      touch(true)
      return { count: cut.count, clipped: cut.clipped }
    } finally {
      endUndo()
    }
  }
  const shaped = shapeSample(take.pcm, take.sr, opts)
  const audio = peakNorm(shaped.pcm)
  if (!audio.length) throw new Error('That crop is empty')
  if (opts.where === 'pad') {
    await placePcm(pad, audio, shaped.sr, name, { forceName: true, song })
    if (shaped.clipped) {
      model.browserNote = `${name} on pad ${pad + 1}. Kept 16 seconds from the in point.`
      touch(true)
    }
    return { clipped: shaped.clipped, seconds: shaped.seconds }
  }
  const stored = await cacheShaped(audio, shaped.sr, name)
  const clip = shaped.clipped ? ' Kept 16 seconds from the in point.' : ''
  model.browserNote = `${stored.title} is in Cache.${clip} Load it onto a pad to keep it in a song.`
  touch(true)
  return { clipped: shaped.clipped, seconds: shaped.seconds }
}

/** Copy the trimmed span onto the next empty pad. The original sample stays. */
export async function chopSelection(index = model.selected) {
  const song = songId()
  if (!(await resume())) throw new Error('The instrument closed before the chop could copy')
  const entry = audioBank.get(index)
  if (!entry?.pcm) throw new Error('That pad has no sample to chop')
  const pad = model.pads[index]
  const [a, b] = chopRange(entry.pcm.length, pad.trimStart, pad.trimEnd)
  const piece = new Float32Array(entry.pcm.subarray(a, b))
  const dest = nextEmptyPad(model.pads, index)
  if (dest < 0) throw new Error('No empty pad for the chop')
  const name = `${String(pad.name || 'sample').slice(0, 24)} cut`
  await placePcm(dest, piece, entry.sr || 44100, name, { forceName: true, song })
}

export async function sliceOnto(index, count, baseName) {
  const song = songId()
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
      await rememberSample(at, { pcm: pieces[i], sr: entry.sr, name: `${base} ${i + 1}`, forceName: true, song, padPatch: { trimStart: 0, trimEnd: 1, mode: 'oneshot' } })
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

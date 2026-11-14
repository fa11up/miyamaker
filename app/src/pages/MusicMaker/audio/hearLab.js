/**
 * Sound-check probes. Each one is started from a real press and torn down after.
 * They do not change how pads, play, or resume() start the instrument.
 */
import { engineClock, engineTone, pokeEngine } from './engine.js'
import { beepWavBlob, gestureFacts } from './hearReport.js'

const WORKLET_URL = '/worklets/limiter.js'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ctor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

function readRms(analyser) {
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

function wireTone(ctx, hz) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  osc.type = 'sine'
  osc.frequency.value = hz
  gain.gain.value = 0.18
  osc.connect(gain)
  gain.connect(analyser)
  analyser.connect(ctx.destination)
  return { osc, analyser }
}

/**
 * Start a throwaway context.
 * `sync` resumes and plays before the function waits.
 * `micro` waits until the press has returned (one microtask), which is what resume() does once the chain exists.
 * `worklet` waits until the real limiter module loads, which is what the first pad press does.
 */
export async function probeFreshTone(event, mode = 'sync', hz = 523.25) {
  const gesture = gestureFacts(event)
  const id = mode === 'worklet' ? 'worklet-tone' : mode === 'micro' ? 'micro-tone' : 'press-tone'
  const AC = ctor()
  if (!AC) {
    return { id, kind: 'webaudio', awaited: mode !== 'sync', ok: false, error: 'NoAudioContext', gesture, stateAfter: 'none', clockMoved: false, rms: 0, userHeard: null }
  }
  let ctx
  try {
    ctx = new AC()
  } catch (error) {
    return { id, kind: 'webaudio', awaited: mode !== 'sync', ok: false, error: error?.name || 'start', gesture, stateAfter: 'none', clockMoved: false, rms: 0, userHeard: null }
  }
  const { osc, analyser } = wireTone(ctx, hz)
  let workletError = ''
  let waited = 0
  const began = typeof performance !== 'undefined' ? performance.now() : 0
  if (mode === 'micro') await Promise.resolve()
  if (mode === 'worklet') {
    try {
      await ctx.audioWorklet.addModule(WORKLET_URL)
    } catch (error) {
      workletError = error?.name || 'worklet'
    }
  }
  waited = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - began)
  const stateBefore = ctx.state
  let resumeError = ''
  if (ctx.state !== 'running') {
    try {
      const pending = ctx.resume()
      if (mode === 'sync') {
        pending?.catch?.((error) => {
          resumeError = error?.name || 'resume'
        })
      } else await pending
    } catch (error) {
      resumeError = error?.name || 'resume'
    }
  }
  let startError = ''
  try {
    osc.start()
    osc.stop(ctx.currentTime + 0.45)
  } catch (error) {
    startError = error?.name || 'start'
  }
  const clockAt = ctx.currentTime
  await wait(300)
  let rms = 0
  let stateAfter = 'closed'
  let clockDelta = 0
  try {
    if (ctx.state !== 'closed') {
      rms = readRms(analyser)
      stateAfter = ctx.state
      clockDelta = ctx.currentTime - clockAt
    }
  } catch {
    stateAfter = 'closed'
  }
  setTimeout(() => {
    try { ctx.close() } catch { /* already closed */ }
  }, 700)
  return {
    id,
    kind: 'webaudio',
    awaited: mode !== 'sync',
    ok: !startError && !resumeError,
    gesture,
    stateBefore,
    stateAfter,
    clockMoved: clockDelta > 0.05,
    clockDelta: Math.round(clockDelta * 1000) / 1000,
    rms: Math.round(rms * 1000) / 1000,
    sampleRate: ctx.sampleRate,
    waited,
    error: startError || resumeError,
    resumeError,
    workletError,
    userHeard: null,
  }
}

async function playFile(event) {
  const gesture = gestureFacts(event)
  const url = URL.createObjectURL(beepWavBlob())
  const el = new Audio()
  el.setAttribute('playsinline', '')
  el.preload = 'auto'
  el.src = url
  let error = ''
  try {
    await el.play()
  } catch (err) {
    error = err?.name || 'play'
  }
  await wait(320)
  const currentTime = el.currentTime || 0
  const result = {
    id: 'html',
    kind: 'html',
    awaited: false,
    gesture,
    mediaMoved: currentTime > 0.05,
    currentTime: Math.round(currentTime * 1000) / 1000,
    error,
    stateAfter: error ? 'blocked' : 'playing',
    userHeard: null,
  }
  try { el.pause() } catch { /* already stopped */ }
  el.removeAttribute('src')
  try { el.load() } catch { /* released */ }
  URL.revokeObjectURL(url)
  return result
}

/** A music file and a tone, both started in the same press. The file uses the media route; the tone uses Web Audio. */
export async function probeHtmlThenTone(event) {
  const gesture = gestureFacts(event)
  const url = URL.createObjectURL(beepWavBlob())
  const el = new Audio()
  el.setAttribute('playsinline', '')
  el.preload = 'auto'
  el.src = url
  let fileError = ''
  const played = el.play().catch((err) => {
    fileError = err?.name || 'play'
  })
  const tone = await probeFreshTone(event, 'sync', 988)
  await played
  await wait(200)
  const mediaMoved = (el.currentTime || 0) > 0.05
  try { el.pause() } catch { /* already stopped */ }
  el.removeAttribute('src')
  try { el.load() } catch { /* released */ }
  URL.revokeObjectURL(url)
  return {
    ...tone,
    id: 'html-then',
    kind: 'webaudio',
    awaited: false,
    gesture,
    mediaMoved,
    fileError,
    error: tone.error || fileError,
    userHeard: null,
  }
}

export async function probeHtml(event) {
  return playFile(event)
}

export async function probeEngineRoute(event, route) {
  const gesture = gestureFacts(event)
  const poked = pokeEngine()
  const tone = await engineTone(route)
  return {
    kind: 'webaudio',
    awaited: true,
    gesture,
    poked,
    userHeard: null,
    id: route === 'direct' ? 'engine-direct' : 'engine-graph',
    ...tone,
  }
}

export async function probeClock(event) {
  const gesture = gestureFacts(event)
  const clock = await engineClock()
  return { id: 'clock', kind: 'clock', awaited: false, gesture, userHeard: null, ...clock }
}

let restoreTimer = 0
let restoreType = null

export function releasePlaybackSession() {
  if (restoreTimer) {
    clearTimeout(restoreTimer)
    restoreTimer = 0
  }
  const session = typeof navigator !== 'undefined' ? navigator.audioSession : null
  if (session && restoreType != null) {
    try { session.type = restoreType } catch { /* leave whatever the browser kept */ }
  }
  restoreType = null
}

/** Ask for a music-app session, play a tone at once, and put the session back after two seconds. */
export async function probePlaybackSession(event) {
  const session = typeof navigator !== 'undefined' ? navigator.audioSession : null
  let sessionError = ''
  const supported = !!session
  if (session) {
    restoreType = session.type
    try {
      session.type = 'playback'
    } catch (error) {
      sessionError = error?.name || 'session'
    }
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = setTimeout(releasePlaybackSession, 2000)
  }
  const tone = await probeFreshTone(event, 'sync', 988)
  return {
    ...tone,
    id: 'playback-session',
    awaited: false,
    sessionSupported: supported,
    sessionError,
    error: tone.error || sessionError,
  }
}

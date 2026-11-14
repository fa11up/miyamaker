/**
 * Readings for the sound check. Pure: no AudioContext, so a phone that stays silent and a
 * laptop that plays can be compared from the same report. Nothing here starts or changes playback.
 */

export const SIGNAL_RMS = 0.01

export function signalPresent(rms) {
  return typeof rms === 'number' && rms >= SIGNAL_RMS
}

export function plainFault(code) {
  if (!code) return ''
  if (code === 'NotAllowedError') return 'The browser refused to start sound from this press.'
  if (code === 'NotSupportedError') return 'This browser cannot play that test.'
  if (code === 'AbortError') return 'The test was interrupted before it could sound.'
  if (code === 'NoAudioContext') return 'This browser has no Web Audio.'
  if (code === 'closed') return 'The instrument closed before the tone started.'
  if (code === 'InvalidStateError') return 'The sound system was already closed.'
  return 'The test did not start.'
}

/** A short music-file beep. Played through an audio element, which uses a different route than Web Audio. */
export function beepWavBlob(hz = 880, seconds = 0.4, rate = 22050) {
  const n = Math.max(1, Math.floor(rate * seconds))
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const attack = rate * 0.02
    const release = rate * 0.05
    const env = Math.min(1, i / attack, (n - i) / release)
    samples[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * env * 0.45 * 32767)
  }
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  new Int16Array(buf, 44).set(samples)
  return new Blob([buf], { type: 'audio/wav' })
}

export function gestureFacts(event) {
  const nav = typeof navigator === 'undefined' ? null : navigator
  return {
    type: event?.type || '',
    pointerType: event?.pointerType || '',
    button: event && 'button' in event ? event.button : null,
    detail: event && 'detail' in event ? event.detail : null,
    isTrusted: event && 'isTrusted' in event ? !!event.isTrusted : null,
    key: event?.type === 'keydown' || event?.type === 'beforeinput' ? (event.key || event.data || '') : '',
    activation: nav?.userActivation
      ? { isActive: !!nav.userActivation.isActive, hasBeenActive: !!nav.userActivation.hasBeenActive }
      : null,
  }
}

export function deviceFacts() {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const ua = nav?.userAgent || ''
  const touchMac = nav?.platform === 'MacIntel' && (nav?.maxTouchPoints || 0) > 1
  const ios = /iPad|iPhone|iPod/.test(ua) || touchMac
  let standalone = false
  try {
    standalone = (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) || nav?.standalone === true
  } catch {
    standalone = false
  }
  let iframe = false
  try {
    iframe = typeof window !== 'undefined' && window.top !== window.self
  } catch {
    iframe = true
  }
  const session = nav?.audioSession
  return {
    ua,
    ios: !!ios,
    standalone: !!standalone,
    iframe: !!iframe,
    secure: typeof window === 'undefined' ? false : !!window.isSecureContext,
    visibility: typeof document === 'undefined' ? '' : document.visibilityState || '',
    focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : null,
    audioSession: session?.type || '',
    audioSessionState: session && 'state' in session ? session.state || '' : '',
    userActivation: nav?.userActivation
      ? { isActive: !!nav.userActivation.isActive, hasBeenActive: !!nav.userActivation.hasBeenActive }
      : null,
    webAudio: typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext),
  }
}

export function noteInput(list, event) {
  const row = { ...gestureFacts(event), at: Date.now() }
  return [...(list || []), row].slice(-8)
}

function webOk(probe) {
  return probe?.kind === 'webaudio' && probe.stateAfter === 'running' && probe.clockMoved && signalPresent(probe.rms)
}

function webGestureLost(probe) {
  if (probe?.kind !== 'webaudio') return false
  if (probe.stateAfter === 'suspended' || probe.stateAfter === 'interrupted' || probe.stateAfter === 'closed') return true
  return probe.stateAfter === 'running' && probe.clockMoved === false
}

export function withHeard(probes, index, heard) {
  return (probes || []).map((probe, i) => (i === index ? { ...probe, userHeard: heard } : probe))
}

/**
 * What the readings mean, in the order a person who cannot hear anything should try next.
 * Empty when there is nothing to say yet.
 */
export function classifyHear(report) {
  const probes = Array.isArray(report?.probes) ? report.probes : []
  const inputs = Array.isArray(report?.inputs) ? report.inputs : []
  const device = report?.device || {}
  const notes = []
  const web = probes.filter((probe) => probe.kind === 'webaudio')
  const syncOk = web.filter((probe) => !probe.awaited && webOk(probe))
  const lateBad = web.filter((probe) => probe.awaited && webGestureLost(probe))
  if (syncOk.length && lateBad.length) {
    notes.push('A tone that starts in the same moment as the tap runs on this browser. A tone that starts after a wait does not. The instrument waits for its output chain before it asks to play, and that wait is long enough for this browser to drop the tap. A faster phone still gets there in time, which is why the same browser is loud for one person and silent for another. The instrument has not been changed.')
  }
  const worklets = probes.filter((probe) => probe.id === 'worklet-tone')
  if (worklets.some(webOk) && worklets.some(webGestureLost)) {
    notes.push('The tone after the output chain loads failed once and worked once. The first load is the slow one, so the tap expires only sometimes. That is the sporadic silence: the pads still draw, and the speaker never opens.')
  }
  const html = probes.filter((probe) => probe.kind === 'html' || probe.id === 'html' || probe.id === 'html-then')
  const htmlMoved = html.some((probe) => probe.mediaMoved)
  const htmlHeard = html.some((probe) => probe.userHeard === true)
  const htmlSilent = html.some((probe) => probe.userHeard === false)
  const toneSilent = web.some((probe) => webOk(probe) && probe.userHeard === false)
  if ((htmlHeard || (htmlMoved && htmlSilent)) && toneSilent) {
    notes.push('A music file was allowed to play, and a tone was generated, but the tone did not come out of the speaker. This browser is muting Web Audio while still playing music files. On a phone that is the silent switch — the physical one, or Silent in Control Center — not the mute button inside the app and not the volume rocker. Turning those off does not open this route.')
  }
  const session = probes.find((probe) => probe.id === 'playback-session')
  if (session?.userHeard === true && toneSilent && !session.awaited) {
    notes.push('Asking for a music-app session made the tone audible. The instrument does not ask for that yet. Confirm it on the quiet phone before changing anything.')
  } else if (session?.userHeard === true && web.some((probe) => probe.id !== 'playback-session' && probe.userHeard === false && webOk(probe))) {
    notes.push('The tone was heard only after asking for a music-app session. That session ignores the silent switch. The instrument does not ask for it yet.')
  }
  if (probes.some((probe) => probe.stateAfter === 'running' && probe.clockMoved === false)) {
    notes.push('The browser says sound is running, but the clock is frozen. A call, another app, or the lock screen took the speaker and did not give it back. The picture still moves. Lock the phone and unlock it, then try the tap tone again before blaming the kit.')
  }
  if (probes.some((probe) => probe.stateAfter === 'interrupted')) {
    notes.push('The browser marked the sound system interrupted. Something else has the speaker. The next real press has to start it again.')
  }
  const direct = probes.filter((probe) => probe.id === 'engine-direct')
  const graph = probes.filter((probe) => probe.id === 'engine-graph')
  if (direct.some(webOk) && graph.some((probe) => probe.stateAfter === 'running' && probe.clockMoved && !signalPresent(probe.rms))) {
    notes.push('A tone straight to the speakers produced a signal, and the same tone through the instrument did not. The instrument’s output chain is eating the sound. Master volume, a muted bus, or a failed limiter are the places to look. The phone’s mute switch is not.')
  }
  const directHeard = direct.some((probe) => probe.userHeard === true && webOk(probe))
  const graphDropped = graph.some((probe) => probe.userHeard === false && webOk(probe))
  if (directHeard && graphDropped) {
    notes.push('A tone around the instrument was heard, and a tone through the instrument was generated but not heard. The output chain is dropping it on the way to the speakers.')
  }
  if (graph.some((probe) => probe.userHeard === false && typeof probe.master === 'number' && probe.master < 0.02)) {
    notes.push('The instrument’s master volume is down, so a tone through it cannot be heard even when the browser is playing. Raise the master before comparing phones.')
  }
  const refused = probes.some((probe) => probe.error === 'NotAllowedError' || probe.resumeError === 'NotAllowedError')
  const untrusted = probes.some((probe) => probe.gesture?.isTrusted === false)
  const inactive = web.length > 0 && web.every(webGestureLost) && probes.some((probe) => probe.gesture?.activation && probe.gesture.activation.isActive === false)
  if (refused || untrusted || inactive) {
    notes.push('This press was not accepted as a press that may start sound. A page inside another app (Instagram, X, Facebook, and some previews) does this while Safari or Chrome on the same phone does not. Open the page in the browser itself and run the finger row again.')
  }
  if (device.iframe && web.length && web.every(webGestureLost)) {
    notes.push('This page is inside another page. Frames often block sound even when the phone is unmuted. The reading that counts is the same check in Safari or Chrome, not inside the frame.')
  }
  const touchHeard = probes.some((probe) => probe.userHeard === true && probe.gesture?.pointerType === 'touch')
  const mouseMiss = probes.some((probe) => probe.userHeard === false && probe.gesture?.pointerType === 'mouse' && webOk(probe))
  const mouseHeard = probes.some((probe) => probe.userHeard === true && probe.gesture?.pointerType === 'mouse')
  const touchMiss = probes.some((probe) => probe.userHeard === false && probe.gesture?.pointerType === 'touch' && webOk(probe))
  if (touchHeard && mouseMiss && !mouseHeard) {
    notes.push('A finger was heard and a mouse click was not, even though the click generated a tone. Compare those two rows in the report before changing the instrument.')
  }
  if (mouseHeard && touchMiss && !touchHeard) {
    notes.push('A mouse click was heard and a finger was not, even though the finger generated a tone. The finger row is the one a phone uses.')
  }
  const fingerInputs = inputs.filter((row) => row.pointerType === 'touch' || row.pointerType === 'pen')
  if (fingerInputs.length && fingerInputs.every((row) => row.activation && row.activation.isActive === false)) {
    notes.push('Finger presses are arriving, and this browser is not counting them as a press that may start sound.')
  }
  const generated = web.some(webOk)
  if (generated && probes.some((probe) => probe.userHeard === false) && !notes.length) {
    notes.push('The browser generated a tone and the speaker did not play it. That sits outside the instrument: a silent switch, a Bluetooth route, a disconnected output, or the system volume. The pads drawing does not mean the speaker is open.')
  }
  const answered = probes.filter((probe) => probe.userHeard === true || probe.userHeard === false)
  if (answered.length && answered.every((probe) => probe.userHeard === true) && !notes.length) {
    notes.push('Every test you answered was heard. The silence is not happening in this browser right now. Run the same check, with a finger, on a phone that stays quiet, and compare the two reports.')
  }
  if (!notes.length && probes.length && !answered.length) {
    notes.push('The readings are in. Say whether you heard each test — the meter cannot know what reached the speaker.')
  }
  if (!notes.length && !probes.length) {
    notes.push('No test yet. Use a finger on the first row, then the same rows with a click, and say what you heard before sending the report.')
  }
  return notes
}

function yn(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return '—'
}

function pressLabel(gesture) {
  if (!gesture) return '—'
  const bits = [gesture.type || '?', gesture.pointerType || '', gesture.key || ''].filter(Boolean)
  const trust = gesture.isTrusted === false ? 'untrusted' : gesture.isTrusted ? 'trusted' : ''
  const active = gesture.activation ? (gesture.activation.isActive ? 'counted' : 'not counted') : ''
  return [bits.join(' '), trust, active].filter(Boolean).join(' · ')
}

function probeLine(probe, index) {
  const heard = probe.userHeard === true ? 'heard' : probe.userHeard === false ? 'silent' : 'unanswered'
  const state = `${probe.stateBefore || '—'} → ${probe.stateAfter || '—'}`
  const bits = [
    `${index + 1}. ${probe.id || probe.kind || 'test'}`,
    pressLabel(probe.gesture),
    `state ${state}`,
    `clock ${yn(probe.clockMoved)}`,
    probe.rms != null ? `signal ${probe.rms}` : '',
    probe.mediaMoved != null ? `file ${yn(probe.mediaMoved)}` : '',
    probe.waited != null ? `wait ${probe.waited}ms` : '',
    probe.master != null ? `master ${probe.master}` : '',
    probe.error ? `fault ${probe.error}` : '',
    probe.workletError ? `chain ${probe.workletError}` : '',
    heard,
  ]
  return bits.filter(Boolean).join(' | ')
}

/** One block of text a quiet phone and a working phone can both send back. */
export function formatHearReport(report) {
  const device = report?.device || {}
  const engine = report?.engine || {}
  const probes = report?.probes || []
  const inputs = report?.inputs || []
  const notes = classifyHear(report)
  const lines = [
    'MiyaMusicMaker sound check',
    'A reading only. The instrument was not changed.',
    '',
    `Browser: ${device.ua || '—'}`,
    `Phone: ${yn(device.ios)}  Frame: ${yn(device.iframe)}  Secure: ${yn(device.secure)}  Page: ${device.visibility || '—'}`,
    `Audio session: ${device.audioSession || '(none)'}${device.audioSessionState ? ` ${device.audioSessionState}` : ''}`,
    `Engine: ${engine.built ? engine.state : 'not built'}  rate ${engine.sampleRate || '—'}  master ${engine.master ?? '—'}  limiter ${yn(engine.limiterReady)}  clock ${engine.clockDelta ?? '—'}`,
    '',
    'Tests:',
    ...(probes.length ? probes.map(probeLine) : ['(none)']),
    '',
    'Presses seen:',
    ...(inputs.length ? inputs.map((row) => `- ${pressLabel(row)}`) : ['(none)']),
    '',
    'Reading:',
    ...notes.map((note) => `- ${note}`),
  ]
  return lines.join('\n')
}

import { useEffect, useRef, useState } from 'react'
import { engineAudioFacts } from '../audio/engine.js'
import {
  probeClock,
  probeEngineRoute,
  probeFreshTone,
  probeHtml,
  probeHtmlThenTone,
  probePlaybackSession,
  releasePlaybackSession,
} from '../audio/hearLab.js'
import { classifyHear, deviceFacts, formatHearReport, noteInput, plainFault, withHeard } from '../audio/hearReport.js'
import { Dialog } from '../widgets.jsx'

const ROWS = [
  ['finger', 'Finger on the button', 'A tone from a finger or a pen, on whichever part of the press this browser counts. A mouse press is ignored here.'],
  ['mouse', 'Mouse or trackpad click', 'The same tone from a click. A finger is ignored here, so the two stay separate.'],
  ['key', 'A key, below', 'Focus the field and press a letter. On a phone this opens the keyboard.'],
  ['micro', 'After the tap returns', 'The same kind of wait the instrument uses once its sound system already exists.'],
  ['worklet', 'After the output chain loads', 'The wait on the first pad press. This is the one that comes and goes.'],
  ['html', 'Music file', 'A short file, the route a song uses. The silent switch often lets this through and blocks the tones.'],
  ['html-then', 'Music file, then a tone', 'The file first, then a tone. Listen for the second sound.'],
  ['graph', 'Through the instrument', 'The pads’ own start, through the limiter and the master.'],
  ['direct', 'Around the instrument', 'The pads’ own start, straight to the speakers.'],
  ['session', 'Music-app session, then a tone', 'Asks the browser to ignore the silent switch for two seconds, then puts it back. Try a pad in that window too.'],
  ['clock', 'Clock only', 'No tone. Checks whether a running sound system is actually moving.'],
]

function engineLine(engine) {
  if (!engine?.built) return 'The instrument has not started its sound system yet. That is normal until the first pad or the rows below.'
  const clock = engine.clockDelta == null ? '' : engine.clockDelta > 0.05 ? 'clock moving' : 'clock frozen'
  return `Instrument: ${engine.state}, master ${engine.master ?? '—'}, limiter ${engine.limiterReady ? 'up' : 'off'}${clock ? `, ${clock}` : ''}.`
}

export function HearLab({ onClose }) {
  const alive = useRef(true)
  const pressKind = useRef('')
  const lastKey = useRef(0)
  const played = useRef({ at: 0, kind: '' })
  const [device, setDevice] = useState(() => deviceFacts())
  const [engine, setEngine] = useState(() => engineAudioFacts())
  const [probes, setProbes] = useState([])
  const [inputs, setInputs] = useState([])
  const [busy, setBusy] = useState('')
  const [hint, setHint] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    alive.current = true
    let stop = false
    let timer = 0
    const tick = async () => {
      const before = engineAudioFacts()
      if (!before.built) {
        if (!stop && alive.current) setEngine(before)
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300))
        if (stop || !alive.current) return
        const after = engineAudioFacts()
        setEngine({ ...after, clockDelta: after.currentTime - before.currentTime })
      }
      if (!stop) timer = window.setTimeout(tick, 900)
    }
    timer = window.setTimeout(tick, 200)
    return () => {
      stop = true
      alive.current = false
      window.clearTimeout(timer)
      releasePlaybackSession()
    }
  }, [])

  const report = { device, probes, inputs, engine }
  const notes = classifyHear(report)
  const text = formatHearReport(report)
  const last = probes.length - 1

  function remember(event) {
    pressKind.current = event.pointerType || ''
    setInputs((list) => noteInput(list, event.nativeEvent || event))
  }

  async function run(kind, event) {
    if (busy) return
    const native = event?.nativeEvent || event
    setDevice(deviceFacts())
    setBusy(kind)
    setCopied(false)
    let probe = null
    try {
      if (kind === 'press' || kind === 'micro' || kind === 'worklet') {
        const mode = kind === 'press' ? 'sync' : kind === 'micro' ? 'micro' : 'worklet'
        const hz = kind === 'worklet' ? 784 : kind === 'micro' ? 659 : 523.25
        probe = await probeFreshTone(native, mode, hz)
      } else if (kind === 'html') probe = await probeHtml(native)
      else if (kind === 'html-then') probe = await probeHtmlThenTone(native)
      else if (kind === 'graph') probe = await probeEngineRoute(native, 'graph')
      else if (kind === 'direct') probe = await probeEngineRoute(native, 'direct')
      else if (kind === 'session') probe = await probePlaybackSession(native)
      else if (kind === 'clock') probe = await probeClock(native)
    } catch (error) {
      probe = { id: kind, kind: 'webaudio', error: error?.name || 'start', stateAfter: 'none', clockMoved: false, rms: 0, userHeard: null }
    }
    if (!alive.current) return
    if (!probe) {
      setBusy('')
      return
    }
    setProbes((list) => [...list, probe].slice(-12))
    setEngine(engineAudioFacts())
    setBusy('')
  }

  function startFrom(kind, event) {
    if (busy) return
    if (event?.button != null && event.button > 0) return
    const hasActivation = typeof navigator !== 'undefined' && !!navigator.userActivation
    const counted = !hasActivation || navigator.userActivation.isActive
    // pointerdown is a press on a desktop and nothing on some phones. Wait for the up or the click
    // when this one was not counted, so the reading is the event that was allowed to start sound.
    if (!counted && event.type !== 'click') return
    if (played.current.kind === kind && performance.now() - played.current.at < 700) return
    let pointer = event.pointerType || ''
    // A click from Enter has no pointer. A click after a real press often omits it too, so use the press just seen.
    if (!pointer && event.type === 'click' && event.detail === 0) pointer = 'key'
    else if (!pointer) pointer = pressKind.current
    if (kind === 'finger' && pointer !== 'touch' && pointer !== 'pen') {
      if (event.type === 'click') setHint(pointer === 'key' ? 'That was a key. Use the letter field for it.' : 'That was a mouse. Use the mouse row for it.')
      return
    }
    if (kind === 'mouse' && pointer !== 'mouse') {
      if (event.type === 'click') setHint('That was not a mouse. Use the row that matches how you pressed.')
      return
    }
    played.current = { at: performance.now(), kind }
    setHint('')
    const mapped = kind === 'finger' || kind === 'mouse' ? 'press' : kind
    void run(mapped, event)
  }

  function onFieldKey(event) {
    if (event.key === 'Escape' || event.key === 'Tab') return
    event.stopPropagation()
    event.preventDefault()
    if (event.key === ' ' || event.key === 'Spacebar') return
    if (event.repeat) return
    const text = event.key || event.data || ''
    if (text.length !== 1) return
    const now = performance.now()
    if (now - lastKey.current < 450) return
    lastKey.current = now
    setHint('')
    void run('press', event)
  }

  function mark(heard) {
    if (last < 0) return
    setProbes((list) => withHeard(list, list.length - 1, heard))
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
      setHint('The report is in the box below. Select it and copy.')
    }
  }

  return (
    <Dialog title="Sound check" onClose={onClose}>
      <div className="hear-lab" onPointerDownCapture={remember}>
        <p>The picture can move while the speaker stays closed. These rows only play test tones and write down what this browser did. They do not change the instrument.</p>
        <p>Run the finger row, then the mouse row, then the chain row. After each one, say whether you heard it. Do that on a phone that plays and on a phone that does not, and compare the reports.</p>
        {device.iframe && <p>This page is inside another page. A frame often blocks sound even when the phone is unmuted. Run this same check in Safari or Chrome itself before trusting a silence here.</p>}
        <p className="hear-live">{engineLine(engine)}</p>
        {hint && <p>{hint}</p>}
        <div className="hear-actions">
          {ROWS.map(([id, label, detail]) => (
            id === 'key' ? (
              <label key={id} className="hear-field">
                <span>{label}</span>
                <input
                  aria-label="Press a letter for a tone"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value=""
                  disabled={!!busy}
                  onKeyDown={onFieldKey}
                  onBeforeInput={onFieldKey}
                  onChange={() => {}}
                />
                <small>{detail}</small>
              </label>
            ) : (
              <button
                key={id}
                type="button"
                className="btn"
                disabled={!!busy}
                onPointerDown={(event) => startFrom(id, event)}
                onPointerUp={(event) => startFrom(id, event)}
                onClick={(event) => startFrom(id, event)}
              >
                <b>{busy === (id === 'finger' || id === 'mouse' ? 'press' : id) ? 'Listening…' : label}</b>
                <small>{detail}</small>
              </button>
            )
          ))}
        </div>
        <div className="hear-heard">
          <p>{last < 0 ? 'After each test, say whether you heard it before running the next.' : `Was “${probes[last].id}” heard?`}</p>
          <button type="button" className="btn" disabled={last < 0} onClick={() => mark(true)}>I heard it</button>
          <button type="button" className="btn" disabled={last < 0} onClick={() => mark(false)}>I heard nothing</button>
        </div>
        {last >= 0 && probes[last].error && <p>{plainFault(probes[last].error)}</p>}
        <div className="hear-notes">
          {notes.map((note) => <p key={note}>{note}</p>)}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => void copyReport()}>{copied ? 'Copied' : 'Copy report'}</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <pre className="hear-log">{text}</pre>
      </div>
    </Dialog>
  )
}

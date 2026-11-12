import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { noteOff, noteOn, shapeHeld } from '../audio/engine.js'
import {
  CHORD_BANKS,
  CHORDS,
  ROOTS,
  SCALES,
  TOUCH_AXES,
  TUNINGS,
  bankItemName,
  clampAxis,
  clampBank,
  clampBend,
  clampLead,
  harmonyAt,
  isWhite,
  leadNotes,
  rootBlackLeft,
  rootBoard,
  tunedPitch,
} from '../audio/piano.js'
import { noteName } from '../keys.js'
import { TRACK_VEL, model, touch, trackerFields } from '../model.js'
import { useModel } from '../useModel.js'
import { ShiftHold } from './ShiftHold.jsx'

let liveBend = 0

function trackExtra() {
  if (model.screen !== 'track') return {}
  return { trackerNote: true, lane: Math.floor((model.tracker.col || 0) / trackerFields()) }
}

function placeY(event, rect) {
  return Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
}

function velocityAt(y) {
  if (clampAxis(model.pianoAxis) !== 'velocity') return TRACK_VEL
  return 0.12 + y * 0.88
}

function playNote(midi, hold, velocity, rootPc) {
  noteOn(
    model.selected,
    velocity,
    hold,
    tunedPitch(midi, rootPc, model.pianoTuning),
    trackExtra(),
  )
}

function applyShape(y) {
  shapeHeld('piano:', { bend: liveBend, y, axis: clampAxis(model.pianoAxis) })
}

function FitName({ name }) {
  const box = useRef(null)
  const text = useRef(null)
  const [slide, setSlide] = useState(false)
  useLayoutEffect(() => {
    const host = box.current
    const label = text.current
    if (!host || !label) return
    setSlide(host.scrollWidth > host.clientWidth + 2)
  }, [name])
  return (
    <span className={`chord-fit ${slide ? 'slides' : ''}`} ref={box}>
      <span className="chord-fit-track">
        <span ref={text}>{name}</span>
        {slide && <span aria-hidden="true">{name}</span>}
      </span>
    </span>
  )
}

function ChordSettings() {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      const node = root.current
      if (!node) return
      if (node.contains(event.target)) return
      if (event.composedPath?.().includes(node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [open])
  const bend = clampBend(model.pianoBend)
  const lead = clampLead(model.pianoLeadLo, model.pianoLeadHi)
  const axis = clampAxis(model.pianoAxis)
  const inv = model.pianoInv | 0
  const bendLabel = bend === 24 ? '±2 oct' : bend === 12 ? '±1 oct' : `±${bend} st`
  const setBend = (dir) => {
    model.pianoBend = clampBend(bend + dir)
    touch(true)
  }
  const setLead = (which, dir) => {
    const next = which === 'lo'
      ? clampLead(lead.lo + dir, lead.hi)
      : clampLead(lead.lo, lead.hi + dir)
    model.pianoLeadLo = next.lo
    model.pianoLeadHi = next.hi
    touch(true)
  }
  return (
    <div className="mmm-file chord-settings" ref={root}>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-label="Chord settings"
        onClick={() => setOpen((value) => !value)}
      >
        Set
      </button>
      {open && (
        <div className="file-menu" role="menu">
          <p>Bend</p>
          <div className="chord-set-row">
            <button type="button" aria-label="Less bend" onClick={() => setBend(-1)}>−</button>
            <span>{bendLabel}</span>
            <button type="button" aria-label="More bend" onClick={() => setBend(1)}>+</button>
          </div>
          <p>Lead low</p>
          <div className="chord-set-row">
            <button type="button" aria-label="Lower the lead start" onClick={() => setLead('lo', -1)}>−</button>
            <span>{lead.lo}</span>
            <button type="button" aria-label="Raise the lead start" onClick={() => setLead('lo', 1)}>+</button>
          </div>
          <p>Lead high</p>
          <div className="chord-set-row">
            <button type="button" aria-label="Lower the lead end" onClick={() => setLead('hi', -1)}>−</button>
            <span>+{lead.hi}</span>
            <button type="button" aria-label="Raise the lead end" onClick={() => setLead('hi', 1)}>+</button>
          </div>
          <p>Where you tap</p>
          {TOUCH_AXES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={axis === item.id ? 'on' : ''}
              onClick={() => {
                model.pianoAxis = item.id
                touch(true)
              }}
            >
              {item.name}
            </button>
          ))}
          <hr />
          <p>Tuning</p>
          {TUNINGS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={model.pianoTuning === item.id ? 'on' : ''}
              onClick={() => {
                model.pianoTuning = item.id
                touch(true)
              }}
            >
              {item.name}
            </button>
          ))}
          <hr />
          <p>Inversion</p>
          <div className="chord-set-row">
            <button type="button" aria-label="Lower inversion" onClick={() => { model.pianoInv = Math.max(-3, inv - 1); touch(true) }}>−</button>
            <span>{inv}</span>
            <button type="button" aria-label="Higher inversion" onClick={() => { model.pianoInv = Math.min(3, inv + 1); touch(true) }}>+</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PitchWheel() {
  const [bend, setBend] = useState(0)
  const [live, setLive] = useState(false)
  const range = clampBend(model.pianoBend)
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const host = event.currentTarget
    const id = event.pointerId
    setLive(true)
    const at = (ev) => {
      const rect = host.getBoundingClientRect()
      const y = placeY(ev, rect)
      const semi = (0.5 - y) * 2 * clampBend(model.pianoBend)
      liveBend = semi
      setBend(semi)
      applyShape(y)
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      window.removeEventListener('pointermove', at)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      liveBend = 0
      setBend(0)
      setLive(false)
      applyShape(0.8)
    }
    window.addEventListener('pointermove', at)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    at(event)
  }
  const key = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    const dir = event.key === 'ArrowUp' ? 1 : -1
    const semi = dir * clampBend(model.pianoBend)
    liveBend = semi
    setBend(semi)
    setLive(true)
    applyShape(dir > 0 ? 0.15 : 0.85)
  }
  const release = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    liveBend = 0
    setBend(0)
    setLive(false)
    applyShape(0.8)
  }
  const shown = range ? bend / range : 0
  return (
    <div
      className={`pitch-wheel ${live ? 'live' : ''}`}
      style={{ '--bend': Math.max(-1, Math.min(1, shown)) }}
      onPointerDown={down}
      onKeyDown={key}
      onKeyUp={release}
      role="slider"
      tabIndex={0}
      aria-label="Pitch bend. Returns to center."
      aria-valuemin={-range}
      aria-valuemax={range}
      aria-valuenow={Math.round(bend)}
      aria-valuetext={bend ? `${bend > 0 ? '+' : ''}${Math.round(bend)} semitones` : 'Center'}
    >
      <i className="pitch-thumb" />
    </div>
  )
}

function BankTab() {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const bankIndex = clampBank(model.pianoBank)
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      const node = root.current
      if (!node) return
      if (node.contains(event.target)) return
      if (event.composedPath?.().includes(node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [open])
  return (
    <div className="mmm-file chord-bank-tab" ref={root}>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-label={`${CHORD_BANKS[bankIndex].label}. Open harmony banks.`}
        onClick={() => setOpen((value) => !value)}
      >
        {CHORD_BANKS[bankIndex].name}
      </button>
      {open && (
        <div className="file-menu" role="menu">
          {CHORD_BANKS.map((page, index) => (
            <button
              key={page.id}
              type="button"
              className={index === bankIndex ? 'on' : ''}
              onClick={() => {
                model.pianoBank = index
                touch(true)
                setOpen(false)
              }}
            >
              {page.name} · {page.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChordGrid({ banks = true }) {
  const bankIndex = clampBank(model.pianoBank)
  const bank = CHORD_BANKS[bankIndex]
  const pick = (item) => {
    if (item.kind === 'chord') {
      const on = model.pianoChord === item.id && !model.pianoScale
      model.pianoChord = on ? '' : item.id
      model.pianoScale = ''
    } else {
      const on = model.pianoScale === item.id && !model.pianoChord
      model.pianoScale = on ? '' : item.id
      model.pianoChord = ''
    }
    touch(true)
  }
  const armed = (item) => (
    item.kind === 'chord'
      ? model.pianoChord === item.id && !model.pianoScale
      : model.pianoScale === item.id && !model.pianoChord
  )
  return (
    <div className="chord-grid-wrap">
      <div className="chord-grid" role="group" aria-label={`${bank.label}. These set the harmony and do not play.`}>
        {bank.items.map((item) => {
          const name = bankItemName(item)
          const on = armed(item)
          return (
            <button
              key={item.id}
              type="button"
              className={`btn ${on ? 'on' : ''}`}
              aria-pressed={on}
              title={name}
              onClick={() => pick(item)}
            >
              <FitName name={name} />
            </button>
          )
        })}
      </div>
      {banks && (
        <div className="chord-banks" role="group" aria-label="Harmony banks">
          {CHORD_BANKS.map((page, index) => (
            <button
              key={page.id}
              type="button"
              className={`btn ${index === bankIndex ? 'on' : ''}`}
              aria-pressed={index === bankIndex}
              aria-label={page.label}
              onClick={() => {
                model.pianoBank = index
                touch(true)
              }}
            >
              {page.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function harmonyName() {
  if (model.pianoChord) return CHORDS.find((chord) => chord.id === model.pianoChord)?.name || model.pianoChord
  if (model.pianoScale) return SCALES.find((scale) => scale.id === model.pianoScale)?.name || model.pianoScale
  return 'chromatic'
}

function LeadStrip() {
  useModel()
  const span = clampLead(model.pianoLeadLo, model.pianoLeadHi)
  const root = ((model.pianoRoot % 12) + 12) % 12
  const chordId = model.pianoChord || ''
  const scaleId = model.pianoScale || ''
  const notes = leadNotes({ root, chordId, scaleId, lo: span.lo, hi: span.hi })
  const rootNote = 60 + root
  const rootName = ROOTS[root] || 'C'
  const harmony = harmonyName()
  const [lit, setLit] = useState(null)
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const host = event.currentTarget
    const id = event.pointerId
    let held = null
    const at = (ev) => {
      const rect = host.getBoundingClientRect()
      if (!notes.length || ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
        return { midi: null, y: 0.8 }
      }
      const index = Math.max(0, Math.min(notes.length - 1, Math.floor(((ev.clientX - rect.left) / rect.width) * notes.length)))
      return { midi: notes[index], y: placeY(ev, rect) }
    }
    const play = (ev) => {
      const hit = at(ev)
      if (hit.midi === held) {
        applyShape(hit.y)
        return
      }
      if (held != null) noteOff('piano:lead')
      held = hit.midi
      setLit(hit.midi)
      if (hit.midi != null) playNote(hit.midi, 'piano:lead', velocityAt(hit.y), root)
      applyShape(hit.y)
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      if (held != null) noteOff('piano:lead')
      held = null
      setLit(null)
      window.removeEventListener('pointermove', play)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', play)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    play(event)
  }
  return (
    <div
      className="lead-strip"
      onPointerDown={down}
      role="group"
      aria-label={`Lead strip ${rootName} ${harmony}`}
      data-root={rootName}
      data-harmony={chordId || scaleId || 'chromatic'}
      style={{ '--lead': notes.length }}
    >
      {notes.map((midi) => {
        const off = midi - rootNote
        const oct = off / 12
        const mark = off % 12 === 0
        const rootStripe = mark && oct === 0
        const label = !mark ? '' : oct === 0 ? rootName : `${rootName}${oct > 0 ? `+${oct}` : oct}`
        return (
          <i
            key={`${root}-${chordId}-${scaleId}-${midi}`}
            className={`${lit === midi ? 'on' : ''} ${mark ? 'is-oct' : ''} ${rootStripe ? 'is-root' : ''}`}
            data-oct={label || undefined}
            data-note={noteName(midi - 60)}
            title={noteName(midi - 60)}
          />
        )
      })}
    </div>
  )
}

function stopRoot() {
  for (let i = 0; i < 8; i++) noteOff(`piano:root:${i}`)
}

function RootPiano() {
  const board = rootBoard(model.chordHand ? 1 : 2)
  const ref = useRef(null)
  const [lit, setLit] = useState(null)
  const keyAt = (clientX, clientY) => {
    const node = ref.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const whites = [...node.querySelectorAll('.chord-white')]
    if (!whites.length || clientY < rect.top || clientY > rect.bottom || clientX < rect.left || clientX > rect.right) return null
    if (clientY < rect.top + rect.height * 0.58) {
      for (const black of node.querySelectorAll('.chord-black')) {
        const box = black.getBoundingClientRect()
        if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) return black.dataset.midi
      }
    }
    const index = Math.max(0, Math.min(whites.length - 1, Math.floor((clientX - rect.left) / (rect.width / whites.length))))
    return whites[index]?.dataset.midi || null
  }
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const node = event.currentTarget
    const id = event.pointerId
    let held = null
    const play = (ev) => {
      const rect = node.getBoundingClientRect()
      const y = placeY(ev, rect)
      const raw = keyAt(ev.clientX, ev.clientY)
      if (raw === held) {
        applyShape(y)
        return
      }
      stopRoot()
      held = raw
      setLit(raw)
      if (raw != null) {
        const midi = Number(raw)
        const pc = ((midi % 12) + 12) % 12
        if ((model.pianoRoot | 0) !== pc) {
          model.pianoRoot = pc
          touch(false)
        }
        const notes = harmonyAt(midi, {
          chord: model.pianoChord || '',
          scale: model.pianoScale || '',
          inversion: model.pianoInv | 0,
        })
        notes.forEach((tone, index) => playNote(tone, `piano:root:${index}`, velocityAt(y), pc))
      }
      applyShape(y)
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      stopRoot()
      held = null
      setLit(null)
      window.removeEventListener('pointermove', play)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', play)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    play(event)
  }
  return (
    <div
      ref={ref}
      className="chord-piano"
      style={{ '--whites': board.shown.length }}
      onPointerDown={down}
      role="group"
      aria-label="Root piano"
    >
      {board.shown.map((midi) => (
        <button
          key={midi}
          type="button"
          className={`chord-white ${lit === String(midi) ? 'on' : ''}`}
          data-midi={midi}
          tabIndex={-1}
        >
          {(midi % 12) === 0 && <span>{noteName(midi - 60).replace('-', '')}</span>}
        </button>
      ))}
      {board.keys.filter((midi) => !isWhite(midi)).map((midi) => (
        <button
          key={midi}
          type="button"
          className={`chord-black ${lit === String(midi) ? 'on' : ''}`}
          data-midi={midi}
          tabIndex={-1}
          style={{ left: `calc(${(rootBlackLeft(midi, board.shown) / board.shown.length) * 100}% - (0.31 * 100% / var(--whites)))` }}
        />
      ))}
    </div>
  )
}

export function ChordPanel() {
  useModel()
  const phone = !!model.chordHand
  return (
    <div className="chord-panel">
      <div className="chord-side">
        <ChordSettings />
        {phone && <BankTab />}
        <PitchWheel />
        {phone && <ShiftHold className="chord-shift" mark />}
      </div>
      <ChordGrid banks={!phone} />
      <div className="chord-stage">
        <LeadStrip />
        <RootPiano />
      </div>
    </div>
  )
}

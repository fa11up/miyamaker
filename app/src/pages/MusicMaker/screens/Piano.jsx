import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { noteOff, noteOn } from '../audio/engine.js'
import {
  CHORD_BANKS,
  CHORDS,
  KEY_HI,
  KEY_LO,
  ROOTS,
  SCALES,
  WHITE_COUNT,
  bankItemName,
  blackAnchor,
  clampAxis,
  clampBank,
  fingerVelocity,
  isWhite,
  slideKeys,
  strumSet,
  tunedPitch,
  visibleKeys,
} from '../audio/piano.js'
import { ChordPanel } from './ChordPanel.jsx'
import { noteName } from '../keys.js'
import { TRACK_VEL, clampPianoHeight, model, save, touch, trackerFields } from '../model.js'
import { useModel } from '../useModel.js'

function trackExtra() {
  if (model.screen !== 'track') return {}
  return { trackerNote: true, lane: Math.floor((model.tracker.col || 0) / trackerFields()) }
}

function playAt(midi, hold, velocity = TRACK_VEL) {
  noteOn(model.selected, velocity, hold, tunedPitch(midi, model.pianoRoot | 0, model.pianoTuning), trackExtra())
}

function pressVelocity(event, rect) {
  const y = (event.clientY - rect.top) / Math.max(1, rect.height)
  return fingerVelocity(y, clampAxis(model.pianoAxis))
}

function KeyMap() {
  const from = model.pianoFrom | 0
  const whites = model.pianoWhites | 0
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const host = event.currentTarget
    const rect = host.getBoundingClientRect()
    const indexAt = (x) => {
      const t = (x - rect.left) / Math.max(1, rect.width)
      return Math.max(0, Math.min(WHITE_COUNT - 1, Math.floor(t * WHITE_COUNT)))
    }
    const windowEl = host.querySelector('.piano-window')
    const wr = windowEl?.getBoundingClientRect()
    let mode = 'jump'
    if (wr && event.clientX >= wr.left && event.clientX <= wr.right) {
      if (event.clientX - wr.left <= 14) mode = 'start'
      else if (wr.right - event.clientX <= 14) mode = 'end'
      else mode = 'move'
    }
    const origin = indexAt(event.clientX)
    const originFrom = model.pianoFrom | 0
    const originWhites = model.pianoWhites | 0
    const id = event.pointerId
    const move = (ev) => {
      if (ev.pointerId !== id) return
      const next = slideKeys(originFrom, originWhites, mode, indexAt(ev.clientX) - origin, indexAt(ev.clientX))
      model.pianoFrom = next.from
      model.pianoWhites = next.whites
      touch(false)
    }
    const end = (ev) => {
      if (ev && ev.pointerId !== id) return
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', end)
      host.removeEventListener('pointercancel', end)
      save()
    }
    host.setPointerCapture?.(id)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', end)
    host.addEventListener('pointercancel', end)
    if (mode === 'jump') {
      const next = slideKeys(originFrom, originWhites, 'jump', 0, origin)
      model.pianoFrom = next.from
      model.pianoWhites = next.whites
      touch(false)
    }
  }
  const left = (from / WHITE_COUNT) * 100
  const width = (Math.max(7, Math.min(21, whites)) / WHITE_COUNT) * 100
  const blacks = []
  for (let midi = KEY_LO; midi <= KEY_HI; midi++) if (!isWhite(midi)) blacks.push(midi)
  return (
    <div className="piano-map" style={{ '--map-whites': WHITE_COUNT }} onPointerDown={down} aria-label="88 keys. Drag the window. Drag an edge to resize it.">
      <div className="piano-map-whites" aria-hidden="true">
        {Array.from({ length: WHITE_COUNT }, (_, i) => <i key={i} />)}
      </div>
      <div className="piano-map-blacks" aria-hidden="true">
        {blacks.map((midi) => (
          <i key={midi} style={{ left: `calc(${(blackAnchor(midi, 0) / WHITE_COUNT) * 100}% - (0.28 * 100% / ${WHITE_COUNT}))` }} />
        ))}
      </div>
      <div className="piano-window" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  )
}

function Board({ lit, onLit }) {
  const view = visibleKeys(model.pianoFrom, model.pianoWhites)
  const boardRef = useRef(null)
  const keyAt = (clientX, clientY) => {
    const board = boardRef.current
    if (!board) return null
    const rect = board.getBoundingClientRect()
    const whites = [...board.querySelectorAll('.piano-white')]
    if (!whites.length || clientY < rect.top || clientY > rect.bottom || clientX < rect.left || clientX > rect.right) return null
    if (clientY < rect.top + rect.height * 0.58) {
      for (const black of board.querySelectorAll('.piano-black')) {
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
    const board = event.currentTarget
    const id = event.pointerId
    let held = null
    const play = (ev) => {
      const midi = keyAt(ev.clientX, ev.clientY)
      if (midi === held) return
      if (held != null) noteOff('piano:key')
      held = midi
      onLit(midi)
      if (midi != null) playAt(Number(midi), 'piano:key', pressVelocity(ev, board.getBoundingClientRect()))
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      if (held != null) noteOff('piano:key')
      held = null
      onLit(null)
      board.removeEventListener('pointermove', play)
      board.removeEventListener('pointerup', up)
      board.removeEventListener('pointercancel', up)
    }
    board.setPointerCapture?.(id)
    board.addEventListener('pointermove', play)
    board.addEventListener('pointerup', up)
    board.addEventListener('pointercancel', up)
    play(event)
  }
  return (
    <div
      ref={boardRef}
      className="piano-board"
      style={{ '--whites': view.shown.length }}
      onPointerDown={down}
      role="group"
      aria-label="Piano"
    >
      {view.shown.map((midi) => (
        <button
          key={midi}
          type="button"
          className={`piano-white ${lit === String(midi) ? 'on' : ''}`}
          data-midi={midi}
          aria-label={noteName(midi - 60)}
          tabIndex={-1}
        >
          {(midi % 12) === 0 && <span>{noteName(midi - 60).replace('-', '')}</span>}
        </button>
      ))}
      {view.keys.filter((midi) => !isWhite(midi)).map((midi) => (
        <button
          key={midi}
          type="button"
          className={`piano-black ${lit === String(midi) ? 'on' : ''}`}
          data-midi={midi}
          aria-label={noteName(midi - 60)}
          tabIndex={-1}
          style={{ left: `calc(${(blackAnchor(midi, view.from) / view.shown.length) * 100}% - (0.31 * 100% / var(--whites)))` }}
        />
      ))}
    </div>
  )
}

function Strum() {
  const notes = strumSet({
    root: model.pianoRoot | 0,
    chord: model.pianoChord || '',
    scale: model.pianoScale || '',
    inversion: model.pianoInv | 0,
  })
  const host = useRef(null)
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const el = event.currentTarget
    const id = event.pointerId
    let last = -1
    const at = (x) => {
      const rect = el.getBoundingClientRect()
      const t = (x - rect.left) / Math.max(1, rect.width)
      return Math.max(0, Math.min(notes.length - 1, Math.floor(t * notes.length)))
    }
    const play = (ev) => {
      const index = at(ev.clientX)
      if (index === last) return
      if (last >= 0) noteOff(`piano:strum:${last}`)
      last = index
      const midi = notes[index]
      if (midi != null) playAt(midi, `piano:strum:${index}`, pressVelocity(ev, el.getBoundingClientRect()))
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      if (last >= 0) noteOff(`piano:strum:${last}`)
      last = -1
      el.removeEventListener('pointermove', play)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.setPointerCapture?.(id)
    el.addEventListener('pointermove', play)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    play(event)
  }
  const rootPc = model.pianoRoot | 0
  return (
    <div ref={host} className="piano-strum" onPointerDown={down} role="group" aria-label="Strum" style={{ '--stripes': notes.length }}>
      {notes.map((midi, index) => (
        <i key={`${midi}-${index}`} className={(midi % 12) === rootPc ? 'is-root' : ''}>{noteName(midi - 60).replace('-', '')}</i>
      ))}
    </div>
  )
}

function bankForSelection() {
  const chordId = model.pianoChord
  const scaleId = model.pianoScale
  if (chordId) {
    const at = CHORD_BANKS.findIndex((bank) => bank.items.some((item) => item.kind === 'chord' && item.id === chordId))
    if (at >= 0) return at
  }
  if (scaleId) {
    const at = CHORD_BANKS.findIndex((bank) => bank.items.some((item) => item.kind === 'scale' && item.id === scaleId))
    if (at >= 0) return at
  }
  return clampBank(model.pianoBank)
}

function StrumScreen() {
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
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  const toggle = () => {
    if (!open) {
      const bank = bankForSelection()
      if (bank !== clampBank(model.pianoBank)) {
        model.pianoBank = bank
        touch(false)
      }
    }
    setOpen((value) => !value)
  }
  const pick = (patch) => {
    if (patch.root != null) model.pianoRoot = patch.root
    if (patch.chord != null) {
      model.pianoChord = patch.chord
      model.pianoScale = ''
    }
    if (patch.scale != null) {
      model.pianoScale = patch.scale
      model.pianoChord = ''
    }
    touch(true)
    if (patch.root == null) setOpen(false)
  }
  const bankIndex = clampBank(model.pianoBank)
  const bank = CHORD_BANKS[bankIndex]
  return (
    <div className="strum-screen" ref={root}>
      <div className="strum-bar">
        <button
          type="button"
          className={`btn ${open ? 'on' : ''}`}
          aria-expanded={open}
          aria-label="Scale and root. Locates notes on the strings. Does not play."
          onClick={toggle}
        >
          Scale
        </button>
        <StrumCaption />
      </div>
      {open ? (
        <div className="strum-picker" role="dialog" aria-label="Scale and root. Marks the strings and does not play.">
          <div className="strum-roots" role="group" aria-label="Root">
            {ROOTS.map((name, index) => (
              <button
                key={name}
                type="button"
                className={`btn ${(model.pianoRoot | 0) === index ? 'on' : ''}`}
                aria-pressed={(model.pianoRoot | 0) === index}
                onClick={() => pick({ root: index })}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="strum-bank" role="group" aria-label={`${bank.label}. These mark the strings and do not play.`}>
            {bank.items.map((item) => {
              const name = bankItemName(item)
              const on = item.kind === 'chord'
                ? model.pianoChord === item.id && !model.pianoScale
                : model.pianoScale === item.id && !model.pianoChord
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`btn ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  title={name}
                  onClick={() => pick(item.kind === 'chord' ? { chord: item.id } : { scale: item.id })}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <div className="strum-banks" role="group" aria-label="Harmony banks">
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
        </div>
      ) : <Strum />}
    </div>
  )
}

function Octave() {
  const oct = model.renoiseOct ?? 3
  const bump = (dir) => {
    model.renoiseOct = Math.max(0, Math.min(8, oct + dir))
    touch(true)
  }
  return (
    <div className="piano-oct">
      <button type="button" className="btn" aria-label="Lower octave" onClick={() => bump(-1)}>−</button>
      <span>Oct {oct}</span>
      <button type="button" className="btn" aria-label="Higher octave" onClick={() => bump(1)}>+</button>
    </div>
  )
}

function StrumCaption() {
  const root = ROOTS[model.pianoRoot | 0] || 'C'
  const chord = CHORDS.find((item) => item.id === model.pianoChord)
  const scale = SCALES.find((item) => item.id === model.pianoScale)
  const name = chord ? chord.name : (scale ? scale.name : 'Chromatic')
  const inv = model.pianoInv | 0
  return <p className="piano-caption">{root} · {name}{inv ? ` · ${inv}` : ''}</p>
}

function usePianoRoom() {
  const [room, setRoom] = useState(640)
  useLayoutEffect(() => {
    const main = document.querySelector('[data-miya-music]')?.shadowRoot?.querySelector('.mmm-main')
    if (!main || typeof ResizeObserver === 'undefined') return undefined
    const fit = () => {
      const next = Math.max(180, main.clientHeight - 120)
      setRoom((prev) => (prev === next ? prev : next))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(main)
    return () => watch.disconnect()
  }, [])
  return room
}

export function Piano() {
  useModel()
  const [lit, setLit] = useState(null)
  const room = usePianoRoom()
  const roomRef = useRef(room)
  roomRef.current = room
  const view = model.playSurface === 'chords' || model.playSurface === 'strum' ? model.playSurface : 'keys'
  const cap = Math.max(180, Math.min(640, room))
  const height = Math.min(clampPianoHeight(model.pianoHeight), cap)
  const dragHeight = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const origin = height
    const id = event.pointerId
    const move = (ev) => {
      if (ev.pointerId !== id) return
      const limit = Math.max(180, Math.min(640, roomRef.current))
      const next = origin - (ev.clientY - startY)
      model.pianoHeight = Math.max(180, Math.min(limit, Math.round(next)))
      touch(false)
    }
    const end = (ev) => {
      if (ev && ev.pointerId !== id) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      touch(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const nudgeHeight = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    const limit = Math.max(180, Math.min(640, roomRef.current))
    const dir = event.key === 'ArrowUp' ? 16 : -16
    model.pianoHeight = Math.max(180, Math.min(limit, clampPianoHeight(model.pianoHeight) + dir))
    touch(true)
  }
  return (
    <div className="piano-dock">
      <div
        className="piano-splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the on-screen keys"
        tabIndex={0}
        onPointerDown={dragHeight}
        onKeyDown={nudgeHeight}
      />
      <div className={`perf-surface for-${view} piano`} style={{ height }}>
        {view === 'keys' && (
          <>
            <KeyMap />
            <Board lit={lit} onLit={setLit} />
            <Octave />
          </>
        )}
        {view === 'chords' && <ChordPanel />}
        {view === 'strum' && <StrumScreen />}
      </div>
    </div>
  )
}

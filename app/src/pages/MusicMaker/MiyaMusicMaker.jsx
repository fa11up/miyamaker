import { useEffect } from 'react'
import { PAD_KEYS, SCREENS, SEQ_KEYS, SHORTCUTS, pianoNote, renoiseNote } from './keys.js'
import {
  addBar,
  clearHit,
  cycleScreen,
  deleteSelection,
  doubleUp,
  model,
  removeBar,
  selectPad,
  setBank,
  setPattern,
  setScreen,
  setSeqBank,
  setSeqSlot,
  touch,
  trackerFields,
  TRACK_VEL,
} from './model.js'
import { enableMidi, getMidiState, holdNumpadFx, importFile, noteOff, noteOn, pushNumpadFx, recordTrackerOff, releaseKeyboardNotes, releaseNumpadFx, syncMasterComp, syncMixer, toggleMetro, togglePlay, toggleRecord } from './audio/engine.js'
import { midiSummary } from './audio/midi.js'
import { undo } from './history.js'
import { useModel } from './useModel.js'
import { Dialog } from './widgets.jsx'
import { Pads } from './screens/Pads.jsx'
import { Editor } from './screens/Editor.jsx'
import { Sequencer } from './screens/Sequencer.jsx'
import { Mixer } from './screens/Mixer.jsx'
import { Tracker, handleTrackerKey } from './screens/Tracker.jsx'
import { Synth } from './screens/Synth.jsx'
import { Fx } from './screens/Fx.jsx'
import { SampleBrowser } from './screens/Browser.jsx'
import { FileMenu } from './screens/FileMenu.jsx'
import { KeysMap } from './screens/KeysMap.jsx'
import { buildPublish, listenForFiles } from './publish.js'
import { NewMenu, SaveMenu } from './screens/SongMenus.jsx'

export function MiyaMusicMaker() {
  useModel()
  useEffect(() => listenForFiles(buildPublish), [])
  useEffect(() => {
    const down = () => {
      enableMidi().catch(() => {})
    }
    window.addEventListener('pointerdown', down, { once: true })
    return () => window.removeEventListener('pointerdown', down)
  }, [])
  useEffect(() => {
    const down = (e) => onKey(e)
    const up = (e) => {
      const low = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (e.key === 'Shift') releaseNumpadFx()
      const digit = numpadDigit(e)
      if (digit != null) releaseNumpadFx(digit)
      if (e.key === 'Shift' || low === 'n' || low === 'b') model.hold = null
      noteOff(`key:${e.code}`)
    }
    const blur = () => {
      model.hold = null
      releaseNumpadFx()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  return (
    <div
      className={`mmm ${model.k3 ? 'theme-k3' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || f.type.startsWith('video') || /\.(wav|mp3|ogg|flac|aiff|aif|m4a|mp4|webm|mov|m1ya|mod|xm|k1t)$/i.test(f.name))
        files.forEach((file, i) => importFile(file, Math.min(63, model.selected + i)))
      }}
    >
      <div className="mmm-bar">
        <FileMenu />
        <NewMenu />
        <SaveMenu />
      </div>
      <div className="mmm-body">
        <SampleBrowser />
        <div className="mmm-main">
      <Transport />
      {model.screen === 'pads' && <Pads />}
      {model.screen === 'edit' && <Editor />}
      {model.screen === 'seq' && <Sequencer />}
      {model.screen === 'mix' && <Mixer />}
      {model.screen === 'track' && <Tracker />}
      {model.screen === 'synth' && <Synth />}
      {model.screen === 'fx' && <Fx />}
      {model.keysHelp && (
        <KeysMap onClose={() => { model.keysHelp = false; touch(false) }} />
      )}
      {model.help && (
        <Dialog title="QWERTY shortcuts" onClose={() => { model.help = false; touch(false) }}>
          <table>
            <tbody>
              {SHORTCUTS.map(([key, action]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Pad plays the bank, including the A B C D pages on [ ] and the arrow keys. Keys plays the selected pad. Click MIDI for a Launchpad, MPC, MPD, MPK, or any other controller. Shift and a numpad digit holds a master FX slot.</p>
        </Dialog>
      )}
        </div>
      </div>
    </div>
  )
}

function Transport() {
  const midi = midiSummary(getMidiState())
  const midiLive = getMidiState().inputs.length > 0
  return (
    <div className="transport">
      <div className="transport-row">
        <div className="transport-group">
          <button type="button" className={`btn free-width ${model.playing ? 'on' : ''}`} onClick={() => togglePlay()}>
            {model.playing ? 'Stop' : 'Play'}
          </button>
          <button
            type="button"
            className={`btn free-width rec ${(model.screen === 'track' ? model.tracker.edit : model.recording) ? 'on' : ''}`}
            onClick={() => {
              if (model.screen === 'track') {
                model.tracker.edit = !model.tracker.edit
                model.tracker.focus = true
                touch(false)
                return
              }
              toggleRecord()
            }}
          >
            Rec
          </button>
          <button type="button" className={`btn free-width ${model.metro ? 'on' : ''}`} onClick={() => toggleMetro()}>
            Metro
          </button>
          <button
            type="button"
            className="btn free-width"
            onClick={() => {
              undo().then((did) => {
                if (!did) return
                syncMasterComp()
                syncMixer(true)
                pushNumpadFx()
              })
            }}
          >
            Undo
          </button>
          <label className="slider" style={{ width: 120 }}>
            <span>BPM</span>
            <input
              className="field num"
              type="number"
              min={40}
              max={240}
              value={model.bpm}
              onChange={(e) => {
                model.bpm = Math.max(40, Math.min(240, Number(e.target.value) || 96))
                touch(true)
              }}
            />
            <em />
          </label>
          <span className="song-name" title={model.songName || 'No song'}>{model.songName || 'No song'}</span>
        </div>
        <div className="bank-row">
          {['A', 'B', 'C', 'D'].map((name, i) => (
            <button key={name} type="button" className={`btn free-width ${model.bank === i ? 'on' : ''}`} onClick={() => setBank(i)}>
              {name}
            </button>
          ))}
        </div>
        <div className="mode-toggle" role="group" aria-label="Play mode">
          <button type="button" className={`btn free-width ${keysMode() ? '' : 'on'}`} onClick={() => setPlayMode('pad')}>
            Pad
          </button>
          <button type="button" className={`btn free-width ${keysMode() ? 'on' : ''}`} onClick={() => setPlayMode('keys')}>
            {keysMode() ? `Keys ${model.renoiseOct}` : 'Keys'}
          </button>
          <button
            type="button"
            className={`btn keys-map-btn ${model.keysHelp ? 'on' : ''}`}
            aria-label="Pad and Keys keyboard"
            title="Pad and Keys"
            onClick={() => {
              model.keysHelp = !model.keysHelp
              touch(false)
            }}
          >
            <span className="keys-mark" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className={`btn free-width midi-btn ${midiLive ? 'on' : ''}`}
          title={midi.title}
          onClick={() => enableMidi().catch(() => {})}
        >
          {midi.short}
        </button>
      </div>
      <div className="transport-row">
        <div className="screen-tabs">
          {SCREENS.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className={`btn free-width ${model.screen === screen.id ? 'on' : ''}`}
              onClick={() => setScreen(screen.id)}
            >
              {screen.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function typing(e) {
  const tag = e.target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable
}

function numpadDigit(e) {
  const code = e.code || ''
  if (e.location !== 3 && !code.startsWith('Numpad')) return null
  if (code === 'NumpadDivide' || code === 'NumpadMultiply' || code === 'NumpadAdd' || code === 'NumpadSubtract' || code === 'NumpadEnter' || code === 'NumpadDecimal') return null
  if (e.key >= '0' && e.key <= '9') return Number(e.key)
  return null
}

function keysMode() {
  return model.keyboard && model.keyMap === 'renoise'
}

function setPlayMode(mode) {
  if (mode === 'keys') {
    model.keyboard = true
    model.keyMap = 'renoise'
  } else {
    model.keyboard = false
    model.keyMap = 'koala'
  }
  touch(true)
}

function renoiseLive() {
  return keysMode()
}

function onTrackerNote(e) {
  if ((model.tracker.col | 0) % trackerFields() !== 0) return false
  const key = e.key
  const low = key.length === 1 ? key.toLowerCase() : key
  if (low === 'a' || key === 'CapsLock') {
    e.preventDefault()
    if (model.tracker.edit) recordTrackerOff()
    return true
  }
  const note = renoiseNote(key, model.renoiseOct)
  if (note == null) return false
  e.preventDefault()
  noteOn(model.selected, TRACK_VEL, `key:${e.code}`, note - 60)
  return true
}

function shiftRenoiseOct(dir) {
  model.renoiseOct = Math.max(0, Math.min(8, (model.renoiseOct ?? 3) + dir))
  touch(false)
}

function musicUnfocused() {
  const host = document.querySelector('[data-miya-music]')
  if (!host) return false
  const frame = host.closest('.react-draggable')
  if (!frame) return false
  return !frame.classList.contains('is-focused')
}

let qStep = 0
let qAt = 0
let kAt = 0

function onKey(e) {
  if (musicUnfocused()) return
  if (typing(e)) return
  if (model.fileWindow || model.keysHelp) return
  const key = e.key
  if (!e.repeat && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'Digit4') {
    const now = performance.now()
    e.preventDefault()
    if (kAt && now - kAt < 450) {
      kAt = 0
      model.k3 = !model.k3
      touch(false)
    } else kAt = now
    return
  }
  if (model.screen === 'mix' && model.compFocus && !e.repeat && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code?.startsWith('Digit')) {
    const now = performance.now()
    if (now - qAt > 2000) qStep = 0
    const want = [49, 52, 56, 56][qStep]
    const got = e.code.charCodeAt(5)
    qAt = now
    if (got === want) {
      qStep += 1
      e.preventDefault()
      if (qStep >= 4) {
        qStep = 0
        model.comp.justice = !model.comp.justice
        touch(true)
        syncMasterComp()
      }
      return
    }
    qStep = got === 49 ? 1 : 0
    if (qStep === 1) {
      e.preventDefault()
      return
    }
  } else if (!e.repeat && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') {
    qStep = 0
  }
  const trackerFocus = model.screen === 'track' && model.tracker.focus
  if ((renoiseLive() || trackerFocus) && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (key === '[' || key === ']')) {
    e.preventDefault()
    shiftRenoiseOct(key === '[' ? -1 : 1)
    return
  }
  if (trackerFocus && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^[0-9]$/.test(key)) {
    e.preventDefault()
    model.tracker.step = key === '0' ? 0 : Number(key)
    touch(true)
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.repeat && (key === 'z' || key === 'Z')) {
    e.preventDefault()
    undo().then((did) => {
      if (!did) return
      syncMasterComp()
      syncMixer(true)
      pushNumpadFx()
    })
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const digit = numpadDigit(e)
  if (digit != null && e.shiftKey) {
    e.preventDefault()
    if (!e.repeat) holdNumpadFx(digit)
    return
  }
  const trackerFocusNow = model.screen === 'track' && model.tracker.focus
  if (e.repeat && key === ' ') return
  if (e.repeat && !trackerFocusNow) return
  const low = key.length === 1 ? key.toLowerCase() : key
  const musical = renoiseLive()

  if (trackerFocusNow) {
    if (onTrackerNote(e)) return
    if (handleTrackerKey(e)) {
      e.preventDefault()
      return
    }
  }

  if (key === 'Shift') {
    model.hold = 'edit'
    return
  }
  if (low === 'n' && !musical) {
    model.hold = 'solo'
    e.preventDefault()
    return
  }
  if (low === 'b' && !model.keyboard) {
    model.hold = 'mute'
    e.preventDefault()
    return
  }
  if (key === ' ') {
    e.preventDefault()
    togglePlay()
    return
  }
  if (key === '0' && !musical && !(model.screen === 'track' && model.tracker.focus)) {
    e.preventDefault()
    toggleRecord()
    return
  }
  if (low === 'm' && !musical) {
    e.preventDefault()
    toggleMetro()
    return
  }
  if ((musical || trackerFocusNow) && (e.code === 'NumpadDivide' || (key === '/' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(-1)
    return
  }
  if ((musical || trackerFocusNow) && (e.code === 'NumpadMultiply' || (key === '*' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(1)
    return
  }
  if (key === '/') {
    e.preventDefault()
    setPlayMode(keysMode() ? 'pad' : 'keys')
    return
  }
  if (key === 'Tab') {
    e.preventDefault()
    cycleScreen(e.shiftKey ? -1 : 1)
    return
  }
  if (key === '[') {
    e.preventDefault()
    setBank(model.bank - 1)
    return
  }
  if (key === ']') {
    e.preventDefault()
    setBank(model.bank + 1)
    return
  }
  if (key === '{' || key === '}') {
    e.preventDefault()
    const dir = key === '{' ? -1 : 1
    if (model.screen === 'pads') setSeqBank(Math.floor(model.pattern / 8) + dir)
    else setPattern(model.pattern + dir)
    return
  }
  if (key === '=') {
    e.preventDefault()
    addBar()
    return
  }
  if (key === '-') {
    e.preventDefault()
    removeBar()
    return
  }
  if (key === '_') {
    e.preventDefault()
    doubleUp()
    return
  }
  if (key === 'ArrowDown' && !(model.screen === 'track' && model.tracker.focus)) {
    e.preventDefault()
    document.querySelector('.browser-search input')?.focus()
    return
  }
  if ((key === 'Delete' || key === 'Backspace') && !(model.screen === 'track' && model.tracker.focus)) {
    e.preventDefault()
    if (model.screen === 'seq' && model.seqHit) {
      clearHit(model.seqHit.step, model.seqHit.pad)
      model.seqHit = null
      touch(false)
      return
    }
    deleteSelection()
    return
  }

  if (model.keyboard) {
    if (model.keyMap === 'renoise') {
      if (low === 'a' || key === 'CapsLock') {
        e.preventDefault()
        releaseKeyboardNotes()
        return
      }
      const note = renoiseNote(key, model.renoiseOct)
      if (note != null) {
        e.preventDefault()
        noteOn(model.selected, TRACK_VEL, `key:${e.code}`, note - 60)
      }
      return
    }
    if (low === 'z') {
      model.octave = Math.max(1, model.octave - 1)
      touch(false)
      e.preventDefault()
      return
    }
    if (low === 'x') {
      model.octave = Math.min(7, model.octave + 1)
      touch(false)
      e.preventDefault()
      return
    }
    const note = pianoNote(key, model.octave)
    if (note != null) {
      e.preventDefault()
      noteOn(model.selected, TRACK_VEL, `key:${e.code}`, note - 60)
    }
    return
  }

  if (key === 'ArrowLeft') {
    e.preventDefault()
    setBank(model.bank - 1)
    return
  }
  if (key === 'ArrowRight') {
    e.preventDefault()
    setBank(model.bank + 1)
    return
  }

  const local = PAD_KEYS.indexOf(low)
  if (local >= 0) {
    e.preventDefault()
    const index = model.bank * 16 + local
    if (model.hold) {
      selectPad(index, model.hold)
      return
    }
    selectPad(index)
    noteOn(index, TRACK_VEL, `key:${e.code}`)
    return
  }

  if (model.screen === 'pads') {
    const slot = SEQ_KEYS.indexOf(low)
    if (slot >= 0) {
      e.preventDefault()
      setSeqSlot(slot)
    }
  }
}

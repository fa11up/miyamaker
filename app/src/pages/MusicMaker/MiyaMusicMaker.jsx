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
} from './model.js'
import { holdNumpadFx, importFile, noteOff, noteOn, releaseKeyboardNotes, releaseNumpadFx, toggleMetro, togglePlay, toggleRecord } from './audio/engine.js'
import { useModel } from './useModel.js'
import { Dialog, Slider } from './widgets.jsx'
import { Pads } from './screens/Pads.jsx'
import { Editor } from './screens/Editor.jsx'
import { Sequencer } from './screens/Sequencer.jsx'
import { Mixer } from './screens/Mixer.jsx'
import { Tracker, handleTrackerKey } from './screens/Tracker.jsx'
import { Synth } from './screens/Synth.jsx'
import { Fx } from './screens/Fx.jsx'
import { SampleBrowser } from './screens/Browser.jsx'

export function MiyaMusicMaker() {
  useModel()
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
      className="mmm"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || f.type.startsWith('video') || /\.(wav|mp3|ogg|flac|aiff|aif|m4a|mp4|webm|mov)$/i.test(f.name))
        files.forEach((file, i) => importFile(file, Math.min(63, model.selected + i)))
      }}
    >
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
          <p className="hint">These match Koala Sampler’s default map, including the A B C D pad pages on [ ] and the arrow keys. Shift and a numpad digit holds a master FX slot.</p>
        </Dialog>
      )}
        </div>
      </div>
    </div>
  )
}

function Transport() {
  return (
    <div className="transport">
      <div className="transport-group">
        <button type="button" className={`btn free-width ${model.playing ? 'on' : ''}`} onClick={() => togglePlay()}>
          {model.playing ? 'Stop' : 'Play'}
        </button>
        <button type="button" className={`btn free-width rec ${model.recording ? 'on' : ''}`} onClick={() => toggleRecord()}>
          Rec
        </button>
        <button type="button" className={`btn free-width ${model.metro ? 'on' : ''}`} onClick={() => toggleMetro()}>
          Metro
        </button>
        <label className="slider" style={{ width: 180 }}>
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
      </div>
      <div className="bank-row">
        {['A', 'B', 'C', 'D'].map((name, i) => (
          <button key={name} type="button" className={`btn free-width ${model.bank === i ? 'on' : ''}`} onClick={() => setBank(i)}>
            {name}
          </button>
        ))}
      </div>
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
      <div className="transport-group">
        <button
          type="button"
          className={`btn free-width ${model.keyboard ? 'on' : ''}`}
          onClick={() => {
            model.keyboard = !model.keyboard
            touch(false)
          }}
        >
          {model.keyboard ? 'Keys on' : 'Keys'}
        </button>
        <button
          type="button"
          className={`btn free-width ${model.keyMap === 'koala' ? 'on' : ''}`}
          onClick={() => {
            model.keyMap = 'koala'
            touch(true)
          }}
        >
          {model.keyboard && model.keyMap === 'koala' ? `Koala oct ${model.octave}` : 'Koala'}
        </button>
        <button
          type="button"
          className={`btn free-width ${model.keyMap === 'renoise' ? 'on' : ''}`}
          onClick={() => {
            model.keyMap = 'renoise'
            touch(true)
          }}
        >
          {model.keyboard && model.keyMap === 'renoise' ? `Renoise oct ${model.renoiseOct}` : 'Renoise'}
        </button>
      </div>
      <Slider
        label="Click"
        min={0}
        max={1}
        step={0.01}
        value={model.metroVol}
        onChange={(v) => {
          model.metroVol = v
          touch(true)
        }}
      />
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

function renoiseLive() {
  return model.keyboard && model.keyMap === 'renoise'
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

function onKey(e) {
  if (musicUnfocused()) return
  if (typing(e)) return
  const key = e.key
  if (renoiseLive() && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (key === '[' || key === ']')) {
    e.preventDefault()
    shiftRenoiseOct(key === '[' ? -1 : 1)
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const digit = numpadDigit(e)
  if (digit != null && e.shiftKey) {
    e.preventDefault()
    if (!e.repeat) holdNumpadFx(digit)
    return
  }
  if (e.repeat) return
  const low = key.length === 1 ? key.toLowerCase() : key
  const musical = renoiseLive()

  if (model.screen === 'track' && model.tracker.focus) {
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
  if (musical && (e.code === 'NumpadDivide' || (key === '/' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(-1)
    return
  }
  if (musical && (e.code === 'NumpadMultiply' || (key === '*' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(1)
    return
  }
  if (key === '/') {
    e.preventDefault()
    model.keyboard = !model.keyboard
    touch(false)
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
        noteOn(model.selected, 1, `key:${e.code}`, note - 60)
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
      noteOn(model.selected, 0.9, `key:${e.code}`, note - 60)
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
    noteOn(index, 0.9, `key:${e.code}`)
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

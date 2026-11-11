import { noteName, renoiseNote } from '../keys.js'
import { noteOff, noteOn, releaseKeyboardNotes } from '../audio/engine.js'
import { BANKS, TRACK_VEL, busLabel, model, padKeyLabel, touch, trackerFields } from '../model.js'
import { padGesture } from '../padEdit.js'
import { PadWave, usePadVis } from '../padVis.js'
import { useModel } from '../useModel.js'
import { FxPresets, NumpadGrid } from './Fx.jsx'

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
]

function trackExtra() {
  if (model.screen !== 'track') return {}
  return { trackerNote: true, lane: Math.floor((model.tracker.col || 0) / trackerFields()), noCapture: true }
}

export function PlaySurface() {
  useModel()
  if (model.playSurface === 'off') return null
  if (model.playSurface === 'keys') return <PhoneKeys />
  if (model.playSurface === 'fx') return <PhoneFx />
  if (model.screen === 'pads') return null
  return <PhonePads />
}

function PhoneFx() {
  if (model.screen === 'fx') return null
  return (
    <div className="perf-surface for-fx">
      <FxPresets />
      <NumpadGrid />
    </div>
  )
}

function PhonePads() {
  usePadVis()
  const start = model.bank * 16
  return (
    <div className="perf-surface for-pads">
      <div className="pad-grid perf-pads">
        {Array.from({ length: 16 }, (_, local) => {
          const index = start + local
          const pad = model.pads[index]
          const cls = [
            'pad',
            pad.source === 'empty' ? 'empty' : 'seen',
            model.selected === index || model.selection.includes(index) ? 'selected' : '',
            pad.mute ? 'muted' : '',
            pad.solo ? 'soloed' : '',
          ].filter(Boolean).join(' ')
          return (
            <button key={index} type="button" className={cls} data-pad={index} {...padGesture(index, { play: true })}>
              <PadWave index={index} />
              <span className="key">{padKeyLabel(local)}</span>
              <span className="name">{pad.name}</span>
              <span className="meta">{BANKS[model.bank]}{local + 1} · {model.buses[pad.bus]?.name || busLabel(pad.bus)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PhoneKeys() {
  const oct = model.renoiseOct ?? 3
  const shift = (dir) => {
    model.renoiseOct = Math.max(0, Math.min(8, oct + dir))
    touch(false)
  }
  return (
    <div className="perf-surface for-keys">
      <div className="perf-oct">
        <button type="button" className="btn" data-nav aria-label="Lower octave" onClick={() => shift(-1)}>−</button>
        <span>Oct {oct}</span>
        <button type="button" className="btn" data-nav aria-label="Higher octave" onClick={() => shift(1)}>+</button>
      </div>
      {ROWS.map((row) => (
        <div className="perf-row" key={row[0]}>
          {row.map((key) => {
            const off = key === 'a'
            const midi = renoiseNote(key, oct)
            if (midi == null && !off) return <span key={key} className="perf-key idle" />
            const hold = `touch:${key}`
            return (
              <button
                key={key}
                type="button"
                className={`perf-key ${off ? 'off' : 'note'}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  if (off) {
                    releaseKeyboardNotes()
                    return
                  }
                  // Capture so a release off the key still reaches it; a looping note would otherwise stay on.
                  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* already gone */ }
                  noteOn(model.selected, TRACK_VEL, hold, midi - 60, trackExtra())
                }}
                onPointerUp={() => noteOff(hold)}
                onPointerCancel={() => noteOff(hold)}
                onLostPointerCapture={() => noteOff(hold)}
              >
                {off ? 'off' : noteName(midi - 60)}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

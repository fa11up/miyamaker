import { GRAIN_DIRS, REPEAT_NAMES, SLICE_FILLS, SLICE_PATTERNS, repeatAmount } from '../audio/numpadFx.js'
import { pushNumpadFx } from '../audio/engine.js'
import { model, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { Knob } from '../widgets.jsx'

const ORDER = [7, 8, 9, 4, 5, 6, 1, 2, 3, 0]

function editSlot(index, patch) {
  const slot = { ...model.numpadFx[index], ...patch }
  model.numpadFx = model.numpadFx.map((item, i) => (i === index ? slot : item))
  pushNumpadFx()
  touch(true)
}

function hintFor(type) {
  if (type === 'repeat') return 'Grabs the next note, from a half note down to a 128th, and repeats that slice until the key comes up. Mix FF is only the repeat.'
  if (type === 'slice') return 'Records up to eight of those notes, then plays them in the pattern. Fill can loop the end, pitch it, machine-gun it, reverse inside the slice, or fade it.'
  if (type === 'grain') return 'Short grains, measured in milliseconds. Gap is the space between them. This is not a beat repeat.'
  if (type === 'filter') return 'Low pass on the master. Cut opens the filter. Reso is the resonance.'
  if (type === 'flange') return 'A short sweep with feedback. Depth is how wide, Rate is how fast.'
  return 'A slow detune. Depth is how wide, Rate is how fast.'
}

export function Fx() {
  useModel()
  const index = model.fxEdit || 0
  const slot = model.numpadFx[index]
  const live = model.fxHeld
  const type = slot.type
  return (
    <div className="screen fx-screen">
      <p className="hint">
        Hold Shift and a numpad digit. Repeat and Slice follow the project tempo. Grain, filter, chorus, and flanger leave the beat alone.
        Numpad / and * still move the Keys octave.
      </p>
      <div className="fx-layout">
      <div className="numpad" role="listbox" aria-label="Numpad FX">
        {ORDER.map((digit) => {
          const item = model.numpadFx[digit]
          const on = index === digit
          const held = live === digit
          return (
            <button
              key={digit}
              type="button"
              role="option"
              aria-selected={on}
              className={`num-key ${on ? 'on' : ''} ${held ? 'live' : ''} ${digit === 0 ? 'zero' : ''}`}
              onClick={() => {
                model.fxEdit = digit
                touch(false)
              }}
            >
              <b>{digit}</b>
              <span>{item.type}</span>
            </button>
          )
        })}
      </div>
      <fieldset className="group fx-edit">
        <legend>Numpad {index}</legend>
        <label className="fx-field">
          <span>Type</span>
          <select
            className="row-select"
            value={type}
            onChange={(e) => {
              const next = e.target.value
              const patch = { type: next }
              if (next === 'repeat') patch.b = 255
              if (next === 'slice') {
                patch.a = 0
                patch.b = 0
                patch.mix = 255
              }
              if (next === 'grain') {
                patch.div = 0
                patch.a = 80
                patch.b = 40
                patch.mix = 220
              }
              editSlot(index, patch)
            }}
          >
            <option value="repeat">Repeat</option>
            <option value="slice">Slice</option>
            <option value="grain">Grain</option>
            <option value="filter">Filter</option>
            <option value="chorus">Chorus</option>
            <option value="flange">Flanger</option>
          </select>
        </label>
        {(type === 'repeat' || type === 'slice') && (
          <label className="fx-field">
            <span>{type === 'slice' ? 'Slice' : 'Retrig'}</span>
            <select
              className="row-select"
              value={slot.div}
              onChange={(e) => {
                const div = Number(e.target.value)
                editSlot(index, { div, a: type === 'repeat' ? repeatAmount(div) : slot.a })
              }}
            >
              {REPEAT_NAMES.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'slice' && (
          <label className="fx-field">
            <span>Pattern</span>
            <select className="row-select" value={Math.max(0, Math.min(7, slot.a | 0))} onChange={(e) => editSlot(index, { a: Number(e.target.value) })}>
              {SLICE_PATTERNS.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'slice' && (
          <label className="fx-field">
            <span>Fill</span>
            <select className="row-select" value={Math.max(0, Math.min(5, slot.b | 0))} onChange={(e) => editSlot(index, { b: Number(e.target.value) })}>
              {SLICE_FILLS.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'grain' && (
          <label className="fx-field">
            <span>Direction</span>
            <select className="row-select" value={slot.div % 3} onChange={(e) => editSlot(index, { div: Number(e.target.value) })}>
              {GRAIN_DIRS.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="knob-row">
          {type === 'repeat' && (
            <Knob label="Mix" min={0} max={255} value={slot.b} onChange={(v) => editSlot(index, { b: Math.round(v) })} />
          )}
          {type === 'slice' && (
            <Knob label="Mix" min={0} max={255} value={slot.mix} onChange={(v) => editSlot(index, { mix: Math.round(v) })} />
          )}
          {type === 'grain' && (
            <Knob label="Size" min={0} max={255} value={slot.a} onChange={(v) => editSlot(index, { a: Math.round(v) })} />
          )}
          {type === 'grain' && (
            <Knob label="Gap" min={0} max={255} value={slot.b} onChange={(v) => editSlot(index, { b: Math.round(v) })} />
          )}
          {type === 'grain' && (
            <Knob label="Mix" min={0} max={255} value={slot.mix} onChange={(v) => editSlot(index, { mix: Math.round(v) })} />
          )}
          {(type === 'filter' || type === 'chorus' || type === 'flange') && (
            <Knob
              label={type === 'filter' ? 'Cut' : 'Depth'}
              min={0}
              max={255}
              value={slot.a}
              onChange={(v) => editSlot(index, { a: Math.round(v) })}
            />
          )}
          {(type === 'filter' || type === 'chorus' || type === 'flange') && (
            <Knob
              label={type === 'filter' ? 'Reso' : 'Rate'}
              min={0}
              max={255}
              value={slot.b}
              onChange={(v) => editSlot(index, { b: Math.round(v) })}
            />
          )}
        </div>
        <p className="hint">{hintFor(type)}</p>
      </fieldset>
      </div>
    </div>
  )
}

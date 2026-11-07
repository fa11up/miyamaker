import { REPEAT_NAMES } from '../audio/numpadFx.js'
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

export function Fx() {
  useModel()
  const index = model.fxEdit || 0
  const slot = model.numpadFx[index]
  const live = model.fxHeld
  return (
    <div className="screen fx-screen">
      <p className="hint">
        Hold Shift and a numpad digit. That slot retriggers the master output, then runs its filter or effect until the key comes up.
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
            value={slot.type}
            onChange={(e) => editSlot(index, { type: e.target.value })}
          >
            <option value="repeat">Repeat</option>
            <option value="filter">Filter</option>
            <option value="chorus">Chorus</option>
            <option value="flange">Flanger</option>
          </select>
        </label>
        <label className="fx-field">
          <span>Retrig</span>
          <select
            className="row-select"
            value={slot.type === 'repeat' ? Math.max(0, Math.min(6, (slot.a * 7 / 256) | 0)) : slot.div}
            onChange={(e) => {
              const div = Number(e.target.value)
              if (slot.type === 'repeat') editSlot(index, { a: Math.round((div * 256) / 7) })
              else editSlot(index, { div })
            }}
          >
            {REPEAT_NAMES.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
        </label>
        <div className="knob-row">
          <Knob
            label={slot.type === 'repeat' ? 'Mix' : slot.type === 'filter' ? 'Cut' : 'Depth'}
            min={0}
            max={255}
            value={slot.type === 'repeat' ? slot.b : slot.a}
            onChange={(v) => editSlot(index, slot.type === 'repeat' ? { b: Math.round(v) } : { a: Math.round(v) })}
          />
          {slot.type !== 'repeat' && (
            <Knob
              label={slot.type === 'filter' ? 'Reso' : 'Rate'}
              min={0}
              max={255}
              value={slot.b}
              onChange={(v) => editSlot(index, { b: Math.round(v) })}
            />
          )}
          {slot.type !== 'repeat' && (
            <Knob label="Mix" min={0} max={255} value={slot.mix} onChange={(v) => editSlot(index, { mix: Math.round(v) })} />
          )}
        </div>
        <p className="hint">
          {slot.type === 'repeat'
            ? 'Repeat locks a slice of the output to the project tempo. Mix FF is only the retrigger.'
            : 'Every one of these still retriggers, then the effect runs on that loop. Div is the retrigger length. Mix is how much of the loop you hear.'}
        </p>
      </fieldset>
      </div>
    </div>
  )
}

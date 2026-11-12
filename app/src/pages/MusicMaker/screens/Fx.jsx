import { useState } from 'react'
import { FACTORY_FX, GRAIN_DIRS, REPEAT_NAMES, SLICE_FILLS, SLICE_PATTERNS, factoryFxSlots, normalizeFxPresets, normalizeNumpadFx, repeatAmount } from '../audio/numpadFx.js'
import { holdNumpadFx, pushNumpadFx, releaseNumpadFx } from '../audio/engine.js'
import { model, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { HelpButton, Knob } from '../widgets.jsx'
import { startPorta, stopPorta } from './porta.js'

const ORDER = [7, 8, 9, 4, 5, 6, 1, 2, 3, 0]

function editSlot(index, patch) {
  const slot = { ...model.numpadFx[index], ...patch }
  model.numpadFx = model.numpadFx.map((item, i) => (i === index ? slot : item))
  pushNumpadFx()
  touch(true)
}

function applySlots(slots) {
  model.numpadFx = normalizeNumpadFx(slots)
  pushNumpadFx()
  touch(true)
}

export function FxPresets() {
  const [name, setName] = useState('Preset')
  const saved = Array.isArray(model.fxPresets) ? model.fxPresets : []
  return (
    <div className="fx-presets">
      <select
        className="row-select"
        aria-label="FX preset"
        value=""
        onChange={(e) => {
          const value = e.target.value
          if (!value) return
          if (value.startsWith('built:')) applySlots(factoryFxSlots(value.slice(6)))
          else {
            const found = saved.find((item) => item.name === value)
            if (found) applySlots(found.slots)
          }
        }}
      >
        <option value="">Preset</option>
        {FACTORY_FX.map((item) => <option key={item} value={`built:${item}`}>{item}</option>)}
        {saved.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select>
      <input
        className="field"
        aria-label="Preset name"
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        onClick={() => {
          const title = name.trim().replace(/\s+/g, ' ').slice(0, 24) || 'Preset'
          const list = normalizeFxPresets(model.fxPresets).filter((item) => item.name !== title)
          list.push({ name: title, slots: normalizeNumpadFx(model.numpadFx) })
          model.fxPresets = list.slice(-24)
          touch(true)
        }}
      >
        Save
      </button>
    </div>
  )
}

export function NumpadGrid() {
  const index = model.fxEdit || 0
  const stack = Array.isArray(model.fxStack) ? model.fxStack : []
  return (
    <div className="numpad" role="listbox" aria-label="Numpad FX">
      {ORDER.map((digit) => {
        const item = model.numpadFx[digit]
        const on = index === digit
        const order = stack.indexOf(digit)
        return (
          <button
            key={digit}
            type="button"
            role="option"
            aria-selected={on}
            className={`num-key ${on ? 'on' : ''} ${order >= 0 ? 'live' : ''} ${digit === 0 ? 'zero' : ''}`}
            data-coach={digit === 1 ? 'numpad' : undefined}
            onPointerDown={(event) => {
              const id = event.pointerId
              const x = event.clientX
              const y = event.clientY
              let moved = false
              holdNumpadFx(digit)
              const move = (ev) => {
                if (ev.pointerId !== id) return
                const dx = ev.clientX - x
                const dy = ev.clientY - y
                if (dx * dx + dy * dy > 64) moved = true
              }
              const up = (ev) => {
                if (ev.pointerId !== id) return
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
                releaseNumpadFx(digit)
                if (!moved && ev.type !== 'pointercancel') {
                  model.fxEdit = digit
                  touch(false)
                }
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
              window.addEventListener('pointercancel', up)
            }}
          >
            <b>{digit}</b>
            <span>{item.type}</span>
            {order >= 0 && <i>{order + 1}</i>}
          </button>
        )
      })}
    </div>
  )
}

function bendButton(label, dir) {
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const id = event.pointerId
    startPorta(dir)
    const up = (ev) => {
      if (ev.pointerId !== id) return
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      stopPorta(dir)
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  return (
    <button
      type="button"
      className="btn"
      aria-label={dir < 0 ? 'Bend held slots down' : 'Bend held slots up'}
      onPointerDown={down}
    >
      {label}
    </button>
  )
}

export function Portamento() {
  const speed = Math.max(1, Math.min(255, model.porta | 0 || 72))
  return (
    <div className="fx-porta">
      {bendButton('−', -1)}
      <label className="fx-porta-speed">
        <span>Porta {speed}</span>
        <input
          type="range"
          min={1}
          max={255}
          value={speed}
          aria-label="Portamento speed"
          onChange={(e) => {
            model.porta = Math.max(1, Math.min(255, Number(e.target.value) || 1))
            touch(true)
          }}
        />
      </label>
      {bendButton('+', 1)}
    </div>
  )
}

function SlotEditor() {
  const index = model.fxEdit || 0
  const slot = model.numpadFx[index]
  const type = slot.type
  return (
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
        {type === 'filter' && (
          <label className="fx-field">
            <span>Step</span>
            <select className="row-select" value={slot.div} onChange={(e) => editSlot(index, { div: Number(e.target.value) })}>
              {REPEAT_NAMES.map((name, i) => (
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
          {type === 'slice' && (
            <Knob label="Move" min={0} max={255} value={slot.c || 0} onChange={(v) => editSlot(index, { c: Math.round(v) })} />
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
          {type === 'grain' && (
            <Knob label="Stretch" min={0} max={255} value={slot.c || 0} onChange={(v) => editSlot(index, { c: Math.round(v) })} />
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
          {type === 'filter' && (
            <Knob label="Wander" min={0} max={255} value={slot.c || 0} onChange={(v) => editSlot(index, { c: Math.round(v) })} />
          )}
        </div>
      </fieldset>
  )
}

export function Fx({ dock = false }) {
  useModel()
  if (dock) {
    return (
      <div className="fx-dock">
        <div className="fx-dock-pack">
          <div className="screen-head">
            <HelpButton title="FX" topic="fx" />
          </div>
          <FxPresets />
          <NumpadGrid />
          <Portamento />
          <SlotEditor />
        </div>
      </div>
    )
  }
  return (
    <div className="screen fx-screen">
      <div className="screen-head">
        <HelpButton title="FX" topic="fx" />
      </div>
      <FxPresets />
      <Portamento />
      <div className="fx-layout">
        <NumpadGrid />
        <SlotEditor />
      </div>
    </div>
  )
}

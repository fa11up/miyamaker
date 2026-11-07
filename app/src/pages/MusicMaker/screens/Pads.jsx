import { BANKS, busLabel, currentPattern, hexByte, model, padKeyLabel, selectPad, touch, TRACK_VEL } from '../model.js'
import { SEQ_KEYS } from '../keys.js'
import { noteOff, noteOn } from '../audio/engine.js'
import { useModel } from '../useModel.js'
import { Slider } from '../widgets.jsx'

export function Pads() {
  useModel()
  const start = model.bank * 16
  const slot = model.pattern % 8
  const bank = Math.floor(model.pattern / 8)
  const pat = currentPattern()
  return (
    <div className="screen">
      <p className="hint">
        {BANKS[model.bank]} pads on 1 2 3 4 / Q W E R / A S D F / Z X C V. Pattern {hexByte(model.pattern)} {pat.name || 'untitled'} · slot {slot + 1} ({SEQ_KEYS[slot].toUpperCase()}) · sequence bank {bank + 1}.
        {model.keyboard && model.keyMap === 'renoise'
          ? ` Keys on the selected pad: Z is C, Q and comma are the C above, I is the next C. A or Caps Lock stops the note. Octave ${model.renoiseOct}.`
          : ''}
      </p>
      <div className="pad-layout">
        <div className="pad-grid">
          {Array.from({ length: 16 }, (_, local) => {
            const index = start + local
            const pad = model.pads[index]
            const cls = [
              'pad',
              pad.source === 'empty' ? 'empty' : '',
              model.selected === index || model.selection.includes(index) ? 'selected' : '',
              pad.mute ? 'muted' : '',
              pad.solo ? 'soloed' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={index}
                type="button"
                className={cls}
                data-pad={index}
                onPointerDown={(e) => hit(index, e)}
                onPointerUp={() => noteOff(`ptr:${index}`)}
                onPointerCancel={() => noteOff(`ptr:${index}`)}
                onLostPointerCapture={() => noteOff(`ptr:${index}`)}
              >
                <span className="key">{padKeyLabel(local)}</span>
                <span className="name">{pad.name}</span>
                <span className="meta">
                  {BANKS[model.bank]}
                  {local + 1} · {pad.choke ? `choke ${pad.choke}` : 'choke off'} · {model.buses[pad.bus]?.name || busLabel(pad.bus)}
                </span>
              </button>
            )
          })}
        </div>
        <PadQuick />
      </div>
    </div>
  )
}

function hit(index, e) {
  e.preventDefault()
  // Keep the pointer on this pad, so the release lands here even if the finger slides off.
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* no capture for this pointer */
  }
  if (e.shiftKey || model.hold === 'edit') selectPad(index, 'edit')
  else if (model.hold === 'solo') selectPad(index, 'solo')
  else if (model.hold === 'mute') selectPad(index, 'mute')
  else {
    selectPad(index)
    noteOn(index, TRACK_VEL, `ptr:${index}`)
  }
}

function PadQuick() {
  const pad = model.pads[model.selected]
  const set = (key, value) => {
    pad[key] = value
    touch(true)
  }
  return (
    <fieldset className="group side-controls">
      <legend>Pad {model.selected + 1}</legend>
      <input
        className="field"
        value={pad.name}
        onChange={(e) => set('name', e.target.value)}
        aria-label="Pad name"
      />
      <Slider label="Volume" min={0} max={1} step={0.01} value={pad.volume} onChange={(v) => set('volume', v)} />
      <Slider label="Pitch" min={-24} max={24} step={1} value={pad.pitch} text={`${pad.pitch} st`} onChange={(v) => set('pitch', v)} />
      <Slider label="Pan" min={-1} max={1} step={0.01} value={pad.pan} onChange={(v) => set('pan', v)} />
      <label className="slider">
        <span>Bus</span>
        <select className="row-select" value={pad.bus} onChange={(e) => set('bus', Number(e.target.value))}>
          {model.buses.map((bus, i) => (
            <option key={i} value={i}>
              {bus.name}
            </option>
          ))}
        </select>
        <em />
      </label>
      <label className="slider">
        <span>Choke</span>
        <select className="row-select" value={pad.choke} onChange={(e) => set('choke', Number(e.target.value))}>
          <option value={0}>Off</option>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Group {i + 1}
            </option>
          ))}
        </select>
        <em />
      </label>
      <label className="slider">
        <span>Play</span>
        <select className="row-select" value={pad.mode} onChange={(e) => set('mode', e.target.value)}>
          <option value="oneshot">One-shot</option>
          <option value="gate">Gate</option>
          <option value="loop">Loop</option>
        </select>
        <em />
      </label>
      <p className="hint">Shift selects several pads. N solos. B mutes. The open hat and closed hat share choke 1.</p>
    </fieldset>
  )
}

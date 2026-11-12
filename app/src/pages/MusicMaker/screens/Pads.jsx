import { BANKS, busLabel, currentPattern, hexByte, model, padKeyLabel, touch } from '../model.js'
import { padGesture } from '../padEdit.js'
import { useModel } from '../useModel.js'
import { PadWave, usePadVis } from '../padVis.js'
import { HelpButton, Slider } from '../widgets.jsx'

export function Pads() {
  useModel()
  usePadVis()
  const start = model.bank * 16
  const pat = currentPattern()
  return (
    <div className="screen pads-screen">
      <div className="screen-head">
        <span className="hint">{BANKS[model.bank]} · {hexByte(model.pattern)} {pat.name || 'untitled'}</span>
        <HelpButton title="Pads" topic="pads" />
      </div>
      <div className="pad-layout">
        <div className="pad-fit">
          <div className="pad-grid">
            {Array.from({ length: 16 }, (_, local) => {
              const index = start + local
              const pad = model.pads[index]
              const cls = [
                'pad',
                pad.source === 'empty' ? 'empty' : 'seen',
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
                  data-coach={local === 0 ? 'pad' : undefined}
                  {...padGesture(index, { play: true })}
                >
                  <PadWave index={index} />
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
        </div>
        <PadQuick />
      </div>
    </div>
  )
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
    </fieldset>
  )
}

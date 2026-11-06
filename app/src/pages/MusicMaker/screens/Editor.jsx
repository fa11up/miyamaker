import { useRef } from 'react'
import { BANKS, audioBank, model, touch } from '../model.js'
import { importFile, audioRecordLabel, recordMic, resample, sliceOnto } from '../audio/engine.js'
import { useModel } from '../useModel.js'
import { Slider } from '../widgets.jsx'
import { Waveform } from './Waveform.jsx'

export function Editor() {
  useModel()
  const pad = model.pads[model.selected]
  const file = useRef(null)
  const set = (patch) => {
    Object.assign(pad, patch)
    touch(true)
  }
  const setFilter = (key, value) => {
    pad.filter = { ...pad.filter, [key]: value }
    touch(true)
  }
  const setAmp = (key, value) => {
    pad.amp = { ...pad.amp, [key]: value }
    touch(true)
  }
  const setFx = (key, value) => {
    pad.fx = { ...pad.fx, [key]: value }
    touch(true)
  }
  const label = audioRecordLabel()
  return (
    <div className="screen">
      <div className="slot-grid" role="listbox" aria-label="Sample slots">
        {model.pads.map((slot, i) => (
          <button
            key={i}
            type="button"
            role="option"
            data-pad={i}
            aria-selected={model.selected === i}
            className={`slot ${model.selected === i ? 'on' : ''} ${slot.source === 'empty' ? 'empty' : ''}`}
            onClick={() => {
              model.selected = i
              model.bank = Math.floor(i / 16)
              model.selection = []
              touch(false)
            }}
          >
            <em>{BANKS[Math.floor(i / 16)]}{(i % 16) + 1}</em>
            <span>{slot.name}</span>
          </button>
        ))}
      </div>
      <div className="edit-top">
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          Import
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importFile(f)
            e.target.value = ''
          }}
        />
        <button type="button" className={`btn ${label === 'mic' ? 'rec on' : ''}`} onClick={() => recordMic()}>
          {label === 'mic' ? 'Stop mic' : 'Rec mic'}
        </button>
        <button type="button" className={`btn ${label === 'resample' ? 'rec on' : ''}`} onClick={() => resample('main')}>
          {label === 'resample' ? 'Stop resample' : 'Resample main'}
        </button>
        {['A', 'B', 'C', 'D'].map((name) => (
          <button
            key={name}
            type="button"
            className={`btn free-width ${label === `bus ${name}` ? 'rec on' : ''}`}
            onClick={() => resample(name)}
          >
            {label === `bus ${name}` ? `Stop ${name}` : `Bus ${name}`}
          </button>
        ))}
        <button
          type="button"
          className={`btn ${pad.reverse ? 'on' : ''}`}
          onClick={() => set({ reverse: !pad.reverse })}
        >
          Reverse
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => sliceOnto(model.selected, 16).catch((error) => {
            model.browserNote = error.message
            touch(false)
          })}
        >
          Slice 16
        </button>
      </div>
      <Waveform
        tall
        pcm={audioBank.get(model.selected)?.pcm}
        sr={audioBank.get(model.selected)?.sr}
        marks={{ start: pad.trimStart, end: pad.trimEnd }}
      />
      <div className="synth-grid">
        <fieldset className="group">
          <legend>Trim</legend>
          <Slider label="Start" min={0} max={0.95} step={0.001} value={pad.trimStart} onChange={(v) => set({ trimStart: Math.min(v, pad.trimEnd - 0.01) })} />
          <Slider label="End" min={0.05} max={1} step={0.001} value={pad.trimEnd} onChange={(v) => set({ trimEnd: Math.max(v, pad.trimStart + 0.01) })} />
          <p className="hint">Recordings auto-trim silence and normalize. Drop a file on the window to import it.</p>
        </fieldset>
        <fieldset className="group">
          <legend>Amp</legend>
          <Slider label="Attack" min={0.001} max={1} step={0.001} value={pad.amp.a} text={ms(pad.amp.a)} onChange={(v) => setAmp('a', v)} />
          <Slider label="Decay" min={0.001} max={2} step={0.001} value={pad.amp.d} text={ms(pad.amp.d)} onChange={(v) => setAmp('d', v)} />
          <Slider label="Sustain" min={0} max={1} step={0.01} value={pad.amp.s} onChange={(v) => setAmp('s', v)} />
          <Slider label="Release" min={0.005} max={2} step={0.001} value={pad.amp.r} text={ms(pad.amp.r)} onChange={(v) => setAmp('r', v)} />
        </fieldset>
        <fieldset className="group">
          <legend>Filter envelope</legend>
          <label className="slider">
            <span>Type</span>
            <select className="row-select" value={pad.filter.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="lowpass">Low pass</option>
              <option value="highpass">High pass</option>
              <option value="bandpass">Band pass</option>
            </select>
            <em />
          </label>
          <Slider label="Cutoff" min={60} max={18000} step={1} value={pad.filter.cutoff} text={`${Math.round(pad.filter.cutoff)} Hz`} onChange={(v) => setFilter('cutoff', v)} />
          <Slider label="Reso" min={0.2} max={16} step={0.1} value={pad.filter.q} onChange={(v) => setFilter('q', v)} />
          <Slider label="Env" min={-36} max={60} step={1} value={pad.filter.env} text={`${pad.filter.env} st`} onChange={(v) => setFilter('env', v)} />
          <Slider label="Attack" min={0.001} max={1} step={0.001} value={pad.filter.a} text={ms(pad.filter.a)} onChange={(v) => setFilter('a', v)} />
          <Slider label="Decay" min={0.001} max={2} step={0.001} value={pad.filter.d} text={ms(pad.filter.d)} onChange={(v) => setFilter('d', v)} />
          <Slider label="Sustain" min={0} max={1} step={0.01} value={pad.filter.s} onChange={(v) => setFilter('s', v)} />
          <Slider label="Release" min={0.005} max={2} step={0.001} value={pad.filter.r} text={ms(pad.filter.r)} onChange={(v) => setFilter('r', v)} />
        </fieldset>
        <fieldset className="group">
          <legend>Pitch</legend>
          <Slider label="Semi" min={-24} max={24} step={1} value={pad.pitch} text={`${pad.pitch > 0 ? '+' : ''}${pad.pitch} st`} onChange={(v) => set({ pitch: v })} />
          <Slider label="Fine" min={-100} max={100} step={1} value={pad.fine} text={`${pad.fine} ct`} onChange={(v) => set({ fine: v })} />
          <p className="hint">Half steps run from −24 to +24. Fine is cents on top of that.</p>
        </fieldset>
        <fieldset className="group">
          <legend>Pad FX</legend>
          <Slider label="Drive" min={0} max={1} step={0.01} value={pad.fx.drive} onChange={(v) => setFx('drive', v)} />
          <Slider label="Crush" min={0} max={1} step={0.01} value={pad.fx.crush} onChange={(v) => setFx('crush', v)} />
        </fieldset>
      </div>
    </div>
  )
}

function ms(seconds) {
  return `${Math.round(seconds * 1000)} ms`
}

import { useRef } from 'react'
import { FACTORY, mutatePatch } from '../audio/presets.js'
import { defaultPatch, renderSynth } from '../audio/synth.js'
import { previewPcm } from '../audio/engine.js'
import { model, renderPad, selectedPad, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { HelpButton, Knob } from '../widgets.jsx'

export function Synth() {
  useModel()
  const pad = selectedPad()
  const patch = ensureDraft(pad)
  const timer = useRef(0)
  const edit = (partial) => {
    Object.assign(patch, partial)
    touch(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (pad.source === 'synth') {
        pad.patch = patch
        renderPad(model.selected)
        touch(true)
      }
    }, 80)
  }
  const editOsc = (index, partial) => {
    const oscs = patch.oscs.map((o, i) => (i === index ? { ...o, ...partial } : o))
    edit({ oscs })
  }
  return (
    <div className="screen synth-screen">
      <div className="synth-top">
        <HelpButton title="Synth">
          Draw a sound for the selected pad. A preset replaces the patch. The knobs are the oscillators, the filter, and the envelope.
        </HelpButton>
        <div className="presets">
          {FACTORY.map((item) => (
            <button
              key={item.name}
              type="button"
              className="btn free-width"
              onClick={() => {
                const next = mutatePatch(item.patch, 0)
                if (pad.source === 'synth') pad.patch = next
                else model.draft = next
                touch(true)
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const rendered = renderSynth(patch)
            previewPcm(rendered.pcm, rendered.sampleRate)
          }}
        >
          Preview
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            pad.source = 'synth'
            pad.patch = { ...patch, oscs: patch.oscs.map((o) => ({ ...o })), partials: patch.partials.slice() }
            pad.name = pad.name === 'Empty' ? 'Synth' : pad.name
            renderPad(model.selected)
            touch(true)
          }}
        >
          Render to pad
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const next = mutatePatch(patch, 0.8)
            if (pad.source === 'synth') {
              pad.patch = next
              renderPad(model.selected)
            } else model.draft = next
            touch(true)
          }}
        >
          Mutate
        </button>
      </div>
      <div className="synth-grid">
        <fieldset className="group">
          <legend>Oscillators</legend>
          {patch.oscs.map((osc, i) => (
            <div className="osc-line" key={i}>
              {i === 0 ? (
                <Knob label="Freq" bits={12} min={30} max={4000} value={patch.freq} text={`${Math.round(patch.freq)} Hz`} onChange={(v) => edit({ freq: v })} />
              ) : (
                <span className="knob-spacer" />
              )}
              <label className="pick">
                <span>Osc {i + 1}</span>
                <select className="row-select" value={osc.type} onChange={(e) => editOsc(i, { type: e.target.value })}>
                  {['sine', 'triangle', 'saw', 'square', 'pulse', 'metal'].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <Knob label="Ratio" min={0.25} max={8} step={0.01} value={osc.ratio} onChange={(v) => editOsc(i, { ratio: v })} />
              <Knob label="Detune" min={-40} max={40} step={1} value={osc.detune} text={`${osc.detune} ct`} onChange={(v) => editOsc(i, { detune: v })} />
              <Knob label="Level" min={0} max={1} step={0.01} value={osc.level} onChange={(v) => editOsc(i, { level: v })} />
            </div>
          ))}
        </fieldset>
        <fieldset className="group">
          <legend>FM and partials</legend>
          <div className="knob-row">
            <Knob label="FM idx" min={0} max={8} step={0.01} value={patch.fmIndex} onChange={(v) => edit({ fmIndex: v })} />
            <Knob label="FM dec" min={0.01} max={1.5} step={0.01} value={patch.fmD} onChange={(v) => edit({ fmD: v })} />
            <Knob label="Stretch" min={0} max={0.8} step={0.01} value={patch.stretch} onChange={(v) => edit({ stretch: v })} />
            {patch.partials.map((level, i) => (
              <Knob key={i} label={`H${i + 1}`} min={0} max={1} step={0.01} value={level} onChange={(v) => {
                const partials = patch.partials.slice()
                partials[i] = v
                edit({ partials })
              }} />
            ))}
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>Motion</legend>
          <div className="knob-row">
            <Knob label="Pitch env" min={-36} max={48} step={1} value={patch.pitchEnv} text={`${patch.pitchEnv} st`} onChange={(v) => edit({ pitchEnv: v })} />
            <Knob label="P decay" min={0.01} max={1} step={0.01} value={patch.pitchDecay} onChange={(v) => edit({ pitchDecay: v })} />
            <Knob label="Fold" min={0} max={1} step={0.01} value={patch.fold} onChange={(v) => edit({ fold: v })} />
            <Knob label="Fold env" min={0} max={1} step={0.01} value={patch.foldEnv} onChange={(v) => edit({ foldEnv: v })} />
            <Knob label="Noise" min={0} max={1} step={0.01} value={patch.noise} onChange={(v) => edit({ noise: v })} />
            <Knob label="Color" min={0} max={0.95} step={0.01} value={patch.noiseColor} onChange={(v) => edit({ noiseColor: v })} />
            <Knob label="Drive" min={0.5} max={3} step={0.01} value={patch.drive} onChange={(v) => edit({ drive: v })} />
            <Knob label="Unison" min={1} max={4} step={1} value={patch.unison} onChange={(v) => edit({ unison: v })} />
            <Knob label="Uni ct" min={0} max={40} step={1} value={patch.unisonDetune} onChange={(v) => edit({ unisonDetune: v })} />
            <Knob label="Vib" min={0} max={1} step={0.01} value={patch.vibDepth} onChange={(v) => edit({ vibDepth: v, vibRate: patch.vibRate || 5 })} />
            <Knob label="LFO Hz" min={0} max={12} step={0.01} value={patch.lfoRate} onChange={(v) => edit({ lfoRate: v })} />
            <Knob label="LFO cut" min={0} max={24} step={0.1} value={patch.lfoToFilter} onChange={(v) => edit({ lfoToFilter: v })} />
            <Knob label="Repeat" min={0} max={30} step={0.1} value={patch.repeat} onChange={(v) => edit({ repeat: v })} />
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>Filters and amp</legend>
          <div className="osc-line">
            <label className="pick">
              <span>Filter</span>
              <select className="row-select" value={patch.filterType} onChange={(e) => edit({ filterType: e.target.value })}>
                <option value="lowpass">Low pass</option>
                <option value="highpass">High pass</option>
                <option value="bandpass">Band pass</option>
              </select>
            </label>
            <label className="pick">
              <span>Filter 2</span>
              <select className="row-select" value={patch.filter2Type} onChange={(e) => edit({ filter2Type: e.target.value })}>
                <option value="off">Off</option>
                <option value="lowpass">Low pass</option>
                <option value="highpass">High pass</option>
                <option value="bandpass">Band pass</option>
              </select>
            </label>
          </div>
          <div className="knob-row">
            <Knob label="Cutoff" bits={12} min={60} max={14000} value={patch.cutoff} text={`${Math.round(patch.cutoff)} Hz`} onChange={(v) => edit({ cutoff: v })} />
            <Knob label="Q" min={0.2} max={12} step={0.1} value={patch.q} onChange={(v) => edit({ q: v })} />
            <Knob label="F env" min={-12} max={60} step={1} value={patch.filterEnv} text={`${patch.filterEnv} st`} onChange={(v) => edit({ filterEnv: v })} />
            <Knob label="F dec" min={0.01} max={1.5} step={0.01} value={patch.fD} onChange={(v) => edit({ fD: v })} />
            <Knob label="Cut 2" bits={12} min={80} max={12000} value={patch.cutoff2} text={`${Math.round(patch.cutoff2)} Hz`} onChange={(v) => edit({ cutoff2: v })} />
            <Knob label="Q 2" min={0.3} max={12} step={0.1} value={patch.q2} onChange={(v) => edit({ q2: v })} />
            <Knob label="Attack" min={0.001} max={0.5} step={0.001} value={patch.aA} onChange={(v) => edit({ aA: v })} />
            <Knob label="Decay" min={0.01} max={1.5} step={0.01} value={patch.aD} onChange={(v) => edit({ aD: v })} />
            <Knob label="Sustain" min={0} max={1} step={0.01} value={patch.aS} onChange={(v) => edit({ aS: v })} />
            <Knob label="Release" min={0.01} max={1.5} step={0.01} value={patch.aR} onChange={(v) => edit({ aR: v })} />
            <Knob label="Hold" min={0} max={1.5} step={0.01} value={patch.hold} onChange={(v) => edit({ hold: v })} />
          </div>
        </fieldset>
      </div>
    </div>
  )
}

function ensureDraft(pad) {
  if (pad.source === 'synth' && pad.patch) return pad.patch
  if (!model.draft) model.draft = defaultPatch()
  return model.draft
}

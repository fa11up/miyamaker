import { useEffect, useRef, useState } from 'react'
import { BANKS, applyTrim, applyTrimSpan, audioBank, defaultEnvelopes, ENV_KINDS, envKind, model, touch } from '../model.js'
import { chopSelection, importFile, audioRecordLabel, audioStartingLabel, recordMic, resample, sliceOnto, voicePositions } from '../audio/engine.js'
import { padGesture } from '../padEdit.js'
import { loadSliceSource, moveSliceMarker, sliceMarkers } from '../audio/song.js'
import { useModel } from '../useModel.js'
import { HelpButton, Knob } from '../widgets.jsx'
import { Waveform } from './Waveform.jsx'

export function Editor() {
  useModel()
  const pad = model.pads[model.selected]
  const file = useRef(null)
  const [resampleBus, setResampleBus] = useState(0)
  const slice = (model.library?.sliceSets || []).find((set) => set.id === model.sliceView) || null
  const [origin, setOrigin] = useState(null)
  useEffect(() => {
    let live = true
    if (!slice) {
      setOrigin(null)
      return undefined
    }
    loadSliceSource(slice.id).then((rec) => {
      if (live) setOrigin(rec || null)
    })
    return () => {
      live = false
    }
  }, [slice?.id])
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
  const envelopes = pad.envelopes?.length === 3 ? pad.envelopes : defaultEnvelopes(pad.filter)
  const setEnv = (index, key, value) => {
    const list = envelopes.map((env) => ({ ...env }))
    const env = list[index]
    env[key] = value
    if (key === 'target') {
      const other = list.find((item, i) => i !== index && item.target === value && item.kind)
      if (value === 'off') env.kind = ''
      else if (other) env.kind = other.kind
      else if (value === 'filter') env.kind = envKind('filter', '', pad.filter.type)
      else env.kind = (ENV_KINDS[value] || [])[0]?.[0] || ''
      env.depth = value === 'filter'
        ? Math.max(-36, Math.min(60, env.depth))
        : Math.max(0, Math.min(1, env.depth))
    }
    if (key === 'kind' && env.target !== 'off') {
      for (const item of list) {
        if (item.target === env.target) item.kind = value
      }
    }
    pad.envelopes = list
    const filterEnv = list.find((item) => item.target === 'filter')
    if (filterEnv) {
      pad.filter = {
        ...pad.filter,
        a: filterEnv.a,
        d: filterEnv.d,
        s: filterEnv.s,
        r: filterEnv.r,
        env: filterEnv.depth,
        ...(filterEnv.kind ? { type: filterEnv.kind } : {}),
      }
    }
    touch(true)
  }
  const label = audioRecordLabel() || audioStartingLabel()
  return (
    <div className="screen edit-screen">
      <div className="screen-head">
        <HelpButton title="Sample" topic="sample" />
      </div>
      <PadPick pad={pad} />
      <div className="slot-grid" role="listbox" aria-label="Sample slots">
        {model.pads.map((slot, i) => (
          <button
            key={i}
            type="button"
            role="option"
            data-pad={i}
            aria-selected={model.selected === i}
            className={`slot ${model.selected === i ? 'on' : ''} ${slot.source === 'empty' ? 'empty' : ''}`}
            title={`${slot.name}. Drag a sample here. Right-click or hold to copy and paste.`}
            {...padGesture(i, { play: false })}
            onClick={() => {
              model.selected = i
              model.bank = Math.floor(i / 16)
              model.selection = []
              model.sliceView = null
              touch(false)
            }}
          >
            <em>{BANKS[Math.floor(i / 16)]}{(i % 16) + 1}</em>
            <span style={slotText(slot.name)}>{slot.name}</span>
          </button>
        ))}
      </div>
      <div className="edit-top">
        <label className="pad-play">
          <span>Play</span>
          <select aria-label="Play" value={pad.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="oneshot">One-shot</option>
            <option value="gate">Gate</option>
            <option value="loop">Loop</option>
          </select>
        </label>
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
            if (f) {
              importFile(f).catch((error) => {
                model.browserNote = error?.message || 'Could not open that file'
                touch(false)
              })
            }
            e.target.value = ''
          }}
        />
        <button type="button" className={`btn ${label === 'mic' ? 'rec on' : ''}`} onClick={() => recordMic()}>
          {label === 'mic' ? 'Stop mic' : 'Rec mic'}
        </button>
        <button type="button" className={`btn ${label === 'resample' ? 'rec on' : ''}`} onClick={() => resample('main')}>
          {label === 'resample' ? 'Stop resample' : 'Resample main'}
        </button>
        <select
          className="bus-pick"
          aria-label="Resample bus"
          value={resampleBus}
          onChange={(e) => setResampleBus(Number(e.target.value))}
        >
          {model.buses.map((bus, i) => (
            <option key={i} value={i}>
              {bus.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn free-width ${label === `bus ${resampleBus}` ? 'rec on' : ''}`}
          onClick={() => resample(resampleBus)}
        >
          {label === `bus ${resampleBus}` ? 'Stop bus' : 'Resample bus'}
        </button>
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
        {!slice && (
          <button
            type="button"
            className="btn"
            onClick={() => chopSelection(model.selected).catch((error) => {
              model.browserNote = error.message
              touch(false)
            })}
          >
            Chop
          </button>
        )}
        {slice && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              model.sliceView = null
              touch(false)
            }}
          >
            Trim
          </button>
        )}
      </div>
      {slice ? (
        <Waveform
          tall
          pcm={origin?.pcm}
          sr={origin?.sr || slice.sr}
          marks={sliceMarkers(slice)}
          playAt={() => slice.cuts.flatMap((cut) => {
            const span = (cut.b ?? 1) - cut.a
            return voicePositions(cut.pad).map((fraction) => cut.a + fraction * span)
          })}
          onMark={(index, value, done) => {
            moveSliceMarker(slice.id, index, value, done).catch((error) => {
              model.browserNote = error.message
              touch(false)
            })
          }}
        />
      ) : (
        <Waveform
          tall
          pcm={audioBank.get(model.selected)?.pcm}
          sr={audioBank.get(model.selected)?.sr}
          playAt={() => voicePositions(model.selected)}
          trim={{ start: pad.trimStart, end: pad.trimEnd, loop: pad.loopPoint ?? 0.5 }}
          onTrim={(which, value, done) => {
            if (which === 'span') applyTrimSpan(pad, value.start, value.end)
            else applyTrim(pad, which, value)
            touch(!!done)
          }}
        />
      )}
      {slice && <p className="hint">{slice.name}</p>}
      <div className="synth-grid">
        <div className="edit-col">
          <fieldset className="group">
            <legend>Amp</legend>
            <div className="knob-row">
              <Knob label="Attack" min={0.001} max={1} value={pad.amp.a} text={ms(pad.amp.a)} onChange={(v) => setAmp('a', v)} />
              <Knob label="Decay" min={0.001} max={2} value={pad.amp.d} text={ms(pad.amp.d)} onChange={(v) => setAmp('d', v)} />
              <Knob label="Sustain" min={0} max={1} value={pad.amp.s} onChange={(v) => setAmp('s', v)} />
              <Knob label="Release" min={0.005} max={2} value={pad.amp.r} text={ms(pad.amp.r)} onChange={(v) => setAmp('r', v)} />
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>Pitch</legend>
            <div className="knob-row">
              <Knob label="Semi" min={-24} max={24} value={pad.pitch} text={`${pad.pitch > 0 ? '+' : ''}${Math.round(pad.pitch)} st`} onChange={(v) => set({ pitch: Math.round(v) })} />
              <Knob label="Fine" min={-100} max={100} value={pad.fine} text={`${Math.round(pad.fine)} ct`} onChange={(v) => set({ fine: Math.round(v) })} />
            </div>
          </fieldset>
        </div>
        <fieldset className="group">
          <legend>Filter</legend>
          <div className="knob-row">
            <Knob label="Cutoff" bits={12} min={60} max={18000} value={pad.filter.cutoff} text={`${Math.round(pad.filter.cutoff)} Hz`} onChange={(v) => setFilter('cutoff', Math.round(v))} />
            <Knob label="Reso" min={0.2} max={16} value={pad.filter.q} onChange={(v) => setFilter('q', v)} />
          </div>
          {envelopes.map((env, index) => {
            const typeOptions = ENV_KINDS[env.target] || []
            const typeValue = env.target === 'off'
              ? ''
              : (typeOptions.some(([id]) => id === env.kind) ? env.kind : (typeOptions[0]?.[0] || ''))
            return (
            <div className="env-line" key={index}>
              <label className="env-target">
                <span>Env {index + 1}</span>
                <select aria-label={`Envelope ${index + 1} target`} value={env.target} onChange={(e) => setEnv(index, 'target', e.target.value)}>
                  <option value="off">Off</option>
                  <option value="filter">Filter</option>
                  <option value="reverb">Reverb</option>
                  <option value="width">Width</option>
                  <option value="chorus">Chorus</option>
                  <option value="amp">Amp</option>
                </select>
              </label>
              <label className={`env-kind ${env.target === 'off' ? 'is-off' : ''}`}>
                <span>Type</span>
                <select
                  aria-label={`Envelope ${index + 1} type`}
                  value={typeValue}
                  disabled={env.target === 'off'}
                  onChange={(e) => setEnv(index, 'kind', e.target.value)}
                >
                  {env.target === 'off'
                    ? <option value="">None</option>
                    : typeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <Knob label="Attack" min={0.001} max={1} value={env.a} text={ms(env.a)} onChange={(v) => setEnv(index, 'a', v)} />
              <Knob label="Decay" min={0.001} max={2} value={env.d} text={ms(env.d)} onChange={(v) => setEnv(index, 'd', v)} />
              <Knob label="Sustain" min={0} max={1} value={env.s} onChange={(v) => setEnv(index, 's', v)} />
              <Knob label="Release" min={0.005} max={2} value={env.r} text={ms(env.r)} onChange={(v) => setEnv(index, 'r', v)} />
              <Knob
                label="Depth"
                min={env.target === 'filter' ? -36 : 0}
                max={env.target === 'filter' ? 60 : 1}
                value={env.depth}
                text={env.target === 'filter' ? `${Math.round(env.depth)} st` : undefined}
                onChange={(v) => setEnv(index, 'depth', env.target === 'filter' ? Math.round(v) : v)}
              />
            </div>
            )
          })}
        </fieldset>
        <fieldset className="group">
          <legend>Pad FX</legend>
          <div className="knob-row">
            <Knob label="Drive" min={0} max={1} value={pad.fx.drive} onChange={(v) => setFx('drive', v)} />
            <Knob label="Crush" min={0} max={1} value={pad.fx.crush} onChange={(v) => setFx('crush', v)} />
            <Knob label="Amp" min={0} max={1} value={pad.fx.amp || 0} onChange={(v) => setFx('amp', v)} />
            <Knob label="Tone" min={0} max={1} value={pad.fx.tone ?? 0.65} text={`${Math.round(500 + (pad.fx.tone ?? 0.65) * 11000)} Hz`} onChange={(v) => setFx('tone', v)} />
            <Knob label="Reverb" min={0} max={1} value={pad.fx.reverb || 0} onChange={(v) => setFx('reverb', v)} />
            <Knob label="Width" min={0} max={1} value={pad.fx.width || 0} onChange={(v) => setFx('width', v)} />
            <Knob label="Chorus" min={0} max={1} value={pad.fx.chorus || 0} onChange={(v) => setFx('chorus', v)} />
          </div>
        </fieldset>
      </div>
    </div>
  )
}

function ms(seconds) {
  return `${Math.round(seconds * 1000)} ms`
}

function PadPick({ pad }) {
  const bankRoot = useRef(null)
  const padRoot = useRef(null)
  const [bankOpen, setBankOpen] = useState(false)
  const [padOpen, setPadOpen] = useState(false)
  useEffect(() => {
    if (!bankOpen && !padOpen) return undefined
    const down = (event) => {
      const path = event.composedPath?.() || []
      if (bankRoot.current && (bankRoot.current.contains(event.target) || path.includes(bankRoot.current))) return
      if (padRoot.current && (padRoot.current.contains(event.target) || path.includes(padRoot.current))) return
      setBankOpen(false)
      setPadOpen(false)
    }
    // Capture phase, ahead of the app's own keys: Escape here only closes the menu and never reaches Rec.
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setBankOpen(false)
      setPadOpen(false)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [bankOpen, padOpen])
  const bank = model.bank | 0
  const local = model.selected % 16
  const choose = (index) => {
    model.selected = index
    model.bank = Math.floor(index / 16)
    model.selection = []
    model.sliceView = null
    setPadOpen(false)
    setBankOpen(false)
    touch(false)
  }
  return (
    <div className="pad-pick">
      <div className="mmm-file" ref={padRoot}>
        <button type="button" className="btn" aria-expanded={padOpen} aria-haspopup="menu" onClick={() => { setPadOpen((v) => !v); setBankOpen(false) }}>
          {`Pad: ${BANKS[bank]}${local + 1}`}
        </button>
        {padOpen && (
          <div className="file-menu" role="menu">
            {Array.from({ length: 16 }, (_, i) => {
              const index = bank * 16 + i
              const slot = model.pads[index]
              return (
                <button key={index} type="button" onClick={() => choose(index)}>
                  {`${BANKS[bank]}${i + 1} ${slot.name}`}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="mmm-file" ref={bankRoot}>
        <button type="button" className="btn" aria-expanded={bankOpen} aria-label="Sample bank" aria-haspopup="menu" onClick={() => { setBankOpen((v) => !v); setPadOpen(false) }}>
          {BANKS[bank]}
        </button>
        {bankOpen && (
          <div className="file-menu" role="menu">
            {BANKS.map((name, i) => (
              <button key={name} type="button" onClick={() => choose(i * 16 + local)}>{name}</button>
            ))}
          </div>
        )}
      </div>
      <span className="pad-pick-name">{pad.name}</span>
    </div>
  )
}

function slotText(name) {
  const n = Array.from(name || '').length
  if (n > 18) return { fontSize: '8px', WebkitLineClamp: 3 }
  if (n > 11) return { fontSize: '9px', WebkitLineClamp: 3 }
  if (n > 7) return { fontSize: '10px', WebkitLineClamp: 2 }
  return { fontSize: '11px', WebkitLineClamp: 1 }
}

import { useEffect, useRef, useState } from 'react'
import plate from '../assets/q8n3k/r0.png'
import cel from '../assets/q8n3k/c0.png'
import d0 from '../assets/q8n3k/d0.png'
import d1 from '../assets/q8n3k/d1.png'
import d2 from '../assets/q8n3k/d2.png'
import d3 from '../assets/q8n3k/d3.png'
import { snapOctave } from '../audio/knee.js'
import { FX_TYPES, model, touch } from '../model.js'
import { getCompReduction, getMeters, syncMasterComp, syncMixer } from '../audio/engine.js'
import { useModel } from '../useModel.js'
import { HelpButton, Knob } from '../widgets.jsx'

const KNOBS = [
  { key: 'kKnee', label: 'Knee Compression', x: 64.42, y: 23.45, art: d0 },
  { key: 'kPolice', label: 'police brutality', x: 80.38, y: 23.45, art: d1, lfo: true },
  { key: 'kFold', label: 'Racist Distortion', x: 72.15, y: 66.49, art: d2, lfo: true },
  { key: 'kPitch', label: 'Pitch Shifter', x: 89.0, y: 66.49, pitch: true, art: d3 },
]
const FRAMES = 64

function frameIndex(value, pitch) {
  const t = pitch ? (value + 2) / 4 : value
  return Math.max(0, Math.min(FRAMES - 1, Math.round(t * (FRAMES - 1))))
}

function atlasPos(index) {
  const col = index % 8
  const row = Math.floor(index / 8)
  return `${(col * 100) / 7}% ${(row * 100) / 7}%`
}

export function Mixer() {
  useModel()
  const page = model.mixPage === 1 ? 1 : 0
  const visible = model.buses.slice(page * 8, page * 8 + 8)
  return (
    <div className="screen mix-screen">
      <div className="mix-pages">
        <button type="button" className={`btn free-width ${page === 0 ? 'on' : ''}`} onClick={() => setPage(0)}>
          1–8
        </button>
        <button type="button" className={`btn free-width ${page === 1 ? 'on' : ''}`} onClick={() => setPage(1)}>
          9–16
        </button>
        <HelpButton title="Mixer">
          Sixteen buses, eight on a page, five effect slots each. Empty slots stay unwired, and notes on a bus share one reverb tank. The brickwall limiter still sits after the master compressor and will not pass 0 dBFS. Attack 1 ms, release 1.2 s.
        </HelpButton>
      </div>
      <div className="mix">
        {visible.map((bus, local) => (
          <Channel key={page * 8 + local} bus={bus} index={page * 8 + local} />
        ))}
      </div>
      <Compressor />
    </div>
  )
}

function compHead(alt) {
  if (!alt) return 'Master compressor'
  return String.fromCharCode(74, 117, 115, 116, 105, 99, 101, 32, 102, 111, 114, 32, 71, 101, 111, 114, 103, 101, 32, 70, 108, 111, 121, 100, 32, 75, 110, 101, 101, 32, 67, 111, 109, 112, 114, 101, 115, 115, 111, 114)
}

function setPage(page) {
  model.mixPage = page
  touch(true)
}

function Channel({ bus, index }) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setLevel(getMeters().bus[index] || 0), 80)
    return () => window.clearInterval(id)
  }, [index])
  const commit = () => {
    touch(true)
    syncMixer()
  }
  return (
    <div className="channel">
      <input
        className="field name"
        value={bus.name}
        aria-label={`Bus ${index + 1} name`}
        onChange={(e) => {
          bus.name = e.target.value
          commit()
        }}
      />
      <div className="fader-row">
        <Meter level={level} tall={72} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={bus.volume}
          aria-label={`${bus.name} volume`}
          onChange={(e) => {
            bus.volume = Number(e.target.value)
            commit()
          }}
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 72, width: 18 }}
        />
      </div>
      <div className="ms">
        <button
          type="button"
          className={`btn free-width ${bus.mute ? 'on' : ''}`}
          onClick={() => {
            bus.mute = !bus.mute
            commit()
          }}
        >
          M
        </button>
        <button
          type="button"
          className={`btn free-width ${bus.solo ? 'on' : ''}`}
          onClick={() => {
            bus.solo = !bus.solo
            commit()
          }}
        >
          S
        </button>
      </div>
      {bus.fx.map((slot, s) => (
        <div className="fx-slot" key={s}>
          <select
            value={slot.type}
            aria-label={`${bus.name} effect ${s + 1}`}
            onChange={(e) => {
              slot.type = e.target.value
              commit()
            }}
          >
            {FX_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={slot.amount}
            aria-label={`${bus.name} effect ${s + 1} amount`}
            disabled={slot.type === 'none'}
            onChange={(e) => {
              slot.amount = Number(e.target.value)
              commit()
            }}
          />
        </div>
      ))}
    </div>
  )
}

function Compressor() {
  const headRef = useRef(null)
  const skipClick = useRef(false)
  const [level, setLevel] = useState(0)
  const [gr, setGr] = useState(0)
  const [compGr, setCompGr] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const m = getMeters()
      setLevel(m.master || 0)
      setGr(m.gr || 0)
      setCompGr(getCompReduction())
    }, 80)
    return () => window.clearInterval(id)
  }, [])
  const comp = model.comp
  const set = (key, value) => {
    comp[key] = value
    touch(true)
    syncMasterComp()
  }
  function hideAlt() {
    if (!comp.justice) return
    comp.justice = false
    touch(true)
    syncMasterComp()
  }
  function onHeadPointerDown(event) {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    let moved = 0
    const lastTap = headRef.current?.dataset.tap ? Number(headRef.current.dataset.tap) : 0
    const move = (ev) => {
      moved = Math.max(moved, Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved > 8) return
      const now = performance.now()
      const repeat = now - lastTap < 320
      if (headRef.current) headRef.current.dataset.tap = repeat ? '0' : String(now)
      if (!repeat || !comp.justice) return
      skipClick.current = true
      model.compFocus = !model.compFocus
      touch(false)
      hideAlt()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <section className={`comp-panel ${model.compFocus ? 'armed' : ''} ${comp.justice ? 'has-plate' : ''}`}>
      <div className="comp-head-row">
        <button
          ref={headRef}
          type="button"
          className="comp-head"
          aria-pressed={model.compFocus}
          onPointerDown={onHeadPointerDown}
          onClick={() => {
            if (skipClick.current) {
              skipClick.current = false
              return
            }
            model.compFocus = !model.compFocus
            touch(false)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            hideAlt()
          }}
        >
          {compHead(comp.justice)}
        </button>
        <Meter level={level} tall={52} />
        <Knob
          label="Main"
          min={0}
          max={1}
          value={model.master}
          text={model.master.toFixed(2)}
          onChange={(v) => {
            model.master = v
            touch(true)
            syncMixer()
          }}
        />
        <span className="hint">Comp {compGr < -0.1 ? `${compGr.toFixed(1)} dB` : '0.0 dB'}</span>
        <span className="hint">Limit {gr < -0.1 ? `${gr.toFixed(1)} dB` : '0.0 dB'}</span>
      </div>
      {comp.justice ? (
        <div className="plate-slot">
          <Faceplate />
        </div>
      ) : (
        <div className="knob-row comp-knobs">
          <Knob label="Thresh" min={-60} max={0} value={comp.threshold} text={`${comp.threshold.toFixed(1)} dB`} onChange={(v) => set('threshold', v)} />
          <Knob label="Ratio" min={1} max={20} value={comp.ratio} text={`${comp.ratio.toFixed(1)}:1`} onChange={(v) => set('ratio', v)} />
          <Knob label="Knee" min={0} max={40} value={comp.knee} text={`${comp.knee.toFixed(1)} dB`} onChange={(v) => set('knee', v)} />
          <Knob label="Attack" min={0.001} max={0.2} value={comp.attack} text={`${Math.round(comp.attack * 1000)} ms`} onChange={(v) => set('attack', v)} />
          <Knob label="Release" min={0.01} max={1.2} value={comp.release} text={`${Math.round(comp.release * 1000)} ms`} onChange={(v) => set('release', v)} />
          <Knob label="Makeup" min={0.25} max={4} value={comp.makeup} text={comp.makeup.toFixed(2)} onChange={(v) => set('makeup', v)} />
        </div>
      )}
    </section>
  )
}

function Faceplate() {
  const frame = frameIndex(model.comp.kKnee, false)
  return (
    <div className="faceplate">
      <img src={plate} alt="" />
      <div className="cel-fig" style={{ backgroundImage: `url(${cel})`, backgroundPosition: atlasPos(frame) }} />
      {KNOBS.map((knob) => (
        <FaceKnob key={knob.key} knob={knob} />
      ))}
    </div>
  )
}

function FaceKnob({ knob }) {
  const ref = useRef(null)
  const [menu, setMenu] = useState(false)
  const comp = model.comp
  const value = comp[knob.key]
  const lfo = knob.lfo ? comp.lfo[knob.key] : null
  useEffect(() => {
    if (!menu) return
    const close = (event) => {
      if (event.button !== 0) return
      const path = event.composedPath?.() || []
      if (path.some((node) => node.classList?.contains?.('snap-pop') || node.classList?.contains?.('lfo-box'))) return
      setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  function commit(next, done) {
    comp[knob.key] = next
    touch(!!done)
    syncMasterComp()
  }

  function openLfo() {
    setMenu((open) => (open ? false : lfo.on ? 'edit' : 'ask'))
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    if (event.target.closest?.('.lfo-box')) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const origin = value
    const travel = event.shiftKey ? 640 : 160
    let moved = 0
    const lastTap = ref.current?.dataset.tap ? Number(ref.current.dataset.tap) : 0
    const move = (ev) => {
      moved = Math.max(moved, Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY))
      const delta = (ev.clientX - startX + (startY - ev.clientY)) / travel
      if (knob.pitch) {
        const raw = Math.max(-2, Math.min(2, origin + delta * 4))
        const nearest = snapOctave(raw, true)
        const heard = comp.kSnap && Math.abs(raw - nearest) < 0.12 ? nearest : raw
        commit(comp.kSnap ? heard : raw, false)
      } else {
        commit(Math.max(0, Math.min(1, origin + delta)), false)
      }
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (knob.pitch && comp.kSnap) commit(snapOctave(comp.kPitch, true), true)
      else touch(true)
      const canMenu = knob.pitch || knob.lfo
      if (!canMenu || moved > 8) return
      const now = performance.now()
      if (now - lastTap < 320) {
        if (knob.pitch) setMenu((open) => !open)
        else openLfo()
        if (ref.current) ref.current.dataset.tap = '0'
      } else if (ref.current) ref.current.dataset.tap = String(now)
      ev.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function setLfo(field, next) {
    lfo[field] = next
    touch(true)
    syncMasterComp()
  }

  return (
    <div
      ref={ref}
      className={`face-knob ${knob.pitch ? 'pitch' : ''}`}
      style={{
        left: `${knob.x}%`,
        top: `${knob.y}%`,
        backgroundImage: `url(${knob.art})`,
        backgroundPosition: atlasPos(frameIndex(value, knob.pitch)),
      }}
      role="slider"
      aria-label={knob.label}
      aria-valuemin={knob.pitch ? -2 : 0}
      aria-valuemax={knob.pitch ? 2 : 1}
      aria-valuenow={knob.pitch ? Number(value.toFixed(2)) : Number(value.toFixed(3))}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        if (!knob.pitch && !knob.lfo) return
        event.preventDefault()
        if (knob.pitch) setMenu((open) => !open)
        else openLfo()
      }}
    >
      {menu && knob.pitch && (
        <button
          type="button"
          className="btn snap-pop"
          onClick={(event) => {
            event.stopPropagation()
            comp.kSnap = !comp.kSnap
            if (comp.kSnap) comp.kPitch = snapOctave(comp.kPitch, true)
            touch(true)
            syncMasterComp()
            setMenu(false)
          }}
        >
          {comp.kSnap ? 'disable snapping' : 'enable snapping'}
        </button>
      )}
      {menu && lfo && (
        <div
          className={`lfo-box ${knob.y < 40 ? 'below' : ''} ${menu === 'edit' && !lfo.on ? 'is-off' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu === 'ask' ? (
            <button
              type="button"
              className="btn free-width"
              onClick={(event) => {
                event.stopPropagation()
                setLfo('on', true)
                setMenu('edit')
              }}
            >
              add LFO
            </button>
          ) : (
            <>
              <div className="knob-row">
                <Knob
                  label="frequency"
                  min={0.05}
                  max={12}
                  value={lfo.rate}
                  text={`${lfo.rate.toFixed(2)} Hz`}
                  onChange={(next) => setLfo('rate', next)}
                />
                <Knob
                  label="amplitude"
                  min={0}
                  max={1}
                  value={lfo.depth}
                  text={`${Math.round(lfo.depth * 100)}%`}
                  onChange={(next) => setLfo('depth', next)}
                />
              </div>
              <button
                type="button"
                className="btn free-width"
                onClick={(event) => {
                  event.stopPropagation()
                  setLfo('on', !lfo.on)
                }}
              >
                {lfo.on ? 'turn OFF LFO' : 'add LFO'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Meter({ level, tall = 120 }) {
  const h = Math.round(Math.min(1, level) * tall)
  return (
    <div className="meter" style={{ height: tall }} aria-hidden="true">
      <span style={{ height: h }} />
    </div>
  )
}

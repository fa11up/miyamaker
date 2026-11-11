import { useEffect, useRef, useState } from 'react'
import plate from '../assets/q8n3k/r0.png'
import cel from '../assets/q8n3k/c0.png'
import d0 from '../assets/q8n3k/d0.png'
import d1 from '../assets/q8n3k/d1.png'
import d2 from '../assets/q8n3k/d2.png'
import d3 from '../assets/q8n3k/d3.png'
import { snapOctave } from '../audio/knee.js'
import { FX_TYPES, busLabel, model, touch } from '../model.js'
import { getCompReduction, getMeters, syncMasterComp, syncMixer } from '../audio/engine.js'
import { GraphicEq } from './GraphicEq.jsx'
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

const mixUi = { bus: 0, eq: 0 }

function selectBus(index) {
  if (mixUi.bus === index && mixUi.eq === index) return
  mixUi.bus = index
  mixUi.eq = index
  touch(false)
}

function selectEq(value) {
  if (value === 'out') {
    mixUi.eq = -1
    touch(false)
    return
  }
  const index = value | 0
  mixUi.eq = index
  mixUi.bus = index
  const page = index >= 8 ? 1 : 0
  if ((model.mixPage === 1 ? 1 : 0) !== page) model.mixPage = page
  touch(false)
}

export function Mixer() {
  useModel()
  const page = model.mixPage === 1 ? 1 : 0
  const pageStart = page * 8
  const picked = mixUi.bus | 0
  const selected = picked >= pageStart && picked < pageStart + 8 ? picked : pageStart
  const visible = model.buses.slice(pageStart, pageStart + 8)
  return (
    <div className="screen mix-screen">
      <div className="mix-pages">
        <button type="button" className={`btn free-width ${page === 0 ? 'on' : ''}`} data-coach="mix-page" onClick={() => setPage(0)}>
          1–8
        </button>
        <button type="button" className={`btn free-width ${page === 1 ? 'on' : ''}`} onClick={() => setPage(1)}>
          9–16
        </button>
        <HelpButton title="Mixer" topic="mixer" />
      </div>
      <div className="mix">
        {visible.map((bus, local) => (
          <Channel key={pageStart + local} bus={bus} index={pageStart + local} on={pageStart + local === selected} />
        ))}
      </div>
      <div className={`mix-rack ${model.comp.justice ? 'has-plate' : ''}`}>
        <Inserts bus={model.buses[selected]} index={selected} />
        <GraphicEq target={mixUi.eq < 0 ? -1 : (mixUi.eq | 0)} onTarget={selectEq} />
        <Compressor />
      </div>
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

function Channel({ bus, index, on }) {
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
    <div className={`strip ${on ? 'on' : ''}`} data-bus={index} aria-current={on ? 'true' : undefined} onPointerDown={() => selectBus(index)}>
      <b className="idx">{busLabel(index)}</b>
      <Knob
        label={`${bus.name} pan`}
        value={bus.pan || 0}
        min={-1}
        max={1}
        onChange={(v) => {
          bus.pan = v
          commit()
        }}
      />
      <div className="fader-row">
        <Meter level={level} />
        <input
          type="range"
          className="strip-fader"
          min={0}
          max={1}
          step={0.01}
          value={bus.volume}
          aria-label={`${bus.name} volume`}
          onChange={(e) => {
            bus.volume = Number(e.target.value)
            commit()
          }}
        />
      </div>
      <div className="ms">
        <button
          type="button"
          className={`btn free-width ${bus.mute ? 'on' : ''}`}
          aria-label={`${bus.name} mute`}
          aria-pressed={!!bus.mute}
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
          aria-label={`${bus.name} solo`}
          aria-pressed={!!bus.solo}
          onClick={() => {
            bus.solo = !bus.solo
            commit()
          }}
        >
          S
        </button>
      </div>
      <div className="pips" aria-hidden="true">
        {bus.fx.map((slot, s) => (
          <i key={s} className={slot.type !== 'none' ? 'hot' : ''} />
        ))}
      </div>
      <input
        className="field name"
        value={bus.name}
        aria-label={`Bus ${index + 1} name`}
        onChange={(e) => {
          bus.name = e.target.value
          commit()
        }}
      />
    </div>
  )
}

function Inserts({ bus, index }) {
  const commit = () => {
    touch(true)
    syncMixer()
  }
  return (
    <div className="mix-inserts" data-coach="mix-fx">
      <div className="mix-insert-title">{bus.name === busLabel(index) ? bus.name : `${busLabel(index)} · ${bus.name}`}</div>
      <div className="mix-slots">
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
    </div>
  )
}

function CompScope({ comp }) {
  const canvasRef = useRef(null)
  const curveRef = useRef(null)
  const history = useRef(Array(96).fill(0))
  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const curve = curveRef.current
      if (!canvas) return
      const gr = Math.max(-24, Math.min(0, getCompReduction() || 0))
      const input = getMeters().compIn || 0
      const inputDb = input > 0.00001 ? Math.max(-60, 20 * Math.log10(input)) : -60
      const hist = history.current
      hist.push(gr)
      if (hist.length > 96) hist.shift()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width < 2 || height < 2) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
      }
      const g = canvas.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const k3 = !!canvas.closest('.mmm')?.classList.contains('theme-k3')
      g.clearRect(0, 0, width, height)
      g.fillStyle = k3 ? '#000000' : '#24143f'
      g.fillRect(0, 0, width, height)
      const yOf = (db) => 6 + ((0 - db) / 24) * (height - 12)
      g.beginPath()
      hist.forEach((value, i) => {
        const x = (i / (hist.length - 1)) * width
        const y = yOf(value)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.lineTo(width, height)
      g.lineTo(0, height)
      g.closePath()
      g.fillStyle = k3 ? 'rgba(255,255,255,0.85)' : 'rgba(254, 156, 161, 0.72)'
      g.fill()
      g.strokeStyle = k3 ? '#ffffff' : '#ffe4dc'
      g.lineWidth = 1.5
      g.stroke()
      g.fillStyle = k3 ? '#ffffff' : '#ffe4dc'
      g.font = '11px ui-monospace, Menlo, Consolas, monospace'
      g.fillText(gr < -0.1 ? `${gr.toFixed(1)} dB` : '0.0 dB', 6, 14)
      if (!curve) return
      const size = 72
      const pts = []
      for (let i = 0; i <= 24; i++) {
        const xDb = -48 + (i / 24) * 48
        pts.push(`${(i / 24) * size},${dbToCurveY(outputDb(xDb, comp), size)}`)
      }
      curve.setAttribute('points', pts.join(' '))
      const dot = curve.nextElementSibling
      if (dot) {
        const x = ((Math.max(-48, Math.min(0, inputDb)) + 48) / 48) * size
        dot.setAttribute('cx', String(x))
        dot.setAttribute('cy', String(dbToCurveY(outputDb(inputDb, comp), size)))
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [comp])
  return (
    <div className="comp-scope" aria-hidden="true">
      <canvas ref={canvasRef} />
      <svg className="comp-curve" viewBox="0 0 72 72">
        <polyline ref={curveRef} fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle r="3" fill="currentColor" />
      </svg>
    </div>
  )
}

function outputDb(input, comp) {
  const threshold = comp.threshold
  const ratio = Math.max(1, comp.ratio)
  const knee = Math.max(0, comp.knee)
  const x = input
  if (knee <= 0) return x < threshold ? x : threshold + (x - threshold) / ratio
  const lower = threshold - knee / 2
  const upper = threshold + knee / 2
  if (x < lower) return x
  if (x > upper) return threshold + (x - threshold) / ratio
  const span = x - lower
  return x + ((1 / ratio - 1) * span * span) / (2 * knee)
}

function dbToCurveY(db, size) {
  const clamped = Math.max(-48, Math.min(0, db))
  return ((0 - clamped) / 48) * size
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
      <CompScope comp={comp} />
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
    const id = event.pointerId
    let moved = 0
    let ended = false
    const lastTap = ref.current?.dataset.tap ? Number(ref.current.dataset.tap) : 0
    const move = (ev) => {
      if (ev.pointerId !== id) return
      if (ev.pointerType !== 'touch' && (ev.buttons & 1) === 0) {
        up(ev)
        return
      }
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
      if (ended) return
      if (ev && ev.pointerId != null && ev.pointerId !== id) return
      if (ev?.type === 'pointerup' && ev.pointerType !== 'touch' && (ev.buttons & 1) !== 0) return
      ended = true
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      try {
        if (ref.current?.hasPointerCapture?.(id)) ref.current.releasePointerCapture(id)
      } catch { /* the pointer is already gone */ }
      if (knob.pitch && comp.kSnap) commit(snapOctave(comp.kPitch, true), true)
      else touch(true)
      if (ev?.type === 'pointercancel') return
      const canMenu = knob.pitch || knob.lfo
      if (!canMenu || moved > 8) return
      const now = performance.now()
      if (now - lastTap < 320) {
        if (knob.pitch) setMenu((open) => !open)
        else openLfo()
        if (ref.current) ref.current.dataset.tap = '0'
      } else if (ref.current) ref.current.dataset.tap = String(now)
      ev?.preventDefault()
    }
    try { event.currentTarget.setPointerCapture(id) } catch { /* no live pointer */ }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
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

function Meter({ level, tall }) {
  const pct = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`
  return (
    <div className="meter" style={tall ? { height: tall } : undefined} aria-hidden="true">
      <span style={{ height: pct }} />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import plate from '../assets/q8n3k/r0.png'
import cel from '../assets/q8n3k/c0.png'
import d0 from '../assets/q8n3k/d0.png'
import d1 from '../assets/q8n3k/d1.png'
import d2 from '../assets/q8n3k/d2.png'
import d3 from '../assets/q8n3k/d3.png'
import { snapOctave } from '../audio/knee.js'
import { FX_TYPES, busLabel, model, touch } from '../model.js'
import { getBandReduction, getCompReduction, getMeters, syncMasterComp, syncMixer } from '../audio/engine.js'
import { clampCrossovers } from '../audio/multiband.js'
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

const mixUi = { bus: 0, eq: 0, fxOpen: true, band: 0 }

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
  touch(false)
}

export function Mixer() {
  useModel()
  const picked = mixUi.bus | 0
  const selected = picked >= 0 && picked < model.buses.length ? picked : 0
  return (
    <div className="screen mix-screen">
      <div className="mix-pages">
        <HelpButton title="Mixer" topic="mixer" />
        <button type="button" className="btn free-width mix-clear" onClick={clearMix}>
          Unmute/Unsolo All
        </button>
      </div>
      <div className="mix" data-coach="mix-row">
        {model.buses.map((bus, index) => (
          <Channel key={index} bus={bus} index={index} on={index === selected} />
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

function clearMix() {
  model.buses.forEach((bus) => {
    bus.mute = false
    bus.solo = false
  })
  touch(true)
  syncMixer()
}

function compHead(alt) {
  if (!alt) return 'Master compressor'
  return String.fromCharCode(74, 117, 115, 116, 105, 99, 101, 32, 102, 111, 114, 32, 71, 101, 111, 114, 103, 101, 32, 70, 108, 111, 121, 100, 32, 75, 110, 101, 101, 32, 67, 111, 109, 112, 114, 101, 115, 115, 111, 114)
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
  const anySolo = model.buses.some((b) => b.solo)
  const silenced = !!bus.mute || (anySolo && !bus.solo)
  const dim = silenced
  return (
    <div
      className={`strip ${on ? 'on' : ''} ${dim ? 'is-dim' : ''}`}
      data-bus={index}
      aria-current={on ? 'true' : undefined}
      onPointerDown={() => selectBus(index)}
    >
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
        <StripFader
          value={bus.volume}
          label={`${bus.name} volume`}
          onChange={(v) => {
            bus.volume = v
            commit()
          }}
        />
      </div>
      <div className="pips" aria-hidden="true">
        {bus.fx.map((slot, s) => (
          <i key={s} className={slot.type !== 'none' ? 'hot' : ''} />
        ))}
      </div>
      <div className="ms">
        <button
          type="button"
          className={`btn free-width ${silenced ? 'on' : ''}`}
          aria-label={`${bus.name} mute`}
          aria-pressed={silenced}
          title={silenced && !bus.mute ? 'Muted by solo' : 'Mute'}
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
  const title = bus.name === busLabel(index) ? bus.name : `${busLabel(index)} · ${bus.name}`
  const open = mixUi.fxOpen !== false
  return (
    <div className="mix-inserts" data-coach="mix-fx">
      <button
        type="button"
        className="mix-insert-title"
        aria-expanded={open}
        onClick={() => {
          mixUi.fxOpen = !open
          touch(false)
        }}
      >
        {title}
        <i>{open ? '–' : '+'}</i>
      </button>
      {open && (
        <div className="mix-slots">
          {bus.fx.map((slot, s) => (
            <div className={`fx-slot ${slot.type === 'none' ? 'is-off' : ''}`} key={s}>
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
              <Knob
                label={`${bus.name} effect ${s + 1} amount`}
                min={0}
                max={1}
                value={slot.amount}
                text={slot.type === 'none' ? 'off' : `${Math.round(slot.amount * 100)}%`}
                onChange={(v) => {
                  if (slot.type === 'none') return
                  slot.amount = v
                  commit()
                }}
              />
            </div>
          ))}
        </div>
      )}
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

const F_LO = 20
const F_HI = 20000

function freqToX(freq, width) {
  const f = Math.min(F_HI, Math.max(F_LO, freq))
  return (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * width
}

function xToFreq(x, width) {
  const t = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0
  return F_LO * (F_HI / F_LO) ** t
}

function BandGraph() {
  const ref = useRef(null)
  const comp = model.comp
  const selected = Math.max(0, Math.min(3, mixUi.band | 0))
  const setCrossover = (index, freq, done) => {
    const next = comp.crossovers.slice()
    next[index] = freq
    comp.crossovers = clampCrossovers(next)
    touch(!!done)
    syncMasterComp()
  }
  const setThreshold = (index, db, done) => {
    comp.bands[index].threshold = Math.max(-60, Math.min(0, db))
    touch(!!done)
    syncMasterComp()
  }
  const down = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const node = ref.current
    if (!node) return
    const id = event.pointerId
    const localX = (clientX) => {
      const rect = node.getBoundingClientRect()
      return ((clientX - rect.left) / Math.max(1, rect.width)) * width
    }
    const nearest = (clientX) => {
      const x = localX(clientX)
      let best = -1
      let dist = 14
      comp.crossovers.forEach((freq, index) => {
        const delta = Math.abs(x - freqToX(freq, width))
        if (delta < dist) {
          dist = delta
          best = index
        }
      })
      return best
    }
    const bandAt = (clientX) => {
      const freq = xToFreq(localX(clientX), width)
      const [a, b, c] = comp.crossovers
      if (freq < a) return 0
      if (freq < b) return 1
      if (freq < c) return 2
      return 3
    }
    const drag = nearest(event.clientX)
    if (drag < 0) {
      mixUi.band = bandAt(event.clientX)
      touch(false)
    }
    const move = (ev) => {
      if (ev.pointerId !== id) return
      const rect = node.getBoundingClientRect()
      if (drag >= 0) setCrossover(drag, xToFreq(localX(ev.clientX), width), false)
      else {
        const index = mixUi.band | 0
        const db = -60 * ((ev.clientY - rect.top) / Math.max(1, rect.height))
        setThreshold(index, db, false)
      }
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      if (drag >= 0) setCrossover(drag, comp.crossovers[drag], true)
      else setThreshold(mixUi.band | 0, comp.bands[mixUi.band | 0].threshold, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const width = 300
  const height = 72
  const cuts = comp.crossovers.map((freq) => freqToX(freq, width))
  const edges = [0, ...cuts, width]
  const gr = getBandReduction()
  return (
    <svg
      ref={ref}
      className="band-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="Multiband compressor"
      onPointerDown={down}
    >
      {comp.bands.map((band, index) => {
        const x = edges[index]
        const w = Math.max(0, edges[index + 1] - x)
        const y = ((0 - band.threshold) / 60) * height
        const reduced = Math.max(0, Math.min(height - y, ((gr[index] || 0) / -24) * (height - y)))
        return (
          <g key={index}>
            <rect x={x} y="0" width={w} height={height} className={index === selected ? 'on' : ''} />
            <line x1={x} x2={x + w} y1={y} y2={y} />
            <rect x={x} y={y} width={w} height={reduced} className="gr" />
          </g>
        )
      })}
      {cuts.map((x, index) => <line key={index} className="cut" x1={x} x2={x} y1="0" y2={height} />)}
    </svg>
  )
}

function MultiBand() {
  const comp = model.comp
  const index = Math.max(0, Math.min(3, mixUi.band | 0))
  const band = comp.bands[index]
  const setBand = (key, value) => {
    band[key] = value
    touch(true)
    syncMasterComp()
  }
  const pick = (next) => {
    mixUi.band = next
    touch(false)
  }
  return (
    <>
      <BandGraph />
      <div className="band-picks" role="group" aria-label="Compressor bands">
        {comp.bands.map((row, i) => (
          <button
            key={i}
            type="button"
            className={`btn ${i === index ? 'on' : ''}`}
            aria-pressed={i === index}
            onClick={() => pick(i)}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          className={`btn ${band.solo ? 'on' : ''}`}
          aria-pressed={!!band.solo}
          aria-label={`Solo band ${index + 1}`}
          onClick={() => setBand('solo', !band.solo)}
        >
          S
        </button>
        <button
          type="button"
          className={`btn ${band.mute ? 'on' : ''}`}
          aria-pressed={!!band.mute}
          aria-label={`Mute band ${index + 1}`}
          onClick={() => setBand('mute', !band.mute)}
        >
          M
        </button>
      </div>
      <div className="knob-row comp-knobs">
        <Knob label="Thresh" min={-60} max={0} value={band.threshold} text={`${band.threshold.toFixed(1)} dB`} onChange={(v) => setBand('threshold', v)} />
        <Knob label="Ratio" min={1} max={20} value={band.ratio} text={`${band.ratio.toFixed(1)}:1`} onChange={(v) => setBand('ratio', v)} />
        <Knob label="Knee" min={0} max={40} value={band.knee} text={`${band.knee.toFixed(1)} dB`} onChange={(v) => setBand('knee', v)} />
        <Knob label="Attack" min={0.001} max={0.5} value={band.attack} text={`${Math.round(band.attack * 1000)} ms`} onChange={(v) => setBand('attack', v)} />
        <Knob label="Release" min={0.01} max={1.2} value={band.release} text={`${Math.round(band.release * 1000)} ms`} onChange={(v) => setBand('release', v)} />
        <Knob label="Gain" min={-24} max={24} value={band.gain} text={`${band.gain.toFixed(1)} dB`} onChange={(v) => setBand('gain', v)} />
      </div>
    </>
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
      {!(comp.multi && !comp.justice) && <CompScope comp={comp} />}
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
        {!comp.justice && (
          <button
            type="button"
            className={`btn comp-multi ${comp.multi ? 'on' : ''}`}
            aria-pressed={!!comp.multi}
            aria-label="Multiband compressor"
            title="Four bands, like a multiband compressor"
            onClick={() => {
              comp.multi = !comp.multi
              touch(true)
              syncMasterComp()
            }}
          >
            MB
          </button>
        )}
      </div>
      {comp.justice ? (
        <div className="plate-slot">
          <Faceplate />
        </div>
      ) : comp.multi ? (
        <MultiBand />
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

function StripFader({ value, label, onChange }) {
  const ref = useRef(null)
  const level = Math.min(1, Math.max(0, Number(value) || 0))
  const drag = (event) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.height <= 0) return
    const next = 1 - (event.clientY - box.top) / box.height
    onChange(Math.min(1, Math.max(0, Math.round(next * 100) / 100)))
  }
  return (
    <div
      ref={ref}
      className="v-fader"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event)
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.01
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
          event.preventDefault()
          onChange(Math.min(1, Math.round((level + step) * 100) / 100))
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange(Math.max(0, Math.round((level - step) * 100) / 100))
        }
      }}
    >
      <i className="fill" style={{ height: `calc(${level} * (100% - 18px))` }} />
      <i className="cap" style={{ bottom: `calc(${level} * (100% - 18px))` }} />
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

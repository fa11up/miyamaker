import { useEffect, useRef, useState } from 'react'
import { busLabel, model, touch } from '../model.js'
import { readEqSpectrum, syncEq } from '../audio/engine.js'
import { dbToY, freqToX, responsePath, xToFreq, yToDb } from '../audio/eq.js'
import { useModel } from '../useModel.js'
import { Knob } from '../widgets.jsx'
import { finger } from './Tracker.jsx'

const TYPES = [
  ['low', 'Low cut'],
  ['bell', 'Bell'],
  ['high', 'High cut'],
]

function bandsFor(target) {
  if (target < 0) return model.comp.eq
  return model.buses[target]?.eq || model.comp.eq
}

function placeName(target) {
  if (target < 0) return 'Output'
  const bus = model.buses[target]
  if (!bus) return 'Output'
  const label = busLabel(target)
  return bus.name === label ? label : `${label} ${bus.name}`
}

function freqText(freq) {
  if (freq >= 1000) return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k`
  return `${Math.round(freq)}`
}

export function GraphicEq({ target, onTarget }) {
  useModel()
  const svgRef = useRef(null)
  const specRef = useRef(null)
  const curveRef = useRef(null)
  const drag = useRef(null)
  const [menu, setMenu] = useState(null)
  const bands = bandsFor(target)

  useEffect(() => { setMenu(null) }, [target])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const svg = svgRef.current
      const curve = curveRef.current
      const spec = specRef.current
      if (!svg || !curve) return
      const width = svg.clientWidth
      const height = svg.clientHeight
      if (width < 8 || height < 8) return
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      const live = bandsFor(target)
      const read = readEqSpectrum(target)
      const env = read?.env
      curve.setAttribute('d', responsePath(live, width, height, read?.rate || 48000, env))
      if (spec && read?.bins) {
        const bins = read.bins
        const rate = read.rate || 48000
        const nyquist = rate / 2
        let d = `M0 ${height}`
        const steps = 64
        for (let i = 0; i < steps; i++) {
          const freq = xToFreq((i / (steps - 1)) * width, width)
          const bin = Math.max(0, Math.min(bins.length - 1, Math.round((freq / nyquist) * bins.length)))
          const mag = bins[bin] / 255
          const y = height - mag * (height - 8)
          d += ` L${((i / (steps - 1)) * width).toFixed(1)} ${y.toFixed(1)}`
        }
        d += ` L${width} ${height} Z`
        spec.setAttribute('d', d)
      }
      svg.querySelectorAll('.eq-point').forEach((node) => {
        const index = node.dataset.index | 0
        const row = live[index]
        if (!row) return
        const dip = env && env[index] > 0.2 ? env[index] : 0
        const gain = row.type === 'bell' ? row.gain - dip : -dip
        node.setAttribute('cx', freqToX(row.freq, width).toFixed(1))
        node.setAttribute('cy', Math.max(6, Math.min(height - 6, dbToY(gain, height))).toFixed(1))
        node.classList.toggle('hot', dip > 0.4)
      })
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])

  const openMenu = (index) => setMenu(index)
  const edit = (index, patch, persist) => {
    const row = bandsFor(target)[index]
    if (!row) return
    Object.assign(row, patch)
    syncEq()
    touch(!!persist)
  }

  const pointerDown = (event, index) => {
    if (event.button === 2) return
    if (event.shiftKey || finger.shift) {
      event.preventDefault()
      openMenu(index)
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { index, id: event.pointerId }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* gone */ }
  }
  const pointerMove = (event) => {
    const held = drag.current
    if (!held || event.pointerId !== held.id) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const row = bandsFor(target)[held.index]
    if (!row) return
    row.freq = Math.max(20, Math.min(20000, xToFreq(event.clientX - rect.left, rect.width)))
    if (row.type === 'bell') row.gain = Math.max(-18, Math.min(18, yToDb(event.clientY - rect.top, rect.height)))
    else row.q = Math.max(0.2, Math.min(12, 0.3 + (1 - (event.clientY - rect.top) / rect.height) * 10))
    syncEq()
    touch(false)
  }
  const pointerUp = (event) => {
    if (!drag.current || event.pointerId !== drag.current.id) return
    drag.current = null
    touch(true)
  }

  const menuRow = menu != null ? bands[menu] : null
  const box = svgRef.current
  const width = box?.clientWidth || 320
  const height = box?.clientHeight || 120

  return (
    <section className="eq-panel" data-coach="mix-eq">
      <div className="eq-head">
        <span>EQ</span>
        <select
          className="eq-where"
          aria-label="EQ channel"
          value={target < 0 ? 'out' : String(target)}
          onChange={(event) => onTarget(event.target.value)}
        >
          <option value="out">Output</option>
          {model.buses.map((bus, index) => (
            <option key={index} value={index}>
              {bus.name === busLabel(index) ? busLabel(index) : `${busLabel(index)} ${bus.name}`}
            </option>
          ))}
        </select>
      </div>
      <svg
        ref={svgRef}
        className="eq-graph"
        viewBox={`0 0 ${width} ${height}`}
        role="application"
        aria-label={`EQ for ${placeName(target)}`}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.target === svgRef.current || event.target.classList?.contains('eq-spec') || event.target.classList?.contains('eq-curve')) setMenu(null)
        }}
      >
        <path ref={specRef} className="eq-spec" />
        <path ref={curveRef} className="eq-curve" />
        {bands.map((row, index) => (
          <circle
            key={index}
            className={`eq-point${menu === index ? ' on' : ''}${row.dyn ? ' dyn' : ''}`}
            data-index={index}
            r="7"
            cx={freqToX(row.freq, width)}
            cy={dbToY(row.type === 'bell' ? row.gain : 0, height)}
            onPointerDown={(event) => pointerDown(event, index)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openMenu(index)
            }}
          >
            <title>{`${TYPES.find((pair) => pair[0] === row.type)?.[1] || 'Bell'} ${freqText(row.freq)}`}</title>
          </circle>
        ))}
      </svg>
      {menuRow && (
        <div className="eq-menu">
          <div className="eq-types" role="group" aria-label={`Band ${menu + 1} shape`}>
            {TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={`btn free-width${menuRow.type === type ? ' on' : ''}`}
                onClick={() => edit(menu, { type }, true)}
              >
                {label}
              </button>
            ))}
          </div>
          <Knob
            label="Q"
            min={0.2}
            max={12}
            value={menuRow.q}
            text={menuRow.q.toFixed(2)}
            onChange={(value) => edit(menu, { q: value }, true)}
          />
          <button
            type="button"
            className={`btn free-width${menuRow.dyn ? ' on' : ''}`}
            aria-pressed={menuRow.dyn}
            onClick={() => edit(menu, { dyn: !menuRow.dyn }, true)}
          >
            Dynamic
          </button>
          {menuRow.dyn && (
            <>
              <label className="eq-dyn">
                Duck
                <input
                  type="range"
                  min={0}
                  max={18}
                  step={0.1}
                  value={menuRow.range}
                  aria-label="Dynamic depth"
                  onChange={(event) => edit(menu, { range: Number(event.target.value) }, true)}
                />
              </label>
              <label className="eq-dyn">
                Thresh
                <input
                  type="range"
                  min={-60}
                  max={0}
                  step={0.5}
                  value={menuRow.thresh}
                  aria-label="Dynamic threshold"
                  onChange={(event) => edit(menu, { thresh: Number(event.target.value) }, true)}
                />
              </label>
            </>
          )}
        </div>
      )}
    </section>
  )
}

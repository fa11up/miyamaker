import { useRef } from 'react'
import { model, currentPattern, setHit, clearHit, addBar, removeBar, doubleUp, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { Slider } from '../widgets.jsx'
import { PatternBar } from './PatternBar.jsx'

export function Sequencer() {
  useModel()
  const seq = currentPattern()
  const start = model.bank * 16
  const steps = seq.bars * 16
  const hit = model.seqHit
  const selected = hit ? (seq.steps[hit.step] || []).find((e) => e && e.pad === hit.pad) : null
  return (
    <div className="screen">
      <div className="seq-top">
        <PatternBar />
        <button type="button" className="btn free-width" onClick={removeBar}>
          − bar
        </button>
        <button type="button" className="btn free-width" onClick={addBar}>
          + bar
        </button>
        <button type="button" className="btn free-width" onClick={doubleUp}>
          Double
        </button>
        <span className="hint">{seq.bars} bar{seq.bars === 1 ? '' : 's'}</span>
        <Slider
          label="Swing"
          min={0}
          max={0.6}
          step={0.01}
          value={model.swing}
          onChange={(v) => {
            model.swing = v
            touch(true)
          }}
        />
      </div>
      <div className="seq-grid">
        <table>
          <thead>
            <tr>
              <th />
              {Array.from({ length: steps }, (_, i) => (
                <th key={i}>{i % 4 === 0 ? i / 4 + 1 : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 16 }, (_, local) => {
              const pad = start + local
              return (
                <tr key={pad}>
                  <td className="pad-name">{model.pads[pad].name}</td>
                  {Array.from({ length: steps }, (_, step) => {
                    const ev = (seq.steps[step] || []).find((e) => e && e.pad === pad)
                    const play = model.playing && model.playhead === step
                    const on = hit && hit.step === step && hit.pad === pad
                    return (
                      <td key={step} className={play ? 'play' : ''}>
                        <HitCell pad={pad} step={step} ev={ev} selected={on} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {selected && hit && (
        <div className="seq-edit">
          <Slider
            label="Velocity"
            min={0.05}
            max={1}
            step={0.01}
            value={selected.vel}
            text={String(Math.round(selected.vel * 127))}
            onChange={(v) => setHit(hit.step, hit.pad, { vel: v })}
          />
          <Slider
            label="Micro"
            min={-50}
            max={50}
            step={1}
            value={selected.nudge || 0}
            text={`${selected.nudge || 0}%`}
            onChange={(v) => setHit(hit.step, hit.pad, { nudge: v })}
          />
          <button type="button" className="btn free-width" onClick={() => { clearHit(hit.step, hit.pad); model.seqHit = null; touch(false) }}>
            Clear hit
          </button>
        </div>
      )}
      <p className="hint">
        Patterns are addresses 00–FF. Drag a cell up or down to set velocity. Micro is how far the hit sits from the 16th, in percent of a step. Grid record snaps. Natural record writes that offset into the micro-move lane.
      </p>
    </div>
  )
}

function HitCell({ pad, step, ev, selected }) {
  const drag = useRef(null)
  const vel = ev ? ev.vel : 0
  const nudge = ev?.nudge || 0
  return (
    <button
      type="button"
      className={`cell ${ev ? 'on' : ''} ${selected ? 'sel' : ''}`}
      aria-label={`step ${step + 1} velocity ${ev ? Math.round(ev.vel * 127) : 0}`}
      onPointerDown={(e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already gone */ }
        const already = !!(model.seqHit && model.seqHit.step === step && model.seqHit.pad === pad && ev)
        if (!ev) setHit(step, pad, { vel: 0.9, nudge: 0 })
        model.seqHit = { step, pad }
        drag.current = { y: e.clientY, moved: false, already }
        touch(false)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        if (Math.abs(e.clientY - d.y) < 3) return
        d.moved = true
        const rect = e.currentTarget.getBoundingClientRect()
        const next = Math.max(0.05, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
        setHit(step, pad, { vel: next })
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && d.already && !d.moved) {
          clearHit(step, pad)
          model.seqHit = null
          touch(false)
        }
      }}
    >
      {ev && <span className="vel" style={{ height: `${Math.round(vel * 100)}%` }} />}
      {ev && nudge !== 0 && <span className="mv" style={{ left: `${50 + nudge}%` }} />}
    </button>
  )
}

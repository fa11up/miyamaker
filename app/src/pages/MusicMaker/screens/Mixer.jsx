import { useEffect, useState } from 'react'
import { FX_TYPES, model, touch } from '../model.js'
import { getMeters, syncMixer } from '../audio/engine.js'
import { useModel } from '../useModel.js'

export function Mixer() {
  useModel()
  return (
    <div className="screen">
      <div className="mix">
        {model.buses.map((bus, i) => (
          <Channel key={i} bus={bus} index={i} />
        ))}
        <Master />
      </div>
      <p className="hint">Four buses, five effect slots each, then the master. The brickwall limiter sits after the master and will not pass 0 dBFS. Attack 1 ms, release 1.2 s.</p>
    </div>
  )
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
        onChange={(e) => {
          bus.name = e.target.value
          commit()
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <Meter level={level} />
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
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 140, width: 28 }}
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

function Master() {
  const [level, setLevel] = useState(0)
  const [gr, setGr] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const m = getMeters()
      setLevel(m.master || 0)
      setGr(m.gr || 0)
    }, 80)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="channel">
      <strong>MAIN</strong>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <Meter level={level} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={model.master}
          aria-label="Master volume"
          onChange={(e) => {
            model.master = Number(e.target.value)
            touch(true)
            syncMixer()
          }}
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 140, width: 28 }}
        />
      </div>
      <span className="hint">GR {gr < -0.1 ? `${gr.toFixed(1)} dB` : '0.0 dB'}</span>
      <span className="hint">ceiling 0 dB</span>
    </div>
  )
}

function Meter({ level }) {
  const h = Math.round(Math.min(1, level) * 140)
  return (
    <div className="meter" aria-hidden="true">
      <span style={{ height: h }} />
    </div>
  )
}

import styled from 'styled-components/macro'

import type { RadioApi } from '@/context/RadioProvider'
import { bandLabel, defaultEq, EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EQ_PRESETS, matchPreset } from '@/music/eq'
import { font } from '@/theme/tokens'

import { Key, Lcd, Led } from './parts'

const Top = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  select {
    height: 24px;
    min-width: 0;
    flex: 0 1 150px;
    border: none;
    border-radius: 0;
    padding: 0 4px;
    background: var(--rk-lcd);
    color: var(--rk-lcd-ink);
    font-family: ${font.ui};
    font-size: 12px;
    box-shadow: inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi);
    &:focus-visible {
      outline: 1px dotted var(--rk-frame-ink);
      outline-offset: 1px;
    }
    @media (max-width: 768px) {
      height: 34px;
    }
  }
`

const Curve = styled(Lcd)`
  flex: 1 1 80px;
  min-width: 60px;
  height: 24px;
  svg {
    position: absolute;
    inset: 3px 4px;
    width: calc(100% - 8px);
    height: calc(100% - 6px);
    overflow: visible;
  }
  .zero {
    stroke: var(--rk-lcd-dim);
  }
  .line {
    fill: none;
    stroke: var(--rk-lcd-ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 2px var(--rk-lcd-glow));
  }
  &.off .line {
    stroke: var(--rk-lcd-soft);
    opacity: 0.45;
    filter: none;
  }
  @media (max-width: 768px) {
    height: 34px;
  }
`

const Bands = styled.div`
  display: grid;
  grid-template-columns: 26px 22px 10px repeat(${EQ_BANDS.length}, minmax(0, 1fr));
  align-items: stretch;
  column-gap: 2px;
  font-family: ${font.ui};
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--rk-frame-ink);
  .scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 72px;
    text-align: right;
    opacity: 0.75;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }
  .col small {
    font-size: 10px;
    white-space: nowrap;
  }
  .sep {
    width: 1px;
    justify-self: center;
    height: 72px;
    background: var(--rk-frame-lo);
    box-shadow: 1px 0 0 var(--rk-frame-hi);
  }
  @media (max-width: 768px) {
    .scale,
    .sep {
      height: 96px;
    }
  }
`

/** Vertical fader. `--v` (0…1) colours the thumb from cool (cut) to hot (boost). */
const Fader = styled.input.attrs({ type: 'range' })`
  --v: 0.5;
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 16px;
  height: 72px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  &::-webkit-slider-runnable-track {
    width: 4px;
    margin: 0 auto;
    background: linear-gradient(0deg, var(--rk-fill-a), var(--rk-fill-b)) 0 100% / 100% calc(var(--v) * 100%) no-repeat,
      var(--rk-groove);
    box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.5), 1px 0 0 var(--rk-frame-hi);
  }
  &::-moz-range-track {
    width: 4px;
    background: var(--rk-groove);
    box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.5), 1px 0 0 var(--rk-frame-hi);
  }
  &::-moz-range-progress {
    width: 4px;
    background: linear-gradient(0deg, var(--rk-fill-a), var(--rk-fill-b));
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 8px;
    margin-left: -5px;
    border: none;
    background: linear-gradient(180deg, transparent 3px, var(--rk-btn-on) 3px 5px, transparent 5px),
      linear-gradient(180deg, var(--rk-frame-hi), var(--rk-btn) 50%, var(--rk-frame-2));
    box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo), 0 0 0 1px var(--rk-seam);
  }
  &::-moz-range-thumb {
    width: 14px;
    height: 8px;
    border: none;
    border-radius: 0;
    background: linear-gradient(180deg, transparent 3px, var(--rk-btn-on) 3px 5px, transparent 5px),
      linear-gradient(180deg, var(--rk-frame-hi), var(--rk-btn) 50%, var(--rk-frame-2));
    box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo), 0 0 0 1px var(--rk-seam);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
    outline-offset: 1px;
  }
  &.off {
    opacity: 0.6;
  }
  @media (max-width: 768px) {
    height: 96px;
    width: 24px;
    &::-webkit-slider-thumb {
      width: 20px;
      height: 12px;
      margin-left: -8px;
    }
    &::-moz-range-thumb {
      width: 20px;
      height: 12px;
    }
  }
`

const Note = styled.p`
  margin: 6px 0 0;
  font-family: ${font.ui};
  font-size: 11px;
  line-height: 1.3;
  color: var(--rk-frame-ink);
  opacity: 0.85;
`

const RANGE = EQ_MAX_DB - EQ_MIN_DB
const frac = (db: number) => (db - EQ_MIN_DB) / RANGE
const dbText = (db: number) => `${db > 0 ? '+' : ''}${db} dB`

function curvePath(bands: number[]) {
  const pts = bands.map((b, i) => [(i / (bands.length - 1)) * 100, (1 - frac(b)) * 20] as const)
  // Smooth with midpoint quadratics so the line reads like an analogue response curve.
  let d = `M${pts[0]?.[0]} ${pts[0]?.[1]}`
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1] as readonly [number, number]
    const [x1, y1] = pts[i] as readonly [number, number]
    d += ` Q${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`
    if (i === pts.length - 1) d += ` T${x1} ${y1}`
  }

  return d
}

export default function Equalizer({ radio }: { radio: RadioApi }) {
  const { eq, setEq } = radio
  const preset = matchPreset(eq)
  const live = radio.fx
  return (
    <>
      <Top>
        <Key
          type="button"
          aria-pressed={eq.enabled}
          onClick={() => setEq({ enabled: !eq.enabled })}
          title={eq.enabled ? 'Equalizer on (click to bypass)' : 'Equalizer bypassed (click to turn on)'}
        >
          <Led $on={eq.enabled} /> On
        </Key>
        <select
          aria-label="Equalizer preset"
          value={preset?.id || ''}
          onChange={(e) => {
            const p = EQ_PRESETS.find((x) => x.id === e.target.value)
            if (p) setEq({ preamp: p.preamp, bands: [...p.bands], enabled: true })
          }}
        >
          {!preset && <option value="">Custom</option>}
          {EQ_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <Curve className={eq.enabled ? undefined : 'off'} aria-hidden="true">
          <svg viewBox="0 0 100 20" preserveAspectRatio="none">
            <line
              className="zero"
              x1="0"
              x2="100"
              y1="10"
              y2="10"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <path className="line" d={curvePath(eq.bands)} />
          </svg>
        </Curve>
        <Key
          type="button"
          onClick={() => setEq({ ...defaultEq(), enabled: eq.enabled })}
          title="Reset every band to 0 dB"
        >
          Flat
        </Key>
      </Top>
      <Bands role="group" aria-label="Equalizer bands">
        <div className="scale" aria-hidden="true">
          <span>+12</span>
          <span>0</span>
          <span>-12</span>
        </div>
        <div className="col">
          <Fader
            className={eq.enabled ? undefined : 'off'}
            aria-label="Preamp"
            aria-valuetext={dbText(eq.preamp)}
            title={`Preamp ${dbText(eq.preamp)}`}
            min={EQ_MIN_DB}
            max={EQ_MAX_DB}
            step={0.5}
            value={eq.preamp}
            style={{ ['--v' as string]: frac(eq.preamp) }}
            onChange={(e) => setEq({ preamp: Number(e.target.value) })}
            onDoubleClick={() => setEq({ preamp: 0 })}
          />
          <small>PRE</small>
        </div>
        <span className="sep" aria-hidden="true" />
        {EQ_BANDS.map((hz, i) => {
          const db = eq.bands[i] ?? 0
          return (
            <div className="col" key={hz}>
              <Fader
                className={eq.enabled ? undefined : 'off'}
                aria-label={`${bandLabel(hz)}Hz`}
                aria-valuetext={dbText(db)}
                title={`${bandLabel(hz)}Hz ${dbText(db)} (double-click for 0)`}
                min={EQ_MIN_DB}
                max={EQ_MAX_DB}
                step={0.5}
                value={db}
                style={{ ['--v' as string]: frac(db) }}
                onChange={(e) => {
                  const bands = [...eq.bands]
                  bands[i] = Number(e.target.value)
                  setEq({ bands })
                }}
                onDoubleClick={() => {
                  const bands = [...eq.bands]
                  bands[i] = 0
                  setEq({ bands })
                }}
              />
              <small>{bandLabel(hz)}</small>
            </div>
          )
        })}
      </Bands>
      {radio.current && !live && (
        <Note role="note">
          This track plays without the live audio path (reduced motion, iOS, or a host without CORS), so the EQ and
          balance wait for the next track that has it.
        </Note>
      )}
    </>
  )
}

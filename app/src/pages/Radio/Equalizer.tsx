import styled from 'styled-components/macro'

import type { RadioApi } from '@/context/RadioProvider'
import { bandLabel, defaultEq, EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EQ_PRESETS, matchPreset } from '@/music/eq'
import { font } from '@/theme/tokens'

import { Key, PixelText, well } from './parts'

const Top = styled.div`
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 14px;
  margin: 3px 4px;
  select {
    all: unset;
    box-sizing: border-box;
    flex: 0 0 78px;
    padding: 0 3px;
    overflow: hidden;
    font-family: ${font.ui};
    font-size: 10px;
    line-height: 14px;
    white-space: nowrap;
    color: var(--rk-lcd-ink);
    background: var(--rk-lcd);
    box-shadow: ${well};
    cursor: pointer;
    &:focus-visible {
      outline: 1px dotted var(--rk-frame-ink);
    }
  }
  option {
    color: var(--rk-lcd-ink);
    background: var(--rk-lcd);
  }
`

const Curve = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background: var(--rk-lcd);
  box-shadow: ${well};
  svg {
    position: absolute;
    inset: 2px 3px;
    width: calc(100% - 6px);
    height: calc(100% - 4px);
    overflow: visible;
  }
  .zero {
    stroke: var(--rk-lcd-dim);
  }
  .line {
    fill: none;
    stroke: var(--rk-lcd-ink);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  &.off .line {
    stroke: var(--rk-lcd-soft);
    opacity: 0.45;
  }
`

const Bands = styled.div`
  display: grid;
  grid-template-columns: 17px 14px 3px repeat(${EQ_BANDS.length}, minmax(0, 1fr));
  align-items: start;
  margin: 0 2px;
  color: var(--rk-lcd-ink);
  .scale {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: space-between;
    height: 63px;
    padding-right: 2px;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .sep {
    justify-self: center;
    width: 1px;
    height: 63px;
    background: var(--rk-frame-lo);
    box-shadow: 1px 0 0 var(--rk-frame-hi);
  }
`

/** Vertical fader. `--v` (0…1) is how much of the groove is lit. */
const Fader = styled.input.attrs({ type: 'range' })`
  --v: 0.5;
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 14px;
  height: 63px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  &::-webkit-slider-runnable-track {
    width: 4px;
    margin: 0 auto;
    background: linear-gradient(0deg, var(--rk-viz-lo), var(--rk-viz-mid) 60%, var(--rk-viz-hi)) 0 100% / 100%
        calc(var(--v) * 100%) no-repeat,
      var(--rk-groove);
    box-shadow: ${well};
  }
  &::-moz-range-track {
    width: 4px;
    background: var(--rk-groove);
    box-shadow: ${well};
  }
  &::-moz-range-progress {
    width: 4px;
    background: linear-gradient(0deg, var(--rk-viz-lo), var(--rk-viz-mid) 60%, var(--rk-viz-hi));
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    box-sizing: border-box;
    width: 11px;
    height: 7px;
    margin-left: -4px;
    background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
    box-shadow: inset 1px 1px 0 var(--rk-key-hi), inset -1px -1px 0 var(--rk-key-lo), 0 0 0 1px var(--rk-seam);
  }
  &::-moz-range-thumb {
    box-sizing: border-box;
    width: 11px;
    height: 7px;
    border: none;
    border-radius: 0;
    background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
    box-shadow: inset 1px 1px 0 var(--rk-key-hi), inset -1px -1px 0 var(--rk-key-lo), 0 0 0 1px var(--rk-seam);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
    outline-offset: 1px;
  }
  &.off {
    opacity: 0.6;
  }
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
  return (
    <>
      <Top>
        <Key
          type="button"
          aria-pressed={eq.enabled}
          style={{ width: 24 }}
          onClick={() => setEq({ enabled: !eq.enabled })}
          title={eq.enabled ? 'Equalizer on (click to bypass)' : 'Equalizer bypassed (click to turn on)'}
        >
          <PixelText text={eq.enabled ? 'ON' : 'OFF'} />
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
          style={{ width: 28 }}
          onClick={() => setEq({ ...defaultEq(), enabled: eq.enabled })}
          title="Reset every band to 0 dB"
        >
          <PixelText text="FLAT" />
        </Key>
      </Top>
      <Bands role="group" aria-label="Equalizer bands">
        <div className="scale" aria-hidden="true">
          <PixelText text="+12" />
          <PixelText text="0" />
          <PixelText text="-12" />
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
          <PixelText text="PR" />
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
              <PixelText text={bandLabel(hz)} />
            </div>
          )
        })}
      </Bands>
    </>
  )
}

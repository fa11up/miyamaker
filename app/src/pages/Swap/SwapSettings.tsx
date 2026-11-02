import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { bevel, color, space, text } from '@/theme/tokens'

import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS, SLIPPAGE_PRESETS_BPS } from './constants'

const Wrap = styled.div`
  position: relative;
  flex: none;
`

const Toggle = styled.button`
  height: 36px;
  min-width: 44px;
  padding: 0 ${space[2]};
  display: inline-flex;
  align-items: center;
  gap: ${space[1]};
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  font-size: ${text.sm};
  cursor: pointer;
  &[aria-expanded='true'],
  &:active {
    box-shadow: ${bevel.pressed};
    background: ${color.light};
  }
  .narrow & {
    height: 44px;
  }
`

const Pop = styled.div`
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 10;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]};
  background: ${color.face};
  box-shadow: ${bevel.raised}, 3px 3px 0 rgba(20, 16, 31, 0.35);
  font-size: ${text.sm};
  .narrow & {
    position: fixed;
    left: ${space[2]};
    right: ${space[2]};
    top: auto;
    bottom: ${space[2]};
    width: auto;
  }
  h3 {
    margin: 0;
    font-size: ${text.md};
  }
  p {
    margin: 0;
    color: ${color.inkMuted};
    line-height: 1.35;
  }
`

const Presets = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr) 1.3fr;
  gap: ${space[1]};
  button,
  input {
    height: 36px;
    min-width: 0;
    border: none;
    border-radius: 0;
    font-size: ${text.sm};
    .narrow & {
      height: 44px;
    }
  }
  button {
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.light};
    font-weight: 700;
  }
  label {
    position: relative;
    display: flex;
  }
  input {
    width: 100%;
    padding: 0 22px 0 ${space[1]};
    background: ${color.well};
    box-shadow: ${bevel.field};
    text-align: right;
  }
  label span {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }
`

const Done = styled.button`
  align-self: flex-end;
  height: 32px;
  min-width: 72px;
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  cursor: pointer;
  &:active {
    box-shadow: ${bevel.pressed};
  }
  .narrow & {
    height: 44px;
    align-self: stretch;
  }
`

/** Gear button with a small popover for max slippage (0.1% to 3%, what the proxy accepts). */
export default function SwapSettings({
  slippageBps,
  onChange,
  disabled,
}: {
  slippageBps: number
  onChange: (bps: number) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const customBps = Math.round(Number(custom) * 100)
  const customInvalid = custom !== '' && !(customBps >= SLIPPAGE_MIN_BPS && customBps <= SLIPPAGE_MAX_BPS)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <Wrap ref={wrapRef}>
      <Toggle
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Settings. Max slippage ${slippageBps / 100}%`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        data-swap-settings
      >
        <span aria-hidden>⚙</span>
        <span>{slippageBps / 100}%</span>
      </Toggle>
      {open && (
        <Pop role="dialog" aria-label="Swap settings">
          <h3>Max slippage</h3>
          <p>If the price moves more than this before your swap lands, it cancels and you keep your tokens.</p>
          <Presets>
            {SLIPPAGE_PRESETS_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                aria-pressed={slippageBps === bps && !custom}
                onClick={() => {
                  setCustom('')
                  onChange(bps)
                }}
              >
                {bps / 100}%
              </button>
            ))}
            <label>
              <input
                inputMode="decimal"
                placeholder="Custom"
                aria-label="Custom slippage percent"
                aria-invalid={customInvalid}
                aria-describedby="slippage-help"
                value={custom}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (!/^\d*\.?\d{0,2}$/.test(v)) return
                  setCustom(v)
                  const bps = Math.round(Number(v) * 100)
                  if (v && bps >= SLIPPAGE_MIN_BPS && bps <= SLIPPAGE_MAX_BPS) onChange(bps)
                }}
              />
              <span aria-hidden>%</span>
            </label>
          </Presets>
          <p
            id="slippage-help"
            role={customInvalid ? 'alert' : undefined}
            style={customInvalid ? { color: color.danger } : undefined}
          >
            {customInvalid
              ? `${custom}% is outside 0.1% to 3%. Still using ${slippageBps / 100}%.`
              : 'Pick 0.1% to 3%. 0.5% suits most trades.'}
          </p>
          {slippageBps >= 200 && <p style={{ color: color.warning }}>High slippage: you may get a worse price.</p>}
          <Done type="button" onClick={() => setOpen(false)}>
            Done
          </Done>
        </Pop>
      )}
    </Wrap>
  )
}

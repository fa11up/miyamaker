import styled, { keyframes } from 'styled-components/macro'

import { bevel, color, font, space, text } from './tokens'

/** Trade's copy of components/Retro on the floor palette, so its screens change colour at the source. */

/** Panel on the floor. */
export const Panel = styled.section`
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: ${space[4]};
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  min-width: 0;
`

/** Sunken well (inputs, image frames, readouts). */
export const Well = styled.div`
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  padding: ${space[1]};
`

export const Eyebrow = styled.div`
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.inkMuted};
`

export const DisplayTitle = styled.h1`
  font-family: ${font.display};
  font-weight: 400;
  font-size: ${text.xl};
  line-height: 1.1;
  letter-spacing: 0.02em;
  color: ${color.highlight};
  text-shadow: 2px 2px 0 ${color.dark};
  margin: 0;
  overflow-wrap: break-word;
  .narrow & {
    font-size: ${text.lg};
  }
`

export const Chip = styled.span<{ tone?: 'ok' | 'warn' | 'off' }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px ${space[2]};
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  color: ${color.ink};
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    background: ${({ tone }) => (tone === 'ok' ? color.success : tone === 'warn' ? color.warning : color.shadow)};
  }
`

const shimmer = keyframes`
  from { background-position: 0 0; }
  to { background-position: 16px 16px; }
`

/** Dithered placeholder while something loads. */
export const Skeleton = styled.div<{ h?: string; w?: string }>`
  height: ${({ h }) => h || '1em'};
  width: ${({ w }) => w || '100%'};
  background-color: ${color.light};
  background-image: linear-gradient(
      45deg,
      ${color.faceLight} 25%,
      transparent 25%,
      transparent 75%,
      ${color.faceLight} 75%
    ),
    linear-gradient(45deg, ${color.faceLight} 25%, transparent 25%, transparent 75%, ${color.faceLight} 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
  animation: ${shimmer} 1.2s linear infinite;
`

/** Win9x-style segmented progress meter. */
const Meter = styled.div`
  height: 22px;
  padding: 3px;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
`

const MeterFill = styled.div`
  height: 100%;
  background-image: repeating-linear-gradient(90deg, ${color.accent} 0 10px, transparent 10px 12px);
  transition: width 400ms steps(12);
`

export function ProgressMeter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <Meter role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <MeterFill style={{ width: `${Math.max(pct, value > 0 ? 1.5 : 0)}%` }} />
    </Meter>
  )
}

export const StatRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space[2]};
  font-size: ${text.sm};
  color: ${color.inkMuted};
  strong {
    color: ${color.ink};
    font-size: ${text.md};
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
`

export const Stepper = styled.div`
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  height: 40px;
  button {
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    font-size: ${text.lg};
    line-height: 1;
    cursor: pointer;
    &:hover:not(:disabled) {
      background: ${color.faceLight};
    }
    &:active:not(:disabled) {
      box-shadow: ${bevel.pressed};
    }
    &:disabled {
      color: ${color.shadow};
      cursor: not-allowed;
    }
  }
  input {
    min-width: 0;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    text-align: center;
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
    -moz-appearance: textfield;
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }
`

export const BigButton = styled.button`
  min-height: 48px;
  width: 100%;
  border: none;
  border-radius: 0;
  background: ${color.accent};
  color: ${color.onAccent};
  font-family: ${font.display};
  font-size: ${text.lg};
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #ffc340;
  }
  &:active:not(:disabled) {
    background: ${color.accentDark};
  }
  &:focus-visible {
    outline: 2px dotted ${color.onAccent};
    outline-offset: -5px;
  }
  &:disabled {
    cursor: not-allowed;
    background: ${color.face};
    color: ${color.shadow};
    box-shadow: ${bevel.raised};
  }
  &.secondary {
    background: ${color.face};
    color: ${color.ink};
    box-shadow: ${bevel.raised};
    &:hover:not(:disabled) {
      background: ${color.faceLight};
    }
  }
`

export const StatusBox = styled.div<{ tone: 'info' | 'ok' | 'error' }>`
  display: flex;
  align-items: flex-start;
  gap: ${space[2]};
  padding: ${space[2]} ${space[3]};
  font-size: ${text.sm};
  line-height: 1.4;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  border-left: 4px solid
    ${({ tone }) => (tone === 'ok' ? color.success : tone === 'error' ? color.danger : color.accent)};
  color: ${({ tone }) => (tone === 'error' ? color.danger : color.ink)};
  word-break: break-word;
  img {
    width: 16px;
    flex: 0 0 auto;
    border: none;
    margin: 0;
  }
  a {
    color: ${color.link};
  }
`

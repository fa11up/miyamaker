import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import { bevel, color, space, text } from '../floor/tokens'
import type { Venue } from './markets'

/** Building blocks for the Markets section: one row per venue, a link-out button and the best-price banner. */

export const VenueList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const Row = styled.li`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: ${space[2]};
    flex-wrap: wrap;
  }
  .name {
    font-size: ${text.md};
    font-weight: 700;
  }
  .fees {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .fees.free {
    color: ${color.success};
    font-weight: 700;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[1]} ${space[4]};
    margin: 0;
    font-size: ${text.sm};
  }
  .facts div {
    display: flex;
    gap: ${space[1]};
  }
  .facts dt {
    color: ${color.inkMuted};
  }
  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .note {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    line-height: 1.4;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[2]};
  }
`

export const OutLink = styled.a`
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 ${space[3]};
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  font-size: ${text.sm};
  text-decoration: none;
  &:hover {
    background: ${color.faceLight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
  .narrow & {
    min-height: 44px;
  }
`

export function VenueRow({
  venue,
  label,
  facts,
  note,
  children,
}: {
  venue: Venue
  /** e.g. "MiyaPool · Pick" */
  label?: string
  facts?: { label: string; value: string }[]
  note?: ReactNode
  children?: ReactNode
}) {
  return (
    <Row data-venue={venue.id}>
      <div className="top">
        <span className="name">{label || venue.name}</span>
        <span className={venue.id === 'miyapool' ? 'fees free' : 'fees'}>{venue.fees}</span>
      </div>
      {facts && facts.length > 0 && (
        <dl className="facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <div className="note">{note}</div>}
      {children && <div className="actions">{children}</div>}
    </Row>
  )
}

export const Best = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  border-left: 4px solid ${color.accent};
  .line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: ${space[2]};
    flex-wrap: wrap;
    font-size: ${text.sm};
  }
  .line span:first-child {
    color: ${color.inkMuted};
  }
  strong {
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
  }
  .where {
    font-size: ${text.sm};
    font-weight: 400;
    color: ${color.inkMuted};
  }
  /* A MiyaPool line: the label stays on the left, the price (and its sell side below it) on the right. */
  .line.pool {
    flex-wrap: nowrap;
    align-items: flex-start;
  }
  .line.pool > span:first-child {
    flex: 0 0 auto;
    white-space: nowrap;
    padding-top: 3px;
  }
  .line.pool strong {
    min-width: 0;
    text-align: right;
  }
  .sub {
    display: block;
  }
`

const Switch = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[2]};
  margin-top: ${space[1]};
  font-size: ${text.xs};
  .label {
    color: ${color.inkMuted};
  }
  .opts {
    display: flex;
    gap: 2px;
  }
  button {
    min-width: 56px;
    height: 28px;
    padding: 0 ${space[2]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.xs};
    cursor: pointer;
    .narrow & {
      height: 40px;
      min-width: 0;
      flex: 1;
    }
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.well};
    font-weight: 700;
  }
  button:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
  .narrow & {
    width: 100%;
  }
  .narrow & .opts {
    flex: 1;
  }
`

/** A small ETH / imdUSD / IMD / INFER switch (toggle buttons). Hidden when there is only one choice. */
export function PairSwitch({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: readonly string[]
  value: string | undefined
  onChange: (symbol: string) => void
  disabled?: boolean
}) {
  if (options.length < 2) return null
  return (
    <Switch role="group" aria-label={label} data-pair-switch>
      <span className="label" aria-hidden>
        {label}
      </span>
      <span className="opts">
        {options.map((s) => (
          <button key={s} type="button" aria-pressed={s === value} onClick={() => onChange(s)} disabled={disabled}>
            {s}
          </button>
        ))}
      </span>
    </Switch>
  )
}

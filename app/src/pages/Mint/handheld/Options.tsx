import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import { LCD_FONT } from './Device'

/**
 * The mint's options on the Info screen: which sale, which token, and who gets the piece. Drawn like the rest of the
 * handheld (dark glass, cyan edges, LCD figures, the yellow dashed focus ring) instead of the browser's own controls,
 * whose popups can't be themed. Each choice is a real radio or checkbox inside its label, so arrows, Space, Tab and
 * screen readers work as they do anywhere; the input itself is hidden and its box drawn beside it.
 */

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
`

const Group = styled.fieldset`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  &:disabled {
    opacity: 0.6;
  }
  &:disabled label {
    cursor: default;
  }
`

/** A group's name, small and spaced like a menu heading on the readout. */
const Legend = styled.legend`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0 0 6px;
  padding: 0;
  font-family: ${LCD_FONT};
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #9fe8ff;
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(190, 240, 255, 0.3);
  }
`

const Row = styled.label`
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 10px;
  min-height: 40px;
  padding: 7px 10px;
  border: 1px solid rgba(190, 240, 255, 0.28);
  border-radius: 5px;
  background: rgba(8, 24, 52, 0.62);
  color: #f1eeff;
  cursor: pointer;
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
    pointer-events: none;
  }
  &:hover {
    border-color: rgba(190, 240, 255, 0.6);
  }
  &:has(input:checked) {
    border-color: rgba(190, 240, 255, 0.95);
    background: rgba(18, 52, 96, 0.9);
    box-shadow: inset 3px 0 0 #9fe8ff;
  }
  &:has(input:focus-visible) {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
`

/** The drawn box: round for one-of, square for on/off. */
const Box = styled.span`
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 2px solid #bdb9d0;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #0c1830;
  input:checked + & {
    border-color: #9fe8ff;
    background: #9fe8ff;
  }
  input:checked + &::after {
    content: '✓';
  }
`
const Dot = styled.span`
  width: 16px;
  height: 16px;
  border: 2px solid #bdb9d0;
  border-radius: 50%;
  input:checked + & {
    border-color: #9fe8ff;
    background: radial-gradient(circle, #9fe8ff 0 4px, transparent 5px);
  }
`

const Main = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  b {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  small {
    font-size: 13px;
    line-height: 1.3;
    color: #bdb9d0;
  }
`

/** The figure on the right of a row, in the readout's type. */
const Figure = styled.span`
  font-family: ${LCD_FONT};
  font-size: 14px;
  text-align: right;
  white-space: nowrap;
  color: #e4f8ff;
`

export const Note = styled.p`
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.35;
  color: #bdb9d0;
`

const Field = styled.input`
  && {
    box-sizing: border-box;
    width: 100%;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid rgba(190, 240, 255, 0.6);
    border-radius: 5px;
    background: rgba(4, 12, 28, 0.85);
    color: #f1eeff;
    font-family: ${LCD_FONT};
    font-size: 16px;
  }
  &::placeholder {
    color: #8f8aa6;
  }
  &[aria-invalid='true'] {
    border-color: #ffb3ac;
  }
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
`

export function OptionGroup({
  legend,
  disabled,
  children,
}: {
  legend: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Group disabled={disabled}>
      <Legend>{legend}</Legend>
      {children}
    </Group>
  )
}

/** One choice of several (a radio): what it is, a line under it, and its figure on the right. */
export function Choice({
  name,
  checked,
  onChange,
  title,
  detail,
  figure,
  label,
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: ReactNode
  detail?: ReactNode
  figure?: ReactNode
  /** The words a screen reader says, when the drawn row says it in pieces. */
  label?: string
}) {
  return (
    <Row>
      <input type="radio" name={name} checked={checked} onChange={onChange} aria-label={label} />
      <Dot aria-hidden />
      <Main>
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </Main>
      {figure !== undefined ? <Figure aria-hidden={label ? true : undefined}>{figure}</Figure> : <span />}
    </Row>
  )
}

export function Toggle({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
  children: ReactNode
}) {
  return (
    <Row>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <Box aria-hidden />
      <Main>
        <b>{children}</b>
      </Main>
      <span />
    </Row>
  )
}

export { Field, Root as OptionsRoot }

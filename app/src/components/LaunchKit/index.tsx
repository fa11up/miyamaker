/**
 * Creator-side building blocks shared by Launch, Drop Music and Manage, so the three windows read as one family:
 * labelled fields, file drop zones, segmented toggles, the money-split meter and the transaction step list.
 */
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { describeSplit } from '@/miyamints/split'
import { bevel, color, space, text } from '@/theme/tokens'

export const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${text.sm};
  color: ${color.ink};
  min-width: 0;
  input,
  textarea,
  select {
    width: 100%;
    min-width: 0;
    border: none;
    border-radius: 0;
    padding: 4px 6px;
    background: ${color.well};
    box-shadow: ${bevel.field};
    font-size: ${text.sm};
    color: ${color.ink};
    font-family: inherit;
  }
  input,
  select {
    height: 32px;
  }
  textarea {
    min-height: 72px;
    resize: vertical;
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
  input[aria-invalid='true'],
  textarea[aria-invalid='true'] {
    box-shadow: ${bevel.field}, inset 0 0 0 2px ${color.danger};
  }
  small {
    font-size: ${text.xs};
    line-height: 1.35;
    color: ${color.inkMuted};
  }
  .err {
    color: ${color.danger};
  }
  @media (max-width: 600px) {
    input,
    select {
      height: 44px;
      font-size: 16px;
    }
  }
`

export const Row2 = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: ${space[3]};
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ErrText = styled.small`
  && {
    color: ${color.danger};
  }
`

export function Err({ children, id }: { children?: ReactNode; id?: string }) {
  return children ? (
    <ErrText className="err" id={id} role="alert">
      {children}
    </ErrText>
  ) : null
}

export const DropZone = styled.div<{ $over?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${({ $over }) => ($over ? color.faceLight : color.well)};
  box-shadow: ${bevel.sunken};
  outline: 1px dashed ${({ $over }) => ($over ? color.accentDark : color.shadow)};
  outline-offset: -6px;
  min-height: 64px;
  font-size: ${text.sm};
  .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: ${color.inkMuted};
    font-size: ${text.xs};
  }
`

const TouchSwap = styled.span`
  .touch {
    display: none;
  }
  @media (hover: none) {
    .mouse {
      display: none;
    }
    .touch {
      display: inline;
    }
  }
`

/** "Drop a file here" means nothing on a touch screen, so those read as what the button beside them does. */
export function DropWords({ mouse, touch }: { mouse: string; touch: string }) {
  return (
    <TouchSwap>
      <span className="mouse">{mouse}</span>
      <span className="touch">{touch}</span>
    </TouchSwap>
  )
}

export const Thumb = styled.div<{ $size?: number }>`
  width: ${({ $size }) => $size || 56}px;
  height: ${({ $size }) => $size || 56}px;
  flex: 0 0 ${({ $size }) => $size || 56}px;
  background: ${color.dark};
  box-shadow: ${bevel.sunken};
  padding: 2px;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border: none;
    margin: 0;
    max-width: none;
  }
`

export const SmallButton = styled.button`
  border: none;
  border-radius: 0;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: 0 ${space[2]};
  min-height: 28px;
  font-size: ${text.xs};
  color: ${color.ink};
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) {
    background: ${color.faceLight};
  }
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
  @media (max-width: 600px) {
    min-height: 40px;
    font-size: ${text.sm};
  }
`

/** Toggle group: buttons with aria-pressed. */
export const Segmented = styled.div`
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.faceLight};
    font-weight: 700;
  }
`

/** `unknown`: it was sent, or its wallet prompt was open, when the window closed: only the chain can say how it ended. */
export type TxStepState = 'idle' | 'active' | 'done' | 'error' | 'skipped' | 'unknown'

export const STEP_DOT: Record<TxStepState, string> = {
  idle: color.shadow,
  active: '#e0a100',
  done: '#2fbf71',
  error: color.danger,
  skipped: color.light,
  unknown: '#e0a100',
}

const STEP_WORD: Record<TxStepState, string> = {
  idle: 'waiting',
  active: 'in progress',
  done: 'done',
  error: 'failed',
  skipped: 'skipped',
  unknown: 'not known yet',
}

export const StepList = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${text.xs};
  li {
    display: flex;
    gap: ${space[2]};
    align-items: center;
  }
  .dot {
    width: 10px;
    height: 10px;
    flex: 0 0 10px;
    box-shadow: inset -1px -1px rgba(0, 0, 0, 0.35);
  }
  .state {
    margin-left: auto;
    color: ${color.inkMuted};
  }
  a {
    color: ${color.link};
  }
`

/** Numbered progress for uploads and wallet transactions. The state is written out, not only coloured. */
export function TxSteps({
  steps,
  label,
}: {
  steps: { id: string; label: ReactNode; state: TxStepState; link?: string }[]
  label: string
}) {
  return (
    <StepList aria-label={label}>
      {steps.map((s) => (
        <li key={s.id}>
          <span className="dot" style={{ background: STEP_DOT[s.state] }} aria-hidden />
          <span>{s.label}</span>
          <span className="state">
            {s.link ? (
              <a href={s.link} target="_blank" rel="noreferrer">
                {STEP_WORD[s.state]} ↗
              </a>
            ) : (
              STEP_WORD[s.state]
            )}
          </span>
        </li>
      ))}
    </StepList>
  )
}

/**
 * Covers the window, not the page: rendered inside an app's scrolling layout so it takes that app's skin, and placed
 * against the window body because the layout itself has no position.
 */
export const CloseGuardScreen = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: ${space[3]};
  background: rgba(2, 8, 20, 0.55);
`

export const CloseGuardBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  width: min(380px, 100%);
  padding: ${space[4]};
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  font-size: ${text.sm};
  line-height: 1.4;
  h2 {
    margin: 0;
    font-size: ${text.md};
  }
  p {
    margin: 0;
  }
  .choices {
    display: flex;
    gap: ${space[2]};
    justify-content: flex-end;
    flex-wrap: wrap;
  }
`

/**
 * The window's X, with a question first when closing would lose a draft or walk away from a wallet that is mid-step.
 * Spread `dialog` inside the app's layout and call `ask` from the title bar.
 */
export function useCloseGuard({ draft, running, close }: { draft: boolean; running: boolean; close: () => void }) {
  const [asking, setAsking] = useState(false)
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (asking) keep.current?.focus()
  }, [asking])

  const ask = () => {
    if (draft || running) setAsking(true)
    else close()
  }

  const dialog = asking ? (
    <CloseGuardScreen
      onKeyDown={(e) => {
        if (e.key === 'Escape') setAsking(false)
        // Only two buttons, so Tab just moves between them and stays inside.
        if (e.key === 'Tab') {
          const buttons = Array.from(e.currentTarget.querySelectorAll('button'))
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
          e.preventDefault()
          buttons[(at + 1) % buttons.length]?.focus()
        }
      }}
    >
      <CloseGuardBox role="alertdialog" aria-modal="true" aria-labelledby="close-guard-title">
        <h2 id="close-guard-title">{running ? 'Close while your wallet is working?' : 'Close and lose this draft?'}</h2>
        <p>
          {running
            ? 'Your wallet is still working. Closing now can leave this unfinished.'
            : 'What you filled in here is not saved anywhere yet.'}
        </p>
        <div className="choices">
          <SmallButton type="button" onClick={close}>
            Close
          </SmallButton>
          <SmallButton ref={keep} type="button" className="keep" onClick={() => setAsking(false)}>
            Keep working
          </SmallButton>
        </div>
      </CloseGuardBox>
    </CloseGuardScreen>
  ) : null

  return { ask, dialog }
}

const Bar = styled.div`
  display: flex;
  height: 18px;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  padding: 2px;
  gap: 2px;
  span {
    display: block;
    height: 100%;
    min-width: 3px;
    transition: flex-grow 200ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    span {
      transition: none;
    }
  }
`

const Legend = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: ${text.sm};
  li {
    display: grid;
    grid-template-columns: 12px 64px minmax(0, 1fr);
    gap: ${space[2]};
    align-items: baseline;
  }
  i {
    width: 10px;
    height: 10px;
    display: inline-block;
    box-shadow: inset -1px -1px rgba(0, 0, 0, 0.35);
  }
  b {
    font-variant-numeric: tabular-nums;
  }
`

const SPLIT_COLOR = { artist: color.accent, vault: color.inkMuted, protocol: color.shadow } as const

/**
 * Where the money goes, live: a three-part bar plus the shares in plain words (you / the vault / miya),
 * and a one-line example for 1 ETH.
 */
export function SplitMeter({
  protocolBps,
  alignmentBps,
  vaultName,
  compact,
}: {
  protocolBps: number
  alignmentBps: number
  vaultName?: string
  compact?: boolean
}) {
  const d = describeSplit({ protocolBps, alignmentBps, vaultName })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }} aria-live="polite">
      <Bar aria-hidden>
        {d.parts.map((p) => (
          <span key={p.key} style={{ flexGrow: Math.max(p.bps, 1), background: SPLIT_COLOR[p.key] }} />
        ))}
      </Bar>
      <Legend>
        {d.parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: SPLIT_COLOR[p.key] }} />
            <b>{p.pct}</b>
            <span>{p.words}</span>
          </li>
        ))}
      </Legend>
      {!compact && <small style={{ color: color.inkMuted, fontSize: text.xs }}>{d.sentence}</small>}
    </div>
  )
}

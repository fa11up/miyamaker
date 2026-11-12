import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components/macro'

import { useHandheld } from './nav'
import type { LampTone } from './status'
import { stepQuantity } from './status'
import { PAINTED } from './Carousel'
import Device, { Dialog, LCD_FONT, Lcd } from './Device'
import Holo from './Holo'

const scan = keyframes`
  from { transform: translateY(-20%); }
  to { transform: translateY(120%); }
`
/** The mint's moment: a bright line passes down the art. */
const Scan = styled.div`
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
  @media (prefers-reduced-motion: no-preference) {
    ${css`
      background: linear-gradient(
        180deg,
        transparent 0 44%,
        rgba(200, 235, 255, 0.14) 49%,
        rgba(235, 248, 255, 0.34) 50%,
        rgba(200, 235, 255, 0.14) 51%,
        transparent 56%
      );
      animation: ${scan} 1s linear 2 both;
    `}
  }
`

const Tag = styled.span`
  position: absolute;
  z-index: 1;
  left: 8px;
  top: 8px;
  /* A long caption (community notice and the sale) wraps instead of running over the art's edge. */
  max-width: calc(100% - 16px);
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(12, 10, 24, 0.8);
  color: #fff;
  font-size: 13px;
`

const Notice = styled.p`
  && {
    margin: 0;
    padding: 6px 9px;
    border: 1px solid #ffd27a;
    border-radius: 4px;
    background: rgba(60, 40, 0, 0.55);
    color: #ffe2a6;
    font-size: 14px;
  }
`

const Info = styled.div`
  position: absolute;
  z-index: 3;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  background: linear-gradient(rgba(14, 8, 34, 0.72), rgba(14, 8, 34, 0.72)), ${PAINTED};
  color: #f1eeff;
  font-size: 15px;
  line-height: 1.35;
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.15;
  }
  p {
    margin: 0;
  }
  a {
    color: #9fe8ff;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    margin: 0;
  }
  dt {
    color: #bdb9d0;
  }
  dd {
    margin: 0;
    text-align: right;
    font-family: ${LCD_FONT};
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  /* Low weight, so a themed field (handheld/Options) can dress itself. */
  :where(input:not([type='checkbox']):not([type='radio'])) {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: none;
    border-radius: 2px;
    font-size: 16px;
  }
  ol {
    margin: 4px 0 0;
    padding-left: 1.3em;
  }
`

const HoloButton = styled.button`
  align-self: flex-start;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(190, 240, 255, 0.85);
  border-radius: 5px;
  cursor: pointer;
  font-size: 15px;
  color: #e4f8ff;
  background: rgba(8, 24, 52, 0.85);
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
`

const LAMP: Record<LampTone, string> = { ok: '#3dff7a', warn: '#ffc400', off: '#79808a' }

export type MachineStatus = { tone: 'info' | 'ok' | 'error'; body: ReactNode; alert?: boolean }

/**
 * One collection on the handheld: the art fills the screen, ▲▼ picks how many and A does whatever `action` says. Words and
 * sums come from the view using it, which owns the contract calls; this only draws them.
 */
export default function MintCart({
  name,
  artist,
  lamps,
  onBack,
  art,
  caption,
  blurb,
  price,
  loading,
  minted,
  supply,
  left,
  notes,
  notice,
  quantity,
  maxQty,
  busy,
  stay,
  onQuantity,
  extras,
  total,
  balance,
  action,
  status,
  needs,
  dropped,
  stamp,
  onArtStep,
  children,
}: {
  name: string
  artist?: ReactNode
  lamps: { tone: LampTone; label: string }[]
  onBack?: () => void
  art: ReactNode
  caption?: ReactNode
  blurb?: ReactNode
  /** Already in words: "0.4444 ETH". */
  price: string
  loading?: boolean
  minted?: number
  supply?: number
  left?: number
  notes?: ReactNode
  /** Shown first on the Info screen, in a box: e.g. that a community mint is not made by miyamaker. */
  notice?: ReactNode
  quantity: number
  maxQty: number
  busy: boolean
  /** Not in flight, but its ending is unknown: the screen stays until someone starts over. */
  stay?: boolean
  onQuantity: (n: number) => void
  extras?: ReactNode
  total: string
  balance?: string
  action: { label: string; disabled: boolean; onClick: () => void }
  status?: MachineStatus
  needs?: ReactNode
  /** Said over the art once a mint has confirmed. */
  dropped?: ReactNode
  stamp: ReactNode
  /** Moves the art to the piece before or after this one, for the holographic viewer. */
  onArtStep?: (step: number) => void
  children?: ReactNode
}) {
  const nav = useHandheld()
  const holding = busy || !!stay
  useEffect(() => (holding ? nav.hold?.() : undefined), [holding])
  const [info, setInfo] = useState(false)
  const [holo, setHolo] = useState(false)
  const landed = !!dropped
  const scanned = useRef(false)
  const [scanning, setScanning] = useState(false)
  useEffect(() => {
    if (!landed || scanned.current) return undefined
    scanned.current = true
    setScanning(true)
    const t = setTimeout(() => setScanning(false), 2100)
    return () => clearTimeout(t)
  }, [landed])
  useEffect(() => {
    if (landed) return
    scanned.current = false
    // Its timer went with it, and nothing else would take the scan down.
    setScanning(false)
  }, [landed])

  const main = lamps[0]
  const canStep = !busy && !info
  const infoEl = useRef<HTMLDivElement>(null)
  const scrollInfo = (by: number) => () => infoEl.current?.scrollBy({ top: by, behavior: 'smooth' })
  const up = canStep && quantity < maxQty ? () => onQuantity(stepQuantity(quantity, 1, maxQty)) : undefined
  const down = canStep && quantity > 1 ? () => onQuantity(stepQuantity(quantity, -1, maxQty)) : undefined
  const back = onBack ?? nav.openMenu

  return (
    <Device
      title={name}
      lamp={{ color: LAMP[main?.tone ?? 'off'], label: main?.label ?? '' }}
      screen={
        <>
          <button
            type="button"
            aria-label={`See ${name} as a hologram`}
            style={{
              all: 'unset',
              display: 'block',
              width: '100%',
              height: '100%',
              cursor: 'zoom-in',
              pointerEvents: 'auto',
            }}
            onClick={() => setHolo(true)}
          >
            {art}
          </button>
          {caption && <Tag>{caption}</Tag>}
          {scanning && <Scan aria-hidden />}
          {status ? (
            <Dialog $tone={status.tone} role={status.alert ? 'alert' : 'status'}>
              {status.body}
            </Dialog>
          ) : (
            dropped && (
              <Dialog $tone="ok" role="status">
                {dropped}
              </Dialog>
            )
          )}
          {holo && <Holo art={art} name={name} detail={caption} onStep={onArtStep} onClose={() => setHolo(false)} />}
          {info && (
            <Info ref={infoEl} className="scroll" aria-label={`About ${name}`}>
              <div>
                <h2>{name}</h2>
                {artist}
              </div>
              {notice && <Notice role="note">{notice}</Notice>}
              {blurb && <p>{blurb}</p>}
              <HoloButton
                type="button"
                onClick={() => {
                  setInfo(false)
                  setHolo(true)
                }}
              >
                ◈ View as hologram
              </HoloButton>
              <dl>
                {minted !== undefined && supply !== undefined && (
                  <>
                    <dt>Minted</dt>
                    <dd>
                      {minted.toLocaleString()} / {supply.toLocaleString()}
                    </dd>
                  </>
                )}
                <dt>Price each</dt>
                <dd>{price}</dd>
                <dt>Your total</dt>
                <dd>{total}</dd>
                {balance && (
                  <>
                    <dt>In your wallet</dt>
                    <dd>{balance}</dd>
                  </>
                )}
              </dl>
              {notes && <p>{notes}</p>}
              {extras}
              {needs}
              {children}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px' }}>
                {stamp}
              </div>
            </Info>
          )}
        </>
      }
      lcd={
        <Lcd>
          <div>
            <span>{name}</span>
            <span>
              {lamps[1] ? `${lamps[1].label} · ` : ''}
              {loading ? 'READING…' : `${left?.toLocaleString() ?? '–'} LEFT`}
            </span>
          </div>
          <div>
            <span>{info ? '▲▼ Scroll' : `▲▼ HOW MANY ${quantity}`}</span>
            <span>{loading ? '' : total}</span>
          </div>
          <div>
            <span>Ⓐ {action.label}</span>
          </div>
        </Lcd>
      }
      a={action}
      b={
        info
          ? { label: 'Close info', onClick: () => setInfo(false) }
          : { label: 'Menu', disabled: holding, onClick: back }
      }
      start={{ label: info ? 'Close info' : 'Info', onClick: () => setInfo((v) => !v) }}
      dpad={info ? { up: scrollInfo(-90), down: scrollInfo(90) } : { up, down }}
    />
  )
}

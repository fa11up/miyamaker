import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import logoSrc from 'assets/134321870.png'
import styled, { css, keyframes } from 'styled-components/macro'

import { useWindows } from '@/store/windows/hooks'

import { rightEdge } from './look'
import { useBody3D, useHandheld } from './nav'
import type { Part, Rect } from './scene'
import { useDeviceFit } from './Stage'

/** Mint's skin: a see-through handheld from the late 90s. The art fills the screen, and the D-pad moves between collections. */
const TECH = `'W95FA', 'IBM Plex Sans', Arial, sans-serif`
export const LCD_FONT = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`

const BOARD = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Crect width='180' height='180' fill='%231e6b4a'/%3E%3Cg fill='none' stroke='%23d9b95c' stroke-width='2'%3E%3Cpath d='M0 30h52l18 18h60l20-20h30M0 92h26l14 14v44l16 16h30M180 70h-40l-14 14v38l-22 22h-20M64 0v22l-16 16v30M120 180v-20l14-14h46M30 180v-16'/%3E%3C/g%3E%3Cg fill='%23d9b95c'%3E%3Ccircle cx='52' cy='30' r='4'/%3E%3Ccircle cx='130' cy='48' r='4'/%3E%3Ccircle cx='40' cy='106' r='4'/%3E%3Ccircle cx='126' cy='122' r='4'/%3E%3Ccircle cx='86' cy='166' r='4'/%3E%3C/g%3E%3Crect x='68' y='68' width='44' height='34' rx='2' fill='%2312161b'/%3E%3Cg fill='%23aeb6c0'%3E%3Crect x='62' y='72' width='6' height='3'/%3E%3Crect x='62' y='80' width='6' height='3'/%3E%3Crect x='62' y='88' width='6' height='3'/%3E%3Crect x='62' y='96' width='6' height='3'/%3E%3Crect x='112' y='72' width='6' height='3'/%3E%3Crect x='112' y='80' width='6' height='3'/%3E%3Crect x='112' y='88' width='6' height='3'/%3E%3Crect x='112' y='96' width='6' height='3'/%3E%3C/g%3E%3C/svg%3E")`

const moving = (rules: ReturnType<typeof css>) => css`
  @media (prefers-reduced-motion: no-preference) {
    ${rules}
  }
`

const Root = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--print);
  font-family: ${TECH};
  &:focus {
    outline: none;
  }
  /* Anything that is not a control or a scrolling screen lets the press through to the shell, so it can be carried by
     any bare part of the body. The site's global styles turn presses back on for plain boxes, so this has to be explicit. */
  & * {
    pointer-events: none;
  }
  & button,
  & a,
  & input,
  & select,
  & textarea,
  & label,
  & .part,
  & .scroll,
  & .scroll * {
    pointer-events: auto;
  }
  /* No scrollbars on any screen: what is too long moves with ▲▼, a wheel or a finger. */
  .scroll {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }
  /* The model draws the body and controls; these stay on top to take presses and show keyboard focus. */
  &[data-three] .part {
    background: none !important;
    box-shadow: none !important;
  }
  &[data-three] [data-part] {
    background: none !important;
    box-shadow: none !important;
    color: transparent !important;
    filter: none !important;
    transform: none !important;
  }
  &[data-three] [data-pad] {
    filter: none;
  }
  &[data-three] .flat {
    visibility: hidden;
  }
  &[data-three] [data-bezel] {
    background: none;
    box-shadow: none;
  }
  &[data-three] [data-power] {
    background: none;
    box-shadow: none;
  }
`

/** Tinted clear plastic, with the board showing through. The body's outline comes from data-shape on the root. */
const Shell = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  .part {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    background:
      linear-gradient(
        118deg,
        rgba(255, 255, 255, 0.4) 0%,
        rgba(255, 255, 255, 0.07) 20%,
        transparent 21%,
        transparent 68%,
        rgba(255, 255, 255, 0.11) 69%,
        transparent 80%
      ),
      linear-gradient(160deg, var(--light), var(--deep)),
      ${BOARD} 0 0 / 180px 180px;
  }
`

const Face = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  align-content: start;
  padding: 18px var(--side) 0;
  grid-template: 'brow brow' 26px 'bezel bezel' auto 'pad btns' 124px / 1fr 1fr;
  pointer-events: none;
  button,
  a,
  input,
  label,
  .scroll {
    pointer-events: auto;
  }
`

const Brow = styled.div`
  position: relative;
  grid-area: brow;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  img {
    width: 28px;
    height: 28px;
    margin: -7px 0 0;
    border: none;
    border-radius: 50%;
    background: #fff;
    /* Without the 3D model: a raised, printed badge. */
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.35),
      0 1px 0 1px rgba(255, 255, 255, 0.45),
      0 2px 3px rgba(0, 0, 0, 0.5);
  }
  .led {
    position: absolute;
    left: 34px;
    top: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
`

const Bezel = styled.div`
  grid-area: bezel;
  align-self: start;
  padding: 10px 10px 10px;
  border-radius: 12px;
  background: linear-gradient(180deg, #2a2a33, #111116);
  box-shadow:
    inset 0 2px 5px #000,
    0 0 0 1px rgba(255, 255, 255, 0.2);
`

const Screen = styled.div`
  position: relative;
  width: 360px;
  height: 360px;
  overflow: hidden;
  background: #000;
  & > img,
  & > button:first-child img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    border: none;
    object-fit: cover;
  }
`

/** The little readout under the art. */
export const Lcd = styled.div`
  height: 58px;
  margin-top: 5px;
  padding: 3px 7px;
  overflow: hidden;
  border-radius: 2px;
  background: #a9bd97;
  color: #1f2b1b;
  font-family: ${LCD_FONT};
  font-size: 14px;
  font-weight: 700;
  line-height: 17px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.45);
  > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    white-space: nowrap;
  }
  > div > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const PadArea = styled.div`
  grid-area: pad;
  display: flex;
  align-items: center;
  justify-content: flex-start;
`
const BtnArea = styled.div`
  grid-area: btns;
  display: flex;
  align-items: center;
  justify-content: flex-end;
`
const Buttons = styled.div`
  position: relative;
  width: 140px;
  height: 116px;
`

const Pad = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 38px);
  grid-template-rows: repeat(3, 38px);
  filter: drop-shadow(0 4px 0 var(--edge));
  i {
    grid-area: 2 / 2;
    background: #1b1b22;
  }
  button {
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 14px;
    color: #d6d3e2;
    background: linear-gradient(180deg, #33333d, #1b1b22);
  }
  button:not(:disabled):hover {
    color: #fff;
  }
  button:not(:disabled):active {
    background: #101015;
    transform: translateY(2px);
  }
  button:disabled {
    cursor: default;
    color: #5d5a69;
  }
  button:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: -3px;
  }
  .up {
    grid-area: 1 / 2;
    border-radius: 5px 5px 0 0;
  }
  .left {
    grid-area: 2 / 1;
    border-radius: 5px 0 0 5px;
  }
  .right {
    grid-area: 2 / 3;
    border-radius: 0 5px 5px 0;
  }
  .down {
    grid-area: 3 / 2;
    border-radius: 0 0 5px 5px;
  }
`

const Round = styled.button`
  position: absolute;
  width: 56px;
  height: 56px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 20px;
  font-weight: 700;
  box-shadow:
    0 0 0 2px var(--edge),
    0 5px 0 2px var(--edge);
  &:active:not(:disabled) {
    transform: translateY(4px);
    box-shadow:
      0 0 0 2px var(--edge),
      0 1px 0 2px var(--edge);
  }
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 4px;
  }
  &:disabled {
    cursor: not-allowed;
    color: #3e3b47;
    background: radial-gradient(circle at 38% 26%, #9b98a6, #68656f 75%);
  }
`
const A = styled(Round)`
  right: 6px;
  top: 2px;
  color: #2b1400;
  background: radial-gradient(circle at 38% 24%, #ffd6ad, #ff8a1f 58%, #cf6400);
`
const B = styled(Round)`
  right: 76px;
  top: 30px;
  color: #fff;
  background: radial-gradient(circle at 38% 24%, #77747f, #3b3944 62%, #1d1c23);
`

/* Centred without a transform: the model takes these positions from offsetLeft, which can't see one. */
const Pills = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 632px;
  display: flex;
  justify-content: center;
  gap: 14px;
  /* As wide as the button whatever the label: a label that grows as the font loads would move the buttons, and rebuild
     the model. */
  > div {
    width: 48px;
  }
  button {
    display: block;
    width: 48px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    background: linear-gradient(180deg, #55525f, #27252e);
    box-shadow: 0 0 0 1px var(--edge);
    position: relative;
  }
  button::after {
    content: '';
    position: absolute;
    inset: -14px -3px;
  }
  button:active {
    background: #17151c;
  }
  button:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
  span {
    display: block;
    margin: 5px -12px 0;
    text-align: center;
    font-size: 11px;
    font-style: italic;
    letter-spacing: 0.12em;
    color: rgba(0, 0, 0, 0.65);
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
  }
`

const Speaker = styled.div`
  position: absolute;
  left: 50%;
  top: 636px;
  margin-left: 92px;
  width: 40px;
  height: 16px;
  background: repeating-linear-gradient(90deg, var(--edge) 0 4px, transparent 4px 9px);
  opacity: 0.75;
`

/** What B does, in the corner of the readout. */
const BHint = styled.span`
  position: absolute;
  right: 7px;
  bottom: 3px;
  color: #1f2b1b;
  font-family: ${LCD_FONT};
  font-size: 13px;
  font-weight: 700;
  line-height: 17px;
`
const collapse = keyframes`
  0% { transform: scale(1, 0); opacity: 0; }
  1% { transform: scale(1, 1); opacity: 0; }
  60% { transform: scale(1, 0.008); opacity: 1; background: #fff; }
  100% { transform: scale(0, 0.008); opacity: 1; background: #fff; }
`
/** Off: the picture pulls in to a line and goes out, on an old screen's way. */
const PowerDown = styled.div`
  position: absolute;
  z-index: 9;
  inset: 0;
  background: #000;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: #fff;
    animation: ${collapse} 0.42s ease-in both;
  }
`

const SideTrack = styled.div`
  position: absolute;
  z-index: 2;
  width: 9px;
  border-radius: 0 3px 3px 0;
  background: #14121a;
  box-shadow: 0 0 0 1px var(--edge);
`

/** The sliding power switch, down for off. */
const PowerTrack = styled(SideTrack)`
  top: 214px;
  height: 58px;
  pointer-events: auto;
  button {
    position: absolute;
    left: -2px;
    top: 3px;
    width: 12px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    background: repeating-linear-gradient(0deg, #6f6c79 0 2px, #2c2a33 2px 4px);
    box-shadow: 0 0 0 1px #000;
    transition: transform 0.2s cubic-bezier(0.5, 0, 0.2, 1);
    &::after {
      content: '';
      position: absolute;
      inset: -18px -8px -18px -22px;
    }
    &:focus-visible {
      outline: 2px dashed #fff35c;
      outline-offset: 3px;
    }
  }
  &.off button {
    transform: translateY(28px);
  }
`
const SaveKey = styled.button`
  position: absolute;
  z-index: 2;
  top: 150px;
  width: 11px;
  height: 46px;
  padding: 0;
  border: none;
  border-radius: 0 4px 4px 0;
  pointer-events: auto;
  cursor: pointer;
  background: linear-gradient(90deg, #2c2a33, #6f6c79 70%, #3b3944);
  box-shadow: 0 0 0 1px var(--edge);
  transition: transform 0.12s ease-out;
  &.in {
    transform: translateX(-6px);
  }
  &::after {
    content: '';
    position: absolute;
    inset: -8px -8px -8px -22px;
  }
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 3px;
  }
`
/** Over the art: small, plain, and gone when not needed. */
export const Dialog = styled.div<{ $tone?: 'info' | 'ok' | 'error' }>`
  position: absolute;
  z-index: 2;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 7px 10px;
  border-radius: 4px;
  background: rgba(12, 10, 24, 0.93);
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 4px #14101f;
  font-size: 15px;
  line-height: 1.3;
  color: ${({ $tone }) => ({ info: '#fff', ok: '#8dffb0', error: '#ffb3ac' })[$tone ?? 'info']};
  a {
    color: #9fe8ff;
  }
  strong {
    display: block;
    font-size: 17px;
  }
`

export type DeviceAction = { label: string; disabled?: boolean; onClick: () => void }
export type DeviceDpad = { up?: () => void; down?: () => void; left?: () => void; right?: () => void }

/**
 * The handheld itself. It knows nothing about contracts: the view using it says what goes on the screen and readout and
 * what each control does. Drags by its plastic, like the radio by its chrome.
 */
export default function Device({
  title,
  lamp,
  screen,
  lcd,
  a,
  b,
  start,
  select,
  poweringOn,
  dpad,
}: {
  /** Swapping it restarts the screen's flicker, as if the device had changed collection. */
  title: string
  /** The power LED on the shell: its colour, and what that means for screen readers. */
  lamp: { color: string; label: string }
  screen: ReactNode
  lcd: ReactNode
  a: DeviceAction
  b: DeviceAction
  start?: DeviceAction
  /** Defaults to opening the current game's start menu. */
  select?: DeviceAction
  /** The switch slides up as this one appears: only the opening scene sets it. */
  poweringOn?: boolean
  dpad?: DeviceDpad
}) {
  const nav = useHandheld()
  const { shape, tint } = useDeviceFit()
  const body = useBody3D()

  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [])

  // The switch: up is on. Sliding it down plays the picture out, then the window closes.
  const [switchOff, setSwitchOff] = useState(!!poweringOn)
  const [goingOff, setGoingOff] = useState(false)
  useEffect(() => {
    if (!poweringOn) return undefined
    body.setHold(true)
    return () => body.setHold(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poweringOn])
  useEffect(() => {
    if (!poweringOn) return undefined
    const t = setTimeout(() => setSwitchOff(false), 60)
    return () => clearTimeout(t)
  }, [poweringOn])
  const powerOff = () => {
    if (goingOff || nav.held) return
    setSwitchOff(true)
    setGoingOff(true)
    setTimeout(nav.close, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 620)
  }

  // Save: the button stays in while the device is put away, and everything stays as it was, because a minimized window
  // keeps running. It pops back out on return, and the bezel says so.
  const [, , , minimized] = useWindows()
  const saved = minimized.includes('mint')
  const [pressing, setPressing] = useState(false)
  const [resumed, setResumed] = useState(false)
  const wasSaved = useRef(saved)
  useEffect(() => {
    if (wasSaved.current && !saved) {
      setPressing(false)
      // Only the Save button saves. Put away from the taskbar, it was only minimized.
      if (!pressing) {
        wasSaved.current = saved
        return undefined
      }
      setResumed(true)
      const t = setTimeout(() => setResumed(false), 2200)
      wasSaved.current = saved
      return () => clearTimeout(t)
    }
    wasSaved.current = saved
    return undefined
  }, [saved])
  const save = () => {
    setPressing(true)
    setTimeout(nav.minimize, 180)
  }

  // While the picture plays out, the buttons are off: nothing may start with the window about to close.
  const left = goingOff ? undefined : dpad?.left ?? (nav.swap ? () => nav.swap!(-1) : undefined)
  const right = goingOff ? undefined : dpad?.right ?? (nav.swap ? () => nav.swap!(1) : undefined)

  // Tell the model where the controls are laid out, and when they go down.
  useLayoutEffect(() => {
    const el = root.current
    // Inside a minimized window everything measures 0 by 0: not a layout, and building from it only means building twice.
    if (!el || saved || !el.offsetWidth || !el.offsetHeight) return
    const rect = (q: string): Rect | undefined => {
      const n = el.querySelector<HTMLElement>(q)
      if (!n) return undefined
      let x = 0
      let y = 0
      let at: HTMLElement | null = n
      while (at && at !== el) {
        x += at.offsetLeft
        y += at.offsetTop
        at = at.offsetParent as HTMLElement | null
      }
      return { x, y, w: n.offsetWidth, h: n.offsetHeight }
    }
    body.report({
      w: shape.w,
      h: shape.h,
      bezel: rect('[data-bezel]'),
      pad: rect('[data-pad]'),
      a: rect('[data-part=a]'),
      b: rect('[data-part=b]'),
      select: rect('[data-part=select]'),
      start: rect('[data-part=start]'),
      save: rect('[data-part=save]'),
      power: rect('[data-power]'),
      brand: rect('[data-brand]'),
    })
  })
  useEffect(() => body.setSwitch(switchOff), [body, switchOff])
  useEffect(() => body.setSave(pressing || saved), [body, pressing, saved])
  const held = useRef<Part[]>([])
  const releaseAll = () => {
    held.current.forEach((p) => body.press(p, false))
    held.current = []
  }
  const pressPart = (e: ReactPointerEvent<HTMLDivElement>, down: boolean) => {
    if (!down) {
      releaseAll()
      return
    }
    const part = (e.target as HTMLElement).closest<HTMLElement>('[data-part]')?.dataset.part as Part | undefined
    if (part) {
      body.press(part, true)
      held.current.push(part)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (goingOff || (e.target as HTMLElement).closest('input, textarea, select, button, a')) return
    const key: Record<string, (() => void) | undefined> = {
      ArrowUp: dpad?.up,
      ArrowDown: dpad?.down,
      ArrowLeft: left,
      ArrowRight: right,
      Enter: a.disabled ? undefined : a.onClick,
      Escape: b.disabled ? undefined : b.onClick,
      ' ': start?.disabled ? undefined : start?.onClick,
      Shift: select ? select.onClick : nav.openMenu,
    }
    const run = key[e.key]
    if (run) {
      e.preventDefault()
      run()
    }
  }

  const vars = {
    '--light': tint.light,
    '--deep': tint.deep,
    '--edge': tint.edge,
    '--print': tint.ink,
    '--side': `${shape.pad}px`,
  } as CSSProperties

  return (
    <Root
      ref={root}
      tabIndex={-1}
      style={vars}
      data-shape={shape.id}
      data-three={body.ready ? '' : undefined}
      onPointerDown={(e) => pressPart(e, true)}
      onPointerUp={(e) => pressPart(e, false)}
      onPointerLeave={releaseAll}
      onKeyDown={onKeyDown}
      data-testid="mint-device"
      aria-label="Mint handheld. Left and right change collection, up and down change how many, Enter is A, Escape is B."
    >
      <Shell>
        <div className="part main title-bar" style={{ clipPath: `path('${shape.path}')` }} />
      </Shell>
      <Face>
        <Brow>
          <i
            className="led"
            role="img"
            aria-label={lamp.label}
            style={
              goingOff ? { background: '#2a2830' } : { background: lamp.color, boxShadow: `0 0 6px ${lamp.color}` }
            }
          />
          <img className="flat" data-brand src={logoSrc} alt="" />
        </Brow>
        <Bezel data-bezel>
          <Screen key={title}>
            {screen}
            {resumed && (
              <Dialog $tone="ok" role="status">
                Saved state restored
              </Dialog>
            )}
            {goingOff && <PowerDown aria-hidden />}
          </Screen>
          <div style={{ position: 'relative' }}>
            {lcd}
            {!b.disabled && <BHint aria-hidden>Ⓑ {b.label}</BHint>}
          </div>
        </Bezel>
        <PadArea>
          <Pad data-pad role="group" aria-label="Direction pad">
            <button type="button" data-part="up" className="up" aria-label="Up" disabled={!dpad?.up} onClick={dpad?.up}>
              ▲
            </button>
            <button
              type="button"
              data-part="left"
              className="left"
              aria-label="Previous"
              disabled={!left}
              onClick={left}
            >
              ◀
            </button>
            <i className="flat" />
            <button
              type="button"
              data-part="right"
              className="right"
              aria-label="Next"
              disabled={!right}
              onClick={right}
            >
              ▶
            </button>
            <button
              type="button"
              data-part="down"
              className="down"
              aria-label="Down"
              disabled={!dpad?.down}
              onClick={dpad?.down}
            >
              ▼
            </button>
          </Pad>
        </PadArea>
        <BtnArea>
          <Buttons>
            <B
              type="button"
              data-part="b"
              aria-label={b.label}
              title={b.label}
              disabled={b.disabled || goingOff}
              onClick={b.onClick}
            >
              B
            </B>
            <A
              type="button"
              data-part="a"
              aria-label={a.label}
              title={a.label}
              disabled={a.disabled || goingOff}
              onClick={a.onClick}
            >
              A
            </A>
          </Buttons>
        </BtnArea>
      </Face>
      <SaveKey
        style={{ left: rightEdge(shape.path, 173) - 2 }}
        type="button"
        data-part="save"
        className={pressing || saved ? 'in' : undefined}
        aria-label="Save and put away"
        title="Save: put the device away just as it is"
        disabled={goingOff}
        onClick={save}
      />
      <PowerTrack style={{ left: rightEdge(shape.path, 243) - 2 }} className={switchOff ? 'off' : undefined} data-power>
        <button
          type="button"
          data-part="power"
          aria-label="Power off"
          title="Power off"
          disabled={goingOff || nav.held}
          onClick={powerOff}
        />
      </PowerTrack>
      <Pills>
        <div>
          <button
            type="button"
            data-part="select"
            aria-label={select?.label ?? 'Main menu'}
            style={{ pointerEvents: 'auto' }}
            disabled={select?.disabled || goingOff || (!select && nav.held)}
            onClick={select ? select.onClick : nav.openMenu}
          />
          <span className="flat">SELECT</span>
        </div>
        <div>
          <button
            type="button"
            data-part="start"
            aria-label={start?.label ?? 'Info'}
            style={{ pointerEvents: 'auto' }}
            disabled={!start || start.disabled}
            onClick={start?.onClick}
          />
          <span className="flat">START</span>
        </div>
      </Pills>
      <Speaker className="flat" aria-hidden />
    </Root>
  )
}

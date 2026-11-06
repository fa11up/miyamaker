import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { font, space, text } from '@/theme/tokens'

import { CHANNELS, CHAT_DEFAULT, clampChat, indexOfNumber, nativeChatFor, stepChannel, watchUrl } from './channels'
import ChatPanel from './chat/ChatPanel'
import Screen from './Screen'
import goldSkin from './skin/gold.webp'
import woodSkin from './skin/wood.webp'
import Static, { useReducedMotion } from './Static'

const page = Pages.tv

/* ---------- layout ---------- */

const CREAM = 'linear-gradient(180deg, #f8efd9 0%, #dccfae 100%)'
const INK = '#2a1a0e'

/** miyatv's skin: tiled walnut and gold bitmaps (scripts/make-tv-skin.py), the screen in the middle, chat beside it. */
const Root = styled.div`
  position: relative;
  height: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8px var(--chat-w);
  grid-template-rows: minmax(0, 1fr);
  padding: ${space[2]};
  overflow: hidden;
  border-radius: 0 0 16px 16px;
  color: #f3e7cf;
  background: url(${woodSkin}) 0 0 / 512px 512px;
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.75), inset 0 0 0 1px rgba(20, 10, 2, 0.8);
  &:focus {
    outline: none;
  }

  /* Third-party frames would swallow the pointer while chat is being dragged. */
  &.dragging iframe {
    pointer-events: none;
  }

  /* No chat: the screen fills the cabinet. */
  &.no-chat {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Phones / narrow windows: one column, player first, then chat. */
  &.narrow {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    padding: ${space[1]};
    gap: ${space[1]};
    border-radius: 0;
  }
`

const TvColumn = styled.div`
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  .narrow & {
    overflow: visible;
    flex: 0 0 auto;
  }
`

/** The set itself: the picture in its gold trim, the gold control plate, the speaker below. */
const Bezel = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  .narrow & {
    flex: 0 0 auto;
    gap: 6px;
  }
`
/** With chat hidden: whatever room the set has, and the glass is the biggest 16:9 that fits in it. */
const Stage = styled.div`
  .no-chat:not(.narrow) & {
    flex: 1 1 auto;
    min-height: 0;
    container-type: size;
    display: grid;
    place-items: center;
  }
`

/** Gold moulding round the picture. Its width is what sizes the glass inside. */
const Trim = styled.div`
  padding: 6px;
  border-radius: 30px / 24px;
  background: url(${goldSkin}) 0 0 / 256px 256px;
  box-shadow: 0 0 0 1px #2a1a04, inset 0 1px 0 rgba(255, 250, 220, 0.8), inset 0 -1px 0 rgba(60, 36, 4, 0.8),
    0 4px 9px rgba(0, 0, 0, 0.65);
  .no-chat:not(.narrow) & {
    width: min(100cqw, calc((100cqh - 12px) * 16 / 9 + 12px));
  }
  .narrow & {
    padding: 4px;
    border-radius: 14px;
  }
`

const Glass = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 24px / 18px;
  background: #000;
  box-shadow: 0 0 0 1px #2a1a04;
  .narrow & {
    border-radius: 10px;
  }
`
const Osd = styled.div`
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 4;
  pointer-events: none;
  font-family: ${font.mono};
  font-size: 22px;
  font-weight: 700;
  color: #ffb347;
  text-shadow: 0 0 6px rgba(255, 179, 71, 0.8), 2px 2px 0 #000;
  .narrow & {
    font-size: 16px;
  }
`

/** Gold plate with cream buttons and a little amber dial window. */
const Controls = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: 6px 10px;
  min-width: 0;
  border-radius: 9px;
  background: url(${goldSkin}) 0 -90px / 256px 256px;
  box-shadow: 0 0 0 1px #2a1a04, inset 0 1px 0 rgba(255, 250, 220, 0.85), inset 0 -1px 0 rgba(60, 36, 4, 0.8),
    0 3px 6px rgba(0, 0, 0, 0.6);
  color: ${INK};
  .narrow & {
    padding: 4px 6px;
    gap: ${space[1]};
    flex-wrap: wrap;
  }

  .dial {
    display: flex;
    gap: 4px;
  }
  .dial button,
  .toggle {
    flex: 0 0 auto;
    min-width: 46px;
    height: 30px;
    padding: 0 ${space[2]};
    border: none;
    border-radius: 4px;
    background: ${CREAM};
    box-shadow: 0 2px 0 #6d5c3c, inset 0 1px 0 #fff;
    color: ${INK};
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .dial button:active {
    transform: translateY(1px);
    box-shadow: 0 1px 0 #6d5c3c;
  }
  .toggle[aria-pressed='true'] {
    transform: translateY(1px);
    background: linear-gradient(180deg, #f2a23c 0%, #cf6a1c 100%);
    box-shadow: 0 1px 0 #6e3208, inset 0 1px 0 rgba(255, 255, 255, 0.45);
    color: #fff7e6;
  }
  button:focus-visible,
  select:focus-visible,
  a:focus-visible {
    outline: 2px solid ${INK};
    outline-offset: 1px;
  }
  .lcd {
    min-width: 44px;
    padding: 2px 6px;
    border-radius: 3px;
    text-align: center;
    font-family: ${font.mono};
    font-size: 19px;
    font-weight: 700;
    color: #ffb347;
    background: #1a0f06;
    box-shadow: inset 0 2px 4px #000, 0 1px 0 rgba(255, 255, 255, 0.5);
    text-shadow: 0 0 6px rgba(255, 179, 71, 0.7);
  }
  select {
    flex: 0 1 auto;
    max-width: 100%;
    height: 30px;
    border: 1px solid #5c4212;
    border-radius: 4px;
    background: #f8efd9;
    color: ${INK};
    font-size: 14px;
    padding: 0 ${space[1]};
  }
  .narrow & select.jump {
    flex: 1 1 140px;
    min-width: 0;
  }
  a {
    color: ${INK};
    font-size: ${text.xs};
    white-space: nowrap;
  }
  .open {
    margin-left: auto;
  }
  .led {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #ff5a2a;
    box-shadow: 0 0 6px #ff5a2a, inset 0 0 1px #fff;
  }
`

/** The speaker: walnut slats over dark cloth, filling what the picture leaves. */
const Grille = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  border-radius: 9px;
  background: repeating-linear-gradient(90deg, #0a0502 0 4px, transparent 4px 11px, rgba(255, 220, 170, 0.14) 11px 12px),
    url(${woodSkin}) 40px 120px / 512px 512px;
  box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.9), inset 0 0 0 1px #1a0d04, 0 1px 0 rgba(255, 220, 170, 0.25);
  .no-chat &,
  .narrow & {
    display: none;
  }
`
/** Drag to size chat: three gold studs on a strip between the screen and chat. */
const ChatHandle = styled.div`
  position: relative;
  cursor: col-resize;
  touch-action: none;
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 46px;
    margin: -23px 0 0 -3px;
    border-radius: 3px;
    background: radial-gradient(circle at 50% 50%, #fff2b8 0 1.5px, #a97f28 2.5px, transparent 3px) center / 6px 12px;
  }
  &:hover,
  &:focus-visible {
    outline: none;
    background: rgba(255, 226, 140, 0.25);
  }
  .narrow & {
    display: none;
  }
`

/** Chat, framed in the same gold as the picture. */
const Side = styled.div`
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 5px;
  border-radius: 14px;
  background: url(${goldSkin}) -120px 0 / 256px 256px;
  box-shadow: 0 0 0 1px #2a1a04, inset 0 1px 0 rgba(255, 250, 220, 0.8), 0 4px 9px rgba(0, 0, 0, 0.65);
  .narrow & {
    flex: 0 0 auto;
    height: 520px;
    max-height: 80svh;
  }
  > section:last-child {
    flex: 1 1 auto;
    overflow: hidden;
    border-radius: 9px;
  }
`
/* ---------- helpers ---------- */

const CHANNEL_KEY = 'miyatv.channel'

function initialIndex(): number {
  try {
    const id = window.localStorage.getItem(CHANNEL_KEY)
    const i = CHANNELS.findIndex((c) => c.id === id)
    return i >= 0 ? i : 0
  } catch {
    return 0
  }
}

const CHAT_KEY = 'miyatv.chat'
const CHAT_WIDTH_KEY = 'miyatv.chatWidth'

function initialChatWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(CHAT_WIDTH_KEY))
    return saved > 0 ? saved : CHAT_DEFAULT
  } catch {
    return CHAT_DEFAULT
  }
}

function initialChat(): boolean {
  try {
    return window.localStorage.getItem(CHAT_KEY) !== 'off'
  } catch {
    return true
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/* ---------- component ---------- */

export default function TV() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('tv')
  const [rootRef, { width }] = useElementSize()
  const layout = width === 0 ? 'wide' : width < 640 ? 'narrow' : width < 980 ? 'mid' : 'wide'
  const reducedMotion = useReducedMotion()

  const [index, setIndex] = useState(initialIndex)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [staticOn, setStaticOn] = useState(false)
  const [osd, setOsd] = useState(true)
  const [chatOn, setChatOn] = useState(initialChat)
  const [chatWanted, setChatWanted] = useState(initialChatWidth)
  const [dragging, setDragging] = useState(false)
  const staticTimer = useRef<ReturnType<typeof setTimeout>>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()

  // miyatv keeps its one shape. A window left maximized by an older version comes back to it.
  useEffect(() => {
    if (fullscreen) toggleFullscreen()
  }, [fullscreen, toggleFullscreen])

  const channel = CHANNELS[index] ?? CHANNELS[0]!
  const sources = channel.kind === 'iframe' ? channel.sources : []
  const source = sources[sourceIndex] ?? sources[0]

  const flash = useCallback(() => {
    setStaticOn(true)
    setOsd(true)
    clearTimeout(staticTimer.current)
    clearTimeout(osdTimer.current)
    staticTimer.current = setTimeout(() => setStaticOn(false), reducedMotion ? 250 : 480)
    osdTimer.current = setTimeout(() => setOsd(false), 2500)
  }, [reducedMotion])

  useEffect(() => {
    osdTimer.current = setTimeout(() => setOsd(false), 2500)
    return () => {
      clearTimeout(staticTimer.current)
      clearTimeout(osdTimer.current)
    }
  }, [])

  const tune = useCallback(
    (next: number) => {
      if (next === index || !CHANNELS[next]) return
      setIndex(next)
      setSourceIndex(0)
      flash()
      try {
        window.localStorage.setItem(CHANNEL_KEY, CHANNELS[next]!.id)
      } catch {
        // ignore
      }
    },
    [index, flash]
  )

  const step = (d: number) => tune(stepChannel(CHANNELS.length, index, d))

  const chatWidth = clampChat(chatWanted, width)

  const sizeChat = (next: number) => {
    const clamped = clampChat(next, width)
    setChatWanted(clamped)
    try {
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  const startChatDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const fromX = e.clientX
    const fromWidth = chatWidth
    setDragging(true)
    const move = (ev: PointerEvent) => sizeChat(fromWidth + fromX - ev.clientX)
    const up = () => {
      setDragging(false)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const toggleChat = () => {
    const next = !chatOn
    setChatOn(next)
    try {
      window.localStorage.setItem(CHAT_KEY, next ? 'on' : 'off')
    } catch {
      // ignore
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    if (/^[0-9]$/.test(e.key)) {
      const i = indexOfNumber(CHANNELS, Number(e.key))
      if (i >= 0) {
        e.preventDefault()
        tune(i)
      }
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault()
      toggleChat()
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === '+') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === '-') {
      e.preventDefault()
      step(-1)
    }
  }

  const native = nativeChatFor(channel, source)

  return (
    <WindowWrapper skin="tv">
      <TitleBar
        skin="tv"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'tv' }))
        }}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'tv' }))
        }}
      >
        {page?.label} · CH {pad(channel.number)} {channel.name}
      </TitleBar>
      <Root
        ref={rootRef}
        className={[layout, chatOn ? '' : 'no-chat', dragging ? 'dragging' : ''].filter(Boolean).join(' ')}
        style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="miyatv"
        aria-label="miyatv. Number keys change channel, arrow up and down step through channels, C shows or hides chat."
      >
        <TvColumn>
          <Bezel>
            <Stage>
              <Trim>
                <Glass>
                  <Screen channel={channel} source={source} />
                  <Static playing={staticOn} reducedMotion={reducedMotion} />
                  {(osd || staticOn) && (
                    <Osd aria-hidden>
                      CH {pad(channel.number)}
                      {layout !== 'narrow' && <div style={{ fontSize: 13 }}>{channel.name}</div>}
                    </Osd>
                  )}
                </Glass>
              </Trim>
            </Stage>
            <Controls>
              <span className="led" aria-hidden />
              <div className="dial" role="group" aria-label="Channel">
                <button type="button" aria-label="Channel down" title="Channel down (↓)" onClick={() => step(-1)}>
                  CH ▼
                </button>
                <button type="button" aria-label="Channel up" title="Channel up (↑)" onClick={() => step(1)}>
                  CH ▲
                </button>
              </div>
              <span className="lcd" aria-live="polite" aria-label={`Channel ${channel.number}`}>
                {pad(channel.number)}
              </span>
              <select
                className="jump"
                aria-label="Jump to channel"
                value={index}
                onChange={(e) => tune(Number(e.target.value))}
              >
                {CHANNELS.map((c, i) => (
                  <option key={c.id} value={i}>
                    {pad(c.number)} {c.name}
                  </option>
                ))}
              </select>
              {sources.length > 1 && (
                <select
                  aria-label="Creator"
                  value={sourceIndex}
                  onChange={(e) => {
                    setSourceIndex(Number(e.target.value))
                    flash()
                  }}
                >
                  {sources.map((s, i) => (
                    <option key={i} value={i}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="toggle"
                aria-pressed={chatOn}
                title={`${chatOn ? 'Hide' : 'Show'} chat (C). Hidden, the picture takes the whole cabinet.`}
                onClick={toggleChat}
              >
                {chatOn ? 'Chat on' : 'Chat off'}
              </button>
              {source && (
                <a className="open" href={watchUrl(source)} target="_blank" rel="noopener noreferrer">
                  open ↗
                </a>
              )}
            </Controls>
            <Grille aria-hidden />
          </Bezel>
        </TvColumn>

        {chatOn && (
          <>
            <ChatHandle
              role="separator"
              aria-orientation="vertical"
              aria-label="Chat width"
              aria-valuenow={chatWidth}
              tabIndex={0}
              title="Drag to size chat"
              onPointerDown={startChatDrag}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                e.stopPropagation()
                sizeChat(chatWidth + (e.key === 'ArrowLeft' ? 20 : -20))
              }}
            />
            <Side>
              <ChatPanel room={channel.id} roomLabel={channel.id} native={native} />
            </Side>
          </>
        )}
      </Root>
    </WindowWrapper>
  )
}

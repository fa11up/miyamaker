import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import { Eyebrow } from '@/components/Retro'
import { pinstripe, y2kSkin } from '@/components/Retro/y2k'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { gel } from '../DropMusic/y2k'
import type { Channel } from './channels'
import { CHANNELS, indexOfNumber, nativeChatFor, stepChannel, watchUrl } from './channels'
import ChatPanel from './chat/ChatPanel'
import Screen from './Screen'
import Static, { useReducedMotion } from './Static'

const page = Pages.tv

/* ---------- layout ---------- */

/** miyatv's own material: atomic purple, the see-through plastic of every console of the time. */
const Root = styled.div`
  position: relative;
  height: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: ${space[2]};
  padding: ${space[2]};
  overflow: hidden;
  ${y2kSkin({
    ink: '#1a0838',
    inkSoft: '#4a2a86',
    material: `${pinstripe(
      0.07
    )}, radial-gradient(420px 260px at 92% -50px, rgba(255, 255, 255, 0.45), transparent 70%),
      radial-gradient(360px 360px at -40px 105%, rgba(198, 255, 61, 0.22), transparent 70%),
      linear-gradient(165deg, #8a4ff0 0%, #5b2bc4 48%, #2c0f66 100%)`,
    head: '#ffffff',
    headShadow: '#1a0838',
    frost: 'rgba(247, 241, 255, 0.92)',
    edge: '#1a0838',
    glow: 'rgba(154, 92, 240, 0.28)',
    gelTop: '#efffb8',
    gelBottom: '#c6ff3d',
    gelInk: '#1a0838',
    smallTop: '#f2e6ff',
    smallBottom: '#b98cff',
    link: '#3b1fbf',
  })}
  &:focus {
    outline: none;
  }

  /* No chat: the channels fold into the strip's dropdown and the picture takes the whole window. */
  &.mid,
  &.no-chat {
    grid-template-columns: minmax(0, 1fr);
  }
  &.mid .channel-list,
  &.no-chat .channel-list {
    display: none;
  }

  /* Phones / narrow windows: one column, player first, then switcher, then chat. */
  &.narrow {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    padding: ${space[1]};
    gap: ${space[1]};
  }
  &.narrow .channel-list {
    display: none;
  }
`

const ChannelList = styled.nav`
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: ${space[1]};
  border: 1px solid #1a0838;
  border-radius: 14px;
  background: rgba(26, 8, 56, 0.55);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.45);

  button {
    display: grid;
    grid-template-columns: 30px 1fr;
    align-items: center;
    gap: ${space[1]};
    padding: ${space[2]} ${space[2]};
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: #f2e6ff;
    font-size: ${text.sm};
    line-height: 1.2;
  }
  button:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  button[aria-current='true'] {
    ${gel('#efffb8', '#c6ff3d', '#1a0838')}
  }
  .num {
    font-family: ${font.mono};
    font-size: 13px;
    opacity: 0.85;
  }
  .kind {
    display: block;
    font-size: 11px;
    opacity: 0.8;
  }
`

const TvColumn = styled.div`
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  .narrow & {
    overflow: visible;
    flex: 0 0 auto;
    gap: ${space[1]};
  }
`

/** The TV set: see-through plastic, rounded glass, and a control strip. It takes all the height chat leaves. */
const Bezel = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 14px 10px;
  border: 1px solid #1a0838;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.06) 8%, transparent 14%),
    linear-gradient(180deg, rgba(154, 92, 240, 0.92) 0%, rgba(58, 22, 130, 0.96) 100%);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.28), inset 0 -6px 10px rgba(0, 0, 0, 0.3),
    0 4px 0 rgba(26, 8, 56, 0.45);
  .narrow & {
    flex: 0 0 auto;
    padding: 6px 6px 4px;
    border-radius: 12px;
  }
`

/** Whatever room the bezel has for the picture; the glass is the biggest 16:9 that fits in it. */
const Stage = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  container-type: size;
  display: grid;
  place-items: center;
  .narrow & {
    flex: 0 0 auto;
    container-type: normal;
  }
`

const Glass = styled.div`
  position: relative;
  width: min(100cqw, calc(100cqh * 16 / 9));
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 18px / 14px;
  background: #000;
  box-shadow: 0 0 0 2px #1a0838, 0 0 0 4px #d7dcec, 0 0 0 5px #1a0838, inset 0 0 40px rgba(0, 0, 0, 0.7);
  .narrow & {
    width: 100%;
    border-radius: 8px;
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
  color: #6dff8f;
  text-shadow: 0 0 6px rgba(109, 255, 143, 0.8), 2px 2px 0 #000;
  .narrow & {
    font-size: 16px;
  }
`

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding-top: 10px;
  min-width: 0;
  color: ${color.light};
  .narrow & {
    padding-top: 6px;
    gap: ${space[1]};
    flex-wrap: wrap;
  }

  .dial {
    display: flex;
    gap: 2px;
  }
  .dial button,
  .toggle {
    flex: 0 0 auto;
    ${gel('#f2e6ff', '#b98cff', '#1a0838')}
    min-width: 46px;
    height: 34px;
    padding: 0 ${space[2]};
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .dial button:active,
  .toggle:active:not(:disabled) {
    transform: translateY(1px);
  }
  .toggle[aria-pressed='true'] {
    ${gel('#efffb8', '#c6ff3d', '#1a0838')}
  }
  .lcd {
    min-width: 46px;
    padding: 4px 6px;
    border-radius: 8px;
    text-align: center;
    font-family: ${font.mono};
    font-size: 20px;
    font-weight: 700;
    color: #c6ff3d;
    background: #0e0420;
    box-shadow: inset 0 2px 4px #000, 0 1px 0 rgba(255, 255, 255, 0.35);
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: ${text.sm};
    color: ${color.highlight};
  }
  select {
    max-width: 100%;
    height: 34px;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    color: ${color.ink};
    font-size: 14px;
    padding: 0 ${space[1]};
  }
  .narrow & select.jump {
    flex: 1 1 140px;
    min-width: 0;
  }
  a {
    color: ${color.faceLight};
    font-size: ${text.xs};
    white-space: nowrap;
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff3b6b;
    box-shadow: 0 0 6px #ff3b6b;
  }
`

/** Chat, under the picture. */
const ChatDock = styled.div`
  /* Leaves the picture 769px wide: any narrower and Kick's player drops its mute and volume controls. */
  flex: 0 0 136px;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  .narrow & {
    flex: 0 0 auto;
    height: 520px;
    max-height: 80svh;
  }
  > section:last-child {
    flex: 1 1 auto;
    border: 1px solid #1a0838;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 3px 0 rgba(26, 8, 56, 0.35);
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

function initialChat(): boolean {
  try {
    return window.localStorage.getItem(CHAT_KEY) !== 'off'
  } catch {
    return true
  }
}

const kindLabel = (c: Channel) =>
  c.kind === 'iframe' ? 'live embed' : c.kind === 'external' ? 'external' : 'no signal'
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
        className={chatOn ? layout : `${layout} no-chat`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="miyatv"
        aria-label="miyatv. Number keys change channel, arrow up and down step through channels, C shows or hides chat."
      >
        <ChannelList className="channel-list" aria-label="Channels">
          <Eyebrow style={{ padding: '2px 4px 4px' }}>channels</Eyebrow>
          {CHANNELS.map((c, i) => (
            <button key={c.id} type="button" aria-current={i === index} onClick={() => tune(i)}>
              <span className="num">{pad(c.number)}</span>
              <span>
                {c.name}
                <span className="kind">{kindLabel(c)}</span>
              </span>
            </button>
          ))}
        </ChannelList>

        <TvColumn>
          <Bezel>
            <Stage>
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
              {layout === 'wide' && chatOn ? (
                <span className="name">{channel.name}</span>
              ) : (
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
              )}
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
                title={`${chatOn ? 'Hide' : 'Show'} chat (C). Hidden, the picture takes the whole window.`}
                onClick={toggleChat}
              >
                {chatOn ? 'Chat on' : 'Chat off'}
              </button>
              {source && (
                <a href={watchUrl(source)} target="_blank" rel="noopener noreferrer">
                  open ↗
                </a>
              )}
            </Controls>
          </Bezel>
          {chatOn && (
            <ChatDock>
              <ChatPanel room={channel.id} roomLabel={channel.id} native={native} />
            </ChatDock>
          )}
        </TvColumn>
      </Root>
    </WindowWrapper>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import { Eyebrow } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'

import type { Channel } from './channels'
import { CHANNELS, indexOfNumber, nativeChatFor, stepChannel, watchUrl } from './channels'
import ChatPanel from './chat/ChatPanel'
import Screen from './Screen'
import Static, { useReducedMotion } from './Static'

const page = Pages.tv

/* ---------- layout ---------- */

const Root = styled.div`
  position: relative;
  height: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr) 340px;
  gap: ${space[2]};
  padding: ${space[2]};
  overflow: hidden;
  background: ${color.face};
  &:focus {
    outline: none;
  }

  &.mid {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  &.mid .channel-list {
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
  gap: 2px;
  padding: ${space[1]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};

  button {
    display: grid;
    grid-template-columns: 30px 1fr;
    align-items: center;
    gap: ${space[1]};
    padding: ${space[2]} ${space[1]};
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: ${color.ink};
    font-size: ${text.sm};
    line-height: 1.2;
  }
  button:hover {
    background: ${color.light};
  }
  button[aria-current='true'] {
    background: ${color.titleTo};
    color: ${color.highlight};
  }
  .num {
    font-family: ${font.mono};
    font-size: 13px;
    opacity: 0.8;
  }
  .kind {
    display: block;
    font-size: 11px;
    opacity: 0.75;
  }
`

const TvColumn = styled.div`
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  .narrow & {
    overflow: visible;
    flex: 0 0 auto;
    gap: ${space[1]};
  }
`

/** The TV set: dark plastic body, rounded glass, and a control strip. */
const Bezel = styled.div`
  padding: 14px 14px 10px;
  border-radius: 14px;
  background: linear-gradient(180deg, #3a3354 0%, #221d36 100%);
  box-shadow: inset 2px 2px 0 #5d5480, inset -2px -2px 0 #0d0a17, 3px 4px 0 rgba(20, 16, 31, 0.35);
  .narrow & {
    padding: 6px 6px 4px;
    border-radius: 8px;
  }
`

const Glass = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: calc(100svh - 260px);
  margin: 0 auto;
  overflow: hidden;
  border-radius: 18px / 14px;
  background: #000;
  box-shadow: 0 0 0 3px #0d0a17, inset 0 0 40px rgba(0, 0, 0, 0.7);
  .narrow & {
    border-radius: 8px;
    max-height: none;
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
  .dial button {
    width: 40px;
    height: 34px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .dial button:active {
    box-shadow: ${bevel.pressed};
  }
  .lcd {
    min-width: 46px;
    padding: 4px 6px;
    text-align: center;
    font-family: ${font.mono};
    font-size: 20px;
    font-weight: 700;
    color: #6dff8f;
    background: #08150c;
    box-shadow: inset 1px 1px #000, inset -1px -1px #2b4a33;
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

const About = styled.div`
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  font-size: 14px;
  font-family: ${font.body};
  line-height: 1.45;
  color: ${color.ink};
  h3 {
    margin: 0 0 2px;
    font-family: ${font.ui};
    font-size: ${text.sm};
  }
  p {
    margin: 0 0 ${space[1]};
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[3]};
    font-family: ${font.ui};
    font-size: ${text.xs};
  }
  a {
    color: ${color.link};
  }
  .placeholder {
    color: ${color.warning};
  }
`

const Side = styled.div`
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  .narrow & {
    flex: 0 0 auto;
    height: 520px;
    max-height: 80svh;
    gap: ${space[1]};
  }
  > section:last-child {
    flex: 1 1 auto;
  }
`

/** Reserved slot for imdUSD markets (separate workstream). Never overlays the player. */
const MarketsSlot = styled.aside`
  flex: 0 0 auto;
  padding: ${space[2]} ${space[3]};
  background: repeating-linear-gradient(45deg, ${color.faceLight} 0 8px, ${color.light} 8px 16px);
  box-shadow: ${bevel.sunken};
  outline: 1px dashed ${color.shadow};
  outline-offset: -5px;
  strong {
    display: block;
    font-size: ${text.sm};
    color: ${color.ink};
  }
  span {
    font-size: ${text.xs};
    color: ${color.inkMuted};
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
  const staticTimer = useRef<ReturnType<typeof setTimeout>>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    if (/^[0-9]$/.test(e.key)) {
      const i = indexOfNumber(CHANNELS, Number(e.key))
      if (i >= 0) {
        e.preventDefault()
        tune(i)
      }
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
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
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
        className={layout}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="miyatv"
        aria-label="miyatv. Number keys change channel, arrow up and down step through channels."
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
              {layout === 'wide' ? (
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
              {source && (
                <a href={watchUrl(source)} target="_blank" rel="noopener noreferrer">
                  open ↗
                </a>
              )}
            </Controls>
          </Bezel>
          {layout !== 'narrow' && (
            <About>
              <h3>{channel.name}</h3>
              <p>{channel.description}</p>
              {source?.provider === 'kick' && source.placeholder && (
                <p className="placeholder">
                  Placeholder Kick channel “{source.slug}”: the real creator list is not set yet.
                </p>
              )}
              <div className="links">
                {channel.links.map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </About>
          )}
        </TvColumn>

        <Side>
          {channel.markets && (
            <MarketsSlot data-slot="markets" aria-label="imdUSD markets">
              <strong>imdUSD markets — coming soon</strong>
              <span>Markets for this channel are being designed. Nothing to trade here yet.</span>
            </MarketsSlot>
          )}
          <ChatPanel room={channel.id} roomLabel={channel.id} native={native} />
        </Side>
      </Root>
    </WindowWrapper>
  )
}

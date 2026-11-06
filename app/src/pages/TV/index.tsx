import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import SkinMenu from '@/components/SkinMenu'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useRadio } from '@/context/RadioProvider'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { font, space, text } from '@/theme/tokens'

import { TV_LIVE_PATH } from '../../../api/_lib/tvlive'
import { CHANNELS, CHAT_DEFAULT, clampChat, indexOfNumber, nativeChatFor, stepChannel, watchUrl } from './channels'
import ChatPanel from './chat/ChatPanel'
import Guide from './Guide'
import { FocusPanel, IssPanel, PublicPanel, RadioPanel, SpottingPanel, SqueekPanel } from './panels'
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

  /* Maximized: a whole window of cabinet, no rounded corners against the screen's edge. */
  &.maximized {
    border-radius: 0;
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
  .fit & {
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
  .fit & {
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
  /* The plate's menus, in its own materials. */
  --menu-face: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
  --menu-ink: ${INK};
  --menu-edge: #5c4212;
  --menu-sheet: url(${goldSkin}) 0 0 / 256px 256px;
  --menu-pick: #2a1a0e;
  --menu-pick-ink: #ffb347;
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
  a {
    color: ${INK};
    font-size: ${text.xs};
    white-space: nowrap;
  }
  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: ${text.sm};
  }
  .open {
    margin-left: auto;
  }
  .sound {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
  }
  .sound input {
    width: 90px;
    accent-color: #8a3d0c;
    cursor: pointer;
  }
  .toggle:active {
    transform: translateY(1px);
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
  .fit &,
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
const VOLUME_KEY = 'miyatv.volume'

function initialVolume(): number {
  try {
    const saved = Number(window.localStorage.getItem(VOLUME_KEY) ?? '0.8')
    return saved >= 0 && saved <= 1 ? saved : 0.8
  } catch {
    return 0.8
  }
}

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
  const [guideOpen, setGuideOpen] = useState(false)
  const [tapeId, setTapeId] = useState<string>()
  const [tvVolume, setTvVolume] = useState(initialVolume)
  const [tvMuted, setTvMuted] = useState(false)
  // Muted by the browser's autoplay rule rather than by choice: the next channel tries for sound again.
  const autoMuted = useRef(false)
  const radio = useRadio()
  const staticTimer = useRef<ReturnType<typeof setTimeout>>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()

  const channel = CHANNELS[index] ?? CHANNELS[0]!
  const sources = channel.kind === 'iframe' ? channel.sources : []
  const picked = sources[sourceIndex] ?? sources[0]
  const liveIds = useQuery({
    queryKey: ['tv-live'],
    queryFn: async () => ((await (await fetch(TV_LIVE_PATH)).json()) as { ids: Record<string, string> }).ids,
    refetchInterval: 10 * 60_000,
    retry: 1,
  }).data
  const moved = picked?.provider === 'youtube' ? liveIds?.[channel.id] : undefined
  const source = picked?.provider === 'youtube' && moved ? { ...picked, videoId: moved } : picked

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
      if (autoMuted.current) {
        autoMuted.current = false
        setTvMuted(false)
      }

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

  // YouTube and our own shows take our buttons; Kick and X only listen to the controls inside their players.
  const isRadio = channel.kind === 'show' && channel.show === 'radio'
  const hasSound = isRadio || (channel.kind === 'show' && channel.show === 'public') || source?.provider === 'youtube'
  const shownVolume = isRadio ? radio.volume : tvMuted ? 0 : tvVolume
  const setVolume = (v: number) => {
    if (isRadio) {
      radio.setVolume(v)
      return
    }

    setTvVolume(v)
    setTvMuted(v === 0)
    try {
      window.localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      // ignore
    }
  }

  const toggleMute = () => {
    if (isRadio) radio.setVolume(radio.volume > 0 ? 0 : tvVolume || 0.8)
    else {
      autoMuted.current = false
      setTvMuted((m) => !m)
    }
  }

  const panel = (() => {
    if (channel.id === 'lofi')
      return {
        label: 'focus',
        node: <FocusPanel onRadio={() => tune(CHANNELS.findIndex((c) => c.id === 'miya-radio'))} />,
      }
    if (channel.id === 'monterey') return { label: 'spotting', node: <SpottingPanel /> }
    if (channel.id === 'iss') return { label: 'tracker', node: <IssPanel /> }
    if (channel.id === 'squeekchain') return { label: 'vitals', node: <SqueekPanel /> }
    if (channel.id === 'miya-radio') return { label: 'station', node: <RadioPanel /> }
    if (channel.id === 'public-access')
      return { label: 'tapes', node: <PublicPanel tapeId={tapeId} onPick={setTapeId} /> }
    return undefined
  })()

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
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault()
      setGuideOpen(true)
    } else if ((e.key === 'm' || e.key === 'M') && hasSound) {
      e.preventDefault()
      toggleMute()
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
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
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
        className={[
          layout,
          chatOn ? '' : 'no-chat',
          dragging ? 'dragging' : '',
          fullscreen ? 'maximized' : '',
          layout !== 'narrow' && (fullscreen || !chatOn) ? 'fit' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="miyatv"
        aria-label="miyatv. Number keys change channel, arrow up and down step through channels, C shows or hides the sidebar, G opens the guide, M mutes."
      >
        <TvColumn>
          <Bezel>
            <Stage>
              <Trim>
                <Glass>
                  <Screen
                    channel={channel}
                    source={source}
                    volume={tvVolume}
                    muted={tvMuted}
                    onAutoMuted={() => {
                      autoMuted.current = true
                      setTvMuted(true)
                    }}
                    tapeId={tapeId}
                    onTape={setTapeId}
                    reducedMotion={reducedMotion}
                  />
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
              <button type="button" className="toggle guide" title="The guide (G)" onClick={() => setGuideOpen(true)}>
                Guide
              </button>
              <span className="name" title={channel.name}>
                {channel.name}
              </span>
              {sources.length > 1 && (
                <SkinMenu
                  label="Creator"
                  value={String(sourceIndex)}
                  options={sources.map((s, i) => ({ value: String(i), label: s.label }))}
                  onChange={(v) => {
                    setSourceIndex(Number(v))
                    flash()
                  }}
                />
              )}
              {hasSound && (
                <span className="sound">
                  <button
                    type="button"
                    className="toggle"
                    aria-pressed={shownVolume > 0}
                    title="Sound on or off (M)"
                    onClick={toggleMute}
                  >
                    {shownVolume > 0 ? '♪ On' : '♪ Off'}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    aria-label="Volume"
                    value={Math.round(shownVolume * 100)}
                    onChange={(e) => setVolume(Number(e.target.value) / 100)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </span>
              )}
              <button
                type="button"
                className="toggle"
                aria-pressed={chatOn}
                title={`${chatOn ? 'Hide' : 'Show'} the sidebar (C). Hidden, the picture takes the whole cabinet.`}
                onClick={toggleChat}
              >
                {chatOn ? 'Side on' : 'Side off'}
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
              <ChatPanel key={channel.id} room={channel.id} roomLabel={channel.id} native={native} panel={panel} />
            </Side>
          </>
        )}
        {guideOpen && (
          <Guide
            channels={CHANNELS}
            liveIds={liveIds}
            current={channel.id}
            onClose={() => setGuideOpen(false)}
            onPick={(id) => {
              tune(CHANNELS.findIndex((c) => c.id === id))
              setGuideOpen(false)
            }}
          />
        )}
      </Root>
    </WindowWrapper>
  )
}

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
import { useFullscreen, useWindows } from '@/store/windows/hooks'
import { font, space, text } from '@/theme/tokens'

import type { KickStream } from '../../../api/_lib/tvkick'
import { airList, nextTapeId } from '../../../api/_lib/publicaccess'
import { TV_LIVE_PATH } from '../../../api/_lib/tvlive'
import {
  CHANNELS,
  CHAT_DEFAULT,
  CHAT_ROOM,
  clampChat,
  indexOfNumber,
  nativeChatFor,
  pinnedSource,
  plateLink,
  stepChannel,
} from './channels'
import type { Source } from './channels'
import ChatPanel from './chat/ChatPanel'
import { focusLabel, newFocusTimer, resetFocus, tickFocus, toggleFocus } from './focusTimer'
import Guide from './Guide'
import { FocusPanel, IssPanel, PublicPanel, RadioPanel, SpottingPanel, SqueekPanel } from './panels'
import { fetchTapes } from './publicAccess'
import Screen from './Screen'
import goldSkin from './skin/gold.webp'
import woodSkin from './skin/wood.webp'
import Static, { useReducedMotion } from './Static'

const page = Pages.tv

/* ---------- layout ---------- */

const CREAM = 'linear-gradient(180deg, #f8efd9 0%, #dccfae 100%)'
const INK = '#2a1a0e'
/** Walnut slats over dark cloth: the speaker, and whatever room the picture leaves. */
const SLATS = `repeating-linear-gradient(90deg, #0a0502 0 4px, transparent 4px 11px, rgba(255, 220, 170, 0.14) 11px 12px),
    url(${woodSkin}) 40px 120px / 512px 512px`
const SLATS_EDGE = `inset 0 3px 8px rgba(0, 0, 0, 0.9),
    inset 0 0 0 1px #1a0d04,
    0 1px 0 rgba(255, 220, 170, 0.25)`

/** miyatv's skin: tiled walnut and gold bitmaps (scripts/make-tv-skin.py), the screen in the middle, chat beside it. */
const Root = styled.div`
  position: relative;
  height: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--chat-w);
  column-gap: 12px;
  grid-template-rows: minmax(0, 1fr);
  padding: ${space[2]};
  overflow: hidden;
  border-radius: 0 0 16px 16px;
  color: #f3e7cf;
  background: url(${woodSkin}) 0 0 / 512px 512px;
  box-shadow:
    inset 0 2px 5px rgba(0, 0, 0, 0.75),
    inset 0 0 0 1px rgba(20, 10, 2, 0.8);
  &:focus {
    outline: none;
  }

  /* Maximized: a whole window of cabinet, no rounded corners against the screen's edge. */
  &.maximized {
    border-radius: 0;
  }

  /* No chat: the screen fills the cabinet. */
  &.no-chat {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Phones / narrow windows: one column that fits the screen, player first, then chat in what is left. */
  &.narrow {
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
  .narrow.no-chat & {
    flex: 1 1 auto;
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
  .narrow.no-chat & {
    flex: 1 1 auto;
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
    border-radius: 9px;
    background: ${SLATS};
    box-shadow: ${SLATS_EDGE};
  }
`

/** Gold moulding round the picture. Its width is what sizes the glass inside. */
const Trim = styled.div`
  position: relative;
  padding: 6px;
  border-radius: 30px / 24px;
  /* Hung from the edge the ear grows out of, so the grain runs on into it at any width. */
  background: url(${goldSkin}) right 0 top 0 / 256px 256px;
  box-shadow:
    0 0 0 1px #2a1a04,
    inset 0 1px 0 rgba(255, 250, 220, 0.8),
    inset 0 -1px 0 rgba(60, 36, 4, 0.8),
    0 4px 9px rgba(0, 0, 0, 0.65);
  .fit & {
    width: min(100cqw, calc((100cqh - 12px) * 16 / 9 + 12px));
  }
  .narrow & {
    padding: 4px;
    border-radius: 14px;
    background-position: left 0 bottom 0;
  }
  .narrow.no-chat & {
    margin-bottom: 4px;
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
  text-shadow:
    0 0 6px rgba(255, 179, 71, 0.8),
    2px 2px 0 #000;
  .narrow & {
    font-size: 16px;
  }
`

const BUTTON_NARROW = 40
const PLATE_NARROW = 2 * BUTTON_NARROW + 12

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
  box-shadow:
    0 0 0 1px #2a1a04,
    inset 0 1px 0 rgba(255, 250, 220, 0.85),
    inset 0 -1px 0 rgba(60, 36, 4, 0.8),
    0 3px 6px rgba(0, 0, 0, 0.6);
  color: ${INK};
  /* The plate's menus, in its own materials. */
  --menu-face: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
  --menu-ink: ${INK};
  --menu-edge: #5c4212;
  --menu-sheet: url(${goldSkin}) 0 0 / 256px 256px;
  --menu-pick: #2a1a0e;
  --menu-pick-ink: #ffb347;
  .mid & {
    flex-wrap: wrap;
  }
  /* Two rows of room on every channel, so the picture and the chat don't move as the channels change. */
  .narrow & {
    padding: 4px 6px;
    gap: ${space[1]};
    flex-wrap: wrap;
    align-content: flex-start;
    min-height: ${PLATE_NARROW}px;
  }
  /* Typing on a phone: the keyboard has taken half the screen. */
  .narrow:has(section input:focus) & {
    display: none;
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
    box-shadow:
      0 2px 0 #6d5c3c,
      inset 0 1px 0 #fff;
    color: ${INK};
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .narrow & .dial button,
  .narrow & .toggle,
  .narrow & button[aria-haspopup] {
    height: ${BUTTON_NARROW}px;
  }
  .toggle:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .dial button:active {
    transform: translateY(1px);
    box-shadow: 0 1px 0 #6d5c3c;
  }
  .toggle[aria-pressed='true'] {
    transform: translateY(1px);
    background: linear-gradient(180deg, #f2a23c 0%, #cf6a1c 100%);
    box-shadow:
      0 1px 0 #6e3208,
      inset 0 1px 0 rgba(255, 255, 255, 0.45);
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
    box-shadow:
      inset 0 2px 4px #000,
      0 1px 0 rgba(255, 255, 255, 0.5);
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
  .narrow & .open {
    padding: 8px 0;
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
    box-shadow:
      0 0 6px #ff5a2a,
      inset 0 0 1px #fff;
  }
`

/** The speaker: walnut slats over dark cloth, filling what the picture leaves. */
const Grille = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  border-radius: 9px;
  background: ${SLATS};
  box-shadow: ${SLATS_EDGE};
  .fit &,
  .narrow & {
    display: none;
  }
  /* A phone with chat hidden: the speaker takes the room. */
  .narrow.no-chat & {
    display: block;
  }
`
/** Where the open tab sits on the sidebar's border, which its texture has to line up with. */
const EAR_TOP = 18
const EAR_DEPTH = 9
const EAR_LONG = 46
const EAR_PHONE = 9
const EAR_PHONE_LEFT = 18
const SIDE_GOLD_X = -120

/**
 * An ear on the gold border that shows or hides the sidebar: cut from the same gold, lined up with it, and open where it
 * meets the border so there is no line between them. It points the way the sidebar will go.
 */
const SideTab = styled.button`
  position: absolute;
  z-index: 3;
  top: ${EAR_TOP}px;
  left: -${EAR_DEPTH}px;
  width: ${EAR_DEPTH}px;
  height: ${EAR_LONG}px;
  padding: 0;
  border: none;
  border-radius: 7px 0 0 7px;
  background: url(${goldSkin}) ${SIDE_GOLD_X + EAR_DEPTH}px -${EAR_TOP}px / 256px 256px;
  box-shadow:
    -1px 0 0 #2a1a04,
    0 -1px 0 #2a1a04,
    0 1px 0 #2a1a04,
    inset 1px 1px 0 rgba(255, 250, 220, 0.6);
  color: #5a3d0c;
  font-size: 13px;
  font-weight: 700;
  line-height: ${EAR_LONG}px;
  text-align: center;
  text-shadow: 0 1px 0 rgba(255, 250, 220, 0.75);
  cursor: pointer;
  /* Covers the border's outline where the ear joins it. */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: -2px;
    width: 3px;
    background: url(${goldSkin}) ${SIDE_GOLD_X + 1}px -${EAR_TOP}px / 256px 256px;
  }
  /* A bigger place to press than there is ear to see. */
  &::after {
    content: '';
    position: absolute;
    inset: -8px -6px;
  }
  &:hover,
  &:focus-visible {
    outline: none;
    color: #1a0e02;
  }
  /* Chat hidden: the same ear, on the picture's own gold. */
  &.closed {
    left: auto;
    right: -${EAR_DEPTH - 1}px;
    width: ${EAR_DEPTH - 1}px;
    border-radius: 0 7px 7px 0;
    background-position: 0 -${EAR_TOP}px;
    box-shadow:
      1px 0 0 #2a1a04,
      0 -1px 0 #2a1a04,
      0 1px 0 #2a1a04,
      inset 0 1px 0 rgba(255, 250, 220, 0.6);
  }
  &.closed::before {
    right: auto;
    left: -2px;
    background-position: 2px -${EAR_TOP}px;
  }
  /* Phones: chat is below the picture, so the ear sits on the top edge. */
  .narrow & {
    top: -${EAR_PHONE}px;
    left: ${EAR_PHONE_LEFT}px;
    width: ${EAR_LONG}px;
    height: ${EAR_PHONE}px;
    border-radius: 7px 7px 0 0;
    background-position: ${SIDE_GOLD_X - EAR_PHONE_LEFT}px ${EAR_PHONE}px;
    line-height: ${EAR_PHONE}px;
    font-size: 10px;
    box-shadow:
      0 -1px 0 #2a1a04,
      -1px 0 0 #2a1a04,
      1px 0 0 #2a1a04,
      inset 0 1px 0 rgba(255, 250, 220, 0.6);
  }
  .narrow &::before {
    top: auto;
    bottom: -2px;
    left: 0;
    right: 0;
    width: auto;
    height: 3px;
    background-position: ${SIDE_GOLD_X - EAR_PHONE_LEFT}px 1px;
  }
  .narrow &.closed {
    top: auto;
    bottom: -${EAR_PHONE}px;
    right: auto;
    width: ${EAR_LONG}px;
    border-radius: 0 0 7px 7px;
    background-position: -${EAR_PHONE_LEFT}px 0;
    box-shadow:
      0 1px 0 #2a1a04,
      -1px 0 0 #2a1a04,
      1px 0 0 #2a1a04;
  }
  .narrow &.closed::before {
    top: -2px;
    bottom: auto;
    left: 0;
    background-position: -${EAR_PHONE_LEFT}px 2px;
  }
  /* Enough to press with a thumb, 32px tall, and only just touching the plate above it or the chat below. */
  .narrow &::after {
    inset: -12px -8px -11px;
  }
  .narrow &.closed::after {
    inset: -18px -8px -5px;
  }
`

/** Chat, framed in the same gold as the picture. */
const Side = styled.div`
  position: relative;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 5px;
  border-radius: 14px;
  background: url(${goldSkin}) -120px 0 / 256px 256px;
  box-shadow:
    0 0 0 1px #2a1a04,
    inset 0 1px 0 rgba(255, 250, 220, 0.8),
    0 4px 9px rgba(0, 0, 0, 0.65);
  .narrow & {
    flex: 1 1 0;
    margin-top: 12px;
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
const VOLUME_KEY = 'miyatv.volume'

function initialVolume(): number {
  try {
    const saved = Number(window.localStorage.getItem(VOLUME_KEY) ?? '0.8')
    return saved >= 0 && saved <= 1 ? saved : 0.8
  } catch {
    return 0.8
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
  const [sizeRef, { width }] = useElementSize()
  const rootEl = useRef<HTMLDivElement | null>(null)
  const rootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootEl.current = node
      sizeRef(node)
    },
    [sizeRef],
  )
  const [, zIndex, , minimized] = useWindows()
  const layout = width === 0 ? 'wide' : width < 640 ? 'narrow' : width < 980 ? 'mid' : 'wide'
  const reducedMotion = useReducedMotion()

  const [index, setIndex] = useState(initialIndex)
  const [sourceLabel, setSourceLabel] = useState<string>()
  const [staticOn, setStaticOn] = useState(false)
  const [osd, setOsd] = useState(true)
  const [chatOn, setChatOn] = useState(initialChat)
  const [guideOpen, setGuideOpen] = useState(false)
  const [tapeId, setTapeId] = useState<string>()
  const [tapePaused, setTapePaused] = useState(false)
  const [tapeBreak, setTapeBreak] = useState(false)
  const [focusTimer, setFocusTimer] = useState(newFocusTimer)
  const [osdNote, setOsdNote] = useState<string>()
  const [tvVolume, setTvVolume] = useState(initialVolume)
  const [tvMuted, setTvMuted] = useState(false)
  // Muted by the browser's autoplay rule rather than by choice: the next channel tries for sound again.
  const autoMuted = useRef(false)
  const radio = useRadio()
  const staticTimer = useRef<ReturnType<typeof setTimeout>>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()
  const noteTimer = useRef<ReturnType<typeof setTimeout>>()

  const channel = CHANNELS[index] ?? CHANNELS[0]!
  const liveQuery = useQuery({
    queryKey: ['tv-live'],
    queryFn: async () =>
      (await (await fetch(TV_LIVE_PATH)).json()) as { ids: Record<string, string>; kick?: KickStream[] },
    refetchInterval: 3 * 60_000,
    retry: 1,
  })
  const live = liveQuery.data
  const liveIds = live?.ids
  const onKick = channel.kind === 'iframe' && channel.sources[0].provider === 'kick'
  // Kick plays only who the server says is on. No list means nothing to play, never a guess at who might be.
  const sources: Source[] =
    channel.kind !== 'iframe'
      ? []
      : onKick
        ? (live?.kick ?? []).map((k) => ({ provider: 'kick', slug: k.slug, label: k.label }))
        : channel.sources
  // By name, not place: the list reorders as viewers come and go.
  const picked = sources.find((s) => s.label === sourceLabel) ?? sources[0]
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
      clearTimeout(noteTimer.current)
    }
  }, [])

  // The stream on Kick is held by name, so it stays when the list reorders. It only changes when that stream has ended.
  const kickLabels = onKick ? sources.map((s) => s.label).join('\n') : ''
  useEffect(() => {
    if (!kickLabels) return
    const { label, ended } = pinnedSource(kickLabels.split('\n'), sourceLabel)
    if (label !== sourceLabel) setSourceLabel(label)
    if (ended) flash()
  }, [kickLabels, sourceLabel, flash])

  // The focus timer lives here, not in its panel: hiding the sidebar or changing channel leaves it running.
  useEffect(() => {
    if (!focusTimer.running) return undefined
    const tick = setInterval(() => setFocusTimer((t) => tickFocus(t, Date.now())), 500)
    return () => clearInterval(tick)
  }, [focusTimer.running])

  const focusTurns = focusTimer.turns
  const focusResting = focusTimer.resting
  useEffect(() => {
    if (!focusTurns) return
    setOsdNote(focusLabel({ resting: focusResting }))
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setOsdNote(undefined), 5000)
    // Only when it turns over by itself; a reset leaves the count alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTurns])

  // Stepping off the radio turns it off, as nothing on the next channel could.
  const leavingRadio = channel.kind === 'show' && channel.show === 'radio' && radio.playing
  const pauseRadio = radio.pause
  const tune = useCallback(
    (next: number) => {
      if (next === index || !CHANNELS[next]) return
      if (autoMuted.current) {
        autoMuted.current = false
        setTvMuted(false)
      }

      if (leavingRadio) pauseRadio()
      setIndex(next)
      setTapePaused(false)
      flash()
      try {
        window.localStorage.setItem(CHANNEL_KEY, CHANNELS[next]!.id)
      } catch {
        // ignore
      }
    },
    [index, flash, leavingRadio, pauseRadio],
  )

  const pickTape = useCallback((videoId: string) => {
    setTapeId(videoId)
    setTapePaused(false)
  }, [])

  const step = (d: number) => tune(stepChannel(CHANNELS.length, index, d))

  const chatWidth = clampChat(CHAT_DEFAULT, width)

  // YouTube and our own shows take our buttons; Kick and X only listen to the controls inside their players.
  const isRadio = channel.kind === 'show' && channel.show === 'radio'
  const isPublic = channel.kind === 'show' && channel.show === 'public'
  // The radio's sound control comes with something to hear.
  const hasSound = (isRadio && !!radio.current) || isPublic || source?.provider === 'youtube'
  const tapes = airList(
    useQuery({
      queryKey: ['public-access'],
      queryFn: fetchTapes,
      refetchInterval: 60_000,
      retry: 1,
      enabled: isPublic,
    }).data?.tapes,
  )
  const link = plateLink(channel, source)
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
    if (channel.id === 'lofi') {
      return (
        <FocusPanel
          timer={focusTimer}
          onToggle={() => setFocusTimer((t) => toggleFocus(t, Date.now()))}
          onReset={() => setFocusTimer(resetFocus)}
        />
      )
    }

    if (channel.id === 'monterey') return <SpottingPanel />
    if (channel.id === 'iss') return <IssPanel />
    if (channel.id === 'squeekchain') return <SqueekPanel />
    if (channel.id === 'miya-radio') return <RadioPanel />
    if (channel.id === 'public-access') return <PublicPanel tapeId={tapeId} onPick={pickTape} />
    return undefined
  })()

  // The browser made it start silent: the first press anywhere brings the sound in. The sound button does that itself.
  useEffect(() => {
    const press = (e: PointerEvent) => {
      if (!autoMuted.current || (e.target as Element | null)?.closest?.('.sound')) return
      autoMuted.current = false
      setTvMuted(false)
    }
    window.addEventListener('pointerdown', press)
    return () => window.removeEventListener('pointerdown', press)
  }, [])

  const toggleChat = () => {
    const next = !chatOn
    setChatOn(next)
    try {
      window.localStorage.setItem(CHAT_KEY, next ? 'on' : 'off')
    } catch {
      // ignore
    }
  }

  const onKeyDown = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    // The guide has its own keys. Focus only lands out here, behind it, if the window has been raised again.
    if (guideOpen) {
      if (e.key === 'Escape') setGuideOpen(false)
      return
    }

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

  // The window takes focus when it comes to the front, and the set's keys only listen from here in. So focus moves on to the
  // set, after the window has noted where it came from, and after the boot screen, which takes its keys for itself.
  const onTop = zIndex[zIndex.length - 1] === 'tv' && !minimized.includes('tv')
  useEffect(() => {
    if (!onTop) return undefined
    const moveIn = setInterval(() => {
      if (document.querySelector('[data-boot]')) return
      clearInterval(moveIn)
      if (document.activeElement?.contains(rootEl.current)) rootEl.current?.focus({ preventScroll: true })
    }, 100)
    return () => clearInterval(moveIn)
  }, [onTop])

  // A button that goes away when pressed (Tune in, Start with the sidebar closing) takes focus with it, off to the page.
  const keys = useRef(onKeyDown)
  keys.current = onKeyDown
  useEffect(() => {
    if (!onTop) return undefined
    const stray = (e: KeyboardEvent) => {
      if (e.target === document.body) keys.current(e)
    }

    window.addEventListener('keydown', stray)
    return () => window.removeEventListener('keydown', stray)
  }, [onTop])

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
          fullscreen ? 'maximized' : '',
          layout !== 'narrow' && (fullscreen || !chatOn) ? 'fit' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="miyatv"
        aria-label="miyaTV. Number keys change channel, arrow up and down step through channels, C shows or hides the sidebar, G opens the guide, M mutes."
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
                    checkingLive={liveQuery.isPending}
                    onAutoMuted={() => {
                      autoMuted.current = true
                      setTvMuted(true)
                    }}
                    tapeId={tapeId}
                    tapePaused={tapePaused}
                    onTape={pickTape}
                    onBreak={setTapeBreak}
                    reducedMotion={reducedMotion}
                  />
                  <Static playing={staticOn} reducedMotion={reducedMotion} />
                  {osdNote && <Osd role="status">{osdNote}</Osd>}
                  {!osdNote && (osd || staticOn) && (
                    <Osd aria-hidden>
                      CH {pad(channel.number)}
                      {layout !== 'narrow' && <div style={{ fontSize: 13 }}>{channel.name}</div>}
                    </Osd>
                  )}
                </Glass>
                {!chatOn && (
                  <SideTab
                    type="button"
                    className="closed"
                    aria-expanded={false}
                    aria-label="Show the sidebar"
                    title="Show the sidebar (C)"
                    onClick={toggleChat}
                  >
                    {layout === 'narrow' ? '▾' : '‹'}
                  </SideTab>
                )}
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
              <span className="name" title={channel.name}>
                {channel.name}
              </span>
              <button type="button" className="toggle guide" title="The guide (G)" onClick={() => setGuideOpen(true)}>
                Guide
              </button>
              {sources.length > 1 && (
                <SkinMenu
                  label="Creator"
                  value={picked?.label ?? ''}
                  options={sources.map((s) => ({ value: s.label, label: s.label }))}
                  onChange={(v) => {
                    setSourceLabel(v)
                    flash()
                  }}
                />
              )}
              {isPublic && (
                <>
                  <button
                    type="button"
                    className="toggle"
                    disabled={tapeBreak}
                    onClick={() => setTapePaused((p) => !p)}
                  >
                    {tapePaused ? '▶ Play' : '❚❚ Pause'}
                  </button>
                  <button
                    type="button"
                    className="toggle"
                    disabled={tapeBreak || tapes.length < 2}
                    onClick={() => {
                      const next = nextTapeId(tapes, tapeId ?? tapes[0]?.videoId)
                      if (next) pickTape(next)
                    }}
                  >
                    Next ▶
                  </button>
                </>
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
              {link && (
                <a className="open" href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              )}
            </Controls>
            <Grille aria-hidden />
          </Bezel>
        </TvColumn>

        {chatOn && (
          <>
            <Side>
              <SideTab
                type="button"
                aria-expanded
                aria-label="Hide the sidebar"
                title="Hide the sidebar (C)"
                onClick={toggleChat}
              >
                {layout === 'narrow' ? '▴' : '›'}
              </SideTab>
              <ChatPanel room={CHAT_ROOM} roomLabel={CHAT_ROOM} channelId={channel.id} native={native} panel={panel} />
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

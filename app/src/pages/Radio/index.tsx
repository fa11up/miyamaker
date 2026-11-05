import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount } from 'wagmi'

import Pages from '@/constants/pages'
import type { RadioApi } from '@/context/RadioProvider'
import { playableUrl, useRadio, useRadioClock } from '@/context/RadioProvider'
import { estimateKbps, formatDuration } from '@/music/audio'
import { communitySource } from '@/music/community'
import { LISTED_MUSIC_CHAINS } from '@/music/config'
import { positionLabel } from '@/music/queue'
import { musicDropsSource, stationSource } from '@/music/sources'
import type { PlaylistSource, Track } from '@/music/types'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow, setAlwaysOnTop } from '@/store/windows/actions'
import type { PageKey } from '@/store/windows/reducer'
import { font } from '@/theme/tokens'

import Equalizer from './Equalizer'
import { Glyph } from './Glyph'
import { feather, HEART_PATH, pivot, tailFeather, VIEW } from './heartGeometry'
import { at, Bead, Clock, Dial, Marquee, Menu, PixelText, Slider } from './parts'
import Playlist from './Playlist'
import type { RadioLayout } from './skins'
import { loadLayout, saveLayout, skinById } from './skins'
import type { VizKind } from './Visualizer'
import Visualizer, { VIZ_KINDS, VIZ_LABEL } from './Visualizer'

const pageId = 'radio' as PageKey

/* ── the shell: a machined chrome heart with its screen set into the chest ───── */

const PLAYER = { width: 540, height: 397 }
const SCALE = PLAYER.width / VIEW.width
const LCD = { x: 162, y: 66, width: 216, height: 178 }
const LCD_SHAPE =
  'M0 24Q0 5 20 4Q74 1 108 14Q142 1 196 4Q216 5 216 24V142Q216 174 184 176L132 178H84L32 176Q0 174 0 142Z'
const COLLAR =
  'M153 90Q153 58 183 56Q238 52 270 66Q302 52 357 56Q387 58 387 90V200Q387 250 340 254L318 256Q306 258 303 274A36 36 0 1 1 237 274Q234 258 222 256L200 254Q153 250 153 200Z'
const MARQUEE_WIDTH = 200

const Root = styled.div`
  position: relative;
  height: 100%;
  font-family: ${font.ui};
  --lvl: 0;
  &:focus {
    outline: none;
  }

  /* No window behind it: only what it paints takes clicks, so the desktop works in the gaps between the feathers. */
  &&,
  && * {
    pointer-events: none;
  }
  && .plume,
  && .heart-body,
  && .console,
  && .console * {
    pointer-events: auto;
  }
  && .console .lcd-glass {
    pointer-events: none;
  }

  /* Phones: the heart fills the width on its own backdrop, with the wing tips running off the edges. */
  &.narrow {
    overflow: hidden auto;
    background: radial-gradient(90% 50% at 50% 22%, #3a1a66 0%, #150a2c 70%, #07040f 100%);
  }
  &&.narrow {
    pointer-events: auto;
  }
`

const Stage = styled.div`
  display: flex;
  justify-content: center;
  .narrow & {
    padding-top: 24px;
  }
`

const Player = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: ${PLAYER.width}px;
  height: ${PLAYER.height}px;
`

const Layer = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: ${PLAYER.width}px;
  height: ${PLAYER.height}px;
  overflow: visible;

  .wing-left,
  .wing-right {
    transition: transform 70ms linear;
  }
  .wing-left {
    transform-origin: ${pivot('left').x}px ${pivot('left').y}px;
    transform: rotate(calc(var(--lvl) * 5deg));
  }
  .wing-right {
    transform-origin: ${pivot('right').x}px ${pivot('right').y}px;
    transform: rotate(calc(var(--lvl) * -5deg));
  }
  .plume {
    cursor: grab;
    fill: url(#radio-feather);
    stroke: #05060e;
    stroke-width: 1.5;
  }
  .plume.back {
    fill: url(#radio-feather-back);
  }
  .tail {
    fill: url(#radio-tail);
  }
  .spine {
    fill: none;
    stroke: rgba(255, 255, 255, 0.35);
    stroke-width: 1.5;
  }
  .heart-body {
    cursor: grab;
    fill: url(#radio-plate);
  }
  .heart-rim {
    fill: none;
    stroke: url(#radio-chrome);
    stroke-width: 26;
    stroke-linejoin: round;
  }
  .tube {
    fill: none;
    stroke: url(#radio-chrome);
    stroke-linecap: round;
  }
  .pod {
    fill: url(#radio-chrome);
  }
  .collar {
    fill: url(#radio-chrome);
  }
  @media (prefers-reduced-motion: reduce) {
    .wing-left,
    .wing-right {
      transform: none;
    }
  }
`

/* A zero-size origin: only the controls inside it take clicks, so the chrome around them still drags. */
const Controls = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
`

const Etched = styled.span`
  position: absolute;
  color: var(--rk-etch);
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.28));
`

const Screen = styled.div`
  position: absolute;
  left: ${LCD.x}px;
  top: ${LCD.y}px;
  width: ${LCD.width}px;
  height: ${LCD.height}px;
  clip-path: path('${LCD_SHAPE}');
  color: var(--rk-lcd-ink);
  background: var(--rk-lcd);
  .lcd-glass {
    position: absolute;
    inset: 0;
    z-index: 3;
    /* Faint pixel grid and the shine across the glass. */
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.05) 26%, transparent 27%),
      repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.035) 0 1px, transparent 1px 2px),
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.035) 0 1px, transparent 1px 2px);
    box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.45);
  }
  .lamp {
    color: var(--rk-lamp-off);
  }
  .lamp.on {
    color: var(--rk-lcd-ink);
  }
`

const TimeButton = styled.button`
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
  }
`

/* Playlist, equalizer and visualizer take turns on the glass. */
const Panel = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: 0 -1px 0 var(--rk-lcd-soft), 0 1px 0 var(--rk-lcd-soft);
`

const ScreenReaderOnly = styled.div`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`

/* ── pieces ────────────────────────────────────────────────────────────── */

const BACK = [
  { angle: 40, length: 300 },
  { angle: 22, length: 330 },
  { angle: 6, length: 318 },
  { angle: -10, length: 290 },
]
const FRONT = [
  { angle: 31, length: 312 },
  { angle: 14, length: 324 },
  { angle: -2, length: 304 },
  { angle: -18, length: 266 },
]
const TAIL = [
  { angle: 0, length: 130 },
  { angle: 14, length: 112 },
  { angle: -14, length: 112 },
  { angle: 28, length: 86 },
  { angle: -28, length: 86 },
]

function Wing({ side }: { side: 'left' | 'right' }) {
  return (
    <g className={`wing-${side}`}>
      {BACK.map((f) => (
        <path key={f.angle} className="plume back title-bar" d={feather(side, f.angle, f.length, 30).d} />
      ))}
      {FRONT.map((f) => {
        const shape = feather(side, f.angle, f.length, 30)
        return (
          <g key={f.angle}>
            <path className="plume title-bar" d={shape.d} />
            <path className="spine" d={shape.spine} />
          </g>
        )
      })}
    </g>
  )
}

function useBitrate(track: Track | undefined, seconds: number) {
  const [bytes, setBytes] = useState<number>()
  const src = track?.src
  useEffect(() => {
    setBytes(undefined)
    const url = track ? playableUrl(track) : ''
    if (!url) return undefined
    const stop = new AbortController()
    fetch(url, { method: 'HEAD', signal: stop.signal })
      .then((r) => {
        const size = Number(r.headers.get('content-length'))
        if (r.ok && size > 0) setBytes(size)
      })
      // Hosts that hide the size just leave the readout blank.
      .catch(() => undefined)
    return () => stop.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  return estimateKbps(bytes, seconds)
}

/** Sticky per track: any audibly different moment means stereo, and mono only after a few sounding reads. */
function useChannels(radio: RadioApi) {
  const [mode, setMode] = useState<'mono' | 'stereo'>()
  const { readChannels, playing, fx, current } = radio
  const id = current?.id
  useEffect(() => setMode(undefined), [id])
  useEffect(() => {
    if (!playing || !fx) return undefined
    let sameAcross = 0
    const timer = window.setInterval(() => {
      const read = readChannels()
      if (read === 'stereo') setMode('stereo')
      if (read === 'mono') {
        sameAcross += 1
        if (sameAcross >= 4) setMode((m) => m ?? 'mono')
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [readChannels, playing, fx, id])
  return mode
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)

/* ── the player ────────────────────────────────────────────────────────── */

export default function RadioWindow() {
  const radio = useRadio()
  const clock = useRadioClock()
  const dispatch = useAppDispatch()
  const openApp = useOpenApp()
  const { chainId } = useAccount()

  const [remaining, setRemaining] = useState(false)
  const [scrub, setScrub] = useState<number | undefined>()
  const [status, setStatus] = useState<{ text: string; tone?: 'error' }>()
  const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useState<RadioLayout>(loadLayout)
  const [menu, setMenu] = useState<'options' | 'info'>()
  const [vizKind, setVizKind] = useState<VizKind>('bars')
  const rootRef = useRef<HTMLDivElement>(null)
  const [sizeRef, { width }] = useElementSize()

  useEffect(() => saveLayout(layout), [layout])
  useEffect(() => {
    dispatch(setAlwaysOnTop({ value: pageId, on: layout.onTop }))
  }, [dispatch, layout.onTop])

  // Progress notes borrow the marquee for a moment.
  useEffect(() => {
    if (!status) return undefined
    const timer = window.setTimeout(() => setStatus(undefined), 4000)
    return () => window.clearTimeout(timer)
  }, [status])

  // The glass shows the visualizer, the playlist or the equalizer.
  const view: 'eq' | 'pl' | 'viz' = layout.eq === 'open' ? 'eq' : layout.pl === 'open' ? 'pl' : 'viz'
  const show = (next: 'eq' | 'pl' | 'viz') =>
    setLayout((l) => ({
      ...l,
      eq: next === 'eq' ? 'open' : 'hidden',
      pl: next === 'pl' ? 'open' : 'hidden',
    }))

  const skin = skinById('classic')

  // Adapters: on-chain music drops per supported chain, plus the curated stations file.
  const sources = useMemo<PlaylistSource[]>(
    () => [communitySource, ...LISTED_MUSIC_CHAINS.map((c) => musicDropsSource(c.chainId)), stationSource],
    []
  )
  const defaultSource = communitySource.id

  const { queue, current } = radio
  const duration = clock.duration || current?.duration || 0
  const shown = scrub ?? clock.time
  const countdown = remaining && !!duration
  const clockSeconds = countdown ? Math.max(0, duration - shown) : shown
  const timeText = `${countdown ? '-' : ''}${formatDuration(clockSeconds)}`
  const nowIndex = queue.position >= 0 ? (queue.order[queue.position] as number) : -1

  const title = current
    ? `${nowIndex + 1}. ${current.artist ? `${current.artist} - ` : ''}${current.title} (${formatDuration(
        duration || undefined
      )})`
    : 'MIYA RADIO *** NO TRACK LOADED'

  const [checked, setChecked] = useState(false)
  const loadSource = async (id = defaultSource) => {
    const source = sources.find((s) => s.id === id) || sources[0]
    if (!source) return
    setBusy(true)
    setStatus({ text: `Loading ${source.label}…` })
    try {
      const tracks = await source.load()
      radio.enqueue(tracks)
      if (!tracks.length) setChecked(true)
      setStatus(
        tracks.length
          ? { text: `Added ${tracks.length} track${tracks.length === 1 ? '' : 's'} from ${source.label}.` }
          : { text: `${source.label}: nothing to add yet.` }
      )
    } catch (e) {
      setStatus({ text: `Could not load ${source.label}.`, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const loadTestTone = () => {
    if (!import.meta.env.DEV) return
    // Served straight from the dev server (never imported, so production builds don't ship the fixture).
    const url = '/src/music/dev-fixtures/test-tone.wav'
    radio.playNow({
      id: 'dev:test-tone',
      title: 'Test tone (synthetic C-E-G-C sine, dev fixture)',
      artist: 'miya radio',
      src: url,
      source: 'dev',
    } as Parameters<typeof radio.playNow>[0])
  }

  const play = () => {
    if (radio.playing) radio.seek(0)
    else radio.play()
  }

  const pause = () => {
    if (current) radio.toggle()
  }

  // The orb is one button: it plays what's stopped and pauses what's playing.
  const orb = () => {
    if (radio.playing) radio.pause()
    else radio.play()
  }

  // Classic player hotkeys while the radio has focus: Z prev, X play, C pause, V stop, B next.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
    const map: Record<string, (() => void) | undefined> = {
      z: current ? radio.prev : undefined,
      x: queue.tracks.length ? play : undefined,
      c: pause,
      v: current ? radio.stop : undefined,
      b: current ? radio.next : undefined,
    }
    const fn = map[e.key.toLowerCase()]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }

  const playingGlyph = radio.loading && radio.playing ? 'wait' : radio.playing ? 'play' : current ? 'pause' : 'stop'
  const paused = !!current && !radio.playing && clock.time > 0
  const live = radio.fx && !!current
  const seekMax = duration || 1
  const seekValue = Math.min(shown, seekMax)
  const commitSeek = () => {
    if (scrub !== undefined) radio.seek(scrub)
    setScrub(undefined)
  }

  const message = status?.text || radio.error
  const kbps = useBitrate(current, duration)
  const channels = useChannels(radio)
  const cycleViz = () => setVizKind((k) => VIZ_KINDS[(VIZ_KINDS.indexOf(k) + 1) % VIZ_KINDS.length] as VizKind)
  const toggleMenu = (id: 'options' | 'info') => setMenu((m) => (m === id ? undefined : id))

  const narrow = width > 0 && width <= 480
  // Phones scale the heart itself to the width; the wings run off the sides.
  const zoom = narrow ? Math.min(1, Math.floor((width / 360) * 100) / 100) : 1
  const setRoot = (el: HTMLDivElement | null) => {
    ;(rootRef as { current: HTMLDivElement | null }).current = el
    sizeRef(el)
  }

  return (
    <Root
      ref={setRoot}
      style={skin.vars}
      className={narrow ? 'narrow' : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-skin={skin.id}
    >
      <Stage>
        <Player style={{ zoom }}>
          <Layer viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true">
            {TAIL.map((t) => (
              <path key={t.angle} className="plume tail title-bar" d={tailFeather(t.angle, t.length, 28)} />
            ))}
            <Wing side="left" />
            <Wing side="right" />
          </Layer>

          <Layer viewBox={`0 0 ${PLAYER.width} ${PLAYER.height}`} aria-hidden="true">
            <defs>
              <linearGradient id="radio-feather" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.2" stopColor="#a9b6d6" />
                <stop offset="0.46" stopColor="#262c48" />
                <stop offset="0.52" stopColor="#e3e9f8" />
                <stop offset="0.68" stopColor="#59648a" />
                <stop offset="1" stopColor="#0a0d1c" />
              </linearGradient>
              <linearGradient id="radio-feather-back" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8f9ac0" />
                <stop offset="0.5" stopColor="#1b2038" />
                <stop offset="0.56" stopColor="#6a769c" />
                <stop offset="1" stopColor="#05060e" />
              </linearGradient>
              <linearGradient id="radio-tail" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#59648a" />
                <stop offset="0.5" stopColor="#c9d2ea" />
                <stop offset="1" stopColor="#0a0d1c" />
              </linearGradient>
              <radialGradient id="radio-plate" cx="0.42" cy="0.24" r="0.9">
                <stop offset="0" stopColor="#4d2478" />
                <stop offset="0.45" stopColor="#23103e" />
                <stop offset="1" stopColor="#07030f" />
              </radialGradient>
              {/* Banded like a chrome ball reflecting a horizon: the look of late-90s rendered metal. */}
              <linearGradient id="radio-chrome" x1="0" y1="0" x2="0.25" y2="1">
                <stop offset="0" stopColor="#f6f8ff" />
                <stop offset="0.3" stopColor="#a4adc6" />
                <stop offset="0.48" stopColor="#4b5270" />
                <stop offset="0.53" stopColor="#dfe5f5" />
                <stop offset="0.75" stopColor="#8089a6" />
                <stop offset="1" stopColor="#2c3048" />
              </linearGradient>
              {/* Rounds whatever it's applied to into a lit, bulging solid. */}
              <filter id="radio-solid" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
                <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="height" />
                <feSpecularLighting
                  in="height"
                  surfaceScale="5"
                  specularConstant="1.05"
                  specularExponent="22"
                  lightingColor="#ffffff"
                  result="shine"
                >
                  <fePointLight x="150" y="-80" z="210" />
                </feSpecularLighting>
                <feComposite in="shine" in2="SourceAlpha" operator="in" result="lit" />
                <feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" />
              </filter>
              <filter id="radio-drop" x="-15%" y="-15%" width="130%" height="130%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#02010a" floodOpacity="0.75" />
              </filter>
            </defs>

            {/* The plate stays dark; only the rim around it catches the light. */}
            <path className="heart-body title-bar" transform={`scale(${SCALE})`} d={HEART_PATH} />
            <g filter="url(#radio-solid)">
              <path className="heart-rim" transform={`scale(${SCALE})`} d={HEART_PATH} />
            </g>

            {/* Arms running down from the dials to the transport, with the beads strung along them. */}
            <g filter="url(#radio-drop)">
              <g filter="url(#radio-solid)">
                <path className="tube" strokeWidth="9" d="M131 130Q134 224 192 272" />
                <path className="tube" strokeWidth="9" d="M409 130Q406 224 348 272" />
                <path className="tube" strokeWidth="11" d="M146 112H160" />
                <path className="tube" strokeWidth="11" d="M394 112H380" />
                <circle className="pod" cx="131" cy="112" r="23" />
                <circle className="pod" cx="409" cy="112" r="23" />
                <path className="collar" d={COLLAR} />
              </g>
            </g>
            {/* The recess the glass sits in. */}
            <path
              transform={`translate(${LCD.x} ${LCD.y})`}
              d={LCD_SHAPE}
              fill="#0a0814"
              stroke="#0a0814"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <circle cx="270" cy="288" r="25" fill="#0a0814" />
          </Layer>

          <Controls className="console" aria-label={Pages.radio?.label} role="group">
            <Etched style={{ left: 124, top: 79 }}>
              <PixelText text="VOL" />
            </Etched>
            <Etched style={{ left: 402, top: 79 }}>
              <PixelText text="BAL" />
            </Etched>

            <Dial
              label="Volume"
              style={at(114, 95, 34, 34)}
              min={0}
              max={1}
              step={0.01}
              value={radio.volume}
              text={`${Math.round(radio.volume * 100)}%`}
              onChange={radio.setVolume}
            />
            <Dial
              center
              label="Balance"
              style={at(392, 95, 34, 34)}
              min={-1}
              max={1}
              step={0.1}
              value={radio.balance}
              text={
                radio.balance === 0
                  ? 'centre'
                  : `${Math.round(Math.abs(radio.balance) * 100)}% ${radio.balance < 0 ? 'left' : 'right'}`
              }
              onChange={radio.setBalance}
              onReset={() => radio.setBalance(0)}
            />

            {/* The cleft: window controls on the right lobe, options on the left. */}
            <Bead
              $size={13}
              style={at(181, 31)}
              aria-label="Options"
              title="Options"
              aria-expanded={menu === 'options'}
              onClick={() => toggleMenu('options')}
            >
              <PixelText text="O" />
            </Bead>
            <Bead
              $size={13}
              style={at(205, 25)}
              aria-label="Track info"
              title="Track info"
              aria-expanded={menu === 'info'}
              onClick={() => toggleMenu('info')}
            >
              <PixelText text="I" />
            </Bead>
            <Bead
              $size={13}
              style={at(322, 25)}
              aria-label="Minimize"
              title="Minimize"
              onClick={() => dispatch(minimizeWindow({ value: pageId }))}
            >
              <svg
                width="7"
                height="7"
                viewBox="0 0 7 7"
                fill="currentColor"
                shapeRendering="crispEdges"
                aria-hidden="true"
              >
                <path d="M1 5h5v1H1z" />
              </svg>
            </Bead>
            <Bead
              $size={13}
              style={at(346, 31)}
              aria-label="Close"
              title={radio.playing ? 'Close (music keeps playing in the taskbar)' : 'Close'}
              onClick={() => dispatch(closeWindow({ value: pageId }))}
            >
              <svg
                width="7"
                height="7"
                viewBox="0 0 7 7"
                fill="currentColor"
                shapeRendering="crispEdges"
                aria-hidden="true"
              >
                <path d="M1 1h1v1H1zM5 1h1v1H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3zM2 4h1v1H2zM4 4h1v1H4zM1 5h1v1H1zM5 5h1v1H5z" />
              </svg>
            </Bead>

            {/* Left arm: what the glass shows. Right arm: how the list plays. */}
            <Bead
              $size={20}
              $lit={view === 'pl'}
              style={at(125, 170)}
              aria-label="Playlist"
              title="Playlist"
              aria-pressed={view === 'pl'}
              onClick={() => show('pl')}
            >
              <PixelText text="PL" />
            </Bead>
            <Bead
              $size={20}
              $lit={view === 'eq'}
              style={at(140, 206)}
              aria-label="Equalizer"
              title="Equalizer"
              aria-pressed={view === 'eq'}
              onClick={() => show('eq')}
            >
              <PixelText text="EQ" />
            </Bead>
            <Bead
              $size={20}
              $lit={view === 'viz'}
              style={at(155, 236)}
              aria-label="Visualizer"
              title="Visualizer. Press again to switch style."
              aria-pressed={view === 'viz'}
              onClick={() => (view === 'viz' ? cycleViz() : show('viz'))}
            >
              <PixelText text="VS" />
            </Bead>
            <Bead
              $size={20}
              $lit={queue.shuffle}
              style={at(395, 170)}
              aria-label="Shuffle"
              title="Shuffle"
              aria-pressed={queue.shuffle}
              onClick={radio.toggleShuffle}
            >
              <PixelText text="SH" />
            </Bead>
            <Bead
              $size={20}
              $lit={queue.repeat !== 'off'}
              style={at(380, 206)}
              aria-label={`Repeat: ${queue.repeat}`}
              title="Repeat: off / all / one"
              aria-pressed={queue.repeat !== 'off'}
              onClick={radio.cycleRepeat}
            >
              <PixelText text={queue.repeat === 'one' ? 'R1' : 'RP'} />
            </Bead>
            <Bead
              $size={20}
              $lit={layout.onTop}
              style={at(365, 236)}
              aria-label="Always on top"
              title="Always on top"
              aria-pressed={layout.onTop}
              onClick={() => setLayout((l) => ({ ...l, onTop: !l.onTop }))}
            >
              <PixelText text="AT" />
            </Bead>

            <Bead
              $size={24}
              style={at(179, 259)}
              aria-label="Previous"
              title="Previous (Z)"
              onClick={radio.prev}
              disabled={!current}
            >
              <Glyph kind="prev" size={10} />
            </Bead>
            <Bead
              $size={24}
              style={at(208, 282)}
              aria-label="Stop"
              title="Stop (V)"
              onClick={radio.stop}
              disabled={!current}
            >
              <Glyph kind="stop" size={10} />
            </Bead>
            <Bead
              $size={24}
              style={at(308, 282)}
              aria-label="Eject: add tracks"
              title="Eject: add tracks"
              onClick={() => show('pl')}
            >
              <Glyph kind="eject" size={10} />
            </Bead>
            <Bead
              $size={24}
              style={at(337, 259)}
              aria-label="Next"
              title="Next (B)"
              onClick={radio.next}
              disabled={!current}
            >
              <Glyph kind="next" size={10} />
            </Bead>
            <Bead
              $orb
              $size={42}
              $lit={radio.playing}
              style={at(249, 267)}
              aria-label={radio.playing ? 'Pause' : 'Play'}
              title={radio.playing ? 'Pause (C)' : 'Play (X)'}
              onClick={orb}
              disabled={!queue.tracks.length}
            >
              <Glyph kind={radio.playing ? 'pause' : 'play'} size={14} />
            </Bead>

            <Screen>
              <Marquee value={message || title} width={MARQUEE_WIDTH} style={at(8, 19)} />

              <span style={at(8, 32, 9, 9)} title={radio.loading && radio.playing ? 'Loading' : undefined}>
                <Glyph kind={playingGlyph} size={9} />
              </span>
              <TimeButton
                type="button"
                style={at(14, 30, 60, 13)}
                onClick={() => setRemaining((r) => !r)}
                title={remaining ? 'Showing time remaining' : 'Showing elapsed time'}
                aria-label={`Time ${timeText}${remaining ? ' remaining' : ''}. Click to switch elapsed and remaining.`}
              >
                <Clock seconds={clockSeconds} negative={countdown} blank={!current} paused={paused} />
              </TimeButton>

              <span style={at(76, 29)} title="Average bitrate, from the file's size and length">
                <PixelText text={`${kbps && kbps < 10000 ? String(kbps).padStart(4, ' ') : '  --'} KBPS`} />
              </span>
              <span style={at(76, 38)} title="Output sample rate">
                <PixelText
                  text={`${
                    live && radio.sampleRate ? String(Math.round(radio.sampleRate / 1000)).padStart(4, ' ') : '  --'
                  } KHZ`}
                />
              </span>

              <span style={at(128, 28, 80, 16)}>
                {/* The small analyzer also drives the wings. */}
                <Visualizer
                  compact
                  kind={vizKind}
                  onCycle={cycleViz}
                  mode={radio.visualizer}
                  playing={radio.playing}
                  getAnalyser={radio.getAnalyser}
                  skin={skin.id}
                  levelTarget={rootRef}
                />
              </span>

              <Panel style={at(4, 47, 208, 98)}>
                {view === 'viz' && (
                  <Visualizer
                    kind={vizKind}
                    onCycle={cycleViz}
                    mode={radio.visualizer}
                    playing={radio.playing}
                    getAnalyser={radio.getAnalyser}
                    skin={skin.id}
                  />
                )}
                {view === 'eq' && <Equalizer radio={radio} />}
                {view === 'pl' && (
                  <Playlist
                    radio={radio}
                    nowIndex={nowIndex}
                    nowDuration={duration}
                    sources={sources}
                    busy={busy}
                    checked={checked}
                    onLoad={loadSource}
                    onDropMusic={() => openApp('dropmusic')}
                    onUpload={() => openApp('station')}
                    onTestTone={import.meta.env.DEV ? loadTestTone : undefined}
                    onInfo={() => setMenu('info')}
                  />
                )}
              </Panel>

              <Slider
                $thumb={22}
                $thumbH={8}
                aria-label="Seek"
                aria-valuetext={`${formatDuration(seekValue)} of ${formatDuration(duration || undefined)}`}
                min={0}
                max={seekMax}
                step={0.1}
                value={seekValue}
                style={at(10, 149, 196, 10)}
                disabled={!current || !duration}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={commitSeek}
                onKeyUp={commitSeek}
              />

              <span style={at(30, 163)}>
                <PixelText text={`TRK ${positionLabel(queue)}`} />
              </span>
              <span className={`lamp${channels === 'mono' ? ' on' : ''}`} style={at(104, 163)}>
                <PixelText text="MONO" />
              </span>
              <span className={`lamp${channels === 'stereo' ? ' on' : ''}`} style={at(132, 163)}>
                <PixelText text="STEREO" />
              </span>

              <div className="lcd-glass" />
            </Screen>

            {menu === 'options' && (
              <Menu label="Options" style={{ left: 186, top: 44 }} onClose={() => setMenu(undefined)}>
                {(
                  [
                    ['Time remaining', remaining, () => setRemaining((r) => !r)],
                    ['Always on top', layout.onTop, () => setLayout((l) => ({ ...l, onTop: !l.onTop }))],
                    ['Equalizer on', radio.eq.enabled, () => radio.setEq({ enabled: !radio.eq.enabled })],
                    ['Shuffle', queue.shuffle, radio.toggleShuffle],
                  ] as const
                ).map(([label, on, action]) => (
                  <button type="button" key={label} aria-pressed={on} onClick={action}>
                    <span>{label}</span>
                    <span>{on ? '✓' : ''}</span>
                  </button>
                ))}
                <button type="button" onClick={radio.cycleRepeat}>
                  <span>Repeat</span>
                  <span>{queue.repeat}</span>
                </button>
                <button type="button" onClick={cycleViz}>
                  <span>Visualizer</span>
                  <span>{VIZ_LABEL[vizKind]}</span>
                </button>
              </Menu>
            )}
            {menu === 'info' && (
              <Menu label="Track info" style={{ left: 165, top: 84, width: 210 }} onClose={() => setMenu(undefined)}>
                {current ? (
                  <dl>
                    <dt>Title</dt>
                    <dd title={current.title}>{current.title}</dd>
                    <dt>Artist</dt>
                    <dd>{current.artist || 'Unknown'}</dd>
                    <dt>Length</dt>
                    <dd>{formatDuration(duration || undefined)}</dd>
                    <dt>Bitrate</dt>
                    <dd>{kbps ? `about ${kbps} kbps` : 'Unknown'}</dd>
                    <dt>Channels</dt>
                    <dd>{channels || 'Unknown'}</dd>
                    <dt>Source</dt>
                    <dd>{current.token ? `On-chain, token ${current.token.tokenId}` : current.source}</dd>
                  </dl>
                ) : (
                  <dl>
                    <dt>Track</dt>
                    <dd>Nothing loaded</dd>
                  </dl>
                )}
              </Menu>
            )}

            <ScreenReaderOnly role={radio.error ? 'alert' : 'status'}>{message}</ScreenReaderOnly>
          </Controls>
        </Player>
      </Stage>
    </Root>
  )
}

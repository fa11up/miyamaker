import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount } from 'wagmi'

import Pages from '@/constants/pages'
import { useRadio, useRadioClock } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import { MUSIC_CHAINS, musicConfig } from '@/music/config'
import { matchPreset } from '@/music/eq'
import { positionLabel } from '@/music/queue'
import { musicDropsSource, stationSource } from '@/music/sources'
import type { PlaylistSource } from '@/music/types'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import type { PageKey } from '@/store/windows/reducer'
import { font } from '@/theme/tokens'

import Equalizer from './Equalizer'
import { Glyph } from './Glyph'
import { feather, HEART_PATH, pivot, tailFeather, VIEW } from './heartGeometry'
import { Key, Led, Slider, wingHeart } from './parts'
import Playlist, { playlistSummary } from './Playlist'
import SegmentTime from './SegmentTime'
import type { RadioLayout } from './skins'
import { loadLayout, saveLayout, skinById } from './skins'
import Visualizer from './Visualizer'

const pageId = 'radio' as PageKey

/* ── the shape: a winged heart with a classic hi-fi console on its chest ──── */

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

  /* Phones: it fills the screen on its own backdrop, so the desktop's icons don't show through. */
  &.narrow {
    overflow-y: auto;
    background: radial-gradient(90% 50% at 50% 22%, #3a1a66 0%, #150a2c 70%, #07040f 100%);
  }
  &&.narrow {
    pointer-events: auto;
  }
`

const Shape = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  aspect-ratio: ${VIEW.width} / ${VIEW.height};
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
    fill: url(#radio-heart);
    stroke: url(#radio-chrome-rim);
    stroke-width: 9;
  }
  .heart-gloss {
    fill: url(#radio-gloss);
  }
  @media (prefers-reduced-motion: reduce) {
    .wing-left,
    .wing-right {
      transform: none;
    }
  }
`

const bevelOut = `inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo)`
const bevelIn = `inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi)`

const Console = styled.div`
  position: absolute;
  top: 54px;
  left: 50%;
  width: 352px;
  transform: translateX(-50%);
  padding: 3px;
  color: var(--rk-frame-ink);
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, var(--rk-frame) 0%, var(--rk-frame-2) 100%);
  box-shadow: ${bevelOut}, 0 0 0 1px #05060e, 0 8px 16px rgba(4, 2, 12, 0.6);

  .narrow & {
    position: relative;
    top: auto;
    left: auto;
    transform: none;
    width: auto;
    margin: 56px 8px 12px;
  }
`

const TitleStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  height: 18px;
  padding: 0 2px;
  cursor: grab;
  user-select: none;
  background: linear-gradient(90deg, var(--rk-strip-a), var(--rk-strip-b));
  color: var(--rk-strip-ink);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  img {
    width: 16px;
    height: 16px;
    border: none;
    image-rendering: pixelated;
  }
  img:hover {
    border: none;
  }
  .rule {
    flex: 1 1 auto;
    height: 7px;
    background: repeating-linear-gradient(180deg, var(--rk-strip-rule) 0 1px, transparent 1px 3px);
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    color: var(--rk-frame-ink);
    background: var(--rk-btn);
    box-shadow: ${bevelOut};
  }
  button:active {
    box-shadow: ${bevelIn};
  }
  button:focus-visible {
    outline: 1px dotted #fff;
  }
`

const Screen = styled.div`
  margin-top: 3px;
  padding: 5px 6px;
  background: var(--rk-lcd);
  box-shadow: ${bevelIn};
  color: var(--rk-lcd-ink);
`

const TopRow = styled.div`
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: 7px;
  align-items: stretch;
`

const TimeButton = styled.button`
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: var(--rk-lcd-ink);
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
  }
`

const Now = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 3px;
  min-width: 0;
`

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const MarqueeBox = styled.div`
  overflow: hidden;
  white-space: nowrap;
  font-size: 13px;
  line-height: 16px;
  > span {
    display: inline-block;
  }
  &.run > span {
    animation: ${scroll} var(--marquee-s, 14s) linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    &.run > span {
      display: inline;
      animation: none;
    }
    text-overflow: ellipsis;
  }
`

const Readouts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rk-lcd-soft);
  b {
    font-weight: 400;
    color: var(--rk-lcd-ink);
  }
  .lamp {
    color: var(--rk-lcd-dim);
  }
  .lamp.on {
    color: var(--rk-lcd-ink);
  }
`

/* Music, playlist and equalizer take turns in this one screen. */
const Panel = styled.div`
  height: 176px;
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--rk-lcd-dim);
  .narrow & {
    height: auto;
    min-height: 148px;
  }
`

const Heading = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 1px 4px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--rk-lcd);
  background: var(--rk-lcd-ink);
  span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: 0;
    text-transform: none;
  }
`

const Deck = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 5px;
  padding: 0 1px 1px;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  .grow {
    flex: 1 1 0;
    min-width: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rk-frame-ink);
  }
  button {
    min-width: 0;
    padding: 0 6px;
  }
`

const Notice = styled.div`
  margin-top: 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: #ff8f8f;
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

function Marquee({ value }: { value: string }) {
  const run = value.length > 26
  return (
    <MarqueeBox
      className={run ? 'run' : undefined}
      style={{ ['--marquee-s' as string]: `${Math.max(8, value.length * 0.28)}s` }}
      title={value}
    >
      <span>{run ? `${value}  ***  ${value}  ***  ` : value}</span>
    </MarqueeBox>
  )
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
  const rootRef = useRef<HTMLDivElement>(null)
  const [sizeRef, { width }] = useElementSize()

  useEffect(() => saveLayout(layout), [layout])

  // The screen shows the visualizer, the playlist or the equalizer.
  const view: 'eq' | 'pl' | 'viz' = layout.eq === 'open' ? 'eq' : layout.pl === 'open' ? 'pl' : 'viz'
  const show = (next: 'eq' | 'pl') =>
    setLayout((l) => ({
      ...l,
      eq: next === 'eq' && view !== 'eq' ? 'open' : 'hidden',
      pl: next === 'pl' && view !== 'pl' ? 'open' : 'hidden',
    }))

  const skin = skinById('classic')

  // Adapters: on-chain music drops per supported chain, plus the curated stations file.
  const sources = useMemo<PlaylistSource[]>(
    () => [...MUSIC_CHAINS.map((c) => musicDropsSource(c.chainId)), stationSource],
    []
  )
  const [sourceId, setSourceId] = useState(`drops:${musicConfig(chainId).chainId}`)

  const { queue, current } = radio
  const duration = clock.duration || current?.duration || 0
  const shown = scrub ?? clock.time
  const timeText = remaining && duration ? `-${formatDuration(Math.max(0, duration - shown))}` : formatDuration(shown)
  const nowIndex = queue.position >= 0 ? (queue.order[queue.position] as number) : -1

  const title = current
    ? `${nowIndex + 1}. ${current.artist ? `${current.artist} - ` : ''}${current.title} (${formatDuration(
        duration || undefined
      )})`
    : 'MIYA RADIO *** NO TRACK LOADED'

  const loadSource = async () => {
    const source = sources.find((s) => s.id === sourceId) || sources[0]
    if (!source) return
    setBusy(true)
    setStatus({ text: `Loading ${source.label}…` })
    try {
      const tracks = await source.load()
      radio.enqueue(tracks)
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

  // Classic player hotkeys while the radio has focus: Z prev, X play, C pause, V stop, B next.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
  const preset = matchPreset(radio.eq)
  const seekMax = duration || 1
  const seekValue = Math.min(shown, seekMax)
  const commitSeek = () => {
    if (scrub !== undefined) radio.seek(scrub)
    setScrub(undefined)
  }

  const message = status?.tone === 'error' ? status.text : radio.error

  const narrow = width > 0 && width <= 480
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
      <Shape viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true">
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
          <radialGradient id="radio-heart" cx="0.42" cy="0.28" r="0.85">
            <stop offset="0" stopColor="#7b22b8" />
            <stop offset="0.5" stopColor="#3f0f6e" />
            <stop offset="1" stopColor="#12041f" />
          </radialGradient>
          <linearGradient id="radio-gloss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="0.15" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="0.17" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <linearGradient id="radio-chrome-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#7d89ad" />
            <stop offset="0.52" stopColor="#f2f5ff" />
            <stop offset="1" stopColor="#39425f" />
          </linearGradient>
        </defs>
        {TAIL.map((t) => (
          <path key={t.angle} className="plume tail title-bar" d={tailFeather(t.angle, t.length, 28)} />
        ))}
        <Wing side="left" />
        <Wing side="right" />
        <path className="heart-body title-bar" d={HEART_PATH} />
        <path className="heart-gloss" d={HEART_PATH} />
      </Shape>

      <Console className="console" aria-label={Pages.radio?.label} role="group">
        <TitleStrip className="title-bar">
          <img src={wingHeart?.src} srcSet={wingHeart?.srcset} alt="" />
          <span className="rule" />
          <span>MIYA RADIO</span>
          <span className="rule" />
          <button
            type="button"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => dispatch(minimizeWindow({ value: pageId }))}
          >
            _
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => dispatch(closeWindow({ value: pageId }))}
          >
            ×
          </button>
        </TitleStrip>

        <Screen>
          <TopRow>
            <TimeButton
              type="button"
              onClick={() => setRemaining((r) => !r)}
              title={remaining ? 'Showing time remaining' : 'Showing elapsed time'}
              aria-label={`Time ${timeText}${remaining ? ' remaining' : ''}. Click to switch elapsed and remaining.`}
            >
              <Glyph kind={playingGlyph} />
              <SegmentTime value={timeText} height={28} blink={paused} />
            </TimeButton>
            <Now>
              <Marquee value={title} />
              <Readouts>
                <span>
                  <b>{live && radio.sampleRate ? Math.round(radio.sampleRate / 1000) : '--'}</b> kHz
                </span>
                <span>
                  trk <b>{positionLabel(queue)}</b>
                </span>
                <span className={`lamp${live ? ' on' : ''}`}>live</span>
                <span className={`lamp${live && radio.eq.enabled ? ' on' : ''}`}>eq</span>
              </Readouts>
            </Now>
          </TopRow>

          <Panel>
            {view === 'viz' && (
              <Visualizer
                mode={radio.visualizer}
                playing={radio.playing}
                getAnalyser={radio.getAnalyser}
                skin={skin.id}
                levelTarget={rootRef}
              />
            )}
            {view === 'eq' && (
              <>
                <Heading>
                  <span>Equalizer</span>
                  <span>{`${radio.eq.enabled ? 'on' : 'off'} · ${preset ? preset.label : 'custom'}`}</span>
                </Heading>
                <Equalizer radio={radio} />
              </>
            )}
            {view === 'pl' && (
              <>
                <Heading>
                  <span>Playlist</span>
                  <span>{playlistSummary(radio)}</span>
                </Heading>
                <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                  <Playlist
                    radio={radio}
                    nowIndex={nowIndex}
                    sources={sources}
                    sourceId={sourceId}
                    setSourceId={setSourceId}
                    busy={busy}
                    onLoad={loadSource}
                    onDropMusic={() => openApp('dropmusic')}
                    onTestTone={import.meta.env.DEV ? loadTestTone : undefined}
                    status={status}
                  />
                </div>
              </>
            )}
          </Panel>
        </Screen>

        {message && (
          <Notice role={radio.error ? 'alert' : 'status'} title={message}>
            {message}
          </Notice>
        )}

        <Deck>
          <Slider
            aria-label="Seek"
            aria-valuetext={`${formatDuration(seekValue)} of ${formatDuration(duration || undefined)}`}
            min={0}
            max={seekMax}
            step={0.1}
            value={seekValue}
            style={{ ['--p' as string]: seekValue / seekMax }}
            disabled={!current || !duration}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
          />
          <Row>
            <label className="grow" style={{ flexGrow: 2 }}>
              Vol
              <Slider
                aria-label="Volume"
                aria-valuetext={`${Math.round(radio.volume * 100)}%`}
                title={`Volume ${Math.round(radio.volume * 100)}%`}
                min={0}
                max={1}
                step={0.01}
                value={radio.volume}
                style={{
                  ['--p' as string]: radio.volume,
                  // Green to red as it gets louder, as on the old hi-fi sliders.
                  ['--rk-fill-b' as string]: `hsl(${Math.round(120 * (1 - radio.volume))} 100% 45%)`,
                }}
                onChange={(e) => radio.setVolume(Number(e.target.value))}
              />
            </label>
            <label className="grow">
              Bal
              <Slider
                $center
                aria-label="Balance"
                aria-valuetext={
                  radio.balance === 0
                    ? 'centre'
                    : `${Math.round(Math.abs(radio.balance) * 100)}% ${radio.balance < 0 ? 'left' : 'right'}`
                }
                title="Balance (double-click to centre)"
                min={-1}
                max={1}
                step={0.02}
                value={radio.balance}
                onChange={(e) => radio.setBalance(Number(e.target.value))}
                onDoubleClick={() => radio.setBalance(0)}
              />
            </label>
            <Key type="button" aria-pressed={view === 'eq'} onClick={() => show('eq')} title="Equalizer">
              <Led $on={view === 'eq'} /> EQ
            </Key>
            <Key type="button" aria-pressed={view === 'pl'} onClick={() => show('pl')} title="Playlist">
              <Led $on={view === 'pl'} /> PL
            </Key>
          </Row>
          <Row>
            <Key type="button" aria-label="Previous" title="Previous (Z)" onClick={radio.prev} disabled={!current}>
              <Glyph kind="prev" />
            </Key>
            <Key type="button" aria-label="Play" title="Play (X)" onClick={play} disabled={!queue.tracks.length}>
              <Glyph kind="play" />
            </Key>
            <Key
              type="button"
              aria-label="Pause"
              aria-pressed={paused}
              title="Pause (C)"
              onClick={pause}
              disabled={!current}
            >
              <Glyph kind="pause" />
            </Key>
            <Key type="button" aria-label="Stop" title="Stop (V)" onClick={radio.stop} disabled={!current}>
              <Glyph kind="stop" />
            </Key>
            <Key type="button" aria-label="Next" title="Next (B)" onClick={radio.next} disabled={!current}>
              <Glyph kind="next" />
            </Key>
            <Key
              type="button"
              aria-label="Eject: add tracks"
              title="Eject: add tracks"
              onClick={() => view !== 'pl' && show('pl')}
              style={{ marginLeft: 4 }}
            >
              ▲
            </Key>
            <span className="grow" />
            <Key type="button" aria-pressed={queue.shuffle} title="Shuffle" onClick={radio.toggleShuffle}>
              <Led $on={queue.shuffle} /> Shuf
            </Key>
            <Key
              type="button"
              aria-pressed={queue.repeat !== 'off'}
              aria-label={`Repeat: ${queue.repeat}`}
              title="Repeat: off / all / one"
              onClick={radio.cycleRepeat}
            >
              <Led $on={queue.repeat !== 'off'} /> {queue.repeat === 'one' ? 'Rep 1' : 'Rep'}
            </Key>
          </Row>
        </Deck>
      </Console>
    </Root>
  )
}

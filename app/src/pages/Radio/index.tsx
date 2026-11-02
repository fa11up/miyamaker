import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'
import { useAccount } from 'wagmi'

import MiladyFace from '@/assets/milady_pixelated.png'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
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
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { font } from '@/theme/tokens'

import Equalizer from './Equalizer'
import { Glyph } from './Glyph'
import { Key, Lcd, Led, PanelFrame, Slider, SliderLabel, Strip, wingHeart } from './parts'
import Playlist, { playlistSummary } from './Playlist'
import SegmentTime from './SegmentTime'
import type { PanelState, RadioLayout } from './skins'
import { loadLayout, nextSkin, saveLayout, skinById } from './skins'
import Visualizer from './Visualizer'

const pageId = 'radio' as PageKey

// ── layout ────────────────────────────────────────────────────────────────────

const Root = styled.div`
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: ${font.ui};
  background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0 2px, transparent 2px 6px), var(--rk-seam);
  &:focus {
    outline: none;
  }
  /* Milady watermark in the empty space left when panels are shaded or hidden. */
  > .watermark {
    position: absolute;
    z-index: -1;
    left: 0;
    right: 0;
    bottom: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    pointer-events: none;
    color: var(--rk-frame);
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    opacity: 0.35;
  }
  > .watermark img {
    width: 128px;
    height: 128px;
    image-rendering: pixelated;
    filter: invert(1);
    mix-blend-mode: screen;
    opacity: 0.6;
  }
`

const Display = styled(Lcd)`
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-areas:
    'time marquee'
    'viz info';
  gap: 6px 10px;
  padding: 8px 8px 7px;
  @media (max-width: 480px) {
    grid-template-columns: 132px minmax(0, 1fr);
  }
`

const TimeBtn = styled.button`
  all: unset;
  box-sizing: border-box;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  grid-area: time;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--rk-lcd-ink);
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
    outline-offset: 2px;
  }
  .state {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 12px;
    filter: drop-shadow(0 0 2px var(--rk-lcd-glow));
  }
  .state i {
    width: 10px;
    height: 2px;
    background: var(--rk-lcd-dim);
  }
  .state i.on {
    background: var(--rk-lcd-ink);
  }
`

const VizBox = styled.div`
  grid-area: viz;
  position: relative;
  z-index: 1;
  height: 44px;
  box-shadow: 0 0 0 1px var(--rk-lcd-dim);
`

const Info = styled.div`
  grid-area: info;
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 50px;
  gap: 6px;
  min-width: 0;
`

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const MarqueeBox = styled.div`
  grid-area: marquee;
  position: relative;
  z-index: 1;
  align-self: center;
  overflow: hidden;
  white-space: nowrap;
  padding: 3px 5px;
  background: rgba(0, 0, 0, 0.35);
  box-shadow: inset 0 0 0 1px var(--rk-lcd-dim);
  color: var(--rk-lcd-ink);
  font-size: 15px;
  line-height: 18px;
  letter-spacing: 0.04em;
  text-shadow: 0 0 5px var(--rk-lcd-glow);
  > span {
    display: inline-block;
  }
  &.run > span {
    animation: ${scroll} var(--marquee-s, 14s) linear infinite;
  }
  &.mini {
    flex: 1 1 auto;
    min-width: 0;
    padding: 1px 4px;
    font-size: 13px;
    line-height: 16px;
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
  flex-direction: column;
  justify-content: space-between;
  gap: 3px;
  min-width: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--rk-lcd-soft);
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 8px;
    min-width: 0;
  }
  b {
    font-weight: 400;
    color: var(--rk-lcd-ink);
    text-shadow: 0 0 4px var(--rk-lcd-glow);
  }
  .lamp {
    color: var(--rk-lcd-dim);
  }
  .lamp.on {
    color: var(--rk-lcd-ink);
    text-shadow: 0 0 4px var(--rk-lcd-glow);
  }
  .msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-height: 13px;
  }
  .msg.err {
    color: #ff6f8f;
  }
`

const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
`
const rise = keyframes`
  0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translate(var(--dx, 4px), -26px) scale(1); opacity: 0; }
`

/** "miya cam": the pixel milady face, glowing in the skin colour, bouncing to the bass. */
const Cam = styled.div`
  --lvl: 0;
  position: relative;
  align-self: end;
  width: 50px;
  height: 50px;
  box-shadow: inset 0 0 0 1px var(--rk-lcd-dim);
  background: radial-gradient(circle at 50% 60%, var(--rk-lcd-dim), transparent 70%), var(--rk-lcd);
  overflow: hidden;
  isolation: isolate;
  /* tint the (inverted, screened) face in the skin's phosphor colour */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--rk-lcd-ink);
    mix-blend-mode: multiply;
    pointer-events: none;
  }
  img {
    position: absolute;
    left: 3px;
    top: 5px;
    width: 44px;
    height: 44px;
    image-rendering: pixelated;
    filter: invert(1);
    mix-blend-mode: screen;
    transform: translateY(calc(var(--lvl) * -5px)) scale(calc(1 + var(--lvl) * 0.1));
    transition: transform 60ms linear;
  }
  .rec {
    position: absolute;
    left: 3px;
    top: 3px;
    width: 4px;
    height: 4px;
    background: var(--rk-lcd-dim);
  }
  .heart {
    position: absolute;
    bottom: 4px;
    width: 5px;
    height: 5px;
    opacity: 0;
    color: var(--rk-lcd-ink);
  }
  &.on .rec {
    background: #ff4f7b;
    box-shadow: 0 0 4px #ff4f7b;
  }
  &.on.idle img {
    animation: ${bob} 0.9s steps(2) infinite;
  }
  &.on .heart {
    animation: ${rise} 2.4s linear infinite;
  }
  &.on .heart:nth-of-type(2) {
    --dx: -6px;
    left: 8px;
    animation-delay: 0.8s;
  }
  &.on .heart:nth-of-type(3) {
    --dx: 3px;
    right: 6px;
    animation-delay: 1.6s;
  }
  @media (prefers-reduced-motion: reduce) {
    &.on.idle img,
    &.on .heart {
      animation: none;
    }
    img {
      transform: none;
      transition: none;
    }
  }
`

const Deck = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  &.sliders {
    gap: 10px;
  }
  .grow {
    flex: 1 1 auto;
  }
  .spacer {
    flex: 1 1 0;
  }
  .cluster {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--rk-seam);
    box-shadow: 0 1px 0 var(--rk-frame-hi);
  }
  @media (max-width: 480px) {
    flex-wrap: wrap;
    &.sliders {
      gap: 6px 10px;
    }
    .cluster.transport,
    .vol {
      flex: 1 1 100%;
    }
    .cluster.transport > button {
      flex: 1 1 0;
    }
  }
`

const SkinButton = styled.button`
  all: unset;
  box-sizing: border-box;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  display: grid;
  place-items: center;
  width: 38px;
  height: 30px;
  cursor: pointer;
  img {
    width: 34px;
    height: 34px;
    image-rendering: pixelated;
    filter: drop-shadow(0 0 3px var(--rk-btn-on));
    transition: transform 120ms ease;
  }
  &:hover img {
    transform: scale(1.1) rotate(-4deg);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
  }
  @media (prefers-reduced-motion: reduce) {
    img {
      transition: none;
    }
  }
`

const ShadeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  .cluster {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--rk-seam);
  }
  .cluster button {
    min-width: 24px;
    padding: 0 4px;
  }
  .lcd {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 5px;
  }
  .lcd > * {
    position: relative;
    z-index: 1;
  }
  .viz {
    flex: 0 0 56px;
    height: 18px;
  }
  @media (max-width: 480px) {
    .viz {
      display: none;
    }
  }
`

const SrOnly = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`

function Marquee({ value, mini }: { value: string; mini?: boolean }) {
  const run = value.length > (mini ? 24 : 34)
  const cls = [run ? 'run' : '', mini ? 'mini' : ''].join(' ').trim() || undefined
  return (
    <MarqueeBox className={cls} style={{ ['--marquee-s' as string]: `${Math.max(8, value.length / 4)}s` }}>
      <span aria-hidden="true">{run ? `${value}  ✦ ✦ ✦  ${value}  ✦ ✦ ✦  ` : value}</span>
      <SrOnly>{value}</SrOnly>
    </MarqueeBox>
  )
}

const HEART = 'M1 1h1v1H1zM3 1h1v1H3zM0 2h5v1H0zM1 3h3v1H1zM2 4h1v1H2z'

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)

export default function RadioWindow() {
  const radio = useRadio()
  const clock = useRadioClock()
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const openApp = useOpenApp()
  const { chainId } = useAccount()

  const [remaining, setRemaining] = useState(false)
  const [scrub, setScrub] = useState<number | undefined>()
  const [status, setStatus] = useState<{ text: string; tone?: 'error' }>()
  const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useState<RadioLayout>(loadLayout)
  const camRef = useRef<HTMLDivElement>(null)

  useEffect(() => saveLayout(layout), [layout])
  const patch = (p: Partial<RadioLayout>) => setLayout((l) => ({ ...l, ...p }))
  const togglePanel = (key: 'eq' | 'pl') =>
    patch({ [key]: (layout[key] === 'hidden' ? 'open' : 'hidden') as PanelState })
  const shadePanel = (key: 'eq' | 'pl') => patch({ [key]: (layout[key] === 'shade' ? 'open' : 'shade') as PanelState })

  const skin = skinById(layout.skin)

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
    : 'miya radio ✦ no track loaded ✦ add a source below'

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
      duration: 2,
      source: 'dev',
    })
  }

  const play = () => {
    if (radio.playing) radio.seek(0)
    else radio.play()
  }

  const pause = () => {
    if (current) radio.toggle()
  }

  // Classic player hotkeys while the radio window has focus: Z prev, X play, C pause, V stop, B next.
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
  const repeatLabel = queue.repeat === 'one' ? 'Rep 1' : 'Rep'
  const seekMax = duration || 1
  const seekValue = Math.min(shown, seekMax)

  const message = radio.error
    ? radio.error
    : radio.loading && radio.playing
    ? 'Buffering…'
    : current?.token
    ? `Token #${current.token.tokenId}`
    : radio.visualizer === 'reduced'
    ? 'Visuals still (reduced motion)'
    : current && radio.visualizer === 'unavailable'
    ? 'Plain audio · no live visuals'
    : ''

  const transport = (small?: boolean) => (
    <span className="cluster transport">
      <Key type="button" aria-label="Previous" title="Previous (Z)" onClick={radio.prev} disabled={!current}>
        <Glyph kind="prev" />
      </Key>
      <Key
        type="button"
        aria-label="Play"
        title="Play (X)"
        onClick={play}
        disabled={!queue.tracks.length}
        $wide={!small}
      >
        <Glyph kind="play" />
      </Key>
      <Key type="button" aria-label="Pause" aria-pressed={paused} title="Pause (C)" onClick={pause} disabled={!current}>
        <Glyph kind="pause" />
      </Key>
      <Key type="button" aria-label="Stop" title="Stop (V)" onClick={radio.stop} disabled={!current}>
        <Glyph kind="stop" />
      </Key>
      <Key type="button" aria-label="Next" title="Next (B)" onClick={radio.next} disabled={!current}>
        <Glyph kind="next" />
      </Key>
    </span>
  )

  const clockButton = (height: number) => (
    <TimeBtn
      type="button"
      onClick={() => setRemaining((r) => !r)}
      title={remaining ? 'Showing time remaining (click for elapsed)' : 'Showing elapsed time (click for remaining)'}
      aria-label={`Time ${timeText}${remaining ? ' remaining' : ''}. Click to switch elapsed and remaining.`}
    >
      <span className="state" aria-hidden="true">
        <Glyph kind={playingGlyph} />
        {height > 20 && <i className={live ? 'on' : undefined} />}
      </span>
      <SegmentTime value={timeText} height={height} blink={paused} />
    </TimeBtn>
  )

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: pageId }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: pageId }))
        }}
      >
        {Pages.radio?.label}
      </TitleBar>
      <Root style={skin.vars} onKeyDown={onKeyDown} data-skin={skin.id}>
        <div className="watermark" aria-hidden="true">
          <img src={MiladyFace} alt="" />
          <span>double-click a strip to roll it down</span>
        </div>
        {/* ── main player ── */}
        <PanelFrame className={layout.main === 'shade' ? 'shaded' : undefined} aria-label="Player">
          <Strip
            label="miya radio"
            extra={layout.main === 'shade' ? undefined : 'v98'}
            shaded={layout.main === 'shade'}
            onShade={() => patch({ main: layout.main === 'shade' ? 'open' : 'shade' })}
            panelId="radio-main"
          />
          {layout.main === 'shade' ? (
            <ShadeRow id="radio-main">
              <Lcd className="lcd">
                {clockButton(16)}
                <Marquee value={title} mini />
                <div className="viz">
                  <Visualizer
                    compact
                    mode={radio.visualizer}
                    playing={radio.playing}
                    getAnalyser={radio.getAnalyser}
                    skin={skin.id}
                  />
                </div>
              </Lcd>
              {transport(true)}
            </ShadeRow>
          ) : (
            <div id="radio-main">
              <Display aria-label="Now playing">
                {clockButton(30)}
                <Marquee value={title} />
                <VizBox>
                  <Visualizer
                    mode={radio.visualizer}
                    playing={radio.playing}
                    getAnalyser={radio.getAnalyser}
                    skin={skin.id}
                    levelTarget={camRef}
                  />
                </VizBox>
                <Info>
                  <Readouts>
                    <div className="row">
                      <span>
                        kHz <b>{live && radio.sampleRate ? Math.round(radio.sampleRate / 1000) : '--'}</b>
                      </span>
                      <span>
                        Trk <b>{positionLabel(queue)}</b>
                      </span>
                      <span>
                        Src <b>{current ? current.source : '—'}</b>
                      </span>
                    </div>
                    <div className="row" aria-label="Indicators">
                      <span className={`lamp${live ? ' on' : ''}`}>Live</span>
                      <span className={`lamp${live && radio.eq.enabled ? ' on' : ''}`}>EQ</span>
                      <span className={`lamp${queue.shuffle ? ' on' : ''}`}>Shuf</span>
                      <span className={`lamp${queue.repeat !== 'off' ? ' on' : ''}`}>
                        {queue.repeat === 'one' ? 'Rep1' : 'Rep'}
                      </span>
                    </div>
                    <div
                      className={`msg${radio.error ? ' err' : ''}`}
                      role={radio.error ? 'alert' : undefined}
                      title={message}
                    >
                      {message || ' '}
                    </div>
                  </Readouts>
                  <Cam
                    ref={camRef}
                    aria-hidden="true"
                    className={[radio.playing ? 'on' : '', radio.visualizer !== 'live' ? 'idle' : ''].join(' ').trim()}
                  >
                    <span className="rec" />
                    <img src={MiladyFace} alt="" />
                    {[0, 1, 2].map((i) => (
                      <svg key={i} className="heart" viewBox="0 0 5 5" fill="currentColor" style={{ left: 18 }}>
                        <path d={HEART} />
                      </svg>
                    ))}
                  </Cam>
                </Info>
              </Display>

              <Deck>
                <Row className="sliders">
                  <SliderLabel className="grow vol" style={{ flexGrow: 2 }}>
                    <span>Vol</span>
                    <Slider
                      aria-label="Volume"
                      aria-valuetext={`${Math.round(radio.volume * 100)}%`}
                      title={`Volume ${Math.round(radio.volume * 100)}%`}
                      min={0}
                      max={1}
                      step={0.01}
                      value={radio.volume}
                      style={{ ['--p' as string]: radio.volume }}
                      onChange={(e) => radio.setVolume(Number(e.target.value))}
                    />
                  </SliderLabel>
                  <SliderLabel className="grow">
                    <span>Bal</span>
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
                  </SliderLabel>
                  <span className="cluster">
                    <Key
                      type="button"
                      aria-pressed={layout.eq !== 'hidden'}
                      onClick={() => togglePanel('eq')}
                      title="Show or hide the equalizer"
                    >
                      <Led $on={layout.eq !== 'hidden'} /> EQ
                    </Key>
                    <Key
                      type="button"
                      aria-pressed={layout.pl !== 'hidden'}
                      onClick={() => togglePanel('pl')}
                      title="Show or hide the playlist"
                    >
                      <Led $on={layout.pl !== 'hidden'} /> PL
                    </Key>
                  </span>
                </Row>

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
                  onPointerUp={() => {
                    if (scrub !== undefined) radio.seek(scrub)
                    setScrub(undefined)
                  }}
                  onKeyUp={() => {
                    if (scrub !== undefined) radio.seek(scrub)
                    setScrub(undefined)
                  }}
                />

                <Row>
                  {transport()}
                  <span className="cluster">
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
                      <Led $on={queue.repeat !== 'off'} /> {repeatLabel}
                    </Key>
                  </span>
                  <span className="spacer" />
                  <SkinButton
                    type="button"
                    onClick={() => patch({ skin: nextSkin(skin.id) })}
                    aria-label={`Skin: ${skin.label}. Click for the next skin.`}
                    title={`Skin: ${skin.label} (click to change)`}
                  >
                    <img src={wingHeart?.src} srcSet={wingHeart?.srcset} alt="" />
                  </SkinButton>
                </Row>
              </Deck>
            </div>
          )}
        </PanelFrame>

        {/* ── equalizer ── */}
        {layout.eq !== 'hidden' && (
          <PanelFrame className={layout.eq === 'shade' ? 'shaded' : undefined} aria-label="Equalizer">
            <Strip
              label="Equalizer"
              extra={`${radio.eq.enabled ? 'on' : 'off'} · ${preset ? preset.label : 'custom'}`}
              shaded={layout.eq === 'shade'}
              onShade={() => shadePanel('eq')}
              onHide={() => patch({ eq: 'hidden' })}
              panelId="radio-eq"
            />
            {layout.eq === 'open' && (
              <div id="radio-eq">
                <Equalizer radio={radio} />
              </div>
            )}
          </PanelFrame>
        )}

        {/* ── playlist ── */}
        {layout.pl !== 'hidden' && (
          <PanelFrame
            className={layout.pl === 'shade' ? 'shaded' : 'grow'}
            aria-label="Playlist editor"
            style={{ minHeight: layout.pl === 'shade' ? undefined : 200 }}
          >
            <Strip
              label="Playlist"
              extra={layout.pl === 'shade' && current ? `${nowIndex + 1}. ${current.title}` : playlistSummary(radio)}
              shaded={layout.pl === 'shade'}
              onShade={() => shadePanel('pl')}
              onHide={() => patch({ pl: 'hidden' })}
              panelId="radio-pl"
            />
            {layout.pl === 'open' && (
              <div id="radio-pl" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
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
            )}
          </PanelFrame>
        )}
      </Root>
    </WindowWrapper>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import { useRadio } from '@/context/RadioProvider'
import { fetchStation, toTrack } from '@/music/community'
import { Glyph } from '@/pages/Radio/Glyph'
import { font, text } from '@/theme/tokens'

import { airList, nextTapeId } from '../../../api/_lib/publicaccess'
import type { BreakLog, Commercial } from './commercials'
import { COMMERCIALS, DRAWN_SECONDS, isBreakDue, nextSpotIndex, SKIP_AFTER_SECONDS } from './commercials'
import { fetchTapes } from './publicAccess'
import { parseVitals, SQUEEK_API, wheelSeconds } from './squeek'
import { firstMode, runVisuals, seedOf, VIZ_H, VIZ_MODES, VIZ_W } from './visuals'
import YouTubePlayer from './YouTubePlayer'

const Stage = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0a0503;
  color: #f3e7cf;
`

const Words = styled.div`
  position: absolute;
  left: 18px;
  bottom: 14px;
  right: 18px;
  z-index: 2;
  text-shadow: 0 2px 4px #000;
  strong {
    display: block;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xl};
    line-height: 1.1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  span {
    font-size: ${text.sm};
  }
  .narrow & strong {
    font-size: ${text.md};
  }
`

const Centre = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
  h2 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xxl};
    line-height: 1.05;
    text-shadow: 3px 3px 0 #8a4a14;
  }
  p {
    margin: 0;
    max-width: 44ch;
    padding: 4px 10px;
    border-radius: 6px;
    background: rgba(16, 9, 4, 0.72);
    font-size: ${text.sm};
    line-height: 1.4;
  }
  button {
    min-height: 44px;
    padding: 0 22px;
    border: none;
    border-radius: 5px;
    background: linear-gradient(180deg, #f2a23c 0%, #cf6a1c 100%);
    box-shadow:
      0 3px 0 #6e3208,
      inset 0 1px 0 rgba(255, 255, 255, 0.45);
    color: #fff7e6;
    font-family: ${font.display};
    font-size: ${text.md};
    cursor: pointer;
  }
  button:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 #6e3208;
  }
`

/* ---------- miya radio: a picture generated from the sound ---------- */

const Picture = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`

/** The player's controls, over the picture: they show when the pointer is there, or whenever it is paused. */
const Deck = styled.div`
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 3;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(16, 9, 4, 0.82);
  box-shadow:
    0 0 0 1px #a97f28,
    0 3px 10px rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 160ms;
  ${Stage}:hover &,
  &:focus-within,
  &.held {
    opacity: 1;
  }
  @media (hover: none) {
    opacity: 1;
  }
  button {
    display: inline-grid;
    place-items: center;
    min-width: 34px;
    height: 32px;
    padding: 0 6px;
    border: none;
    border-radius: 5px;
    background: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
    box-shadow: 0 2px 0 #6d5c3c;
    color: #2a1a0e;
    font-size: ${text.xs};
    cursor: pointer;
    white-space: nowrap;
  }
  button:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: 0 1px 0 #6d5c3c;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.main {
    min-width: 44px;
    height: 38px;
    background: linear-gradient(180deg, #f2a23c 0%, #cf6a1c 100%);
    box-shadow: 0 2px 0 #6e3208;
    color: #fff7e6;
  }
  button[aria-pressed='true'] {
    background: linear-gradient(180deg, #ffe08a 0%, #d9a838 100%);
  }
  .rule {
    width: 1px;
    height: 24px;
    background: #6d5c3c;
  }
  .mode {
    min-width: 64px;
    text-align: center;
    font-size: ${text.xs};
    color: #ecd48a;
  }
  .narrow & .mode {
    min-width: 0;
  }
`

const TrackWords = styled(Words)`
  top: 12px;
  right: auto;
  bottom: auto;
  max-width: calc(100% - 36px);
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(16, 9, 4, 0.72);
`

/** How long a mode stays before the next one, when they are changing on their own. */
const MODE_SECONDS = 40

export function RadioShow({ reducedMotion }: { reducedMotion: boolean }) {
  const radio = useRadio()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState(0)
  const [auto, setAuto] = useState(true)
  const [note, setNote] = useState<string>()
  const trackId = radio.current?.id ?? ''
  const seed = seedOf(trackId)

  // The frame loop reads these fresh, so a new track or mode does not restart it.
  const live = useRef({ mode, seed, playing: radio.playing, getAnalyser: radio.getAnalyser })
  live.current = { mode, seed, playing: radio.playing, getAnalyser: radio.getAnalyser }

  useEffect(() => {
    if (!canvas.current) return undefined
    return runVisuals(
      canvas.current,
      () => ({
        mode: live.current.mode,
        seed: live.current.seed,
        playing: live.current.playing,
        analyser: live.current.playing ? live.current.getAnalyser() : null,
      }),
      reducedMotion,
    )
  }, [reducedMotion])

  // Each song opens on its own mode, unless someone has chosen one and turned Auto off.
  useEffect(() => {
    if (trackId && auto) setMode(firstMode(seed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId])

  useEffect(() => {
    if (!auto || !radio.playing) return undefined
    const change = setInterval(() => setMode((m) => (m + 1) % VIZ_MODES.length), MODE_SECONDS * 1000)
    return () => clearInterval(change)
  }, [auto, radio.playing, mode])

  const stepMode = (by: number) => {
    setAuto(false)
    setMode((m) => (m + by + VIZ_MODES.length) % VIZ_MODES.length)
  }

  const tuneIn = async () => {
    setNote(undefined)
    try {
      const tracks = (await fetchStation()).tracks.map(toTrack)
      if (!tracks[0]) {
        setNote('Nothing on the station yet.')
        return
      }

      radio.enqueue(tracks)
      radio.playNow(tracks[0])
    } catch {
      setNote('Could not reach the station. Try again in a minute.')
    }
  }

  return (
    <Stage>
      <Picture ref={canvas} width={VIZ_W} height={VIZ_H} />
      {radio.current ? (
        <>
          <TrackWords>
            <strong>{radio.current.title}</strong>
            <span>{radio.current.artist}</span>
          </TrackWords>
          <Deck className={radio.playing ? undefined : 'held'} role="group" aria-label="Player">
            <button type="button" aria-label="Go back" title="Go back" onClick={radio.prev}>
              <Glyph kind="prev" size={12} />
            </button>
            <button
              type="button"
              className="main"
              aria-label={radio.playing ? 'Pause' : 'Play'}
              title={radio.playing ? 'Pause' : 'Play'}
              onClick={radio.toggle}
            >
              <Glyph kind={radio.playing ? 'pause' : 'play'} size={14} />
            </button>
            <button type="button" aria-label="Skip" title="Skip" onClick={radio.next}>
              <Glyph kind="next" size={12} />
            </button>
            <span className="rule" aria-hidden />
            <button type="button" aria-label="Previous visual" title="Previous visual" onClick={() => stepMode(-1)}>
              ‹
            </button>
            <span className="mode" aria-live="polite">
              {VIZ_MODES[mode]?.name}
            </span>
            <button type="button" aria-label="Next visual" title="Next visual" onClick={() => stepMode(1)}>
              ›
            </button>
            <button
              type="button"
              aria-pressed={auto}
              title="Change visuals on their own"
              onClick={() => setAuto((a) => !a)}
            >
              Auto
            </button>
          </Deck>
        </>
      ) : (
        <Centre>
          <h2>miya radio</h2>
          <p>The community station.</p>
          <button type="button" onClick={tuneIn}>
            Tune in
          </button>
          {note && <p>{note}</p>}
        </Centre>
      )}
    </Stage>
  )
}

/* ---------- squeekchain: the real wheel ---------- */

const spin = keyframes`
  to { transform: rotate(-360deg); }
`
const float = keyframes`
  0% { transform: translate(0, 0); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translate(22px, -46px); opacity: 0; }
`

const WheelStage = styled(Stage)`
  background: radial-gradient(ellipse at 50% 60%, #4a2c14 0%, #24130a 55%, #0a0503 100%);
  svg {
    position: absolute;
    left: 50%;
    top: 50%;
    width: min(70%, 90cqh);
    height: 86%;
    transform: translate(-50%, -50%);
  }
  /* On a phone's short picture the caption would sit on the stand. */
  .narrow & svg {
    left: 60%;
  }
  .wheel {
    transform-origin: 200px 200px;
    animation: ${spin} var(--turn, 0s) linear infinite;
  }
  .zzz {
    position: absolute;
    left: 58%;
    top: 34%;
    font-family: ${font.display};
    font-size: ${text.xl};
    color: #ecd48a;
    animation: ${float} 3s ease-out infinite;
  }
  .zzz.late {
    animation-delay: -1.5s;
  }
  @media (prefers-reduced-motion: reduce) {
    .wheel,
    .zzz {
      animation: none;
    }
  }
`

export function SqueekShow() {
  const status = useQuery({
    queryKey: ['squeek-status'],
    queryFn: async () => parseVitals(await (await fetch(`${SQUEEK_API}/status`)).json()),
    refetchInterval: 5000,
  })
  const v = status.data
  const turn = v?.running ? wheelSeconds(v.rpm) : 0
  const asleep = !v?.running
  return (
    <WheelStage style={{ ['--turn' as string]: turn ? `${turn}s` : '0s' }} data-testid="squeek-show">
      <svg viewBox="0 0 400 400" aria-hidden>
        <path d="M120 372 L200 200 L280 372" stroke="#8a5a2a" strokeWidth="14" fill="none" strokeLinecap="round" />
        <g className={turn ? 'wheel' : undefined}>
          <circle cx="200" cy="200" r="168" fill="none" stroke="#d9bb6c" strokeWidth="12" />
          <circle cx="200" cy="200" r="146" fill="none" stroke="#a97f28" strokeWidth="6" />
          {Array.from({ length: 24 }, (_, i) => (
            <line
              key={i}
              x1="200"
              y1="36"
              x2="200"
              y2="56"
              stroke="#ecd48a"
              strokeWidth="5"
              transform={`rotate(${i * 15} 200 200)`}
            />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <line
              key={i}
              x1="200"
              y1="200"
              x2="200"
              y2="56"
              stroke="#a97f28"
              strokeWidth="4"
              transform={`rotate(${i * 60} 200 200)`}
            />
          ))}
          <circle cx="200" cy="200" r="16" fill="#d9bb6c" />
        </g>
        {/* the hamster, at the bottom of the wheel */}
        <g transform={asleep ? 'translate(0 8)' : undefined}>
          <ellipse cx="200" cy="312" rx="50" ry="31" fill="#e8c79a" />
          <ellipse cx="192" cy="322" rx="30" ry="16" fill="#fff1dc" />
          <circle cx="246" cy="298" r="23" fill="#e8c79a" />
          <circle cx="238" cy="276" r="9" fill="#d9a878" />
          <circle cx="258" cy="276" r="9" fill="#d9a878" />
          {asleep ? (
            <path d="M246 296 q6 5 12 0" stroke="#2a1a0e" strokeWidth="3" fill="none" />
          ) : (
            <circle cx="253" cy="296" r="3.5" fill="#2a1a0e" />
          )}
          <circle cx="268" cy="304" r="3" fill="#d9587a" />
        </g>
      </svg>
      {asleep && v && (
        <>
          <span className="zzz" aria-hidden>
            z
          </span>
          <span className="zzz late" aria-hidden>
            z
          </span>
        </>
      )}
      <Words>
        <strong>{v ? (v.running ? `${v.rpm.toFixed(0)} RPM` : 'Off the wheel') : 'Checking the wheel…'}</strong>
        {status.isError && <span>Could not reach squeekchain.</span>}
      </Words>
    </WheelStage>
  )
}

/* ---------- public access ---------- */

const BREAK_KEY = 'miyatv.lastBreak'

function readBreak(): BreakLog | undefined {
  try {
    return JSON.parse(window.localStorage.getItem(BREAK_KEY) || 'null') ?? undefined
  } catch {
    return undefined
  }
}

const bars = keyframes`
  from { background-position: 0 0; }
  to { background-position: 0 44px; }
`

const Spot = styled(Stage)`
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  background: repeating-linear-gradient(
    90deg,
    #c8102e 0 14.28%,
    #f2a23c 14.28% 28.56%,
    #ecd48a 28.56% 42.84%,
    #3d7f4a 42.84% 57.12%,
    #1f6fa8 57.12% 71.4%,
    #5b2bc4 71.4% 85.68%,
    #1a0f06 85.68% 100%
  );
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 2px, transparent 2px 4px);
    animation: ${bars} 1.2s linear infinite;
  }
  .plate {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 8px;
    padding: 20px 34px;
    border: 3px solid #ecd48a;
    border-radius: 10px;
    background: rgba(16, 9, 4, 0.92);
  }
  .series {
    font-size: ${text.sm};
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #ecd48a;
  }
  h2 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: 54px;
    line-height: 1.02;
    color: #fff7e6;
    text-shadow: 3px 3px 0 #c8102e;
  }
  p {
    margin: 0;
    font-size: ${text.md};
    color: #f3e7cf;
  }
  .narrow & h2 {
    font-size: ${text.xl};
  }
  .narrow & .plate {
    padding: 10px 14px;
  }
  .narrow & p {
    font-size: ${text.xs};
  }
  .tag {
    position: absolute;
    z-index: 2;
    left: 14px;
    top: 12px;
    padding: 2px 8px;
    background: #1a0f06;
    color: #ffb347;
    font-size: ${text.xs};
  }
  button {
    position: absolute;
    z-index: 2;
    right: 14px;
    bottom: 12px;
    min-height: 30px;
    padding: 0 12px;
    border: none;
    border-radius: 4px;
    background: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
    box-shadow: 0 2px 0 #6d5c3c;
    color: #2a1a0e;
    font-size: ${text.xs};
    cursor: pointer;
  }
  .narrow & button {
    min-height: 36px;
  }
  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
    }
  }
`

const FilmSpot = styled(Stage)`
  background: #000;
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .tag {
    position: absolute;
    z-index: 2;
    left: 14px;
    top: 12px;
    padding: 2px 8px;
    background: rgba(16, 9, 4, 0.8);
    color: #ffb347;
    font-size: ${text.xs};
  }
  button {
    position: absolute;
    z-index: 2;
    right: 14px;
    bottom: 12px;
    min-height: 30px;
    padding: 0 12px;
    border: none;
    border-radius: 4px;
    background: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
    box-shadow: 0 2px 0 #6d5c3c;
    color: #2a1a0e;
    font-size: ${text.xs};
    cursor: pointer;
  }
  .narrow & button {
    min-height: 36px;
  }
`

function VideoSpot({
  spot,
  volume,
  muted,
  onAutoMuted,
  onDone,
}: {
  spot: Extract<Commercial, { kind: 'video' }>
  volume: number
  muted: boolean
  onAutoMuted: () => void
  onDone: () => void
}) {
  const film = useRef<HTMLVideoElement>(null)
  const [played, setPlayed] = useState(0)

  useEffect(() => {
    const v = film.current
    if (!v) return
    v.volume = volume
    v.muted = muted
  }, [volume, muted])

  useEffect(() => {
    // The browser may refuse sound until someone has clicked: then it plays muted, like the channels do.
    film.current?.play().catch(() => {
      const v = film.current
      if (!v) return
      v.muted = true
      onAutoMuted()
      v.play().catch(onDone)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const left = SKIP_AFTER_SECONDS - Math.floor(played)
  return (
    <FilmSpot data-testid="commercial">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={film}
        src={spot.src}
        playsInline
        preload="auto"
        onTimeUpdate={(e) => setPlayed(e.currentTarget.currentTime)}
        onEnded={onDone}
        onError={onDone}
      />
      <span className="tag">Commercial</span>
      {left <= 0 ? (
        <button type="button" onClick={onDone}>
          Skip ▶
        </button>
      ) : (
        <button type="button" disabled>
          Skip in {left}
        </button>
      )}
    </FilmSpot>
  )
}

function DrawnSpot({ spot, onDone }: { spot: Extract<Commercial, { kind: 'drawn' }>; onDone: () => void }) {
  const [left, setLeft] = useState(DRAWN_SECONDS)
  useEffect(() => {
    const tick = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    if (left <= 0) onDone()
  }, [left, onDone])
  return (
    <Spot data-testid="commercial">
      <span className="tag">Commercial</span>
      <div className="plate">
        <span className="series">{spot.series}</span>
        <h2>{spot.headline}</h2>
        {spot.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {DRAWN_SECONDS - left >= SKIP_AFTER_SECONDS ? (
        <button type="button" onClick={onDone}>
          Skip ▶
        </button>
      ) : (
        <button type="button" disabled>
          Back in {left}
        </button>
      )}
    </Spot>
  )
}

export function PublicShow({
  tapeId,
  paused,
  onNext,
  onBreak,
  volume,
  muted,
  onAutoMuted,
}: {
  tapeId?: string
  paused: boolean
  onNext: (videoId: string) => void
  /** A commercial is on: the set's pause and next wait for it. */
  onBreak: (on: boolean) => void
  volume: number
  muted: boolean
  onAutoMuted: () => void
}) {
  const list = useQuery({ queryKey: ['public-access'], queryFn: fetchTapes, refetchInterval: 60_000, retry: 1 })
  const tapes = airList(list.data?.tapes)
  const current = tapes.find((t) => t.videoId === tapeId) ?? tapes[0]!
  const [spot, setSpot] = useState<Commercial>()

  const onSpot = !!spot
  useEffect(() => {
    onBreak(onSpot)
    return () => onBreak(false)
  }, [onSpot, onBreak])

  const nextTape = () => {
    const next = nextTapeId(tapes, current.videoId)
    if (next) onNext(next)
  }

  // Only the natural end of a tape can lead to a break, so nothing ever cuts into one.
  const tapeEnded = () => {
    const last = readBreak()
    const now = Date.now()
    if (!isBreakDue(now, last)) {
      nextTape()
      return
    }

    const index = nextSpotIndex(last)
    try {
      window.localStorage.setItem(BREAK_KEY, JSON.stringify({ at: now, index }))
    } catch {
      // ignore
    }

    nextTape()
    setSpot(COMMERCIALS[index])
  }

  const spotDone = useCallback(() => setSpot(undefined), [])

  if (spot?.kind === 'drawn') return <DrawnSpot spot={spot} onDone={spotDone} />
  if (spot?.kind === 'video')
    return (
      <VideoSpot key={spot.id} spot={spot} volume={volume} muted={muted} onAutoMuted={onAutoMuted} onDone={spotDone} />
    )

  return (
    <YouTubePlayer
      key={current.videoId}
      videoId={current.videoId}
      volume={volume}
      muted={muted}
      paused={paused}
      onAutoMuted={onAutoMuted}
      onEnded={tapeEnded}
      onDead={nextTape}
    />
  )
}

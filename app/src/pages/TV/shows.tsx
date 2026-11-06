import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import { useRadio } from '@/context/RadioProvider'
import { fetchStation, toTrack } from '@/music/community'
import { font, text } from '@/theme/tokens'

import { airList } from '../../../api/_lib/publicaccess'
import type { BreakLog, Commercial } from './commercials'
import { COMMERCIALS, DRAWN_SECONDS, isBreakDue, nextSpotIndex, SKIP_AFTER_SECONDS } from './commercials'
import { fetchTapes } from './publicAccess'
import { parseVitals, SQUEEK_API, wheelSeconds } from './squeek'
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
    font-size: ${text.sm};
    line-height: 1.4;
  }
  button {
    min-height: 44px;
    padding: 0 22px;
    border: none;
    border-radius: 5px;
    background: linear-gradient(180deg, #f2a23c 0%, #cf6a1c 100%);
    box-shadow: 0 3px 0 #6e3208, inset 0 1px 0 rgba(255, 255, 255, 0.45);
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

const Plasma = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
`

const W = 160
const H = 90

// Warm cabinet colours running round to the site's pink and a cold teal.
const PALETTE = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255
  const wave = (shift: number) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (t + shift))
  return [Math.round(255 * wave(0.0) ** 0.8), Math.round(170 * wave(0.28)), Math.round(190 * wave(0.55))] as const
})

function usePlasma(active: boolean, getAnalyser: () => AnalyserNode | null, reduced: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return undefined
    const image = ctx.createImageData(W, H)
    let raf = 0
    let last = 0
    let phase = 0
    let bassSmooth = 0
    const spectrum = new Uint8Array(512)
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < (reduced ? 1000 : 40)) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const analyser = active ? getAnalyser() : null
      let bass = 0
      let mids = 0
      if (analyser) {
        analyser.getByteFrequencyData(spectrum)
        for (let i = 2; i < 12; i += 1) bass += spectrum[i]! / 2550
        for (let i = 12; i < 90; i += 1) mids += spectrum[i]! / 19890
      } else if (active) {
        // Playing without the analyser (a host that blocks it): keep a slow pulse so the picture stays alive.
        bass = 0.35 + 0.2 * Math.sin(now / 460)
        mids = 0.3
      }

      bassSmooth += (bass - bassSmooth) * 0.25
      phase += dt * (0.25 + mids * 1.6)
      const kaleido = 5 + Math.round(mids * 6)
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const dx = (x - W / 2) / H
          const dy = (y - H / 2) / H
          const r = Math.hypot(dx, dy)
          const a = Math.atan2(dy, dx)
          const v =
            Math.sin(r * (11 + bassSmooth * 16) - phase * 2.4) +
            Math.sin(a * kaleido + phase) * (0.5 + bassSmooth) +
            Math.sin((dx + dy) * 6 + phase * 1.3) * 0.5
          const shade = active ? 0.55 + bassSmooth * 0.6 : 0.35
          const c = PALETTE[((Math.floor(((v + 2.5) / 5 + phase * 0.05) * 255) % 256) + 256) % 256]!
          const n = (y * W + x) * 4
          image.data[n] = c[0] * shade
          image.data[n + 1] = c[1] * shade
          image.data[n + 2] = c[2] * shade
          image.data[n + 3] = 255
        }
      }

      ctx.putImageData(image, 0, 0)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, getAnalyser, reduced])
  return canvas
}

export function RadioShow({ reducedMotion }: { reducedMotion: boolean }) {
  const radio = useRadio()
  const canvas = usePlasma(radio.playing, radio.getAnalyser, reducedMotion)
  const [note, setNote] = useState<string>()

  const tuneIn = async () => {
    setNote(undefined)
    if (radio.current) {
      radio.toggle()
      return
    }

    try {
      const tracks = (await fetchStation()).tracks.map(toTrack)
      if (!tracks[0]) {
        setNote('Nothing on the station yet.')
        return
      }

      radio.enqueue(tracks)
      radio.playNow(tracks[0])
    } catch (e) {
      setNote((e as Error).message)
    }
  }

  return (
    <Stage>
      <Plasma ref={canvas} width={W} height={H} />
      {radio.playing && radio.current ? (
        <Words>
          <strong>{radio.current.title}</strong>
          <span>{radio.current.artist}</span>
        </Words>
      ) : (
        <Centre>
          <h2>miya radio</h2>
          <p>The community station. The picture is drawn live from whatever is playing.</p>
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
        {status.isError ? <span>Could not reach squeekchain.</span> : v && <span>Block {v.blockHeight} · testnet</span>}
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
  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
    }
  }
`

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
  onNext,
  volume,
  muted,
  onAutoMuted,
}: {
  tapeId?: string
  onNext: (videoId: string) => void
  volume: number
  muted: boolean
  onAutoMuted: () => void
}) {
  const list = useQuery({ queryKey: ['public-access'], queryFn: fetchTapes, refetchInterval: 60_000, retry: 1 })
  const tapes = airList(list.data?.tapes)
  const current = tapes.find((t) => t.videoId === tapeId) ?? tapes[0]!
  const [spot, setSpot] = useState<Commercial>()

  const nextTape = () => {
    const next = tapes[(tapes.indexOf(current) + 1) % tapes.length]
    if (next) onNext(next.videoId)
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
  if (spot?.kind === 'youtube')
    return (
      <YouTubePlayer
        key={spot.id}
        videoId={spot.videoId}
        volume={volume}
        muted={muted}
        onAutoMuted={onAutoMuted}
        onEnded={spotDone}
      />
    )

  return (
    <YouTubePlayer
      key={current.videoId}
      videoId={current.videoId}
      volume={volume}
      muted={muted}
      onAutoMuted={onAutoMuted}
      onEnded={tapeEnded}
    />
  )
}

import { useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components/macro'

import DropMusicIcon from '@/assets/icon/drop_music.png'
import { formatDuration } from '@/music/audio'
import { bevel, color, font, space, text } from '@/theme/tokens'

import StageViz from './StageViz'
import type { StudioPlayer } from './useStudioPlayer'
import Waveform from './Waveform'
import { brushedSilver, gel, y2k } from './y2k'

export type StageStatus = 'soundcheck' | 'ready' | 'rec' | 'onair'

const SIGN: Record<StageStatus, string> = {
  soundcheck: 'soundcheck',
  ready: 'studio',
  rec: '● rec',
  onair: 'on air',
}

/* ── keyframes ─────────────────────────────────────────────────────────── */

const spin = keyframes`to { transform: rotate(360deg); }`
const sway = keyframes`
  0%, 100% { transform: rotate(var(--from)); }
  50% { transform: rotate(var(--to)); }
`
const twinkle = keyframes`
  0%, 100% { opacity: 0; transform: scale(0.4); }
  50% { opacity: 1; transform: scale(1); }
`
const flicker = keyframes`
  0%, 18%, 22%, 60%, 100% { opacity: 1; }
  20%, 61% { opacity: 0.45; }
`
const blink = keyframes`50% { opacity: 0.25; }`
const scroll = keyframes`to { transform: translateX(-50%); }`
const gridRun = keyframes`to { background-position: 0 32px, 0 0; }`
const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`
const pop = keyframes`
  0% { transform: scale(0.2) rotate(-30deg); opacity: 0; }
  70% { transform: scale(1.15) rotate(8deg); opacity: 1; }
  100% { transform: scale(1) rotate(6deg); }
`

/* ── scene ─────────────────────────────────────────────────────────────── */

const Scene = styled.div`
  --lvl: 0;
  position: relative;
  height: 270px;
  overflow: hidden;
  background: radial-gradient(120% 90% at 50% 0%, #1b57d6 0%, #0a2a7a 45%, #02071c 100%);
  border-radius: 14px;
  box-shadow: ${bevel.sunken};
  isolation: isolate;
  .narrow & {
    height: 236px;
  }
  .wide & {
    height: 400px;
  }
  &.onair {
    background: radial-gradient(120% 90% at 50% 0%, #19b6e8 0%, #0b3fa8 50%, #02071c 100%);
  }
  /* the room flashes with the kick */
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
    background: radial-gradient(60% 70% at 50% 75%, rgba(39, 211, 255, 0.55), transparent 70%);
    opacity: calc(var(--lvl) * var(--lvl) * 0.9);
    mix-blend-mode: screen;
  }
  /* scanlines */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.12) 0 1px, transparent 1px 3px);
    z-index: 20;
  }
`

const Floor = styled.div<{ $run: boolean }>`
  position: absolute;
  left: -40%;
  right: -40%;
  bottom: -10px;
  height: 46%;
  transform: perspective(160px) rotateX(58deg);
  transform-origin: 50% 100%;
  background-image: linear-gradient(rgba(39, 211, 255, 0.7) 1px, transparent 1px),
    linear-gradient(90deg, rgba(39, 211, 255, 0.55) 1px, transparent 1px);
  background-size: 100% 32px, 32px 100%;
  mask-image: linear-gradient(to top, #000 30%, transparent 100%);
  -webkit-mask-image: linear-gradient(to top, #000 30%, transparent 100%);
  opacity: calc(0.45 + var(--lvl) * 0.5);
  z-index: 1;
  ${({ $run }) =>
    $run &&
    css`
      animation: ${gridRun} 0.9s linear infinite;
    `}
`

const Beam = styled.span<{ $x: string; $from: number; $to: number; $tint: string; $dur: number }>`
  position: absolute;
  top: -20px;
  left: ${({ $x }) => $x};
  width: 90px;
  height: 340px;
  margin-left: -45px;
  transform-origin: 50% 0;
  --from: ${({ $from }) => $from}deg;
  --to: ${({ $to }) => $to}deg;
  transform: rotate(var(--from));
  background: linear-gradient(to bottom, ${({ $tint }) => $tint}, transparent 85%);
  clip-path: polygon(44% 0, 56% 0, 100% 100%, 0 100%);
  opacity: calc(0.16 + var(--lvl) * 0.5);
  mix-blend-mode: screen;
  z-index: 2;
  animation: ${sway} ${({ $dur }) => $dur}s ease-in-out infinite;
  .still & {
    animation: none;
  }
  .onair & {
    opacity: calc(0.35 + var(--lvl) * 0.5);
  }
`

const Sparkle = styled.span<{ $x: string; $y: string; $d: number }>`
  position: absolute;
  left: ${({ $x }) => $x};
  top: ${({ $y }) => $y};
  width: 9px;
  height: 9px;
  z-index: 3;
  background: ${color.highlight};
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  animation: ${twinkle} 2.4s ease-in-out ${({ $d }) => $d}s infinite;
  .still & {
    animation: none;
    opacity: 0.6;
  }
`

const Sign = styled.div<{ $status: StageStatus }>`
  position: absolute;
  top: ${space[2]};
  left: ${space[2]};
  z-index: 12;
  padding: 2px 10px 4px;
  font-family: ${font.display};
  font-size: ${text.lg};
  line-height: 1.1;
  text-transform: lowercase;
  letter-spacing: 0.04em;
  border: 2px solid currentColor;
  border-radius: 6px;
  color: ${({ $status }) => ($status === 'rec' ? '#ff5d73' : $status === 'onair' ? '#ffe27a' : '#f5c6f6')};
  text-shadow: 0 0 6px currentColor, 0 0 14px currentColor;
  box-shadow: 0 0 10px currentColor, inset 0 0 10px currentColor;
  background: rgba(20, 16, 31, 0.6);
  animation: ${({ $status }) => ($status === 'rec' ? blink : flicker)} ${({ $status }) => ($status === 'rec' ? 1 : 4)}s
    steps(1) infinite;
  .still & {
    animation: none;
  }
  .narrow & {
    font-size: ${text.sm};
  }
`

const Marquee = styled.div`
  position: absolute;
  top: ${space[2]};
  right: ${space[2]};
  z-index: 12;
  width: min(52%, 320px);
  height: 26px;
  overflow: hidden;
  background: ${y2k.lcd};
  border: 1px solid #9fb3d6;
  border-radius: 6px;
  box-shadow: inset 0 1px 4px #000;
  color: ${y2k.lcdText};
  font-family: ${font.mono};
  font-size: 12px;
  line-height: 24px;
  text-transform: uppercase;
  white-space: nowrap;
  text-shadow: 0 0 6px rgba(182, 255, 60, 0.7);
  .track {
    display: inline-block;
    padding-left: 4px;
    animation: ${scroll} var(--dur, 14s) linear infinite;
  }
  .still & .track {
    animation: none;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .narrow & {
    top: 46px;
    left: ${space[2]};
    width: auto;
  }
`

/* ── speakers ──────────────────────────────────────────────────────────── */

const Speaker = styled.div<{ $side: 'left' | 'right' }>`
  position: absolute;
  bottom: 22px;
  ${({ $side }) => $side}: 18px;
  z-index: 6;
  width: 74px;
  height: 128px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  ${brushedSilver}
  border-radius: 10px;
  border: 1px solid ${y2k.silverLine};
  box-shadow: inset 0 1px 0 #fff, 0 3px 8px rgba(0, 0, 0, 0.55);
  i {
    display: block;
    border-radius: 50%;
    background: radial-gradient(circle, #5d4d86 0 18%, #1b1430 20% 46%, #3b2f5c 48% 60%, #0d0a17 62%);
    box-shadow: 0 0 0 2px #0a0712, 0 0 calc(var(--lvl) * 16px) rgba(39, 211, 255, 0.8);
    transform: scale(calc(1 + var(--lvl) * 0.12));
  }
  i:first-child {
    width: 34px;
    height: 34px;
  }
  i:last-child {
    width: 52px;
    height: 52px;
    transform: scale(calc(1 + var(--lvl) * 0.18));
  }
  .narrow & {
    display: none;
  }
`

/* ── jewel case + disc ─────────────────────────────────────────────────── */

const Rig = styled.div<{ $out: boolean }>`
  position: absolute;
  left: 50%;
  bottom: 30px;
  z-index: 8;
  width: 172px;
  height: 172px;
  transform: translateX(${({ $out }) => ($out ? '-78%' : '-50%')});
  transition: transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1);
  .bob {
    position: absolute;
    inset: 0;
    animation: ${bob} 3.2s ease-in-out infinite;
  }
  .still & {
    transition: none;
  }
  .still & .bob {
    animation: none;
  }
  .narrow & {
    width: 128px;
    height: 128px;
    bottom: 22px;
  }
  .wide & {
    width: 236px;
    height: 236px;
    bottom: 44px;
  }
`

const Disc = styled.div<{ $out: boolean; $spin: boolean; $fast: boolean }>`
  position: absolute;
  top: 6px;
  left: 6px;
  width: calc(100% - 12px);
  height: calc(100% - 12px);
  transform: translateX(${({ $out }) => ($out ? '58%' : '8%')});
  transition: transform 700ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms;
  z-index: 0;
  .still & {
    transition: none;
  }
  .face {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    position: relative;
    background: repeating-radial-gradient(circle, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px 3px),
      conic-gradient(from 20deg, #e9e6f7, #f5c6f6, #9fe3ff, #e9e6f7, #ffe27a, #d97ada, #c4bfe0, #9fe3ff, #e9e6f7);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 calc(8px + var(--lvl) * 22px) rgba(217, 122, 218, 0.55);
    animation: ${spin} ${({ $fast }) => ($fast ? 0.8 : 1.9)}s linear infinite;
    animation-play-state: ${({ $spin }) => ($spin ? 'running' : 'paused')};
  }
  .label {
    position: absolute;
    inset: 24%;
    border-radius: 50%;
    overflow: hidden;
    background: ${color.accent};
    box-shadow: 0 0 0 2px rgba(20, 16, 31, 0.5);
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border: none;
      margin: 0;
      max-width: none;
    }
  }
  .hole {
    position: absolute;
    inset: 45%;
    border-radius: 50%;
    background: #21153d;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.55);
  }
  .still & .face {
    animation: none;
  }
`

const Case = styled.button`
  all: unset;
  box-sizing: border-box;
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: pointer;
  padding: 4px 4px 4px 14px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.55), rgba(220, 216, 240, 0.25));
  box-shadow: 0 0 0 1px rgba(20, 16, 31, 0.8), inset 0 0 0 1px rgba(255, 255, 255, 0.6), 5px 6px 0 rgba(0, 0, 0, 0.45);
  /* hinge */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 11px;
    background: repeating-linear-gradient(180deg, rgba(20, 16, 31, 0.55) 0 2px, rgba(255, 255, 255, 0.35) 2px 5px);
    border-right: 1px solid rgba(20, 16, 31, 0.6);
  }
  /* plastic gloss */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      120deg,
      rgba(255, 255, 255, 0.5) 0 18%,
      transparent 19% 58%,
      rgba(255, 255, 255, 0.18) 59% 64%,
      transparent 65%
    );
  }
  &:hover .art {
    filter: brightness(1.06);
  }
  &:focus-visible {
    outline: 2px dotted ${color.highlight};
    outline-offset: 3px;
  }
  .art {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${color.dark};
    img.cover {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border: none;
      margin: 0;
      max-width: none;
    }
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
    color: ${color.ink};
    font-size: ${text.xs};
    background-color: ${color.faceLight};
    background-image: linear-gradient(45deg, ${color.light} 25%, transparent 25%, transparent 75%, ${color.light} 75%),
      linear-gradient(45deg, ${color.light} 25%, transparent 25%, transparent 75%, ${color.light} 75%);
    background-size: 8px 8px;
    background-position: 0 0, 4px 4px;
    img {
      width: 48px;
      image-rendering: pixelated;
      border: none;
      margin: 0;
    }
  }
  .credits {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 6px 5px;
    background: linear-gradient(to top, rgba(20, 16, 31, 0.85), transparent);
    color: ${color.highlight};
    text-shadow: 1px 1px 0 ${color.dark};
    pointer-events: none;
  }
  .t {
    display: block;
    font-family: ${font.display};
    font-size: 15px;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .a {
    display: block;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #f5c6f6;
  }
  .narrow & .t {
    font-size: 12px;
  }
`

const Sticker = styled.span<{ $gold: boolean }>`
  position: absolute;
  z-index: 3;
  top: -16px;
  right: -18px;
  width: 72px;
  height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 10px;
  line-height: 1.1;
  text-transform: uppercase;
  color: ${({ $gold }) => ($gold ? color.dark : color.highlight)};
  background: ${({ $gold }) => ($gold ? '#ffe27a' : color.accent)};
  clip-path: polygon(
    50% 0,
    61% 12%,
    76% 6%,
    80% 22%,
    96% 26%,
    90% 41%,
    100% 54%,
    87% 63%,
    90% 80%,
    74% 81%,
    66% 96%,
    52% 87%,
    37% 98%,
    30% 82%,
    13% 83%,
    15% 66%,
    0 56%,
    11% 43%,
    4% 27%,
    21% 22%,
    25% 6%,
    40% 12%
  );
  transform: rotate(6deg);
  animation: ${pop} 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  pointer-events: none;
  b {
    font-size: 13px;
  }
  .tiny {
    font-size: 9px;
    white-space: nowrap;
  }
  .still & {
    animation: none;
  }
  .narrow & {
    width: 54px;
    height: 54px;
    font-size: 9px;
    b {
      font-size: 10px;
    }
  }
`

/* ── transport ─────────────────────────────────────────────────────────── */

const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[1]} ${space[2]};
  min-height: 48px;
  margin-top: ${space[1]};
  ${brushedSilver}
  border: 1px solid ${y2k.silverLine};
  border-radius: 999px;
  color: ${y2k.ink};
  .time {
    padding: 2px 8px;
    border-radius: 6px;
    background: ${y2k.lcd};
    box-shadow: inset 0 1px 3px #000;
    font-family: ${font.mono};
    font-size: 12px;
    color: ${y2k.lcdText};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .hint {
    flex: 1 1 auto;
    min-width: 0;
    font-size: ${text.xs};
    color: ${y2k.ink};
  }
  .narrow & .time .total {
    display: none;
  }
`

const PlayButton = styled.button`
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  ${gel('#7ecbff', y2k.blue, '#ffffff')}
  border-radius: 50%;
  cursor: pointer;
  svg {
    width: 16px;
    height: 16px;
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:focus-visible {
    outline: 2px dotted ${color.highlight};
    outline-offset: -6px;
  }
  &:disabled {
    ${gel('#e4e9f3', '#a9b5cb', '#6b7894')}
    cursor: not-allowed;
  }
`

const DeckButton = styled.button`
  flex: 0 0 auto;
  ${gel('#f4f7fd', '#b7c4dc', y2k.ink)}
  min-height: 32px;
  padding: 0 ${space[3]};
  font-size: ${text.xs};
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) {
    ${gel('#d9f6ff', y2k.aqua, y2k.navy)}
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
  &.hot {
    ${gel('#e6ffb0', y2k.lime, y2k.navy)}
    font-weight: 700;
    font-size: ${text.sm};
    min-height: 40px;
    padding: 0 ${space[3]};
  }
`

const DropVeil = styled.div`
  position: absolute;
  inset: 6px;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ${font.display};
  font-size: ${text.lg};
  color: ${color.highlight};
  text-shadow: 2px 2px 0 ${color.accentDark};
  background: rgba(217, 122, 218, 0.28);
  outline: 3px dashed ${color.accent};
  outline-offset: -3px;
  pointer-events: none;
`

const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 10 10" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path d={d} />
  </svg>
)
const PLAY = 'M2 1h1v8H2zM3 2h1v6H3zM4 2h1v6H4zM5 3h1v4H5zM6 3h1v4H6zM7 4h1v2H7z'
const PAUSE = 'M2 1h2v8H2zM6 1h2v8H6z'

const BEAMS = [
  { x: '18%', from: -28, to: 14, tint: color.accent, dur: 6.5 },
  { x: '50%', from: 18, to: -18, tint: '#9fe3ff', dur: 8 },
  { x: '82%', from: 26, to: -12, tint: '#8f5fd0', dur: 7.2 },
]
const SPARKLES = [
  { x: '8%', y: '38%', d: 0 },
  { x: '27%', y: '20%', d: 0.8 },
  { x: '66%', y: '30%', d: 1.6 },
  { x: '88%', y: '44%', d: 0.4 },
  { x: '40%', y: '12%', d: 2 },
  { x: '75%', y: '58%', d: 1.2 },
]

export type StageProps = {
  status: StageStatus
  statusLabel: string
  marquee: string
  reduced: boolean
  coverUrl?: string
  title: string
  artist: string
  sticker?: { big: string; small: string; tiny?: string; gold?: boolean }
  hasTrack: boolean
  trackLabel?: string
  player: StudioPlayer
  analysable: boolean
  peaks?: number[]
  duration?: number
  busy: boolean
  onChooseTrack: () => void
  onChooseCover: () => void
  onDropFile: (file: File) => void
  onSendToRadio?: () => void
}

/**
 * The Drop Music stage: a little night-club scene where the release takes shape. The cover sits in a jewel case
 * that prints the title and artist as they are typed, the disc slides out once a track is loaded and spins while
 * it plays, and the floor, lights and speakers move to the music. Drop files anywhere on it.
 */
export default function Stage(p: StageProps) {
  const root = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const { player } = p
  const dur = player.duration || p.duration || 0
  const playingLive = player.playing && p.analysable
  const mood = p.reduced ? 'still' : playingLive ? 'live' : player.playing || p.busy ? 'synth' : 'idle'
  const marqueeText = `${p.marquee}   ★   `

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Scene
        ref={root}
        className={[p.reduced ? 'still' : '', p.status === 'onair' ? 'onair' : ''].join(' ')}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          Array.from(e.dataTransfer.files)
            .slice(0, 2)
            .forEach((f) => p.onDropFile(f))
        }}
      >
        {BEAMS.map((b) => (
          <Beam key={b.x} $x={b.x} $from={b.from} $to={b.to} $tint={b.tint} $dur={b.dur} aria-hidden />
        ))}
        {SPARKLES.map((s) => (
          <Sparkle key={s.x} $x={s.x} $y={s.y} $d={s.d} aria-hidden />
        ))}
        <Floor $run={!p.reduced && (player.playing || p.busy)} aria-hidden />
        <StageViz mood={mood} getAnalyser={player.getAnalyser} levelTarget={root} />
        <Speaker $side="left" aria-hidden>
          <i />
          <i />
        </Speaker>
        <Speaker $side="right" aria-hidden>
          <i />
          <i />
        </Speaker>

        <Sign $status={p.status} role="status" aria-label={p.statusLabel} title={p.statusLabel}>
          {SIGN[p.status]}
        </Sign>
        <Marquee aria-hidden style={{ ['--dur' as string]: `${Math.max(8, marqueeText.length / 5)}s` }}>
          <span className="track">
            {marqueeText}
            {!p.reduced && marqueeText}
          </span>
        </Marquee>

        <Rig $out={p.hasTrack}>
          <div className="bob">
            <Disc $out={p.hasTrack} $spin={!p.reduced && (player.playing || p.busy)} $fast={p.busy} aria-hidden>
              <div className="face">
                <div className="label">{p.coverUrl && <img src={p.coverUrl} alt="" />}</div>
                <div className="hole" />
              </div>
            </Disc>
            <Case
              type="button"
              onClick={p.onChooseCover}
              aria-label={p.coverUrl ? 'Change cover art' : 'Add cover art'}
              title={p.coverUrl ? 'Change cover art' : 'Add cover art'}
            >
              <span className="art">
                {p.coverUrl ? (
                  <img className="cover" src={p.coverUrl} alt="" />
                ) : (
                  <span className="empty">
                    <img src={DropMusicIcon} alt="" />
                    <span>+ cover art</span>
                  </span>
                )}
                {(p.title || p.artist) && (
                  <span className="credits">
                    <span className="t">{p.title || 'Untitled'}</span>
                    <span className="a">{p.artist || 'unknown artist'}</span>
                  </span>
                )}
              </span>
            </Case>
            {p.sticker && (
              <Sticker key={`${p.sticker.big}${p.sticker.gold}`} $gold={!!p.sticker.gold} aria-hidden>
                <b>{p.sticker.big}</b>
                <span>{p.sticker.small}</span>
                {p.sticker.tiny && <span className="tiny">{p.sticker.tiny}</span>}
              </Sticker>
            )}
          </div>
        </Rig>

        {over && <DropVeil aria-hidden>let go to load it ♪</DropVeil>}
      </Scene>

      <Transport>
        {p.hasTrack ? (
          <>
            <PlayButton
              type="button"
              onClick={player.toggle}
              disabled={dur <= 0 && !!player.error}
              aria-label={player.playing ? 'Pause track' : 'Play track'}
              title={player.playing ? 'Pause' : 'Play'}
            >
              <Glyph d={player.playing ? PAUSE : PLAY} />
            </PlayButton>
            <span className="time">
              {formatDuration(player.time)}
              <span className="total"> / {formatDuration(dur || undefined)}</span>
            </span>
            {player.error ? (
              <span className="hint" role="alert">
                {player.error}
              </span>
            ) : (
              <Waveform
                peaks={p.peaks}
                duration={dur}
                time={player.time}
                playing={player.playing}
                getTime={player.getTime}
                onSeek={player.seek}
              />
            )}
            {p.onSendToRadio && (
              <DeckButton type="button" onClick={p.onSendToRadio} title="Play it in miya radio">
                Play in radio
              </DeckButton>
            )}
          </>
        ) : (
          <>
            <DeckButton type="button" className="hot" onClick={p.onChooseTrack}>
              ♪ Choose a track
            </DeckButton>
            <span className="hint">or drop an audio file on the stage. Cover art too.</span>
          </>
        )}
      </Transport>
    </div>
  )
}

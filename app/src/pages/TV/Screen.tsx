import styled from 'styled-components/macro'

import { color, font, space, text } from '@/theme/tokens'

import type { Channel, Source } from './channels'
import { embedSrc } from './channels'
import { PublicShow, RadioShow, SqueekShow } from './shows'
import YouTubePlayer from './YouTubePlayer'

const Player = styled.iframe`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #000;
`

const Card = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space[3]};
  padding: ${space[4]};
  text-align: center;
  color: ${color.highlight};
  background: radial-gradient(ellipse at 50% 40%, #4a2c14 0%, #24130a 55%, #0a0503 100%);
  overflow: hidden;

  /* faint scanlines on our own cards only (never over a third-party player) */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 3px);
  }

  h2 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xxl};
    line-height: 1.05;
    text-shadow: 3px 3px 0 #8a4a14;
    .narrow & {
      font-size: ${text.xl};
    }
  }
  p {
    margin: 0;
    max-width: 46ch;
    font-family: ${font.body};
    font-size: 14px;
    line-height: 1.5;
    color: ${color.light};
    .narrow & {
      font-size: 13px;
    }
  }
  .tag {
    font-size: ${text.xs};
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #f2a23c;
  }

  /* Phones: the glass is ~200px tall, keep only the name, the button and the note. */
  .narrow & {
    gap: ${space[2]};
    padding: ${space[2]};
  }
  .narrow & .tag,
  .narrow & .tagline {
    display: none;
  }
  .narrow & p {
    font-size: 12px;
  }
`

export default function Screen({
  channel,
  source,
  volume,
  muted,
  onAutoMuted,
  tapeId,
  onTape,
  reducedMotion,
}: {
  channel: Channel
  source: Source | undefined
  volume: number
  muted: boolean
  onAutoMuted: () => void
  tapeId?: string
  onTape: (videoId: string) => void
  reducedMotion: boolean
}) {
  if (channel.kind === 'show') {
    if (channel.show === 'radio') return <RadioShow reducedMotion={reducedMotion} />
    if (channel.show === 'squeek') return <SqueekShow />
    return <PublicShow tapeId={tapeId} onNext={onTape} volume={volume} muted={muted} onAutoMuted={onAutoMuted} />
  }

  if (channel.kind === 'iframe' && source?.provider === 'youtube') {
    return (
      <YouTubePlayer
        key={source.videoId}
        videoId={source.videoId}
        volume={volume}
        muted={muted}
        onAutoMuted={onAutoMuted}
      />
    )
  }

  if (channel.kind === 'iframe' && source) {
    const src = embedSrc(source)
    return (
      <Player
        key={src}
        src={src}
        title={`${channel.name}: ${source.label}`}
        // Third-party players need scripts + their own origin (cookies/storage); popups so their
        // "watch on X/Kick" links open, escaping our sandbox. No forms, no top navigation.
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    )
  }

  // TODO(native): attach hls.js to a <video> for channel.hls once miyatv runs its own streams.
  return (
    <Card>
      <span className="tag">no signal</span>
      <h2>{channel.name}</h2>
      <p>Our own streams are coming. This channel has no player yet.</p>
    </Card>
  )
}

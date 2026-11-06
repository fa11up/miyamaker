import styled from 'styled-components/macro'

import { color, font, space, text } from '@/theme/tokens'

import type { Channel, Source } from './channels'
import { embedSrc, hostOf } from './channels'

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
  background: radial-gradient(ellipse at 50% 40%, #3b2f6e 0%, #1a1433 55%, #07050d 100%);
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
    text-shadow: 3px 3px 0 ${color.accentDark};
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
    color: ${color.accent};
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

const Watch = styled.a`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  min-height: 48px;
  padding: 0 ${space[5]};
  outline: 1px solid ${color.dark};
  outline-offset: -1px;
  background: ${color.accent};
  color: ${color.ink};
  font-family: ${font.display};
  font-size: ${text.lg};
  letter-spacing: 0.04em;
  text-decoration: none;
  text-shadow: 2px 2px 0 #f5c6f6;
  box-shadow: inset -2px -2px ${color.accentDark}, inset 2px 2px #f5c6f6;
  &:hover {
    background: #e48fe5;
  }
  &:active {
    box-shadow: inset 2px 2px ${color.accentDark}, inset -2px -2px #f5c6f6;
  }
  &:focus-visible {
    outline: 2px dotted ${color.highlight};
    outline-offset: 3px;
  }
  .narrow & {
    font-size: ${text.sm};
    padding: 0 ${space[3]};
    min-height: 44px;
  }
`

export default function Screen({
  channel,
  source,
  muted = true,
}: {
  channel: Channel
  source: Source | undefined
  muted?: boolean
}) {
  if (channel.kind === 'iframe' && source) {
    const src = embedSrc(source, muted)
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

  if (channel.kind === 'external') {
    return (
      <Card data-testid="tv-external-card">
        <span className="tag">CH {String(channel.number).padStart(2, '0')} · external</span>
        <h2>{channel.name}</h2>
        <p className="tagline">{channel.tagline}</p>
        <Watch href={channel.href} target="_blank" rel="noopener noreferrer">
          {channel.cta} ↗
        </Watch>
        <p style={{ fontSize: 12 }}>
          {hostOf(channel.href)} can’t be embedded, so it opens in a new tab. Chat stays here.
        </p>
      </Card>
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

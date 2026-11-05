import { Fragment } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import DropMusicIcon from '@/assets/icon/drop_music.png'
import { Eyebrow, Panel, Well } from '@/components/Retro'
import { bevel, color, font, space, text } from '@/theme/tokens'

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
  gap: ${space[3]};
  align-items: start;
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Col = styled.figure`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  min-width: 0;
`

const Card = styled(Panel)`
  padding: ${space[2]};
  gap: ${space[2]};
  .narrow & {
    max-width: 220px;
  }
`

const Art = styled(Well)`
  position: relative;
  aspect-ratio: 1 / 1;
  padding: 3px;
  overflow: hidden;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border: none;
    margin: 0;
    max-width: none;
  }
  .ph {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${color.light};
    img {
      width: 48px;
      height: auto;
      image-rendering: pixelated;
    }
  }
  .play {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${color.accent};
    color: ${color.ink};
    box-shadow: inset -2px -2px ${color.accentDark}, inset 2px 2px #f5c6f6, 2px 2px 0 ${color.dark};
  }
`

const Line = styled.div<{ $strong?: boolean }>`
  font-size: ${({ $strong }) => ($strong ? text.sm : text.xs)};
  font-weight: ${({ $strong }) => ($strong ? 700 : 400)};
  color: ${({ $strong }) => ($strong ? color.ink : color.inkMuted)};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FakeMint = styled.div`
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${text.xs};
  background: ${color.face};
  box-shadow: ${bevel.raised};
`

const marquee = keyframes`to { transform: translateX(-50%); }`
const bounce = keyframes`
  0%, 100% { transform: scaleY(0.25); }
  50% { transform: scaleY(1); }
`

const Deck = styled.div`
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${color.dark};
  box-shadow: ${bevel.sunken};
  color: ${color.light};
  font-family: ${font.mono};
  font-size: 12px;
  .thumb {
    width: 56px;
    height: 56px;
    background: #251d3a;
    box-shadow: ${bevel.sunken};
    padding: 2px;
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
  .lcd {
    overflow: hidden;
    white-space: nowrap;
    color: ${color.accent};
    text-shadow: 0 0 6px rgba(217, 122, 218, 0.55);
    text-transform: uppercase;
  }
  .lcd span {
    display: inline-block;
    animation: ${marquee} 12s linear infinite;
  }
  .meta {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: ${space[2]};
    margin-top: 6px;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 18px;
  }
  .bars i {
    width: 4px;
    height: 100%;
    background: linear-gradient(to top, ${color.accentDark}, ${color.accent}, #f5c6f6);
    transform-origin: bottom;
    animation: ${bounce} 0.9s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .lcd span,
    .bars i {
      animation: none;
    }
    .bars i {
      transform: scaleY(0.6);
    }
  }
`

const Ticket = styled.dl`
  margin: ${space[2]} 0 0;
  padding: ${space[2]} ${space[3]};
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px ${space[3]};
  font-size: ${text.sm};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  border-top: 3px dashed ${color.accent};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
`

const Glyph = () => (
  <svg viewBox="0 0 10 10" width="16" height="16" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M2 1h1v8H2zM3 2h1v6H3zM4 2h1v6H4zM5 3h1v4H5zM6 3h1v4H6zM7 4h1v2H7z" />
  </svg>
)

/**
 * How the release will look once it is out: its card under Mint → Music and its "now playing" line in miya radio.
 * Everything updates as the form is filled in.
 */
export default function ReleasePreview({
  coverUrl,
  title,
  artist,
  meta,
  mintLabel,
  facts,
}: {
  coverUrl?: string
  title: string
  artist: string
  meta: string
  mintLabel: string
  facts: { label: string; value: string }[]
}) {
  const t = title || 'Untitled'
  const a = artist || 'Unknown artist'
  const lcd = `${a} — ${t}   ★   `
  return (
    <Row>
      <Col aria-label="Preview of the Mint card">
        <Eyebrow as="figcaption">In Mint → Music</Eyebrow>
        <Card aria-hidden>
          <Art>
            {coverUrl ? (
              <img src={coverUrl} alt="" />
            ) : (
              <div className="ph">
                <img src={DropMusicIcon} alt="" />
              </div>
            )}
            <span className="play">
              <Glyph />
            </span>
          </Art>
          <div>
            <Line $strong>{t}</Line>
            <Line>{a}</Line>
            <Line>{meta}</Line>
          </div>
          <FakeMint>{mintLabel}</FakeMint>
        </Card>
      </Col>
      <Col aria-label="Preview of miya radio">
        <Eyebrow as="figcaption">On miya radio</Eyebrow>
        <Deck aria-hidden>
          <div className="thumb">{coverUrl ? <img src={coverUrl} alt="" /> : null}</div>
          <div style={{ minWidth: 0 }}>
            <div className="lcd">
              <span>
                {lcd}
                {lcd}
              </span>
            </div>
            <div className="meta">
              <span style={{ color: color.light }}>now playing</span>
              <span className="bars">
                {[0, 0.2, 0.45, 0.1, 0.6, 0.3, 0.75, 0.15].map((d) => (
                  <i key={d} style={{ animationDelay: `-${d}s` }} />
                ))}
              </span>
            </div>
          </div>
        </Deck>
        <Ticket aria-label="Release summary">
          {facts.map((f) => (
            <Fragment key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </Fragment>
          ))}
        </Ticket>
      </Col>
    </Row>
  )
}

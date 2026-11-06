import { Fragment } from 'react'
import styled from 'styled-components/macro'

import DropMusicIcon from '@/assets/icon/drop_music.png'
import { Eyebrow, Panel, Well } from '@/components/Retro'
import { Marquee } from '@/pages/Radio/parts'
import { skinById } from '@/pages/Radio/skins'
import { bevel, color, space, text } from '@/theme/tokens'

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

/* The radio's real screen: its own colours and pixel font, and the line it scrolls. It shows no pictures. */
const Lcd = styled.div`
  padding: ${space[2]};
  border-radius: 8px;
  color: var(--rk-lcd-ink);
  background: var(--rk-lcd);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.45);
  overflow: hidden;
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
 * How the release will look once it is out: its card under Mint → Music and the title line miya radio scrolls.
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
        <Lcd aria-hidden style={skinById('classic').vars}>
          <Marquee value={`1. ${a} - ${t}`} width={150} />
        </Lcd>
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

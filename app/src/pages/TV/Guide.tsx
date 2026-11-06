import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { space, text } from '@/theme/tokens'

import { HOUSE_TAPES } from '../../../api/_lib/publicaccess'
import type { Channel } from './channels'
import { GUIDE_SECTIONS } from './channels'
import paperSkin from './skin/paper.webp'

const SERIF = `Georgia, 'Times New Roman', serif`
const RED = '#a4231a'
const INK = '#2a1f14'

/** The printed guide: a folded listings booklet opened over the set. */
const Book = styled.div`
  position: absolute;
  inset: ${space[2]};
  z-index: 30;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  color: ${INK};
  background: url(${paperSkin}) 0 0 / 256px 256px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.75), 0 0 0 1px #6d5c3c;
  &::after {
    content: '';
    position: absolute;
    top: 72px;
    bottom: 0;
    left: 50%;
    width: 44px;
    margin-left: -22px;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(60, 40, 15, 0.18) 48%,
      rgba(60, 40, 15, 0.28) 50%,
      rgba(255, 255, 255, 0.18) 52%,
      transparent
    );
  }
  .narrow &::after {
    display: none;
  }
  /* The OS sets its pixel font on everything; this is print. */
  &,
  & * {
    font-family: ${SERIF};
  }
`

const Mast = styled.header`
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space[3]};
  margin: 0 ${space[4]};
  padding: 10px 0 6px;
  border-bottom: 4px double ${INK};
  h2 {
    margin: 0;
    font-size: 36px;
    font-weight: 700;
    font-style: italic;
    line-height: 1;
    letter-spacing: -0.01em;
    color: ${RED};
  }
  .issue {
    flex: 1 1 auto;
    font-size: 13px;
    font-style: italic;
  }
  button {
    flex: 0 0 auto;
    height: 30px;
    padding: 0 12px;
    border: 1px solid ${INK};
    border-radius: 2px;
    background: transparent;
    color: ${INK};
    font-family: ${SERIF};
    font-size: 14px;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: ${INK};
    color: #f3e7cf;
    outline: none;
  }
  .narrow & .issue {
    display: none;
  }
`

const Pages = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: ${space[2]} ${space[4]} ${space[4]};
  column-count: 2;
  column-gap: 56px;
  .narrow & {
    column-count: 1;
  }
`

const Section = styled.section`
  break-inside: avoid;
  margin-bottom: ${space[3]};
  h3 {
    margin: 0 0 ${space[2]};
    padding: 2px 8px;
    background: ${RED};
    color: #fbf3df;
    font-size: ${text.sm};
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
`

const Listing = styled.button`
  display: grid;
  grid-template-columns: 34px 112px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  width: 100%;
  margin: 0 0 ${space[2]};
  padding: 6px;
  border: none;
  border-bottom: 1px dotted ${INK};
  background: transparent;
  color: ${INK};
  font-family: ${SERIF};
  text-align: left;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    outline: none;
    background: rgba(164, 35, 26, 0.1);
  }
  .num {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 2px solid ${INK};
    border-radius: 50%;
    font-size: 15px;
    font-weight: 700;
  }
  .pic {
    display: block;
    width: 112px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: #cdbf9d;
    box-shadow: 0 0 0 1px ${INK};
  }
  /* Printed in one ink, as a cheap booklet would be. */
  .pic img {
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    border: none !important;
    object-fit: cover;
    filter: grayscale(1) contrast(1.25) sepia(0.35);
    mix-blend-mode: multiply;
  }
  .pic.drawn {
    display: grid;
    place-items: center;
    font-size: 30px;
    line-height: 1;
    color: ${INK};
  }
  strong {
    display: block;
    font-size: 19px;
    line-height: 1.1;
  }
  .line {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.3;
  }
  .stamp {
    display: inline-block;
    margin-left: 6px;
    padding: 0 5px;
    border: 2px solid ${RED};
    color: ${RED};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    vertical-align: 2px;
    transform: rotate(-3deg);
  }
  .narrow & {
    grid-template-columns: 34px 84px minmax(0, 1fr);
  }
  .narrow & .pic {
    width: 84px;
  }
`

const DRAWN: Record<string, string> = { 'miya-radio': '♪', squeekchain: '◎' }

const thumbOf = (c: Channel, liveIds?: Record<string, string>) => {
  if (c.id === 'public-access') return `https://i.ytimg.com/vi/${HOUSE_TAPES[0]!.videoId}/hqdefault.jpg`
  if (c.kind !== 'iframe') return undefined
  const s = c.sources[0]
  return s.provider === 'youtube' ? `https://i.ytimg.com/vi/${liveIds?.[c.id] ?? s.videoId}/hqdefault.jpg` : undefined
}

export default function Guide({
  channels,
  liveIds,
  current,
  onPick,
  onClose,
}: {
  channels: Channel[]
  liveIds?: Record<string, string>
  current: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => before?.focus?.()
  }, [])

  return (
    <Book
      role="dialog"
      aria-label="miyatv guide"
      data-testid="guide"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <Mast>
        <h2>miyaTV Guide</h2>
        <span className="issue">Every channel, all day, all night.</span>
        <button ref={close} type="button" onClick={onClose}>
          Close
        </button>
      </Mast>
      <Pages>
        {GUIDE_SECTIONS.map((section) => {
          const inSection = channels.filter((c) => c.section === section)
          if (!inSection.length) return null
          return (
            <Section key={section}>
              <h3>{section}</h3>
              {inSection.map((c) => {
                const thumb = thumbOf(c, liveIds)
                return (
                  <Listing key={c.id} type="button" onClick={() => onPick(c.id)} aria-current={c.id === current}>
                    <span className="num">{c.number}</span>
                    {thumb ? (
                      <span className="pic">
                        <img src={thumb} alt="" loading="lazy" />
                      </span>
                    ) : (
                      <span className="pic drawn" aria-hidden>
                        {DRAWN[c.id] ?? '★'}
                      </span>
                    )}
                    <span>
                      <strong>
                        {c.name}
                        {c.id === current && <span className="stamp">ON NOW</span>}
                      </strong>
                      <span className="line">{c.tagline}</span>
                    </span>
                  </Listing>
                )
              })}
            </Section>
          )
        })}
      </Pages>
    </Book>
  )
}

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import { space, text } from '@/theme/tokens'

import { HOUSE_TAPES } from '../../../api/_lib/publicaccess'
import kickArt from './art/kick.webp'
import lofiArt from './art/lofi.webp'
import radioArt from './art/miya-radio.webp'
import montereyArt from './art/monterey.webp'
import spaceArt from './art/space-station.webp'
import squeekArt from './art/squeekchain.webp'
import type { Channel } from './channels'
import { GUIDE_SECTIONS } from './channels'
import teaPaperTall from './skin/tea-paper-tall.webp'
import teaPaper from './skin/tea-paper.webp'
import woodSkin from './skin/wood.webp'

const SERIF = `Georgia, 'Times New Roman', serif`
const RED = '#a4231a'
const INK = '#2a1f14'

/** Margin of wood round the sheet. */
const SHEET_INSET = 12
const SHEET_INSET_NARROW = 6

/** The printed guide: a folded, tea-stained sheet, laid on a wood backing that hides the whole set behind it. */
const Book = styled.div`
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: ${SHEET_INSET}px;
  color: ${INK};
  background: url(${woodSkin}) 0 0 / 512px 512px;
  box-shadow:
    inset 0 2px 5px rgba(0, 0, 0, 0.75),
    inset 0 0 0 1px rgba(20, 10, 2, 0.8);
  .narrow & {
    padding: ${SHEET_INSET_NARROW}px;
  }
  /* The sheet: cleanly cut, its stains part of the picture. */
  &::before {
    content: '';
    position: absolute;
    inset: ${SHEET_INSET}px;
    z-index: -1;
    border-radius: 1px;
    background: url(${teaPaper}) center / cover;
    box-shadow:
      0 0 0 1px rgba(40, 26, 10, 0.55),
      0 3px 10px rgba(0, 0, 0, 0.6);
  }
  .narrow &::before {
    inset: ${SHEET_INSET_NARROW}px;
    background-image: url(${teaPaperTall});
  }
  /* The fold down the middle. */
  &::after {
    content: '';
    position: absolute;
    top: ${SHEET_INSET}px;
    bottom: ${SHEET_INSET}px;
    left: 50%;
    width: 28px;
    margin-left: -14px;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(70, 50, 20, 0.08) 44%,
      rgba(70, 50, 20, 0.2) 50%,
      rgba(255, 252, 240, 0.45) 52%,
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
  margin: 4px ${space[4]} 0;
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
    /* The red plate printed a hair off, as it always was. */
    text-shadow: 1.5px 1px 0 rgba(42, 31, 20, 0.28);
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
  .narrow & {
    margin: 4px ${space[3]} 0;
    align-items: center;
    flex-wrap: wrap;
  }
  .narrow & h2 {
    font-size: 28px;
  }
  .narrow & .issue {
    order: 3;
    flex: 1 0 100%;
    font-size: 12px;
  }
`

const Pages = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  margin-bottom: 6px;
  padding: ${space[2]} ${space[4]} ${space[4]};
  .narrow & {
    padding: ${space[2]} ${space[3]} ${space[3]};
  }
`

/* Inside the scroller, not on it: columns in a box of fixed height run off sideways instead of down. */
const Columns = styled.div`
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
    color: #f6ecd2;
    mix-blend-mode: multiply;
    font-size: ${text.sm};
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
`

/** Picks the channel from anywhere on the listing, through the name's button, leaving the credit's links their own clicks. */
const Listing = styled.div`
  position: relative;
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
  &:has(.pick:focus-visible) {
    background: rgba(164, 35, 26, 0.1);
  }
  .pick {
    all: unset;
    cursor: pointer;
  }
  .pick::after {
    content: '';
    position: absolute;
    inset: 0;
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
    position: relative;
    background: #cdbf9d;
    box-shadow: 0 0 0 1px ${INK};
  }
  /* A faint halftone screen over the picture. */
  .pic:not(.drawn)::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle, rgba(42, 31, 20, 0.5) 0.8px, transparent 1px) 0 0 / 3px 3px;
    mix-blend-mode: multiply;
    opacity: 0.28;
  }
  /* Colour on old paper: a little aged, and bright enough to read on the stain. */
  .pic img {
    display: block;
    width: 100%;
    max-width: none;
    height: 100%;
    margin: 0;
    border: none !important;
    object-fit: cover;
    filter: saturate(0.92) sepia(0.08);
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
  .credit {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    font-style: italic;
    opacity: 0.8;
  }
  /* Above the listing-wide button. */
  .credit a {
    position: relative;
    z-index: 1;
    color: inherit;
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
  /* Phones: one on top of the other, the picture as wide as the column, its number printed on it. */
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    margin-bottom: ${space[3]};
    padding: 0 0 ${space[3]};
  }
  .narrow & .pic {
    width: 100%;
  }
  .narrow & .num {
    position: absolute;
    z-index: 1;
    top: 8px;
    left: 8px;
    background: #eddcb6;
  }
  .narrow & strong {
    font-size: 21px;
  }
  .narrow & .line {
    font-size: 14px;
  }
`

const Source = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
)

/** Our radio, each project's own card, and photographs: a stream's thumbnail is a title card, changing with the stream. */
const ART: Record<string, string> = {
  lofi: lofiArt,
  'miya-radio': radioArt,
  monterey: montereyArt,
  iss: spaceArt,
  squeekchain: squeekArt,
  'kick-imdusd': kickArt,
}

/** Photographs that need their source named, printed under the listing. */
const CREDITS: Record<string, ReactNode> = {
  monterey: (
    <>
      Photo:{' '}
      <Source href="https://commons.wikimedia.org/wiki/File:Shorebirds_in_the_aviary_at_Monterey_Bay_Aquarium.jpg">
        Kārlis Dambrāns
      </Source>
      , <Source href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</Source>, cropped
    </>
  ),
  iss: (
    <>
      Photo: <Source href="https://images.nasa.gov/details/iss073e1068530">NASA</Source>
    </>
  ),
}

const thumbOf = (c: Channel, liveIds?: Record<string, string>) => {
  if (ART[c.id]) return ART[c.id]
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
  const book = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    close.current?.focus()
    // On a phone the set scrolls: the book opens at the top of it, not somewhere above the view.
    book.current?.parentElement?.scrollTo?.({ top: 0 })
    return () => before?.focus?.()
  }, [])

  return (
    <Book
      ref={book}
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
        <Columns>
          {GUIDE_SECTIONS.map((section) => {
            const inSection = channels.filter((c) => c.section === section)
            if (!inSection.length) return null
            return (
              <Section key={section}>
                <h3>{section}</h3>
                {inSection.map((c) => {
                  const thumb = thumbOf(c, liveIds)
                  return (
                    <Listing key={c.id}>
                      <span className="num">{c.number}</span>
                      {thumb ? (
                        <span className="pic">
                          <img src={thumb} alt="" loading="lazy" />
                        </span>
                      ) : (
                        <span className="pic drawn" aria-hidden>
                          ★
                        </span>
                      )}
                      <span>
                        <strong>
                          <button
                            type="button"
                            className="pick"
                            onClick={() => onPick(c.id)}
                            aria-current={c.id === current}
                          >
                            {c.name}
                          </button>
                          {c.id === current && <span className="stamp">ON NOW</span>}
                        </strong>
                        <span className="line">{c.tagline}</span>
                        {CREDITS[c.id] && <span className="credit">{CREDITS[c.id]}</span>}
                      </span>
                    </Listing>
                  )
                })}
              </Section>
            )
          })}
        </Columns>
      </Pages>
    </Book>
  )
}

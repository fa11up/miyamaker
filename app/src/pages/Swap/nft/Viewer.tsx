import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { cleanText } from '@/desktop/files/sanitize'

import { color, font, space, text } from '../floor/tokens'
import type { OsTrait, Price } from './markets'
import { formatPrice, itemUrl, traitShare } from './markets'
import { KIND } from './pool'
import { goneHashes, sessionStore } from './sweep'
import { useCollectionTraits, useItemSales, useOpenSeaItem } from './useMarkets'
import { useNftMeta } from './usePools'

/**
 * The terminal's NFT viewer: the art full screen with zoom and pan, and a data rail beside it (price and Buy, rarity,
 * traits with how many share each, the week's sales). ← → step through the list it was opened from; Esc closes.
 * Rendered over the whole page, so the art gets every pixel the screen has.
 */

export type ViewerItem = { tokenId: string; image?: string; name?: string; price?: Price }

const AMBER = color.accent
const MAX_ZOOM = 8

const Shade = styled.div`
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  background: #000;
  color: ${color.ink};
  font-family: ${font.mono};
  font-size: ${text.sm};
  * {
    font-family: inherit;
  }
  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 58%) minmax(0, 1fr);
    .art > div {
      width: min(100%, calc(58vh - 128px));
    }
  }
`

const Stage = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #15181c 0, #000 70%);
  cursor: zoom-in;
  touch-action: none;
  user-select: none;
  &.zoomed {
    cursor: grab;
  }
  &.dragging {
    cursor: grabbing;
  }
  /* Clear of the bars above and below the art. */
  .art {
    position: absolute;
    inset: 60px 24px 68px;
    display: grid;
    place-items: center;
    transform-origin: 50% 50%;
    will-change: transform;
  }
  .art > div {
    width: min(100%, calc(100vh - 128px));
    max-height: 100%;
    background: transparent;
  }
  .art img {
    image-rendering: auto;
  }
  .art.pixel img {
    image-rendering: pixelated;
  }
`

const StageBar = styled.div`
  position: absolute;
  z-index: 2;
  left: ${space[3]};
  right: ${space[3]};
  display: flex;
  align-items: center;
  gap: ${space[2]};
  pointer-events: none;
  &.top {
    top: ${space[3]};
  }
  &.bottom {
    bottom: ${space[3]};
    justify-content: center;
  }
  > * {
    pointer-events: auto;
  }
  .id {
    padding: 3px 8px;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid ${color.dark};
    color: #fff;
  }
  .count {
    margin-left: auto;
    padding: 3px 8px;
    background: rgba(0, 0, 0, 0.75);
    color: ${color.inkMuted};
  }
  button {
    min-width: 36px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid ${color.dark};
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font: inherit;
    font-size: ${text.lg};
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: ${AMBER};
    color: ${AMBER};
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .close {
    background: ${AMBER};
    color: #000;
    border-color: ${AMBER};
    font-weight: 700;
  }
`

const Side = styled.aside`
  min-height: 0;
  overflow-y: auto;
  border-left: 1px solid ${color.dark};
  background: #050608;
  @media (max-width: 760px) {
    border-left: none;
    border-top: 2px solid ${AMBER};
  }
  section {
    padding: ${space[3]} ${space[4]};
    border-bottom: 1px solid #14181d;
  }
  h2 {
    margin: 0;
    color: #fff;
    font-size: ${text.lg};
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  h3 {
    margin: 0 0 ${space[2]};
    color: ${AMBER};
    font-size: ${text.xs};
    letter-spacing: 0.14em;
  }
  .sub {
    margin-top: 2px;
    color: ${color.inkMuted};
    font-size: ${text.xs};
  }
  .price {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: ${space[2]};
    font-size: ${text.xl};
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .price small {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .buy {
    width: 100%;
    margin-top: ${space[3]};
    min-height: 44px;
    border: none;
    background: ${AMBER};
    color: #000;
    font: inherit;
    font-size: ${text.lg};
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .rank {
    color: #fff;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  td {
    padding: 5px 0;
    border-bottom: 1px solid #14181d;
    vertical-align: top;
  }
  td.t {
    width: 38%;
    padding-right: ${space[2]};
    color: ${color.inkMuted};
    font-size: ${text.xs};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  td.v {
    color: #fff;
    overflow-wrap: anywhere;
  }
  td.p {
    width: 64px;
    text-align: right;
    white-space: nowrap;
  }
  .bar {
    display: block;
    height: 3px;
    margin-top: 4px;
    background: #1a1f25;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: ${AMBER};
  }
  .rare {
    color: ${AMBER};
  }
  .quiet {
    color: ${color.inkMuted};
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[3]};
  }
  .links a,
  .links button {
    border: none;
    background: none;
    padding: 0;
    color: ${color.link};
    font: inherit;
    cursor: pointer;
  }
`

const pct = (share: number) => (share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`)
const when = (at: number) => new Date(at * 1000).toISOString().slice(0, 16).replace('T', ' ')

function Traits({
  traits,
  counts,
  size,
}: {
  traits: OsTrait[]
  counts?: ReturnType<typeof useCollectionTraits>
  size?: number
}) {
  if (!traits.length) return <p className="quiet">No traits in its metadata.</p>
  // Rarest first when the counts are known.
  const rows = traits
    .map((t) => ({ t, share: traitShare(counts, t, size) }))
    .sort((a, b) => (a.share ?? 2) - (b.share ?? 2))
  return (
    <table>
      <tbody>
        {rows.map(({ t, share }) => (
          <tr key={`${t.trait}:${t.value}`}>
            <td className="t">{t.trait}</td>
            <td className="v">
              {t.value}
              {share !== undefined && (
                <span className="bar" aria-hidden>
                  <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                </span>
              )}
            </td>
            <td className={share !== undefined && share < 0.05 ? 'p rare' : 'p'}>
              {share !== undefined ? pct(share) : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Viewer({
  chainId,
  contract,
  slug,
  collectionName,
  supply,
  items,
  index,
  onIndex,
  onClose,
  onOpen,
}: {
  chainId: SupportedChainId
  contract: Address
  slug?: string
  collectionName: string
  /** How many NFTs the collection has, for trait shares. */
  supply?: number
  items: ViewerItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  /** The NFT's own page; `buy` opens its buy review there. */
  onOpen: (tokenId: string, buy?: boolean) => void
}) {
  const item = items[index]
  const id = item?.tokenId ?? '0'
  const os = useOpenSeaItem(chainId, contract, slug, id)
  const meta = useNftMeta(chainId, contract, KIND.ERC721, BigInt(id))
  const counts = useCollectionTraits(slug)
  const sales = useItemSales(slug, id)
  const listing = os.listing && !goneHashes(sessionStore()).has(os.listing.hash) ? os.listing : undefined
  const image = item?.image || os.nft?.image || meta.image
  const title = cleanText(item?.name || os.nft?.name || meta.name, 80) || `${collectionName} #${id}`
  const traits: OsTrait[] = os.nft?.traits.length
    ? os.nft.traits
    : (meta.attributes ?? []).map((a) => ({ trait: a.trait, value: a.value }))
  const openSea = itemUrl('opensea', chainId, contract, id)

  // Zoom and pan. Reset for every NFT.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number }>()
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [index])
  const zoomTo = (z: number) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, z))
    setZoom(next)
    if (next === 1) setPan({ x: 0, y: 0 })
  }

  const step = (by: number) => {
    const next = index + by
    if (next >= 0 && next < items.length) onIndex(next)
  }

  // Keys: ← → step, + − zoom, 0 resets, Esc closes. Captured so the page behind doesn't also act on them.
  const keys = useRef({ step, zoomTo, zoom, onClose })
  keys.current = { step, zoomTo, zoom, onClose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (e.key === 'Escape') k.onClose()
      else if (e.key === 'ArrowRight') k.step(1)
      else if (e.key === 'ArrowLeft') k.step(-1)
      else if (e.key === '+' || e.key === '=') k.zoomTo(k.zoom * 1.5)
      else if (e.key === '-') k.zoomTo(k.zoom / 1.5)
      else if (e.key === '0') k.zoomTo(1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // The neighbours load while this one is looked at, so stepping is instant.
  useEffect(() => {
    ;[items[index - 1], items[index + 1]].forEach((n) => {
      if (!n?.image) return
      const img = new Image()
      img.src = n.image
    })
  }, [index, items])

  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])

  const pixel = /\.(gif|png)(\?|$)/i.test(image ?? '')

  return createPortal(
    <Shade role="dialog" aria-modal="true" aria-label={`${title}, viewer`}>
      <Stage
        className={[zoom > 1 && 'zoomed', dragging && 'dragging'].filter(Boolean).join(' ')}
        onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onDoubleClick={() => zoomTo(zoom > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          if (zoom <= 1) return
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          setPan({ x: d.px + (e.clientX - d.x) / zoom, y: d.py + (e.clientY - d.y) / zoom })
        }}
        onPointerUp={() => {
          drag.current = undefined
          setDragging(false)
        }}
      >
        <StageBar className="top">
          <span className="id">
            {collectionName} #{id}
          </span>
          <span className="count">
            {index + 1} / {items.length}
          </span>
          <button ref={closeRef} className="close" type="button" onClick={onClose} aria-label="Close the viewer">
            ✕ ESC
          </button>
        </StageBar>
        <div
          className={pixel ? 'art pixel' : 'art'}
          style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
        >
          <NftImage key={id} src={image} alt={title} fit="contain" eager />
        </div>
        <StageBar className="bottom">
          <button type="button" onClick={() => step(-1)} disabled={index <= 0} aria-label="Previous">
            ←
          </button>
          <button type="button" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomTo(1)} aria-label="Fit to screen">
            {zoom.toFixed(1)}×
          </button>
          <button type="button" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => step(1)} disabled={index >= items.length - 1} aria-label="Next">
            →
          </button>
        </StageBar>
      </Stage>

      <Side aria-label={`About ${title}`}>
        <section>
          <h2>{title}</h2>
          <div className="sub">
            {collectionName} · #{id}
            {os.nft?.rank !== undefined && (
              <>
                {' '}
                · <span className="rank">RANK {os.nft.rank.toLocaleString()}</span>
              </>
            )}
          </div>
        </section>

        <section aria-label="Price">
          <h3>PRICE</h3>
          {listing ? (
            <>
              <div className="price">
                {formatPrice(listing.price)}
                <small>on OpenSea</small>
              </div>
              <button className="buy" type="button" onClick={() => onOpen(id, true)} data-viewer-buy>
                BUY #{id}
              </button>
            </>
          ) : os.loading ? (
            <p className="quiet">Checking…</p>
          ) : os.needsKey ? (
            <p className="quiet">Prices are offline right now.</p>
          ) : os.error ? (
            <p className="quiet">Couldn&apos;t check the price. Try again in a moment.</p>
          ) : (
            <p className="quiet">Not for sale right now.</p>
          )}
          {os.offer && <p className="sub">Best offer {formatPrice(os.offer.price)}</p>}
        </section>

        <section aria-label="Traits">
          <h3>TRAITS{counts && supply ? ' · SHARE OF COLLECTION' : ''}</h3>
          {meta.loading && !traits.length ? (
            <p className="quiet">Reading…</p>
          ) : (
            <Traits traits={traits} counts={counts} size={supply} />
          )}
        </section>

        <section aria-label="Sales this week">
          <h3>SALES · 7D</h3>
          {sales.loading ? (
            <p className="quiet">Reading…</p>
          ) : sales.error ? (
            <p className="quiet">Couldn&apos;t read sales.</p>
          ) : sales.sales?.length ? (
            <table>
              <tbody>
                {sales.sales.slice(0, 8).map((s) => (
                  <tr key={s.tx}>
                    <td className="t">{when(s.at)}</td>
                    <td className="v">{formatPrice({ amount: BigInt(s.price), decimals: 18, symbol: s.currency })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="quiet">No sales this week.</p>
          )}
        </section>

        <section className="links">
          <button type="button" onClick={() => onOpen(id)}>
            Full page →
          </button>
          {openSea && (
            <a href={openSea} target="_blank" rel="noopener noreferrer">
              OpenSea ↗
            </a>
          )}
        </section>
      </Side>
    </Shade>,
    document.body
  )
}

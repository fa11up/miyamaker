import FileEye from 'assets/file_eye.png'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Draggable from 'react-draggable'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { explorerUrl } from '@/config/wagmi'
import { MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { findCollection } from '../collections'
import { shortAddress } from '../mints/dedupe'
import { useOpenApp } from '../useOpenApp'
import type { Size } from './fitArtwork'
import { fitArtwork, isPixelArt } from './fitArtwork'
import type { Selection } from './MyFiles'
import { safeLinkUrl } from './sanitize'
import { fileType, QUARANTINE_WARNING } from './scam'

/** The same dark CRT as the My Files window it opens over. */
const PHOSPHOR = '#cfe8d3'
const MUTED = '#8fa897'
const LINE = '#5f7a68'
const SCREEN = '#07040c'
const GAP = '12px'
/** Each further popup lands this far down and across from the last. */
const CASCADE = 26
const BESIDE_GAP = 8

const Dialog = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid ${LINE};
  background: #120a1c;
  color: ${PHOSPHOR};
  box-shadow:
    0 0 0 1px #000,
    0 8px 24px rgba(0, 0, 0, 0.7),
    0 0 26px rgba(200, 16, 46, 0.18);

  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    height: 26px;
    padding: 0 4px 0 ${space[2]};
    cursor: grab;
    user-select: none;
    touch-action: none;
    background:
      repeating-linear-gradient(0deg, rgba(120, 255, 170, 0.06) 0 1px, transparent 1px 3px),
      linear-gradient(90deg, #120a1c, #2a1230 60%, #4c1830);
    color: ${PHOSPHOR};
    letter-spacing: 0.06em;
    text-shadow: 0 0 5px rgba(160, 255, 190, 0.45);
    font-size: ${text.sm};
    span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    button {
      width: 20px;
      height: 18px;
      padding: 0;
      border: 1px solid ${LINE};
      background: #1c1226;
      color: ${PHOSPHOR};
      cursor: pointer;
      &:hover {
        background: #c8102e;
        color: #fff;
      }
    }
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: ${space[3]};
    display: flex;
    flex-direction: column;
    gap: ${GAP};
  }
  .content.beside {
    flex-direction: row;
    align-items: flex-start;
  }
  .info {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: ${space[3]};
  }
  .preview {
    flex: 0 0 auto;
    align-self: center;
    box-sizing: content-box;
    max-width: 100%;
    padding: 0;
    border: 1px solid ${LINE};
    background: ${SCREEN};
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .content.beside .preview {
    align-self: flex-start;
  }
  button.preview {
    cursor: zoom-in;
    &:hover {
      border-color: ${PHOSPHOR};
    }
    &:focus-visible {
      outline: 1px dotted ${PHOSPHOR};
      outline-offset: 2px;
    }
  }
  .preview img {
    border: none !important;
    margin: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: contain;
  }
  .preview img.pixel {
    image-rendering: pixelated;
  }
  .preview.doc {
    width: auto;
    padding: ${space[4]};
    font-size: ${text.xl};
    font-weight: 700;
    color: #ff5a74;
    text-shadow: 0 0 8px rgba(255, 61, 94, 0.55);
    text-align: center;
    overflow-wrap: anywhere;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: ${space[1]} ${space[3]};
    font-size: ${text.sm};
  }
  dt {
    color: ${MUTED};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .warn {
    margin: 0;
    padding: ${space[1]} ${space[2]};
    border: 1px solid #ff5a74;
    background: #5c1226;
    color: #fff;
    font-size: ${text.xs};
    line-height: 1.4;
  }
  .desc {
    margin: 0;
    font-size: ${text.xs};
    line-height: 1.4;
    color: ${MUTED};
    white-space: pre-wrap;
    max-height: 7.5em;
    overflow: auto;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[2]};
    justify-content: flex-end;
  }
  .actions a,
  .actions button {
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    padding: 0 ${space[3]};
    border: 1px solid ${LINE};
    background: #1c1226;
    color: ${PHOSPHOR};
    font-size: ${text.sm};
    text-decoration: none;
    cursor: pointer;
    &:hover {
      background: #33203f;
    }
    &:active {
      background: ${SCREEN};
    }
    &:focus-visible {
      outline: 1px dotted ${PHOSPHOR};
      outline-offset: 2px;
    }
  }
  .actions .primary {
    border-color: #ff5a74;
    color: #fff;
    background: #5c1226;
    &:hover {
      background: #c8102e;
    }
  }

  /* A phone has room for one thing at a time: the whole desktop, and nothing to drag it around. */
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    width: 100% !important;
    height: 100%;
    transform: none !important;
    .content.beside {
      flex-direction: column;
    }
    .content.beside .preview {
      align-self: center;
    }
    .info {
      flex: 0 0 auto;
    }
    .bar {
      cursor: default;
      height: 40px;
    }
    .bar button {
      width: 36px;
      height: 32px;
    }
    .actions a,
    .actions button {
      min-height: 44px;
    }
  }
`

const roomIn = (host: Element): Size => ({ w: host.clientWidth, h: host.clientHeight })

export default function Properties({
  selection,
  owner,
  onClose,
  onView,
  onFront,
  zIndex,
  cascade,
  hidden,
}: {
  selection: Selection
  owner: Address
  onClose: () => void
  /** Open the artwork in the viewer. */
  onView: () => void
  onFront: () => void
  zIndex: number
  /** How many popups were open before this one, so they do not land exactly on top of each other. */
  cascade: number
  hidden: boolean
}) {
  const openApp = useOpenApp()
  const okRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const host = useMemo(() => document.querySelector('.bwindow') ?? document.body, [])
  const [room, setRoom] = useState(() => roomIn(host))
  const [natural, setNatural] = useState<Size>()
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const moved = useRef(false)
  const isArt = selection.kind === 'nft' && !!(selection.nft.fullImage || selection.nft.image)
  // Stays out of sight until the picture says what shape it is, or until it has clearly taken too long to say.
  const [settled, setSettled] = useState(!isArt)

  // Once it is showing: a hidden button can't take focus, and Escape needs focus here.
  useEffect(() => {
    if (settled) okRef.current?.focus({ preventScroll: true })
  }, [settled])

  useEffect(() => {
    const resize = () => setRoom(roomIn(host))
    window.addEventListener('resize', resize)
    const giveUp = setTimeout(() => setSettled(true), 800)
    return () => {
      window.removeEventListener('resize', resize)
      clearTimeout(giveUp)
    }
  }, [host])

  const fit = fitArtwork(natural, room)

  // Centred until someone moves it, then wherever they left it, as long as that is still on the desktop.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const maxX = Math.max(0, room.w - box.offsetWidth)
    const maxY = Math.max(0, room.h - box.offsetHeight)
    // Beside My Files where there is room, so its files stay in reach; centred where there is not.
    const files = document.querySelector('[data-my-files]')?.closest('.window-frame')?.getBoundingClientRect()
    const desk = host.getBoundingClientRect()
    const free = (start: number) => (start >= 0 && start <= maxX ? start : undefined)
    const beside =
      files &&
      (free(files.right - desk.left + BESIDE_GAP) ?? free(files.left - desk.left - box.offsetWidth - BESIDE_GAP))
    const startX = beside ?? Math.round(maxX / 2)
    const startY = beside !== undefined && files ? files.top - desk.top : Math.round(maxY / 2)
    setPosition((p) =>
      moved.current
        ? { x: Math.min(p.x, maxX), y: Math.min(p.y, maxY) }
        : {
            x: Math.max(0, Math.min(maxX, startX + cascade * CASCADE)),
            y: Math.max(0, Math.min(maxY, startY + cascade * CASCADE)),
          },
    )
  }, [room, fit.width, fit.art.h, settled, cascade, host])

  let title: string
  let preview: React.ReactNode
  let rows: [string, React.ReactNode][]
  let links: { label: string; href: string }[] = []
  let app: 'mint' | 'auction' | undefined
  let description = ''

  if (selection.kind === 'nft') {
    const n = selection.nft
    const quarantined = !!n.scamReason || !!n.checking
    const explorer = explorerUrl(n.chainId)
    title = n.name || `#${n.tokenId}`
    const full = n.fullImage || n.image
    const artSize = { width: fit.art.w, height: fit.art.h }
    const settle = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth: w, naturalHeight: h } = e.currentTarget
      if (w > 0 && h > 0) setNatural({ w, h })
      setSettled(true)
    }
    preview = full ? (
      <button type="button" className="preview" style={artSize} title="Open in the viewer" onClick={onView}>
        <img
          src={full}
          alt={n.name}
          className={isPixelArt(natural) ? 'pixel' : undefined}
          referrerPolicy="no-referrer"
          onLoad={settle}
          onError={() => setSettled(true)}
        />
      </button>
    ) : (
      <div className="preview" style={{ width: 160, height: 160 }}>
        <img src={FileEye} alt="" className="pixel" style={{ objectFit: 'none' }} />
      </div>
    )
    rows = [
      ...(n.name && !quarantined ? ([['Name', n.name]] as [string, React.ReactNode][]) : []),
      ...(n.collectionName ? ([['Collection', n.collectionName]] as [string, React.ReactNode][]) : []),
      ['Token ID', n.tokenId],
      ['Contract', shortAddress(n.contract)],
      ['Type', fileType(n)],
      ...(n.scamReason ? ([['Why it is here', n.scamReason]] as [string, React.ReactNode][]) : []),
      ...(n.checking ? ([['Status', 'Contract not checked yet']] as [string, React.ReactNode][]) : []),
    ]
    description = n.description
    links = [
      { label: 'Etherscan', href: `${explorer}/nft/${n.contract}/${n.tokenId}` },
      ...(n.externalUrl ? [{ label: 'Website', href: n.externalUrl }] : []),
    ]
    app = quarantined ? undefined : findCollection(n.chainId, n.contract)?.app
  } else {
    const d = selection.doc
    const explorer = explorerUrl(1)
    title = `${d.symbol}.doc`
    preview = (
      <div className="preview doc">
        {d.loading ? '…' : (d.formatted ?? '?')} {d.symbol}
      </div>
    )
    rows = [
      ['Name', d.name],
      ['Balance', d.loading ? 'Loading…' : `${d.formatted ?? 'unavailable'} ${d.symbol}`],
      ['Type', d.address ? 'ERC-20 token' : 'Native ether'],
      ...(d.address ? ([['Contract', shortAddress(d.address)]] as [string, React.ReactNode][]) : []),
      ['Network', 'Ethereum'],
    ]
    links = [
      {
        label: 'Etherscan',
        href: d.address ? `${explorer}/token/${d.address}?a=${owner}` : `${explorer}/address/${owner}`,
      },
    ]
  }

  const layout = isArt ? fit.layout : 'stacked'
  const details = (
    <>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}:</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {selection.kind === 'nft' && (selection.nft.scamReason || selection.nft.checking) && (
        <p className="warn">{QUARANTINE_WARNING}</p>
      )}
      {description && <p className="desc">{description}</p>}
      <div className="actions">
        {links
          .filter((l) => safeLinkUrl(l.href))
          .map((l) => (
            <a key={l.label} href={safeLinkUrl(l.href)} target="_blank" rel="noopener noreferrer nofollow">
              {l.label} ↗
            </a>
          ))}
        {app && (
          <button
            type="button"
            onClick={() => {
              openApp(app!)
              onClose()
            }}
          >
            Open in {app === 'mint' ? 'Mint' : 'Auction'}
          </button>
        )}
        {selection.kind === 'token' && (
          <button type="button" onClick={() => openApp('swap')}>
            Open in Trade
          </button>
        )}
        {isArt && (
          <button type="button" onClick={onView}>
            View
          </button>
        )}
        <button type="button" className="primary" ref={okRef} onClick={onClose}>
          OK
        </button>
      </div>
    </>
  )

  // In the desktop's own layer, so other windows can still come in front of it, as they can with My Files.
  return createPortal(
    <Draggable
      nodeRef={boxRef}
      handle=".bar"
      cancel="button"
      bounds="parent"
      position={position}
      disabled={room.w <= MOBILE_BREAKPOINT}
      onDrag={(_, ui) => {
        moved.current = true
        setPosition({ x: ui.x, y: ui.y })
      }}
    >
      <Dialog
        ref={boxRef}
        role="dialog"
        aria-label={`Properties: ${title}`}
        data-file-properties=""
        style={{
          width: isArt ? fit.width : Math.min(room.w, 380),
          zIndex,
          display: hidden ? 'none' : undefined,
          visibility: settled ? undefined : 'hidden',
        }}
        // My Files' window would otherwise see this press too, through React, and start dragging itself.
        onMouseDown={(e) => {
          e.stopPropagation()
          onFront()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onClose()
        }}
      >
        <div className="bar">
          <span>{title} Properties</span>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className={`content ${layout}`}>
          {preview}
          {layout === 'beside' ? <div className="info">{details}</div> : details}
        </div>
      </Dialog>
    </Draggable>,
    host,
  )
}

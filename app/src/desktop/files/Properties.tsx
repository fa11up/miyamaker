import FileEye from 'assets/file_eye.png'
import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { explorerUrl } from '@/config/wagmi'
import { bevel, color, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { findCollection } from '../collections'
import { shortAddress } from '../mints/dedupe'
import { useOpenApp } from '../useOpenApp'
import type { Selection } from './MyFiles'
import { safeLinkUrl } from './sanitize'

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: ${space[3]};
  background: rgba(20, 16, 31, 0.25);
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    padding: 0;
    place-items: stretch;
  }
`

const Dialog = styled.div`
  width: min(460px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 3px;
  background: ${color.face};
  box-shadow: ${bevel.raised}, 4px 6px 0 rgba(20, 16, 31, 0.25);

  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    height: 26px;
    padding: 0 3px 0 ${space[2]};
    background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
    color: ${color.highlight};
    font-weight: 700;
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
      border: none;
      background: ${color.face};
      box-shadow: ${bevel.raised};
      color: ${color.dark};
      cursor: pointer;
    }
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: ${space[3]};
    display: flex;
    flex-direction: column;
    gap: ${space[3]};
  }
  .preview {
    align-self: center;
    width: min(240px, 70%);
    aspect-ratio: 1;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    padding: ${space[1]};
    display: grid;
    place-items: center;
  }
  .preview img {
    border: none !important;
    margin: 0;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .preview.doc {
    aspect-ratio: auto;
    padding: ${space[4]};
    font-size: ${text.xl};
    font-weight: 700;
    color: ${color.accentDark};
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
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .desc {
    margin: 0;
    font-size: ${text.xs};
    line-height: 1.4;
    color: ${color.inkMuted};
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
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.sm};
    text-decoration: none;
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
  .actions .primary {
    outline: 1px solid ${color.dark};
    outline-offset: -1px;
  }

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    width: 100%;
    height: 100%;
    .bar {
      height: 40px;
    }
    .bar button {
      width: 36px;
      height: 30px;
    }
    .actions a,
    .actions button {
      min-height: 44px;
    }
  }
`

export default function Properties({
  selection,
  owner,
  onClose,
}: {
  selection: Selection
  owner: Address
  onClose: () => void
}) {
  const openApp = useOpenApp()
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let title: string
  let preview: React.ReactNode
  let rows: [string, React.ReactNode][]
  let links: { label: string; href: string }[] = []
  let app: 'mint' | 'auction' | undefined
  let description = ''

  if (selection.kind === 'nft') {
    const n = selection.nft
    const explorer = explorerUrl(n.chainId)
    title = n.name || `#${n.tokenId}`
    preview = (
      <div className="preview">
        <img src={n.image || FileEye} alt={n.name} referrerPolicy="no-referrer" />
      </div>
    )
    rows = [
      ['Name', n.name],
      ['Collection', n.collectionName],
      ['Token ID', n.tokenId],
      ['Contract', shortAddress(n.contract)],
      ['Type', 'ERC-721 token'],
    ]
    description = n.description
    links = [
      { label: 'Etherscan', href: `${explorer}/nft/${n.contract}/${n.tokenId}` },
      ...(n.externalUrl ? [{ label: 'Website', href: n.externalUrl }] : []),
    ]
    app = findCollection(n.chainId, n.contract)?.app
  } else {
    const d = selection.doc
    const explorer = explorerUrl(1)
    title = `${d.symbol}.doc`
    preview = (
      <div className="preview doc">
        {d.loading ? '…' : d.formatted ?? '?'} {d.symbol}
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

  return (
    <Backdrop onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog role="dialog" aria-label={`Properties: ${title}`} data-file-properties="">
        <div className="bar">
          <span>{title} Properties</span>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="content">
          {preview}
          <dl>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}:</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
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
                Open in Swap
              </button>
            )}
            <button type="button" className="primary" ref={okRef} onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </Dialog>
    </Backdrop>
  )
}

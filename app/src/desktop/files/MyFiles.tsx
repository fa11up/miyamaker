import { useConnectModal } from '@rainbow-me/rainbowkit'
import FileEye from 'assets/file_eye.png'
import FolderIcon from 'assets/folder.png'
import { useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { BigButton, Skeleton, StatusBox } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { shortAddress } from '../mints/dedupe'
import { groupByCollection } from './indexer/parse'
import type { OwnedNft } from './indexer/types'
import Properties from './Properties'
import type { TokenDoc } from './useWalletFiles'
import { useTokenDocs, useWalletNfts } from './useWalletFiles'
import { WIRED_BACKDROP } from './wired'

const ID = 'files'

const PHOSPHOR = '#cfe8d3'

const Root = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  min-height: 0;
  padding: ${space[1]};
  color: ${PHOSPHOR};
  background: #120a1c;
`

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[1]};
  flex: 0 0 auto;
  button {
    min-height: 28px;
    padding: 0 ${space[2]};
    border: 1px solid #5f7a68;
    background: #1c1226;
    color: ${PHOSPHOR};
    font-size: ${text.sm};
    cursor: pointer;
    &:hover:not(:disabled) {
      background: #33203f;
    }
    &:active:not(:disabled) {
      background: #0a0610;
    }
    &:disabled {
      color: #6f7f76;
      cursor: default;
    }
  }
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    button {
      min-height: 40px;
      min-width: 44px;
    }
  }
`

const AddressBar = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 0 ${space[2]};
  border: 1px solid #5f7a68;
  background: #07040c;
  color: ${PHOSPHOR};
  font-size: ${text.sm};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Pane = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid #5f7a68;
  background: #160b26 ${WIRED_BACKDROP} right bottom / cover no-repeat;
  padding: ${space[3]};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: ${space[2]};
  align-content: start;
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }
`

const Item = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[1]};
  padding: ${space[1]};
  border: 1px dotted transparent;
  background: transparent;
  color: #fff;
  cursor: pointer;
  min-width: 0;

  .icon {
    width: 64px;
    height: 56px;
    display: grid;
    place-items: center;
    position: relative;
  }
  .icon > img.folder {
    border: none !important;
    margin: 0;
    width: 60px;
    height: auto;
    image-rendering: pixelated;
  }
  .thumb {
    width: 56px;
    height: 56px;
    padding: 2px;
    background: ${color.highlight};
    box-shadow: ${bevel.raised};
  }
  .thumb img {
    border: none !important;
    margin: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    image-rendering: pixelated;
  }
  .thumb img.placeholder {
    object-fit: none;
  }
  .label {
    max-width: 100%;
    padding: 0 2px;
    font-size: ${text.xs};
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
    background: rgba(7, 4, 12, 0.72);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    padding: 0 2px;
    font-size: ${text.xs};
    color: ${PHOSPHOR};
    background: rgba(7, 4, 12, 0.72);
  }

  &.selected .label,
  &:focus-visible .label {
    background: #c8102e;
    color: #fff;
  }
  &.selected .thumb,
  &.selected img.folder {
    filter: saturate(1.2) brightness(0.9);
  }
  &:focus-visible {
    outline: none;
    border-color: ${PHOSPHOR};
  }
`

/* A page with a folded corner, drawn in CSS: the ERC-20 "documents". */
const Doc = styled.div`
  width: 44px;
  height: 54px;
  position: relative;
  background: ${color.highlight};
  box-shadow: 1px 1px 0 ${color.dark}, inset -1px -1px 0 ${color.shadow};
  clip-path: polygon(0 0, 72% 0, 100% 22%, 100% 100%, 0 100%);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: 6px;
  font-size: 10px;
  font-weight: 700;
  color: ${color.accentDark};
  &::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 28%;
    height: 22%;
    background: ${color.light};
    box-shadow: inset 1px -1px 0 ${color.shadow};
  }
  &::after {
    content: '';
    position: absolute;
    left: 7px;
    right: 9px;
    top: 16px;
    height: 16px;
    background: repeating-linear-gradient(180deg, ${color.faceLight} 0 2px, transparent 2px 5px);
  }
`

const StatusBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  gap: ${space[1]};
  font-size: ${text.xs};
  > div {
    padding: 2px ${space[2]};
    border: 1px solid #5f7a68;
    background: #07040c;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  > div:first-child {
    flex: 0 0 auto;
  }
  > div:last-child {
    flex: 1 1 auto;
    min-width: 0;
  }
`

const Empty = styled.div`
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space[3]};
  text-align: center;
  padding: ${space[4]};
  img {
    border: none !important;
    margin: 0;
    width: 72px;
    image-rendering: pixelated;
  }
  p {
    margin: 0;
    max-width: 320px;
    font-size: ${text.sm};
    line-height: 1.4;
    color: ${color.inkMuted};
  }
  ${BigButton} {
    max-width: 280px;
  }
  p,
  p * {
    color: #fff !important;
    text-shadow: 0 1px 3px #000, 0 0 2px #000;
  }
  ${BigButton} {
    outline: 1px solid ${PHOSPHOR};
    background: rgba(7, 4, 12, 0.85);
    color: ${PHOSPHOR};
    text-shadow: 0 0 6px rgba(160, 255, 190, 0.6);
    box-shadow: none;
    &:hover:not(:disabled) {
      background: #c8102e;
      color: #fff;
    }
    &:active:not(:disabled) {
      box-shadow: none;
    }
  }
`

export type Selection = { kind: 'nft'; nft: OwnedNft } | { kind: 'token'; doc: TokenDoc }

const isTouch = (e: React.MouseEvent | React.PointerEvent) =>
  (e.nativeEvent as PointerEvent).pointerType === 'touch' ||
  (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches)

export default function MyFiles() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(ID)
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const nfts = useWalletNfts(address)
  const tokens = useTokenDocs(address)
  const [folderKey, setFolderKey] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [open, setOpen] = useState<Selection>()

  const folders = useMemo(() => groupByCollection(nfts.data?.nfts || []), [nfts.data])
  const folder = folders.find((f) => f.key === folderKey)

  const path = `C:\\Wallet\\${address ? shortAddress(address) : 'Disconnected'}${folder ? `\\${folder.name}` : ''}`
  const count = !isConnected ? 0 : folder ? folder.items.length : folders.length + tokens.length

  // single click selects, double click opens; touch opens on tap
  const itemProps = (key: string, activate: () => void) => ({
    className: selected === key ? 'selected' : '',
    onClick: (e: React.MouseEvent) => {
      setSelected(key)
      if (isTouch(e)) activate()
    },
    onDoubleClick: activate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') activate()
    },
    'aria-selected': selected === key,
  })

  const goUp = () => {
    setFolderKey(undefined)
    setSelected(undefined)
  }

  let body: React.ReactNode
  if (!isConnected || !address) {
    body = (
      <Empty>
        <img src={FolderIcon} alt="" />
        <p>
          <strong>My Files</strong> shows your wallet as a folder: NFTs grouped by collection, tokens as documents.
        </p>
        <BigButton type="button" onClick={() => openConnectModal?.()} data-files-connect="">
          Connect wallet
        </BigButton>
      </Empty>
    )
  } else if (folder) {
    body = (
      <Grid role="listbox" aria-label={folder.name}>
        {folder.items.map((n) => (
          <Item
            key={`${n.contract}:${n.tokenId}`}
            type="button"
            role="option"
            title={n.name}
            {...itemProps(`${n.contract}:${n.tokenId}`, () => setOpen({ kind: 'nft', nft: n }))}
          >
            <span className="icon">
              <span className="thumb">
                {n.image ? (
                  <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <img src={FileEye} alt="" className="placeholder" />
                )}
              </span>
            </span>
            <span className="label">#{n.tokenId}</span>
          </Item>
        ))}
      </Grid>
    )
  } else {
    body = (
      <Grid role="listbox" aria-label="Wallet">
        {folders.map((f) => (
          <Item
            key={f.key}
            type="button"
            role="option"
            title={f.name}
            {...itemProps(f.key, () => {
              setFolderKey(f.key)
              setSelected(undefined)
            })}
          >
            <span className="icon">
              <img src={FolderIcon} alt="" className="folder" />
            </span>
            <span className="label">{f.name}</span>
            <span className="meta">{f.items.length} item(s)</span>
          </Item>
        ))}
        {nfts.isLoading &&
          [0, 1].map((i) => (
            <Item key={`sk-${i}`} as="div" aria-hidden>
              <span className="icon">
                <Skeleton h="48px" w="56px" />
              </span>
              <Skeleton h="12px" w="64px" />
            </Item>
          ))}
        {tokens.map((t) => (
          <Item
            key={t.key}
            type="button"
            role="option"
            title={`${t.name}.doc`}
            {...itemProps(t.key, () => setOpen({ kind: 'token', doc: t }))}
          >
            <span className="icon">
              <Doc>{t.symbol}</Doc>
            </span>
            <span className="label">{t.symbol}.doc</span>
            <span className="meta">{t.loading ? '…' : t.formatted ?? '?'}</span>
          </Item>
        ))}
      </Grid>
    )
  }

  return (
    <WindowWrapper skin="files">
      <TitleBar
        skin="files"
        minimizeBtn
        fullscreenBtn
        closeBtn
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
        onMinimize={() => dispatch(minimizeWindow({ value: ID }))}
        onClose={() => dispatch(closeWindow({ value: ID }))}
      >
        My Files{address ? ` - ${shortAddress(address)}` : ''}
      </TitleBar>
      <Root data-my-files="">
        <Toolbar>
          <button type="button" onClick={goUp} disabled={!folder} aria-label="Up one level" title="Up">
            ← Up
          </button>
          <AddressBar title={path}>{path}</AddressBar>
          <button
            type="button"
            onClick={() => nfts.refetch()}
            disabled={!isConnected || nfts.isFetching}
            aria-label="Refresh"
            title="Refresh"
          >
            ⟳
          </button>
        </Toolbar>
        {nfts.isError && isConnected && (
          <StatusBox tone="error">Couldn&apos;t read NFTs for this wallet. Tokens still load; try ⟳.</StatusBox>
        )}
        <Pane onClick={(e) => e.target === e.currentTarget && setSelected(undefined)}>{body}</Pane>
        <StatusBar>
          <div>{count} object(s)</div>
          <div>
            {!isConnected
              ? 'Not connected'
              : nfts.isFetching
              ? 'Reading wallet…'
              : nfts.data
              ? `${nfts.data.source}${nfts.data.partial ? ' · partial' : ''}`
              : ''}
          </div>
        </StatusBar>
        {open && address && <Properties selection={open} owner={address} onClose={() => setOpen(undefined)} />}
      </Root>
    </WindowWrapper>
  )
}

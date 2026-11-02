import { useConnectModal } from '@rainbow-me/rainbowkit'
import PlaceholderImage from 'assets/explorer/sample/collections.jpeg'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { formatEther } from 'viem'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { explorerUrl } from '@/config/wagmi'
import { MIYAMINI_CHAIN_ID, MIYAMINI_CONTRACT } from '@/constants/contracts'
import { bevel, color, space, text } from '@/theme/tokens'

import {
  BigButton,
  Chip,
  DisplayTitle,
  Eyebrow,
  Panel,
  ProgressMeter,
  Skeleton,
  StatRow,
  StatusBox,
  Stepper,
  Well,
} from '@/components/Retro'
import { describeError, useMiyaminiMint, useMiyaminiState, useTokenMeta } from './useMiyamini'

/** Product choice: cap a single transaction at 10 tokens (the contract itself has no per-tx limit we rely on). */
const MAX_PER_TX = 10
const RECENT_COUNT = 8

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  grid-template-areas:
    'head head'
    'preview mint'
    'recent recent';
  gap: ${space[4]};
  padding: ${space[4]};
  max-width: 980px;
  margin: 0 auto;

  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'preview' 'mint' 'recent';
    gap: ${space[3]};
    padding: ${space[3]};
  }
`

const Head = styled.header`
  grid-area: head;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[4]};
`

const PreviewPanel = styled(Panel)`
  grid-area: preview;
`

const MintPanel = styled(Panel)`
  grid-area: mint;
  justify-content: flex-start;
`

const RecentPanel = styled(Panel)`
  grid-area: recent;
`

const Frame = styled(Well)`
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  padding: 3px;
  img {
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
    border: none;
    margin: 0;
    display: block;
    image-rendering: auto;
  }
  img:hover {
    border: none;
  }
`

const Caption = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  font-size: ${text.sm};
  a {
    color: ${color.link};
  }
`

const Thumbs = styled.div`
  display: grid;
  grid-template-columns: repeat(${RECENT_COUNT}, minmax(0, 1fr));
  gap: ${space[2]};
  .narrow & {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
`

const Thumb = styled.button<{ selected?: boolean }>`
  padding: 3px;
  border: none;
  background: ${color.well};
  box-shadow: ${({ selected }) => (selected ? `${bevel.sunken}, 0 0 0 2px ${color.accent}` : bevel.raised)};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: ${text.xs};
  color: ${color.inkMuted};
  img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border: none;
    margin: 0;
    max-width: none;
  }
  img:hover {
    border: none;
  }
  &:hover {
    background: ${color.faceLight};
  }
`

const Muted = styled.p`
  margin: 0;
  font-size: ${text.sm};
  color: ${color.inkMuted};
  line-height: 1.5;
`

const Details = styled(Well)`
  margin-top: auto;
  padding: ${space[2]} ${space[3]};
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: ${text.xs};
  > div {
    display: flex;
    justify-content: space-between;
    gap: ${space[2]};
  }
  > div > span:first-child {
    color: ${color.inkMuted};
  }
  a {
    color: ${color.link};
  }
`

const SmallLink = styled.a`
  font-size: ${text.xs};
  color: ${color.link};
`

function TokenImage({ id, alt }: { id: number | undefined; alt: string }) {
  const { data, isLoading } = useTokenMeta(id)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [id])

  if (!id) return <img src={PlaceholderImage} alt="miyamaker mini preview" />
  if (isLoading || !data) return <Skeleton h="100%" />
  if (failed) return <img src={PlaceholderImage} alt={alt} style={{ opacity: 0.5 }} />
  return <img src={data.image} alt={data.name || alt} loading="lazy" onError={() => setFailed(true)} />
}

const formatEth = (wei: bigint | undefined) => {
  if (wei === undefined) return '…'
  const s = formatEther(wei)
  // trim to 4 decimals without rounding up displayed price
  const [i, d = ''] = s.split('.')
  return d ? `${i}.${d.slice(0, 4).replace(/0+$/, '') || '0'}` : i
}

export default function MiyaminiMint({
  onBrowseCollections,
  onBrowseMusic,
}: {
  onBrowseCollections?: () => void
  onBrowseMusic?: () => void
}) {
  const state = useMiyaminiState()
  const tx = useMiyaminiMint()
  const { openConnectModal } = useConnectModal()

  const [quantity, setQuantity] = useState(1)
  const [selected, setSelected] = useState<number | undefined>()

  const remaining =
    state.maxSupply !== undefined && state.totalSupply !== undefined ? state.maxSupply - state.totalSupply : undefined
  const soldOut = remaining !== undefined && remaining <= 0
  const maxQty = Math.max(1, Math.min(MAX_PER_TX, remaining ?? MAX_PER_TX))
  const total = state.price !== undefined ? state.price * BigInt(quantity) : undefined
  const insufficient = tx.balance !== undefined && total !== undefined && tx.balance < total

  useEffect(() => {
    if (quantity > maxQty) setQuantity(maxQty)
  }, [maxQty])

  useEffect(() => {
    if (tx.isConfirmed) {
      state.refetch()
      setSelected(undefined)
    }
  }, [tx.isConfirmed])

  const recentIds = useMemo(() => {
    if (!state.totalSupply) return []
    const ids: number[] = []
    for (let id = state.totalSupply; id > 0 && ids.length < RECENT_COUNT; id -= 1) ids.push(id)
    return ids
  }, [state.totalSupply])

  const previewId = selected ?? recentIds[0]
  const busy = tx.isAwaitingWallet || tx.isConfirming
  const err = describeError(tx.error)
  const txUrl = tx.hash ? `${explorerUrl(MIYAMINI_CHAIN_ID)}/tx/${tx.hash}` : undefined

  const action = (() => {
    if (state.isLoading) return { label: 'Loading…', disabled: true, onClick: () => {} }
    if (state.isError) return { label: 'Unavailable', disabled: true, onClick: () => {} }
    if (soldOut) return { label: 'Sold out', disabled: true, onClick: () => {} }
    if (state.mintOpen === false) return { label: 'Mint closed', disabled: true, onClick: () => {} }
    if (!tx.isConnected) return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return { label: tx.isSwitching ? 'Switching…' : 'Switch to Ethereum', disabled: tx.isSwitching, onClick: tx.switchToMainnet }
    if (tx.isAwaitingWallet) return { label: 'Confirm in wallet…', disabled: true, onClick: () => {} }
    if (tx.isConfirming) return { label: 'Minting…', disabled: true, onClick: () => {} }
    if (insufficient) return { label: 'Not enough ETH', disabled: true, onClick: () => {} }
    return {
      label: `Mint ${quantity}`,
      disabled: state.price === undefined,
      onClick: () => state.price !== undefined && tx.mint(quantity, state.price),
    }
  })()

  const [layoutRef, { width: layoutWidth }] = useElementSize()
  const narrow = layoutWidth > 0 && layoutWidth <= 620

  return (
    <Layout ref={layoutRef} className={narrow ? 'narrow' : undefined}>
      <Grid>
        <Head>
          <div>
            <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>
              MIYAMINI · Ethereum
            </Eyebrow>
            <DisplayTitle>{state.name || 'miyamaker mini'}</DisplayTitle>
          </div>
          <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
            {state.isLoading ? (
              <Chip tone="off">Reading chain</Chip>
            ) : state.isError ? (
              <Chip tone="warn">RPC unavailable</Chip>
            ) : soldOut ? (
              <Chip tone="off">Sold out</Chip>
            ) : state.mintOpen ? (
              <Chip tone="ok">Mint open</Chip>
            ) : (
              <Chip tone="warn">Mint closed</Chip>
            )}
          </div>
        </Head>

        <PreviewPanel aria-label="Preview">
          <Frame>
            <TokenImage id={previewId} alt="miyamaker mini" />
          </Frame>
          <Caption>
            <span>
              {previewId ? (
                <>
                  <strong>#{previewId}</strong>
                  {previewId === recentIds[0] && !selected ? ' · latest mint' : ''}
                </>
              ) : (
                'Preview'
              )}
            </span>
            {previewId && (
              <SmallLink
                href={`${explorerUrl(MIYAMINI_CHAIN_ID)}/nft/${MIYAMINI_CONTRACT}/${previewId}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Etherscan
              </SmallLink>
            )}
          </Caption>
        </PreviewPanel>

        <MintPanel aria-label="Mint">
          <StatRow>
            <span>Price</span>
            {state.isLoading ? <Skeleton w="96px" h="18px" /> : <strong>{formatEth(state.price)} ETH</strong>}
          </StatRow>

          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <StatRow>
              <span>Minted</span>
              {state.isLoading ? (
                <Skeleton w="96px" h="18px" />
              ) : (
                <strong>
                  {state.totalSupply ?? '–'} / {state.maxSupply ?? '–'}
                </strong>
              )}
            </StatRow>
            <ProgressMeter value={state.totalSupply || 0} max={state.maxSupply || 1} label="Minted supply" />
            <Muted>{remaining !== undefined ? `${remaining} left` : ' '}</Muted>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <Eyebrow as="label" htmlFor="mint-qty">
              Quantity
            </Eyebrow>
            <Stepper>
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity <= 1 || busy}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <input
                id="mint-qty"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxQty}
                value={quantity}
                disabled={busy}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value))
                  if (Number.isFinite(n)) setQuantity(Math.min(maxQty, Math.max(1, n)))
                }}
              />
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={quantity >= maxQty || busy}
                onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
              >
                +
              </button>
            </Stepper>
          </div>

          <StatRow>
            <span>Total</span>
            <strong>{formatEth(total)} ETH</strong>
          </StatRow>

          <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </BigButton>

          {tx.isAwaitingWallet && (
            <StatusBox tone="info" role="status">
              <img src={LoadingHourglass} alt="" />
              <span>Confirm the transaction in your wallet.</span>
            </StatusBox>
          )}
          {tx.isConfirming && (
            <StatusBox tone="info" role="status">
              <img src={LoadingHourglass} alt="" />
              <span>
                Transaction sent, waiting for confirmation.{' '}
                <a href={txUrl} target="_blank" rel="noreferrer">
                  View on Etherscan
                </a>
              </span>
            </StatusBox>
          )}
          {tx.isConfirmed && (
            <StatusBox tone="ok" role="status">
              <span>
                Minted! Welcome to the miyamaker minis.{' '}
                <a href={txUrl} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </span>
            </StatusBox>
          )}
          {(tx.reverted || (tx.error && !busy)) && (
            <StatusBox tone={err.cancelled ? 'info' : 'error'} role="alert">
              <span>
                {tx.reverted ? 'The transaction reverted.' : err.message}{' '}
                {txUrl && (
                  <a href={txUrl} target="_blank" rel="noreferrer">
                    View on Etherscan
                  </a>
                )}
              </span>
            </StatusBox>
          )}

          <Muted>
            {tx.isConnected && tx.balance !== undefined
              ? `Wallet balance: ${formatEth(tx.balance)} ETH on Ethereum`
              : 'Mints on Ethereum mainnet. Price is per token, plus gas.'}
          </Muted>
          <Details>
            <div>
              <span>Contract</span>
              <a
                href={`${explorerUrl(MIYAMINI_CHAIN_ID)}/address/${MIYAMINI_CONTRACT}`}
                target="_blank"
                rel="noreferrer"
              >
                {MIYAMINI_CONTRACT.slice(0, 6)}…{MIYAMINI_CONTRACT.slice(-4)}
              </a>
            </div>
            <div>
              <span>Standard</span>
              <span>ERC-721</span>
            </div>
            <div>
              <span>Chain</span>
              <span>Ethereum</span>
            </div>
          </Details>
          {onBrowseCollections && (
            <BigButton type="button" className="secondary" onClick={onBrowseCollections} style={{ minHeight: 36, fontSize: text.sm }}>
              Browse other collections
            </BigButton>
          )}
          {onBrowseMusic && (
            <BigButton
              type="button"
              className="secondary"
              onClick={onBrowseMusic}
              style={{ minHeight: 36, fontSize: text.sm }}
            >
              ♪ Music drops
            </BigButton>
          )}
        </MintPanel>

        <RecentPanel aria-label="Recent mints">
          <StatRow>
            <Eyebrow>Recent mints</Eyebrow>
            <SmallLink
              href={`${explorerUrl(MIYAMINI_CHAIN_ID)}/token/${MIYAMINI_CONTRACT}`}
              target="_blank"
              rel="noreferrer"
            >
              Contract
            </SmallLink>
          </StatRow>
          {state.isLoading ? (
            <Thumbs>
              {Array.from({ length: RECENT_COUNT }, (_, i) => (
                <Skeleton key={i} style={{ aspectRatio: '1 / 1' }} h="auto" />
              ))}
            </Thumbs>
          ) : recentIds.length === 0 ? (
            <Muted>{state.isError ? 'Could not reach Ethereum to load mints.' : 'No mints yet. Be the first.'}</Muted>
          ) : (
            <Thumbs>
              {recentIds.map((id) => (
                <Thumb
                  key={id}
                  type="button"
                  selected={id === previewId}
                  onClick={() => setSelected(id)}
                  aria-label={`Preview #${id}`}
                >
                  <TokenImage id={id} alt={`#${id}`} />
                  <span>#{id}</span>
                </Thumb>
              ))}
            </Thumbs>
          )}
        </RecentPanel>
      </Grid>
    </Layout>
  )
}

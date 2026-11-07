import { useConnectModal } from '@rainbow-me/rainbowkit'
import PlaceholderImage from 'assets/explorer/sample/collections.jpeg'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import { formatEther } from 'viem'

import { Skeleton } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { MIYAMINI_CHAIN_ID, MIYAMINI_CONTRACT } from '@/constants/contracts'
import ArtistTag from '@/pages/Mint/ArtistTag'
import { LIVE_MINTS } from '@/pages/Mint/liveMints'
import { color, space, text } from '@/theme/tokens'

import type { MachineStatus } from '../handheld/MintCart'
import MintCart from '../handheld/MintCart'
import type { LampTone } from '../handheld/status'
import MintNeeds from '../MintNeeds'
import { describeError, useMiyaminiMint, useMiyaminiState, useTokenMeta } from './useMiyamini'

/** Product choice: cap a single transaction at 10 tokens (the contract itself has no per-tx limit we rely on). */
const MAX_PER_TX = 10
const RECENT_COUNT = 8

const Thumbs = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${space[1]};
`

const Thumb = styled.button<{ selected?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-size: ${text.xs};
  color: ${color.ink};
  background: #e8e4f5;
  box-shadow: ${({ selected }) => (selected ? '0 0 0 3px #ff2eaa' : '0 2px 3px rgba(0, 0, 0, 0.6)')};
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
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 2px;
  }
`

function TokenImage({ id, alt }: { id: number | undefined; alt: string }) {
  const { data, isLoading } = useTokenMeta(id)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [id])

  if (!id) return <img src={CREDIT?.image || PlaceholderImage} alt="miyamaker mini cover" />
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

const CREDIT = LIVE_MINTS.find((e) => e.slug === 'miyamini')

export default function MiyaminiMint() {
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

  // The collection's fixed cover, until someone picks a recent mint to look at.
  const previewId = selected
  const busy = tx.isAwaitingWallet || tx.isConfirming
  const err = describeError(tx.error)
  const txUrl = tx.hash ? `${explorerUrl(MIYAMINI_CHAIN_ID)}/tx/${tx.hash}` : undefined

  const action = (() => {
    if (state.isLoading) return { label: 'Loading…', disabled: true, onClick: () => {} }
    if (state.isError) return { label: 'Unavailable', disabled: true, onClick: () => {} }
    if (soldOut) return { label: 'Sold out', disabled: true, onClick: () => {} }
    if (state.mintOpen === false) return { label: 'Mint closed', disabled: true, onClick: () => {} }
    if (!tx.isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return {
        label: tx.isSwitching ? 'Switching…' : 'Switch to Ethereum',
        disabled: tx.isSwitching,
        onClick: tx.switchToMainnet,
      }
    if (tx.isAwaitingWallet) return { label: 'Confirm in wallet…', disabled: true, onClick: () => {} }
    if (tx.isConfirming) return { label: 'Minting…', disabled: true, onClick: () => {} }
    if (insufficient) return { label: 'Not enough ETH', disabled: true, onClick: () => {} }
    return {
      label: `Mint ${quantity} for ${formatEth(total)} ETH`,
      disabled: state.price === undefined,
      onClick: () => state.price !== undefined && tx.mint(quantity, state.price),
    }
  })()

  const status: MachineStatus | undefined = tx.isAwaitingWallet
    ? { tone: 'info', body: 'Confirm the transaction in your wallet.' }
    : tx.isConfirming
    ? {
        tone: 'info',
        body: (
          <>
            Transaction sent, waiting for confirmation.{' '}
            <a href={txUrl} target="_blank" rel="noreferrer">
              View on Etherscan
            </a>
          </>
        ),
      }
    : tx.reverted || (tx.error && !busy)
    ? {
        tone: err.cancelled ? 'info' : 'error',
        alert: true,
        body: (
          <>
            {tx.reverted ? 'The transaction reverted.' : err.message}{' '}
            {txUrl && (
              <a href={txUrl} target="_blank" rel="noreferrer">
                View on Etherscan
              </a>
            )}
          </>
        ),
      }
    : undefined

  const lamp: { tone: LampTone; label: string } = state.isError
    ? { tone: 'warn', label: 'Can’t reach chain' }
    : soldOut
    ? { tone: 'off', label: 'Sold out' }
    : state.mintOpen
    ? { tone: 'ok', label: 'Mint open' }
    : state.mintOpen === false
    ? { tone: 'warn', label: 'Mint closed' }
    : { tone: 'off', label: 'Checking…' }

  return (
    <MintCart
      name={state.name || 'miyamaker mini'}
      artist={
        <ArtistTag artist={CREDIT?.artist} logo={CREDIT?.artistLogo} url={CREDIT?.artistUrl} style={{ color: 'inherit' }} />
      }
      lamps={[lamp, { tone: 'off', label: 'Ethereum' }]}
      art={<TokenImage id={previewId} alt="miyamaker mini" />}
      onArtStep={
        recentIds.length > 1
          ? (step) => {
              const at = recentIds.indexOf(previewId as number)
              setSelected(recentIds[(at + step + recentIds.length) % recentIds.length])
            }
          : undefined
      }
      caption={previewId ? `#${previewId}` : undefined}
      blurb={CREDIT?.blurb}
      price={`${formatEth(state.price)} ETH`}
      loading={state.isLoading}
      minted={state.totalSupply}
      supply={state.maxSupply}
      left={remaining}
      quantity={quantity}
      maxQty={maxQty}
      busy={busy}
      onQuantity={setQuantity}
      total={`${formatEth(total)} ETH`}
      balance={tx.isConnected && tx.balance !== undefined ? `${formatEth(tx.balance)} ETH` : undefined}
      action={action}
      status={status}
      needs={!tx.isConnected ? <MintNeeds /> : undefined}
      dropped={
        tx.isConfirmed ? (
          <>
            <strong>Minted!</strong>
            <span>
              Welcome to the miyamaker minis.{' '}
              <a href={txUrl} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </span>
          </>
        ) : undefined
      }
      stamp={
        <>
          <span>
            Contract{' '}
            <a href={`${explorerUrl(MIYAMINI_CHAIN_ID)}/address/${MIYAMINI_CONTRACT}`} target="_blank" rel="noreferrer">
              {MIYAMINI_CONTRACT.slice(0, 6)}…{MIYAMINI_CONTRACT.slice(-4)}
            </a>
          </span>
          {previewId && (
            <a
              href={`${explorerUrl(MIYAMINI_CHAIN_ID)}/nft/${MIYAMINI_CONTRACT}/${previewId}`}
              target="_blank"
              rel="noreferrer"
            >
              #{previewId} on Etherscan
            </a>
          )}
          <span>ERC-721 on Ethereum</span>
        </>
      }
    >
      <section aria-label="Recent mints">
        <strong>Recent mints</strong>
        {state.isLoading ? (
          <Thumbs>
            {Array.from({ length: RECENT_COUNT }, (_, i) => (
              <Skeleton key={i} style={{ aspectRatio: '1 / 1' }} h="auto" />
            ))}
          </Thumbs>
        ) : recentIds.length === 0 ? (
          <p>{state.isError ? 'Could not reach Ethereum to load mints.' : 'No mints yet. Be the first.'}</p>
        ) : (
          <Thumbs>
            {recentIds.map((id) => (
              <Thumb
                key={id}
                type="button"
                selected={id === previewId}
                onClick={() => setSelected((now) => (now === id ? undefined : id))}
                aria-label={`Preview #${id}`}
              >
                <TokenImage id={id} alt={`#${id}`} />
                <span>#{id}</span>
              </Thumb>
            ))}
          </Thumbs>
        )}
      </section>
    </MintCart>
  )
}

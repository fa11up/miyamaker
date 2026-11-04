import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import type { Address, Hash } from 'viem'
import {
  useAccount,
  useBalance,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
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
import type { SupportedChainId } from '@/config/wagmi'
import { explorerUrl } from '@/config/wagmi'
import BackToMints from '@/pages/Mint/BackToMints'
import { StatusChip } from '@/pages/Mint/Home'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { formatEthShort, toCard } from '@/pages/Mint/liveMints'
import { erc721mAbi } from '@/pages/Mint/Miyamini/abi'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import type { ReadResult } from '@/pages/Mint/useLiveMints'
import { dropAbi, dropCalls, erc721mCalls, readsFromResults, useContractImage } from '@/pages/Mint/useLiveMints'
import { color, space, text } from '@/theme/tokens'

/**
 * Generic mint view for any live mint that has no dedicated page: legacy ERC721M clones (mint(amount)) and miyamints
 * drops (public phase: mint(phaseId, qty, [])). Same layout as MIYAMINI so every collection feels the same.
 */

const MAX_PER_TX = 10

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
    'preview mint';
  gap: ${space[4]};
  padding: ${space[4]};
  max-width: 980px;
  margin: 0 auto;
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'preview' 'mint';
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

const Muted = styled.p`
  margin: 0;
  font-size: ${text.sm};
  color: ${color.inkMuted};
  line-height: 1.5;
`

const Details = styled(Well)`
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

function useCollection(card: LiveMintCard) {
  const address = card.address as Address
  const reads = useReadContracts({
    contracts: card.kind === 'erc721m' ? erc721mCalls(address, card.chainId) : dropCalls(address, card.chainId),
    query: { refetchInterval: 15_000 },
  })
  const r = reads.data ? readsFromResults(card.kind, reads.data as ReadResult[]) : undefined
  const live = r ? toCard({ ...card, address }, r, card.source) : card
  return { reads: r, live, isLoading: reads.isLoading, isError: reads.isError && !reads.data, refetch: reads.refetch }
}

function useMint(card: LiveMintCard, phaseId: number | undefined) {
  const chainId = card.chainId as SupportedChainId
  const { address, chainId: walletChain, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const balance = useBalance({ address, chainId, query: { enabled: !!address } })
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({
    hash: write.data as Hash | undefined,
    chainId,
    query: { enabled: !!write.data },
  })

  useEffect(() => {
    if (receipt.isSuccess) balance.refetch()
  }, [receipt.isSuccess])

  const mint = (qty: number, price: bigint) => {
    const value = price * BigInt(qty)
    if (card.kind === 'drop') {
      if (phaseId === undefined) return
      write.writeContract({
        address: card.address as Address,
        abi: dropAbi,
        chainId,
        functionName: 'mint',
        args: [BigInt(phaseId), BigInt(qty), []],
        value,
      })
      return
    }

    write.writeContract({
      address: card.address as Address,
      abi: erc721mAbi,
      chainId,
      functionName: 'mint',
      args: [BigInt(qty)],
      value,
    })
  }

  return {
    isConnected,
    wrongChain: isConnected && walletChain !== chainId,
    switchChain: () => switchChain({ chainId }),
    isSwitching,
    balance: balance.data?.value,
    mint,
    hash: write.data,
    isAwaitingWallet: write.isPending,
    isConfirming: !!write.data && receipt.isLoading,
    isConfirmed: receipt.isSuccess && receipt.data?.status === 'success',
    reverted: receipt.isSuccess && receipt.data?.status === 'reverted',
    error: write.error || receipt.error,
  }
}

export default function LiveMintView({ card, onBack }: { card: LiveMintCard; onBack: () => void }) {
  const { reads, live, isLoading, isError, refetch } = useCollection(card)
  const tx = useMint(card, reads?.phaseId)
  const { openConnectModal } = useConnectModal()
  const cover = useContractImage(live.image ? undefined : live.contractURI)
  const [quantity, setQuantity] = useState(1)

  const remaining = live.supply !== undefined && live.minted !== undefined ? live.supply - live.minted : undefined
  const maxQty = Math.max(1, Math.min(MAX_PER_TX, remaining ?? MAX_PER_TX))
  const total = live.price !== undefined ? live.price * BigInt(quantity) : undefined
  const insufficient = tx.balance !== undefined && total !== undefined && tx.balance < total
  const busy = tx.isAwaitingWallet || tx.isConfirming
  const err = describeError(tx.error)
  const explorer = explorerUrl(card.chainId)
  const txUrl = tx.hash ? `${explorer}/tx/${tx.hash}` : undefined

  useEffect(() => {
    if (quantity > maxQty) setQuantity(maxQty)
  }, [maxQty])
  useEffect(() => {
    if (tx.isConfirmed) refetch()
  }, [tx.isConfirmed])

  const action = (() => {
    const off = (label: string) => ({ label, disabled: true, onClick: () => {} })
    if (isLoading) return off('Loading…')
    if (isError) return off('Unavailable')
    if (live.status === 'soldout') return off('Sold out')
    if (live.status !== 'open') return off('Mint closed')
    if (!tx.isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return {
        label: tx.isSwitching ? 'Switching…' : `Switch to ${live.chainName}`,
        disabled: tx.isSwitching,
        onClick: tx.switchChain,
      }
    if (tx.isAwaitingWallet) return off('Confirm in wallet…')
    if (tx.isConfirming) return off('Minting…')
    if (insufficient) return off('Not enough ETH')
    return {
      label: `Mint ${quantity}`,
      disabled: live.price === undefined,
      onClick: () => live.price !== undefined && tx.mint(quantity, live.price),
    }
  })()

  const [ref, { width }] = useElementSize()
  const narrow = width > 0 && width <= 620

  return (
    <Layout ref={ref} className={narrow ? 'narrow' : undefined}>
      <Grid>
        <Head>
          <div>
            <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>
              Mint · {live.chainName}
            </Eyebrow>
            <DisplayTitle>{live.name}</DisplayTitle>
          </div>
          <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
            {isError ? <Chip tone="warn">RPC unavailable</Chip> : <StatusChip status={live.status} />}
            <BackToMints onBack={onBack} />
          </div>
        </Head>

        <Panel style={{ gridArea: 'preview' }} aria-label="Preview">
          <Well style={{ padding: 3 }}>
            <NftImage src={live.image || cover.data || undefined} alt={live.name} eager />
          </Well>
          {live.blurb && <Muted>{live.blurb}</Muted>}
        </Panel>

        <Panel style={{ gridArea: 'mint' }} aria-label="Mint">
          <StatRow>
            <span>Price</span>
            {isLoading ? <Skeleton w="96px" h="18px" /> : <strong>{formatEthShort(live.price)}</strong>}
          </StatRow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <StatRow>
              <span>Minted</span>
              {isLoading ? (
                <Skeleton w="96px" h="18px" />
              ) : (
                <strong>
                  {live.minted ?? '–'} / {live.supply ?? '–'}
                </strong>
              )}
            </StatRow>
            <ProgressMeter value={live.minted || 0} max={live.supply || 1} label="Minted supply" />
            {remaining !== undefined && <Muted>{remaining.toLocaleString()} left</Muted>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <Eyebrow as="label" htmlFor="live-mint-qty">
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
                id="live-mint-qty"
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
            <strong>{formatEthShort(total)}</strong>
          </StatRow>

          {tx.isConnected && tx.balance !== undefined && (
            <StatRow>
              <span>In your wallet</span>
              <strong>{formatEthShort(tx.balance)}</strong>
            </StatRow>
          )}

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
                Sent. Waiting for the chain to confirm.{' '}
                <a href={txUrl} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </span>
            </StatusBox>
          )}
          {tx.isConfirmed && (
            <StatusBox tone="ok" role="status">
              <span>
                Minted!{' '}
                <a href={txUrl} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </span>
            </StatusBox>
          )}
          {(tx.reverted || (tx.error && !busy)) && (
            <StatusBox tone={err.cancelled ? 'info' : 'error'} role="alert">
              <span>{tx.reverted ? 'The transaction reverted.' : err.message}</span>
            </StatusBox>
          )}

          <Muted>Price is per token, plus network fees.</Muted>
          <Details>
            <div>
              <span>Contract</span>
              <a href={`${explorer}/address/${card.address}`} target="_blank" rel="noreferrer">
                {card.address?.slice(0, 6)}…{card.address?.slice(-4)}
              </a>
            </div>
            <div>
              <span>Chain</span>
              <span>{live.chainName}</span>
            </div>
          </Details>
        </Panel>
      </Grid>
    </Layout>
  )
}

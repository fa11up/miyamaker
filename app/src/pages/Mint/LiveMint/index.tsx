import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import type { Address, Hash } from 'viem'
import { isAddress } from 'viem'
import {
  useAccount,
  useBalance,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { explorerUrl } from '@/config/wagmi'
import ArtistTag from '@/pages/Mint/ArtistTag'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { formatEthShort, mintableNow, toCard } from '@/pages/Mint/liveMints'
import type { MachineStatus } from '@/pages/Mint/handheld/MintCart'
import MintCart from '@/pages/Mint/handheld/MintCart'
import { statusLamp } from '@/pages/Mint/handheld/status'
import { TX_CANCELLED_WORDS, TX_UNCONFIRMED_WORDS } from '@/miyamints/txOutcome'
import { useTxOutcome } from '@/miyamints/useTxOutcome'
import MintNeeds from '@/pages/Mint/MintNeeds'
import { erc721mAbi } from '@/pages/Mint/Miyamini/abi'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import type { ReadResult } from '@/pages/Mint/useLiveMints'
import { dropAbi, dropCalls, erc721mCalls, readsFromResults, useContractImage } from '@/pages/Mint/useLiveMints'
import { space, text } from '@/theme/tokens'

/**
 * Generic mint view for any live mint that has no dedicated page: legacy ERC721M clones (mint(amount)) and miyamints
 * drops (public phase: mint(phaseId, qty, [])). Same layout as MIYAMINI so every collection feels the same.
 */

const MAX_PER_TX = 10

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
  const { outcome } = useTxOutcome(chainId, write.data as Hash | undefined)

  useEffect(() => {
    if (outcome === 'success') balance.refetch()
  }, [outcome])

  const mint = (qty: number, price: bigint, to?: Address) => {
    const value = price * BigInt(qty)
    if (card.kind === 'drop') {
      if (phaseId === undefined) return
      const common = { address: card.address as Address, abi: dropAbi, chainId, value }
      if (to) {
        write.writeContract({ ...common, functionName: 'mintTo', args: [to, BigInt(phaseId), BigInt(qty), []] })
      } else {
        write.writeContract({ ...common, functionName: 'mint', args: [BigInt(phaseId), BigInt(qty), []] })
      }

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
    isConfirming: outcome === 'waiting',
    isConfirmed: outcome === 'success',
    reverted: outcome === 'reverted',
    /** Replaced by the wallet's cancel: the replacement's receipt says success, and nothing was minted. */
    cancelled: outcome === 'cancelled',
    /** It was sent, but its receipt couldn't be read: it may still land, so Mint isn't offered again. */
    unconfirmed: outcome === 'unknown',
    reset: write.reset,
    error: write.error,
  }
}

export default function LiveMintView({ card }: { card: LiveMintCard }) {
  const { reads, live, isLoading, isError, refetch } = useCollection(card)
  const tx = useMint(card, reads?.phaseId)
  const { openConnectModal } = useConnectModal()
  const cover = useContractImage(live.image ? undefined : live.contractURI)
  const [quantity, setQuantity] = useState(1)
  const [sendElsewhere, setSendElsewhere] = useState(false)
  const [recipient, setRecipient] = useState('')
  const { address: account } = useAccount()
  const maxPerWallet = reads?.maxPerWallet
  const walletReads = useReadContract({
    address: card.address as Address,
    abi: dropAbi,
    functionName: 'mintedInPhase',
    args: account && reads?.phaseId !== undefined ? [BigInt(reads.phaseId), account] : undefined,
    chainId: card.chainId as SupportedChainId,
    query: { enabled: card.kind === 'drop' && !!account && !!maxPerWallet && reads?.phaseId !== undefined },
  })
  const walletMinted = walletReads.data !== undefined ? Number(walletReads.data) : undefined

  const remaining =
    live.left ?? (live.supply !== undefined && live.minted !== undefined ? live.supply - live.minted : undefined)
  const mintable = mintableNow({ maxPerTx: MAX_PER_TX, left: remaining, maxPerWallet, walletMinted })
  const maxQty = Math.max(1, mintable)
  const badRecipient = sendElsewhere && !isAddress(recipient.trim())
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
    if (tx.isConfirmed || tx.reverted) {
      refetch()
      walletReads.refetch()
    }
  }, [tx.isConfirmed, tx.reverted])

  const action = (() => {
    const off = (label: string) => ({ label, disabled: true, onClick: () => {} })
    // What is under way comes first: the last piece going to someone else doesn't change what this one is doing.
    if (tx.isAwaitingWallet) return off('Confirm in wallet…')
    if (tx.isConfirming) return off('Minting…')
    if (tx.unconfirmed) return { label: 'Start over', disabled: false, onClick: tx.reset }
    if (isLoading) return off('Loading…')
    if (isError) return off('Unavailable')
    if (live.status === 'soldout') return off('Sold out')
    if (live.status === 'unknown') return off('Unavailable')
    if (live.status !== 'open') return off('Mint closed')
    if (!tx.isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return {
        label: tx.isSwitching ? 'Switching…' : `Switch to ${live.chainName}`,
        disabled: tx.isSwitching,
        onClick: tx.switchChain,
      }
    if (mintable === 0) return off('Wallet limit reached')
    if (insufficient) return off('Not enough ETH')
    if (badRecipient) return off('Enter a wallet address')
    return {
      label: `Mint ${quantity} for ${formatEthShort(total)}`,
      disabled: live.price === undefined,
      onClick: () =>
        live.price !== undefined &&
        tx.mint(quantity, live.price, sendElsewhere ? (recipient.trim() as Address) : undefined),
    }
  })()

  const status: MachineStatus | undefined = tx.isAwaitingWallet
    ? { tone: 'info', body: 'Confirm the transaction in your wallet.' }
    : tx.isConfirming
    ? {
        tone: 'info',
        body: (
          <>
            Sent. Waiting for the chain to confirm.{' '}
            <a href={txUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </>
        ),
      }
    : tx.unconfirmed
    ? {
        tone: 'info',
        alert: true,
        body: (
          <>
            {TX_UNCONFIRMED_WORDS}{' '}
            <a href={txUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </>
        ),
      }
    : tx.cancelled
    ? { tone: 'info', body: TX_CANCELLED_WORDS }
    : tx.reverted || (tx.error && !busy)
    ? {
        tone: err.cancelled ? 'info' : 'error',
        alert: true,
        body: tx.reverted
          ? 'The mint did not go through. Someone may have minted first, so check what is left.'
          : err.message,
      }
    : undefined

  return (
    <MintCart
      name={live.name}
      artist={
        <ArtistTag
          artist={live.artist}
          logo={live.artistLogo}
          url={live.artistUrl}
          address={live.artistAddress}
          explorer={explorer}
          style={{ color: 'inherit' }}
        />
      }
      lamps={[
        isError ? { tone: 'warn', label: 'Can’t reach chain' } : statusLamp(live.status, isLoading),
        { tone: 'off', label: live.chainName },
      ]}
      art={<NftImage src={live.image || cover.data || undefined} alt={live.name} eager />}
      blurb={live.blurb}
      price={formatEthShort(live.price)}
      loading={isLoading}
      minted={live.minted}
      supply={live.supply}
      left={remaining}
      notes={
        maxPerWallet
          ? `Limit ${maxPerWallet} per wallet${walletMinted ? ` · you have minted ${walletMinted}` : ''}`
          : undefined
      }
      quantity={quantity}
      maxQty={maxQty}
      busy={busy}
      stay={tx.unconfirmed}
      onQuantity={setQuantity}
      extras={
        card.kind === 'drop' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            <label style={{ display: 'flex', gap: space[2], alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sendElsewhere}
                disabled={busy}
                onChange={(e) => setSendElsewhere(e.target.checked)}
              />
              Send to another wallet
            </label>
            {sendElsewhere && (
              <>
                <input
                  aria-label="Wallet to receive the mint"
                  value={recipient}
                  placeholder="0x…"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <span style={{ fontSize: text.xs }}>You pay, and the limit counts against your wallet.</span>
              </>
            )}
          </div>
        )
      }
      total={formatEthShort(total)}
      balance={tx.isConnected && tx.balance !== undefined ? formatEthShort(tx.balance) : undefined}
      action={action}
      status={status}
      needs={!tx.isConnected ? <MintNeeds chainName={live.chainName} /> : undefined}
      dropped={
        tx.isConfirmed ? (
          <>
            <strong>Minted!</strong>
            <span>
              It is in your wallet.{' '}
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
            <a href={`${explorer}/address/${card.address}`} target="_blank" rel="noreferrer">
              {card.address?.slice(0, 6)}…{card.address?.slice(-4)}
            </a>
          </span>
          <span>{live.chainName}</span>
        </>
      }
    />
  )
}

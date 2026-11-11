import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQueries } from '@tanstack/react-query'
import { readContract } from '@wagmi/core'
import { useEffect, useMemo, useState } from 'react'
import type { Address, Hash } from 'viem'
import { erc20Abi, isAddress } from 'viem'
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
import { explorerUrl, wagmiConfig } from '@/config/wagmi'
import type { PayToken } from '@/miyamints/tokens'
import type { ProofAnswer } from '@/miyamints/allowlistApi'
import { fetchListInfo, fetchProof } from '@/miyamints/allowlistApi'
import { revertName } from '@/miyamints/errors'
import { COULDNT_CHECK_WORDS, freshCost, phaseGate, priceRoseWords } from '@/miyamints/precheck'
import { approveWords, ETH, isEth, knownToken, payPlan, pickToken, sameToken, tokenLabel } from '@/miyamints/tokens'
import { runPay } from '@/miyamints/payRun'
import { readTokenGate, useTokenInfo, useWalletToken } from '@/miyamints/usePay'
import { useTx } from '@/miyamints/useTx'
import ArtistTag from '@/pages/Mint/ArtistTag'
import type { ListStanding, LiveMintCard } from '@/pages/Mint/liveMints'
import {
  defaultPhase,
  formatEthShort,
  listStanding,
  mintableNow,
  STANDING_BUTTON,
  STANDING_WORDS,
  toCard,
} from '@/pages/Mint/liveMints'
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

import { mintedWhere } from './where'

/**
 * Generic mint view for any live mint that has no dedicated page: legacy ERC721M clones (mint(amount)) and miyamints
 * drops (mint(phaseId, qty, proof, token, maxCost), paid in any token the phase sells for: an ERC-20 is approved for
 * exactly the total first). A drop with more than one phase running shows them all: public phases, and allowlist
 * phases with where the connected wallet stands on each (its proof comes from miya's allowlist route and is checked
 * against the phase's root before use). Same layout as MIYAMINI so every collection feels the same.
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

/**
 * `onStale`: the sale changed on chain since it was read (price, phase, supply), so the screen reads it again.
 * `symbol`: the paying token's, for the words of a check that fails.
 */
function useMint(
  card: LiveMintCard,
  phaseId: number | undefined,
  /** An allowlist phase: the paying wallet's proof. Undefined for a public phase. */
  proof: readonly `0x${string}`[] | undefined,
  onStale: () => void
) {
  const chainId = card.chainId as SupportedChainId
  const { address, chainId: walletChain, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const balance = useBalance({ address, chainId, query: { enabled: !!address } })
  const write = useWriteContract()
  const { outcome } = useTxOutcome(chainId, write.data as Hash | undefined)
  /** The ERC-20 approval before a drop mint paid in that token (exactly the total, never unlimited). */
  const approval = useTx()
  /** The checks read again before anything is signed (drops): running, and why they stopped the mint. */
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string>()

  useEffect(() => {
    if (outcome === 'success') balance.refetch()
  }, [outcome])
  // The price moved up between the check and the mint: read the sale again so the new price shows.
  useEffect(() => {
    if (revertName(write.error) === 'ExceedsMaxCost') onStale()
  }, [write.error])

  /**
   * A drop's phase, supply and token read again: what can change between the screen's read and the send. The fresh
   * total, or why not. A phase's price is fixed, but the artist can replace the phases.
   */
  const recheck = async (qty: number, shown: bigint, token: Address, symbol: string) => {
    if (phaseId === undefined || (proof && !address)) return { ok: false as const, error: COULDNT_CHECK_WORDS }
    const read = { address: card.address as Address, abi: dropAbi, chainId }
    const [gate, phases, sold, left, mine] = await Promise.all([
      readTokenGate(chainId, card.address as Address, token, symbol),
      readContract(wagmiConfig, { ...read, functionName: 'phases' }),
      readContract(wagmiConfig, { ...read, functionName: 'phasesMinted' }),
      readContract(wagmiConfig, { ...read, functionName: 'publicRemaining' }),
      proof
        ? readContract(wagmiConfig, { ...read, functionName: 'mintedInPhase', args: [BigInt(phaseId), address as Address] })
        : Promise.resolve(undefined),
    ]).catch(() => [COULDNT_CHECK_WORDS] as const)
    if (gate) return { ok: false as const, error: gate }
    const phase = phaseGate(
      phases?.[phaseId],
      token,
      qty,
      Math.floor(Date.now() / 1000),
      sold?.[phaseId],
      left,
      proof ? { account: address as Address, proof, walletMinted: mine } : undefined
    )
    if (!phase.ok) return phase
    const f = freshCost(shown, phase.price * BigInt(qty))
    return { ok: true as const, ...f }
  }

  const mint = async (
    qty: number,
    price: bigint,
    to?: Address,
    token: Address = ETH,
    symbol = 'ETH',
    money: (amount: bigint) => string = (amount) => amount.toString()
  ) => {
    // A new press starts clean: an earlier approval's error or a refused check must not stand over this mint.
    approval.reset()
    setCheckError(undefined)
    const value = price * BigInt(qty)
    if (card.kind === 'drop') {
      if (phaseId === undefined || checking) return
      // Read again, approve if short, then mint: runPay (src/miyamints/payRun.ts) keeps that order and its stops.
      await runPay(
        {
          token,
          amount: value,
          call: undefined,
          account: address,
          prepare: async () => {
            const fresh = await recheck(qty, value, token, symbol).catch(() => ({
              ok: false as const,
              error: COULDNT_CHECK_WORDS,
            }))
            if (!fresh.ok) {
              onStale()
              return fresh
            }
            if (fresh.changed) onStale()
            if (fresh.rose) return { ok: false as const, error: priceRoseWords(money(fresh.amount)) }
            return { ok: true as const, amount: fresh.amount }
          },
        },
        {
          step: (s) => setChecking(s === 'check'),
          refuse: setCheckError,
          readAllowance: () =>
            readContract(wagmiConfig, {
              address: token,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address as Address, card.address as Address],
              chainId,
            }),
          approve: (need) =>
            approval.run('approve', {
              address: token,
              abi: erc20Abi,
              functionName: 'approve',
              args: [card.address as Address, need],
              chainId,
            }),
          send: async (_call, total) => {
            const plan = payPlan(token, total)
            const common = { address: card.address as Address, abi: dropAbi, chainId, value: plan.value }
            if (to) {
              write.writeContract({
                ...common,
                functionName: 'mintTo',
                args: [to, BigInt(phaseId), BigInt(qty), proof ?? [], token, plan.maxCost],
              })
            } else {
              write.writeContract({
                ...common,
                functionName: 'mint',
                args: [BigInt(phaseId), BigInt(qty), proof ?? [], token, plan.maxCost],
              })
            }
            return true
          },
        }
      )
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
    /** The wallet the signed call mints to, when it was mintTo (another wallet); undefined for a plain mint. */
    sentTo:
      write.variables?.functionName === 'mintTo' ? String((write.variables.args as readonly unknown[])[0]) : undefined,
    isAwaitingWallet: write.isPending,
    /** Reading the sale again before anything is signed, and why that stopped the mint. */
    checking,
    checkError,
    /** The approval step: its wallet prompt or its wait, and how it ended. */
    approving: approval.busy,
    approvalStuck: approval.unconfirmed,
    approvalError:
      approval.tx.phase === 'error' && !approval.unconfirmed ? approval.tx.message : undefined,
    resetApproval: () => {
      approval.reset()
      setCheckError(undefined)
    },
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

/** The connected wallet's standing on each allowlist phase running now: its proof, its count, the words. */
function useListPhases(card: LiveMintCard, reads: ReturnType<typeof readsFromResults> | undefined, account?: Address) {
  const phases = reads?.livePhases ?? []
  const lists = phases.filter((p) => p.isList)
  const chainId = card.chainId as SupportedChainId
  const proofs = useQueries({
    queries: lists.map((p) => ({
      queryKey: ['allowlist-proof', p.root.toLowerCase(), account?.toLowerCase()],
      enabled: !!account,
      staleTime: 5 * 60_000,
      retry: 1,
      queryFn: (): Promise<ProofAnswer> => fetchProof(p.root, account as Address),
    })),
  })
  const names = useQueries({
    queries: lists.map((p) => ({
      queryKey: ['allowlist-info', p.root.toLowerCase()],
      staleTime: Infinity,
      queryFn: () => fetchListInfo(p.root).then((i) => i ?? null),
    })),
  })
  const minted = useReadContracts({
    contracts: lists.map((p) => ({
      address: card.address as Address,
      abi: dropAbi,
      functionName: 'mintedInPhase' as const,
      args: [BigInt(p.phaseId), account as Address] as const,
      chainId,
    })),
    query: { enabled: card.kind === 'drop' && !!account && lists.length > 0, refetchInterval: 15_000 },
  })
  const byPhase: Record<number, { standing: ListStanding; proof?: `0x${string}`[]; name?: string; count?: number }> = {}
  lists.forEach((p, i) => {
    const answer = proofs[i]?.data
    const m = minted.data?.[i]
    const left = p.left === undefined ? reads?.publicRemaining : Math.min(p.left, reads?.publicRemaining ?? p.left)
    byPhase[p.phaseId] = {
      standing: listStanding({
        account,
        proof: proofs[i]?.isError ? { state: 'unknown' } : answer,
        maxPerWallet: p.maxPerWallet,
        minted: m?.status === 'success' ? Number(m.result) : undefined,
        left,
      }),
      proof: answer?.state === 'listed' ? answer.proof : undefined,
      name: names[i]?.data?.name,
      count: names[i]?.data?.count,
    }
  })
  return { phases, byPhase, refetchMinted: minted.refetch }
}

export default function LiveMintView({ card }: { card: LiveMintCard }) {
  const { reads, live, isLoading, isError, refetch } = useCollection(card)
  const { address: account } = useAccount()
  const lists = useListPhases(card, reads, account)
  const [chosen, setChosen] = useState<number>()
  const standings = useMemo(
    () => Object.fromEntries(Object.entries(lists.byPhase).map(([k, v]) => [k, v.standing])),
    [lists.byPhase]
  )
  // The phase picked, while it is still running; else a list this wallet can claim in, else the public sale.
  const phaseId =
    chosen !== undefined && lists.phases.some((p) => p.phaseId === chosen)
      ? chosen
      : card.kind === 'drop'
      ? defaultPhase(lists.phases, standings)
      : undefined
  const phase = lists.phases.find((p) => p.phaseId === phaseId)
  const claim = phase?.isList ? lists.byPhase[phase.phaseId] : undefined
  const tx = useMint(card, phaseId, claim?.proof, () => refetch())
  const { openConnectModal } = useConnectModal()
  const cover = useContractImage(live.image ? undefined : live.contractURI)
  const [quantity, setQuantity] = useState(1)
  const [sendElsewhere, setSendElsewhere] = useState(false)
  const [recipient, setRecipient] = useState('')
  const maxPerWallet = card.kind === 'drop' ? phase?.maxPerWallet : reads?.maxPerWallet
  // Drops sell for any token their chosen phase prices; the legacy ERC721M is ETH only.
  const phasePrices = phase?.prices || []
  const offered = card.kind === 'drop' ? phasePrices.map((p) => p.token) : [ETH]
  const info = useTokenInfo(card.chainId, offered)
  const [picked, setPicked] = useState<string>()
  const token = pickToken(offered, picked) ?? ETH
  const unit: PayToken | undefined = isEth(token) ? knownToken(card.chainId, ETH) : info[token.toLowerCase()]
  const unitPrice =
    card.kind === 'drop' ? phasePrices.find((p) => sameToken(p.token, token))?.price : live.price
  const erc20 = !isEth(token)
  const tokenWallet = useWalletToken(card.chainId, erc20 ? token : undefined, card.address as Address)
  const money = (amount: bigint | undefined) =>
    amount === undefined || !unit ? '…' : isEth(token) ? formatEthShort(amount) : amount === 0n ? 'Free' : tokenLabel(amount, unit)
  const walletReads = useReadContract({
    address: card.address as Address,
    abi: dropAbi,
    functionName: 'mintedInPhase',
    args: account && phaseId !== undefined ? [BigInt(phaseId), account] : undefined,
    chainId: card.chainId as SupportedChainId,
    query: { enabled: card.kind === 'drop' && !!account && !!maxPerWallet && phaseId !== undefined },
  })
  const walletMinted = walletReads.data !== undefined ? Number(walletReads.data) : undefined

  // A drop: what the chosen phase can still sell (its cap or the public supply, whichever runs out first).
  const remaining =
    card.kind === 'drop' && phase
      ? phase.left === undefined
        ? reads?.publicRemaining
        : Math.min(phase.left, reads?.publicRemaining ?? phase.left)
      : live.left ?? (live.supply !== undefined && live.minted !== undefined ? live.supply - live.minted : undefined)
  const mintable = mintableNow({ maxPerTx: MAX_PER_TX, left: remaining, maxPerWallet, walletMinted })
  const maxQty = Math.max(1, mintable)
  const badRecipient = sendElsewhere && !isAddress(recipient.trim())
  const total = unitPrice !== undefined ? unitPrice * BigInt(quantity) : undefined
  const walletBalance = erc20 ? tokenWallet.balance : tx.balance
  const insufficient = walletBalance !== undefined && total !== undefined && walletBalance < total
  const busy = tx.isAwaitingWallet || tx.isConfirming || tx.approving || tx.checking
  const err = describeError(tx.error)
  const explorer = explorerUrl(card.chainId)
  const txUrl = tx.hash ? `${explorer}/tx/${tx.hash}` : undefined

  useEffect(() => {
    if (quantity > maxQty) setQuantity(maxQty)
  }, [maxQty])
  // Another token picked: the last token's approval error or refused check is about something else now.
  useEffect(() => {
    if (!tx.approving && !tx.approvalStuck) tx.resetApproval()
  }, [token])
  useEffect(() => {
    if (tx.isConfirmed || tx.reverted) {
      refetch()
      walletReads.refetch()
      tokenWallet.refetch()
      lists.refetchMinted()
    }
  }, [tx.isConfirmed, tx.reverted])

  const action = (() => {
    const off = (label: string) => ({ label, disabled: true, onClick: () => {} })
    // What is under way comes first: the last piece going to someone else doesn't change what this one is doing.
    if (tx.checking) return off('Checking the price…')
    if (tx.approving) return off(`Approving ${unit?.symbol ?? ''}…`)
    if (tx.approvalStuck) return { label: 'Start over', disabled: false, onClick: tx.resetApproval }
    if (tx.isAwaitingWallet) return off('Confirm in wallet…')
    if (tx.isConfirming) return off('Minting…')
    if (tx.unconfirmed) return { label: 'Start over', disabled: false, onClick: tx.reset }
    if (isLoading) return off('Loading…')
    if (isError) return off('Unavailable')
    if (live.status === 'soldout') return off('Sold out')
    if (live.status === 'unknown') return off('Unavailable')
    if (live.status !== 'open' || (card.kind === 'drop' && !phase)) return off('Mint closed')
    if (!tx.isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return {
        label: tx.isSwitching ? 'Switching…' : `Switch to ${live.chainName}`,
        disabled: tx.isSwitching,
        onClick: tx.switchChain,
      }
    if (claim && claim.standing !== 'eligible') return off(STANDING_BUTTON[claim.standing] ?? 'Not available')
    if (phase && phase.left === 0) return off('This phase is sold out')
    if (mintable === 0) return off(claim ? 'Already claimed' : 'Wallet limit reached')
    if (insufficient) return off(`Not enough ${unit?.symbol ?? 'funds'}`)
    if (badRecipient) return off('Enter a wallet address')
    return {
      label: total === 0n ? `Claim ${quantity} free` : `Mint ${quantity} for ${money(total)}`,
      disabled: unitPrice === undefined || !unit,
      onClick: () => {
        // The phase stays picked through the mint: a claim used up must not switch the screen to another phase.
        if (phaseId !== undefined) setChosen(phaseId)
        if (unitPrice === undefined) return
        tx.mint(
          quantity,
          unitPrice,
          sendElsewhere ? (recipient.trim() as Address) : undefined,
          token,
          unit?.symbol,
          money
        )
      },
    }
  })()

  const status: MachineStatus | undefined = tx.approving
    ? { tone: 'info', body: `Step 1 of 2: approve exactly ${money(total)} in your wallet, then confirm the mint.` }
    : tx.approvalStuck
    ? { tone: 'info', alert: true, body: TX_UNCONFIRMED_WORDS }
    : tx.approvalError
    ? { tone: 'error', alert: true, body: tx.approvalError }
    : tx.checkError
    ? { tone: 'error', alert: true, body: tx.checkError }
    : tx.isAwaitingWallet
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
      price={money(unitPrice)}
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
      stay={tx.unconfirmed || tx.approvalStuck}
      onQuantity={setQuantity}
      extras={
        card.kind === 'drop' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            {(lists.phases.length > 1 || phase?.isList) && (
              <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <legend style={{ padding: 0, marginBottom: 2 }}>Sale</legend>
                {lists.phases.map((p) => {
                  const l = lists.byPhase[p.phaseId]
                  const name = p.isList ? l?.name ?? 'Allowlist' : 'Public sale'
                  const t = knownToken(card.chainId, ETH)
                  const priceWords = p.prices.every((x) => x.price === 0n)
                    ? 'free'
                    : p.price !== undefined && t
                    ? `${formatEthShort(p.price)}${p.prices.length > 1 ? ' or other tokens' : ''}`
                    : 'priced in tokens'
                  return (
                    <label key={p.phaseId} style={{ display: 'flex', gap: space[2], alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`phase-${card.key}`}
                        checked={p.phaseId === phaseId}
                        disabled={busy}
                        onChange={() => {
                          // Another phase: the last one's refused check, error or receipt is about something else.
                          setChosen(p.phaseId)
                          setPicked(undefined)
                          setQuantity(1)
                          if (!tx.approvalStuck) tx.resetApproval()
                          if (!tx.unconfirmed) tx.reset()
                        }}
                      />
                      <span>
                        <b>{name}</b>, {priceWords}
                        {p.maxPerWallet ? `, ${p.maxPerWallet} per wallet` : ''}
                        {p.left === 0 ? ' (sold out)' : ''}
                        {p.isList && l && (
                          <>
                            <br />
                            <small>{STANDING_WORDS[l.standing]}</small>
                          </>
                        )}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            )}
            {offered.length > 1 && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                Pay with
                <select
                  value={token.toLowerCase()}
                  disabled={busy}
                  onChange={(e) => setPicked(e.target.value)}
                  style={{ minHeight: 36, fontSize: 16 }}
                >
                  {phasePrices.map((p) => {
                    const t = info[p.token.toLowerCase()]
                    return (
                      <option key={p.token} value={p.token.toLowerCase()}>
                        {t ? (p.price === 0n ? `Free (${t.symbol})` : `${tokenLabel(p.price, t)} each`) : 'Token unavailable'}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}
            {erc20 && unit && total !== undefined && total > 0n && (
              <span style={{ fontSize: text.xs }}>{approveWords(total, unit, 'this collection')}</span>
            )}
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
      total={money(total)}
      balance={
        tx.isConnected && walletBalance !== undefined
          ? erc20 && unit
            ? tokenLabel(walletBalance, unit)
            : money(walletBalance)
          : undefined
      }
      action={action}
      status={status}
      needs={!tx.isConnected ? <MintNeeds chainName={live.chainName} /> : undefined}
      dropped={
        tx.isConfirmed ? (
          <>
            <strong>Minted!</strong>
            <span>
              {mintedWhere(tx.sentTo, account)}{' '}
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

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hash } from 'viem'
import { erc20Abi } from 'viem'
import { usePublicClient, useReadContract, useSendTransaction, useWriteContract } from 'wagmi'

import { useTx } from '@/miyamints/useTx'
import { useCanBatch } from '@/utils/batch'

import { fetchPrice, fetchQuote, SwapApiError } from './api'
import type { SwapChainId } from './constants'
import { isNative, QUOTE_MAX_AGE_MS } from './constants'
import { ALLOWANCE_HOLDER, quoteProblem } from './quoteGuard'
import { latestOnly, receiptOutcome } from './swapLogic'
import type { SwapRequest, ZeroExQuote } from './types'

/** Indicative price, refreshed while the user is looking at it. Call sites debounce the amount. */
export function usePrice(req: SwapRequest | undefined) {
  return useQuery({
    queryKey: [
      '0x-price',
      req?.chainId,
      req?.sellToken,
      req?.buyToken,
      req?.sellAmount.toString(),
      req?.taker,
      req?.slippageBps,
    ],
    queryFn: ({ signal }) => fetchPrice(req!, signal),
    enabled: !!req && req.sellAmount > 0n,
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: (count, error) => !(error instanceof SwapApiError && error.status >= 400 && error.status < 500) && count < 2,
  })
}

/**
 * Price for a sliver (1/1000) of the same trade, used as the "no impact" reference for price impact. Fetched once
 * per settled amount (no polling), without a taker, so it costs one extra price call per change.
 */
export function useReferencePrice(req: SwapRequest | undefined) {
  const sliver = req ? req.sellAmount / 1000n : 0n
  const ref = req && sliver > 0n ? { ...req, sellAmount: sliver, taker: undefined } : undefined
  return useQuery({
    queryKey: ['0x-ref-price', ref?.chainId, ref?.sellToken, ref?.buyToken, ref?.sellAmount.toString()],
    queryFn: ({ signal }) => fetchPrice(ref!, signal),
    enabled: !!ref,
    staleTime: 60_000,
    retry: false,
  })
}

/** 1 - (rate for the trade / rate for a sliver), floored at 0. Undefined when either side is missing. */
export function priceImpact(
  trade: { sellAmount: string; buyAmount: string } | undefined,
  reference: { sellAmount: string; buyAmount: string } | undefined
): number | undefined {
  if (!trade || !reference) return undefined
  const r = Number(trade.buyAmount) / Number(trade.sellAmount)
  const ref = Number(reference.buyAmount) / Number(reference.sellAmount)
  if (!Number.isFinite(r) || !Number.isFinite(ref) || ref <= 0) return undefined
  return Math.max(0, 1 - r / ref)
}

export type FirmQuote = Extract<ZeroExQuote, { liquidityAvailable: true }>
export type QuoteState = { quote: ZeroExQuote; fetchedAt: number; request: SwapRequest } | undefined

/**
 * A transaction's receipt, with its status. Not wagmi's useWaitForTransactionReceipt: that throws on a revert, which made
 * a reverted swap look the same as a failed look-up, and a failed look-up says nothing about the swap.
 */
function useReceipt(chainId: SwapChainId, hash: Hash | undefined) {
  const client = usePublicClient({ chainId })
  const q = useQuery({
    queryKey: ['tx-receipt', chainId, hash],
    enabled: !!hash && !!client,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 3,
    queryFn: () => client!.waitForTransactionReceipt({ hash: hash!, timeout: 0 }),
  })
  return { receipt: q.data, outcome: receiptOutcome(hash, q.data, q.isError) }
}

/**
 * Review -> (approve) -> swap.
 * - The firm quote is fetched only when the user asks to review. If it is older than 30s when the user presses
 *   Swap, it is re-fetched and shown instead of being sent: the user confirms the new price with a second press.
 * - Every firm quote is checked against the request and the pinned AllowanceHolder (quoteGuard.ts) and refused
 *   on any mismatch. In the AllowanceHolder flow `issues.allowance.spender` and `transaction.to` are both
 *   AllowanceHolder (it calls Settler itself); approval goes to the pinned address, for exactly the sell amount.
 * - A nonzero allowance below the amount is reset to 0 first (USDT-style tokens revert on nonzero -> nonzero).
 */
export function useSwapExecution({ chainId, taker }: { chainId: SwapChainId; taker?: Address }) {
  const [state, setState] = useState<QuoteState>()
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<unknown>()
  /** The quote was re-fetched because it went stale: shown to the user, not sent. */
  const [requoted, setRequoted] = useState(false)
  /** Which approval steps really happened in this review, so the step count stays true. */
  const [didReset, setDidReset] = useState(false)
  const [didApprove, setDidApprove] = useState(false)
  const lastApproveWasReset = useRef(false)
  // An older quote that lands late must not arm Swap for an amount no longer on the screen.
  const quotes = useRef(latestOnly()).current

  const firm = state && state.quote.liquidityAvailable ? (state.quote as FirmQuote) : undefined
  const request = state?.request
  const sellsNative = isNative(request?.sellToken)
  // Pinned, not taken from the quote (quoteProblem() already refused quotes naming anything else).
  const spender = firm ? (ALLOWANCE_HOLDER[chainId] as Address | undefined) : undefined

  const allowance = useReadContract({
    address: request?.sellToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: taker && spender ? [taker, spender] : undefined,
    chainId,
    query: { enabled: !!taker && !!spender && !sellsNative },
  })

  // Trust the on-chain allowance once we have it; otherwise fall back to what 0x reported.
  const needsApproval =
    !!firm &&
    !sellsNative &&
    !!spender &&
    (allowance.data !== undefined ? allowance.data < (request?.sellAmount ?? 0n) : !!firm.issues.allowance)
  // USDT and similar tokens revert on approve(nonzero) while the allowance is nonzero: reset to 0 first.
  const needsAllowanceReset = needsApproval && allowance.data !== undefined && allowance.data > 0n

  const approve = useWriteContract()
  const approveReceipt = useReceipt(chainId, approve.data)

  const send = useSendTransaction()
  const canBatchSwap = useCanBatch(chainId)
  const batch = useTx((id) => {
    if (id === 'approve') allowance.refetch()
  })
  const batchHash = batch.tx.id === 'swap' ? batch.tx.hash : undefined
  const swapHash = send.data ?? batchHash
  const swapReceipt = useReceipt(chainId, swapHash)

  const getQuote = useCallback(async (req: SwapRequest) => {
    const ticket = quotes.begin()
    setQuoting(true)
    setQuoteError(undefined)
    try {
      const quote = await fetchQuote(req)
      if (!quotes.isCurrent(ticket)) return undefined
      const problem = quote.liquidityAvailable ? quoteProblem(quote, req) : undefined
      if (problem) {
        setState(undefined)
        throw new SwapApiError(`${problem} Swap refused for your safety. Nothing has moved.`, 'QUOTE_MISMATCH', 0)
      }

      setState({ quote, fetchedAt: Date.now(), request: req })
      return quote
    } catch (e) {
      if (quotes.isCurrent(ticket)) setQuoteError(e)
      return undefined
    } finally {
      if (quotes.isCurrent(ticket)) setQuoting(false)
    }
  }, [])

  useEffect(() => {
    if (approveReceipt.outcome === 'success' && state) {
      if (lastApproveWasReset.current) setDidReset(true)
      else setDidApprove(true)
      allowance.refetch()
      getQuote(state.request)
    }
  }, [approveReceipt.outcome, approve.data])

  const doApprove = () => {
    if (!request || !spender) return
    lastApproveWasReset.current = needsAllowanceReset
    approve.writeContract({
      address: request.sellToken,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, needsAllowanceReset ? 0n : request.sellAmount],
      chainId,
    })
  }

  const doSwap = async () => {
    if (!state) return
    if (Date.now() - state.fetchedAt > QUOTE_MAX_AGE_MS) {
      // Never send a quote the user has not seen: show the refreshed one and wait for another press.
      setRequoted(true)
      await getQuote(state.request)
      return
    }

    const current: ZeroExQuote = state.quote
    if (!current.liquidityAvailable || quoteProblem(current, state.request)) return
    setRequoted(false)
    const tx = current.transaction
    if (needsApproval && canBatchSwap && request && spender) {
      const allow = (amount: bigint) => ({
        address: request.sellToken,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
        chainId,
      })
      batch.runBatch(
        'swap',
        [
          ...(needsAllowanceReset ? [allow(0n)] : []),
          allow(request.sellAmount),
          // No gas limit from the quote: it was priced for the swap alone, and the wallet estimates the whole batch.
          { to: tx.to, data: tx.data, value: BigInt(tx.value || '0'), chainId },
        ],
        'approve'
      )
      return
    }

    send.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || '0'),
      gas: tx.gas ? BigInt(tx.gas) : undefined,
      chainId,
    })
  }

  const reset = () => {
    quotes.cancel()
    setQuoting(false)
    setState(undefined)
    setQuoteError(undefined)
    setRequoted(false)
    setDidReset(false)
    setDidApprove(false)
    approve.reset()
    send.reset()
    batch.reset()
  }

  return {
    quoteState: state,
    firm,
    quoting,
    quoteError,
    getQuote,
    reset,
    needsApproval,
    needsAllowanceReset,
    canBatch: canBatchSwap,
    requoted,
    approve: doApprove,
    approveHash: approve.data as Hash | undefined,
    approving: approve.isPending || approveReceipt.outcome === 'waiting',
    approveError: approve.error,
    approveReverted: approveReceipt.outcome === 'reverted',
    approveUnconfirmed: approveReceipt.outcome === 'unknown',
    didReset,
    didApprove,
    swap: doSwap,
    swapHash: swapHash as Hash | undefined,
    awaitingWallet: send.isPending || batch.tx.phase === 'wallet',
    confirming: batch.tx.phase === 'pending' || swapReceipt.outcome === 'waiting',
    // A wallet may report a finished batch without a receipt to look up.
    confirmed:
      swapReceipt.outcome === 'success' || (batch.tx.id === 'swap' && batch.tx.phase === 'done' && !batchHash),
    reverted: swapReceipt.outcome === 'reverted',
    /** The swap was sent, but its receipt could not be read: it may still land, so it must not be offered again. */
    unconfirmed: swapReceipt.outcome === 'unknown',
    swapError: send.error || (batch.tx.phase === 'error' ? batch.tx.error : undefined),
    swapReceipt: swapReceipt.receipt,
  }
}

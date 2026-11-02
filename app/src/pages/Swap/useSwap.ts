import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { Address, Hash } from 'viem'
import { BaseError, erc20Abi } from 'viem'
import { useReadContract, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { fetchPrice, fetchQuote, SwapApiError } from './api'
import type { SwapChainId } from './constants'
import { isNative, QUOTE_MAX_AGE_MS } from './constants'
import { ALLOWANCE_HOLDER, quoteProblem } from './quoteGuard'
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

/** Turns wallet/RPC errors into a sentence; wallet rejection is a cancel, not a failure. */
export function describeTxError(error: unknown): { message: string; cancelled: boolean } {
  if (!error) return { message: '', cancelled: false }
  if (error instanceof SwapApiError) return { message: error.message, cancelled: false }
  const base = error instanceof BaseError ? error : undefined
  const text = base?.shortMessage || (error as Error).message || 'Something went wrong.'
  const details = `${base?.details || ''} ${text}`
  if (/reject|denied|cancel/i.test(details)) return { message: 'Cancelled in wallet.', cancelled: true }
  if (/insufficient funds/i.test(details))
    return { message: 'Not enough ETH for this trade plus gas.', cancelled: false }
  return { message: text, cancelled: false }
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
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approve.data,
    chainId,
    query: { enabled: !!approve.data },
  })

  const send = useSendTransaction()
  const swapReceipt = useWaitForTransactionReceipt({ hash: send.data, chainId, query: { enabled: !!send.data } })

  const getQuote = useCallback(async (req: SwapRequest) => {
    setQuoting(true)
    setQuoteError(undefined)
    try {
      const quote = await fetchQuote(req)
      const problem = quote.liquidityAvailable ? quoteProblem(quote, req) : undefined
      if (problem) {
        setState(undefined)
        throw new SwapApiError(`${problem} Swap refused for your safety.`, 'QUOTE_MISMATCH', 0)
      }

      setState({ quote, fetchedAt: Date.now(), request: req })
      return quote
    } catch (e) {
      setQuoteError(e)
      return undefined
    } finally {
      setQuoting(false)
    }
  }, [])

  useEffect(() => {
    if (approveReceipt.isSuccess && state) {
      allowance.refetch()
      getQuote(state.request)
    }
  }, [approveReceipt.isSuccess])

  const doApprove = () => {
    if (!request || !spender) return
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
    send.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || '0'),
      gas: tx.gas ? BigInt(tx.gas) : undefined,
      chainId,
    })
  }

  const reset = () => {
    setState(undefined)
    setQuoteError(undefined)
    setRequoted(false)
    approve.reset()
    send.reset()
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
    requoted,
    approve: doApprove,
    approveHash: approve.data as Hash | undefined,
    approving: approve.isPending || (!!approve.data && approveReceipt.isLoading),
    approveError: approve.error || approveReceipt.error,
    swap: doSwap,
    swapHash: send.data as Hash | undefined,
    awaitingWallet: send.isPending,
    confirming: !!send.data && swapReceipt.isLoading,
    confirmed: swapReceipt.isSuccess && swapReceipt.data?.status === 'success',
    reverted: swapReceipt.isSuccess && swapReceipt.data?.status === 'reverted',
    swapError: send.error || swapReceipt.error,
    swapReceipt: swapReceipt.data,
  }
}

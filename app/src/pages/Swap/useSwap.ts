import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { Address, Hash } from 'viem'
import { BaseError, erc20Abi } from 'viem'
import { useReadContract, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { SwapApiError, fetchPrice, fetchQuote } from './api'
import type { SwapChainId } from './constants'
import { isNative, QUOTE_MAX_AGE_MS } from './constants'
import type { SwapRequest, ZeroExQuote } from './types'

/** Indicative price, refreshed while the user is looking at it. Call sites debounce the amount. */
export function usePrice(req: SwapRequest | undefined) {
  return useQuery({
    queryKey: ['0x-price', req?.chainId, req?.sellToken, req?.buyToken, req?.sellAmount.toString(), req?.taker, req?.slippageBps],
    queryFn: ({ signal }) => fetchPrice(req!, signal),
    enabled: !!req && req.sellAmount > 0n,
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: (count, error) => !(error instanceof SwapApiError && error.status >= 400 && error.status < 500) && count < 2,
  })
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
  if (/insufficient funds/i.test(details)) return { message: 'Not enough ETH for this trade plus gas.', cancelled: false }
  return { message: text, cancelled: false }
}

/**
 * Review -> (approve) -> swap.
 * - The firm quote is fetched only when the user asks to review, and re-fetched if older than 30s
 *   before sending.
 * - Approval goes to `issues.allowance.spender` (AllowanceHolder), never to `transaction.to` (Settler),
 *   for exactly the sell amount.
 */
export function useSwapExecution({ chainId, taker }: { chainId: SwapChainId; taker?: Address }) {
  const [state, setState] = useState<QuoteState>()
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<unknown>()

  const firm = state && state.quote.liquidityAvailable ? (state.quote as FirmQuote) : undefined
  const request = state?.request
  const sellsNative = isNative(request?.sellToken)
  const spender = firm?.issues.allowance?.spender

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

  const approve = useWriteContract()
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data, chainId, query: { enabled: !!approve.data } })

  const send = useSendTransaction()
  const swapReceipt = useWaitForTransactionReceipt({ hash: send.data, chainId, query: { enabled: !!send.data } })

  const getQuote = useCallback(async (req: SwapRequest) => {
    setQuoting(true)
    setQuoteError(undefined)
    try {
      const quote = await fetchQuote(req)
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
      args: [spender, request.sellAmount],
      chainId,
    })
  }

  const doSwap = async () => {
    if (!state) return
    let current: ZeroExQuote | undefined = state.quote
    if (Date.now() - state.fetchedAt > QUOTE_MAX_AGE_MS) current = await getQuote(state.request)
    if (!current || !current.liquidityAvailable) return
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
  }
}

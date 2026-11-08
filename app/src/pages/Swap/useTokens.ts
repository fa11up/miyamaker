import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Address } from 'viem'
import { erc20Abi, isAddress } from 'viem'
import { useBalance, useReadContract, useReadContracts } from 'wagmi'

import { readOutcome } from '@/hooks/readFailure'

import type { SwapChainId, SwapToken } from './constants'
import { isNative, PINNED_TOKENS, sameAddress, TOKEN_LIST_URL } from './constants'
import { mergeTokenLists } from './tokenList'

type UniswapList = { tokens: unknown[] }

/** The curated miya list first, then the Uniswap default list for the chain (deduped, sorted). */
export function useTokenList(chainId: SwapChainId) {
  const list = useQuery({
    queryKey: ['uniswap-token-list'],
    queryFn: async () => {
      const res = await fetch(TOKEN_LIST_URL)
      if (!res.ok) throw new Error(`Token list ${res.status}`)
      const body = (await res.json()) as UniswapList
      return { tokens: Array.isArray(body?.tokens) ? body.tokens : [] }
    },
    staleTime: 60 * 60 * 1000,
    gcTime: Infinity,
    retry: 1,
  })

  const tokens = useMemo(
    () => mergeTokenLists(PINNED_TOKENS[chainId], list.data?.tokens || [], chainId) as SwapToken[],
    [list.data, chainId]
  )

  return { tokens, isLoading: list.isLoading, isError: list.isError }
}

/** Reads an arbitrary pasted ERC20 so users can trade tokens that are not on the list. */
export function useCustomToken(chainId: SwapChainId, query: string, known: SwapToken[]) {
  const address = isAddress(query.trim()) ? (query.trim() as Address) : undefined
  const listed = address ? known.find((t) => sameAddress(t.address, address)) : undefined
  const enabled = !!address && !listed && !isNative(address)

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address, abi: erc20Abi, functionName: 'name', chainId },
      { address, abi: erc20Abi, functionName: 'symbol', chainId },
      { address, abi: erc20Abi, functionName: 'decimals', chainId },
    ],
    query: { enabled, retry: false },
  })

  // A revert or no code is a real "not a token"; an RPC failure is "couldn't check", not a verdict.
  const [name, symbol, decimals] = (reads.data || []).map((r) => readOutcome<unknown>(r))
  const answers = [name, symbol, decimals]
  const refused = !!reads.data && answers.some((a) => a === null)
  const unknown = reads.isError || (!!reads.data && !refused && answers.some((a) => a === undefined))
  const token: SwapToken | undefined =
    enabled && typeof name === 'string' && typeof symbol === 'string' && typeof decimals === 'number'
      ? { chainId, address: address!, name, symbol, decimals, unverified: true }
      : undefined

  return {
    address,
    listed,
    token,
    isLoading: enabled && reads.isLoading,
    notAToken: enabled && !token && refused,
    /** The reads never got an answer: we can't say whether it is a token. */
    checkFailed: enabled && !token && !refused && unknown,
    refetch: reads.refetch,
  }
}

/** Balance of a token (native or ERC20) for the connected wallet on the swap chain. */
export function useTokenBalance(token: SwapToken | undefined, owner: Address | undefined) {
  const native = !!token && isNative(token.address)
  const nativeBal = useBalance({
    address: owner,
    chainId: token?.chainId as SwapChainId,
    query: { enabled: !!owner && native, refetchInterval: 15_000 },
  })
  const erc20Bal = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: token?.chainId as SwapChainId,
    query: { enabled: !!owner && !!token && !native, refetchInterval: 15_000 },
  })
  return {
    value: native ? nativeBal.data?.value : (erc20Bal.data as bigint | undefined),
    refetch: () => (native ? nativeBal.refetch() : erc20Bal.refetch()),
  }
}

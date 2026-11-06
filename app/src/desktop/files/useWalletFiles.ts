import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { erc20Abi, formatUnits } from 'viem'
import { mainnet } from 'viem/chains'
import { useBalance, usePublicClient, useReadContracts } from 'wagmi'

import { CONTRACT_CHECK_PATH } from '../../../api/_lib/contractcheck'
import { DESKTOP_COLLECTIONS } from '../collections'
import { getNftIndexer } from './indexer'

/** ERC-20s shown as "documents" in My Files. */
export const FILE_TOKENS = [
  { address: '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921', symbol: 'INFER', name: 'INFER' },
  { address: '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25', symbol: 'imdUSD', name: 'imdUSD v1' },
  { address: '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A', symbol: 'MIYA', name: 'MIYA' },
] as const satisfies readonly { address: Address; symbol: string; name: string }[]

export interface TokenDoc {
  kind: 'token'
  key: string
  name: string
  symbol: string
  /** undefined for native ETH */
  address?: Address
  balance?: bigint
  decimals: number
  formatted?: string
  loading: boolean
}

export function formatAmount(value: bigint | undefined, decimals: number): string | undefined {
  if (value === undefined) return undefined
  const n = Number(formatUnits(value, decimals))
  if (n === 0) return '0'
  if (n < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : n < 1000 ? 4 : 2 })
}

export function useTokenDocs(owner: Address | undefined): { docs: TokenDoc[]; refetch: () => void } {
  const chainId = mainnet.id
  const eth = useBalance({ address: owner, chainId, query: { enabled: !!owner, refetchInterval: 60_000 } })
  const reads = useReadContracts({
    allowFailure: true,
    contracts: FILE_TOKENS.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Address], chainId },
      { address: t.address, abi: erc20Abi, functionName: 'decimals', chainId },
    ]),
    query: { enabled: !!owner, refetchInterval: 60_000 },
  })

  const docs: TokenDoc[] = [
    {
      kind: 'token',
      key: 'eth',
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      balance: eth.data?.value,
      formatted: formatAmount(eth.data?.value, 18),
      loading: eth.isLoading,
    },
  ]
  FILE_TOKENS.forEach((t, i) => {
    const bal = reads.data?.[i * 2]
    const dec = reads.data?.[i * 2 + 1]
    const decimals = dec?.status === 'success' ? Number(dec.result) : 18
    const balance = bal?.status === 'success' ? (bal.result as bigint) : undefined
    docs.push({
      kind: 'token',
      key: t.address.toLowerCase(),
      name: t.name,
      symbol: t.symbol,
      address: t.address,
      decimals,
      balance,
      formatted: formatAmount(balance, decimals),
      loading: reads.isLoading,
    })
  })
  return {
    docs,
    refetch: () => {
      eth.refetch()
      reads.refetch()
    },
  }
}

const CHECK_BATCH = 20

/** Etherscan's word on each contract. Anything it has not answered is simply missing. */
export function useContractChecks(contracts: string[]) {
  const list = [...new Set(contracts.map((c) => c.toLowerCase()))].sort()
  return useQuery({
    queryKey: ['contract-checks', list.join()],
    enabled: list.length > 0,
    staleTime: 10 * 60_000,
    retry: 1,
    // Anything Etherscan could not answer yet (it is rate limited) gets asked again.
    refetchInterval: (query) => (list.some((c) => query.state.data?.[c] === undefined) ? 60_000 : false),
    queryFn: async () => {
      const verified: Record<string, boolean> = {}
      // One batch at a time: the server is pacing itself to Etherscan's limit.
      for (let i = 0; i < list.length; i += CHECK_BATCH) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`${CONTRACT_CHECK_PATH}?a=${list.slice(i, i + CHECK_BATCH).join(',')}`)
        // eslint-disable-next-line no-await-in-loop
        if (res.ok) Object.assign(verified, ((await res.json()) as { verified: Record<string, boolean> }).verified)
      }
      return verified
    },
  })
}

export function useWalletNfts(owner: Address | undefined) {
  const client = usePublicClient({ chainId: mainnet.id })
  return useQuery({
    queryKey: ['desktop-wallet-nfts', owner?.toLowerCase()],
    enabled: !!owner && !!client,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: ({ signal }) => getNftIndexer(client!, DESKTOP_COLLECTIONS).getNftsForOwner(owner!, { signal }),
  })
}

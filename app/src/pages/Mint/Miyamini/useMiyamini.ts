import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Hash } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import {
  useAccount,
  useBalance,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'

import { MIYAMINI_CHAIN_ID, MIYAMINI_CONTRACT, MIYAMINI_METADATA_BASE } from '@/constants/contracts'

import { erc721mAbi } from './abi'
import { useTxOutcome } from '@/miyamints/useTxOutcome'

const contract = { address: MIYAMINI_CONTRACT, abi: erc721mAbi, chainId: MIYAMINI_CHAIN_ID } as const

/** On-chain state of the MIYAMINI collection, read from mainnet regardless of the wallet's chain. */
export function useMiyaminiState() {
  const result = useReadContracts({
    contracts: [
      { ...contract, functionName: 'name' },
      { ...contract, functionName: 'price' },
      { ...contract, functionName: 'totalSupply' },
      { ...contract, functionName: 'maxSupply' },
      { ...contract, functionName: 'mintOpen' },
    ],
    query: { refetchInterval: 15_000 },
  })

  const [name, price, totalSupply, maxSupply, mintOpen] = result.data || []
  // Every call failing (RPC down) is an error, not a closed mint with nothing minted.
  const allFailed = !!result.data && result.data.every((r) => r.status === 'failure')
  return {
    name: name?.result,
    price: price?.result,
    totalSupply: totalSupply?.result !== undefined ? Number(totalSupply.result) : undefined,
    maxSupply: maxSupply?.result !== undefined ? Number(maxSupply.result) : undefined,
    mintOpen: mintOpen?.result,
    isLoading: result.isLoading,
    isError: (result.isError && !result.data) || allFailed,
    refetch: result.refetch,
  }
}

export type TokenMeta = { id: number; name: string; image: string }

/**
 * Token metadata lives at `${MIYAMINI_METADATA_BASE}<id>`. That host sends no CORS headers, so
 * browsers usually can't read the JSON; fall back to the collection's image path convention.
 */
export function tokenImageFallback(id: number) {
  return MIYAMINI_METADATA_BASE.replace(/json\/$/, `images/${id}.png`)
}

// One shared probe: if the metadata host is unreadable from the browser (no CORS), every token
// falls back to the image path convention instead of each request failing separately.
let metadataProbe: Promise<boolean> | undefined
const metadataReadable = () =>
  (metadataProbe ??= fetch(`${MIYAMINI_METADATA_BASE}1`).then(
    (res) => res.ok,
    () => false
  ))

async function fetchTokenMeta(id: number): Promise<TokenMeta> {
  const fallback = { id, name: `Miyamaker #${id}`, image: tokenImageFallback(id) }
  if (!(await metadataReadable())) return fallback
  try {
    const res = await fetch(`${MIYAMINI_METADATA_BASE}${id}`)
    if (!res.ok) return fallback
    const json = (await res.json()) as { name?: string; image?: string }
    return { id, name: json.name || fallback.name, image: json.image || fallback.image }
  } catch {
    return fallback
  }
}

export function useTokenMeta(id: number | undefined) {
  return useQuery({
    queryKey: ['miyamini-meta', id],
    queryFn: () => fetchTokenMeta(id as number),
    enabled: id !== undefined && id > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useMiyaminiMint() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const balance = useBalance({ address, chainId: MIYAMINI_CHAIN_ID, query: { enabled: !!address } })
  const write = useWriteContract()
  const { outcome } = useTxOutcome(MIYAMINI_CHAIN_ID, write.data as Hash | undefined)

  useEffect(() => {
    if (outcome === 'success') balance.refetch()
  }, [outcome])

  const mint = (amount: number, price: bigint) =>
    write.writeContract({
      ...contract,
      functionName: 'mint',
      args: [BigInt(amount)],
      value: price * BigInt(amount),
    })

  return {
    address,
    isConnected,
    wrongChain: isConnected && chainId !== MIYAMINI_CHAIN_ID,
    switchToMainnet: () => switchChain({ chainId: MIYAMINI_CHAIN_ID }),
    isSwitching,
    balance: balance.data?.value,
    mint,
    reset: write.reset,
    hash: write.data,
    isAwaitingWallet: write.isPending,
    isConfirming: outcome === 'waiting',
    isConfirmed: outcome === 'success',
    reverted: outcome === 'reverted',
    /** Replaced by the wallet's cancel: the replacement's receipt says success, and nothing was minted. */
    cancelled: outcome === 'cancelled',
    /** It was sent, but its receipt couldn't be read: it may still land, so Mint isn't offered again. */
    unconfirmed: outcome === 'unknown',
    error: write.error,
  }
}

const MINT_ERRORS: Record<string, string> = {
  SoldOut: 'There are not enough pieces left to mint that many.',
  PhaseSoldOut: 'This sale phase does not have that many pieces left.',
  WalletLimit: 'That is over the limit per wallet for this sale.',
  PhaseNotActive: 'This sale phase is not open right now.',
  WrongPayment: 'The price changed. Reload the page and try again.',
  NotAllowlisted: 'This wallet is not on the list for this sale.',
}

/** Human-readable error text; wallet rejections read as a cancel, not a failure. */
export function describeError(error: unknown): { message: string; cancelled: boolean } {
  if (!error) return { message: '', cancelled: false }
  const base = error instanceof BaseError ? error : undefined
  const text = base?.shortMessage || (error as Error).message || 'Something went wrong.'
  const cancelled = /reject|denied|cancel/i.test(base?.details || text)
  if (cancelled) return { message: 'Transaction cancelled in wallet.', cancelled: true }
  if (/insufficient funds/i.test(base?.details || text)) {
    return { message: 'Not enough ETH to cover the mint and gas.', cancelled: false }
  }

  const revert = base?.walk((e) => e instanceof ContractFunctionRevertedError) as
    | ContractFunctionRevertedError
    | null
    | undefined
  const friendly = MINT_ERRORS[revert?.data?.errorName ?? '']
  if (friendly) return { message: friendly, cancelled: false }
  return { message: text, cancelled: false }
}

import { useEffect } from 'react'
import type { Hash } from 'viem'
import { erc20Abi } from 'viem'
import { useAccount, useReadContracts, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { IMDUSD_V1, INFER, LEGACY_REDEEMER, legacyRedeemerAbi, MIYA, MIYANET_CHAIN_ID } from '@/constants/miyanet'

const redeemer = { address: LEGACY_REDEEMER, abi: legacyRedeemerAbi, chainId: MIYANET_CHAIN_ID } as const
const miya = { address: MIYA, abi: erc20Abi, chainId: MIYANET_CHAIN_ID } as const

/** Public redemption state, read from mainnet regardless of the wallet's chain. */
export function useRedemptionState() {
  const result = useReadContracts({
    contracts: [
      { ...redeemer, functionName: 'rateA' },
      { ...redeemer, functionName: 'closesAt' },
      { ...redeemer, functionName: 'quote', args: [MIYA, 0n] },
      { ...miya, functionName: 'totalSupply' },
    ],
    query: { refetchInterval: 30_000 },
  })
  const [rate, closesAt, quote, miyaSupply] = result.data || []
  return {
    rate: rate?.result,
    closesAt: closesAt?.result !== undefined ? Number(closesAt.result) : undefined,
    inferLeft: quote?.result?.[1],
    miyaSupply: miyaSupply?.result,
    isLoading: result.isLoading,
    isError: result.isError && !result.data,
    refetch: result.refetch,
  }
}

/** The connected wallet's MIYA, INFER and imdUSD v1, and what its MIYA redeems for right now. */
export function useWalletPosition() {
  const { address } = useAccount()
  const holder = address as `0x${string}`
  const balances = useReadContracts({
    contracts: [
      { ...miya, functionName: 'balanceOf', args: [holder] },
      { ...miya, functionName: 'allowance', args: [holder, LEGACY_REDEEMER] },
      { address: INFER, abi: erc20Abi, chainId: MIYANET_CHAIN_ID, functionName: 'balanceOf', args: [holder] },
      { address: IMDUSD_V1, abi: erc20Abi, chainId: MIYANET_CHAIN_ID, functionName: 'balanceOf', args: [holder] },
      { ...redeemer, functionName: 'claimable', args: [holder] },
      { ...redeemer, functionName: 'vestingOf', args: [holder] },
    ],
    query: { enabled: !!address, refetchInterval: 20_000 },
  })
  const [miyaBal, allowance, inferBal, imdusdBal, claimable, vesting] = balances.data || []
  const miyaBalance = miyaBal?.result

  const split = useReadContracts({
    contracts: [{ ...redeemer, functionName: 'quoteFor', args: [holder, MIYA, miyaBalance ?? 0n] }],
    query: { enabled: !!address && !!miyaBalance },
  })
  const quote = split.data?.[0]?.result

  const v = vesting?.result
  return {
    miya: miyaBalance,
    allowance: allowance?.result,
    infer: inferBal?.result,
    imdusd: imdusdBal?.result,
    claimable: claimable?.result,
    vesting: v ? { total: v[0], claimed: v[1], start: Number(v[2]) } : undefined,
    redeemNow: quote?.[0],
    redeemLater: quote?.[1],
    isLoading: balances.isLoading,
    refetch: () => {
      balances.refetch()
      split.refetch()
    },
  }
}

export type MiyanetAction = 'approve' | 'redeem' | 'claim'

/**
 * Approve (exact amount, never unlimited), redeem MIYA for INFER, and collect vested INFER. One write at a time;
 * `lastAction` says which one the current hash belongs to.
 */
export function useMiyanetTx(onConfirmed: () => void) {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({
    hash: write.data as Hash | undefined,
    chainId: MIYANET_CHAIN_ID,
    query: { enabled: !!write.data },
  })
  const lastAction = (write.variables?.functionName === 'approve' ? 'approve' : write.variables?.functionName) as
    | MiyanetAction
    | undefined

  useEffect(() => {
    if (receipt.isSuccess) onConfirmed()
  }, [receipt.isSuccess])

  return {
    isConnected,
    wrongChain: isConnected && chainId !== MIYANET_CHAIN_ID,
    switchToMainnet: () => switchChain({ chainId: MIYANET_CHAIN_ID }),
    isSwitching,
    approve: (amount: bigint) =>
      write.writeContract({ ...miya, functionName: 'approve', args: [LEGACY_REDEEMER, amount] }),
    redeem: (amount: bigint) => write.writeContract({ ...redeemer, functionName: 'redeem', args: [MIYA, amount] }),
    claim: () => write.writeContract({ ...redeemer, functionName: 'claim' }),
    reset: write.reset,
    lastAction,
    hash: write.data,
    isAwaitingWallet: write.isPending,
    isConfirming: !!write.data && receipt.isLoading,
    isConfirmed: receipt.isSuccess && receipt.data?.status === 'success',
    reverted: receipt.isSuccess && receipt.data?.status === 'reverted',
    error: write.error || receipt.error,
  }
}

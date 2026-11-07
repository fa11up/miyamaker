import { useEffect } from 'react'
import type { Hash } from 'viem'
import { erc20Abi } from 'viem'
import {
  useAccount,
  useBlockNumber,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'

import type { Legacy } from '@/constants/miyanet'
import {
  IMDUSD_V1,
  INFER,
  LEGACY_REDEEMER,
  legacyRedeemerAbi,
  MIYA,
  MIYANET_CHAIN_ID,
  MXXN,
  mxxnAbi,
} from '@/constants/miyanet'
import { useTx } from '@/miyamints/useTx'
import { useCanBatch } from '@/utils/batch'
import { useTxOutcome } from '@/miyamints/useTxOutcome'

const redeemer = { address: LEGACY_REDEEMER, abi: legacyRedeemerAbi, chainId: MIYANET_CHAIN_ID } as const
const miya = { address: MIYA, abi: erc20Abi, chainId: MIYANET_CHAIN_ID } as const
export const LEGACY_TOKEN = { miya: MIYA, mxxn: MXXN } as const
const legacyToken = (which: Legacy) =>
  ({ address: LEGACY_TOKEN[which], abi: erc20Abi, chainId: MIYANET_CHAIN_ID } as const)

/** Where MXXN's full-moon window stands against the current block. */
export type Moon = { open: boolean; start: bigint; end: bigint; block: bigint; behind: boolean }

/** Public redemption state for one token, read from mainnet regardless of the wallet's chain. */
export function useRedemptionState(which: Legacy = 'miya') {
  const result = useReadContracts({
    contracts: [
      { ...redeemer, functionName: which === 'miya' ? 'rateA' : 'rateB' },
      { ...redeemer, functionName: 'closesAt' },
      { ...redeemer, functionName: 'quote', args: [LEGACY_TOKEN[which], 0n] },
      { ...miya, functionName: 'totalSupply' },
      { address: MXXN, abi: mxxnAbi, chainId: MIYANET_CHAIN_ID, functionName: 'moonConfig' },
    ],
    query: { refetchInterval: 30_000 },
  })
  const block = useBlockNumber({
    chainId: MIYANET_CHAIN_ID,
    watch: which === 'mxxn',
    query: { enabled: which === 'mxxn' },
  })
  const [rate, closesAt, quote, miyaSupply, moonConfig] = result.data || []
  const window = moonConfig?.result
  const moon: Moon | undefined =
    window && block.data !== undefined
      ? {
          start: window[0],
          end: window[1],
          block: block.data,
          open: block.data >= window[0] && block.data <= window[1],
          behind: block.data > window[1],
        }
      : undefined
  return {
    rate: rate?.result,
    closesAt: closesAt?.result !== undefined ? Number(closesAt.result) : undefined,
    inferLeft: quote?.result?.[1],
    miyaSupply: miyaSupply?.result,
    moon,
    isLoading: result.isLoading,
    isError: result.isError && !result.data,
    refetch: result.refetch,
  }
}

/** The connected wallet's MIYA or MXXN, INFER and imdUSD v1, and what that token redeems for right now. */
export function useWalletPosition(which: Legacy = 'miya') {
  const { address } = useAccount()
  const holder = address as `0x${string}`
  const legacy = legacyToken(which)
  const balances = useReadContracts({
    contracts: [
      { ...legacy, functionName: 'balanceOf', args: [holder] },
      { ...legacy, functionName: 'allowance', args: [holder, LEGACY_REDEEMER] },
      { address: INFER, abi: erc20Abi, chainId: MIYANET_CHAIN_ID, functionName: 'balanceOf', args: [holder] },
      { address: IMDUSD_V1, abi: erc20Abi, chainId: MIYANET_CHAIN_ID, functionName: 'balanceOf', args: [holder] },
      { ...redeemer, functionName: 'claimable', args: [holder] },
      { ...redeemer, functionName: 'vestingOf', args: [holder] },
      // INFER paid at once for this token: above zero once this wallet has burned some (every first burn pays).
      { ...redeemer, functionName: 'paidImmediately', args: [legacy.address, holder] },
    ],
    query: { enabled: !!address, refetchInterval: 20_000 },
  })
  const [legacyBal, allowance, inferBal, imdusdBal, claimable, vesting, paidNow] = balances.data || []
  const legacyBalance = legacyBal?.result

  const split = useReadContracts({
    contracts: [{ ...redeemer, functionName: 'quoteFor', args: [holder, legacy.address, legacyBalance ?? 0n] }],
    query: { enabled: !!address && !!legacyBalance },
  })
  const quote = split.data?.[0]?.result

  const v = vesting?.result
  return {
    legacy: legacyBalance,
    burnedFor: paidNow?.result,
    allowance: allowance?.result,
    infer: inferBal?.result,
    imdusd: imdusdBal?.result,
    claimable: claimable?.result,
    vesting: v ? { total: v[0], claimed: v[1], start: Number(v[2]) } : undefined,
    redeemNow: quote?.[0],
    redeemLater: quote?.[1],
    isLoading: balances.isLoading,
    isFetching: balances.isFetching,
    refetch: () => {
      balances.refetch()
      split.refetch()
    },
  }
}

export type MiyanetAction = 'approve' | 'redeem' | 'claim' | 'advanceClock'

/**
 * Approve (exact amount, never unlimited), redeem MIYA or MXXN for INFER, collect vested INFER, and move MXXN's
 * moon clock on when its window has passed. One write at a time; `lastAction` says which one the hash belongs to.
 */
export function useMiyanetTx(which: Legacy, onConfirmed: () => void) {
  const legacy = legacyToken(which)
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const write = useWriteContract()
  const canBatch = useCanBatch(MIYANET_CHAIN_ID)
  const batch = useTx(() => onConfirmed())
  const batchPicked = batch.tx.phase !== 'idle'
  const { outcome } = useTxOutcome(MIYANET_CHAIN_ID, write.data as Hash | undefined)
  const lastAction = (
    batchPicked ? batch.tx.id : write.variables?.functionName === 'approve' ? 'approve' : write.variables?.functionName
  ) as MiyanetAction | undefined

  useEffect(() => {
    if (outcome === 'success' || outcome === 'reverted') onConfirmed()
  }, [outcome])

  // One action at a time: each starts clean, so an earlier one's "done" or error can't read as this one's.
  const send = (call: () => void) => {
    batch.reset()
    call()
  }

  return {
    address,
    isConnected,
    wrongChain: isConnected && chainId !== MIYANET_CHAIN_ID,
    switchToMainnet: () => switchChain({ chainId: MIYANET_CHAIN_ID }),
    isSwitching,
    approve: (amount: bigint) =>
      send(() => write.writeContract({ ...legacy, functionName: 'approve', args: [LEGACY_REDEEMER, amount] })),
    redeem: (amount: bigint) =>
      send(() => write.writeContract({ ...redeemer, functionName: 'redeem', args: [legacy.address, amount] })),
    canBatch,
    /** Approve and burn as one signature. */
    approveAndRedeem: (amount: bigint) => {
      write.reset()
      return batch.runBatch(
        'redeem',
        [
          { ...legacy, functionName: 'approve', args: [LEGACY_REDEEMER, amount], chainId: MIYANET_CHAIN_ID },
          { ...redeemer, functionName: 'redeem', args: [legacy.address, amount], chainId: MIYANET_CHAIN_ID },
        ],
        'approve'
      )
    },
    claim: () => send(() => write.writeContract({ ...redeemer, functionName: 'claim' })),
    advanceClock: () => send(() => write.writeContract({ ...redeemer, functionName: 'advanceClock', args: [MXXN, 1n] })),
    reset: () => {
      write.reset()
      batch.reset()
    },
    lastAction,
    hash: write.data ?? batch.tx.hash,
    isAwaitingWallet: write.isPending || batch.tx.phase === 'wallet',
    isConfirming: outcome === 'waiting' || batch.tx.phase === 'pending',
    isConfirmed: outcome === 'success' || batch.tx.phase === 'done',
    reverted: outcome === 'reverted',
    /** Replaced by the wallet's cancel: the replacement's receipt says success, and nothing was burned. */
    cancelled: outcome === 'cancelled',
    /** Sent, but its ending couldn't be read: it may still land, so nothing is offered again until someone starts over. */
    unconfirmed: outcome === 'unknown' || batch.unconfirmed,
    error: write.error || (batch.tx.phase === 'error' && !batch.unconfirmed ? new Error(batch.tx.message) : null),
  }
}

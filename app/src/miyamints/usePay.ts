import { readContract } from '@wagmi/core'
import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { erc20Abi } from 'viem'
import { useAccount, useReadContracts } from 'wagmi'

import type { SupportedChainId } from '@/config/wagmi'
import { wagmiConfig } from '@/config/wagmi'

import type { PayToken } from './tokens'
import { isEth, knownToken, payPlan } from './tokens'
import { useTx } from './useTx'

/**
 * Symbol and decimals for each token: the known table first (tokens.ts), else read from the token. A token whose
 * reads failed stays undefined, so no amount is ever shown at a guessed number of decimals.
 */
export function useTokenInfo(chainId: number, tokens: readonly string[] | undefined) {
  const list = tokens || []
  const unknown = list.filter((t) => !knownToken(chainId, t)) as Address[]
  const reads = useReadContracts({
    allowFailure: true,
    contracts: unknown.flatMap((address) => [
      { address, abi: erc20Abi, functionName: 'symbol' as const, chainId: chainId as SupportedChainId },
      { address, abi: erc20Abi, functionName: 'decimals' as const, chainId: chainId as SupportedChainId },
    ]),
    query: { enabled: unknown.length > 0, staleTime: Infinity },
  })
  const key = list.join(',')
  return useMemo(() => {
    const out: Record<string, PayToken | undefined> = {}
    for (const t of list) {
      const known = knownToken(chainId, t)
      if (known) {
        out[t.toLowerCase()] = known
        continue
      }
      const i = unknown.indexOf(t as Address)
      const sym = reads.data?.[i * 2]
      const dec = reads.data?.[i * 2 + 1]
      out[t.toLowerCase()] =
        sym?.status === 'success' && dec?.status === 'success'
          ? { address: t as Address, symbol: String(sym.result), decimals: Number(dec.result) }
          : undefined
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, key, reads.data])
}

/** The wallet's balance of a token (ETH or an ERC-20) and its allowance for `spender`; undefined until read. */
export function useWalletToken(chainId: number, token: string | undefined, spender: Address | undefined) {
  const { address: account } = useAccount()
  const erc20 = !!token && !isEth(token)
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: token as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account as Address],
        chainId: chainId as SupportedChainId,
      },
      {
        address: token as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account as Address, spender as Address],
        chainId: chainId as SupportedChainId,
      },
    ],
    query: { enabled: erc20 && !!account && !!spender, refetchInterval: 30_000 },
  })
  const [bal, allow] = q.data || []
  return {
    balance: bal?.status === 'success' ? (bal.result as bigint) : undefined,
    allowance: allow?.status === 'success' ? (allow.result as bigint) : undefined,
    refetch: q.refetch,
  }
}

/*
 * TODO(pay-with-another-token): the spec's "Pay with another token" (swap into an accepted token via 0x first, when the
 * buyer holds none) is not built. The Swap window's flow (src/pages/Swap/useSwap.ts, quoteGuard.ts) is tied to its own
 * screen state, so chaining a quoted 0x swap, its approval, and then this payment needs its own unknown-outcome handling.
 */

/**
 * Pays for one contract call in ETH or an ERC-20. ETH: the call goes with `value`. An ERC-20: the allowance is read
 * fresh first, and if it is short the wallet is asked to approve exactly `amount` (never unlimited), then the call.
 * Each step is a dry run, then the wallet, then a wait (useTx). `step` says which one is out.
 */
export function usePay(onDone?: (id: string) => void) {
  const t = useTx(onDone)
  const { address: account } = useAccount()
  const [step, setStep] = useState<'approve' | 'pay'>()

  const pay = async (
    id: string,
    p: {
      chainId: number
      token: string
      /** Who takes the tokens: the collection. */
      spender: Address
      amount: bigint
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      call: any
    }
  ): Promise<boolean> => {
    if (!isEth(p.token) && account && p.amount > 0n) {
      const allowance = await readContract(wagmiConfig, {
        address: p.token as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, p.spender],
        chainId: p.chainId as SupportedChainId,
      }).catch(() => undefined)
      const plan = payPlan(p.token, p.amount, allowance)
      if (plan.approve !== undefined) {
        setStep('approve')
        const approved = await t.run(`${id}:approve`, {
          address: p.token as Address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [p.spender, plan.approve],
          chainId: p.chainId,
        })
        if (!approved) {
          setStep(undefined)
          return false
        }
      }
    }
    setStep('pay')
    const done = await t.run(id, p.call)
    setStep(undefined)
    return done
  }

  return { ...t, pay, step }
}

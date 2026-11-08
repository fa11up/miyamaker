import { readContract } from '@wagmi/core'
import { useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { erc20Abi } from 'viem'
import { useAccount, useReadContracts } from 'wagmi'

import type { SupportedChainId } from '@/config/wagmi'
import { wagmiConfig } from '@/config/wagmi'

import { dropInstanceAbi, registryAbi } from './abi'
import { COULDNT_CHECK_WORDS, tokenGate } from './precheck'
import type { PayToken } from './tokens'
import { chainSymbol, isEth, knownToken, payPlan } from './tokens'
import { useTx } from './useTx'

/**
 * Symbol and decimals for each token: the known table first (tokens.ts), else read from the token. A token whose
 * reads failed stays undefined, so no amount is ever shown at a guessed number of decimals. A symbol read from the
 * token is cut short and marked with "?" (chainSymbol): it is only what the token calls itself.
 */
export function useTokenInfo(chainId: number, tokens: readonly string[] | undefined) {
  return useTokenInfoState(chainId, tokens).info
}

/** useTokenInfo, plus whether the reads are still loading: a token that is undefined then is unknown, not failed. */
export function useTokenInfoState(chainId: number, tokens: readonly string[] | undefined) {
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
  const info = useMemo(() => {
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
          ? { address: t as Address, symbol: chainSymbol(sym.result), decimals: Number(dec.result), fromChain: true }
          : undefined
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, key, reads.data])
  return { info, loading: unknown.length > 0 && (reads.isLoading || (reads.isFetching && !reads.data)) }
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
 * Can `token` pay `collection` right now: still on the collection's list (acceptedTokens) and still allowed by its
 * registry (isPaymentToken, which ETH always is). Undefined = yes; else the reason, also when a read failed. Every
 * miyamints collection (drop, editions, auction) has these two reads (PaymentLib).
 */
export async function readTokenGate(
  chainId: number,
  collection: Address,
  token: string,
  symbol: string
): Promise<string | undefined> {
  const c = chainId as SupportedChainId
  const [accepted, registry] = await Promise.all([
    readContract(wagmiConfig, { address: collection, abi: dropInstanceAbi, functionName: 'acceptedTokens', chainId: c }).catch(
      () => undefined
    ),
    isEth(token)
      ? undefined
      : readContract(wagmiConfig, { address: collection, abi: dropInstanceAbi, functionName: 'registry', chainId: c }).catch(
          () => undefined
        ),
  ])
  const allowed = isEth(token)
    ? true
    : registry
    ? await readContract(wagmiConfig, {
        address: registry,
        abi: registryAbi,
        functionName: 'isPaymentToken',
        args: [token as Address],
        chainId: c,
      }).catch(() => undefined)
    : undefined
  return tokenGate(token, symbol, accepted as readonly string[] | undefined, allowed)
}

/** What a payment's `prepare` says: stop with a reason, or go on (with a fresh amount and call when they changed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Prepared = { ok: false; error: string } | { ok: true; amount?: bigint; call?: any }

/**
 * Pays for one contract call in ETH or an ERC-20. ETH: the call goes with `value`. An ERC-20: the allowance is read
 * fresh first, and if it is short the wallet is asked to approve exactly `amount` (never unlimited), then the call.
 * Each step is a dry run, then the wallet, then a wait (useTx). `step` says which one is out.
 *
 * `prepare`, when given, runs first and reads again what can change between the screen's read and the send (the
 * price, the sale still on, the token still taken). It can stop with a reason (shown as a refused step: nothing was
 * sent) or hand back a fresh amount and call, which are then what is approved and sent.
 */
export function usePay(onDone?: (id: string) => void) {
  const t = useTx(onDone)
  const { address: account } = useAccount()
  const [step, setStep] = useState<'check' | 'approve' | 'pay'>()
  const checking = useRef(false)

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
      prepare?: () => Promise<Prepared>
    }
  ): Promise<boolean> => {
    if (checking.current) return false
    let { amount, call } = p
    if (p.prepare) {
      checking.current = true
      setStep('check')
      const r: Prepared = await p.prepare().catch(() => ({ ok: false as const, error: COULDNT_CHECK_WORDS }))
      checking.current = false
      if (!r.ok) {
        setStep(undefined)
        t.refuse(id, r.error)
        return false
      }
      amount = r.amount ?? amount
      call = r.call ?? call
    }
    if (!isEth(p.token) && account && amount > 0n) {
      const allowance = await readContract(wagmiConfig, {
        address: p.token as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, p.spender],
        chainId: p.chainId as SupportedChainId,
      }).catch(() => undefined)
      const plan = payPlan(p.token, amount, allowance)
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
    const done = await t.run(id, call)
    setStep(undefined)
    return done
  }

  return { ...t, busy: t.busy || step === 'check', pay, step }
}

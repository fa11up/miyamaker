import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import { erc20Abi } from 'viem'
import { mainnet } from 'viem/chains'
import { useAccount, useConfig, useSignMessage } from 'wagmi'
import { getBytecode, readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'

import { LINKS } from '@/constants/miyanet'
import { tryBatch } from '@/utils/batch'

/**
 * INFER BOX from inside miyamaker. The Box serves partner sites at /api/partner/*: sign in with the wallet (the message
 * names this site), get a session token bound to this origin, then evaluate, quote, pay and follow orders exactly as
 * on box.imdusd.com. The token lives in this tab only (sessionStorage), per wallet; nothing else is stored.
 */
// VITE_BOX_URL points a dev build at a local Box (wrangler dev); production always talks to box.imdusd.com.
const API = `${(import.meta.env.DEV && import.meta.env.VITE_BOX_URL) || LINKS.box}api/partner`

export type Band = 'likely' | 'uncertain' | 'unlikely' | 'refused'
export type Field = { id: string; label: string; type: 'address' | 'number' | 'choice' | 'text'; example: string }
export type Verdict = {
  id: string
  band: Band
  action?: string
  policy?: { line: string }
  risks?: { severity: 'block' | 'high' | 'medium'; reason: string; redirect?: string | null }[]
  sharpen?: string[]
  fields?: Field[]
  redacted?: number
  usedToday?: number
  evalsPerDay?: number
}
export type Me = { wallet: string; evalsPerDay: number; usedToday: number; payments: boolean }
export type Quote = {
  orderId: Hex
  box: Address
  imdUsd: Address
  expiresAt: number
  total: string
  pay: { orderId: Hex; commitment: Hex; toFloat: string; toTreasury: string; escrow: string; ref: Hex }
  shown: { swarmPriceImd: number; imdUsd: number; cost: number; buffer: number }
}
export type OrderStatus = 'quoted' | 'paid' | 'sending' | 'held' | 'admitted' | 'refused' | 'mismatch' | 'expired'
export type Order = {
  id: string
  eval_id: string
  action: string
  status: OrderStatus
  created_at: number
  paid_tx?: string | null
  job_id?: string | null
  job?: { state?: string; delivery?: { repoUrl?: string; url?: string; summary?: string } | null } | null
}

/** Box.pay (contracts/src/Box.sol) and the token it takes, read back before anything is approved to it. */
const boxAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'commitment', type: 'bytes32' },
      { name: 'toFloat', type: 'uint256' },
      { name: 'toTreasury', type: 'uint256' },
      { name: 'escrow', type: 'uint256' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

export class BoxError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => {
    throw new BoxError('Could not reach INFER BOX. Check your connection and try again.', 0)
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new BoxError(json.error || `INFER BOX answered ${res.status}`, res.status)
  return json
}

const storeKey = (wallet: string) => `box-token:${wallet.toLowerCase()}`
const loadToken = (wallet: string | undefined) => {
  if (!wallet) return undefined
  try {
    const raw = sessionStorage.getItem(storeKey(wallet))
    const saved = raw ? (JSON.parse(raw) as { token: string; expiresAt: number }) : undefined
    return saved && saved.expiresAt > Date.now() ? saved.token : undefined
  } catch {
    return undefined
  }
}

/** The Box session for the connected wallet: sign in once per tab, then every call carries the token. */
export function useBoxSession() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [token, setToken] = useState<string | undefined>(() => loadToken(address))
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => setToken(loadToken(address)), [address])

  const signIn = useCallback(
    async (code?: string) => {
      if (!address) throw new BoxError('Connect a wallet first.', 0)
      setSigningIn(true)
      try {
        const ch = await call<{ nonce: string; message: string }>('/challenge', { body: { address } })
        const signature = await signMessageAsync({ message: ch.message })
        const r = await call<{ token: string; expiresAt: number }>('/login', {
          body: { nonce: ch.nonce, signature, ...(code?.trim() ? { code: code.trim() } : {}) },
        })
        try {
          sessionStorage.setItem(storeKey(address), JSON.stringify(r))
        } catch {
          // Private windows: the session lasts until the page is closed.
        }

        setToken(r.token)
        return r.token
      } finally {
        setSigningIn(false)
      }
    },
    [address, signMessageAsync]
  )

  const signOut = useCallback(async () => {
    if (token) await call('/logout', { body: {}, token }).catch(() => undefined)
    try {
      if (address) sessionStorage.removeItem(storeKey(address))
    } catch {
      // nothing stored
    }

    setToken(undefined)
  }, [address, token])

  /** A call that needs the session; an ended session drops the token so the page asks to sign in again. */
  const authed = useCallback(
    async <T>(path: string, body?: unknown, fresh?: string) => {
      // `fresh`: the token signIn just returned, before this render's state has caught up with it.
      const use = fresh ?? token
      if (!use) throw new BoxError('Sign in first.', 401)
      try {
        return await call<T>(path, { body, token: use })
      } catch (e) {
        if (e instanceof BoxError && e.status === 401) setToken(undefined)
        throw e
      }
    },
    [token]
  )

  return { address, token, signedIn: !!token, signingIn, signIn, signOut, authed }
}

export function useBoxMe(session: ReturnType<typeof useBoxSession>) {
  return useQuery({
    queryKey: ['box-me', session.token],
    queryFn: () => session.authed<Me>('/me'),
    enabled: session.signedIn,
    staleTime: 30_000,
  })
}

/** The wallet's orders; polled while one of them is still on its way to the swarm. */
export function useBoxOrders(session: ReturnType<typeof useBoxSession>) {
  return useQuery({
    queryKey: ['box-orders', session.token],
    queryFn: () => session.authed<{ orders: Order[] }>('/orders'),
    enabled: session.signedIn,
    refetchInterval: (q) =>
      q.state.data?.orders.some((o) => ['quoted', 'paid', 'sending', 'held'].includes(o.status)) ? 5_000 : 60_000,
  })
}

export const toImdUsd = (wei: string | bigint) => (Number(BigInt(wei) / 10n ** 14n) / 1e4).toFixed(2)

/**
 * Pay a quote from the signed-in wallet: check the Box really takes imdUSD, check the balance, approve exactly the
 * total if needed, then Box.pay with the quote's own arguments. `say` reports each step.
 */
export function usePayQuote() {
  const config = useConfig()
  const { address, chainId } = useAccount()
  return useCallback(
    async (q: Quote, signedWallet: string, say: (s: string) => void) => {
      if (!address) throw new BoxError('Connect a wallet first.', 0)
      if (address.toLowerCase() !== signedWallet.toLowerCase())
        throw new BoxError('Switch back to the wallet you signed in with: the order is for that wallet.', 0)
      if (chainId !== mainnet.id) throw new BoxError('Switch your wallet to Ethereum to pay.', 0)
      const opts = { chainId: mainnet.id } as const
      const code = await getBytecode(config, { address: q.box, ...opts })
      const token = await readContract(config, { address: q.box, abi: boxAbi, functionName: 'token', ...opts }).catch(
        () => undefined
      )
      if (!code || code === '0x' || token?.toLowerCase() !== q.imdUsd.toLowerCase())
        throw new BoxError('The payment contract did not check out. Nothing was sent.', 0)
      const total = BigInt(q.total)
      const balance = await readContract(config, {
        address: q.imdUsd,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
        ...opts,
      })
      if (balance < total)
        throw new BoxError(`You hold ${toImdUsd(balance)} imdUSD and this needs ${toImdUsd(total)}.`, 0)
      const allowance = await readContract(config, {
        address: q.imdUsd,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, q.box],
        ...opts,
      })
      const p = q.pay
      const payCall = {
        address: q.box,
        abi: boxAbi,
        functionName: 'pay',
        args: [p.orderId, p.commitment, BigInt(p.toFloat), BigInt(p.toTreasury), BigInt(p.escrow), p.ref],
      }
      if (allowance < total) {
        const sent = await tryBatch(
          [{ address: q.imdUsd, abi: erc20Abi, functionName: 'approve', args: [q.box, total] }, payCall],
          {
            account: address,
            chainId: mainnet.id,
            onAsk: () =>
              say(`One signature: approve exactly ${toImdUsd(total)} imdUSD to the Box and pay, all or nothing.`),
            onSent: () => say('Waiting for the payment to land…'),
          }
        )
        if (sent?.hash) return sent.hash
        say(`Step 1 of 2: approve exactly ${toImdUsd(total)} imdUSD to the Box.`)
        const a = await writeContract(config, {
          address: q.imdUsd,
          abi: erc20Abi,
          functionName: 'approve',
          args: [q.box, total],
          ...opts,
        })
        say('Waiting for the approval to land…')
        if ((await waitForTransactionReceipt(config, { hash: a, ...opts })).status !== 'success')
          throw new BoxError('The approval failed. Nothing was paid.', 0)
        say('Step 2 of 2: pay.')
      } else say('Confirm the payment in your wallet.')
      const hash = await writeContract(config, { ...payCall, ...opts } as never)
      say('Waiting for the payment to land…')
      if ((await waitForTransactionReceipt(config, { hash, ...opts })).status !== 'success')
        throw new BoxError('The payment reverted. Nothing was paid.', 0)
      return hash
    },
    [address, chainId, config]
  )
}

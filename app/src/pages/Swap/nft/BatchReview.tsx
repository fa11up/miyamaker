/* eslint-disable no-restricted-syntax, no-continue -- venues run strictly one at a time, in order */
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getAccount, getPublicClient, sendTransaction } from '@wagmi/core'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address, Hash, Hex } from 'viem'
import { decodeFunctionData, decodeFunctionResult, erc20Abi, zeroAddress } from 'viem'
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet, wagmiConfig } from '@/config/wagmi'
import { isRevert } from '@/hooks/readFailure'
import { txWords, useTx } from '@/miyamints/useTx'

import { ethInUsd } from '../board'
import { Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { useEthUsd } from '../MarketBoard'
import { erc721Abi, erc1155Abi, poolAbi } from './abi'
import type { BatchExcluded, BatchInput, BatchPlan, SimulationCheck } from './batch'
import { planBatch, receiptOutcome, simulationCheck } from './batch'
import type { BatchPick, ItemResult } from './batchRoute'
import {
  ethText,
  excludedWords,
  ITEM_RESULT_WORDS,
  needsRefresh,
  poolItemResults,
  reviewChange,
  sameDeal,
  venuesOf,
} from './batchRoute'
import { fillFailureKind, fillFailureWords, isShort } from './fillLogic'
import type { OsOrder } from './markets'
import { formatAmount, OPENSEA_CHAIN, usesSeaportItself } from './markets'
import { heldAmount, KIND } from './pool'
import type { FeeSymbol, PoolBatchPlan, PoolRef, PoolStep } from './poolBatch'
import {
  collectionBatchAbi,
  planPoolBatch,
  poolBatchAbi,
  readPoolReceipt,
  simulatePoolStep,
  tokensText,
} from './poolBatch'
import { CONDUIT_CONTROLLER, conduitControllerAbi, seaportAbi, seaportCallAbi } from './seaport'
import type { SweepRun } from './sweep'
import { isWalletRefusal, markGone, noteBuyOutcome, runSweep, sessionStore, SWEEP_WAIT_MS } from './sweep'
import { Action, Card, ConfirmCheck, Head, Hint, LinkButton, Mono, Prose, PushButton, Stat, SwitchNote } from './ui'
import { useFillFee } from './useFillFee'
import { fetchFulfillment, useOpenSeaCollection } from './useMarkets'

const Rows = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: ${text.sm};
  font-variant-numeric: tabular-nums;
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px ${space[2]};
    padding: ${space[1]} 0;
    border-bottom: 1px solid ${color.light};
    min-width: 0;
  }
  li:last-child {
    border-bottom: none;
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .state {
    grid-column: 1 / -1;
    font-size: ${text.xs};
    color: ${color.inkMuted};
    overflow-wrap: anywhere;
  }
  .bought,
  .sold {
    color: ${color.success};
  }
  .failed,
  .skipped,
  .unconfirmed,
  .missing,
  .out {
    color: ${color.danger};
  }
  button {
    grid-column: 1 / -1;
    justify-self: start;
  }
`

const Lines = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  padding: ${space[2]} ${space[3]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  div {
    display: flex;
    justify-content: space-between;
    gap: ${space[3]};
    font-size: ${text.sm};
  }
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow-wrap: anywhere;
  }
  .total {
    margin-top: ${space[1]};
    padding-top: ${space[1]};
    border-top: 1px solid ${color.shadow};
    font-weight: 700;
    dt {
      color: ${color.ink};
    }
  }
`

const Steps = styled.ol`
  margin: 0;
  padding: 0 0 0 ${space[5]};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  font-size: ${text.sm};
  li > span {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
    overflow-wrap: anywhere;
  }
  .done {
    color: ${color.success};
  }
  button {
    margin-top: ${space[1]};
  }
`

const Buttons = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

const ZERO32 = `0x${'0'.repeat(64)}` as Hex
const nowS = () => Math.floor(Date.now() / 1000)
const lc = (s: string | undefined) => (s ?? '').toLowerCase()

type OsPick = Extract<BatchPick<OsOrder>, { venue: 'opensea' }>
type PoolPick = Extract<BatchPick<OsOrder>, { venue: 'pool' }>

/** A stop with words already fit for the screen. Anything else thrown is put in plain words before it is shown. */
class Plain extends Error {
  constructor(public words: string, public fallback = false) {
    super(words)
  }
}

const refused = (e: unknown) =>
  isWalletRefusal((e as { shortMessage?: string })?.shortMessage || '') || isWalletRefusal((e as Error)?.message || '')

/** One transaction of the run: the OpenSea batch, or one pool step. */
type Job =
  | { id: string; kind: 'opensea' }
  | { id: string; kind: 'pool'; venue: string; plan: PoolBatchPlan; step: PoolStep; ids: string[] }

/** Which NFTs a pool step moves, read from its own calldata. */
function stepIds(step: PoolStep): string[] {
  const data = step.call?.data
  if (!data) return []
  try {
    const d = decodeFunctionData({ abi: [...poolBatchAbi, ...collectionBatchAbi], data })
    if (d.functionName === 'safeTransferFrom') return [String(d.args[2])]
    if (d.functionName === 'safeBatchTransferFrom') return d.args[2].map(String)
    if (d.functionName === 'deposit' || d.functionName === 'redeem') return d.args[0].map(String)
  } catch {
    // Not a call that names ids.
  }

  return []
}

/** A pool's "This would fail: <node text>" is not for people. */
const poolWords = (words: string) =>
  words.startsWith('This would fail:') ? 'The pool would refuse this right now. Nothing was sent.' : words

type Props = {
  side: 'buy' | 'sell'
  picks: BatchPick<OsOrder>[]
  pools: PoolRef[]
  chainId: SupportedChainId
  contract: Address
  title: string
  unverified?: boolean
  onClose: () => void
  onDone: () => void
  onBusy?: (busy: boolean) => void
  /** The one-by-one path for these (SweepReview for buys, FillReview for a sale). */
  onOneByOne?: (picks: OsPick[]) => void
  /** The Tokens tab, set to buy this pool's token. */
  onGetTokens?: (pool: PoolRef) => void
  /** Escape closes it (when it was opened on the page, not in the terminal's rail, which has its own Escape). */
  escapeCloses?: boolean
}

/** Seaport's answer didn't match the plan: never sent. */
const osSimProblemWords = (buying: boolean) =>
  buying
    ? "The check didn't match what you're buying, so nothing was sent. Buy them one by one."
    : "The check didn't match the offers you're accepting, so nothing was sent. Sell them one by one."

/** The review itself; BatchReview below starts it over when the person asks to review again. */
function Review({
  side,
  picks,
  pools,
  chainId,
  contract,
  title,
  unverified,
  onClose,
  onDone,
  onBusy,
  onOneByOne,
  onGetTokens,
  escapeCloses,
  onAgain,
}: Props & { onAgain: () => void }) {
  const buying = side === 'buy'
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const wrongChain = isConnected && walletChain !== chainId
  const osChain = OPENSEA_CHAIN[chainId]
  const ethUsd = useEthUsd()

  // Gone from the screen, or cancelled: no more wallet prompts. Reset on mount for React's double effects.
  const left = useRef(false)
  useEffect(() => {
    left.current = false
    return () => {
      left.current = true
      onBusy?.(false)
    }
  }, [])

  // The wallet and network this review is for. Another account, or leaving the network, cancels it for good.
  const start = useRef<{ account?: string; onChain: boolean }>({ account: me, onChain: false })
  const [cancelled, setCancelled] = useState<string>()
  useEffect(() => {
    const change = reviewChange(start.current, { account: me, chainId: walletChain }, chainId)
    if (change) {
      left.current = true
      setCancelled((old) => old ?? change)
      return
    }

    if (!start.current.account && me) start.current.account = me
    if (me && walletChain === chainId) start.current.onChain = true
  }, [me, walletChain])
  /** Right before a prompt: the wallet as it is now, not as the last render saw it. */
  const guard = () => {
    const now = getAccount(wagmiConfig)
    const change = reviewChange(start.current, { account: now.address, chainId: now.chainId }, chainId)
    if (change) {
      left.current = true
      setCancelled((old) => old ?? change)
      throw new Plain(change)
    }

    if (left.current) throw new Plain('Closed before sending. Nothing was sent.')
  }

  const venues = venuesOf(picks)
  const osPicks = picks.filter((p): p is OsPick => p.venue === 'opensea')
  const poolPicksOf = (venue: string) => (venues.find((v) => v.venue === venue)?.picks ?? []) as PoolPick[]
  const poolVenues = venues
    .filter((v) => v.venue !== 'opensea')
    .map((v) => ({ venue: v.venue, ref: pools.find((p) => lc(p.address) === v.venue), picks: v.picks as PoolPick[] }))

  /* ---------- OpenSea: fill data, the one call, its check ---------- */

  const coll = useOpenSeaCollection(chainId, contract)
  const creatorFees = coll.info?.fees.map((f) => f.recipient)
  const noteFor = (e: unknown) => fillFailureWords(fillFailureKind(e, side), side).words

  /** OpenSea's fill data for each item, one request at a time (the route has its own small rate limit). */
  const fetchInputs = async (signal?: AbortSignal) => {
    const inputs: BatchInput[] = []
    const failures: BatchExcluded[] = []
    for (const p of osPicks) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchFulfillment(
          buying ? 'fulfill_listing' : 'fulfill_offer',
          buying
            ? { chain: osChain!, hash: p.order.hash, protocol_address: p.order.protocolAddress, fulfiller: me! }
            : {
                chain: osChain!,
                hash: p.order.hash,
                protocol_address: p.order.protocolAddress,
                fulfiller: me!,
                contract,
                token_id: p.tokenId,
              },
          signal
        )
        inputs.push({ key: p.key, orderHash: p.order.hash, response, contract, tokenId: p.tokenId, creatorFees })
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        failures.push({ key: p.key, reason: noteFor(e), oneByOne: false })
      }
    }

    return { inputs, failures }
  }

  const planFrom = ({ inputs, failures }: { inputs: BatchInput[]; failures: BatchExcluded[] }) => ({
    result: inputs.length ? planBatch(inputs, { side, chainId, account: me! }) : undefined,
    failures,
  })

  const osData = useQuery({
    queryKey: ['os-batch', side, osPicks.map((p) => p.key).join(), me?.toLowerCase()],
    enabled: !!me && !!osChain && osPicks.length > 0 && !coll.loading && !cancelled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => planFrom(await fetchInputs(signal)),
  })
  const agreed = osData.data?.result?.ok ? osData.data.result : undefined
  // Fetched again right before the prompt (permission close to running out): what was actually sent.
  const [fresh, setFresh] = useState<BatchPlan>()
  const osPlan = fresh ?? agreed
  const osPlanRef = useRef<BatchPlan>()
  osPlanRef.current = osPlan
  const osRefusal = osData.data?.result && !osData.data.result.ok ? osData.data.result : undefined
  const excluded = [...(osPlan?.excluded ?? osRefusal?.excluded ?? []), ...(osData.data?.failures ?? [])]
  // Every one left out for the same reason (OpenSea offline, busy): said once, not on every row.
  const reasons = new Set(excluded.map((x) => x.reason))
  const sharedReason =
    osPicks.length > 1 && excluded.length === osPicks.length && reasons.size === 1 ? [...reasons][0] : undefined

  // Sells: who moves the NFTs and the fees (the conduit for the batch's key), and whether it may yet.
  const conduit = useReadContract({
    address: CONDUIT_CONTROLLER,
    abi: conduitControllerAbi,
    functionName: 'getConduit',
    args: [(osPlan?.conduitKey as Hex) || ZERO32],
    chainId,
    query: { enabled: !buying && !!osPlan && !usesSeaportItself(osPlan.conduitKey) },
  })
  const operator: Address | undefined =
    !osPlan || buying
      ? undefined
      : usesSeaportItself(osPlan.conduitKey)
      ? osPlan.call.to
      : conduit.data?.[1]
      ? conduit.data[0]
      : undefined
  const nftAllowed = useReadContract({
    address: contract,
    abi: erc721Abi,
    functionName: 'isApprovedForAll',
    args: [me || zeroAddress, operator || zeroAddress],
    chainId,
    query: { enabled: !buying && !!me && !!operator },
  })
  const feeToken = !buying && osPlan ? (osPlan.currency.token as Address) : undefined
  const feeReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: feeToken, abi: erc20Abi, functionName: 'symbol', chainId },
      {
        address: feeToken,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [me || zeroAddress, operator || zeroAddress],
        chainId,
      },
    ],
    query: { enabled: !!feeToken && !!me && !!operator },
  })
  const feeSymbol =
    feeReads.data?.[0]?.status === 'success' ? String(feeReads.data[0].result).slice(0, 12) : buying ? 'ETH' : 'WETH'
  const allowance = feeReads.data?.[1]?.status === 'success' ? (feeReads.data[1].result as bigint) : undefined
  const osNeedsNft = !buying && !!osPlan && nftAllowed.data === false
  const osNeedsFee = !buying && !!osPlan && osPlan.fromYou > 0n && allowance !== undefined && allowance < osPlan.fromYou
  const osApprovalsKnown =
    buying ||
    (!!operator && nftAllowed.data !== undefined && (!osPlan || osPlan.fromYou === 0n || allowance !== undefined))
  const osApprovalFailed =
    !buying &&
    !!osPlan &&
    (conduit.isError || nftAllowed.isError || feeReads.isError || (!!conduit.data && !conduit.data[1]))
  const osReady = !!osPlan && osApprovalsKnown && !osNeedsNft && !osNeedsFee

  const ethBalance = useBalance({ address: me, chainId, query: { enabled: !!me } })
  const osFee = useFillFee({
    chainId,
    account: me,
    calls:
      osPlan && osReady
        ? [
            {
              address: osPlan.call.to,
              abi: seaportCallAbi,
              functionName: osPlan.functionName,
              args: osPlan.args,
              value: osPlan.call.value,
            },
          ]
        : [],
    key: `batch-${osData.dataUpdatedAt}-${!!fresh}-${osReady}`,
  })
  const short = buying && !!osPlan && isShort(ethBalance.data?.value, osPlan.call.value, osFee, true)

  /** Seaport's own answer for exactly the bytes that will be signed, checked against the plan. Throws on a revert. */
  const simulateOs = async (plan: BatchPlan): Promise<SimulationCheck> => {
    const client = getPublicClient(wagmiConfig, { chainId })!
    const res = await client.call({ account: me!, to: plan.call.to, data: plan.call.data, value: plan.call.value })
    const result = decodeFunctionResult({
      abi: seaportAbi,
      functionName: 'fulfillAvailableAdvancedOrders',
      data: (res.data ?? '0x') as Hex,
    })
    return simulationCheck(plan, result as readonly unknown[], me!)
  }

  const [running, setRunning] = useState(false)
  const osSim = useQuery({
    queryKey: ['os-batch-sim', side, osData.dataUpdatedAt, !!fresh, me?.toLowerCase()],
    enabled: !!osPlan && osReady && !short && !running && !cancelled,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => simulateOs(osPlan!),
  })
  const [osFallback, setOsFallback] = useState(false)
  const osSimProblem = osSim.data?.problem
    ? buying
      ? "The check didn't match what you're buying, so nothing will be sent."
      : "The check didn't match the offers you're accepting, so nothing will be sent."
    : osSim.data && !osSim.data.fills.length
    ? buying
      ? 'None of these are still for sale. Nothing will be sent.'
      : 'None of these offers are still open. Nothing will be sent.'
    : osSim.error
    ? `These can't go in one transaction right now. Nothing was sent. ${buying ? 'Buy' : 'Sell'} them one by one.`
    : undefined
  const showFallback = osFallback || !!osSim.error || !!osSim.data?.problem || !!osRefusal

  /* ---------- MiyaPool: reads, plans, checks ---------- */

  // One flat read list: per pool its balance and pick-fee wallet (buy) or approval (sell), then per NFT whether it is
  // there to move (and, for a pick from a random-enabled ERC-721 pool, whether an open draw has locked it).
  type ReadRef = {
    pool: number
    what: 'balance' | 'approved' | 'item' | 'locked' | 'fee-balance' | 'fee-allowance'
    id?: string
  }
  const readRefs: ReadRef[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contracts: any[] = []
  poolVenues.forEach(({ ref, picks: list }, i) => {
    if (!ref) return
    const erc721 = ref.kind === KIND.ERC721
    if (buying) {
      readRefs.push({ pool: i, what: 'balance' })
      contracts.push({
        address: ref.address,
        abi: poolAbi,
        functionName: 'balanceOf',
        args: [me || zeroAddress],
        chainId,
      })
      const feeTokens: [string, Address | undefined, bigint | undefined][] = [
        ['IMD', ref.imd, ref.imdFee],
        ['INFER', ref.infer, ref.inferFee],
      ]
      for (const [symbol, token, fee] of feeTokens) {
        if (!token || !fee) continue
        readRefs.push({ pool: i, what: 'fee-balance', id: symbol })
        contracts.push({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [me || zeroAddress], chainId })
        readRefs.push({ pool: i, what: 'fee-allowance', id: symbol })
        contracts.push({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [me || zeroAddress, ref.address],
          chainId,
        })
      }
    } else if (erc721) {
      readRefs.push({ pool: i, what: 'approved' })
      contracts.push({
        address: ref.collection,
        abi: erc721Abi,
        functionName: 'isApprovedForAll',
        args: [me || zeroAddress, ref.address],
        chainId,
      })
    }

    for (const p of list) {
      if (buying && erc721 && ref.randomEnabled !== false) {
        readRefs.push({ pool: i, what: 'locked', id: p.tokenId })
        contracts.push({
          address: ref.address,
          abi: poolAbi,
          functionName: 'isLocked',
          args: [BigInt(p.tokenId)],
          chainId,
        })
      }

      readRefs.push({ pool: i, what: 'item', id: p.tokenId })
      const id = BigInt(p.tokenId)
      contracts.push(
        buying
          ? erc721
            ? { address: ref.address, abi: poolAbi, functionName: 'isHeld', args: [id], chainId }
            : { address: ref.address, abi: poolAbi, functionName: 'unitsOf', args: [id], chainId }
          : erc721
          ? { address: ref.collection, abi: erc721Abi, functionName: 'ownerOf', args: [id], chainId }
          : {
              address: ref.collection,
              abi: erc1155Abi,
              functionName: 'balanceOf',
              args: [me || zeroAddress, id],
              chainId,
            }
      )
    }
  })
  const poolReads = useReadContracts({
    allowFailure: true,
    contracts,
    query: { enabled: !!me && contracts.length > 0 && !cancelled },
  })

  const livePoolPlans: (PoolBatchPlan | undefined)[] = poolVenues.map(({ ref, picks: list }, i) => {
    if (!ref || !me) return undefined
    const erc721 = ref.kind === KIND.ERC721
    const at = (what: ReadRef['what'], id?: string) => {
      const k = readRefs.findIndex((r) => r.pool === i && r.what === what && r.id === id)
      return k < 0 ? undefined : poolReads.data?.[k]
    }

    const items = list.map((p) => ({ id: BigInt(p.tokenId) }))
    if (buying) {
      const b = at('balance')
      const poolHeld: Record<string, bigint | undefined> = {}
      const locked: Record<string, boolean | undefined> = {}
      for (const p of list) {
        const r = at('item', p.tokenId)
        poolHeld[p.tokenId] = r?.status !== 'success' ? undefined : erc721 ? (r.result ? 1n : 0n) : (r.result as bigint)
        const l = at('locked', p.tokenId)
        locked[p.tokenId] = l?.status === 'success' ? (l.result as boolean) : undefined
      }

      const wallet = (symbol: FeeSymbol) => {
        const bal = at('fee-balance', symbol)
        const allow = at('fee-allowance', symbol)
        return {
          balance: bal?.status === 'success' ? (bal.result as bigint) : undefined,
          allowance: allow?.status === 'success' ? (allow.result as bigint) : undefined,
        }
      }

      return planPoolBatch({
        side: 'buy',
        chainId,
        account: me,
        pool: ref,
        balance: b?.status === 'success' ? (b.result as bigint) : undefined,
        items,
        poolHeld,
        locked,
        feeWallet: { IMD: wallet('IMD'), INFER: wallet('INFER') },
      })
    }

    const owned: Record<string, bigint | undefined> = {}
    for (const p of list) {
      const r = at('item', p.tokenId)
      owned[p.tokenId] = heldAmount(
        r &&
          (r.status === 'success'
            ? { status: 'success', result: r.result }
            : { status: 'failure', reverted: isRevert(r.error) }),
        erc721,
        me
      )
    }

    const a = at('approved')
    return planPoolBatch({
      side: 'sell',
      chainId,
      account: me,
      pool: ref,
      items,
      owned,
      approvedForAll: a?.status === 'success' ? (a.result as boolean) : undefined,
    })
  })
  // Frozen while the run goes: reads landing mid-run must not change what is being sent.
  const frozenPools = useRef<(PoolBatchPlan | undefined)[]>()
  const poolPlans = running && frozenPools.current ? frozenPools.current : livePoolPlans

  /** The steps a pool still needs pressed before its confirm can go: an approval, or tokens from the Tokens tab. */
  const poolGate = (plan: PoolBatchPlan | undefined) =>
    plan?.steps.find((s) => s.key === 'approve' || s.key === 'get-tokens')
  const poolConfirms = (plan: PoolBatchPlan | undefined) =>
    plan && !plan.blocked && !poolGate(plan) ? plan.steps.filter((s) => s.call && s.key !== 'approve') : []

  // Each pool's first confirm step, checked at review once nothing is owed before it.
  const poolSims = useQueries({
    queries: poolPlans.map((plan, i) => {
      const step = poolConfirms(plan)[0]
      return {
        queryKey: ['pool-batch-sim', poolVenues[i]?.venue, step?.call?.data, me?.toLowerCase()],
        enabled: !!plan && !!step && !running && !cancelled,
        staleTime: 30_000,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        queryFn: () => simulatePoolStep(getPublicClient(wagmiConfig, { chainId }) as never, plan!, step!.call!),
      }
    }),
  })

  /* ---------- approvals: each its own press ---------- */

  const tx = useTx(() => {
    nftAllowed.refetch()
    feeReads.refetch()
    poolReads.refetch()
  })

  type Gate = { id: string; title: string; words: string; done?: boolean; press?: () => void; label: string }
  const gates: Gate[] = []
  if (!buying && osPlan && operator) {
    if (osNeedsNft || tx.tx.id === 'os-nft')
      gates.push({
        id: 'os-nft',
        title: `Allow OpenSea to move your ${title}`,
        label: `Allow OpenSea to move your ${title}`,
        words: `Lets OpenSea's contract move all your ${title}, until you revoke it. Needed once so one transaction can sell ${osPlan.lines.length}. Nothing is sold yet.`,
        done: !osNeedsNft && nftAllowed.data === true,
        press: () =>
          tx.run('os-nft', {
            address: contract,
            abi: erc721Abi,
            functionName: 'setApprovalForAll',
            args: [operator, true],
            chainId,
          }),
      })
    if (osNeedsFee || tx.tx.id === 'os-fee')
      gates.push({
        id: 'os-fee',
        title: `Allow ${formatAmount(osPlan.fromYou, 18, 6)} ${feeSymbol} for the fees`,
        label: `Allow ${formatAmount(osPlan.fromYou, 18, 6)} ${feeSymbol} for the fees`,
        words: `Lets OpenSea's contract take exactly ${formatAmount(
          osPlan.fromYou,
          18,
          6
        )} ${feeSymbol} for the fees, out of what you receive. Nothing is sold yet.`,
        done: !osNeedsFee && allowance !== undefined,
        press: () =>
          tx.run('os-fee', {
            address: feeToken,
            abi: erc20Abi,
            functionName: 'approve',
            args: [operator, osPlan.fromYou],
            chainId,
          }),
      })
  }

  poolPlans.forEach((plan, i) => {
    const ref = poolVenues[i]?.ref
    if (!plan || !ref) return
    const label = 'MiyaPool'
    for (const s of plan.steps) {
      if (s.key === 'approve')
        gates.push({
          id: `pool-approve-${ref.address}`,
          title: `${s.title} · ${label}`,
          label: plan.side === 'buy' ? s.title : `Allow the ${label}`,
          words: s.words,
          press: () => tx.run(`pool-approve-${ref.address}`, { ...s.call!, chainId }),
        })
      if (s.key === 'get-tokens')
        gates.push({
          id: `pool-tokens-${ref.address}`,
          title: `${s.title} · ${label}`,
          label: `${s.title} on the Tokens tab`,
          words: s.words,
          press: onGetTokens ? () => onGetTokens(ref) : undefined,
        })
    }
  })
  const isTokens = (g: Gate) => g.id.startsWith('pool-tokens')
  /** Approvals go first, each its own press. Getting pool tokens is a trip to the Tokens tab; it holds up only its pool. */
  const nextApproval = gates.find((g) => !g.done && !isTokens(g))
  const nextTokens = gates.find((g) => !g.done && isTokens(g) && g.press)

  /* ---------- the run: one transaction per venue, in order ---------- */

  const [runs, setRuns] = useState<Record<string, SweepRun>>({})
  const [results, setResults] = useState<Record<string, ItemResult>>({})
  const [venueWords, setVenueWords] = useState<Record<string, string>>({})
  const [stage, setStage] = useState<'check' | 'wallet'>()
  const [stopWords, setStopWords] = useState<string>()
  const [finished, setFinished] = useState(false)
  const [agreedUnverified, setAgreedUnverified] = useState(false)
  useEffect(() => onBusy?.(running || tx.busy), [running, tx.busy])

  const osJobReady = osReady && !short && !osSimProblem && !runs.opensea
  const jobs: Job[] = [
    ...(osJobReady && osPlan ? [{ id: 'opensea', kind: 'opensea' as const }] : []),
    ...poolPlans.flatMap((plan, i) =>
      poolConfirms(plan)
        .map((step, k) => ({
          id: `${poolVenues[i]!.venue}-${k}`,
          kind: 'pool' as const,
          venue: poolVenues[i]!.venue,
          plan: plan!,
          step,
          ids: stepIds(step),
        }))
        // Already run, or its check at review failed: not offered again (Review again starts over).
        .filter((j) => !runs[j.id] && poolSims[i]?.data?.ok !== false)
    ),
  ]
  const receipts = useRef(new Map<string, { status?: string; logs?: readonly unknown[] }>())
  const sentPlan = useRef<BatchPlan>()

  const setItems = (keys: string[], state: ItemResult) =>
    setResults((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, state])) }))

  /** What a finished OpenSea transaction did, per NFT, from its receipt alone. */
  const osOutcome = (run: SweepRun) => {
    const plan = sentPlan.current
    if (!plan || !me) return
    const receipt = run.hash ? receipts.current.get(run.hash) : undefined
    const out =
      run.state === 'unconfirmed' || !receipt
        ? receiptOutcome(plan, undefined, me)
        : receiptOutcome(plan, receipt as never, me)
    setResults((r) => ({ ...r, ...Object.fromEntries(out.map((o) => [o.key, o.state as ItemResult])) }))
    if (buying)
      for (const o of out) {
        const line = plan.lines.find((l) => l.key === o.key)
        if (!line?.orderHash) continue
        if (o.state === 'skipped') markGone(sessionStore(), line.orderHash)
        noteBuyOutcome(
          sessionStore(),
          line.orderHash,
          o.state === 'bought'
            ? 'bought'
            : o.state === 'skipped'
            ? 'gone'
            : o.state === 'unconfirmed'
            ? 'unconfirmed'
            : 'failed'
        )
      }
  }

  /** What a finished pool transaction did, per NFT, from its receipt alone. */
  const poolOutcome = (job: Extract<Job, { kind: 'pool' }>, run: SweepRun) => {
    const receipt = run.hash ? receipts.current.get(run.hash) : undefined
    const reading =
      run.state === 'unconfirmed' || !receipt
        ? undefined
        : readPoolReceipt(receipt as never, {
            account: me!,
            pool: job.plan.pool,
            requested: job.ids.map((id) => ({ id: BigInt(id) })),
          })
    const byId = poolItemResults(reading, job.ids)
    const keys = poolPicksOf(job.venue)
    setResults((r) => ({
      ...r,
      ...Object.fromEntries(keys.filter((p) => byId[p.tokenId]).map((p) => [p.key, byId[p.tokenId]!])),
    }))
    if (reading?.words) setVenueWords((w) => ({ ...w, [job.venue]: reading.words }))
  }

  const keysOf = (job: Job) =>
    job.kind === 'opensea'
      ? (sentPlan.current ?? osPlan)?.lines.map((l) => l.key) ?? []
      : poolPicksOf(job.venue)
          .filter((p) => job.ids.includes(p.tokenId))
          .map((p) => p.key)

  const confirmAll = async () => {
    if (!me || running) return
    frozenPools.current = livePoolPlans
    setRunning(true)
    setStopWords(undefined)
    const client = getPublicClient(wagmiConfig, { chainId })!
    await runSweep(jobs, {
      simulate: async (job) => {
        setStage('check')
        guard()
        if (job.kind === 'opensea') {
          let plan = osPlanRef.current!
          // OpenSea's permission on the orders lasts minutes: fetched again when close to running out.
          if (needsRefresh(plan.expiresAt, nowS())) {
            const again = planFrom(await fetchInputs())
            const next = again.result?.ok ? again.result : undefined
            if (
              !next ||
              !sameDeal(
                side,
                { keys: plan.lines.map((l) => l.key), total: plan.totals.total },
                {
                  keys: next.lines.map((l) => l.key),
                  total: next.totals.total,
                }
              )
            )
              throw new Plain('The prices or orders changed since you reviewed them. Nothing was sent. Review again.')
            plan = next
            osPlanRef.current = next
            setFresh(next)
          }

          let check: SimulationCheck
          try {
            check = await simulateOs(plan)
          } catch {
            throw new Plain(
              `These can't go in one transaction right now. Nothing was sent. ${
                buying ? 'Buy' : 'Sell'
              } them one by one.`,
              true
            )
          }

          if (check.problem) throw new Plain(osSimProblemWords(buying), true)
          if (!check.fills.length)
            throw new Plain(
              buying
                ? 'None of these are still for sale. Nothing was sent.'
                : 'None of these offers are still open. Nothing was sent.'
            )
          guard()
          sentPlan.current = plan
          setStage('wallet')
          return plan.call
        }

        const sim = await simulatePoolStep(client as never, job.plan, job.step.call!)
        if (!sim.ok) throw new Plain(poolWords(sim.words))
        guard()
        setStage('wallet')
        return job.step.call!
      },
      send: (_job, call) =>
        sendTransaction(wagmiConfig, { account: me, chainId, to: call.to, data: call.data, value: call.value }),
      // The public client, as SweepReview: wagmi's wait throws on a revert, which hid the receipt from the rows.
      wait: async (hash) => {
        let replaced: string | undefined
        const receipt = await client.waitForTransactionReceipt({
          hash: hash as Hash,
          timeout: SWEEP_WAIT_MS,
          onReplaced: (r) => {
            replaced = r.reason
          },
        })
        if (replaced === 'cancelled') return { status: 'cancelled' }
        if (replaced === 'replaced') throw new Error('replaced')
        receipts.current.set(hash, receipt)
        return receipt
      },
      isStopped: () => left.current,
      isRefusal: refused,
      simulationFailed: (job, e) => {
        if (e instanceof Plain && e.fallback && job.kind === 'opensea') setOsFallback(true)
        return { state: 'failed', note: e instanceof Plain ? e.words : noteFor(e) }
      },
      sendFailedNote: noteFor,
      revertedNote: fillFailureWords('failed-onchain', side).words,
      unconfirmedNote: fillFailureWords('unconfirmed', side).words,
      onState: (job, run) => {
        setRuns((r) => ({ ...r, [job.id]: run }))
        if (run.state === 'wallet') return
        setStage(undefined)
        if (run.state === 'pending' && job.kind === 'opensea' && buying)
          for (const l of sentPlan.current?.lines ?? [])
            if (l.orderHash) noteBuyOutcome(sessionStore(), l.orderHash, 'pending')
        if (run.state === 'pending') return
        // Sent: only the receipt says what moved. Not sent (or cancelled in the wallet): nothing moved.
        if (run.hash && run.state !== 'stopped') {
          if (job.kind === 'opensea') osOutcome(run)
          else poolOutcome(job, run)
        } else {
          setItems(keysOf(job), 'stopped')
          if (job.kind === 'opensea' && buying)
            for (const l of sentPlan.current?.lines ?? [])
              if (l.orderHash) noteBuyOutcome(sessionStore(), l.orderHash, 'failed')
        }
      },
      onRefused: () => setStopWords('You stopped it in your wallet. Nothing else will be sent.'),
    })
    setStage(undefined)
    setRunning(false)
    setFinished(true)
    ethBalance.refetch()
    poolReads.refetch()
    onDone()
  }

  /* ---------- the screen ---------- */

  const loading = (osPicks.length > 0 && (osData.isLoading || coll.loading)) || poolReads.isLoading
  const mustAgree = buying && !!unverified && !agreedUnverified
  const sent = Object.keys(runs).length > 0
  const osTotal = osPlan?.totals.total ?? 0n
  const tokenParts = poolPlans.flatMap((p) =>
    p && p.totals.units > 0n ? [`${tokensText(p.totals.tokens)} ${p.pool.symbol}`] : []
  )
  const finishWords = [osPlan && osJobReady ? `${ethText(osTotal)} ${buying ? 'ETH' : feeSymbol}` : '', ...tokenParts]
    .filter(Boolean)
    .join(' + ')
  const jobCount = jobs.length

  const action = (() => {
    if (cancelled) return { label: 'Review again', onClick: onAgain }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (running) return { label: 'Working…', disabled: true }
    if (tx.busy) return { label: txWords(tx.tx), disabled: true }
    if (loading) return { label: 'Checking each NFT…', disabled: true }
    if (osApprovalFailed)
      return {
        label: 'Check again',
        onClick: () => {
          conduit.refetch()
          nftAllowed.refetch()
          feeReads.refetch()
        },
      }
    // The approval just landed and the read saying so is on its way: don't offer it again in the gap.
    if (nextApproval && tx.tx.phase === 'done' && tx.tx.id === nextApproval.id)
      return { label: 'Checking…', disabled: true }
    if (nextApproval?.press) return { label: nextApproval.label, onClick: nextApproval.press, disabled: mustAgree }
    if (!jobCount && nextTokens) return { label: nextTokens.label, onClick: nextTokens.press }
    if (!jobCount) {
      const unsent = Object.values(runs).some((r) => !r.hash || r.state === 'stopped')
      if (sent && unsent) return { label: 'Review again', onClick: onAgain }
      return {
        label:
          finished || sent
            ? 'Done'
            : buying
            ? 'Nothing here can be bought together'
            : 'Nothing here can be sold together',
        disabled: true,
      }
    }

    if (short) return { label: 'Not enough ETH', disabled: true }
    if (osPicks.length && osReady && osSim.isFetching) return { label: 'Checking…', disabled: true }
    return {
      label: `${buying ? 'Buy' : 'Sell'}${finishWords ? ` for ${finishWords}` : ''} · ${jobCount} transaction${
        jobCount === 1 ? '' : 's'
      }`,
      disabled: mustAgree,
      onClick: confirmAll,
    }
  })() as { label: string; disabled?: boolean; onClick?: () => void }

  const closeIt = () => {
    // While it runs, closing stops the rest: no new wallet prompt opens once this screen has gone.
    if (running) left.current = true
    onClose()
  }

  const stateOf = (key: string, venue: string, review?: string) => {
    const r = results[key]
    if (r) return { cls: r, words: ITEM_RESULT_WORDS[r] }
    const run =
      venue === 'opensea' ? runs.opensea : Object.entries(runs).find(([id]) => id.startsWith(`${venue}-`))?.[1]
    if (run?.state === 'wallet')
      return { cls: '', words: stage === 'check' ? 'Checking the transaction again…' : 'Confirm in your wallet' }
    if (run?.state === 'pending') return { cls: '', words: 'Waiting for the network' }
    return {
      cls: review === 'skip' ? 'skipped' : '',
      words: review === 'skip' ? 'No longer available: Seaport will skip it. Nothing paid for it.' : 'Ready',
    }
  }

  // The one-by-one path: every one not yet settled when the batch can't go, else only those left out that still can.
  const oneByOneBuys = osPicks.filter((p) =>
    showFallback ? !results[p.key] : excluded.some((x) => x.key === p.key && x.oneByOne)
  )
  const fmt = (v: bigint, sym: string) => `${v < 0n ? '−' : ''}${formatAmount(v < 0n ? -v : v, 18, 6)} ${sym}`
  const osSym = buying ? 'ETH' : feeSymbol

  return (
    <Card
      aria-label={buying ? 'Review your batch buy' : 'Review your batch sale'}
      data-batch-review
      onKeyDown={(e) => {
        if (escapeCloses && e.key === 'Escape' && !running && !tx.busy) {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <Head>
        <h2>
          {buying ? 'Buy' : 'Sell'} {picks.length} · {title}
        </h2>
        <LinkButton type="button" onClick={closeIt} disabled={tx.busy}>
          {finished || running ? 'Close' : 'Cancel'}
        </LinkButton>
      </Head>
      <Stat>
        <span>Where</span>
        <strong>
          {venues.length === 1 ? '1 place' : `${venues.length} places`}, on {chain.name} · one transaction each
        </strong>
      </Stat>

      {cancelled && (
        <StatusBox tone="error" role="alert" data-batch-cancelled>
          <span>{cancelled}</span>
        </StatusBox>
      )}

      {!me ? (
        <Prose>Connect a wallet to check each NFT and see exact totals.</Prose>
      ) : loading ? (
        <Skeleton h="120px" />
      ) : (
        <>
          {osPicks.length > 0 && (
            <section aria-label="OpenSea" data-batch-venue="opensea">
              <Eyebrow>OpenSea{osPlan ? ` · one transaction for ${osPlan.lines.length}` : ''}</Eyebrow>
              <Rows>
                {osPicks.map((p) => {
                  const line = osPlan?.lines.find((l) => l.key === p.key)
                  const out = excluded.find((x) => x.key === p.key)
                  const skip = osSim.data?.skips.includes(p.key) ? 'skip' : undefined
                  const st = stateOf(p.key, 'opensea', skip)
                  return (
                    <li key={p.key}>
                      <span>#{p.tokenId}</span>
                      <span className="num">
                        {line
                          ? fmt(line.net, osSym)
                          : `${formatAmount(p.order.price.amount, p.order.price.decimals, 6)} ${p.order.price.symbol}`}
                      </span>
                      {out ? (
                        <span className="state out">
                          {sharedReason ? 'Left out' : `Left out: ${excludedWords(out.reason, side)}`}
                        </span>
                      ) : line ? (
                        <span className={`state ${st.cls}`}>
                          {st.words}
                          {runs.opensea?.hash && results[p.key] && (
                            <>
                              {' · '}
                              <a
                                href={`${explorerUrl(chainId)}/tx/${runs.opensea.hash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                tx
                              </a>
                            </>
                          )}
                        </span>
                      ) : null}
                      {onOneByOne &&
                        !running &&
                        !buying &&
                        ((out && out.oneByOne) || (showFallback && line && !results[p.key])) && (
                          <PushButton type="button" onClick={() => onOneByOne([p])}>
                            Sell #{p.tokenId} on its own
                          </PushButton>
                        )}
                    </li>
                  )
                })}
              </Rows>
              {osPlan && (
                <Lines>
                  {osPlan.totals.lines.map((l) => (
                    <div key={l.label}>
                      <dt>{l.label}</dt>
                      <dd>{fmt(l.amount, osSym)}</dd>
                    </div>
                  ))}
                  <div className="total">
                    <dt>{buying ? 'You pay at most' : 'You get'}</dt>
                    <dd>
                      {fmt(osPlan.totals.total, osSym)} {ethInUsd(osPlan.totals.total, ethUsd)}
                    </dd>
                  </div>
                </Lines>
              )}
              {osPlan && (
                <Stat data-batch-network-fee>
                  <span>Network fee</span>
                  <strong>
                    {osFee !== undefined
                      ? `about ${formatAmount(osFee, 18, 5)} ETH ${ethInUsd(osFee, ethUsd)}`
                      : 'shown in your wallet'}
                  </strong>
                </Stat>
              )}
              {osPlan && (
                <Hint>
                  {buying
                    ? 'One transaction for all of them. Any that sell first are skipped and cost nothing; you pay only for what you get. Only fees the orders require, none optional.'
                    : `One transaction for all of them. Bids are paid in ${feeSymbol}, not ETH; the fees above come off them. Any offer that closes first is skipped.`}
                </Hint>
              )}
              {sharedReason && (
                <StatusBox tone="error" role="alert" data-batch-left-out>
                  <span>{excludedWords(sharedReason, side)}</span>
                </StatusBox>
              )}
              {osRefusal && !sharedReason && (
                <StatusBox tone="error" role="alert">
                  <span>{osRefusal.error}</span>
                </StatusBox>
              )}
              {osData.error && (
                <StatusBox tone="error" role="alert">
                  <span>{noteFor(osData.error)}</span>
                </StatusBox>
              )}
              {runs.opensea?.note && (
                <StatusBox tone={runs.opensea.state === 'unconfirmed' ? 'info' : 'error'} role="alert">
                  <span>{runs.opensea.note}</span>
                </StatusBox>
              )}
              {osSimProblem && !runs.opensea && (
                <StatusBox tone="error" role="alert" data-batch-sim-failed>
                  <span>{osSimProblem}</span>
                </StatusBox>
              )}
              {short && (
                <Hint style={{ color: color.warning }}>
                  You have {fmt(ethBalance.data!.value, 'ETH')}, and this needs {fmt(osPlan!.call.value, 'ETH')} plus
                  the network fee. Untick some.
                </Hint>
              )}
              {buying && onOneByOne && !running && oneByOneBuys.length > 0 && (
                <PushButton type="button" onClick={() => onOneByOne(oneByOneBuys)}>
                  Buy {oneByOneBuys.length === 1 ? `#${oneByOneBuys[0]!.tokenId} on its own` : 'them one by one'}
                </PushButton>
              )}
            </section>
          )}

          {poolVenues.map(({ venue, ref, picks: list }, i) => {
            const plan = poolPlans[i]
            const sim = poolSims[i]?.data
            const label = 'MiyaPool'
            return (
              <section key={venue} aria-label={label} data-batch-venue={venue}>
                <Eyebrow>
                  {label} ·{' '}
                  {plan?.transactions && plan.transactions > 1 ? `${plan.transactions} steps` : 'one transaction'}
                </Eyebrow>
                <Rows>
                  {list.map((p) => {
                    const out = plan?.excluded.find((x) => x.id?.toString() === p.tokenId)
                    const st = stateOf(p.key, venue)
                    return (
                      <li key={p.key}>
                        <span>#{p.tokenId}</span>
                        <span className="num">1 {ref?.symbol ?? ''}</span>
                        <span className={`state ${out ? 'out' : st.cls}`}>
                          {out ? `Left out: ${out.words}` : st.words}
                        </span>
                      </li>
                    )
                  })}
                </Rows>
                {plan && (
                  <Lines>
                    <div>
                      <dt>Fees</dt>
                      <dd>None</dd>
                    </div>
                    <div className="total">
                      <dt>{buying ? 'You pay' : 'You get'}</dt>
                      <dd>
                        {tokensText(plan.totals.tokens)} {plan.pool.symbol}
                      </dd>
                    </div>
                    {buying && plan.totals.have !== undefined && (
                      <div>
                        <dt>You hold</dt>
                        <dd>
                          {tokensText(plan.totals.have)} {plan.pool.symbol}
                        </dd>
                      </div>
                    )}
                  </Lines>
                )}
                {!buying && (
                  <Hint>
                    You get {ref?.symbol ?? 'pool tokens'}, not ETH: 1 per NFT. Turning it into ETH is a separate swap
                    on the Tokens tab, priced then.
                  </Hint>
                )}
                {plan?.notes
                  .filter((n) => !/^To turn /.test(n))
                  .map((n) => (
                    <Hint key={n}>{n}</Hint>
                  ))}
                {plan?.blocked && (
                  <StatusBox tone="error" role="alert">
                    <span>{plan.blocked}</span>
                    {poolReads.isError || /couldn't/i.test(plan.blocked) ? (
                      <>
                        {' '}
                        <LinkButton type="button" onClick={() => poolReads.refetch()}>
                          Check again
                        </LinkButton>
                      </>
                    ) : null}
                  </StatusBox>
                )}
                {sim && !sim.ok && !runs[`${venue}-0`] && (
                  <StatusBox tone="error" role="alert">
                    <span>{poolWords(sim.words)}</span>
                  </StatusBox>
                )}
                {Object.entries(runs)
                  .filter(([id, r]) => id.startsWith(`${venue}-`) && r.note)
                  .map(([id, r]) => (
                    <StatusBox key={id} tone={r.state === 'unconfirmed' ? 'info' : 'error'} role="alert">
                      <span>{r.note}</span>
                    </StatusBox>
                  ))}
                {venueWords[venue] && (
                  <StatusBox tone="ok" role="status">
                    <span>{venueWords[venue]}</span>
                  </StatusBox>
                )}
                {!ref && (
                  <StatusBox tone="error" role="alert">
                    <span>This pool could not be read. Close this and try again.</span>
                  </StatusBox>
                )}
              </section>
            )
          })}

          {(gates.length > 0 || jobs.length + Object.keys(runs).length > 1) && (
            <>
              <Eyebrow>Steps, in order</Eyebrow>
              <Steps data-batch-steps>
                {gates.map((g) => (
                  <li key={g.id} className={g.done ? 'done' : undefined}>
                    {g.done ? '✓ ' : ''}
                    {g.title}
                    <span>{g.words}</span>
                    {!g.done && isTokens(g) && !g.press && <span>Get it on the Tokens tab, then come back.</span>}
                    {!g.done && isTokens(g) && g.press && action.onClick !== g.press && (
                      <PushButton type="button" onClick={g.press}>
                        {g.label}
                      </PushButton>
                    )}
                  </li>
                ))}
                {osPicks.length > 0 && osPlan && (
                  <li>
                    Confirm OpenSea: one transaction for {osPlan.lines.length}
                    <span>
                      {runs.opensea?.note ?? (runs.opensea ? '' : 'Checked again right before your wallet opens.')}
                    </span>
                  </li>
                )}
                {poolPlans.map((plan, i) =>
                  plan?.steps
                    .filter((s) => s.call && s.key !== 'approve')
                    .map((s, k) => (
                      <li key={`${poolVenues[i]!.venue}-${k}`}>
                        {s.title} · MiyaPool
                        <span>{runs[`${poolVenues[i]!.venue}-${k}`]?.note ?? s.words}</span>
                      </li>
                    ))
                )}
              </Steps>
            </>
          )}

          {buying && unverified && !finished && (
            <>
              <Hint style={{ color: color.warning }} data-batch-unverified>
                Not verified: check the address. <Mono>{contract}</Mono>
              </Hint>
              <ConfirmCheck checked={agreedUnverified} onChange={setAgreedUnverified} disabled={running}>
                I checked this is the right collection
              </ConfirmCheck>
            </>
          )}
        </>
      )}

      {tx.tx.phase === 'error' && (
        <StatusBox tone="error" role="alert">
          <span>{txWords(tx.tx)}</span>
        </StatusBox>
      )}
      {tx.tx.phase === 'done' && !running && (nextApproval || jobCount > 0) && !sent && (
        <StatusBox tone="ok" role="status">
          <span>Allowed. Next step below.</span>
        </StatusBox>
      )}
      {stage && (
        <StatusBox tone="info" role="status" data-batch-stage>
          <img src={LoadingHourglass} alt="" />
          <span>{stage === 'check' ? 'Checking the transaction again…' : 'Confirm in your wallet…'}</span>
        </StatusBox>
      )}
      {stopWords && (
        <StatusBox tone="info" role="status">
          <span>{stopWords}</span>
        </StatusBox>
      )}
      {running && !stage && (
        <StatusBox tone="info" role="status">
          <img src={LoadingHourglass} alt="" />
          <span>Keep this open until it finishes. Closing it stops the rest.</span>
        </StatusBox>
      )}

      <Buttons>
        {wrongChain && !cancelled && <SwitchNote chainName={chain.name} failed={!!switchError} />}
        <Action type="button" disabled={action.disabled} onClick={action.onClick} data-batch-action>
          {action.label}
        </Action>
        {!cancelled && !finished && jobCount > 1 && (
          <Hint>
            Your wallet asks once per transaction. Stop in your wallet at any point and nothing after it is sent.
          </Hint>
        )}
      </Buttons>
    </Card>
  )
}

/**
 * Review, then trade several NFTs in one transaction per venue: one Seaport call for every OpenSea item (batch.ts),
 * one call per MiyaPool (poolBatch.ts). Each venue is checked when the review opens, and checked again right before its
 * wallet prompt ("Checking the transaction again…"), with OpenSea's fill data fetched again when its permission is
 * close to running out. Approvals are their own presses. A refusal in the wallet stops the venues after it. Results
 * per NFT come only from the receipt (receiptOutcome / readPoolReceipt): nothing is called bought or sold that the
 * receipt doesn't show.
 *
 * The review is for one wallet on one network: an account change (or leaving the network) cancels it, and closing it
 * mid-run opens no new wallet prompt.
 */
export default function BatchReview(props: Props) {
  const [round, setRound] = useState(0)
  return <Review key={round} {...props} onAgain={() => setRound((r) => r + 1)} />
}

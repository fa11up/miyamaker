import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import type { Address } from 'viem'
import { parseEventLogs } from 'viem'
import { erc20Abi, zeroAddress } from 'viem'
import { useBlockNumber, useTransactionReceipt } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'
import { useCanBatch } from '@/utils/batch'

import type { SwapChainId, SwapToken } from '../constants'
import { isSwapChain } from '../constants'
import { Chip, Eyebrow, Skeleton, StatusBox, Stepper } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { erc721Abi, erc1155Abi, poolAbi } from './abi'
import { EscrowClaim } from './EscrowClaim'
import { formatPrice } from './markets'
import { DEFAULT_PAIR_SYMBOL, pairWords, pickPair } from './pairs'
import type { CommitRow, FeeSymbol } from './pool'
import {
  directSendOnly,
  blocksToReveal,
  commitPhase,
  freeUnits,
  depositPlan,
  KIND,
  KIND_LABEL,
  MAX_DRAW_UNITS,
  chooseFeeToken,
  feeStep,
  noRandomWhy,
  offeredFees,
  parseTokenIds,
  pickLocks,
  poolTitle,
  pickFeeTotal,
  pickFeeWords,
  tokenAmountText,
  redeemCost,
  revealWords,
  unitsText,
  wholeUnits,
} from './pool'
import {
  Action,
  ActionDock,
  Card,
  Chips,
  Field,
  Grid,
  Head,
  Hint,
  LinkButton,
  Mono,
  NftTile,
  Prose,
  PushButton,
  Segmented,
  Stat,
  SwitchNote,
} from './ui'
import { pairsFor, poolSide, usePoolPrices } from './usePoolPrices'
import type { Pool } from './usePools'
import { useOpenSeaCollection } from './useMarkets'
import {
  HELD_PAGE,
  useApprovedForAll,
  useHeldIds,
  useMyCommits,
  useOwnedInCollection,
  useNextDraw,
  useOwnership,
  usePool,
  useFeeToken,
} from './usePools'
import { PairSwitch } from './venueUi'

type Wallet = {
  address?: Address
  isConnected: boolean
  wrongChain: boolean
  switching: boolean
  switchChain: (args: { chainId: SupportedChainId }) => void
  switchFailed: boolean
  openConnectModal?: () => void
}

type ActionSpec = { label: string; step?: string; disabled?: boolean; onClick?: () => void; className?: string }

const AddRow = styled.form`
  display: flex;
  gap: ${space[2]};
`

const Draws = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    padding: ${space[2]};
    background: ${color.well};
    font-size: ${text.sm};
  }
`

const FeeBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const QtyRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 140px;
  align-items: center;
  gap: ${space[2]};
`

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** The pool token as a swap token, for the Tokens tab. */
const poolSwapToken = (pool: Pool, chainId: SwapChainId): SwapToken => ({
  chainId,
  address: pool.address,
  symbol: pool.symbol,
  name: pool.name || `${pool.symbol} pool token`,
  decimals: 18,
  tint: color.accentDark,
})

/** One pool: what it holds, buy NFTs with pool tokens, sell NFTs for pool tokens. */
const BOTH_SIDES_WIDTH = 620

const Sides = styled.div`
  display: grid;
  gap: ${space[2]};
  &[data-both] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
  &[data-both] > [data-active] {
    outline: 1px solid ${color.accent};
  }
`

const PoolHero = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  .pic {
    flex: 0 0 72px;
    width: 72px;
    padding: 2px;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
  }
  .price {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  b {
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
  }
  small {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
`

export default function PoolView({
  chainId,
  address: poolAddress,
  onBack,
  onSwapToken,
  wallet,
  onBusy,
}: {
  chainId: SupportedChainId
  address: Address
  onBack: () => void
  onSwapToken: (p: { chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }) => void
  wallet: Wallet
  /** Told while a transaction is in flight, when the page must not change. */
  onBusy?: (busy: boolean) => void
}) {
  const { address: me, isConnected, wrongChain, switching, switchChain, openConnectModal } = wallet
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const explorer = explorerUrl(chainId)

  const info = usePool(chainId, poolAddress, me)
  const { pool } = info
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [sidesRef, { width: sidesWidth }] = useElementSize()
  // Room for both: the pool's NFTs next to yours, and tapping either one says which you're doing.
  const bothSides = sidesWidth >= BOTH_SIDES_WIDTH
  const os = useOpenSeaCollection(chainId, pool?.collection)
  const ethPair = pickPair(pairsFor(chainId), 'ETH')
  const nowPrice = usePoolPrices(chainId, pool ? [poolAddress] : [], ethPair)[poolAddress.toLowerCase()]
  const [pages, setPages] = useState(1)
  const held = useHeldIds(chainId, pool, info.heldIdsCount, pages)
  // Random redeems: ERC-721 pools, except on Robinhood Chain. Pick works on every pool.
  const randomOk = pool?.randomEnabled === true
  const [how, setHow] = useState<'pick' | 'random'>('pick')
  const random = randomOk && how === 'random'
  // Open draws are shown unless the pool surely has none: a failed randomEnabled read must not hide a draw to reveal.
  const drawsOk = !!pool && pool.randomEnabled !== false
  const myCommits = useMyCommits(chainId, drawsOk ? poolAddress : undefined, info.nextCommitId, me, info.nextRevealId)
  // The oldest pending draw, anyone's: it locks NFTs against picking until it is revealed.
  const nextDraw = useNextDraw(chainId, drawsOk ? poolAddress : undefined, info.nextRevealId, info.nextCommitId)
  const block = useBlockNumber({ chainId, watch: drawsOk && (myCommits.commits.length > 0 || !!nextDraw.draw) })
  // Pick fee: the token the picker pays in (IMD or INFER, among those the pool offers), their balance and allowance.
  const [feeWanted, setFeeWanted] = useState<FeeSymbol>()
  const feeChoice = pool ? chooseFeeToken(pool, feeWanted) : undefined
  const feeToken = feeChoice ? (feeChoice.symbol === 'IMD' ? info.imd : info.infer) : undefined
  const feeWallet = useFeeToken(chainId, feeToken, me, poolAddress)
  // The fee approval just landed: the allowance read can lag it, and must not ask again.
  const [feeAllowed, setFeeAllowed] = useState<{ key: string; amount: bigint }>()

  // Buy (pick): ids chosen from the pool. Buy (random): how many.
  const [picked, setPicked] = useState<string[]>([])
  const [count, setCount] = useState(1)
  // Sell: ids chosen from the wallet, with an amount each (ERC1155).
  const [selling, setSelling] = useState<string[]>([])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState<string>()
  const [manualIds, setManualIds] = useState<string[]>([])
  const [revealed, setRevealed] = useState<{ ids: bigint[]; held?: bigint[]; rearmed?: boolean }>()
  // A random-buy payment whose ending couldn't be read, kept after "Start over": until its receipt is read, paying
  // again could spend the pool tokens twice, so the buy button waits on it instead.
  const [unsureCommit, setUnsureCommit] = useState<`0x${string}`>()
  const unsureReceipt = useTransactionReceipt({ hash: unsureCommit, chainId, query: { enabled: !!unsureCommit } })
  // The wallet whose Allow just landed: the read saying so can lag, and must not offer it again.
  const [allowedBy, setAllowedBy] = useState<string>()
  // Which pair "Buy / Sell <pool token>" uses on the Tokens tab, and prices the token in. ETH unless chosen.
  const pairs = pairsFor(chainId)
  const [pairSymbol, setPairSymbol] = useState<string>(DEFAULT_PAIR_SYMBOL)
  const pair = pickPair(pairs, pairSymbol)
  const pairPrice = usePoolPrices(chainId, info.pool ? [poolAddress] : [], pair)[poolAddress.toLowerCase()]

  const owned = useOwnedInCollection(chainId, pool?.collection, me)
  const ownedForPool = useMemo(
    () => (owned.nfts || []).filter((n) => n.contract.toLowerCase() === pool?.collection.toLowerCase()),
    [owned.nfts, pool?.collection],
  )
  const sellIds = useMemo(() => selling.map((s) => BigInt(s)), [selling])
  const ownership = useOwnership(chainId, pool?.collection, pool?.kind ?? KIND.ERC721, me, sellIds)
  const approval = useApprovedForAll(chainId, pool?.kind === KIND.ERC721 ? pool.collection : undefined, me, poolAddress)

  const refresh = () => {
    info.refetch()
    held.refetch()
    myCommits.refetch()
    nextDraw.refetch()
    feeWallet.refetch()
    ownership.refetch()
    approval.refetch()
    owned.refetch()
  }

  const batches = useCanBatch(chainId)
  const tx = useTx((id) => {
    refresh()
    if (id === 'redeem') {
      setPicked([])
      setFeeAllowed(undefined)
    }
    if (id === 'approve') setAllowedBy(me)
    if (id === 'deposit-one') setSelling((list) => list.slice(1))
    else if (id.startsWith('deposit')) {
      setSelling([])
      setManualIds([])
      setQty({})
    }
  })
  useEffect(() => onBusy?.(tx.busy), [tx.busy])
  useEffect(() => () => onBusy?.(false), [])

  // Read the reveal's outcome from its receipt.
  useEffect(() => {
    if (tx.tx.phase !== 'done' || !tx.tx.id?.startsWith('reveal') || !tx.tx.receipt) return
    const logs = parseEventLogs({ abi: poolAbi, logs: tx.tx.receipt.logs })
    const done = logs.find((l) => l.eventName === 'RedeemRevealed')
    if (done && done.eventName === 'RedeemRevealed') {
      const held = logs.flatMap((l) => (l.eventName === 'RedeemEscrowed' ? [l.args.id] : []))
      setRevealed({ ids: [...done.args.ids], held })
    } else if (logs.some((l) => l.eventName === 'RedeemRearmed')) setRevealed({ ids: [], rearmed: true })
  }, [tx.tx.phase, tx.tx.receipt])

  // A different pool starts clean.
  useEffect(() => {
    setPicked([])
    setCount(1)
    setHow('pick')
    setSide('buy')
    setSelling([])
    setManualIds([])
    setQty({})
    setTyped('')
    setTypedError(undefined)
    setPages(1)
    setRevealed(undefined)
    setAllowedBy(undefined)
    setUnsureCommit(undefined)
    setFeeWanted(undefined)
    setFeeAllowed(undefined)
    tx.reset()
  }, [poolAddress, chainId])

  // The receipt is in (landed or reverted): the draws list now says what happened, so the buy can be offered again.
  useEffect(() => {
    if (!unsureCommit || !unsureReceipt.data) return
    setUnsureCommit(undefined)
    info.refetch()
    myCommits.refetch()
  }, [unsureCommit, unsureReceipt.data])

  if (info.loading && !pool) {
    return (
      <Card aria-label="Loading pool">
        <Skeleton h="28px" w="60%" />
        <Skeleton h="16px" />
        <Skeleton h="120px" />
      </Card>
    )
  }

  if (!pool) {
    return (
      <Card role="alert">
        <LinkButton type="button" onClick={onBack}>
          ← All pools
        </LinkButton>
        {info.notFromFactory ? (
          <Prose>
            <Mono>{shortAddress(poolAddress)}</Mono> is not a MiyaPool. MiyaMaker&apos;s pool factory on {chain.name}{' '}
            didn&apos;t make it, so nothing here can trade with it. Don&apos;t approve or send anything to it.
          </Prose>
        ) : info.factoryCheckFailed ? (
          <Prose>
            Couldn&apos;t check that <Mono>{shortAddress(poolAddress)}</Mono> is a MiyaPool.{' '}
            <LinkButton type="button" onClick={() => info.refetch()}>
              Check again
            </LinkButton>
          </Prose>
        ) : (
          <Prose>
            There is no pool at <Mono>{shortAddress(poolAddress)}</Mono> on {chain.name}. It may be on another network.
          </Prose>
        )}
      </Card>
    )
  }

  const title = poolTitle(pool)
  const poolAsk = poolSide(nowPrice, 'ask')
  const { symbol } = pool
  const { balance } = info
  const affordable = wholeUnits(balance)
  // The pick fee per NFT in each token the pool offers ("1 IMD or 3,500 INFER"); empty when picks are free.
  const offered = offeredFees(pool)
  const feesUnknown = pool.imdFee === undefined || pool.inferFee === undefined
  const feeEach = offered.map((o) => `${tokenAmountText(o.fee)} ${o.symbol}`).join(' or ')
  const pickPrice = feesUnknown
    ? `1 ${symbol} + the pick fee`
    : offered.length
    ? `1 ${symbol} + ${feeEach}`
    : `1 ${symbol}, no fee`
  const free = freeUnits(pool.held, info.pendingUnits) // ERC721: NFTs not promised to an open draw
  const maxDraw = Math.max(1, Math.min(free ?? 0, MAX_DRAW_UNITS))
  const is1155 = pool.kind === KIND.ERC1155
  const swapChain = isSwapChain(chainId) ? chainId : undefined
  const { busy } = tx

  /* ---------- buy ---------- */

  const toggleBuy = (id: bigint) => {
    const k = id.toString()
    setSide('buy')
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }

  const buyUnits = random ? count : picked.length
  // Random and pick both burn exactly 1 pool token per NFT. A pick also pays the fee per NFT in IMD or INFER.
  const cost = redeemCost(buyUnits)
  const short = balance !== undefined && balance < cost
  const feeTotal = feeChoice ? pickFeeTotal(feeChoice.fee, picked.length) : 0n
  const feeKey = `${me}:${feeToken}:${feeTotal}`
  const allowanceNow =
    feeAllowed && feeAllowed.key === feeKey && (feeWallet.allowance ?? 0n) < feeAllowed.amount
      ? feeAllowed.amount
      : feeWallet.allowance
  const fee = feeStep(feeTotal, allowanceNow, feeWallet.balance)
  const feeWords = feeChoice ? `${tokenAmountText(feeTotal)} ${feeChoice.symbol}` : ''
  // Picked NFTs a pending random draw has locked since they were chosen, or whose lock couldn't be read.
  const lockIndex = new Map(held.ids.map((id, i) => [id.toString(), i]))
  const locks = pickLocks(picked, (id) => {
    const i = lockIndex.get(id)
    return i === undefined ? undefined : held.lockedAt(i)
  })
  const lockedShown = held.ids.filter((_, i) => held.lockedAt(i) === true).length

  // The 4th argument is the fee token; address(0) when picks are free.
  const redeemCall = () => ({
    address: poolAddress,
    abi: poolAbi,
    functionName: 'redeem',
    args: [picked.map((p) => BigInt(p)), picked.map(() => 1n), me, feeChoice && feeToken ? feeToken : zeroAddress],
    chainId,
  })
  // Approve exactly the fee for this pick, never more.
  const approveFeeCall = () => ({
    address: feeToken,
    abi: erc20Abi,
    functionName: 'approve',
    args: [poolAddress, feeTotal],
    chainId,
  })
  const redeem = () => me && tx.run('redeem', redeemCall())
  const approveFee = () => {
    if (!me || !feeToken) return
    const done = { key: feeKey, amount: feeTotal }
    if (batches) tx.runBatch('redeem', [approveFeeCall(), redeemCall()], 'approve-fee')
    else tx.run('approve-fee', approveFeeCall()).then((ok) => ok && setFeeAllowed(done))
  }
  const commit = () =>
    me &&
    tx.run('commit', {
      address: poolAddress,
      abi: poolAbi,
      functionName: 'commitRedeem',
      args: [BigInt(count), me],
      chainId,
    })
  const settleOlderDraw = (id: bigint) =>
    tx.run(`settle-${id}`, {
      address: poolAddress,
      abi: poolAbi,
      functionName: 'revealRedeem',
      args: [id],
      chainId,
    })
  const reveal = (c: CommitRow) => {
    setRevealed(undefined)
    tx.run(`reveal-${c.id}`, {
      address: poolAddress,
      abi: poolAbi,
      functionName: 'revealRedeem',
      args: [c.id],
      chainId,
    })
  }

  /* ---------- sell ---------- */

  const toggleSell = (id: string) => {
    setSide('sell')
    setSelling((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  const addTyped = () => {
    const { ids, error } = parseTokenIds(typed)
    setTypedError(error)
    if (error || !ids.length) return
    setSide('sell')
    const keys = ids.map(String)
    setManualIds((m) => [...new Set([...m, ...keys])])
    setSelling((s) => [...new Set([...s, ...keys])])
    setTyped('')
  }

  const amountFor = (id: string) => {
    if (!is1155) return 1n
    const v = qty[id]
    return v && /^\d+$/.test(v) && BigInt(v) > 0n ? BigInt(v) : 1n
  }

  const notOwned = selling.filter(
    (_, i) => ownership.held[i] !== undefined && ownership.held[i]! < amountFor(selling[i]!),
  )
  const checking = selling.length > 0 && ownership.held.some((h) => h === undefined) && ownership.loading
  const ownershipUnknown = selling.length > 0 && !checking && ownership.held.some((h) => h === undefined)
  const sellUnits = selling.reduce((sum, id) => sum + amountFor(id), 0n)
  const plan = depositPlan(
    pool.kind,
    selling.length,
    approval.approved || (!!me && allowedBy === me) || undefined,
    directSendOnly(chainId),
  )

  const deposit = () => {
    if (!me) return
    const ids = selling.map((s) => BigInt(s))
    if (plan === 'transfer-721')
      tx.run('deposit', {
        address: pool.collection,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [me, poolAddress, ids[0]!, '0x'],
        chainId,
      })
    else if (plan === 'transfer-721-each') {
      const sends = ids.map((id) => ({
        address: pool.collection,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [me, poolAddress, id, '0x'],
        chainId,
      }))
      if (batches) tx.runBatch('deposit', sends, 'deposit-one')
      else tx.run('deposit-one', sends[0])
    } else if (plan === 'transfer-1155')
      tx.run('deposit', {
        address: pool.collection,
        abi: erc1155Abi,
        functionName: 'safeBatchTransferFrom',
        args: [me, poolAddress, ids, selling.map(amountFor), '0x'],
        chainId,
      })
    else {
      const allow = {
        address: pool.collection,
        abi: erc721Abi,
        functionName: 'setApprovalForAll',
        args: [poolAddress, true],
        chainId,
      }
      const sell = { address: poolAddress, abi: poolAbi, functionName: 'deposit', args: [ids, [], me], chainId }
      if (plan !== 'approve') tx.run('deposit', sell)
      else if (batches) tx.runBatch('deposit', [allow, sell], 'approve')
      else tx.run('approve', allow)
    }
  }

  /* ---------- the one primary action ---------- */

  const nfts = (n: number | bigint) => `${n.toString()} NFT${n.toString() === '1' ? '' : 's'}`
  const action: ActionSpec = (() => {
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (tx.tx.phase === 'wallet') return { label: 'Confirm in wallet…', disabled: true }
    if (tx.tx.phase === 'pending') return { label: 'Waiting for the network…', disabled: true }
    // It may still land, and a second commit would spend the pool tokens again.
    if (tx.unconfirmed)
      return {
        label: 'Start over',
        onClick: () => {
          // A random-buy payment may still land: keep watching it so the same payment isn't offered again.
          if (tx.tx.id === 'commit' && tx.tx.hash) setUnsureCommit(tx.tx.hash)
          tx.reset()
          refresh()
        },
      }
    if (side === 'buy') {
      // An open draw is step 2 of a random buy: finish it before starting another.
      const draw = random ? myCommits.commits[0] : undefined
      if (draw) {
        // No block read means no count to give: a guess here would sit on the button for good if the read failed.
        if (block.data === undefined)
          return block.isError
            ? { label: 'Check again', step: 'We could not read the latest block.', onClick: () => block.refetch() }
            : { label: 'Checking the block…', disabled: true }
        const left = blocksToReveal(draw.targetBlock, block.data)
        if (left > 0) return { label: `Reveal in ${left} block${left === 1 ? '' : 's'}…`, disabled: true }
        const older = info.nextRevealId
        if (older !== undefined && older !== draw.id) {
          return {
            label: 'Settle the earlier draw',
            step: 'Draws settle in order. This one sends its NFT to whoever made it, then yours is closer.',
            onClick: () => settleOlderDraw(older),
          }
        }

        return {
          label: draw.amount === 1 ? 'Reveal your NFT' : `Reveal your ${draw.amount} NFTs`,
          step: 'Step 2 of 2: see which NFT you got. It is sent to your wallet. If the collection refuses, the pool holds it for you to claim.',
          onClick: () => reveal(draw),
        }
      }

      if (pool.held === undefined)
        return { label: 'Check again', step: "We couldn't read how many NFTs the pool holds.", onClick: refresh }
      if (pool.held === 0n) return { label: 'The pool is empty', disabled: true }
      if (random) {
        if (unsureCommit)
          return unsureReceipt.isError
            ? {
                label: 'Check again',
                step: "We couldn't confirm your last payment. Check your wallet before you pay again.",
                onClick: () => unsureReceipt.refetch(),
              }
            : { label: 'Checking your last payment…', disabled: true }
        if (free === undefined)
          return { label: 'Check again', step: "We couldn't read which NFTs are in open draws.", onClick: refresh }
        if (free < 1) return { label: 'Every NFT is in an open draw', disabled: true }
        if (short) return { label: `Not enough ${symbol}`, disabled: true }
        return {
          label: `Buy ${count} random for ${count} ${symbol}`,
          step: 'Step 1 of 2: pay now. Step 2: reveal which NFT you got, a block later.',
          onClick: commit,
        }
      }

      if (!picked.length) return { label: 'Pick NFTs to buy', disabled: true }
      if (feesUnknown || (feeChoice && !feeToken))
        return { label: 'Check again', step: "We couldn't read this pool's pick fee.", onClick: refresh }
      if (locks.locked.length)
        return {
          label: `#${locks.locked[0]} is locked`,
          disabled: true,
          step: 'A random draw is waiting to be revealed. Reveal it above, or pick NFTs that are not locked.',
        }
      if (locks.unknown.length)
        return { label: 'Check again', step: "We couldn't check whether these NFTs are locked.", onClick: refresh }
      if (short) return { label: `Not enough ${symbol}`, disabled: true }
      const buyWords = `Buy ${nfts(picked.length)} for ${unitsText(cost)} ${symbol}`
      if (fee === 'free') return { label: buyWords, onClick: redeem }
      const sym = feeChoice!.symbol
      if (fee === 'unknown')
        return feeWallet.loading
          ? { label: `Checking your ${sym}…`, disabled: true }
          : { label: 'Check again', step: `We couldn't read your ${sym} balance.`, onClick: feeWallet.refetch }
      if (fee === 'short') return { label: `Not enough ${sym}`, disabled: true }
      const feeNote = `The ${feeWords} fee goes to the INFER/IMD alignment vault, credited to you.`
      if (fee === 'approve')
        return batches
          ? {
              label: `${buyWords} + ${feeWords}`,
              step: `One signature: lets the pool take exactly ${feeWords}, then buys. ${feeNote}`,
              onClick: approveFee,
            }
          : {
              label: `Approve ${feeWords}`,
              step: `Step 1 of 2: lets the pool take exactly ${feeWords} for this pick. Then buy. ${feeNote}`,
              onClick: approveFee,
            }
      return { label: `${buyWords} + ${feeWords}`, step: feeNote, onClick: redeem }
    }

    if (!selling.length) return { label: 'Choose NFTs to sell', disabled: true }
    if (checking) return { label: 'Checking your NFTs…', disabled: true }
    if (notOwned.length) return { label: `You do not hold #${notOwned[0]}`, disabled: true }
    if (ownershipUnknown)
      return { label: 'Check again', step: "We couldn't check that you hold these NFTs.", onClick: ownership.refetch }
    if (plan === 'transfer-721-each')
      return {
        label: batches ? `Sell ${nfts(sellUnits)} for ${sellUnits.toString()} ${symbol}` : `Sell #${selling[0]}`,
        step: batches
          ? 'One signature, all or nothing.'
          : `This collection only allows one at a time. ${selling.length} to go: sign for each.`,
        onClick: deposit,
      }
    if (plan === 'approve' && batches)
      return {
        label: `Sell ${nfts(sellUnits)} for ${sellUnits.toString()} ${symbol}`,
        step: `One signature: lets this pool move all your ${title} NFTs until you revoke it, and sells, all or nothing.`,
        onClick: deposit,
      }
    if (plan === 'approve')
      return {
        label: `Allow the pool to take ${title}`,
        step: `Step 1 of 2: this lets the pool move all your ${title} NFTs, until you revoke it. Then sell.`,
        onClick: deposit,
      }
    return {
      label: `Sell ${nfts(sellUnits)} for ${sellUnits.toString()} ${symbol}`,
      step: plan === 'deposit' && selling.length > 1 ? 'Step 2 of 2: sell.' : undefined,
      onClick: deposit,
    }
  })()

  const txLink = tx.tx.hash && (
    <a href={`${explorer}/tx/${tx.tx.hash}`} target="_blank" rel="noreferrer">
      View transaction ↗
    </a>
  )

  const doneWords: Record<string, string> = {
    redeem: 'Bought. The NFTs are in your wallet.',
    'approve-fee': 'Approved. Now press Buy.',
    commit: 'Paid. Reveal your NFT below once the next block is in.',
    approve: 'Allowed. Now press Sell.',
    deposit: `Sold. The ${symbol} is in your wallet.`,
    'deposit-one': `Sold one. The ${symbol} is in your wallet.`,
  }

  return (
    <>
      <LinkButton type="button" onClick={onBack} disabled={busy}>
        ← All pools
      </LinkButton>

      <Card aria-label={`${title} pool`} data-pool-view>
        <PoolHero>
          {os.info?.image && (
            <span className="pic" aria-hidden>
              <NftImage src={os.info.image} alt="" variant="thumb" />
            </span>
          )}
          <span className="price" data-pool-now>
            {poolAsk && <small>One NFT costs about</small>}
            <b>{poolAsk ? formatPrice(poolAsk) : nowPrice?.state === 'loading' && swapChain ? '…' : 'No price yet'}</b>
            {!poolAsk && nowPrice?.state !== 'loading' && <small>Nobody has added liquidity for {symbol} yet.</small>}
          </span>
        </PoolHero>
        <Head>
          <h2>{title}</h2>
          <Chips>
            <Chip tone="ok" title="Choose the NFT you get: 1 pool token plus this fee">
              {pickFeeWords(pool)}
            </Chip>
            {randomOk && <Chip title="A future block picks the NFT">Random</Chip>}
            <Chip>{KIND_LABEL[pool.kind]}</Chip>
          </Chips>
        </Head>
        <Prose data-pool-rules>
          Sell an NFT in: get 1 {symbol}. {pool.randomEnabled === false ? '' : `Random NFT out: 1 ${symbol} each, no fee. `}
          Pick the NFT you want: {pickPrice} each.
          {offered.length > 0 && ' The fee goes to the INFER/IMD alignment vault, credited to you.'}
          {pool.randomEnabled === false && ` ${noRandomWhy(pool.kind, chainId)}`}
        </Prose>
        {!feesUnknown && <Hint>Whoever started the pool set the pick fee. It can never be changed.</Hint>}
        <Stat>
          <span>In the pool</span>
          <strong>{pool.held === undefined ? '–' : nfts(pool.held)}</strong>
        </Stat>
        {drawsOk && info.pendingUnits !== undefined && info.pendingUnits > 0n && (
          <Stat>
            <span>In open draws</span>
            <strong>{nfts(info.pendingUnits)}</strong>
          </Stat>
        )}
        {me && (
          <Stat>
            <span>You have</span>
            <strong>
              {unitsText(balance)} {symbol}
              {balance !== undefined && balance > 0n && (
                <span style={{ fontWeight: 400, color: color.inkMuted }}> (enough for {nfts(affordable)})</span>
              )}
            </strong>
          </Stat>
        )}
        <Hint>
          Pool token {symbol}: <Mono>{shortAddress(pool.address)}</Mono> ·{' '}
          <a href={`${explorer}/address/${pool.address}`} target="_blank" rel="noreferrer">
            View on explorer ↗
          </a>
        </Hint>
      </Card>

      <Segmented role="group" aria-label="Buy or sell">
        <button type="button" aria-pressed={side === 'buy'} onClick={() => setSide('buy')} disabled={busy}>
          Buy NFTs
        </button>
        <button type="button" aria-pressed={side === 'sell'} onClick={() => setSide('sell')} disabled={busy}>
          Sell NFTs
        </button>
      </Segmented>

      {side === 'buy' && randomOk && (
        <Segmented role="group" aria-label="Which NFT you get" data-pool-how>
          <button type="button" aria-pressed={how === 'pick'} onClick={() => setHow('pick')} disabled={busy}>
            Pick yours · {feesUnknown || offered.length ? `1 ${symbol} + fee` : `1 ${symbol}`} each
          </button>
          <button type="button" aria-pressed={how === 'random'} onClick={() => setHow('random')} disabled={busy}>
            Random · 1 {symbol} each
          </button>
        </Segmented>
      )}

      {side === 'buy' && drawsOk && myCommits.commits.length > 0 && (
        <Card aria-label="Your draws">
          <Eyebrow>Your draws</Eyebrow>
          <Draws>
            {myCommits.commits.map((c) => {
              const phase = commitPhase(c.targetBlock, block.data)
              const left = blocksToReveal(c.targetBlock, block.data)
              // Draws settle in order, so anything before the next one to settle is what its button has to do.
              const older = info.nextRevealId
              const before = older !== undefined && older !== c.id ? older : undefined
              return (
                <li key={c.id.toString()}>
                  <span>
                    {nfts(c.amount)}:{' '}
                    {block.data === undefined
                      ? 'checking the block'
                      : phase === 'waiting'
                        ? `ready in ${left} block${left === 1 ? '' : 's'}`
                        : phase === 'late'
                          ? 'late: revealing picks a new block'
                          : 'ready'}
                  </span>
                  <PushButton
                    type="button"
                    disabled={phase === 'waiting' || busy || wrongChain}
                    onClick={() => (before !== undefined ? settleOlderDraw(before) : reveal(c))}
                  >
                    {before !== undefined ? 'Settle earlier draw' : 'Reveal'}
                  </PushButton>
                </li>
              )
            })}
          </Draws>
          {myCommits.partial && <Hint>Only the newest open draws were checked.</Hint>}
          <Hint>Reveal soon. If you wait too long, the draw moves to a new block and you reveal again.</Hint>
        </Card>
      )}

      {side === 'buy' && revealed && (
        <StatusBox tone={revealed.rearmed ? 'info' : 'ok'} role="status">
          <span>
            {revealed.rearmed
              ? 'That draw waited too long, so it moved to a new block. Reveal again in a moment.'
              : revealWords(revealed.ids, revealed.held)}
          </span>
        </StatusBox>
      )}

      {side === 'buy' && drawsOk && (
        <EscrowClaim pool={poolAddress} chainId={chainId} me={me} busy={busy} disabled={wrongChain} tx={tx} />
      )}

      {side === 'buy' &&
        drawsOk &&
        nextDraw.draw &&
        !myCommits.commits.some((c) => c.id === nextDraw.draw!.id) &&
        (() => {
          const d = nextDraw.draw
          const left = blocksToReveal(d.targetBlock, block.data)
          return (
            <Card aria-label="Pending random draw" data-pool-next-draw>
              <Eyebrow>A random draw is waiting</Eyebrow>
              <Hint>
                Someone paid for {nfts(d.amount)} at random. Until it is revealed, the NFTs that were in the pool then
                are locked and can&apos;t be picked. Anyone can reveal it, from the block after it was made: the NFTs go
                to whoever paid, and you pay only the network fee.
              </Hint>
              <PushButton
                type="button"
                disabled={busy || wrongChain || !isConnected || block.data === undefined || left > 0}
                onClick={() => settleOlderDraw(d.id)}
              >
                {block.data === undefined
                  ? 'Checking the block…'
                  : left > 0
                  ? `Reveal in ${left} block${left === 1 ? '' : 's'}…`
                  : 'Reveal it to unlock'}
              </PushButton>
            </Card>
          )
        })()}

      <Sides ref={sidesRef} data-both={bothSides || undefined}>
        {(bothSides || side === 'buy') && (
          <Card aria-label="Buy NFTs" data-active={side === 'buy' || undefined}>
            <Eyebrow>{random ? 'What is in the pool' : `Pick NFTs · ${picked.length} chosen`}</Eyebrow>
            <Hint>
              {random
                ? `You cannot choose: a block picks for you. Each costs 1 ${symbol}, no fee.`
                : `Tap the NFTs you want. Each costs ${pickPrice}.${randomOk ? ` Random costs 1 ${symbol}, no fee.` : ''}`}
            </Hint>
            {!random && lockedShown > 0 && (
              <Hint style={{ color: color.warning }} data-pool-locked>
                {lockedShown === 1 ? '1 NFT is' : `${lockedShown} NFTs are`} locked: a random draw could get{' '}
                {lockedShown === 1 ? 'it' : 'them'}, so {lockedShown === 1 ? 'it' : 'they'} can&apos;t be picked until
                the draw is revealed. Anyone can reveal it, above.
              </Hint>
            )}
            {held.loading || info.loading ? (
              <Grid>
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} h="120px" />
                ))}
              </Grid>
            ) : held.ids.length ? (
              <Grid>
                {held.ids.map((id, i) => {
                  // A locked NFT can still be un-picked, never picked.
                  const isPicked = picked.includes(id.toString())
                  const locked = !random && held.lockedAt(i) === true
                  return (
                    <NftTile
                      key={id.toString()}
                      chainId={chainId}
                      collection={pool.collection}
                      kind={pool.kind}
                      id={id}
                      units={held.unitsOf(i)}
                      selected={isPicked}
                      note={locked ? 'locked' : undefined}
                      onToggle={random || busy || (locked && !isPicked) ? undefined : () => toggleBuy(id)}
                    />
                  )
                })}
              </Grid>
            ) : held.failed ? (
              <Prose>Couldn&apos;t load the NFTs in this pool. Try again later.</Prose>
            ) : (
              <Prose>The pool is empty. Sell one in to start it.</Prose>
            )}
            {held.more && (
              <PushButton type="button" onClick={() => setPages((p) => p + 1)}>
                Show {HELD_PAGE} more
              </PushButton>
            )}
            {random && (
              <QtyRow>
                <span>How many?</span>
                <Stepper>
                  <button
                    type="button"
                    aria-label="One fewer"
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    disabled={count <= 1 || busy}
                  >
                    −
                  </button>
                  <input
                    aria-label="How many random NFTs"
                    inputMode="numeric"
                    value={count}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ''))
                      setCount(Math.max(1, Math.min(n || 1, maxDraw)))
                    }}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label="One more"
                    onClick={() => setCount((c) => Math.min(maxDraw, c + 1))}
                    disabled={count >= maxDraw || busy}
                  >
                    +
                  </button>
                </Stepper>
              </QtyRow>
            )}
            {!random && !feesUnknown && offered.length > 0 && (
              <FeeBox data-pool-pick-fee>
                {offered.length > 1 && (
                  <Segmented role="group" aria-label="Pay the pick fee in">
                    {offered.map((o) => (
                      <button
                        key={o.symbol}
                        type="button"
                        aria-pressed={feeChoice?.symbol === o.symbol}
                        onClick={() => setFeeWanted(o.symbol)}
                        disabled={busy}
                      >
                        Pay fee in {o.symbol} · {tokenAmountText(o.fee)} each
                      </button>
                    ))}
                  </Segmented>
                )}
                {feeChoice && (
                  <Hint>
                    Pick fee: {picked.length || 1} × {tokenAmountText(feeChoice.fee)} {feeChoice.symbol} ={' '}
                    <b>
                      {tokenAmountText(pickFeeTotal(feeChoice.fee, picked.length || 1))} {feeChoice.symbol}
                    </b>
                    {me && (
                      <>
                        . You have{' '}
                        {feeWallet.balance !== undefined
                          ? `${tokenAmountText(feeWallet.balance, 18, 4)} ${feeChoice.symbol}`
                          : feeWallet.loading
                          ? '…'
                          : "(couldn't read)"}
                      </>
                    )}
                    . It goes to the INFER/IMD alignment vault, credited to you.
                  </Hint>
                )}
              </FeeBox>
            )}
            {!random && fee === 'short' && picked.length > 0 && feeChoice && (
              <Hint style={{ color: color.warning }}>
                You need {feeWords} for the pick fee and have {tokenAmountText(feeWallet.balance, 18, 4)}{' '}
                {feeChoice.symbol}.{offered.length > 1 ? ' Try the other token, or pick fewer.' : ''}
              </Hint>
            )}
            {short && buyUnits > 0 && (
              <Hint style={{ color: color.warning }}>
                You need {unitsText(cost)} {symbol} and have {unitsText(balance)}.{' '}
                {swapChain
                  ? 'Get more on the Tokens tab, or sell an NFT into the pool.'
                  : 'Sell an NFT into the pool to get some.'}
              </Hint>
            )}
          </Card>
        )}
        {(bothSides || side === 'sell') && (
          <Card aria-label="Sell NFTs" data-active={side === 'sell' || undefined}>
            <Eyebrow>Your {title} NFTs</Eyebrow>
            <Hint>Each NFT you sell gives you 1 {symbol}. Tap the ones to sell.</Hint>
            {!me ? (
              <Prose>Connect a wallet to see your NFTs.</Prose>
            ) : owned.supported && owned.loading ? (
              <Grid>
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} h="120px" />
                ))}
              </Grid>
            ) : (
              <>
                {(ownedForPool.length > 0 || manualIds.length > 0) && (
                  <Grid>
                    {ownedForPool.map((n) => (
                      <NftTile
                        key={n.tokenId}
                        chainId={chainId}
                        collection={pool.collection}
                        kind={pool.kind}
                        id={BigInt(n.tokenId)}
                        image={n.image || undefined}
                        name={n.name}
                        selected={selling.includes(n.tokenId)}
                        onToggle={busy ? undefined : () => toggleSell(n.tokenId)}
                      />
                    ))}
                    {manualIds
                      .filter((id) => !ownedForPool.some((n) => n.tokenId === id))
                      .map((id) => (
                        <NftTile
                          key={id}
                          chainId={chainId}
                          collection={pool.collection}
                          kind={pool.kind}
                          id={BigInt(id)}
                          selected={selling.includes(id)}
                          onToggle={busy ? undefined : () => toggleSell(id)}
                        />
                      ))}
                  </Grid>
                )}
                {owned.supported && owned.error && (
                  <Prose>Couldn&apos;t load the NFTs in this wallet. Type their numbers below.</Prose>
                )}
                {owned.supported && !owned.error && !owned.loading && !ownedForPool.length && !manualIds.length && (
                  <Prose>We did not find any in this wallet. If you have some, type their numbers below.</Prose>
                )}
                {owned.partial && (
                  <Hint>This wallet has more than we could list. Type the numbers of any you don&apos;t see.</Hint>
                )}
                <AddRow
                  onSubmit={(e) => {
                    e.preventDefault()
                    addTyped()
                  }}
                >
                  <Field
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={owned.supported ? 'Or type token numbers: 12, 40-45' : 'Token numbers: 12, 40-45'}
                    aria-label="Token numbers to sell"
                    inputMode="numeric"
                    disabled={busy}
                  />
                  <PushButton type="submit" disabled={busy || !typed.trim()}>
                    Add
                  </PushButton>
                </AddRow>
                {typedError && <Hint style={{ color: color.danger }}>{typedError}</Hint>}
                {is1155 &&
                  selling.map((id) => (
                    <QtyRow key={id}>
                      <span>How many #{id}?</span>
                      <Field
                        inputMode="numeric"
                        aria-label={`How many of #${id} to sell`}
                        value={qty[id] ?? '1'}
                        onChange={(e) => setQty((q) => ({ ...q, [id]: e.target.value.replace(/\D/g, '') }))}
                        disabled={busy}
                      />
                    </QtyRow>
                  ))}
                {notOwned.length > 0 && (
                  <Hint style={{ color: color.danger }}>
                    This wallet does not hold enough of {notOwned.map((id) => `#${id}`).join(', ')}. Tap to remove.
                  </Hint>
                )}
              </>
            )}
          </Card>
        )}
      </Sides>

      {tx.tx.phase !== 'idle' && !(tx.tx.phase === 'done' && tx.tx.id?.startsWith('reveal')) && (
        <StatusBox
          tone={tx.tx.phase === 'error' ? 'error' : tx.tx.phase === 'done' ? 'ok' : 'info'}
          role={tx.tx.phase === 'error' ? 'alert' : 'status'}
        >
          {busy && <img src={LoadingHourglass} alt="" />}
          <span>
            {tx.tx.phase === 'done' ? doneWords[tx.tx.id || ''] || txWords(tx.tx) : txWords(tx.tx)} {txLink}
          </span>
        </StatusBox>
      )}

      {swapChain && pair && (
        <Card aria-label={`${symbol} token`} data-pool-token>
          <Eyebrow>The {symbol} token</Eyebrow>
          <Prose>
            {symbol} is a normal token: 1 {symbol} takes an NFT out of the pool
            {offered.length ? ' (a pick also pays the pick fee)' : ''}. If it has a market, buy or sell it for{' '}
            {pairWords(pairs.map((t) => t.symbol))} on the Tokens tab.
          </Prose>
          <PairSwitch
            label="Pay with / get"
            options={pairs.map((t) => t.symbol)}
            value={pair.symbol}
            onChange={setPairSymbol}
          />
          <Hint aria-live="polite" data-pool-pair-price>
            {(() => {
              const p = pairPrice
              if (!p || p.state === 'loading') return `Pricing 1 ${symbol} in ${pair.symbol}…`
              if (p.state === 'unconfigured') return `No ${pair.symbol} price: the swap service is off.`
              if (p.state === 'error') return `Could not get a ${pair.symbol} price right now.`
              if (p.status === 'no-route')
                return `No ${pair.symbol} market for ${symbol} yet, so 0x has no route. Try another pair.`
              const ask = poolSide(p, 'ask')
              const bid = poolSide(p, 'bid')
              return [ask && `Buy 1 ≈ ${formatPrice(ask)}`, bid && `sell 1 ≈ ${formatPrice(bid)}`]
                .filter(Boolean)
                .join(' · ')
            })()}
          </Hint>
          <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
            <PushButton
              type="button"
              onClick={() =>
                onSwapToken({
                  chainId: swapChain,
                  sell: pair,
                  buy: poolSwapToken(pool, swapChain),
                })
              }
            >
              Buy {symbol} with {pair.symbol}
            </PushButton>
            <PushButton
              type="button"
              onClick={() =>
                onSwapToken({
                  chainId: swapChain,
                  sell: poolSwapToken(pool, swapChain),
                  buy: pair,
                })
              }
              disabled={!balance}
            >
              Sell {symbol} for {pair.symbol}
            </PushButton>
          </div>
        </Card>
      )}

      <ActionDock>
        {wrongChain && <SwitchNote chainName={chain.name} failed={wallet.switchFailed} />}
        <Action
          type="button"
          className={action.className}
          disabled={!!action.disabled}
          onClick={action.onClick}
          data-pool-action
        >
          {action.label}
        </Action>
        {action.step && <Hint>{action.step}</Hint>}
      </ActionDock>
      <div style={{ height: space[3] }} />
    </>
  )
}

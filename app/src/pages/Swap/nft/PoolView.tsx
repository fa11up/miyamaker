import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { parseEventLogs } from 'viem'
import { useBlockNumber } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { Chip, Eyebrow, Skeleton, StatusBox, Stepper } from '@/components/Retro'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'
import { color, space, text } from '@/theme/tokens'

import type { SwapChainId, SwapToken } from '../constants'
import { isSwapChain } from '../constants'
import { erc721Abi, erc1155Abi, poolAbi } from './abi'
import { formatPrice } from './markets'
import { DEFAULT_PAIR_SYMBOL, pairWords, pickPair } from './pairs'
import type { CommitRow } from './pool'
import {
  blocksToReveal,
  commitPhase,
  depositPlan,
  KIND,
  KIND_LABEL,
  MODE,
  MODE_HINT,
  MODE_LABEL,
  parseTokenIds,
  poolTitle,
  redeemCost,
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
} from './ui'
import { pairsFor, poolSide, usePoolPrices } from './usePoolPrices'
import type { Pool } from './usePools'
import {
  HELD_PAGE,
  useApprovedForAll,
  useHeldIds,
  useMyCommits,
  useOwnedInCollection,
  useOwnership,
  usePool,
} from './usePools'
import { PairSwitch } from './venueUi'

type Wallet = {
  address?: Address
  isConnected: boolean
  wrongChain: boolean
  switching: boolean
  switchChain: (args: { chainId: SupportedChainId }) => void
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
export default function PoolView({
  chainId,
  address: poolAddress,
  onBack,
  onSwapToken,
  wallet,
}: {
  chainId: SupportedChainId
  address: Address
  onBack: () => void
  onSwapToken: (p: { chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }) => void
  wallet: Wallet
}) {
  const { address: me, isConnected, wrongChain, switching, switchChain, openConnectModal } = wallet
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const explorer = explorerUrl(chainId)

  const info = usePool(chainId, poolAddress, me)
  const { pool } = info
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [pages, setPages] = useState(1)
  const held = useHeldIds(chainId, pool, info.heldIdsCount, pages)
  const random = pool?.mode === MODE.RANDOM
  const myCommits = useMyCommits(chainId, random ? poolAddress : undefined, info.nextCommitId, me)
  const block = useBlockNumber({ chainId, watch: random && myCommits.commits.length > 0 })

  // Buy (pick): ids chosen from the pool. Buy (random): how many.
  const [picked, setPicked] = useState<string[]>([])
  const [count, setCount] = useState(1)
  // Sell: ids chosen from the wallet, with an amount each (ERC1155).
  const [selling, setSelling] = useState<string[]>([])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState<string>()
  const [manualIds, setManualIds] = useState<string[]>([])
  const [revealed, setRevealed] = useState<{ ids: bigint[]; rearmed?: boolean }>()
  // Which pair "Buy / Sell <pool token>" uses on the Tokens tab, and prices the token in. ETH unless chosen.
  const pairs = pairsFor(chainId)
  const [pairSymbol, setPairSymbol] = useState<string>(DEFAULT_PAIR_SYMBOL)
  const pair = pickPair(pairs, pairSymbol)
  const pairPrice = usePoolPrices(chainId, info.pool ? [poolAddress] : [], pair)[poolAddress.toLowerCase()]

  const owned = useOwnedInCollection(chainId, pool?.collection, me)
  const ownedForPool = useMemo(
    () => (owned.nfts || []).filter((n) => n.contract.toLowerCase() === pool?.collection.toLowerCase()),
    [owned.nfts, pool?.collection]
  )
  const sellIds = useMemo(() => selling.map((s) => BigInt(s)), [selling])
  const ownership = useOwnership(chainId, pool?.collection, pool?.kind ?? KIND.ERC721, me, sellIds)
  const approval = useApprovedForAll(chainId, pool?.kind === KIND.ERC721 ? pool.collection : undefined, me, poolAddress)

  const refresh = () => {
    info.refetch()
    held.refetch()
    myCommits.refetch()
    ownership.refetch()
    approval.refetch()
    owned.refetch()
  }

  const tx = useTx((id) => {
    refresh()
    if (id === 'redeem') setPicked([])
    if (id.startsWith('deposit')) {
      setSelling([])
      setManualIds([])
      setQty({})
    }
  })

  // Read the reveal's outcome from its receipt.
  useEffect(() => {
    if (tx.tx.phase !== 'done' || !tx.tx.id?.startsWith('reveal') || !tx.tx.receipt) return
    const logs = parseEventLogs({ abi: poolAbi, logs: tx.tx.receipt.logs })
    const done = logs.find((l) => l.eventName === 'RedeemRevealed')
    if (done && done.eventName === 'RedeemRevealed') setRevealed({ ids: [...done.args.ids] })
    else if (logs.some((l) => l.eventName === 'RedeemRearmed')) setRevealed({ ids: [], rearmed: true })
  }, [tx.tx.phase, tx.tx.receipt])

  // A different pool starts clean.
  useEffect(() => {
    setPicked([])
    setSelling([])
    setManualIds([])
    setQty({})
    setPages(1)
    setRevealed(undefined)
    tx.reset()
  }, [poolAddress, chainId])

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
        <Prose>
          There is no pool at <Mono>{shortAddress(poolAddress)}</Mono> on {chain.name}. It may be on another network.
        </Prose>
      </Card>
    )
  }

  const title = poolTitle(pool)
  const { symbol } = pool
  const { balance } = info
  const affordable = wholeUnits(balance)
  const free = Number(pool.held - info.pendingUnits) // ERC721: NFTs not promised to an open draw
  const is1155 = pool.kind === KIND.ERC1155
  const swapChain = isSwapChain(chainId) ? chainId : undefined
  const { busy } = tx

  /* ---------- buy ---------- */

  const toggleBuy = (id: bigint) => {
    const k = id.toString()
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }

  const buyUnits = random ? count : picked.length
  const cost = redeemCost(buyUnits)
  const short = balance !== undefined && balance < cost

  const redeem = () =>
    me &&
    tx.run('redeem', {
      address: poolAddress,
      abi: poolAbi,
      functionName: 'redeem',
      args: [picked.map((p) => BigInt(p)), picked.map(() => 1n), me],
      chainId,
    })
  const commit = () =>
    me &&
    tx.run('commit', {
      address: poolAddress,
      abi: poolAbi,
      functionName: 'commitRedeem',
      args: [BigInt(count), me],
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

  const toggleSell = (id: string) => setSelling((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const addTyped = () => {
    const { ids, error } = parseTokenIds(typed)
    setTypedError(error)
    if (error || !ids.length) return
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
    (_, i) => ownership.held[i] !== undefined && ownership.held[i]! < amountFor(selling[i]!)
  )
  const checking = selling.length > 0 && ownership.held.some((h) => h === undefined) && ownership.loading
  const sellUnits = selling.reduce((sum, id) => sum + amountFor(id), 0n)
  const plan = depositPlan(pool.kind, selling.length, approval.approved)

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
    else if (plan === 'transfer-1155')
      tx.run('deposit', {
        address: pool.collection,
        abi: erc1155Abi,
        functionName: 'safeBatchTransferFrom',
        args: [me, poolAddress, ids, selling.map(amountFor), '0x'],
        chainId,
      })
    else if (plan === 'approve')
      tx.run('approve', {
        address: pool.collection,
        abi: erc721Abi,
        functionName: 'setApprovalForAll',
        args: [poolAddress, true],
        chainId,
      })
    else
      tx.run('deposit', {
        address: poolAddress,
        abi: poolAbi,
        functionName: 'deposit',
        args: [ids, [], me],
        chainId,
      })
  }

  /* ---------- the one primary action ---------- */

  const nfts = (n: number | bigint) => `${n.toString()} NFT${n.toString() === '1' ? '' : 's'}`
  const action: ActionSpec = (() => {
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (tx.tx.phase === 'wallet') return { label: 'Confirm in wallet…', disabled: true }
    if (tx.tx.phase === 'pending') return { label: 'Waiting for the network…', disabled: true }
    if (side === 'buy') {
      // An open draw is step 2 of a random buy: finish it before starting another.
      const draw = random ? myCommits.commits[0] : undefined
      if (draw) {
        const left = blocksToReveal(draw.targetBlock, block.data)
        if (left > 0) return { label: `Reveal in ${left} block${left === 1 ? '' : 's'}…`, disabled: true }
        return {
          label: draw.amount === 1 ? 'Reveal your NFT' : `Reveal your ${draw.amount} NFTs`,
          step: 'Step 2 of 2: see which NFT you got. It goes straight to your wallet.',
          onClick: () => reveal(draw),
        }
      }

      if (pool.held === 0n) return { label: 'The pool is empty', disabled: true }
      if (random) {
        if (free < 1) return { label: 'Every NFT is in an open draw', disabled: true }
        if (short) return { label: `Not enough ${symbol}`, disabled: true }
        return {
          label: `Buy ${count} random for ${count} ${symbol}`,
          step: 'Step 1 of 2: pay now. Step 2: reveal which NFT you got, a block later.',
          onClick: commit,
        }
      }

      if (!picked.length) return { label: 'Pick NFTs to buy', disabled: true }
      if (short) return { label: `Not enough ${symbol}`, disabled: true }
      return { label: `Buy ${nfts(picked.length)} for ${picked.length} ${symbol}`, onClick: redeem }
    }

    if (!selling.length) return { label: 'Choose NFTs to sell', disabled: true }
    if (checking) return { label: 'Checking your NFTs…', disabled: true }
    if (notOwned.length) return { label: `You do not hold #${notOwned[0]}`, disabled: true }
    if (plan === 'approve')
      return {
        label: `Allow the pool to take ${title}`,
        step: `Step 1 of 2: let this pool move your ${title} NFTs (one time). Then sell.`,
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
    commit: 'Paid. Reveal your NFT below once the next block is in.',
    approve: 'Allowed. Now press Sell.',
    deposit: `Sold. The ${symbol} is in your wallet.`,
  }

  return (
    <>
      <LinkButton type="button" onClick={onBack} disabled={busy}>
        ← All pools
      </LinkButton>

      <Card aria-label={`${title} pool`} data-pool-view>
        <Head>
          <h2>{title}</h2>
          <Chips>
            <Chip tone={random ? 'warn' : 'ok'} title={MODE_HINT[pool.mode]}>
              {MODE_LABEL[pool.mode]}
            </Chip>
            <Chip>{KIND_LABEL[pool.kind]}</Chip>
          </Chips>
        </Head>
        <Prose>
          {MODE_HINT[pool.mode]} 1 NFT = 1 {symbol}. No fees.
        </Prose>
        <Stat>
          <span>In the pool</span>
          <strong>{nfts(pool.held)}</strong>
        </Stat>
        {random && info.pendingUnits > 0n && (
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

      {side === 'buy' && random && myCommits.commits.length > 0 && (
        <Card aria-label="Your draws">
          <Eyebrow>Your draws</Eyebrow>
          <Draws>
            {myCommits.commits.map((c) => {
              const phase = commitPhase(c.targetBlock, block.data)
              const left = blocksToReveal(c.targetBlock, block.data)
              return (
                <li key={c.id.toString()}>
                  <span>
                    {nfts(c.amount)}:{' '}
                    {phase === 'waiting'
                      ? `ready in ${left} block${left === 1 ? '' : 's'}`
                      : phase === 'late'
                      ? 'late: revealing picks a new block'
                      : 'ready'}
                  </span>
                  <PushButton
                    type="button"
                    disabled={phase === 'waiting' || busy || wrongChain}
                    onClick={() => reveal(c)}
                  >
                    Reveal
                  </PushButton>
                </li>
              )
            })}
          </Draws>
          <Hint>Reveal soon. If you wait too long, the draw moves to a new block and you reveal again.</Hint>
        </Card>
      )}

      {side === 'buy' && revealed && (
        <StatusBox tone={revealed.rearmed ? 'info' : 'ok'} role="status">
          <span>
            {revealed.rearmed
              ? 'That draw waited too long, so it moved to a new block. Reveal again in a moment.'
              : `You got ${revealed.ids.map((id) => `#${id}`).join(', ')}. It is in your wallet.`}
          </span>
        </StatusBox>
      )}

      {side === 'buy' ? (
        <Card aria-label="Buy NFTs">
          <Eyebrow>{random ? 'What is in the pool' : `Pick NFTs · ${picked.length} chosen`}</Eyebrow>
          <Hint>
            {random
              ? `You cannot choose: a block picks for you. Each costs 1 ${symbol}.`
              : `Tap the NFTs you want. Each costs 1 ${symbol}.`}
          </Hint>
          {held.loading ? (
            <Grid>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} h="120px" />
              ))}
            </Grid>
          ) : held.ids.length ? (
            <Grid>
              {held.ids.map((id, i) => (
                <NftTile
                  key={id.toString()}
                  chainId={chainId}
                  collection={pool.collection}
                  kind={pool.kind}
                  id={id}
                  units={held.unitsOf(i)}
                  selected={picked.includes(id.toString())}
                  onToggle={random || busy ? undefined : () => toggleBuy(id)}
                />
              ))}
            </Grid>
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
                    setCount(Math.max(1, Math.min(n || 1, Math.max(1, free))))
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  aria-label="One more"
                  onClick={() => setCount((c) => Math.min(Math.max(1, free), c + 1))}
                  disabled={count >= free || busy}
                >
                  +
                </button>
              </Stepper>
            </QtyRow>
          )}
          {short && buyUnits > 0 && (
            <Hint style={{ color: color.warning }}>
              You need {buyUnits} {symbol} and have {unitsText(balance)}.{' '}
              {swapChain
                ? 'Get more on the Tokens tab, or sell an NFT into the pool.'
                : 'Sell an NFT into the pool to get some.'}
            </Hint>
          )}
        </Card>
      ) : (
        <Card aria-label="Sell NFTs">
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
              {owned.supported && !ownedForPool.length && !manualIds.length && (
                <Prose>We did not find any in this wallet. If you have some, type their numbers below.</Prose>
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
            {symbol} is a normal token: 1 {symbol} takes one NFT out of the pool. If it has a market, buy or sell it for{' '}
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

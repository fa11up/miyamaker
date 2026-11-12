import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { erc20Abi, zeroAddress } from 'viem'
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'
import { useCanBatch } from '@/utils/batch'

import { ethInUsd } from '../board'
import { Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { useEthUsd } from '../MarketBoard'
import { erc721Abi } from './abi'
import { fillFailureKind, fillFailureWords, isShort, nftApprovalCall, nftApprovalState } from './fillLogic'
import type { FillPlan, OsOrder } from './markets'
import { formatAmount, itemUrl, OPENSEA_CHAIN, planFill, usesSeaportItself } from './markets'
import {
  CONDUIT_CONTROLLER,
  conduitControllerAbi,
  INPUT_ALIASES,
  SEAPORT_ADDRESSES,
  seaportAbi,
  seaportCallAbi,
} from './seaport'
import { markGone, noteBuyOutcome, sessionStore, UNCONFIRMED_BUY_WORDS, unconfirmedHashes } from './sweep'
import { Action, Card, ConfirmCheck, Head, Hint, LinkButton, Mono, Prose, Stat, SwitchNote } from './ui'
import { useFillFee } from './useFillFee'
import { fetchFulfillment, useOpenSeaCollection } from './useMarkets'

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

const Buttons = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

/**
 * Review, then fill one OpenSea order in-app: buy a listing, or accept an offer on an NFT you hold.
 *
 * The page asks our proxy for OpenSea's fulfillment data, checks it with `planFill` (Seaport only, this chain, this
 * NFT, goods to you, fixed price, nothing beyond the signed order), shows exactly what moves and who gets what. Only
 * fees the order requires are paid (OpenSea's fee, creator fees the collection enforces); no optional ones. Then: an approval if needed
 * (ERC-20 for token-priced listings; for offers, the fee and the one NFT), then the Seaport call. Every call is simulated
 * before the wallet opens (useTx).
 */
export default function FillReview({
  side,
  order,
  chainId,
  contract,
  tokenId,
  title,
  flagged,
  unverified,
  onClose,
  onDone,
  onGone,
  onBusy,
  oneClick,
}: {
  /**
   * The terminal's BUY / SELL NOW: each wallet step (an approval if owed, then the fill) opens by itself once, as soon as
   * it is ready, so pressing BUY is the whole flow. Never after an error (a retry is pressed), never past a consent box.
   */
  oneClick?: boolean
  side: 'buy' | 'sell'
  order: OsOrder
  chainId: SupportedChainId
  contract: Address
  tokenId: string
  title: string
  /** OpenSea flagged this NFT: buying takes an extra yes. */
  flagged?: boolean
  /** The collection has no OpenSea badge and isn't hand-checked: buying takes an extra yes. */
  unverified?: boolean
  onClose: () => void
  onDone: () => void
  /** The order turned out to be sold, cancelled or expired. */
  onGone?: () => void
  /** Told while a transaction is in flight, when the page must not change. */
  onBusy?: (busy: boolean) => void
}) {
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const wrongChain = isConnected && walletChain !== chainId
  const osChain = OPENSEA_CHAIN[chainId]
  // The collection's own creator fee payees (cached): any other payee in the order is shown as "Other fee".
  const creatorFees = useOpenSeaCollection(chainId, contract).info?.fees.map((f) => f.recipient)

  // A buy of this listing sent earlier this session that we couldn't see land: offering it again could pay twice.
  const [heldBack] = useState(() => side === 'buy' && unconfirmedHashes(sessionStore()).has(order.hash))

  const data = useQuery({
    queryKey: ['os-fill', side, order.hash, me?.toLowerCase()],
    enabled: !!me && !!osChain && !heldBack,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      side === 'buy'
        ? fetchFulfillment(
            'fulfill_listing',
            {
              chain: osChain!,
              hash: order.hash,
              protocol_address: order.protocolAddress,
              fulfiller: me!,
            },
            signal
          )
        : fetchFulfillment(
            'fulfill_offer',
            {
              chain: osChain!,
              hash: order.hash,
              protocol_address: order.protocolAddress,
              fulfiller: me!,
              contract,
              token_id: tokenId,
            },
            signal
          ),
  })

  const plan = data.data
    ? planFill(data.data, {
        side,
        chainId,
        contract,
        tokenId,
        account: me || zeroAddress,
        seaports: SEAPORT_ADDRESSES,
        abi: seaportAbi,
        aliases: INPUT_ALIASES,
        creatorFees,
      })
    : undefined
  const ok = plan?.ok ? (plan as FillPlan) : undefined

  // Who moves the tokens: Seaport itself, or the conduit for the fulfiller's conduit key.
  const conduit = useReadContract({
    address: CONDUIT_CONTROLLER,
    abi: conduitControllerAbi,
    functionName: 'getConduit',
    args: [(ok?.conduitKey || `0x${'0'.repeat(64)}`) as `0x${string}`],
    chainId,
    query: { enabled: !!ok && !usesSeaportItself(ok.conduitKey) },
  })
  const operator: Address | undefined = ok
    ? usesSeaportItself(ok.conduitKey)
      ? (ok.to as Address)
      : conduit.data?.[1]
      ? conduit.data[0]
      : undefined
    : undefined

  const erc20 = ok && !ok.currency.native ? (ok.currency.token as Address) : undefined
  const tokenReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: erc20, abi: erc20Abi, functionName: 'symbol', chainId },
      { address: erc20, abi: erc20Abi, functionName: 'decimals', chainId },
      { address: erc20, abi: erc20Abi, functionName: 'balanceOf', args: [me || zeroAddress], chainId },
      {
        address: erc20,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [me || zeroAddress, operator || zeroAddress],
        chainId,
      },
    ],
    query: { enabled: !!erc20 && !!me },
  })
  const [symR, decR, balR, allowR] = tokenReads.data || []
  const nativeBalance = useBalance({ address: me, chainId, query: { enabled: !!me && !!ok } })
  const nftApprovedAll = useReadContract({
    address: contract,
    abi: erc721Abi,
    functionName: 'isApprovedForAll',
    args: [me || zeroAddress, operator || zeroAddress],
    chainId,
    query: { enabled: side === 'sell' && !!me && !!operator },
  })
  // ERC-721 only: ERC-1155 has no approval for one token.
  const nftApprovedOne = useReadContract({
    address: contract,
    abi: erc721Abi,
    functionName: 'getApproved',
    args: [BigInt(tokenId)],
    chainId,
    query: { enabled: side === 'sell' && !!operator && ok?.nftKind === 'erc721', retry: false },
  })

  const symbol = ok?.currency.native
    ? chain.nativeCurrency.symbol
    : symR?.status === 'success'
    ? String(symR.result).slice(0, 12)
    : order.price.symbol
  const decimals = ok?.currency.native ? 18 : decR?.status === 'success' ? Number(decR.result) : order.price.decimals
  const fmt = (n: bigint) => `${n < 0n ? '−' : ''}${formatAmount(n < 0n ? -n : n, decimals, 6)} ${symbol}`

  const [stepsDone, setStepsDone] = useState(0)
  const [agreedFlagged, setAgreedFlagged] = useState(false)
  const [agreedUnverified, setAgreedUnverified] = useState(false)
  const tx = useTx((id) => {
    tokenReads.refetch()
    nftApprovedAll.refetch()
    nftApprovedOne.refetch()
    nativeBalance.refetch()
    if (id === 'approve') setStepsDone((n) => n + 1)
    if (id === 'fill') onDone()
  })
  useEffect(() => tx.reset(), [order.hash])
  useEffect(() => onBusy?.(tx.busy), [tx.busy])
  useEffect(() => () => onBusy?.(false), [])

  const balance = ok?.currency.native
    ? nativeBalance.data?.value
    : balR?.status === 'success'
    ? (balR.result as bigint)
    : undefined
  const allowance = allowR?.status === 'success' ? (allowR.result as bigint) : undefined
  const needs20 = !!erc20 && allowance !== undefined && ok !== undefined && allowance < ok.fromYou
  const tokenChecking = !!erc20 && !!ok && ok.fromYou > 0n && allowance === undefined && tokenReads.isLoading
  const reading = conduit.isFetching || tokenReads.isFetching || nftApprovedAll.isFetching || nftApprovedOne.isFetching
  // A read that failed stays failed: without this the button waits on "Checking…" for good.
  const conduitFailed = conduit.isError || (!!conduit.data && !conduit.data[1])
  const nftState =
    side === 'sell' && ok
      ? nftApprovalState({
          kind: ok.nftKind,
          operator,
          approvedForAll: nftApprovedAll.data,
          approvedAddress: nftApprovedOne.data,
          approvedKnown: nftApprovedOne.isFetched,
          readFailed: nftApprovedAll.isError,
        })
      : 'ready'
  const tokenFailed = !!erc20 && !!ok && ok.fromYou > 0n && allowance === undefined && !tokenChecking
  const checkFailed =
    !!ok && (nftState === 'failed' || tokenFailed || (!usesSeaportItself(ok.conduitKey) && conduitFailed))
  const checkAgain = () => {
    if (conduit.isError) conduit.refetch()
    if (tokenFailed) tokenReads.refetch()
    if (nftApprovedAll.isError) nftApprovedAll.refetch()
  }

  const batches = useCanBatch(chainId)

  const fillCall = ok && {
    address: ok.to as Address,
    abi: seaportCallAbi,
    functionName: ok.functionName,
    args: ok.args,
    value: ok.value,
    chainId,
  }
  const fill = () => fillCall && tx.run('fill', fillCall)

  // What is wrong, in plain words: the order could not be had, or the transaction did not go through.
  const planRefusal = plan && !plan.ok ? (plan as { error: string; openSea?: boolean }) : undefined
  const failure =
    tx.tx.phase === 'error'
      ? fillFailureKind(tx.tx.error, side)
      : data.error
      ? fillFailureKind(data.error, side)
      : undefined
  const failed = failure
    ? fillFailureWords(failure, side)
    : planRefusal?.openSea
    ? fillFailureWords('opensea-only', side)
    : planRefusal
    ? { words: planRefusal.error }
    : undefined
  const unconfirmed = tx.tx.phase === 'error' && failure === 'unconfirmed'
  const openSeaHref = itemUrl('opensea', chainId, contract, tokenId)

  // A sent buy is remembered until its outcome is known, so closing and reopening can't offer it again meanwhile.
  const sentBuy = useRef(false)
  useEffect(() => {
    if (side !== 'buy' || tx.tx.id !== 'fill') return
    if (tx.tx.phase === 'wallet') sentBuy.current = false
    else if (tx.tx.phase === 'pending') {
      sentBuy.current = true
      noteBuyOutcome(sessionStore(), order.hash, 'pending')
    } else if (tx.tx.phase === 'done') noteBuyOutcome(sessionStore(), order.hash, 'bought')
    else if (tx.tx.phase === 'error') {
      // Never sent, failed on chain or cancelled: settled. Anything else may still land.
      const settled = !sentBuy.current || failure === 'failed-onchain' || failure === 'cancelled'
      noteBuyOutcome(sessionStore(), order.hash, settled ? 'failed' : 'unconfirmed')
    }
  }, [tx.tx.phase, tx.tx.id, failure])

  // A sold listing leaves this visitor's list at once: the shared list can lag it by a minute.
  useEffect(() => {
    if (failure !== 'gone') return
    if (side === 'buy') markGone(sessionStore(), order.hash)
    onGone?.()
  }, [failure])
  // Anything else may just be fill data gone stale: OpenSea's signature on it lasts minutes. Ask again for a retry.
  useEffect(() => {
    if (tx.tx.phase === 'error' && failure === 'generic') data.refetch()
  }, [tx.tx.phase, failure])

  const ethUsd = useEthUsd()
  const fee = useFillFee({
    chainId,
    account: me,
    // Only the final call: while an approval is still owed the estimate reverts, and the wallet shows the fee instead.
    calls: ok && fillCall && !needs20 && nftState === 'ready' ? [fillCall] : [],
    key: `${order.hash}-${needs20}-${nftState}`,
  })
  const native = chain.nativeCurrency.symbol
  const short = side === 'buy' && !!ok && isShort(balance, ok.total, fee, ok.currency.native)
  const gasShort = !!ok && !short && !ok.currency.native && isShort(nativeBalance.data?.value, 0n, fee, true)
  const totalUsd = ok && (symbol === 'ETH' || symbol === 'WETH') ? ethInUsd(ok.total, ethUsd) : ''
  const mustAgree = side === 'buy' && ((flagged && !agreedFlagged) || (unverified && !agreedUnverified))

  const action = (() => {
    if (tx.tx.phase === 'wallet') return { label: 'Confirm in wallet…', disabled: true }
    if (tx.tx.phase === 'pending') return { label: 'Waiting for the network…', disabled: true }
    if (tx.tx.phase === 'done' && tx.tx.id === 'fill')
      return { label: side === 'buy' ? 'Bought' : 'Sold', disabled: true }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (heldBack) return { label: 'Still unconfirmed', step: UNCONFIRMED_BUY_WORDS, disabled: true }
    if (failure === 'gone') return { label: 'Close', onClick: onClose }
    // It may yet land, so it is not offered again until the person has looked.
    if (unconfirmed) return { label: 'Could not confirm yet', disabled: true }
    if (!ok) return { label: data.isLoading ? 'Getting the order…' : 'Cannot fill here', disabled: true }
    // The approval just landed and the read saying so is on its way: don't offer it again in the gap.
    if (reading && (checkFailed || (tx.tx.phase === 'done' && tx.tx.id === 'approve')))
      return { label: 'Checking…', disabled: true }
    if (checkFailed)
      return { label: 'Check again', step: 'We could not read the approvals. Nothing has moved.', onClick: checkAgain }
    if (!operator || tokenChecking || nftState === 'checking') return { label: 'Checking…', disabled: true }
    if (short) return { label: `Not enough ${symbol}`, disabled: true }
    if (gasShort) return { label: `Not enough ${native} for the network fee`, disabled: true }

    const tokenAllow = needs20 && {
      address: erc20,
      abi: erc20Abi,
      functionName: 'approve',
      args: [operator, ok.fromYou],
      chainId,
    }
    const nftCall = nftApprovalCall(nftState, operator, tokenId)
    const nftAllow = nftCall && { address: contract, abi: erc721Abi, ...nftCall, chainId }
    const owed = [tokenAllow, nftAllow].filter(Boolean)
    const steps = stepsDone + owed.length + 1
    const numbered = `Step ${stepsDone + 1} of ${steps}: `
    const moveWords =
      nftState === 'needs-all' ? `move all your ${title}, until you revoke it` : `move this one NFT, #${tokenId}`
    const finish = side === 'buy' ? `Buy for ${fmt(ok.total)}` : `Sell for ${fmt(ok.total)}`
    const finishVerb = side === 'buy' ? 'buy' : 'sell'

    if (owed.length && batches) {
      const lets = [tokenAllow && `take exactly ${fmt(ok.fromYou)}`, nftAllow && moveWords]
        .filter(Boolean)
        .join(' and ')
      return {
        label: finish,
        step: `One signature: lets OpenSea's contract ${lets}, then ${finishVerb}s, all or nothing.`,
        disabled: mustAgree,
        wallet: true,
        onClick: () => tx.runBatch('fill', [...owed, fillCall], 'approve'),
      }
    }

    if (tokenAllow)
      return {
        label: side === 'buy' ? `Allow ${symbol} for this buy` : `Allow ${fmt(ok.fromYou)} for the fees`,
        step:
          side === 'buy'
            ? `${numbered}let OpenSea's contract take exactly ${fmt(ok.fromYou)}. Then buy.`
            : `${numbered}let OpenSea's contract take exactly ${fmt(
                ok.fromYou
              )} for the fees, out of what you receive. Then sell.`,
        disabled: mustAgree,
        wallet: true,
        onClick: () => tx.run('approve', tokenAllow),
      }

    if (nftAllow)
      return {
        label: nftState === 'needs-all' ? `Allow OpenSea to move your ${title}` : `Allow OpenSea to move #${tokenId}`,
        step:
          nftState === 'needs-all'
            ? `${numbered}this lets OpenSea's contract ${moveWords}. Then sell.`
            : `${numbered}let OpenSea's contract ${moveWords}. Then sell.`,
        wallet: true,
        onClick: () => tx.run('approve', nftAllow),
      }

    return {
      label: finish,
      step: stepsDone > 0 ? `${numbered}${finishVerb}.` : undefined,
      disabled: mustAgree,
      wallet: true,
      onClick: fill,
    }
  })() as { label: string; step?: string; disabled?: boolean; wallet?: boolean; onClick?: () => void }

  // One click: a wallet step that is ready opens once (keyed by the steps already done and what it is). An error
  // leaves the phase at 'error', so nothing fires again until the person presses.
  const fired = useRef(new Set<string>())
  const readyStep =
    oneClick &&
    action.wallet &&
    !action.disabled &&
    action.onClick &&
    (tx.tx.phase === 'idle' || (tx.tx.phase === 'done' && tx.tx.id === 'approve'))
      ? `${order.hash}:${stepsDone}:${action.label}`
      : undefined
  useEffect(() => {
    if (!readyStep || fired.current.has(readyStep)) return
    fired.current.add(readyStep)
    action.onClick?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyStep])

  return (
    <Card aria-label={side === 'buy' ? 'Review your buy' : 'Review your sale'} data-fill-review>
      <Head>
        <h2>{side === 'buy' ? 'Review your buy' : 'Accept this offer'}</h2>
        <LinkButton type="button" onClick={onClose} disabled={tx.busy}>
          {tx.tx.phase === 'done' && tx.tx.id === 'fill' ? 'Close' : 'Cancel'}
        </LinkButton>
      </Head>
      <Stat>
        <span>Where</span>
        <strong>OpenSea, on {chain.name}</strong>
      </Stat>
      <Stat>
        <span>{side === 'buy' ? 'You get' : 'You give'}</span>
        <strong>
          {title} #{tokenId}
        </strong>
      </Stat>

      {!me ? (
        <Prose>Connect a wallet to see the exact price and the fees this order requires.</Prose>
      ) : data.isLoading ? (
        <Skeleton h="96px" />
      ) : ok ? (
        <>
          <Eyebrow>{side === 'buy' ? 'Where your money goes' : 'What you get'}</Eyebrow>
          <Lines>
            {ok.lines.map((l) => (
              <div key={l.label}>
                <dt>{l.label}</dt>
                <dd>{fmt(l.amount)}</dd>
              </div>
            ))}
            <div className="total">
              <dt>{side === 'buy' ? 'You pay' : 'You get'}</dt>
              <dd>
                {fmt(ok.total)} {totalUsd}
              </dd>
            </div>
          </Lines>
          <Stat data-fill-network-fee>
            <span>Network fee</span>
            <strong>
              {fee !== undefined
                ? `about ${formatAmount(fee, 18, 5)} ${native} ${ethInUsd(fee, ethUsd)}`
                : 'shown in your wallet'}
            </strong>
          </Stat>
          <Hint>
            {side === 'buy'
              ? 'The seller set the price; the fees above come out of it. miyaOS never adds optional creator fees, only what the order requires.'
              : 'The fees above come off the offer. miyaOS never adds optional creator fees, only what the order requires.'}
          </Hint>
          {short && (
            <Hint style={{ color: color.warning }}>
              You have {fmt(balance!)}
              {ok.currency.native && fee !== undefined ? ', and this also needs the network fee.' : '.'}{' '}
              {ok.currency.native ? '' : `Get ${symbol} on the Tokens tab.`}
            </Hint>
          )}
        </>
      ) : null}

      {side === 'buy' && flagged && (
        <>
          <StatusBox tone="error" role="alert" data-fill-flagged>
            <span>
              OpenSea flagged this NFT, often because it was reported stolen. You may not be able to resell it.
            </span>
          </StatusBox>
          <ConfirmCheck checked={agreedFlagged} onChange={setAgreedFlagged} disabled={tx.busy}>
            I understand
          </ConfirmCheck>
        </>
      )}
      {side === 'buy' && unverified && (
        <>
          <Hint style={{ color: color.warning }} data-fill-unverified>
            Not verified: check the address. <Mono>{contract}</Mono>
          </Hint>
          <ConfirmCheck checked={agreedUnverified} onChange={setAgreedUnverified} disabled={tx.busy}>
            I checked this is the right collection
          </ConfirmCheck>
        </>
      )}

      {failed && (
        <StatusBox tone={'quiet' in failed && failed.quiet ? 'info' : 'error'} role="alert" data-fill-failed>
          <span>
            {failed.words}{' '}
            {'link' in failed && failed.link && openSeaHref && (
              <a href={openSeaHref} target="_blank" rel="noreferrer">
                Open on OpenSea ↗
              </a>
            )}{' '}
            {tx.tx.phase === 'error' && tx.tx.hash && (
              <a href={`${explorerUrl(chainId)}/tx/${tx.tx.hash}`} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            )}
          </span>
        </StatusBox>
      )}

      {tx.tx.phase !== 'idle' && tx.tx.phase !== 'error' && (
        <StatusBox tone={tx.tx.phase === 'done' ? 'ok' : 'info'} role="status">
          {tx.busy && <img src={LoadingHourglass} alt="" />}
          <span>
            {tx.tx.phase === 'done'
              ? tx.tx.id === 'approve'
                ? 'Allowed. Now finish below.'
                : side === 'buy'
                ? `Bought. #${tokenId} is in your wallet.`
                : `Sold. The ${symbol} is in your wallet.`
              : txWords(tx.tx)}{' '}
            {tx.tx.hash && (
              <a href={`${explorerUrl(chainId)}/tx/${tx.tx.hash}`} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            )}
          </span>
        </StatusBox>
      )}

      <Buttons>
        {wrongChain && <SwitchNote chainName={chain.name} failed={!!switchError} />}
        <Action type="button" disabled={!!action.disabled} onClick={action.onClick} data-fill-action>
          {action.label}
        </Action>
        {'step' in action && action.step && <Hint>{action.step}</Hint>}
      </Buttons>
    </Card>
  )
}

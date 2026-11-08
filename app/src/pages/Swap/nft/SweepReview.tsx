/* eslint-disable no-restricted-syntax -- a sweep is strictly one at a time, in order */
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { getPublicClient, simulateContract, writeContract } from '@wagmi/core'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address, Hash } from 'viem'
import { zeroAddress } from 'viem'
import { useAccount, useBalance, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet, wagmiConfig } from '@/config/wagmi'
import { tryBatch, useCanBatch } from '@/utils/batch'

import { ethInUsd } from '../board'
import { Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { useEthUsd } from '../MarketBoard'
import { failureFacts, fillFailureKind, fillFailureWords, isShort } from './fillLogic'
import type { FillPlan, OsOrder } from './markets'
import { formatAmount, formatPrice, OPENSEA_CHAIN, planFill } from './markets'
import { INPUT_ALIASES, SEAPORT_ADDRESSES, seaportAbi, seaportCallAbi } from './seaport'
import type { SweepRun } from './sweep'
import {
  isWalletRefusal,
  markGone,
  noteBuyOutcome,
  runSweep,
  sessionStore,
  SWEEP_STATE_WORDS,
  SWEEP_WAIT_MS,
  sweepTotals,
} from './sweep'
import { Action, Card, ConfirmCheck, Head, Hint, LinkButton, Mono, Prose, Stat, SwitchNote } from './ui'
import { useFillFee } from './useFillFee'
import { fetchFulfillment } from './useMarkets'

const Rows = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${text.sm};
  font-variant-numeric: tabular-nums;
  th,
  td {
    padding: ${space[1]} ${space[2]};
    border-bottom: 1px solid ${color.light};
    text-align: left;
  }
  th {
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.inkMuted};
  }
  td.num,
  th.num {
    text-align: right;
    white-space: nowrap;
  }
  .bought {
    color: ${color.success};
  }
  .gone,
  .failed,
  .unconfirmed {
    color: ${color.danger};
  }
  .narrow & a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  .note {
    display: block;
    font-size: ${text.xs};
    line-height: 1.3;
    color: ${color.inkMuted};
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
  }
  .total {
    margin-top: ${space[1]};
    padding-top: ${space[1]};
    border-top: 1px solid ${color.shadow};
    font-weight: 700;
  }
  .total dt {
    color: ${color.ink};
  }
`

type Planned = { listing: OsOrder; plan?: FillPlan; error?: string }
type Run = SweepRun

const eth = (wei: bigint) => `${formatAmount(wei, 18, 5)} ETH`

/** A row's note in plain words. The row itself already says it was skipped, so no "pick another" here. */
const noteFor = (error: unknown) =>
  fillFailureWords(fillFailureKind(error, 'buy'), 'buy').words.replace(' Pick another.', '')

const refused = (e: unknown) =>
  isWalletRefusal((e as { shortMessage?: string })?.shortMessage || '') || isWalletRefusal((e as Error)?.message || '')

/**
 * Review, then buy several listings one after another. Every listing goes through planFill first, the same checks as
 * a single buy (Seaport only, this chain, this NFT, to you, fixed price, nothing beyond the signed order); any that
 * fail are left out and shown. The person agrees to one total, which can only go down as listings sell. Each buy is
 * simulated before its wallet prompt, so one that has sold is skipped without a transaction.
 *
 * `listings` must not change during a review: the caller freezes the set when Review is pressed. If this screen goes away
 * the run stops before the next prompt, so a wallet never opens with no screen behind it.
 */
export default function SweepReview({
  listings,
  chainId,
  contract,
  title,
  unverified,
  onClose,
  onDone,
  onBusy,
}: {
  listings: OsOrder[]
  chainId: SupportedChainId
  contract: Address
  title: string
  /** The collection has no OpenSea badge and isn't hand-checked: sweeping takes an extra yes. */
  unverified?: boolean
  onClose: () => void
  onDone: () => void
  /** Told while the sweep runs, when the page must not change. */
  onBusy?: (busy: boolean) => void
}) {
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const wrongChain = isConnected && walletChain !== chainId
  const osChain = OPENSEA_CHAIN[chainId]
  const balance = useBalance({ address: me, chainId, query: { enabled: !!me } })

  const ethUsd = useEthUsd()
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [stopWords, setStopWords] = useState<string>()
  const [agreed, setAgreed] = useState(false)

  // Gone from the screen: no more wallet prompts. Reset on mount for React's double effects in development.
  const left = useRef(false)
  useEffect(() => {
    left.current = false
    return () => {
      left.current = true
      onBusy?.(false)
    }
  }, [])
  useEffect(() => onBusy?.(running), [running])
  // Another wallet starts clean: those rows and that total were the last one's. Never mid-sweep, which waits to finish.
  const sweptFor = useRef(me)
  useEffect(() => {
    if (running || sweptFor.current === me) return
    sweptFor.current = me
    setRuns({})
    setFinished(false)
    setStopWords(undefined)
    setAgreed(false)
  }, [me, running])

  // One at a time: the fulfillment route has its own small rate limit.
  const data = useQuery({
    queryKey: ['os-sweep', listings.map((l) => l.hash).join(), me?.toLowerCase()],
    enabled: !!me && !!osChain,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const out: Planned[] = []
      for (const listing of listings) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const resp = await fetchFulfillment(
            'fulfill_listing',
            { chain: osChain!, hash: listing.hash, protocol_address: listing.protocolAddress, fulfiller: me! },
            signal
          )
          const plan = planFill(resp, {
            side: 'buy',
            chainId,
            contract,
            tokenId: listing.tokenId!,
            account: me || zeroAddress,
            seaports: SEAPORT_ADDRESSES,
            abi: seaportAbi,
            aliases: INPUT_ALIASES,
          })
          if (!plan.ok) out.push({ listing, error: (plan as { error: string }).error })
          else if (!plan.currency.native) out.push({ listing, error: 'Priced in a token, so it cannot be swept.' })
          else out.push({ listing, plan })
        } catch (e) {
          out.push({ listing, error: noteFor(e) })
        }
      }

      return out
    },
  })

  const planned = data.data ?? []
  const good = planned.filter((p): p is Planned & { plan: FillPlan } => !!p.plan)
  const totals = sweepTotals(good.map((p) => p.plan))
  const batches = useCanBatch(chainId)
  const fee = useFillFee({
    chainId,
    account: me,
    calls: good.map(({ plan }) => ({
      address: plan.to as Address,
      abi: seaportCallAbi,
      functionName: plan.functionName,
      args: plan.args,
      value: plan.value,
    })),
    key: good.map((p) => p.listing.hash).join(),
  })
  const short = good.length > 0 && isShort(balance.data?.value, totals.total, fee, true)
  const set = (hash: string, run: Run) => {
    // A buy that may still land is remembered, so the same listing isn't offered again while it might.
    noteBuyOutcome(sessionStore(), hash, run.state)
    setRuns((r) => ({ ...r, [hash]: run }))
  }

  /** A listing that fails its check: the contract said no, so it has gone. A failed look-up says nothing about it. */
  const simulationFailed = (listing: OsOrder, e: unknown): Run => {
    const kind = fillFailureKind(e, 'buy')
    const facts = failureFacts(e)
    if (kind === 'gone' || (facts.reverted && kind === 'generic')) {
      markGone(sessionStore(), listing.hash)
      return { state: 'gone', note: kind === 'gone' ? noteFor(e) : undefined }
    }

    return { state: 'failed', note: noteFor(e) }
  }

  /** All the buys as one signature. True when the batch settled the matter, false to go on one by one. */
  const sweepAsOne = async () => {
    const buys = good.map(({ listing, plan }) => ({
      listing,
      call: {
        address: plan.to as Address,
        abi: seaportCallAbi,
        functionName: plan.functionName,
        args: plan.args,
        value: plan.value,
      },
    }))
    const live: typeof buys = []
    for (const buy of buys) {
      try {
        // eslint-disable-next-line no-await-in-loop, @typescript-eslint/no-explicit-any
        await simulateContract(wagmiConfig, { account: me, chainId, ...buy.call } as any)
        live.push(buy)
      } catch (e) {
        // A listing that has sold would sink the whole batch, so it is left out before anyone signs.
        set(buy.listing.hash, simulationFailed(buy.listing, e))
      }
    }

    if (left.current || !live.length) return true
    const setAll = (run: Run) => live.forEach((b) => set(b.listing.hash, run))
    setAll({ state: 'wallet' })
    try {
      const sent = await tryBatch(
        live.map((b) => b.call),
        { account: me as Address, chainId, onSent: () => setAll({ state: 'pending' }) }
      )
      if (!sent) return false
      setAll({ state: 'bought', hash: sent.hash })
    } catch (e) {
      if (refused(e)) {
        setStopWords('You stopped the sweep in your wallet. Nothing was bought.')
        setAll({ state: 'stopped' })
      } else if ((e as { unconfirmed?: boolean }).unconfirmed) {
        // The wallet has it and hasn't said how it ended: it may yet land, so it isn't a failure.
        setAll({ state: 'unconfirmed', note: fillFailureWords('unconfirmed', 'buy').words })
      } else setAll({ state: 'failed', note: noteFor(e) })
    }

    return true
  }

  const sweep = async () => {
    if (!me) return
    setRunning(true)
    setStopWords(undefined)
    if (batches && good.length > 1 && (await sweepAsOne())) {
      setRunning(false)
      setFinished(true)
      balance.refetch()
      onDone()
      return
    }

    const client = getPublicClient(wagmiConfig, { chainId })
    await runSweep(good, {
      simulate: async ({ plan }) => {
        const { request } = await simulateContract(wagmiConfig, {
          account: me,
          address: plan.to as Address,
          abi: seaportCallAbi,
          functionName: plan.functionName,
          args: plan.args,
          value: plan.value,
          chainId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        return request
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      send: (_item, request) => writeContract(wagmiConfig, request as any),
      // The public client, as useTx: wagmi's wait throws on a revert, and that hid the transaction from its row.
      wait: async (hash) => {
        let replaced: string | undefined
        const receipt = await client!.waitForTransactionReceipt({
          hash: hash as Hash,
          // A dropped transaction never gets a receipt: past this it is "not confirmed yet", and the sweep moves on.
          timeout: SWEEP_WAIT_MS,
          onReplaced: (r) => {
            replaced = r.reason
          },
        })
        if (replaced === 'cancelled') return { status: 'cancelled' }
        if (replaced === 'replaced') throw new Error('replaced')
        return receipt
      },
      isStopped: () => left.current,
      isRefusal: refused,
      simulationFailed: ({ listing }, e) => simulationFailed(listing, e),
      sendFailedNote: noteFor,
      revertedNote: fillFailureWords('failed-onchain', 'buy').words,
      unconfirmedNote: fillFailureWords('unconfirmed', 'buy').words,
      onState: ({ listing }, run) => set(listing.hash, run),
      onRefused: () => setStopWords('You stopped the sweep in your wallet. Nothing else will be bought.'),
    })

    setRunning(false)
    setFinished(true)
    balance.refetch()
    onDone()
  }

  const boughtCount = Object.values(runs).filter((r) => r.state === 'bought').length
  const action = (() => {
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (running) return { label: 'Sweeping…', disabled: true }
    if (finished) return { label: `Bought ${boughtCount} of ${good.length}`, disabled: true }
    if (data.isLoading) return { label: 'Checking each listing…', disabled: true }
    if (!good.length) return { label: 'Nothing here can be swept', disabled: true }
    if (short) return { label: 'Not enough ETH', disabled: true }
    return {
      label: `Buy ${good.length} for up to ${eth(totals.total)}`,
      disabled: !!unverified && !agreed,
      onClick: sweep,
    }
  })()

  return (
    <Card aria-label="Review your sweep" data-sweep-review>
      <Head>
        <h2>Sweep {title}</h2>
        {/* While it runs, closing stops the rest: no new wallet prompt opens once this screen has gone. */}
        <LinkButton
          type="button"
          onClick={() => {
            if (running) left.current = true
            onClose()
          }}
        >
          {finished || running ? 'Close' : 'Cancel'}
        </LinkButton>
      </Head>
      <Stat>
        <span>Where</span>
        <strong>OpenSea, on {chain.name}</strong>
      </Stat>

      {!me ? (
        <Prose>Connect a wallet to check each listing and see the exact total.</Prose>
      ) : data.isLoading ? (
        <Skeleton h="120px" />
      ) : (
        <>
          <Rows>
            <thead>
              <tr>
                <th scope="col">NFT</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {planned.map(({ listing, plan, error }) => {
                const run = runs[listing.hash]
                return (
                  <tr key={listing.hash}>
                    <td>#{listing.tokenId}</td>
                    <td className="num">{plan ? eth(plan.total) : formatPrice(listing.price)}</td>
                    <td className={run?.state}>
                      {error ? (
                        <span className="failed">Left out: {error}</span>
                      ) : (
                        SWEEP_STATE_WORDS[run?.state ?? 'ready']
                      )}
                      {run?.hash && (
                        <>
                          {' · '}
                          <a href={`${explorerUrl(chainId)}/tx/${run.hash}`} target="_blank" rel="noreferrer">
                            tx
                          </a>
                        </>
                      )}
                      {run?.note && <span className="note">{run.note}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Rows>

          {good.length > 0 && (
            <>
              <Eyebrow>Where your money goes</Eyebrow>
              <Lines>
                {totals.lines.map((l) => (
                  <div key={l.label}>
                    <dt>{l.label}</dt>
                    <dd>{eth(l.amount)}</dd>
                  </div>
                ))}
                <div className="total">
                  <dt>You pay at most</dt>
                  <dd>
                    {eth(totals.total)} {ethInUsd(totals.total, ethUsd)}
                  </dd>
                </div>
              </Lines>
              <Stat data-sweep-network-fee>
                <span>Network fee</span>
                <strong>
                  {fee !== undefined
                    ? `about ${formatAmount(fee, 18, 5)} ETH in total ${ethInUsd(fee, ethUsd)}`
                    : 'shown in your wallet'}
                </strong>
              </Stat>
              <Hint>
                {batches
                  ? 'One signature for all of them, all or nothing. Listings already sold are left out before you sign. If one sells in the last moments, nothing is bought and you only lose the gas.'
                  : 'Each NFT is its own transaction, so your wallet asks once per NFT and gas is paid each time. If one sells first it is skipped and you do not pay for it. Stop in your wallet at any point and nothing else is bought.'}
              </Hint>
              {short && (
                <Hint style={{ color: color.warning }}>
                  You have {eth(balance.data!.value)}, and this needs {eth(totals.total)} plus the network fee. Sweep
                  fewer.
                </Hint>
              )}
              {unverified && !finished && (
                <>
                  <Hint style={{ color: color.warning }} data-sweep-unverified>
                    Not verified: check the address. <Mono>{contract}</Mono>
                  </Hint>
                  <ConfirmCheck checked={agreed} onChange={setAgreed} disabled={running}>
                    I checked this is the right collection
                  </ConfirmCheck>
                </>
              )}
            </>
          )}
        </>
      )}

      {data.error && (
        <StatusBox tone="error" role="alert">
          <span>{noteFor(data.error)}</span>
        </StatusBox>
      )}
      {stopWords && (
        <StatusBox tone="info" role="status">
          <span>{stopWords}</span>
        </StatusBox>
      )}
      {running && (
        <StatusBox tone="info" role="status">
          <img src={LoadingHourglass} alt="" />
          <span>Keep this window open until the sweep finishes. Closing it stops the rest.</span>
        </StatusBox>
      )}

      {wrongChain && <SwitchNote chainName={chain.name} failed={!!switchError} />}
      <Action type="button" disabled={action.disabled} onClick={action.onClick} data-sweep-action>
        {action.label}
      </Action>
    </Card>
  )
}

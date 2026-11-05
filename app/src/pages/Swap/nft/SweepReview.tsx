/* eslint-disable no-restricted-syntax -- a sweep is strictly one at a time, in order */
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { useState } from 'react'
import styled from 'styled-components/macro'
import type { Address, Hash } from 'viem'
import { zeroAddress } from 'viem'
import { useAccount, useBalance, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet, wagmiConfig } from '@/config/wagmi'
import { describeError } from '@/miyamints/errors'

import { Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import type { FillPlan, OsOrder } from './markets'
import { formatAmount, formatPrice, OPENSEA_CHAIN, planFill } from './markets'
import { INPUT_ALIASES, SEAPORT_ADDRESSES, seaportAbi } from './seaport'
import type { ItemState } from './sweep'
import { isWalletRefusal, SWEEP_STATE_WORDS, sweepTotals } from './sweep'
import { Action, Card, Head, Hint, LinkButton, Prose } from './ui'
import { fetchFulfillment, MarketError } from './useMarkets'

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
  .failed {
    color: ${color.danger};
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
type Run = { state: ItemState; hash?: Hash; note?: string }

const eth = (wei: bigint) => `${formatAmount(wei, 18, 5)} ETH`

/**
 * Review, then buy several listings one after another. Every listing goes through planFill first, the same checks as
 * a single buy (Seaport only, this chain, this NFT, to you, fixed price, nothing beyond the signed order); any that
 * fail are left out and shown. The person agrees to one total, which can only go down as listings sell. Each buy is
 * simulated before its wallet prompt, so one that has sold is skipped without a transaction.
 */
export default function SweepReview({
  listings,
  chainId,
  contract,
  title,
  onClose,
  onDone,
}: {
  listings: OsOrder[]
  chainId: SupportedChainId
  contract: Address
  title: string
  onClose: () => void
  onDone: () => void
}) {
  const { address: me, isConnected, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const wrongChain = isConnected && walletChain !== chainId
  const osChain = OPENSEA_CHAIN[chainId]
  const balance = useBalance({ address: me, chainId, query: { enabled: !!me } })

  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [stopWords, setStopWords] = useState<string>()

  // One at a time: the fulfillment route has its own small rate limit.
  const data = useQuery({
    queryKey: ['os-sweep', listings.map((l) => l.hash).join(), me?.toLowerCase()],
    enabled: !!me && !!osChain,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
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
          out.push({
            listing,
            error:
              e instanceof MarketError && e.needsKey
                ? 'In-app buying needs the OpenSea API key.'
                : (e as Error).message,
          })
        }
      }

      return out
    },
  })

  const planned = data.data ?? []
  const good = planned.filter((p): p is Planned & { plan: FillPlan } => !!p.plan)
  const totals = sweepTotals(good.map((p) => p.plan))
  const short = balance.data !== undefined && good.length > 0 && balance.data.value < totals.total
  const set = (hash: string, run: Run) => setRuns((r) => ({ ...r, [hash]: run }))

  const sweep = async () => {
    if (!me) return
    setRunning(true)
    setStopWords(undefined)
    let stopped = false
    for (const { listing, plan } of good) {
      if (stopped) set(listing.hash, { state: 'stopped' })
      else {
        const call = {
          account: me,
          address: plan.to as Address,
          abi: seaportAbi,
          functionName: plan.functionName,
          args: plan.args,
          value: plan.value,
          chainId,
        }
        try {
          set(listing.hash, { state: 'wallet' })
          let request
          try {
            // eslint-disable-next-line no-await-in-loop, @typescript-eslint/no-explicit-any
            ;({ request } = await simulateContract(wagmiConfig, call as any))
          } catch (e) {
            // Sold, cancelled or expired while the sweep ran: no prompt, no transaction, on to the next.
            set(listing.hash, { state: 'gone', note: describeError(e) })
            // eslint-disable-next-line no-continue
            continue
          }

          // eslint-disable-next-line no-await-in-loop
          const hash = await writeContract(wagmiConfig, request)
          set(listing.hash, { state: 'pending', hash })
          // eslint-disable-next-line no-await-in-loop
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
          set(listing.hash, receipt.status === 'success' ? { state: 'bought', hash } : { state: 'failed', hash })
        } catch (e) {
          const words = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || ''
          if (isWalletRefusal(words) || isWalletRefusal((e as Error)?.message || '')) {
            stopped = true
            setStopWords('You stopped the sweep in your wallet. Nothing else will be bought.')
            set(listing.hash, { state: 'stopped' })
          } else set(listing.hash, { state: 'failed', note: describeError(e) })
        }
      }
    }

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
    return { label: `Buy ${good.length} for up to ${eth(totals.total)}`, onClick: sweep }
  })()

  return (
    <Card aria-label="Review your sweep" data-sweep-review>
      <Head>
        <h2>Sweep {title}</h2>
        <LinkButton type="button" onClick={onClose} disabled={running}>
          {finished ? 'Close' : 'Cancel'}
        </LinkButton>
      </Head>

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
                  <dd>{eth(totals.total)}</dd>
                </div>
              </Lines>
              <Hint>
                Each NFT is its own transaction, so your wallet asks once per NFT and gas is paid each time. If one
                sells first it is skipped and you do not pay for it. Stop in your wallet at any point and nothing else
                is bought.
              </Hint>
              {short && (
                <Hint style={{ color: color.warning }}>
                  You have {eth(balance.data!.value)}, before gas. Sweep fewer.
                </Hint>
              )}
            </>
          )}
        </>
      )}

      {data.error && (
        <StatusBox tone="error" role="alert">
          <span>{(data.error as Error).message}</span>
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
          <span>Keep this window open until the sweep finishes.</span>
        </StatusBox>
      )}

      <Action type="button" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </Action>
    </Card>
  )
}

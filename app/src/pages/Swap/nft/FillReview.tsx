import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { erc20Abi, zeroAddress } from 'viem'
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { Eyebrow, Skeleton, StatusBox } from '@/components/Retro'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'
import { bevel, color, space, text } from '@/theme/tokens'

import { erc721Abi } from './abi'
import type { FillPlan, OsOrder } from './markets'
import { formatAmount, OPENSEA_CHAIN, planFill, usesSeaportItself } from './markets'
import { conduitControllerAbi, CONDUIT_CONTROLLER, INPUT_ALIASES, seaportAbi, SEAPORT_ADDRESSES } from './seaport'
import { Action, Card, Head, Hint, LinkButton, Prose, Stat } from './ui'
import { fetchFulfillment, MarketError } from './useMarkets'

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
 * (ERC-20 for token-priced listings, the NFT for offers), then the Seaport call. Every call is simulated before the
 * wallet opens (useTx).
 */
export default function FillReview({
  side,
  order,
  chainId,
  contract,
  tokenId,
  title,
  onClose,
  onDone,
}: {
  side: 'buy' | 'sell'
  order: OsOrder
  chainId: SupportedChainId
  contract: Address
  tokenId: string
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

  const data = useQuery({
    queryKey: ['os-fill', side, order.hash, me?.toLowerCase()],
    enabled: !!me && !!osChain,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
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
      { address: erc20, abi: erc20Abi, functionName: 'allowance', args: [me || zeroAddress, operator || zeroAddress], chainId },
    ],
    query: { enabled: !!erc20 && !!me },
  })
  const [symR, decR, balR, allowR] = tokenReads.data || []
  const nativeBalance = useBalance({ address: me, chainId, query: { enabled: !!me && !!ok?.currency.native } })
  const nftApproved = useReadContract({
    address: contract,
    abi: erc721Abi,
    functionName: 'isApprovedForAll',
    args: [me || zeroAddress, operator || zeroAddress],
    chainId,
    query: { enabled: side === 'sell' && !!me && !!operator },
  })

  const symbol = ok?.currency.native
    ? chain.nativeCurrency.symbol
    : symR?.status === 'success'
    ? String(symR.result).slice(0, 12)
    : order.price.symbol
  const decimals = ok?.currency.native ? 18 : decR?.status === 'success' ? Number(decR.result) : order.price.decimals
  const fmt = (n: bigint) => `${n < 0n ? '−' : ''}${formatAmount(n < 0n ? -n : n, decimals, 6)} ${symbol}`

  const tx = useTx((id) => {
    tokenReads.refetch()
    nftApproved.refetch()
    nativeBalance.refetch()
    if (id === 'fill') onDone()
  })
  useEffect(() => tx.reset(), [order.hash])

  const balance = ok?.currency.native
    ? nativeBalance.data?.value
    : balR?.status === 'success'
    ? (balR.result as bigint)
    : undefined
  const allowance = allowR?.status === 'success' ? (allowR.result as bigint) : undefined
  const needs20 = side === 'buy' && !!erc20 && allowance !== undefined && ok !== undefined && allowance < ok.total
  const needsNft = side === 'sell' && nftApproved.data === false
  const short = side === 'buy' && ok && balance !== undefined && balance < ok.total

  const fill = () =>
    ok &&
    tx.run('fill', {
      address: ok.to as Address,
      abi: seaportAbi,
      functionName: ok.functionName,
      args: ok.args,
      value: ok.value,
      chainId,
    })

  const action = (() => {
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId }) }
    if (tx.tx.phase === 'wallet') return { label: 'Confirm in wallet…', disabled: true }
    if (tx.tx.phase === 'pending') return { label: 'Waiting for the network…', disabled: true }
    if (tx.tx.phase === 'done' && tx.tx.id === 'fill') return { label: side === 'buy' ? 'Bought' : 'Sold', disabled: true }
    if (!ok) return { label: data.isLoading ? 'Getting the order…' : 'Cannot fill here', disabled: true }
    if (!operator) return { label: 'Checking…', disabled: true }
    if (short) return { label: `Not enough ${symbol}`, disabled: true }
    if (needs20)
      return {
        label: `Allow ${symbol} for this buy`,
        step: `Step 1 of 2: let Seaport (OpenSea's contract) take exactly ${fmt(ok.total)}. Then buy.`,
        onClick: () =>
          tx.run('approve', { address: erc20, abi: erc20Abi, functionName: 'approve', args: [operator, ok.total], chainId }),
      }
    if (needsNft)
      return {
        label: `Allow OpenSea to move ${title}`,
        step: `Step 1 of 2: a one-time approval so Seaport can hand this NFT to the bidder. Then sell.`,
        onClick: () =>
          tx.run('approve', { address: contract, abi: erc721Abi, functionName: 'setApprovalForAll', args: [operator, true], chainId }),
      }
    return side === 'buy'
      ? { label: `Buy for ${fmt(ok.total)}`, onClick: fill }
      : { label: `Sell for ${fmt(ok.total)}`, onClick: fill }
  })()

  const err = data.error as Error | null
  const failWords =
    err instanceof MarketError && err.needsKey
      ? 'In-app buying needs the OpenSea API key. Use the OpenSea link instead.'
      : err
      ? err.message
      : plan && !plan.ok
      ? (plan as { error: string }).error
      : undefined

  return (
    <Card aria-label={side === 'buy' ? 'Review your buy' : 'Review your sale'} data-fill-review>
      <Head>
        <h2>{side === 'buy' ? 'Review your buy' : 'Accept this offer'}</h2>
        <LinkButton type="button" onClick={onClose} disabled={tx.busy}>
          Cancel
        </LinkButton>
      </Head>
      <Stat>
        <span>Where</span>
        <strong>OpenSea (Seaport)</strong>
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
              <dd>{fmt(ok.total)}</dd>
            </div>
          </Lines>
          <Hint>
            {side === 'buy'
              ? 'The seller set the price; the fees above come out of it. miyaOS never adds optional creator fees, only what the order requires. Network gas is extra.'
              : 'The fees above come off the offer. miyaOS never adds optional creator fees, only what the order requires. Network gas is extra.'}
          </Hint>
          {short && (
            <Hint style={{ color: color.warning }}>
              You have {fmt(balance!)}. {ok.currency.native ? '' : `Get ${symbol} on the Tokens tab.`}
            </Hint>
          )}
        </>
      ) : null}

      {failWords && (
        <StatusBox tone="error" role="alert">
          <span>{failWords}</span>
        </StatusBox>
      )}

      {tx.tx.phase !== 'idle' && (
        <StatusBox
          tone={tx.tx.phase === 'error' ? 'error' : tx.tx.phase === 'done' ? 'ok' : 'info'}
          role={tx.tx.phase === 'error' ? 'alert' : 'status'}
        >
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
        <Action type="button" disabled={!!action.disabled} onClick={action.onClick} data-fill-action>
          {action.label}
        </Action>
        {'step' in action && action.step && <Hint>{action.step}</Hint>}
      </Buttons>
    </Card>
  )
}

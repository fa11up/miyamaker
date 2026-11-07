import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useDebounce } from 'usehooks-ts'
import type { Address, TransactionReceipt } from 'viem'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { explorerUrl } from '@/config/wagmi'

import { SwapApiError } from './api'
import { ethInUsd, formatUsd } from './board'
import type { SwapChainId, SwapToken } from './constants'
import {
  DEFAULT_PAIR,
  DEFAULT_SLIPPAGE_BPS,
  GAS_HEADROOM_WEI,
  isNative,
  isSwapChain,
  sameAddress,
  SWAP_CHAINS,
} from './constants'
import { FEE_BPS, FEE_CHAIN_IDS, feeApplies, feeFree } from './fee'
import { BigButton, Eyebrow, Panel, Skeleton, StatusBox, Well } from './floor/retro'
import { bevel, color, font, space, text } from './floor/tokens'
import { Body, Toolbar } from './layout'
import { useEthUsd, useTokenUsd } from './MarketBoard'
import { SwitchNote } from './nft/ui'
import {
  APPROVE_FAILED_WORDS,
  CANCELLED_WORDS,
  compactAmount,
  describeTxError,
  impactLevel,
  impactPercent,
  OFFLINE_SWAP_WORDS,
  quoteIsCurrent,
  SWAP_FAILED_WORDS,
  swapStep,
  UNCONFIRMED_WORDS,
} from './swapLogic'
import SwapSettings from './SwapSettings'
import TokenPicker, { TokenLogo } from './TokenPicker'
import type { SwapRequest, ZeroExFee, ZeroExRoute } from './types'
import { priceImpact, usePrice, useReferencePrice, useSwapExecution } from './useSwap'
import { useTokenBalance, useTokenList } from './useTokens'

/* ---------- layout ---------- */

const Side = styled(Panel)`
  gap: ${space[2]};
  padding: ${space[3]};
`

const SideHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  min-height: 28px;
  font-size: ${text.sm};
  color: ${color.inkMuted};
  .bal {
    display: inline-flex;
    align-items: center;
    gap: ${space[2]};
    font-variant-numeric: tabular-nums;
    min-width: 0;
    white-space: nowrap;
  }
  .bal button {
    height: 28px;
    padding: 0 ${space[2]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.xs};
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
    .narrow & {
      height: 36px;
      min-width: 52px;
    }
  }
`

const AmountRow = styled.div`
  display: flex;
  align-items: stretch;
  gap: ${space[2]};
  input,
  output {
    flex: 1;
    min-width: 0;
    height: 56px;
    padding: 0 ${space[3]};
    border: none;
    border-radius: 0;
    font-size: 28px;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: ${color.ink};
    .narrow & {
      font-size: 24px;
      padding: 0 ${space[2]};
    }
  }
  input {
    background: ${color.well};
    box-shadow: ${bevel.field};
  }
  input::placeholder {
    color: ${color.shadow};
  }
  /* A readout, not a field: flat, no inset, so it does not look typeable. */
  output {
    background: ${color.face};
    border: 1px dashed ${color.dark};
  }
  output.empty {
    color: ${color.shadow};
  }
`

const TokenButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  height: 56px;
  min-width: 140px;
  padding: 0 ${space[2]};
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  cursor: pointer;
  font-size: ${text.md};
  font-weight: 700;
  &:hover {
    background: ${color.faceLight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  .caret {
    margin-left: auto;
    font-size: ${text.xs};
  }
  .narrow & {
    min-width: 124px;
  }
`

const FlipRow = styled.div`
  display: flex;
  justify-content: center;
  margin: -${space[4]} 0;
  position: relative;
  z-index: 1;
  button {
    width: 44px;
    height: 44px;
    border: none;
    background: ${color.face};
    box-shadow:
      ${bevel.raised},
      0 0 0 3px ${color.face};
    color: ${color.ink};
    font-size: ${text.lg};
    cursor: pointer;
    &:hover:not(:disabled) {
      background: ${color.faceLight};
    }
    &:active:not(:disabled) {
      box-shadow:
        ${bevel.pressed},
        0 0 0 3px ${color.face};
    }
  }
`

const Details = styled(Well)<{ firm?: boolean }>`
  scroll-margin-bottom: 120px;
  padding: ${space[2]} ${space[3]};
  display: flex;
  flex-direction: column;
  gap: 6px;
  ${({ firm }) => (firm ? `outline: 2px solid ${color.accent}; outline-offset: -2px;` : '')}
`

const DetailsHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  padding-bottom: 6px;
  border-bottom: 1px solid ${color.light};
  button {
    border: none;
    background: none;
    padding: ${space[1]} 0;
    color: ${color.link};
    text-decoration: underline;
    font-size: ${text.sm};
    cursor: pointer;
  }
`

const Line = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space[3]};
  font-size: ${text.sm};
  line-height: 1.3;
  color: ${color.inkMuted};
  > span:first-child {
    flex: none;
  }
  strong {
    color: ${color.ink};
    font-weight: 700;
    text-align: right;
    font-variant-numeric: tabular-nums;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  button.invert {
    border: none;
    background: none;
    padding: 0;
    margin-left: ${space[1]};
    color: ${color.link};
    cursor: pointer;
    font-size: ${text.sm};
  }
`

const FreeTag = styled.span`
  display: inline-block;
  padding: 1px ${space[2]};
  background: ${color.success};
  color: ${color.onAccent};
  font-weight: 700;
`

const Hint = styled.div`
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
`

/* Always there, so a dollar figure arriving does not move the page. */
const Usd = styled.div`
  min-height: 1.4em;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
  font-variant-numeric: tabular-nums;
`

/* The primary action stays reachable while the details scroll (the window is short on desktop too). */
const ActionDock = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  margin: 0 -${space[4]};
  padding: ${space[2]} ${space[4]};
  background: ${color.face};
  box-shadow: inset 0 1px 0 ${color.dark};
  .narrow & {
    margin: 0 -${space[3]};
    padding: ${space[2]} ${space[3]};
  }
`

const Action = styled(BigButton)`
  &:disabled {
    color: ${color.inkMuted};
  }
`

const Receipt = styled(Panel)`
  scroll-margin-bottom: 120px;
  gap: ${space[2]};
  padding: ${space[3]};
  outline: 2px solid ${color.success};
  outline-offset: -2px;
  h2 {
    margin: 0;
    font-size: ${text.lg};
    color: ${color.success};
  }
  .hash {
    font-family: ${font.mono};
    font-size: ${text.xs};
  }
`

const Footer = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
  padding-bottom: ${space[3]};
`

/* ---------- helpers ---------- */

function fmt(value: bigint | string | undefined, decimals: number, max = 6) {
  if (value === undefined) return '–'
  const s = formatUnits(BigInt(value), decimals)
  const [i, d = ''] = s.split('.')
  const int = Number(i).toLocaleString('en-US')
  const frac = d.slice(0, Number(i) >= 1000 ? 2 : Number(i) >= 1 ? Math.min(4, max) : max).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

function safeParse(input: string, decimals: number): bigint | undefined {
  const v = input.trim()
  if (!v || !/^\d*\.?\d*$/.test(v) || v === '.') return undefined
  const [i, d = ''] = v.split('.')
  try {
    return parseUnits(`${i || '0'}.${d.slice(0, decimals)}`, decimals)
  } catch {
    return undefined
  }
}

function rate(sell: SwapToken, buy: SwapToken, sellAmount: string, buyAmount: string, inverted: boolean) {
  const s = Number(formatUnits(BigInt(sellAmount), sell.decimals))
  const b = Number(formatUnits(BigInt(buyAmount), buy.decimals))
  if (!s || !b) return '–'
  const [from, to, r] = inverted ? [buy, sell, s / b] : [sell, buy, b / s]
  const digits = r >= 1000 ? 0 : r >= 0.1 ? 4 : 8
  return `1 ${from.symbol} = ${r.toLocaleString('en-US', { maximumFractionDigits: digits })} ${to.symbol}`
}

const feeText = (fee: ZeroExFee, tokens: SwapToken[]) => {
  if (!fee) return undefined
  const t = tokens.find((x) => sameAddress(x.address, fee.token))
  return t ? `${fmt(fee.amount, t.decimals, 4)} ${t.symbol}` : `${fee.amount} (base units)`
}

const sourceName = (s: string) => s.replace(/_/g, ' ')

function routeText(route: ZeroExRoute | undefined, tokens: SwapToken[]) {
  if (!route?.fills.length) return undefined
  const symbol = (a: string) =>
    tokens.find((t) => sameAddress(t.address, a))?.symbol ||
    route.tokens.find((t) => sameAddress(t.address, a))?.symbol ||
    `${a.slice(0, 6)}…`
  const hops = route.fills.reduce<string[]>((acc, f) => {
    const next = acc.length ? acc : [symbol(f.from)]
    return next[next.length - 1] === symbol(f.to) ? next : [...next, symbol(f.to)]
  }, [])
  const sources = [...new Set(route.fills.map((f) => sourceName(f.source)))]
  return { path: hops.join(' → '), sources: sources.join(', ') }
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** What actually landed in the wallet: the buy token's Transfer logs to the taker (ERC-20 buys only). */
function receivedFromLogs(receipt: TransactionReceipt | undefined, token: SwapToken, taker: Address | undefined) {
  if (!receipt || !taker || isNative(token.address)) return undefined
  const to = `0x${taker.slice(2).toLowerCase().padStart(64, '0')}`
  const transfers = receipt.logs.filter(
    (log) =>
      sameAddress(log.address, token.address) &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2]?.toLowerCase() === to,
  )
  return transfers.length ? transfers.reduce((sum, log) => sum + BigInt(log.data), 0n) : undefined
}

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`

/** "≈ $1,120", or nothing when the token has no price. */
function usdWords(amount: bigint | string | undefined, decimals: number, usd: number | undefined) {
  if (amount === undefined || !usd) return ''
  return `≈ ${formatUsd(Number(formatUnits(BigInt(amount), decimals)) * usd)}`
}

/* ---------- component ---------- */

/** A pair to load into the swap, e.g. a pool token from the NFTs tab. `key` changes each time it is requested. */
export type SwapPreset = { key: number; chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }

/**
 * The swap on Trade's Tokens page, routed by 0x, the engine behind Matcha. Rendered by TokenPage.tsx, inside the Trade window, which owns the title bar,
 * banner and tabs. It stays mounted while the NFTs tab is shown, so a swap in flight is never lost.
 */
export default function TokenSwap({
  chainId,
  onChain,
  onBusy,
  preset,
  onOffline,
}: {
  /** The floor's one network. */
  chainId: SwapChainId
  onChain: (chainId: SwapChainId) => void
  /** Told while a swap is in flight, when the network must not change. */
  onBusy?: (busy: boolean) => void
  preset?: SwapPreset
  /** Told whether the swap service is configured, so the window can show an Offline chip. */
  onOffline?: (offline: boolean) => void
}) {
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  const [sell, setSell] = useState<SwapToken>(DEFAULT_PAIR[chainId][0])
  const [buy, setBuy] = useState<SwapToken>(DEFAULT_PAIR[chainId][1])
  const [input, setInput] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [picker, setPicker] = useState<'sell' | 'buy' | undefined>()
  const [inverted, setInverted] = useState(false)

  // A requested pair waits here while the chain switches, then replaces the chain's default pair.
  const pendingPreset = useRef<SwapPreset>()
  const applyPreset = (p: SwapPreset) => {
    const [defSell, defBuy] = DEFAULT_PAIR[p.chainId]
    const nextSell = p.sell || (p.buy && sameAddress(p.buy.address, defSell.address) ? defBuy : defSell)
    setSell(nextSell)
    setBuy(p.buy || (p.sell && sameAddress(p.sell.address, defSell.address) ? defBuy : defSell))
    setInput('')
  }

  useEffect(() => {
    const p = pendingPreset.current
    pendingPreset.current = undefined
    if (p && p.chainId === chainId) {
      applyPreset(p)
      return
    }

    setSell(DEFAULT_PAIR[chainId][0])
    setBuy(DEFAULT_PAIR[chainId][1])
    setInput('')
  }, [chainId])

  const list = useTokenList(chainId)
  const sellBalance = useTokenBalance(sell, address)
  const buyBalance = useTokenBalance(buy, address)

  const sellAmount = safeParse(input, sell.decimals)
  const debouncedAmount = useDebounce(sellAmount, 400)

  const request: SwapRequest | undefined = useMemo(
    () =>
      debouncedAmount &&
      debouncedAmount > 0n &&
      !sameAddress(sell.address, buy.address) &&
      !sell.blocked &&
      !buy.blocked
        ? {
            chainId,
            sellToken: sell.address,
            buyToken: buy.address,
            sellAmount: debouncedAmount,
            taker: address,
            slippageBps,
          }
        : undefined,
    [chainId, sell, buy, debouncedAmount, address, slippageBps],
  )

  const price = usePrice(request)
  const reference = useReferencePrice(request)
  const exec = useSwapExecution({ chainId, taker: address })
  // Sent, and its ending couldn't be read: it may still land, so nothing changes until someone starts over.
  const stuck = exec.unconfirmed || exec.approveUnconfirmed

  // Any change to the trade invalidates a reviewed quote.
  useEffect(() => {
    // Never while something is out with the wallet: that would forget a transaction that can still send.
    if (!exec.swapHash && !exec.awaitingWallet && !exec.confirming && !exec.approving && !stuck) exec.reset()
  }, [request?.sellAmount, request?.sellToken, request?.buyToken, request?.taker, slippageBps, chainId])

  useEffect(() => {
    if (exec.confirmed || exec.reverted) {
      sellBalance.refetch()
      buyBalance.refetch()
    }
  }, [exec.confirmed, exec.reverted])

  const priceData = price.data?.liquidityAvailable ? price.data : undefined
  const refData = reference.data?.liquidityAvailable ? reference.data : undefined
  const typing = sellAmount !== debouncedAmount
  const apiError = (price.error || exec.quoteError) as SwapApiError | Error | undefined
  const notConfigured = apiError instanceof SwapApiError && apiError.notConfigured
  useEffect(() => onOffline?.(!!notConfigured), [notConfigured])
  const noLiquidity = price.data && !price.data.liquidityAvailable
  const balanceIssue = priceData?.issues.balance
  const insufficient =
    (sellAmount !== undefined && sellBalance.value !== undefined && sellAmount > sellBalance.value) || !!balanceIssue
  const wrongChain = isConnected && walletChainId !== chainId
  const chainName = SWAP_CHAINS.find((c) => c.id === chainId)!.name
  const explorer = explorerUrl(chainId)
  const explorerName = chainId === 1 ? 'Etherscan' : 'the explorer'

  const setMax = () => {
    if (sellBalance.value === undefined) return
    const value = isNative(sell.address)
      ? sellBalance.value > GAS_HEADROOM_WEI[chainId]
        ? sellBalance.value - GAS_HEADROOM_WEI[chainId]
        : 0n
      : sellBalance.value
    setInput(formatUnits(value, sell.decimals))
  }

  const flip = () => {
    setSell(buy)
    setBuy(sell)
    setInput('')
  }

  const choose = (side: 'sell' | 'buy', token: SwapToken) => {
    if (token.blocked) return
    if (side === 'sell') {
      if (sameAddress(token.address, buy.address)) setBuy(sell)
      setSell(token)
    } else {
      if (sameAddress(token.address, sell.address)) setSell(buy)
      setBuy(token)
    }
  }

  const knownTokens = useMemo(() => [...list.tokens, sell, buy], [list.tokens, sell, buy])
  const { firm } = exec
  const amountIsCurrent = quoteIsCurrent(exec.quoteState?.request, {
    chainId,
    sellToken: sell.address,
    buyToken: buy.address,
    sellAmount,
    slippageBps,
    taker: address,
  })
  const sellUsd = useTokenUsd(sell)
  const buyUsd = useTokenUsd(buy)
  const ethUsd = useEthUsd()
  const busy = exec.quoting || exec.approving || exec.awaitingWallet || exec.confirming
  const locked = busy || !!exec.swapHash || stuck
  useEffect(() => onBusy?.(locked), [locked])
  const done = exec.confirmed

  // A pair asked for by the page. It waits while a swap is in flight, so the panel can't be left on the old token, and
  // clears a finished one.
  const appliedPreset = useRef<number>()
  useEffect(() => {
    if (!preset || busy || stuck || appliedPreset.current === preset.key) return
    appliedPreset.current = preset.key
    if (exec.swapHash) exec.reset()
    if (preset.chainId === chainId) applyPreset(preset)
    else {
      pendingPreset.current = preset
      onChain(preset.chainId)
    }
  }, [preset?.key, busy, stuck])

  // Bring the review and the receipt into view: the window is short and the action dock covers the bottom.
  const detailsRef = useRef<HTMLDivElement>(null)
  const receiptRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (firm) detailsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [!!firm])
  useEffect(() => {
    if (done) receiptRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [done])

  const newSwap = () => {
    exec.reset()
    setInput('')
  }

  const shown = firm || priceData
  const buyDisplay = shown?.buyAmount
  const impact = priceImpact(shown, refData)
  const impactIs = impactLevel(impact)

  const action = (() => {
    // What is under way or just ended comes first: nothing about the price, the balance or the network outranks it.
    if (exec.awaitingWallet) return { label: 'Confirm in wallet…', disabled: true }
    if (exec.confirming) return { label: 'Swapping…', disabled: true }
    if (exec.approving)
      return { label: `${exec.approvingReset ? 'Resetting' : 'Approving'} ${sell.symbol}…`, disabled: true }
    if (done) return { label: 'New swap', className: 'secondary', onClick: newSwap }
    if (exec.reverted || exec.cancelled) return { label: 'Try again', className: 'secondary', onClick: newSwap }
    // It may yet land, so the same step is not offered again: only a clean start, after the warning above the button.
    if (stuck) return { label: 'Start over', className: 'secondary', onClick: newSwap }
    if (notConfigured) return { label: 'Swap unavailable', disabled: true }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chainName}`, onClick: () => switchChain({ chainId }) }
    if (!sellAmount) return { label: 'Enter an amount', disabled: true }
    if (insufficient) return { label: `Not enough ${sell.symbol}`, disabled: true }
    if ((typing || price.isFetching) && !priceData) return { label: 'Finding best price…', disabled: true }
    if (noLiquidity) return { label: 'No route for this pair', disabled: true }
    if (!firm) {
      return {
        label: exec.quoting ? 'Getting firm quote…' : typing ? 'Updating price…' : 'Review swap',
        disabled: exec.quoting || typing || !request || !priceData,
        onClick: () => request && exec.getQuote(request),
      }
    }

    // The field no longer says what this quote is for. Compared before the debounce, so no key press leaves it armed.
    if (!amountIsCurrent) return { label: 'Updating price…', disabled: true }

    const paying = `${fmt(firm.sellAmount, sell.decimals)} ${sell.symbol}`
    const step = swapStep({
      needsApproval: exec.needsApproval,
      needsReset: exec.needsAllowanceReset,
      didReset: exec.didReset,
      didApprove: exec.didApprove,
      batches: exec.canBatch,
    })
    const numbered = step.at ? `Step ${step.at} of ${step.of}: ` : ''
    if (step.stage === 'reset')
      return {
        label: `Reset ${sell.symbol} allowance`,
        step: `${numbered}set your old ${sell.symbol} allowance for 0x to 0. This token needs that first.`,
        onClick: exec.approve,
      }
    if (step.stage === 'approve')
      return {
        label: `Approve ${paying}`,
        step: `${numbered}let 0x, the swap router, spend exactly ${paying}. Then swap.`,
        onClick: exec.approve,
      }
    const getting = compactAmount(Number(formatUnits(BigInt(firm.buyAmount), buy.decimals)))
    return {
      label: exec.quoting
        ? 'Refreshing quote…'
        : impactIs === 'high'
          ? `Swap anyway at -${impactPercent(impact!)}%`
          : `Swap ${paying} for about ${getting} ${buy.symbol}`,
      step:
        step.stage === 'batch'
          ? `One signature: lets 0x, the swap router, spend exactly ${paying} and swaps, all or nothing.`
          : step.at
            ? `${numbered}swap.`
            : undefined,
      disabled: exec.quoting,
      onClick: exec.swap,
    }
  })()

  const route = routeText(shown?.route, knownTokens)
  const noFee = feeFree(sell.address, buy.address)
  const feeChain = FEE_CHAIN_IDS.includes(chainId)
  const txError = describeTxError(exec.swapError || exec.approveError)
  const received = receivedFromLogs(exec.swapReceipt, buy, address)

  return (
    <>
      <Body>
        <Toolbar>
          <span style={{ flex: 1, fontSize: text.sm, color: color.inkMuted }} data-swap-title>
            Swap on {chainName}: buying {buy.symbol}
          </span>
          <SwapSettings slippageBps={slippageBps} onChange={setSlippageBps} disabled={locked} />
        </Toolbar>

        {notConfigured && (
          <StatusBox tone="error" role="alert">
            <span>{OFFLINE_SWAP_WORDS}</span>
          </StatusBox>
        )}

        <Side aria-label="You pay">
          <SideHead>
            <Eyebrow>You pay</Eyebrow>
            <span className="bal">
              {address && <>Balance {sellBalance.value !== undefined ? fmt(sellBalance.value, sell.decimals) : '–'}</>}
              {sellBalance.value !== undefined && sellBalance.value > 0n && !locked && (
                <button
                  type="button"
                  onClick={setMax}
                  title={isNative(sell.address) ? 'Keeps a little ETH for gas' : undefined}
                >
                  Max
                </button>
              )}
            </span>
          </SideHead>
          <AmountRow>
            <input
              inputMode="decimal"
              placeholder="0"
              value={input}
              aria-label={`Amount of ${sell.symbol} to pay`}
              onChange={(e) => {
                const v = e.target.value.replace(',', '.')
                if (/^\d*\.?\d*$/.test(v)) setInput(v)
              }}
              disabled={locked}
              data-swap-input
            />
            <TokenButton
              type="button"
              onClick={() => setPicker('sell')}
              aria-label={`Pay with ${sell.symbol}. Change token`}
              disabled={locked}
            >
              <TokenLogo token={sell} size={28} />
              {sell.symbol}
              <span className="caret">▼</span>
            </TokenButton>
          </AmountRow>
          <Usd data-swap-sell-usd>{usdWords(sellAmount, sell.decimals, sellUsd)}</Usd>
          {sell.unverified && <Hint style={{ color: color.warning }}>Not verified: check the address.</Hint>}
        </Side>

        <FlipRow>
          <button type="button" aria-label="Flip: pay with the other token" onClick={flip} disabled={locked}>
            ⇅
          </button>
        </FlipRow>

        <Side aria-label="You get">
          <SideHead>
            <Eyebrow>You get{shown && !firm ? ' (about)' : ''}</Eyebrow>
            {address && (
              <span className="bal">
                Balance {buyBalance.value !== undefined ? fmt(buyBalance.value, buy.decimals) : '–'}
              </span>
            )}
          </SideHead>
          <AmountRow>
            {sellAmount && (price.isLoading || typing) && !buyDisplay ? (
              <output>
                <Skeleton h="24px" w="60%" />
              </output>
            ) : (
              <output aria-live="polite" className={buyDisplay ? undefined : 'empty'} data-swap-output>
                {buyDisplay ? fmt(buyDisplay, buy.decimals) : '0'}
              </output>
            )}
            <TokenButton
              type="button"
              onClick={() => setPicker('buy')}
              aria-label={`Get ${buy.symbol}. Change token`}
              disabled={locked}
            >
              <TokenLogo token={buy} size={28} />
              {buy.symbol}
              <span className="caret">▼</span>
            </TokenButton>
          </AmountRow>
          <Usd data-swap-buy-usd>{usdWords(buyDisplay, buy.decimals, buyUsd)}</Usd>
          {buy.unverified && <Hint style={{ color: color.warning }}>Not verified: check the address.</Hint>}
        </Side>

        {shown && !done && (
          <Details ref={detailsRef} firm={!!firm} aria-label={firm ? 'Review swap' : 'Price details'} data-swap-details>
            {firm && (
              <DetailsHead>
                <Eyebrow>Review: firm quote</Eyebrow>
                {!exec.swapHash && !busy && (
                  <button type="button" onClick={exec.reset}>
                    Edit
                  </button>
                )}
              </DetailsHead>
            )}
            {firm && (
              <Line data-swap-pay-line>
                <span>You pay</span>
                <strong>
                  {fmt(firm.sellAmount, sell.decimals)} {sell.symbol}
                </strong>
              </Line>
            )}
            <Line>
              <span>Rate</span>
              <strong>
                {rate(sell, buy, shown.sellAmount, shown.buyAmount, inverted)}
                <button
                  type="button"
                  className="invert"
                  aria-label="Show the rate the other way"
                  onClick={() => setInverted((v) => !v)}
                >
                  ⇄
                </button>
              </strong>
            </Line>
            <Line>
              <span>Price impact</span>
              <strong
                style={
                  impactIs === 'high'
                    ? { color: color.danger }
                    : impactIs === 'notable'
                      ? { color: color.warning }
                      : undefined
                }
              >
                {impact === undefined ? 'Unknown' : impact < 0.0001 ? 'under 0.01%' : `${(impact * 100).toFixed(2)}%`}
                {impactIs === 'high' ? ' (high)' : ''}
              </strong>
            </Line>
            <Line>
              <span>Minimum received</span>
              <strong>
                {fmt(shown.minBuyAmount, buy.decimals)} {buy.symbol}
              </strong>
            </Line>
            <Line>
              <span>miyamaker fee</span>
              <strong>
                {noFee ? (
                  <FreeTag>No fee on imdUSD pairs</FreeTag>
                ) : feeApplies(chainId, sell.address, buy.address) ? (
                  firm?.fees.integratorFee ? (
                    `${FEE_BPS / 100}% (${feeText(firm.fees.integratorFee, knownTokens)}, included)`
                  ) : (
                    `${FEE_BPS / 100}%, included`
                  )
                ) : (
                  'None'
                )}
              </strong>
            </Line>
            {firm?.fees.zeroExFee && (
              <Line>
                <span>0x fee</span>
                <strong>{feeText(firm.fees.zeroExFee, knownTokens)}</strong>
              </Line>
            )}
            <Line>
              <span>Network fee</span>
              <strong>
                {shown.totalNetworkFee
                  ? `about ${fmt(shown.totalNetworkFee, 18, 5)} ETH ${ethInUsd(BigInt(shown.totalNetworkFee), ethUsd)}`
                  : '–'}
              </strong>
            </Line>
            {route && (
              <Line>
                <span>Route</span>
                <strong>
                  {route.path}
                  <br />
                  <span style={{ fontWeight: 400, color: color.inkMuted }}>via {route.sources}</span>
                </strong>
              </Line>
            )}
            {feeChain && !noFee && <Hint>Tip: swaps with imdUSD on either side have no miyamaker fee.</Hint>}
          </Details>
        )}

        {apiError && !notConfigured && (
          <StatusBox tone="error" role="alert">
            <span>{describeTxError(apiError).message}</span>
          </StatusBox>
        )}
        {noLiquidity && (
          <StatusBox tone="error" role="alert">
            <span>No route for this pair on {chainName}. Try another token or amount.</span>
          </StatusBox>
        )}
        {balanceIssue && (
          <StatusBox tone="error" role="alert">
            <span>
              Not enough {sell.symbol}: you have {fmt(balanceIssue.actual, sell.decimals)}, this trade needs{' '}
              {fmt(balanceIssue.expected, sell.decimals)}.
            </span>
          </StatusBox>
        )}

        {done && (
          <Receipt ref={receiptRef} aria-label="Swap receipt" role="status" data-swap-receipt>
            <h2>Swap complete</h2>
            <Line>
              <span>You paid</span>
              <strong>
                {fmt(firm?.sellAmount, sell.decimals)} {sell.symbol}
              </strong>
            </Line>
            <Line>
              <span>{received !== undefined ? 'You got' : 'You got (expected)'}</span>
              <strong>
                {fmt(received ?? firm?.buyAmount, buy.decimals)} {buy.symbol}
              </strong>
            </Line>
            {/* A batch wallet may finish without naming a transaction. */}
            {exec.swapHash && (
              <>
                <Line>
                  <span>Transaction</span>
                  <strong className="hash">{shortHash(exec.swapHash)}</strong>
                </Line>
                <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                  View on {explorerName} ↗
                </a>
              </>
            )}
          </Receipt>
        )}

        {exec.requoted && firm && !busy && !exec.swapHash && (
          <StatusBox tone="info" role="status">
            <span>
              The quote was over 30 seconds old, so we fetched a new one. Check the amounts, then press Swap again.
            </span>
          </StatusBox>
        )}
        {exec.approveHash && exec.approving && (
          <StatusBox tone="info" role="status">
            <img src={LoadingHourglass} alt="" />
            <span>
              Approval sent.{' '}
              <a href={`${explorer}/tx/${exec.approveHash}`} target="_blank" rel="noreferrer">
                View on {explorerName}
              </a>
            </span>
          </StatusBox>
        )}
        {exec.awaitingWallet && (
          <StatusBox tone="info" role="status">
            <img src={LoadingHourglass} alt="" />
            <span>Confirm the swap in your wallet.</span>
          </StatusBox>
        )}
        {exec.confirming && (
          <StatusBox tone="info" role="status">
            <img src={LoadingHourglass} alt="" />
            <span>
              Swap sent. Waiting for the network.{' '}
              {exec.swapHash && (
                <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                  View on {explorerName}
                </a>
              )}
            </span>
          </StatusBox>
        )}
        {(exec.approveReverted || exec.approveUnconfirmed) && !busy && (
          <StatusBox tone="error" role="alert">
            <span>
              {exec.approveReverted ? APPROVE_FAILED_WORDS : UNCONFIRMED_WORDS}{' '}
              {exec.approveHash && (
                <a href={`${explorer}/tx/${exec.approveHash}`} target="_blank" rel="noreferrer">
                  View on {explorerName}
                </a>
              )}
            </span>
          </StatusBox>
        )}
        {(exec.approveCancelled || exec.cancelled) && !busy && (
          <StatusBox tone="info" role="status" data-swap-cancelled>
            <span>{CANCELLED_WORDS}</span>
          </StatusBox>
        )}
        {!!(exec.swapError || exec.approveError) && !busy && (
          <StatusBox tone={txError.cancelled ? 'info' : 'error'} role="alert">
            <span>{txError.message}</span>
          </StatusBox>
        )}

        {/* In the dock, not the page: the window is short, and these must not hide behind the button they are about. */}
        <ActionDock>
          {shown && !done && impactIs === 'high' && (
            <StatusBox tone="error" role="alert" data-swap-impact>
              <span>
                This trade moves the price {impactPercent(impact!)}%, so you get much less than the market price. Try a
                smaller amount.
              </span>
            </StatusBox>
          )}
          {shown && !done && impactIs === 'unknown' && !reference.isFetching && (
            <StatusBox tone="info" role="status" data-swap-impact>
              <span>Price impact unknown. Check the amounts.</span>
            </StatusBox>
          )}
          {(exec.reverted || exec.unconfirmed) && (
            <StatusBox tone="error" role="alert" data-swap-failed>
              <span>
                {exec.reverted ? SWAP_FAILED_WORDS : UNCONFIRMED_WORDS}{' '}
                {exec.swapHash && (
                  <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                    View on {explorerName}
                  </a>
                )}
              </span>
            </StatusBox>
          )}
          {wrongChain && <SwitchNote chainName={chainName} failed={!!switchError} />}
          <Action
            type="button"
            className={'className' in action ? action.className : undefined}
            disabled={!!action.disabled}
            onClick={'onClick' in action ? action.onClick : undefined}
            data-swap-action
          >
            {action.label}
          </Action>
          {'step' in action && action.step && <Hint>{action.step}</Hint>}
        </ActionDock>

        <Footer>Best price from Matcha.{isNative(sell.address) ? '' : ' You approve only the amount you swap.'}</Footer>
      </Body>

      {picker && (
        <TokenPicker
          chainId={chainId}
          side={picker}
          tokens={list.tokens}
          loading={list.isLoading}
          listError={list.isError}
          selected={picker === 'sell' ? sell : buy}
          onSelect={(t) => {
            choose(picker, t)
            setPicker(undefined)
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
    </>
  )
}

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useDebounce } from 'usehooks-ts'
import type { Address, TransactionReceipt } from 'viem'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Eyebrow, Panel, Skeleton, StatusBox, Well } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { SwapApiError } from './api'
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
import { Body, ChainTabs, Toolbar } from './layout'
import SwapSettings from './SwapSettings'
import { quickPicks } from './tokenList'
import TokenPicker, { TokenLogo } from './TokenPicker'
import type { SwapRequest, ZeroExFee, ZeroExRoute } from './types'
import { describeTxError, priceImpact, usePrice, useReferencePrice, useSwapExecution } from './useSwap'
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
    background: rgba(255, 255, 255, 0.35);
    border: 1px dashed ${color.shadow};
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

const Picks = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  button {
    display: inline-flex;
    align-items: center;
    gap: ${space[1]};
    height: 30px;
    padding: 0 6px 0 ${space[1]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.xs};
    cursor: pointer;
    &:hover {
      background: ${color.faceLight};
    }
    .narrow & {
      height: 40px;
      font-size: ${text.sm};
    }
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.light};
    font-weight: 700;
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
    box-shadow: ${bevel.raised}, 0 0 0 3px ${color.face};
    color: ${color.ink};
    font-size: ${text.lg};
    cursor: pointer;
    &:hover:not(:disabled) {
      background: ${color.faceLight};
    }
    &:active:not(:disabled) {
      box-shadow: ${bevel.pressed}, 0 0 0 3px ${color.face};
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
  color: ${color.highlight};
  font-weight: 700;
`

const Hint = styled.div`
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
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
  box-shadow: inset 0 1px 0 ${color.highlight}, 0 -2px 0 ${color.shadow};
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
      sameAddress(log.address, token.address) && log.topics[0] === TRANSFER_TOPIC && log.topics[2]?.toLowerCase() === to
  )
  return transfers.length ? transfers.reduce((sum, log) => sum + BigInt(log.data), 0n) : undefined
}

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`

/* ---------- component ---------- */

/** A pair to load into the swap, e.g. a pool token from the NFTs tab. `key` changes each time it is requested. */
export type SwapPreset = { key: number; chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }

/**
 * The Tokens tab of Trade: the 0x swap. Rendered inside the Trade window (index.tsx), which owns the title bar,
 * banner and tabs. It stays mounted while the NFTs tab is shown, so a swap in flight is never lost.
 */
export default function TokenSwap({
  preset,
  onOffline,
}: {
  preset?: SwapPreset
  /** Told whether the swap service is configured, so the window can show an Offline chip. */
  onOffline?: (offline: boolean) => void
}) {
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  const [chainId, setChainId] = useState<SwapChainId>(isSwapChain(walletChainId) ? walletChainId : 1)
  const [sell, setSell] = useState<SwapToken>(DEFAULT_PAIR[chainId][0])
  const [buy, setBuy] = useState<SwapToken>(DEFAULT_PAIR[chainId][1])
  const [input, setInput] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [picker, setPicker] = useState<'sell' | 'buy' | undefined>()
  const [inverted, setInverted] = useState(false)

  // Follow the wallet onto a supported chain.
  useEffect(() => {
    if (isSwapChain(walletChainId) && walletChainId !== chainId) setChainId(walletChainId)
  }, [walletChainId])

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
    [chainId, sell, buy, debouncedAmount, address, slippageBps]
  )

  const price = usePrice(request)
  const reference = useReferencePrice(request)
  const exec = useSwapExecution({ chainId, taker: address })

  // Any change to the trade invalidates a reviewed quote.
  useEffect(() => {
    if (!exec.swapHash) exec.reset()
  }, [request?.sellAmount, request?.sellToken, request?.buyToken, slippageBps, chainId])

  useEffect(() => {
    if (exec.confirmed) {
      sellBalance.refetch()
      buyBalance.refetch()
    }
  }, [exec.confirmed])

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
  const busy = exec.quoting || exec.approving || exec.awaitingWallet || exec.confirming
  const locked = busy || !!exec.swapHash
  const done = exec.confirmed

  // A pair asked for by the NFTs tab. Ignored while a swap is in flight; clears a finished one.
  useEffect(() => {
    if (!preset || busy) return
    if (exec.swapHash) exec.reset()
    if (preset.chainId === chainId) applyPreset(preset)
    else {
      pendingPreset.current = preset
      setChainId(preset.chainId)
    }
  }, [preset?.key])

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

  const action = (() => {
    if (notConfigured) return { label: 'Swap unavailable', disabled: true }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chainName}`, onClick: () => switchChain({ chainId }) }
    if (done) return { label: 'New swap', className: 'secondary', onClick: newSwap }
    if (!sellAmount) return { label: 'Enter an amount', disabled: true }
    if (insufficient) return { label: `Not enough ${sell.symbol}`, disabled: true }
    if ((typing || price.isFetching) && !priceData) return { label: 'Finding best price…', disabled: true }
    if (noLiquidity) return { label: 'No route for this pair', disabled: true }
    if (!firm) {
      return {
        label: exec.quoting ? 'Getting firm quote…' : 'Review swap',
        disabled: exec.quoting || !request || !priceData,
        onClick: () => request && exec.getQuote(request),
      }
    }

    if (exec.needsApproval)
      return {
        label: exec.approving
          ? `Approving ${sell.symbol}…`
          : exec.needsAllowanceReset
          ? `Reset ${sell.symbol} allowance`
          : `Approve ${sell.symbol}`,
        step: exec.needsAllowanceReset
          ? `Step 1 of 3: set the old ${sell.symbol} allowance to 0 (this token needs it).`
          : `Step 1 of 2: approve exactly ${fmt(firm.sellAmount, sell.decimals)} ${
              sell.symbol
            } for 0x (AllowanceHolder). Then swap.`,
        disabled: exec.approving,
        onClick: exec.approve,
      }
    if (exec.awaitingWallet) return { label: 'Confirm in wallet…', disabled: true }
    if (exec.confirming) return { label: 'Swapping…', disabled: true }
    if (exec.reverted) return { label: 'Try again', className: 'secondary', onClick: newSwap }
    return {
      label: exec.quoting ? 'Refreshing quote…' : 'Swap',
      step: isNative(sell.address) ? undefined : 'Step 2 of 2: swap.',
      disabled: exec.quoting,
      onClick: exec.swap,
    }
  })()

  const shown = firm || priceData
  const buyDisplay = shown?.buyAmount
  const impact = priceImpact(shown, refData)
  const route = routeText(shown?.route, knownTokens)
  const noFee = feeFree(sell.address, buy.address)
  const feeChain = FEE_CHAIN_IDS.includes(chainId)
  const txError = describeTxError(exec.swapError || exec.approveError)
  const picks = (quickPicks(chainId) as SwapToken[]).filter((t) => !sameAddress(t.address, sell.address))
  const received = receivedFromLogs(exec.swapReceipt, buy, address)

  return (
    <>
      <Body>
        <Toolbar>
          <ChainTabs role="group" aria-label="Network">
            {SWAP_CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === chainId}
                onClick={() => setChainId(c.id)}
                disabled={locked}
              >
                {c.name}
              </button>
            ))}
          </ChainTabs>
          <SwapSettings slippageBps={slippageBps} onChange={setSlippageBps} disabled={locked} />
        </Toolbar>

        {notConfigured && (
          <StatusBox tone="error" role="alert">
            <span>
              Swaps are offline. The site owner needs to set <code>ZEROX_API_KEY</code> on the server.
            </span>
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
              disabled={locked && !!firm}
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
          {sell.unverified && <Hint style={{ color: color.warning }}>Unverified token: check the address.</Hint>}
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
          {buy.unverified && <Hint style={{ color: color.warning }}>Unverified token: check the address.</Hint>}
          {picks.length > 1 && !firm && !done && (
            <Picks role="group" aria-label="Quick pick a token to get">
              {picks.map((t) => (
                <button
                  key={t.address}
                  type="button"
                  aria-pressed={sameAddress(t.address, buy.address)}
                  onClick={() => choose('buy', t)}
                  disabled={locked}
                  data-pick={t.symbol}
                >
                  <TokenLogo token={t} size={18} />
                  {t.symbol}
                </button>
              ))}
            </Picks>
          )}
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
                  impact !== undefined && impact >= 0.05
                    ? { color: color.danger }
                    : impact !== undefined && impact >= 0.02
                    ? { color: color.warning }
                    : undefined
                }
              >
                {impact === undefined ? '–' : impact < 0.0001 ? 'under 0.01%' : `${(impact * 100).toFixed(2)}%`}
                {impact !== undefined && impact >= 0.05 ? ' (high)' : ''}
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
              <strong>{shown.totalNetworkFee ? `about ${fmt(shown.totalNetworkFee, 18, 5)} ETH` : '–'}</strong>
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
            <span>{apiError.message}</span>
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

        {done && exec.swapHash && (
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
            <Line>
              <span>Transaction</span>
              <strong className="hash">{shortHash(exec.swapHash)}</strong>
            </Line>
            <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
              View on {explorerName} ↗
            </a>
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
              <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                View on {explorerName}
              </a>
            </span>
          </StatusBox>
        )}
        {(exec.reverted || ((exec.swapError || exec.approveError) && !busy)) && (
          <StatusBox tone={txError.cancelled ? 'info' : 'error'} role="alert">
            <span>
              {exec.reverted ? 'The swap reverted. Your tokens were not traded.' : txError.message}{' '}
              {exec.swapHash && (
                <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                  View on {explorerName}
                </a>
              )}
            </span>
          </StatusBox>
        )}

        <ActionDock>
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

        <Footer>
          Prices from 0x on {chainName}. You approve only 0x AllowanceHolder, and only the amount you swap.
        </Footer>
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

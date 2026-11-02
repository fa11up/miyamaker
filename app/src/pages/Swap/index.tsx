import { useConnectModal } from '@rainbow-me/rainbowkit'
import SwapBanner from 'assets/SwapBanner.jpg'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import { useDebounce, useElementSize } from 'usehooks-ts'
import type { Address } from 'viem'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Chip, Eyebrow, Panel, Skeleton, StatusBox, Well } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
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
  SLIPPAGE_MAX_BPS,
  SLIPPAGE_MIN_BPS,
  SLIPPAGE_PRESETS_BPS,
  SWAP_CHAINS,
} from './constants'
import { FEE_BPS, feeApplies, feeFree } from './fee'
import TokenPicker, { TokenLogo } from './TokenPicker'
import type { SwapRequest, ZeroExFee } from './types'
import { describeTxError, usePrice, useSwapExecution } from './useSwap'
import { useTokenBalance, useTokenList } from './useTokens'

const page = Pages.swap

/* ---------- layout ---------- */

const Root = styled.div`
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: linear-gradient(180deg, #2a2350 0%, #6f6894 220px, ${color.face} 221px);
`

const Banner = styled.div`
  position: relative;
  height: 132px;
  background: url(${SwapBanner}) center 62% / cover no-repeat;
  image-rendering: pixelated;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space[2]};
  padding: ${space[3]} ${space[4]};
  .narrow & {
    height: 104px;
    padding: ${space[2]} ${space[3]};
  }
  h1 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xl};
    color: ${color.highlight};
    text-shadow: 2px 2px 0 ${color.dark};
    .narrow & {
      font-size: ${text.lg};
    }
  }
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[4]};
  max-width: 560px;
  margin: 0 auto;
  .narrow & {
    padding: ${space[3]};
  }
`

const ChainTabs = styled.div`
  display: flex;
  gap: 2px;
  button {
    flex: 1;
    min-height: 32px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${space[1]};
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.well};
    font-weight: 700;
  }
`

const AmountPanel = styled(Panel)`
  gap: ${space[2]};
  padding: ${space[3]};
`

const AmountRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  input,
  output {
    flex: 1;
    min-width: 0;
    height: 48px;
    padding: 0 ${space[2]};
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  output {
    color: ${color.ink};
  }
`

const TokenButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  height: 48px;
  min-width: 132px;
  padding: 0 ${space[2]};
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  cursor: pointer;
  font-size: ${text.md};
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
    min-width: 112px;
  }
`

const Meta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  font-size: ${text.sm};
  color: ${color.inkMuted};
  button {
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    padding: 2px ${space[2]};
    font-size: ${text.xs};
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
`

const FlipRow = styled.div`
  display: flex;
  justify-content: center;
  margin: -${space[2]} 0;
  position: relative;
  z-index: 1;
  button {
    width: 40px;
    height: 32px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    font-size: ${text.md};
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
`

const Line = styled.div`
  display: flex;
  justify-content: space-between;
  gap: ${space[2]};
  font-size: ${text.sm};
  line-height: 1.3;
  color: ${color.inkMuted};
  strong {
    color: ${color.ink};
    font-weight: 700;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

const Settings = styled(Well)`
  padding: ${space[2]} ${space[3]};
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${space[2]};
  font-size: ${text.sm};
  button {
    min-width: 48px;
    height: 28px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
    font-size: ${text.xs};
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    font-weight: 700;
  }
  input {
    width: 64px;
    height: 28px;
    padding: 0 ${space[1]};
    border: none;
    background: ${color.highlight};
    box-shadow: ${bevel.field};
    font-size: ${text.xs};
    text-align: right;
  }
`

/* On phones the primary action stays reachable while the review details scroll. */
const ActionDock = styled.div`
  .narrow & {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin: 0 -${space[3]};
    padding: ${space[2]} ${space[3]};
    background: ${color.face};
    box-shadow: inset 0 1px 0 ${color.highlight}, 0 -2px 0 ${color.shadow};
  }
`

const Review = styled(Panel)`
  gap: ${space[2]};
  outline: 2px solid ${color.accent};
  outline-offset: -2px;
`

/* ---------- helpers ---------- */

function fmt(value: bigint | string | undefined, decimals: number, max = 6) {
  if (value === undefined) return '–'
  const s = formatUnits(BigInt(value), decimals)
  const [i, d = ''] = s.split('.')
  const int = Number(i).toLocaleString('en-US')
  const frac = d.slice(0, Number(i) >= 1000 ? 2 : max).replace(/0+$/, '')
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

function rate(sell: SwapToken, buy: SwapToken, sellAmount: string, buyAmount: string) {
  const s = Number(formatUnits(BigInt(sellAmount), sell.decimals))
  const b = Number(formatUnits(BigInt(buyAmount), buy.decimals))
  if (!s || !b) return '–'
  const r = b / s
  const digits = r >= 1000 ? 0 : r >= 1 ? 4 : 8
  return `1 ${sell.symbol} = ${r.toLocaleString('en-US', { maximumFractionDigits: digits })} ${buy.symbol}`
}

const feeText = (fee: ZeroExFee, tokens: SwapToken[]) => {
  if (!fee) return undefined
  const t = tokens.find((x) => sameAddress(x.address, fee.token))
  return t ? `${fmt(fee.amount, t.decimals)} ${t.symbol}` : `${fee.amount} (base units)`
}

/* ---------- component ---------- */

export default function SwapPage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('swap')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'swap' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'swap' }))

  const [rootRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 520

  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  const [chainId, setChainId] = useState<SwapChainId>(isSwapChain(walletChainId) ? walletChainId : 1)
  const [sell, setSell] = useState<SwapToken>(DEFAULT_PAIR[chainId][0])
  const [buy, setBuy] = useState<SwapToken>(DEFAULT_PAIR[chainId][1])
  const [input, setInput] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [customSlippage, setCustomSlippage] = useState('')
  const customSlippageBps = Math.round(Number(customSlippage) * 100)
  const customSlippageInvalid =
    customSlippage !== '' && !(customSlippageBps >= SLIPPAGE_MIN_BPS && customSlippageBps <= SLIPPAGE_MAX_BPS)
  const [picker, setPicker] = useState<'sell' | 'buy' | undefined>()

  // Follow the wallet onto a supported chain.
  useEffect(() => {
    if (isSwapChain(walletChainId) && walletChainId !== chainId) setChainId(walletChainId)
  }, [walletChainId])

  useEffect(() => {
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
      debouncedAmount && debouncedAmount > 0n && !sameAddress(sell.address, buy.address)
        ? { chainId, sellToken: sell.address, buyToken: buy.address, sellAmount: debouncedAmount, taker: address, slippageBps }
        : undefined,
    [chainId, sell.address, buy.address, debouncedAmount, address, slippageBps]
  )

  const price = usePrice(request)
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
  const typing = sellAmount !== debouncedAmount
  const apiError = (price.error || exec.quoteError) as SwapApiError | Error | undefined
  const notConfigured = apiError instanceof SwapApiError && apiError.notConfigured
  const noLiquidity = price.data && !price.data.liquidityAvailable
  const balanceIssue = priceData?.issues.balance
  const insufficient =
    (sellAmount !== undefined && sellBalance.value !== undefined && sellAmount > sellBalance.value) || !!balanceIssue
  const wrongChain = isConnected && walletChainId !== chainId
  const chainName = SWAP_CHAINS.find((c) => c.id === chainId)!.name
  const explorer = explorerUrl(chainId)

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

  const pick = (token: SwapToken) => {
    if (picker === 'sell') {
      if (sameAddress(token.address, buy.address)) setBuy(sell)
      setSell(token)
    } else {
      if (sameAddress(token.address, sell.address)) setSell(buy)
      setBuy(token)
    }
    setPicker(undefined)
  }

  const knownTokens = useMemo(() => [...list.tokens, sell, buy], [list.tokens, sell, buy])
  const firm = exec.firm
  const busy = exec.quoting || exec.approving || exec.awaitingWallet || exec.confirming

  const action = (() => {
    if (notConfigured) return { label: 'Swap unavailable', disabled: true }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (wrongChain)
      return { label: switching ? 'Switching…' : `Switch to ${chainName}`, onClick: () => switchChain({ chainId }) }
    if (!sellAmount) return { label: 'Enter an amount', disabled: true }
    if (insufficient) return { label: `Not enough ${sell.symbol}`, disabled: true }
    if (typing || price.isFetching) {
      if (!priceData) return { label: 'Finding best price…', disabled: true }
    }
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
          ? `Reset ${sell.symbol} allowance (1/2)`
          : `Approve ${sell.symbol}`,
        disabled: exec.approving,
        onClick: exec.approve,
      }
    if (exec.awaitingWallet) return { label: 'Confirm in wallet…', disabled: true }
    if (exec.confirming) return { label: 'Swapping…', disabled: true }
    if (exec.confirmed) return { label: 'New swap', className: 'secondary', onClick: () => { exec.reset(); setInput('') } }
    return { label: exec.quoting ? 'Refreshing quote…' : 'Swap', disabled: exec.quoting, onClick: exec.swap }
  })()

  const buyDisplay = firm ? firm.buyAmount : priceData?.buyAmount
  const routeSources = (firm || priceData)?.route.fills.map((f) => f.source.replace(/_/g, ' '))
  const uniqueSources = routeSources ? [...new Set(routeSources)] : []
  const txError = describeTxError(exec.swapError || exec.approveError)

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          close()
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          minimize()
        }}
      >
        {page?.label}
      </TitleBar>
      <Root ref={rootRef} className={narrow ? 'narrow' : undefined}>
        <Banner role="img" aria-label="miya swaps">
          <h1>miya swaps</h1>
          <Chip tone={notConfigured ? 'warn' : 'ok'}>{notConfigured ? 'Offline' : 'via 0x'}</Chip>
        </Banner>
        <Body>
          <ChainTabs role="group" aria-label="Network">
            {SWAP_CHAINS.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === chainId} onClick={() => setChainId(c.id)} disabled={busy}>
                {c.name}
              </button>
            ))}
          </ChainTabs>

          {notConfigured && (
            <StatusBox tone="error" role="alert">
              <span>
                Swap service not configured. The site owner needs to set <code>ZEROX_API_KEY</code> on the server.
              </span>
            </StatusBox>
          )}

          <AmountPanel aria-label="You sell">
            <Meta>
              <Eyebrow>You sell</Eyebrow>
              <span>
                Balance: {sellBalance.value !== undefined ? fmt(sellBalance.value, sell.decimals) : '–'}{' '}
                {sellBalance.value !== undefined && sellBalance.value > 0n && (
                  <button type="button" onClick={setMax} title={isNative(sell.address) ? 'Keeps a little ETH for gas' : undefined}>
                    Max
                  </button>
                )}
              </span>
            </Meta>
            <AmountRow>
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={input}
                aria-label={`Amount of ${sell.symbol} to sell`}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d*\.?\d*$/.test(v)) setInput(v)
                }}
                disabled={busy && !!firm}
              />
              <TokenButton type="button" onClick={() => setPicker('sell')} aria-label={`Sell token: ${sell.symbol}`}>
                <TokenLogo token={sell} />
                {sell.symbol}
                <span className="caret">▼</span>
              </TokenButton>
            </AmountRow>
            {sell.unverified && <Line style={{ color: color.warning }}>Unverified token: double-check the address.</Line>}
          </AmountPanel>

          <FlipRow>
            <button type="button" aria-label="Flip tokens" onClick={flip} disabled={busy}>
              ⇅
            </button>
          </FlipRow>

          <AmountPanel aria-label="You buy">
            <Meta>
              <Eyebrow>You buy (estimated)</Eyebrow>
              <span>Balance: {buyBalance.value !== undefined ? fmt(buyBalance.value, buy.decimals) : '–'}</span>
            </Meta>
            <AmountRow>
              {sellAmount && (price.isLoading || typing) && !buyDisplay ? (
                <output>
                  <Skeleton h="20px" w="60%" />
                </output>
              ) : (
                <output aria-live="polite">{buyDisplay ? fmt(buyDisplay, buy.decimals) : '0.0'}</output>
              )}
              <TokenButton type="button" onClick={() => setPicker('buy')} aria-label={`Buy token: ${buy.symbol}`}>
                <TokenLogo token={buy} />
                {buy.symbol}
                <span className="caret">▼</span>
              </TokenButton>
            </AmountRow>
            {buy.unverified && <Line style={{ color: color.warning }}>Unverified token: double-check the address.</Line>}
          </AmountPanel>

          {priceData && !firm && (
            <Well style={{ padding: `${space[2]} ${space[3]}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Line>
                <span>Rate</span>
                <strong>{rate(sell, buy, priceData.sellAmount, priceData.buyAmount)}</strong>
              </Line>
              <Line>
                <span>Min. received ({slippageBps / 100}% slippage)</span>
                <strong>
                  {fmt(priceData.minBuyAmount, buy.decimals)} {buy.symbol}
                </strong>
              </Line>
              {uniqueSources.length > 0 && (
                <Line>
                  <span>Route</span>
                  <strong>{uniqueSources.join(' + ')}</strong>
                </Line>
              )}
              <Line>
                <span>Fee</span>
                <strong>
                  {feeApplies(chainId, sell.address, buy.address)
                    ? `includes ${FEE_BPS / 100}% miyamaker fee`
                    : feeFree(sell.address, buy.address)
                    ? 'no fee (imdUSD pair)'
                    : 'no fee'}
                </strong>
              </Line>
            </Well>
          )}

          {apiError && !notConfigured && (
            <StatusBox tone="error" role="alert">
              <span>{apiError.message}</span>
            </StatusBox>
          )}
          {noLiquidity && (
            <StatusBox tone="error" role="alert">
              <span>No liquidity for this pair on {chainName}. Try a different token or amount.</span>
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

          {firm && (
            <Review aria-label="Review swap">
              <Eyebrow>Review swap · firm quote</Eyebrow>
              {firm.fees.integratorFee && (
                <Line>
                  <span>Price includes a {FEE_BPS / 100}% miyamaker fee, taken in {buy.symbol}.</span>
                </Line>
              )}
              <Line>
                <span>You pay</span>
                <strong>
                  {fmt(firm.sellAmount, sell.decimals)} {sell.symbol}
                </strong>
              </Line>
              <Line>
                <span>You receive (expected)</span>
                <strong>
                  {fmt(firm.buyAmount, buy.decimals)} {buy.symbol}
                </strong>
              </Line>
              <Line>
                <span>Minimum received</span>
                <strong>
                  {fmt(firm.minBuyAmount, buy.decimals)} {buy.symbol}
                </strong>
              </Line>
              <Line>
                <span>Rate</span>
                <strong>{rate(sell, buy, firm.sellAmount, firm.buyAmount)}</strong>
              </Line>
              <Line>
                <span>Network fee (est.)</span>
                <strong>{firm.totalNetworkFee ? `${fmt(firm.totalNetworkFee, 18, 6)} ETH` : '–'}</strong>
              </Line>
              <Line>
                <span>miyamaker fee</span>
                <strong>
                  {firm.fees.integratorFee
                    ? `${feeText(firm.fees.integratorFee, knownTokens)} (included, ${FEE_BPS / 100}%)`
                    : feeFree(sell.address, buy.address)
                    ? 'No fee (imdUSD pair)'
                    : 'No fee'}
                </strong>
              </Line>
              {firm.fees.zeroExFee && (
                <Line>
                  <span>0x fee</span>
                  <strong>{feeText(firm.fees.zeroExFee, knownTokens)}</strong>
                </Line>
              )}
              {uniqueSources.length > 0 && (
                <Line>
                  <span>Route</span>
                  <strong>{uniqueSources.join(' + ')}</strong>
                </Line>
              )}
              {exec.needsApproval && (
                <Line>
                  <span>Approval</span>
                  <strong>
                    exact {fmt(firm.sellAmount, sell.decimals)} {sell.symbol} to 0x AllowanceHolder
                  </strong>
                </Line>
              )}
              {!exec.swapHash && (
                <Line>
                  <span />
                  <button
                    type="button"
                    onClick={exec.reset}
                    style={{ border: 'none', background: 'none', color: color.link, cursor: 'pointer', fontSize: text.xs }}
                  >
                    Edit trade
                  </button>
                </Line>
              )}
            </Review>
          )}

          <ActionDock>
            <BigButton
              type="button"
              className={'className' in action ? action.className : undefined}
              disabled={!!action.disabled}
              onClick={'onClick' in action ? action.onClick : undefined}
            >
              {action.label}
            </BigButton>
          </ActionDock>

          {exec.approveHash && exec.approving && (
            <StatusBox tone="info" role="status">
              <img src={LoadingHourglass} alt="" />
              <span>
                Approval sent.{' '}
                <a href={`${explorer}/tx/${exec.approveHash}`} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </span>
            </StatusBox>
          )}
          {exec.requoted && firm && !busy && !exec.swapHash && (
            <StatusBox tone="info" role="status">
              <span>The quote had expired and was refreshed. Check the new amounts above, then press Swap again.</span>
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
                Swap sent, waiting for confirmation.{' '}
                <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </span>
            </StatusBox>
          )}
          {exec.confirmed && (
            <StatusBox tone="ok" role="status">
              <span>
                Swapped! {fmt(firm?.buyAmount, buy.decimals)} {buy.symbol} (expected) is on its way.{' '}
                <a href={`${explorer}/tx/${exec.swapHash}`} target="_blank" rel="noreferrer">
                  View transaction
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
                    View transaction
                  </a>
                )}
              </span>
            </StatusBox>
          )}

          <Settings>
            <span>Max slippage</span>
            {SLIPPAGE_PRESETS_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                aria-pressed={slippageBps === bps && !customSlippage}
                onClick={() => {
                  setCustomSlippage('')
                  setSlippageBps(bps)
                }}
              >
                {bps / 100}%
              </button>
            ))}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                inputMode="decimal"
                placeholder="Custom"
                aria-label="Custom slippage percent"
                aria-invalid={customSlippageInvalid}
                aria-describedby={customSlippageInvalid ? 'custom-slippage-error' : undefined}
                value={customSlippage}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (!/^\d*\.?\d{0,2}$/.test(v)) return
                  setCustomSlippage(v)
                  const bps = Math.round(Number(v) * 100)
                  if (v && bps >= SLIPPAGE_MIN_BPS && bps <= SLIPPAGE_MAX_BPS) setSlippageBps(bps)
                }}
              />
              %
            </label>
            <span style={{ color: color.inkMuted }}>0.1% to 3%</span>
            {customSlippageInvalid && (
              <span id="custom-slippage-error" role="alert" style={{ color: color.danger }}>
                {customSlippage}% is outside 0.1% to 3%; still using {slippageBps / 100}%.
              </span>
            )}
            {slippageBps >= 200 && <span style={{ color: color.warning }}>High slippage: you may get a worse price.</span>}
          </Settings>

          <Line>
            <span>
              Quotes from the 0x Swap API on {chainName}.{' '}
              {address ? '' : 'Connect a wallet for balance checks.'}
            </span>
          </Line>
        </Body>

        {picker && (
          <TokenPicker
            chainId={chainId}
            tokens={list.tokens}
            loading={list.isLoading}
            listError={list.isError}
            selected={picker === 'sell' ? sell : buy}
            other={picker === 'sell' ? buy : sell}
            onSelect={pick}
            onClose={() => setPicker(undefined)}
          />
        )}
      </Root>
    </WindowWrapper>
  )
}

export type { Address }

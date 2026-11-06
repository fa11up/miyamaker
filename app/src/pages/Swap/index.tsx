import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled, { css } from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount } from 'wagmi'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { mainnet } from '@/config/wagmi'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import type { SwapChainId, SwapToken } from './constants'
import { isSwapChain, PINNED_TOKENS, sameAddress, SWAP_CHAINS } from './constants'
import { Chip } from './floor/retro'
import { PRICE_STATUS_WORDS } from './board'
import { color, font, space, text } from './floor/tokens'
import { ChainTabs } from './layout'
import { Tape, TokenTable, useBoard } from './MarketBoard'
import NftTrade from './nft/NftTrade'
import { Field } from './nft/ui'
import TokenPage, { TokenResults } from './TokenPage'
import type { SwapPreset } from './TokenSwap'
import type { CollectionRef, TokenRef, TradeMode } from './tradePath'
import { parseTradePath, TRADE_PATH, tradePath } from './tradePath'
import { useCustomToken, useTokenList } from './useTokens'

const page = Pages.swap

const Root = styled.div`
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: ${color.well};
  color: ${color.ink};
  font-family: ${font.mono};
  font-size: ${text.sm};
  /* miyaOS sets its pixel font on every element; the floor is all one mono face. */
  * {
    font-family: inherit;
  }
  a {
    color: ${color.link};
  }
  /* Trade's own scrollbars: no grey Win95 buttons in the middle of a dark window. */
  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  *::-webkit-scrollbar-track {
    background: ${color.well};
    box-shadow: none;
  }
  *::-webkit-scrollbar-thumb {
    background: ${color.light};
    border: none;
    box-shadow: none;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: ${color.dark};
  }
  *::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }
  *::-webkit-scrollbar-corner {
    background: ${color.well};
  }
`

const Bar = styled.header`
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[3]};
  padding: ${space[2]} ${space[3]};
  background:
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #1b2630, ${color.face});
  border-bottom: 1px solid ${color.dark};
  /* Chrome lettering, in amber instead of miyanet's pink. */
  h1 {
    margin: 0;
    font-family: 'Revalia', ${font.mono};
    font-size: 26px;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.08em;
    background: linear-gradient(
      180deg,
      #fff 0%,
      #ffe3a0 38%,
      ${color.accent} 52%,
      #fff4d6 66%,
      ${color.accentDark} 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(1px 1px 0 #000);
  }
  p {
    margin: 0;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .readout {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: ${space[2]};
  }
  .chains {
    flex: 0 1 300px;
    min-width: 0;
  }
  .chains button {
    height: 28px;
    font-size: ${text.xs};
    white-space: nowrap;
  }
  .lcd {
    padding: 2px ${space[2]};
    background: #000;
    box-shadow: inset 0 0 0 1px ${color.dark};
    font-size: ${text.xs};
    font-variant-numeric: tabular-nums;
    color: ${color.success};
    text-shadow: 0 0 5px rgba(53, 208, 127, 0.7);
    white-space: nowrap;
  }
  .lcd.off {
    color: ${color.danger};
    text-shadow: none;
  }
  .lcd.some,
  .lcd.loading {
    color: ${color.warning};
    text-shadow: none;
  }
  /* The title bar already says Trade, and a phone needs the rows. */
  .narrow & h1 {
    display: none;
  }
  .narrow & .chains {
    flex: 1 1 100%;
  }
  .narrow & .chains button {
    height: 44px;
  }
  .narrow & .readout {
    margin-left: 0;
  }
`

/** A little LCD clock, in UTC, the time the market keeps. */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="lcd" aria-hidden>
      {now.toISOString().slice(11, 19)} UTC
    </span>
  )
}

const Floor = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  &.home {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  /* No room for two columns: NFTs, then tokens, on one long page. */
  &.home.stack {
    display: block;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
`

const Pane = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  &[hidden] {
    display: none;
  }
  .stack > & {
    overflow: visible;
  }
`

const Search = styled.div`
  grid-column: 1 / -1;
  padding: ${space[3]} ${space[4]} 0;
  input {
    box-sizing: border-box;
    width: 100%;
  }
  .narrow & {
    padding: ${space[2]} ${space[3]} 0;
  }
`

/* Half a page each: tighter cells, so the sort arrows don't come out of the names. */
const tightCells = css`
  && th,
  && td {
    padding-left: ${space[2]};
    padding-right: ${space[2]};
  }
  && th:first-child,
  && td:first-child {
    padding-left: ${space[3]};
    width: 34%;
  }
  && .name {
    width: 100%;
  }
  /* One figure beside the name on a slim window: the name takes the room, instead of breaking mid-word. */
  .slim && th:first-child,
  .slim && td:first-child {
    width: 100%;
  }
`

const NftsPane = styled(Pane)`
  ${tightCells}
  /* Half the page: a long collection name takes a second line rather than losing its end. */
  tbody .words {
    white-space: normal;
    line-height: 1.2;
  }
`

const TokensPane = styled(Pane)`
  ${tightCells}
  padding: ${space[3]} ${space[4]} ${space[3]} 0;
  .stack > & {
    padding: ${space[3]} ${space[4]};
  }
  .narrow .stack > & {
    padding: ${space[2]} ${space[3]};
  }
  /* The NFTs' header mirrored: dark at the middle of the page, its colour and title at the outer edge. */
  section > h2 {
    text-align: right;
    background:
      repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0 1px, transparent 1px 3px),
      linear-gradient(270deg, #4a3408, ${color.face} 70%);
  }
`

/**
 * Trade under one header. Home is NFTs on the left and tokens on the right; each opens its own page: a collection with its
 * listings, or a token with its chart, market and swap. Pages stay mounted once opened so nothing loses a trade in progress.
 * The view lives in the path (/trade, /trade/tokens/<chain>/<address>, /trade/nfts/<pool>,
 * /trade/nfts/collection/<chain>/<address>[/<id>]) so it can be shared and Back works.
 */
export default function TradePage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('swap')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'swap' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'swap' }))

  const [rootRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 440
  const slim = width > 0 && width < 980
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const initial = useRef(parseTradePath(location.pathname))
  const [pool, setPool] = useState<`0x${string}` | undefined>(initial.current.pool)
  const [collection, setCollection] = useState<CollectionRef | undefined>(initial.current.collection)
  const [offline, setOffline] = useState(false)
  const [preset, setPreset] = useState<SwapPreset>()
  const [mode, setMode] = useState<TradeMode>(initial.current.mode)
  const [tokenRef, setTokenRef] = useState<TokenRef | undefined>(initial.current.token)
  // Where a token page was opened from inside Trade, so its back button returns there. Empty for a link from outside.
  const [tokenFrom, setTokenFrom] = useState<string>()

  // One network for the whole floor: the market and the swap can't disagree about where you are trading.
  const { chainId: walletChainId } = useAccount()
  const linked = initial.current.collection?.chainId ?? initial.current.token?.chainId
  const [chainId, setChainId] = useState<SwapChainId>(
    isSwapChain(linked) ? linked : isSwapChain(walletChainId) ? walletChainId : mainnet.id,
  )
  const [marketBusy, setMarketBusy] = useState(false)
  const [swapBusy, setSwapBusy] = useState(false)
  const tradeBusy = marketBusy || swapBusy
  const board = useBoard(chainId)
  // One search for the whole home page. A pasted token's address isn't a collection, so the NFT side leaves it alone.
  const [query, setQuery] = useState('')
  const list = useTokenList(chainId)
  const custom = useCustomToken(chainId, query, list.tokens)
  const pastedToken = custom.listed || custom.token

  // Follow the wallet onto a supported chain, unless a link to one thing is open.
  useEffect(() => {
    if (isSwapChain(walletChainId) && !collection && !pool && !tokenRef) setChainId(walletChainId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletChainId])
  useEffect(() => {
    if (isSwapChain(collection?.chainId)) setChainId(collection!.chainId as SwapChainId)
  }, [collection?.chainId])
  useEffect(() => {
    if (isSwapChain(tokenRef?.chainId)) setChainId(tokenRef!.chainId as SwapChainId)
  }, [tokenRef?.chainId])

  const view = mode === 'tokens' ? (tokenRef ? 'token' : 'home') : pool || collection ? 'nft' : 'home'
  // The token page opens the first time it is wanted, then keeps its place (and any swap in flight) behind the others.
  const lastToken = useRef(tokenRef)
  if (tokenRef) lastToken.current = tokenRef

  const go = (nextMode: TradeMode, nextPool?: `0x${string}`, nextCollection?: CollectionRef, nextToken?: TokenRef) => {
    setMode(nextMode)
    if (nextMode === 'nfts') {
      setPool(nextPool)
      setCollection(nextPool ? undefined : nextCollection)
    } else {
      setTokenRef(nextToken)
      if (!nextToken) {
        setPool(undefined)
        setCollection(undefined)
      }
    }

    const path =
      nextMode === 'nfts'
        ? tradePath(nextMode, nextPool, nextPool ? undefined : nextCollection)
        : tradePath(nextMode, undefined, undefined, nextToken)
    if (location.pathname !== path) navigate(path)
  }

  const openToken = (t: SwapToken) => {
    setPreset(undefined)
    setTokenFrom(location.pathname)
    go('tokens', undefined, undefined, { chainId: t.chainId, address: t.address })
  }

  const leaveToken = () => {
    const from = tokenFrom ? parseTradePath(tokenFrom) : undefined
    setTokenFrom(undefined)
    if (from?.token) go('tokens', undefined, undefined, from.token)
    else if (from?.mode === 'nfts') go('nfts', from.pool, from.collection)
    else go('tokens')
  }

  // Back/forward and links into a sub-path drive the view. A plain push to /trade is the OS re-focusing the window,
  // which must not throw away the open tab, so only POP navigations return to Tokens.
  useEffect(() => {
    if (!location.pathname.startsWith(TRADE_PATH)) return
    const next = parseTradePath(location.pathname)
    if (location.pathname === TRADE_PATH && navigationType !== 'POP') return
    setMode(next.mode)
    if (next.mode === 'nfts') {
      setPool(next.pool)
      setCollection(next.collection)
    } else {
      setTokenRef(next.token)
      if (!next.token) {
        setPool(undefined)
        setCollection(undefined)
      }
    }
  }, [location.pathname, navigationType])

  return (
    <WindowWrapper skin="floor">
      <TitleBar
        skin="floor"
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
      <Root ref={rootRef} className={[narrow && 'narrow', slim && 'slim'].filter(Boolean).join(' ') || undefined}>
        <Bar>
          <h1>trade</h1>
          <span className="chains">
            <ChainTabs role="group" aria-label="Network">
              {SWAP_CHAINS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.id === chainId}
                  disabled={tradeBusy}
                  onClick={() => {
                    setChainId(c.id)
                    go('tokens')
                  }}
                >
                  {c.name}
                </button>
              ))}
            </ChainTabs>
          </span>
          <span className="readout">
            {offline && <Chip tone="warn">Swap offline</Chip>}
            <span
              className={board.status === 'live' ? 'lcd' : `lcd ${board.status}`}
              data-price-status={board.status}
            >
              {PRICE_STATUS_WORDS[board.status]}
            </span>
            {!narrow && <Clock />}
          </span>
        </Bar>
        <Tape rows={board.rows} loading={board.loading} disabled={tradeBusy} onTrade={openToken} />
        <Floor className={view === 'home' ? (slim ? 'home stack' : 'home') : undefined}>
          {view === 'home' && (
            <Search>
              <Field
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search or paste an address"
                aria-label="Search NFTs and tokens by name, or paste an address"
                spellCheck={false}
              />
            </Search>
          )}
          <NftsPane hidden={view === 'token'} data-trade-nfts>
            <NftTrade
              query={pastedToken ? '' : query}
              chainId={chainId}
              onBusy={setMarketBusy}
              pool={pool}
              collection={collection}
              visible={view !== 'token'}
              onOpenPool={(p) => go('nfts', p)}
              onOpenCollection={(c) => go('nfts', undefined, c)}
              onSwapToken={(p) => {
                // Pool tokens are the only ones here that aren't on the list, and the page is about them.
                const pinned = (t?: SwapToken) =>
                  PINNED_TOKENS[p.chainId].some((x) => sameAddress(x.address, t?.address))
                const subject = pinned(p.buy) ? p.sell : p.buy
                setPreset({ ...p, key: Date.now() })
                setTokenFrom(location.pathname)
                if (subject) go('tokens', undefined, undefined, { chainId: p.chainId, address: subject.address })
              }}
            />
          </NftsPane>
          <TokensPane hidden={view !== 'home'} data-trade-home-tokens>
            {query.trim() ? (
              <TokenResults
                query={query}
                tokens={list.tokens}
                pasted={pastedToken}
                loading={list.isLoading || custom.isLoading}
                onOpen={openToken}
              />
            ) : (
              <TokenTable rows={board.rows} failed={board.failed} loading={board.loading} onTrade={openToken} />
            )}
          </TokensPane>
          {lastToken.current && (
            <Pane hidden={view !== 'token'} data-trade-tokens>
              <TokenPage
                chainId={chainId}
                onChain={setChainId}
                onBusy={setSwapBusy}
                address={lastToken.current.chainId === chainId ? lastToken.current.address : undefined}
                preset={preset}
                onBack={leaveToken}
                backLabel={tokenFrom ? 'Back' : 'All tokens'}
                onOffline={setOffline}
              />
            </Pane>
          )}
        </Floor>
      </Root>
    </WindowWrapper>
  )
}

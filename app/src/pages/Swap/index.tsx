import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount } from 'wagmi'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { mainnet } from '@/config/wagmi'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import { featuredOn } from './board'
import type { SwapChainId, SwapToken } from './constants'
import { isSwapChain, PINNED_TOKENS, sameAddress, SWAP_CHAINS } from './constants'
import { Chip } from './floor/retro'
import { color, font, space, text } from './floor/tokens'
import { Tape, TokenTable, useBoard } from './MarketBoard'
import NftTrade from './nft/NftTrade'
import type { ActivityRow } from './terminal/activity'
import { ActivityPanel, ActivityTape } from './terminal/ActivityView'
import type { Command, TerminalTab } from './terminal/command'
import { tabForKey } from './terminal/command'
import { AMBER, CommandLine, FunctionKeys, StatusLine, Watchlist } from './terminal/parts'
import { useActivity } from './terminal/useActivity'
import TokenPage, { TokenResults } from './TokenPage'
import type { SwapPreset } from './TokenSwap'
import type { CollectionRef, TokenRef } from './tradePath'
import { parseTradePath, tabPath, TRADE_PATH, tradePath } from './tradePath'
import { useCustomToken, useTokenList } from './useTokens'

const page = Pages.swap

const Root = styled.div`
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #000;
  color: ${color.ink};
  font-family: ${font.mono};
  font-size: ${text.sm};
  /* miyaOS sets its pixel font on every element; the terminal is all one mono face. */
  * {
    font-family: inherit;
  }
  a {
    color: ${color.link};
  }
  &:focus {
    outline: none;
  }
  /* Trade's own scrollbars: no grey Win95 buttons in the middle of a dark window. */
  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  *::-webkit-scrollbar-track {
    background: #000;
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
    background: #000;
  }
`

const Net = styled.span`
  display: inline-flex;
  gap: 2px;
  button {
    padding: 1px 8px;
    border: 1px solid ${color.dark};
    background: #000;
    color: ${color.inkMuted};
    font: inherit;
    font-size: ${text.xs};
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: ${AMBER};
    color: ${AMBER};
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
`

/** The rail beside the main panel: the watchlist, or the trade ticket in its place. */
const Body = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
  .slim & {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .narrow & {
    display: flex;
    flex-direction: column;
  }
`

const Rail = styled.aside`
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${color.dark};
  background: #000;
  > .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  [hidden] {
    display: none !important;
  }
  /* A phone: the rail is a sheet over the bottom of the screen, opened by WATCH or a ticket. */
  .narrow & {
    position: absolute;
    z-index: 30;
    left: 0;
    right: 0;
    /* Above the tab bar (the function keys), which stays reachable. */
    bottom: 49px;
    height: min(74%, 600px);
    border-right: none;
    border-top: 2px solid ${AMBER};
    box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.7);
  }
  .narrow &.closed {
    display: none;
  }
`

const RailHead = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: 6px ${space[3]};
  background: ${AMBER};
  color: #000;
  font-size: ${text.xs};
  font-weight: 700;
  letter-spacing: 0.12em;
  button {
    padding: 2px 6px;
    border: 1px solid #000;
    background: #000;
    color: ${AMBER};
    font: inherit;
    font-size: ${text.xs};
    cursor: pointer;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .narrow & button {
    min-height: 36px;
  }
`

/* The ticket holds the token page's own swap panel: give it the rail's width. */
const Ticket = styled.div`
  > * {
    max-width: 100%;
  }
`

const Main = styled.main`
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: ${color.well};
  .narrow & {
    flex: 1 1 auto;
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
`

const Padded = styled.div`
  padding: ${space[3]} ${space[4]};
  .narrow & {
    padding: ${space[2]} ${space[3]};
  }
`

const SearchHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[4]};
  border-bottom: 1px solid ${color.dark};
  color: ${color.inkMuted};
  b {
    color: #fff;
  }
  button {
    margin-left: auto;
    border: none;
    background: none;
    color: ${color.link};
    font: inherit;
    cursor: pointer;
  }
`

type View = TerminalTab | 'search'

/**
 * Trade as one terminal (2026-11-12). A status line, the command line and the function keys on top; the rail on the left
 * (the watchlist, which turns into the trade ticket when a token is opened); the main panel on the right, switched by
 * F1 NFT, F2 TOKENS, F3 POOLS, F4 ACTIVITY; the price tape across the bottom. On a phone the function keys are the tab
 * bar and the rail is a sheet. Pages stay mounted once opened so nothing loses a trade in progress. The view lives in
 * the path (/trade, /trade/tokens/<chain>/<address>, /trade/nfts/collection/<chain>/<address>[/<id>], /trade/pools,
 * /trade/nfts/<pool>, /trade/activity) so it can be shared and Back works.
 */
export default function TradePage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('swap')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'swap' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'swap' }))

  const [sizeRef, { width }] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const narrow = width > 0 && width <= 640
  const slim = width > 0 && width < 980
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const initial = useRef(parseTradePath(location.pathname))
  const [pool, setPool] = useState<`0x${string}` | undefined>(initial.current.pool)
  const [collection, setCollection] = useState<CollectionRef | undefined>(initial.current.collection)
  const [offline, setOffline] = useState(false)
  const [preset, setPreset] = useState<SwapPreset>()
  const [tokenRef, setTokenRef] = useState<TokenRef | undefined>(initial.current.token)
  // NFT first: /trade opens on the collections.
  const tabFor = (p: ReturnType<typeof parseTradePath>): TerminalTab => p.tab ?? (p.token ? 'tokens' : 'nft')
  const [view, setView] = useState<View>(tabFor(initial.current))
  const [query, setQuery] = useState('')
  const [sweepAsk, setSweepAsk] = useState<{ key: number; count: number }>()

  // The rail: the watchlist or the ticket. On a phone it is a sheet, open or closed.
  const [rail, setRail] = useState<'watch' | 'ticket'>(initial.current.token ? 'ticket' : 'watch')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [ticketEl, setTicketEl] = useState<HTMLDivElement | null>(null)
  const commandRef = useRef<HTMLInputElement>(null)

  // One network for the whole terminal: the market and the swap can't disagree about where you are trading.
  const { chainId: walletChainId } = useAccount()
  const linked = initial.current.collection?.chainId ?? initial.current.token?.chainId
  const [chainId, setChainId] = useState<SwapChainId>(
    isSwapChain(linked) ? linked : isSwapChain(walletChainId) ? walletChainId : mainnet.id
  )
  const chainName = SWAP_CHAINS.find((c) => c.id === chainId)?.name ?? 'Ethereum'
  const [marketBusy, setMarketBusy] = useState(false)
  const [swapBusy, setSwapBusy] = useState(false)
  const tradeBusy = marketBusy || swapBusy
  const board = useBoard(chainId)
  const activity = useActivity(chainId)
  const list = useTokenList(chainId)
  const custom = useCustomToken(chainId, query, list.tokens)
  const pastedToken = custom.listed || custom.token

  // Follow the wallet onto a supported chain, unless a link to one thing is open. Not during a trade.
  const followedChain = useRef(walletChainId)
  useEffect(() => {
    if (tradeBusy || followedChain.current === walletChainId) return
    followedChain.current = walletChainId
    if (isSwapChain(walletChainId) && !collection && !pool && !tokenRef) setChainId(walletChainId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletChainId, tradeBusy])
  useEffect(() => {
    if (isSwapChain(collection?.chainId)) setChainId(collection!.chainId as SwapChainId)
  }, [collection?.chainId])
  useEffect(() => {
    if (isSwapChain(tokenRef?.chainId)) setChainId(tokenRef!.chainId as SwapChainId)
  }, [tokenRef?.chainId])

  // The token page opens the first time it is wanted, then keeps its place (and any swap in flight) behind the others.
  const lastToken = useRef(tokenRef)
  if (tokenRef) lastToken.current = tokenRef

  const push = (path: string) => {
    if (location.pathname !== path) navigate(path)
  }

  const showTab = (t: TerminalTab) => {
    setQuery('')
    if (t === 'watch') {
      setRail('watch')
      if (narrow) setSheetOpen((o) => !o)
      return
    }

    setView(t)
    setSheetOpen(false)
    if (t === 'nft') push(collection ? tradePath('nfts', undefined, collection) : TRADE_PATH)
    if (t === 'pools') push(pool ? tradePath('nfts', pool) : tabPath('pools'))
    if (t === 'activity') push(tabPath('activity'))
    if (t === 'tokens') push(tokenRef ? tradePath('tokens', undefined, undefined, tokenRef) : TRADE_PATH)
  }

  const openCollection = (c: CollectionRef | undefined, buy?: number) => {
    setQuery('')
    setCollection(c)
    setView('nft')
    setSheetOpen(false)
    setSweepAsk(buy ? { key: Date.now(), count: buy } : undefined)
    // Back to the watchlist, unless a swap is in flight on the ticket (it stays one press away either way).
    if (!swapBusy) setRail('watch')
    push(c ? tradePath('nfts', undefined, c) : TRADE_PATH)
  }

  const openPool = (p: `0x${string}` | undefined) => {
    setQuery('')
    setPool(p)
    setView('pools')
    push(p ? tradePath('nfts', p) : tabPath('pools'))
  }

  const openToken = (t: SwapToken | TokenRef, keepPreset = false) => {
    if (!keepPreset) setPreset(undefined)
    const ref = { chainId: t.chainId, address: t.address }
    setQuery('')
    setTokenRef(ref)
    setView('tokens')
    setRail('ticket')
    if (narrow) setSheetOpen(true)
    push(tradePath('tokens', undefined, undefined, ref))
  }

  // A sale or mint opens that NFT's page in the NFT tab.
  const openActivity = (r: ActivityRow) =>
    openCollection({ chainId: r.chainId, address: r.address as `0x${string}`, tokenId: r.tokenId })

  const run = (c: Command) => {
    if (c.kind === 'tab') showTab(c.tab)
    else if (c.kind === 'collection')
      openCollection({ chainId: c.collection.chainId, address: c.collection.address as `0x${string}` }, c.buy)
    else if (c.kind === 'token') openToken({ chainId: c.token.chainId, address: c.token.address as `0x${string}` })
    else if (c.kind === 'address' || c.kind === 'search') {
      setQuery(c.kind === 'address' ? c.address : c.query)
      setView('search')
    }
  }

  // Back/forward and links into a sub-path drive the view. A plain push to /trade is the OS re-focusing the window,
  // which must not throw away the open tab, so only POP navigations return home. A trade in flight keeps its screen.
  const syncedPath = useRef<string>()
  useEffect(() => {
    const here = `${navigationType} ${location.pathname}`
    if (tradeBusy || syncedPath.current === here) return
    syncedPath.current = here
    if (!location.pathname.startsWith(TRADE_PATH)) return
    if (location.pathname === TRADE_PATH && navigationType !== 'POP') return
    const next = parseTradePath(location.pathname)
    if (next.tab === 'activity') setView('activity')
    else if (next.tab === 'pools') {
      setPool(next.pool)
      setView('pools')
    } else if (next.token) {
      setTokenRef(next.token)
      setView('tokens')
    } else {
      setCollection(next.collection)
      setView('nft')
    }
  }, [location.pathname, navigationType, tradeBusy])

  // Keys while the terminal has focus: F1–F5 (and Alt+1–5) switch, / goes to the command line, Esc closes the ticket.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const t = tabForKey(e)
    if (t) {
      e.preventDefault()
      showTab(t)
      return
    }

    if (typing) return
    if (e.key === '/') {
      e.preventDefault()
      commandRef.current?.focus()
    } else if (e.key === 'Escape') {
      if (narrow && sheetOpen) setSheetOpen(false)
      else if (rail === 'ticket') setRail('watch')
    }
  }

  const commandCollections = useMemo(() => featuredOn(chainId), [chainId])
  const commandTokens = useMemo(() => {
    const seen = new Set<string>()
    return [...board.rows.map((r) => r.token), ...list.tokens].filter((t) => {
      const k = t.symbol.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [board.rows, list.tokens])

  const ticketToken = lastToken.current
  const ticketSymbol =
    ticketToken &&
    (commandTokens.find((t) => sameAddress(t.address, ticketToken.address))?.symbol ??
      `${ticketToken.address.slice(0, 6)}…`)

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
      <Root
        ref={(el) => {
          rootRef.current = el
          sizeRef(el)
        }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={[narrow && 'narrow', slim && 'slim'].filter(Boolean).join(' ') || undefined}
      >
        <StatusLine
          chainId={chainId}
          chainName={chainName}
          priceStatus={board.status}
          extra={
            <>
              <Net role="group" aria-label="Network">
                {SWAP_CHAINS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === chainId}
                    disabled={tradeBusy}
                    onClick={() => {
                      setChainId(c.id)
                      showTab('nft')
                    }}
                  >
                    {c.id === 1 ? 'ETH' : 'RH'}
                  </button>
                ))}
              </Net>
              {offline && <Chip tone="warn">Swap offline</Chip>}
            </>
          }
        />
        <CommandLine
          inputRef={commandRef}
          collections={commandCollections}
          tokens={commandTokens}
          disabled={tradeBusy}
          onCommand={run}
        />
        <FunctionKeys tab={view === 'search' ? 'nft' : view} railOpen={narrow ? sheetOpen : false} onTab={showTab} />
        <Tape rows={board.rows} loading={board.loading} disabled={tradeBusy} onTrade={(t) => openToken(t)} />

        <Body>
          <Rail
            className={narrow && !sheetOpen ? 'closed' : undefined}
            aria-label={rail === 'ticket' ? 'Trade ticket' : 'Watchlist'}
          >
            {rail === 'ticket' && ticketToken ? (
              <RailHead>
                <button type="button" onClick={() => setRail('watch')} title="Back to the watchlist (Esc)">
                  ◀ WATCH
                </button>
                <span className="title">TICKET · {ticketSymbol}</span>
                {narrow && (
                  <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close">
                    ✕
                  </button>
                )}
              </RailHead>
            ) : (
              <RailHead>
                <span className="title">WATCHLIST · {chainName.toUpperCase()}</span>
                {ticketToken && (
                  <button type="button" onClick={() => setRail('ticket')} title="Back to the open ticket">
                    TICKET ▶
                  </button>
                )}
                {narrow && (
                  <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close">
                    ✕
                  </button>
                )}
              </RailHead>
            )}
            <div className="scroll">
              <div hidden={rail === 'ticket' && !!ticketToken}>
                <Watchlist
                  chainId={chainId}
                  rows={board.rows}
                  activeCollection={view === 'nft' ? collection?.address : undefined}
                  activeToken={view === 'tokens' ? tokenRef?.address : undefined}
                  onCollection={(address) => openCollection({ chainId, address: address as `0x${string}` })}
                  onToken={(t) => openToken(t)}
                />
              </div>
              <Ticket ref={setTicketEl} hidden={rail !== 'ticket' || !ticketToken} data-trade-ticket />
            </div>
          </Rail>

          <Main>
            {view === 'search' && (
              <Pane>
                <SearchHead>
                  <span>
                    SEARCH <b>{query}</b>
                  </span>
                  <button type="button" onClick={() => showTab('nft')}>
                    Clear ✕
                  </button>
                </SearchHead>
                <Padded>
                  <TokenResults
                    query={query}
                    tokens={list.tokens}
                    pasted={pastedToken}
                    loading={list.isLoading || custom.isLoading}
                    onOpen={(t) => openToken(t)}
                  />
                </Padded>
              </Pane>
            )}

            <Pane hidden={!(view === 'nft' || view === 'pools' || view === 'search')} data-trade-nfts>
              <NftTrade
                query={view === 'search' && !pastedToken ? query : ''}
                chainId={chainId}
                onBusy={setMarketBusy}
                section={view === 'pools' ? 'pools' : 'collections'}
                pool={view === 'pools' ? pool : undefined}
                collection={view === 'nft' ? collection : undefined}
                sweepAsk={sweepAsk}
                visible={view === 'nft' || view === 'pools' || view === 'search'}
                onOpenPool={openPool}
                onOpenCollection={(c) => openCollection(c)}
                onSwapToken={(p) => {
                  // Pool tokens are the only ones here that aren't on the list, and the ticket is about them.
                  const pinned = (t?: SwapToken) =>
                    PINNED_TOKENS[p.chainId].some((x) => sameAddress(x.address, t?.address))
                  const subject = pinned(p.buy) ? p.sell : p.buy
                  setPreset({ ...p, key: Date.now() })
                  if (subject) openToken({ chainId: p.chainId, address: subject.address }, true)
                }}
              />
            </Pane>

            <Pane hidden={view !== 'tokens' || !!tokenRef} data-trade-home-tokens>
              <Padded>
                <TokenTable
                  rows={board.rows}
                  failed={board.failed}
                  loading={board.loading}
                  onTrade={(t) => openToken(t)}
                />
              </Padded>
            </Pane>

            {lastToken.current && (
              <Pane hidden={view !== 'tokens' || !tokenRef} data-trade-tokens>
                <TokenPage
                  chainId={chainId}
                  onChain={setChainId}
                  onBusy={setSwapBusy}
                  address={lastToken.current.chainId === chainId ? lastToken.current.address : undefined}
                  preset={preset}
                  onBack={() => {
                    setTokenRef(undefined)
                    push(TRADE_PATH)
                  }}
                  backLabel="All tokens"
                  onOffline={setOffline}
                  ticket={ticketEl}
                />
              </Pane>
            )}

            {view === 'activity' && (
              <Pane>
                <ActivityPanel
                  rows={activity.rows}
                  loading={activity.loading}
                  failed={activity.failed}
                  onOpen={openActivity}
                />
              </Pane>
            )}
          </Main>
        </Body>
        {!narrow && <ActivityTape rows={activity.rows} onOpen={openActivity} />}
      </Root>
    </WindowWrapper>
  )
}

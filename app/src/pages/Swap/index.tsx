import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import type { SwapToken } from './constants'
import { DEFAULT_PAIR } from './constants'
import { Chip } from './floor/retro'
import { color, font, space, text } from './floor/tokens'
import { Tape, useBoard } from './MarketBoard'
import NftTrade from './nft/NftTrade'
import type { SwapPreset } from './TokenSwap'
import TokenSwap from './TokenSwap'
import type { CollectionRef, TradeMode } from './tradePath'
import { parseTradePath, TRADE_PATH, tradePath } from './tradePath'

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
`

const Bar = styled.header`
  flex: none;
  display: flex;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[2]} ${space[3]};
  background: ${color.face};
  border-bottom: 1px solid ${color.dark};
  h1 {
    margin: 0;
    font-size: ${text.lg};
    font-weight: 700;
    letter-spacing: 0.14em;
    color: ${color.accent};
  }
  p {
    margin: 0;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .status {
    margin-left: auto;
  }
`

const Floor = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  &.one {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Pane = styled.div`
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  &[hidden] {
    display: none;
  }
  &.dock {
    border-left: 1px solid ${color.dark};
    background: ${color.face};
  }
  .one &.dock {
    border-left: none;
  }
`

/* One column: the market and the swap take turns. */
const PaneTabs = styled.div`
  flex: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid ${color.dark};
  button {
    min-height: 44px;
    border: none;
    background: ${color.face};
    color: ${color.inkMuted};
    font-size: ${text.sm};
    cursor: pointer;
  }
  button[aria-selected='true'] {
    color: ${color.accent};
    font-weight: 700;
    box-shadow: inset 0 -2px 0 ${color.accent};
  }
`

/**
 * Trade: one floor for tokens and NFTs. The market (token prices, collections, pools, any collection or NFT) fills the
 * left, and the 0x swap stays docked on the right, so neither ever hides the other; in a narrow window they take turns.
 * Both stay mounted so nothing loses a trade in progress. The view lives in the path (/trade, /trade/nfts,
 * /trade/nfts/<pool>, /trade/nfts/collection/<chain>/<address>[/<id>]) so it can be shared and Back works.
 */
export default function TradePage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('swap')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'swap' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'swap' }))

  const [rootRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 440
  const oneColumn = width > 0 && width < 820
  const slim = width > 0 && width < 980
  const board = useBoard()

  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const initial = useRef(parseTradePath(location.pathname))
  const [pool, setPool] = useState<`0x${string}` | undefined>(initial.current.pool)
  const [collection, setCollection] = useState<CollectionRef | undefined>(initial.current.collection)
  const [offline, setOffline] = useState(false)
  const [preset, setPreset] = useState<SwapPreset>()
  const [pane, setPane] = useState<'market' | 'swap'>('market')

  /** Put a token in the docked swap: buy it with ETH (or sell it, if it is ETH already). */
  const tradeToken = (t: SwapToken) => {
    const [eth, infer] = DEFAULT_PAIR[1]
    setPreset(
      t.symbol === eth.symbol
        ? { key: Date.now(), chainId: 1, sell: eth, buy: infer }
        : { key: Date.now(), chainId: 1, sell: eth, buy: t }
    )
    setPane('swap')
  }

  const go = (nextMode: TradeMode, nextPool?: `0x${string}`, nextCollection?: CollectionRef) => {
    if (nextMode === 'nfts') {
      setPool(nextPool)
      setCollection(nextPool ? undefined : nextCollection)
    }

    const path =
      nextMode === 'nfts' ? tradePath(nextMode, nextPool, nextPool ? undefined : nextCollection) : tradePath(nextMode)
    if (location.pathname !== path) navigate(path)
  }

  // Back/forward and links into a sub-path drive the view. A plain push to /trade is the OS re-focusing the window,
  // which must not throw away the open tab, so only POP navigations return to Tokens.
  useEffect(() => {
    if (!location.pathname.startsWith(TRADE_PATH)) return
    const next = parseTradePath(location.pathname)
    if (location.pathname === TRADE_PATH && navigationType !== 'POP') return
    if (next.mode === 'nfts') {
      setPool(next.pool)
      setCollection(next.collection)
    }
  }, [location.pathname, navigationType])

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
      <Root ref={rootRef} className={[narrow && 'narrow', slim && 'slim'].filter(Boolean).join(' ') || undefined}>
        <Bar>
          <h1>TRADE</h1>
          {!narrow && <p>Tokens and NFTs, one floor.</p>}
          {offline && (
            <span className="status">
              <Chip tone="warn">Swap offline</Chip>
            </span>
          )}
        </Bar>
        <Tape rows={board.rows} onTrade={tradeToken} />
        {oneColumn && (
          <PaneTabs role="tablist" aria-label="Market or swap">
            <button type="button" role="tab" aria-selected={pane === 'market'} onClick={() => setPane('market')}>
              Market
            </button>
            <button type="button" role="tab" aria-selected={pane === 'swap'} onClick={() => setPane('swap')}>
              Swap
            </button>
          </PaneTabs>
        )}
        <Floor className={oneColumn ? 'one' : undefined}>
          <Pane hidden={oneColumn && pane !== 'market'} data-trade-market>
            <NftTrade
              pool={pool}
              collection={collection}
              board={board}
              onTradeToken={tradeToken}
              onOpenPool={(p) => go('nfts', p)}
              onOpenCollection={(c) => go('nfts', undefined, c)}
              onSwapToken={(p) => {
                setPreset({ ...p, key: Date.now() })
                setPane('swap')
              }}
              onShowTokens={() => setPane('swap')}
            />
          </Pane>
          <Pane className="dock" hidden={oneColumn && pane !== 'swap'} data-trade-swap>
            <TokenSwap preset={preset} onOffline={setOffline} />
          </Pane>
        </Floor>
      </Root>
    </WindowWrapper>
  )
}

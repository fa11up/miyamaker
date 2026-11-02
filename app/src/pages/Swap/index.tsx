import SwapBanner from 'assets/SwapBanner.jpg'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import { Chip } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { color, space, text } from '@/theme/tokens'

import NftTrade from './nft/NftTrade'
import type { SwapPreset } from './TokenSwap'
import TokenSwap from './TokenSwap'
import type { TradeMode } from './tradePath'
import { parseTradePath, TRADE_PATH, tradePath } from './tradePath'

const page = Pages.swap

const Root = styled.div`
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${color.face};
`

/* The artwork alone: no title on it (the window title already says Trade). */
const Banner = styled.div`
  height: 96px;
  background: url(${SwapBanner}) center 62% / cover no-repeat;
  image-rendering: pixelated;
  .narrow & {
    height: 72px;
  }
`

/* Win9x property-sheet tabs: the selected one is the window face, so it joins the content below. */
const TabStrip = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space[2]};
  padding: ${space[2]} ${space[4]} 0;
  background: ${color.shadow};
  box-shadow: inset 0 -1px 0 ${color.highlight};
  .narrow & {
    padding: ${space[2]} ${space[3]} 0;
  }
`

const ModeTabs = styled.div`
  display: flex;
  gap: 2px;
  button {
    position: relative;
    height: 34px;
    min-width: 108px;
    padding: 0 ${space[4]};
    border: none;
    background: ${color.light};
    color: ${color.inkMuted};
    font-size: ${text.md};
    cursor: pointer;
    box-shadow: inset 1px 1px ${color.highlight}, inset -1px 0 ${color.dark}, inset -2px 0 ${color.shadow};
    .narrow & {
      height: 40px;
      min-width: 0;
      flex: 1;
    }
    &:hover {
      color: ${color.ink};
    }
    &:focus-visible {
      outline: 1px dotted ${color.dark};
      outline-offset: -5px;
    }
  }
  button[aria-selected='true'] {
    height: 38px;
    margin-bottom: -1px;
    background: ${color.face};
    color: ${color.ink};
    font-weight: 700;
    z-index: 1;
    .narrow & {
      height: 44px;
    }
  }
  .narrow & {
    flex: 1;
  }
`

const Status = styled.div`
  padding-bottom: ${space[2]};
`

const Panel = styled.div`
  &[hidden] {
    display: none;
  }
`

const MODES: { id: TradeMode; label: string }[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'nfts', label: 'NFTs' },
]

/**
 * Trade (was "miya swaps"): Tokens swaps ERC-20s through 0x; NFTs trades NFTs through the zero-fee MiyaPool pools.
 * Both tabs stay mounted so switching never loses a trade in progress. The tab and pool live in the path
 * (/trade, /trade/nfts, /trade/nfts/<pool>) so they can be shared and Back works.
 */
export default function TradePage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('swap')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'swap' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'swap' }))

  const [rootRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 440

  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const initial = useRef(parseTradePath(location.pathname))
  const [mode, setMode] = useState<TradeMode>(initial.current.mode)
  const [pool, setPool] = useState<`0x${string}` | undefined>(initial.current.pool)
  const [offline, setOffline] = useState(false)
  const [preset, setPreset] = useState<SwapPreset>()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const go = (nextMode: TradeMode, nextPool?: `0x${string}`) => {
    setMode(nextMode)
    setPool(nextMode === 'nfts' ? nextPool : pool)
    const path = tradePath(nextMode, nextMode === 'nfts' ? nextPool : undefined)
    if (location.pathname !== path) navigate(path)
  }

  // Back/forward and links into a sub-path drive the view. A plain push to /trade is the OS re-focusing the window,
  // which must not throw away the open tab, so only POP navigations return to Tokens.
  useEffect(() => {
    if (!location.pathname.startsWith(TRADE_PATH)) return
    const next = parseTradePath(location.pathname)
    if (location.pathname === TRADE_PATH && navigationType !== 'POP') return
    setMode(next.mode)
    if (next.mode === 'nfts') setPool(next.pool)
  }, [location.pathname, navigationType])

  const onTabKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (index + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length
    go(MODES[next]!.id, pool)
    tabRefs.current[next]?.focus()
  }

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
        <Banner role="img" aria-label="Trade: two winged figures holding hands in an open field" />
        <TabStrip>
          <ModeTabs role="tablist" aria-label="What to trade">
            {MODES.map((m, i) => (
              <button
                key={m.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`trade-tab-${m.id}`}
                aria-selected={mode === m.id}
                aria-controls={`trade-panel-${m.id}`}
                tabIndex={mode === m.id ? 0 : -1}
                onClick={() => go(m.id, pool)}
                onKeyDown={(e) => onTabKey(e, i)}
                data-trade-tab={m.id}
              >
                {m.label}
              </button>
            ))}
          </ModeTabs>
          {offline && mode === 'tokens' && (
            <Status>
              <Chip tone="warn">Offline</Chip>
            </Status>
          )}
        </TabStrip>

        <Panel id="trade-panel-tokens" role="tabpanel" aria-labelledby="trade-tab-tokens" hidden={mode !== 'tokens'}>
          <TokenSwap preset={preset} onOffline={setOffline} />
        </Panel>
        <Panel id="trade-panel-nfts" role="tabpanel" aria-labelledby="trade-tab-nfts" hidden={mode !== 'nfts'}>
          <NftTrade
            pool={pool}
            onOpenPool={(p) => go('nfts', p)}
            onSwapToken={(p) => {
              setPreset({ ...p, key: Date.now() })
              go('tokens')
            }}
            onShowTokens={() => go('tokens')}
          />
        </Panel>
      </Root>
    </WindowWrapper>
  )
}

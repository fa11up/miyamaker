import { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { explorerUrl } from '@/config/wagmi'
import { bevel, color, font, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { findCollection } from '../collections'
import { safeImageUrl } from '../files/sanitize'
import { burst } from './confetti'
import type { MintEvent } from './dedupe'
import { sameAddress, shortAddress } from './dedupe'
import { fireDemoMint, mintFeed, useMintWatcher } from './useMintWatcher'

declare global {
  interface Window {
    __miyaDemoMint?: (opts?: { self?: boolean; to?: string; tokenId?: number | string }) => void
  }
}

const slideIn = keyframes`
  from { transform: translateY(12px); opacity: 0; }
  to { transform: none; opacity: 1; }
`

/* Bottom-right, just above the tray. Click-through except for the links/close button. */
const Stack = styled.div`
  position: fixed;
  right: 8px;
  bottom: calc(var(--taskbar-h) + 8px);
  z-index: 100500;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: ${space[2]};
  pointer-events: none;

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    left: 8px;
    right: 8px;
    align-items: stretch;
    gap: ${space[1]};
  }
`

const Toast = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  width: 280px;
  padding: 3px;
  background: ${color.face};
  box-shadow: ${bevel.raised}, 3px 4px 0 rgba(20, 16, 31, 0.25);
  color: ${color.ink};
  font-size: ${text.sm};
  animation: ${slideIn} 220ms ease-out;
  pointer-events: none;

  &.mine {
    outline: 2px solid ${color.accent};
  }

  .thumb {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    padding: 2px;
    display: grid;
    place-items: center;
    font-size: 20px;
  }
  .thumb img {
    border: none !important;
    margin: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
    line-height: 1.2;
  }
  .title {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  a {
    pointer-events: auto;
    color: ${color.link};
  }
  button {
    pointer-events: auto;
    align-self: flex-start;
    width: 18px;
    height: 16px;
    padding: 0;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    width: auto;
    /* Phones: one slim, click-through ticker line at a time so it never hides much of a window. */
    font-size: ${text.xs};
    gap: ${space[1]};
    padding: 2px;
    opacity: 0.94;
    &:not(:last-child) {
      display: none;
    }
    .thumb {
      width: 24px;
      height: 24px;
      padding: 1px;
      font-size: 12px;
    }
    .sub:last-child {
      display: none;
    }
    /* never block taps on phones: the whole toast is click-through */
    a,
    button {
      pointer-events: none;
    }
    button {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const pop = keyframes`
  0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
  20% { transform: translate(-50%, -50%) scale(1.06); opacity: 1; }
  30% { transform: translate(-50%, -50%) scale(1); }
  85% { opacity: 1; }
  100% { opacity: 0; }
`

const Celebration = styled.div`
  position: fixed;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%);
  z-index: 100600;
  pointer-events: none;
  padding: 3px;
  background: ${color.face};
  box-shadow: ${bevel.raised}, 6px 8px 0 rgba(20, 16, 31, 0.3);
  animation: ${pop} 4.5s ease-out forwards;
  max-width: calc(100vw - 32px);

  .bar {
    padding: 4px 8px;
    background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
    color: ${color.highlight};
    font-weight: 700;
    font-size: ${text.sm};
  }
  .content {
    padding: ${space[4]} ${space[5]};
    text-align: center;
  }
  h2 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xl};
    color: ${color.highlight};
    text-shadow: 2px 2px 0 ${color.accentDark};
  }
  p {
    margin: ${space[2]} 0 0;
    font-size: ${text.sm};
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

type ToastItem = MintEvent & { mine: boolean; at: number }

const TOAST_MS = 7000
const MAX_TOASTS = 3

export default function MintFeed({ enabled }: { enabled: boolean }) {
  const { address } = useAccount()
  const addressRef = useRef(address)
  addressRef.current = address
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [celebrate, setCelebrate] = useState<ToastItem>()

  useMintWatcher(enabled)

  // Dev trigger: window.__miyaDemoMint({ self: true }) or ?demoMint=1 / ?demoMint=me
  useEffect(() => {
    // eslint-disable-next-line no-underscore-dangle -- dev hook name
    window.__miyaDemoMint = (opts) => fireDemoMint(opts)
    let timer: number | undefined
    try {
      const demo = new URLSearchParams(window.location.search).get('demoMint')
      if (demo) timer = window.setTimeout(() => fireDemoMint({ self: demo === 'me' || demo === 'self' }), 2500)
    } catch {
      /* ignore */
    }

    return () => {
      window.clearTimeout(timer)
      // eslint-disable-next-line no-underscore-dangle
      delete window.__miyaDemoMint
    }
  }, [])

  useEffect(
    () =>
      mintFeed.subscribe((event) => {
        const mine = !!event.forceSelf || sameAddress(event.to, addressRef.current)
        const item: ToastItem = { ...event, mine, at: Date.now() }
        setToasts((list) => [...list, item].slice(-MAX_TOASTS))
        window.setTimeout(
          () => setToasts((list) => list.filter((t) => t.key !== item.key)),
          TOAST_MS + (mine ? 4000 : 0)
        )

        const w = window.innerWidth
        const h = window.innerHeight
        const mobile = w <= MOBILE_BREAKPOINT
        if (mine) {
          setCelebrate(item)
          window.setTimeout(() => setCelebrate((c) => (c?.key === item.key ? undefined : c)), 4600)
          burst({ x: 0, y: h * 0.75, angle: -55, spread: 40, count: 120, power: 1100 })
          burst({ x: w, y: h * 0.75, angle: -125, spread: 40, count: 120, power: 1100 })
          window.setTimeout(
            () => burst({ x: w / 2, y: h * 0.42, angle: -90, spread: 360, count: 140, power: 650 }),
            250
          )
        } else {
          // From the tray corner where the toast appears.
          burst({
            x: mobile ? w / 2 : w - 150,
            y: h - 90,
            angle: mobile ? -90 : -105,
            spread: 60,
            count: 60,
            power: 750,
          })
        }
      }),
    []
  )

  const imageFor = (t: ToastItem) => {
    const c = findCollection(t.chainId, t.collection)
    return c?.imageFor ? safeImageUrl(c.imageFor(t.tokenId)) : ''
  }

  return (
    <>
      <Stack aria-live="polite" role="log" aria-label="Live mints">
        {toasts.map((t) => {
          const c = findCollection(t.chainId, t.collection)
          const img = imageFor(t)
          return (
            <Toast key={t.key} className={t.mine ? 'mine' : ''} data-mint-toast="">
              <div className="thumb">{img ? <img src={img} alt="" loading="lazy" /> : '✦'}</div>
              <div className="body">
                <div className="title">
                  #{t.tokenId} minted{t.mine ? ' by you!' : ''}
                </div>
                <div className="sub">
                  {c?.name || shortAddress(t.collection)} · {t.mine ? 'congrats fren' : `by ${shortAddress(t.to)}`}
                </div>
                <div className="sub">
                  {t.demo ? (
                    'demo event'
                  ) : (
                    <a href={`${explorerUrl(t.chainId)}/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer">
                      view tx
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((list) => list.filter((x) => x.key !== t.key))}
              >
                ×
              </button>
            </Toast>
          )
        })}
      </Stack>
      {celebrate && (
        <Celebration role="status" data-mint-celebration="">
          <div className="bar">miyaOS</div>
          <div className="content">
            <h2>YOU MINTED #{celebrate.tokenId}</h2>
            <p>{findCollection(celebrate.chainId, celebrate.collection)?.name || 'a new token'} is in your files ✦</p>
          </div>
        </Celebration>
      )}
    </>
  )
}

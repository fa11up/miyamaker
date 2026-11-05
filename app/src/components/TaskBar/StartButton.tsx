import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components/macro'

import LaunchList from '@/components/LaunchKit/LaunchList'
import { keyOf } from '@/miyamints/collections'
import { useMyLaunches } from '@/miyamints/useMyLaunches'
import { useManageTarget, useOpenManage } from '@/miyamints/useOpenManage'
import { useOpenApp } from '@/music/useOpenApp'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { HighlightButton } from '../Button'

const Menu = styled.div`
  position: fixed;
  left: 2px;
  bottom: calc(var(--taskbar-h, 34px) + env(safe-area-inset-bottom, 0px));
  z-index: 2000;
  width: min(360px, calc(100vw - 4px));
  max-height: min(560px, calc(100vh - var(--taskbar-h, 34px) - 16px));
  display: flex;
  flex-direction: column;
  background: ${color.face};
  box-shadow: ${bevel.raised}, 4px 4px 0 rgba(20, 16, 31, 0.25);
  color: ${color.ink};
`

const Side = styled.div`
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
`

// Night-sky side banner: the screensaver's starfield in a strip. Two star layers (pseudo-elements) twinkle
// out of phase; the wordmark glows like the starfield's sprites.
const STARS_A = [
  'radial-gradient(1px 1px at 6px 18px, #fff 99%, transparent)',
  'radial-gradient(1px 1px at 19px 61px, #fff 99%, transparent)',
  'radial-gradient(1.5px 1.5px at 11px 104px, #fff 99%, transparent)',
  'radial-gradient(1px 1px at 22px 147px, #e9dcff 99%, transparent)',
  'radial-gradient(1px 1px at 4px 189px, #fff 99%, transparent)',
].join(', ')
const STARS_B = [
  'radial-gradient(1px 1px at 16px 34px, #d7c9ff 99%, transparent)',
  'radial-gradient(1.5px 1.5px at 8px 82px, #fff 99%, transparent)',
  'radial-gradient(1px 1px at 24px 121px, #fff 99%, transparent)',
  'radial-gradient(1px 1px at 13px 166px, #f3c6f4 99%, transparent)',
  'radial-gradient(1.5px 1.5px at 20px 208px, #fff 99%, transparent)',
].join(', ')

const Stripe = styled.div`
  position: relative;
  overflow: hidden;
  flex: 0 0 28px;
  background: radial-gradient(120% 40% at 50% 100%, rgba(217, 122, 218, 0.45), transparent 70%),
    linear-gradient(0deg, #6f6894 0%, #2a2350 38%, ${color.dark} 100%);
  color: ${color.highlight};
  font-family: ${font.display};
  font-size: ${text.sm};
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  display: flex;
  align-items: center;
  padding: ${space[2]} 0;
  letter-spacing: 0.12em;
  text-shadow: 0 0 4px #d7c9ff, 0 0 10px ${color.titleFrom}, 1px 1px 0 ${color.dark};
  &::before,
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background-size: 28px 224px;
    background-repeat: repeat-y;
    pointer-events: none;
    animation: miya-twinkle 3.2s ease-in-out infinite alternate;
  }
  &::before {
    background-image: ${STARS_A};
  }
  &::after {
    background-image: ${STARS_B};
    animation-delay: -1.6s;
  }
  > span {
    position: relative;
    z-index: 1;
  }
  > span::before {
    content: '✦';
    display: inline-block;
    margin-bottom: 6px;
    font-size: 0.8em;
    color: #fff4c2;
    text-shadow: 0 0 6px #fff4c2;
  }
  @keyframes miya-twinkle {
    from {
      opacity: 0.25;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    &::before,
    &::after {
      animation: none;
      opacity: 0.8;
    }
  }
`

const Content = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: ${space[1]};
  gap: ${space[1]};
  min-height: 0;
`

const Account = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  font-size: ${text.sm};
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .net {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
`

const Heading = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: ${space[2]} ${space[2]} 0;
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.inkMuted};
`

const Scroll = styled.div`
  overflow-y: auto;
  min-height: 0;
  flex: 1 1 auto;
`

const MenuItem = styled.button`
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: 0 ${space[2]};
  border: none;
  border-radius: 0;
  background: transparent;
  color: ${color.ink};
  font: inherit;
  font-size: ${text.sm};
  text-align: left;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    background: ${color.titleTo};
    color: ${color.highlight};
    outline: none;
  }
`

const Sep = styled.hr`
  border: none;
  margin: ${space[1]} 0;
  height: 2px;
  box-shadow: inset 0 1px ${color.shadow}, inset 0 -1px ${color.highlight};
`

const CTA = styled.button`
  border: none;
  border-radius: 0;
  min-height: 40px;
  padding: 0 ${space[4]};
  background: ${color.accent};
  color: ${color.ink};
  font-family: ${font.display};
  font-size: ${text.sm};
  text-shadow: 1px 1px 0 #f5c6f6;
  box-shadow: inset -2px -2px ${color.accentDark}, inset 2px 2px #f5c6f6;
  cursor: pointer;
  &:focus-visible {
    outline: 2px dotted ${color.dark};
    outline-offset: -5px;
  }
`

type Props = {
  connected: boolean
  displayName?: string
  chainName?: string
  onClose: () => void
  onConnect: () => void
  onWallet: () => void
}

function StartMenu({ connected, displayName, chainName, onClose, onConnect, onWallet }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const openApp = useOpenApp()
  const openManage = useOpenManage()
  const target = useManageTarget()
  const { launches, loading, error, refetch } = useMyLaunches()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])
        if (!items.length) return
        e.preventDefault()
        const i = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }

    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      if (ref.current?.contains(el) || el.closest('[data-start-button]')) return
      closeRef.current()
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  const go = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return createPortal(
    <Menu ref={ref} role="menu" aria-label="Start menu" data-start-menu>
      <Side>
        <Stripe aria-hidden>
          <span>miyaOS</span>
        </Stripe>
        <Content>
          {connected ? (
            <>
              <Account>
                <span style={{ minWidth: 0 }}>
                  <div className="who">{displayName}</div>
                  <div className="net">{chainName}</div>
                </span>
                <HighlightButton role="menuitem" onClick={go(onWallet)} style={{ flex: '0 0 auto' }}>
                  Wallet
                </HighlightButton>
              </Account>
              <Heading>
                <span>My launches</span>
                {!loading && launches.length > 0 && <span>{launches.length}</span>}
              </Heading>
              <Scroll>
                <LaunchList
                  launches={launches}
                  loading={loading}
                  error={error}
                  onRetry={() => refetch()}
                  currentKey={target ? keyOf(target) : undefined}
                  onPick={(l) => {
                    openManage({ chainId: l.chainId, address: l.address, kind: l.kind })
                    onClose()
                  }}
                  onLaunch={go(() => openApp('launch'))}
                />
              </Scroll>
            </>
          ) : (
            <div style={{ padding: space[3], display: 'flex', flexDirection: 'column', gap: space[3] }}>
              <b style={{ fontSize: text.md }}>My launches</b>
              <span style={{ fontSize: text.sm, lineHeight: 1.4 }}>
                Connect a wallet to see the collections you launched.
              </span>
              <div>
                <CTA type="button" role="menuitem" onClick={go(onConnect)}>
                  Connect wallet
                </CTA>
              </div>
            </div>
          )}
          <Sep />
          <MenuItem type="button" role="menuitem" onClick={go(() => openApp('launch'))}>
            Launch a new collection
          </MenuItem>
          <MenuItem type="button" role="menuitem" onClick={go(() => openManage(undefined))}>
            Manage by address…
          </MenuItem>
        </Content>
      </Side>
    </Menu>,
    document.body
  )
}

export default function StartButton() {
  const [open, setOpen] = useState(false)

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted
        const connected = !!(ready && account && chain)

        if (connected && chain?.unsupported) {
          return (
            <div style={{ height: '100%' }}>
              <HighlightButton
                onClick={openChainModal}
                className="free-height free-width"
                style={{ height: '100%', paddingLeft: 10, paddingRight: 10 }}
              >
                <span style={{ marginTop: -1 }}>Wrong network</span>
              </HighlightButton>
            </div>
          )
        }

        return (
          <div
            {...(!ready
              ? { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' } }
              : { style: { height: '100%' } })}
          >
            <HighlightButton
              data-start-button
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              title={connected ? `${account?.displayName}: my launches` : 'Start'}
              className={`free-height free-width ${open ? 'focus-taskbar' : ''}`}
              style={{ height: '100%', paddingLeft: 8, paddingRight: 12, fontWeight: 700 }}
            >
              <span style={{ marginTop: -1 }}>🖤 Start</span>
            </HighlightButton>
            {open && (
              <StartMenu
                connected={connected}
                displayName={account?.displayName}
                chainName={chain?.name}
                onClose={() => setOpen(false)}
                onConnect={() => openConnectModal()}
                onWallet={() => openAccountModal()}
              />
            )}
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}

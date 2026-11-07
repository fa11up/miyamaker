import angelGif from 'assets/88x31/angel99.gif'
import angelStill from 'assets/88x31/angel99.png'
import coffeeGif from 'assets/88x31/coffee.gif'
import coffeeStill from 'assets/88x31/coffee.png'
import togetherGif from 'assets/88x31/together.gif'
import togetherStill from 'assets/88x31/together.png'
import girlsArt from 'assets/imd/girls.webp'
import latheArt from 'assets/imd/lathe.webp'
import medallionArt from 'assets/imd/medallion.webp'
import networkArt from 'assets/imd/network.webp'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled, { keyframes } from 'styled-components/macro'

import LaunchList from '@/components/LaunchKit/LaunchList'
import { preloadApp } from '@/constants/appLoaders'
import { PROGRAM_GROUPS } from '@/constants/programs'
import { setPrefs, startScreensaverPreview, useDesktopPrefs } from '@/desktop/prefs'
import { keyOf } from '@/miyamints/collections'
import { useMyLaunches } from '@/miyamints/useMyLaunches'
import { useManageTarget, useOpenManage } from '@/miyamints/useOpenManage'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { minimizeWindow } from '@/store/windows/actions'
import { useWindows } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { HighlightButton } from '../Button'

const Menu = styled.div`
  position: fixed;
  left: 2px;
  bottom: calc(var(--taskbar-h, 34px) + env(safe-area-inset-bottom, 0px));
  z-index: 2000;
  width: min(540px, calc(100vw - 4px));
  max-height: calc(100dvh - var(--taskbar-h, 34px) - 16px);
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
  flex: 0 0 34px;
  background: radial-gradient(120% 40% at 50% 100%, rgba(217, 122, 218, 0.45), transparent 70%),
    linear-gradient(0deg, #6f6894 0%, #2a2350 38%, ${color.dark} 100%);
  color: ${color.highlight};
  font-family: ${font.display};
  font-size: ${text.lg};
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
    background-size: 34px 224px;
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

const Columns = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  /* A phone's single column, scrolled as one. */
  @media (max-width: 560px) {
    flex-direction: column;
    overflow-y: auto;
  }
`

const ProgramsColumn = styled.div`
  flex: 1 1 0;
  min-width: 0;
  overflow-y: auto;
  padding: ${space[1]};
  /* An etched line down to the other column, as the OS's separators are. */
  box-shadow: inset -1px 0 ${color.shadow}, inset -2px 0 ${color.highlight};
  @media (max-width: 560px) {
    flex: none;
    overflow-y: visible;
    box-shadow: inset 0 -1px ${color.shadow}, inset 0 -2px ${color.highlight};
  }
`

const PlacesColumn = styled.div`
  flex: 0 0 216px;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: ${space[2]} ${space[1]} ${space[1]};
  @media (max-width: 560px) {
    flex: none;
    overflow-y: visible;
  }
`

const Group = styled.div`
  display: flex;
  flex-direction: column;
  @media (max-width: 560px) {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2px;
  }
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
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]} ${space[2]} ${space[1]};
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.inkMuted};
  &::after {
    content: '';
    flex: 1;
    height: 2px;
    box-shadow: inset 0 1px ${color.shadow}, inset 0 -1px ${color.highlight};
  }
`

const MenuItem = styled.button`
  width: 100%;
  min-height: 32px;
  flex-shrink: 0;
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
    background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
    color: ${color.highlight};
    outline: none;
  }
  @media (max-width: 560px) {
    min-height: 44px;
  }
`

/** A program: a row on a desktop, a tile to thumb on a phone. */
const Program = styled(MenuItem)`
  @media (max-width: 560px) {
    min-height: 68px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: ${space[1]} 2px;
    font-size: ${text.xs};
    line-height: 1.1;
    text-align: center;
  }
`

const ProgramIcon = styled.img`
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  margin: 0;
  border: none;
  object-fit: contain;
  @media (max-width: 560px) {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
  }
`

const CTA = styled.button`
  flex: none;
  width: 100%;
  min-height: 36px;
  border: none;
  border-radius: 0;
  background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
  color: ${color.highlight};
  font: inherit;
  font-size: ${text.sm};
  font-weight: 700;
  text-shadow: 1px 1px 0 ${color.accentDark};
  box-shadow: inset -1px -1px ${color.dark}, inset 1px 1px ${color.highlight}, inset -2px -2px ${color.accentDark},
    inset 2px 2px #f5c6f6;
  cursor: pointer;
  &:active {
    box-shadow: inset 1px 1px ${color.dark}, inset -1px -1px ${color.highlight};
  }
  &:focus-visible {
    outline: 1px dotted ${color.highlight};
    outline-offset: -5px;
  }
`

const WalletSlot = styled.div`
  padding: ${space[2]} ${space[1]} 0;
`

const flash = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
`
const colours = keyframes`
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
`
const pan = keyframes`
  to { background-position: -70px -40px; }
`
const breathe = keyframes`
  0%, 100% { text-shadow: 1px 1px 0 #000, 0 0 2px #39ff14; }
  50% { text-shadow: 1px 1px 0 #000, 0 0 9px #39ff14, 0 0 16px #39ff14; }
`
const coinFlip = keyframes`
  to { transform: rotateY(360deg); }
`
const crawl = keyframes`
  from { transform: translateX(200px); }
  to { transform: translateX(-100%); }
`

/* The bottom of every home page in 1998, for INFER and imdUSD: a wall of buttons that go nowhere, with art from their sites.
   A phone's menu has no room going spare. */
const BannerWall = styled.div`
  flex: 1 1 0;
  min-height: 0;
  margin-top: ${space[2]};
  padding: 0 ${space[1]};
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: space-evenly;
  gap: 4px;
  pointer-events: none;
  user-select: none;
  @media (max-width: 560px) {
    display: none;
  }
  .ticker {
    flex: 0 0 100%;
    height: 18px;
    overflow: hidden;
    background: #000;
    color: #39ff14;
    font-size: ${text.xs};
    line-height: 18px;
    white-space: nowrap;
    box-shadow: ${bevel.sunken};
  }
  .ticker span {
    display: inline-block;
    animation: ${crawl} 9s linear infinite;
  }
  picture {
    flex: none;
    display: block;
    width: 88px;
    height: 31px;
  }
  picture img {
    display: block;
    margin: 0;
    border: none;
    image-rendering: pixelated;
  }
  b {
    flex: none;
    width: 88px;
    height: 31px;
    display: grid;
    place-items: center;
    padding: 0 2px;
    box-sizing: border-box;
    border: 1px solid #000;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    text-align: center;
  }
  b.wide {
    flex: 0 0 100%;
    width: auto;
    height: 46px;
    align-items: end;
    padding-bottom: 3px;
  }
  b.wide em {
    padding: 1px 3px;
    background: rgba(20, 4, 40, 0.8);
  }
  b.coin {
    grid-auto-flow: column;
    gap: 3px;
    justify-content: center;
  }
  b.coin img {
    width: 26px;
    height: 26px;
    margin: 0;
    border: none;
  }
  b.flash em {
    animation: ${flash} 0.9s steps(1) infinite;
  }
  /* The sites' art keeps moving, as it does on the sites: there and back, so its edges never jump. */
  b.drift {
    animation: ${pan} 7s ease-in-out infinite alternate;
  }
  b.glow em {
    animation: ${breathe} 2s ease-in-out infinite;
  }
  b.coin img {
    animation: ${coinFlip} 2.6s linear infinite;
  }
  b em {
    font-style: normal;
    text-shadow: 1px 1px 0 #000;
  }
  b.rainbow {
    animation: ${colours} 3s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    b.flash em,
    b.drift,
    b.glow em,
    b.coin img,
    b.rainbow,
    .ticker span {
      animation: none;
    }
  }
`

/** A real button of the time, from cyber.dabamos.de/88x31. A GIF can't be paused, so reduced motion gets its first frame. */
function OldButton({ gif, still }: { gif: string; still: string }) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={still} />
      <img src={gif} alt="" width={88} height={31} />
    </picture>
  )
}

function Banners() {
  return (
    <BannerWall aria-hidden data-testid="start-banners">
      <div className="ticker">
        <span>*** imdUSD IS A DOLLAR, NOT AN INVESTMENT *** BURN MIYA. GET INFER. ***</span>
      </div>
      <b
        className="wide flash"
        style={{ background: `#3a0e5c url(${girlsArt}) center 12% / cover`, color: '#fff35c' }}
      >
        <em>MANY DOLLARS IN MY VAULT!!!</em>
      </b>
      <OldButton gif={togetherGif} still={togetherStill} />
      <b className="drift glow" style={{ background: `url(${networkArt}) 0 0 / 170px, #05080b`, color: '#39ff14' }}>
        <em>INFER</em>
      </b>
      <OldButton gif={angelGif} still={angelStill} />
      <b className="coin drift" style={{ background: `url(${latheArt}) 0 0 / 200px, #1f1257`, color: '#fff' }}>
        <img src={medallionArt} alt="" />
        <em>imdUSD</em>
      </b>
      <b className="rainbow" style={{ background: 'linear-gradient(90deg, #ff4fd8, #27d3ff)', color: '#fff' }}>
        <em>THE SWARM PRICES IT</em>
      </b>
      <OldButton gif={coffeeGif} still={coffeeStill} />
    </BannerWall>
  )
}

const Note = styled.span`
  padding: 0 ${space[2]} ${space[1]};
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
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
  const dispatch = useAppDispatch()
  const [windows, , , minimized] = useWindows()
  const prefs = useDesktopPrefs()
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
        <Columns>
          <ProgramsColumn>
            {PROGRAM_GROUPS.map((group) => (
              <div key={group.label}>
                <Heading>
                  <span>{group.label}</span>
                </Heading>
                <Group>
                  {group.apps.map((app) => (
                    <Program
                      key={app.id}
                      type="button"
                      role="menuitem"
                      onPointerEnter={() => preloadApp(app.id)}
                      onPointerDown={() => preloadApp(app.id)}
                      onFocus={() => preloadApp(app.id)}
                      onClick={go(() => openApp(app.id))}
                    >
                      <ProgramIcon src={app.src} alt="" />
                      {app.label}
                    </Program>
                  ))}
                </Group>
              </div>
            ))}
          </ProgramsColumn>
          <PlacesColumn>
            <Heading>
              <span>Desktop</span>
            </Heading>
            <MenuItem
              type="button"
              role="menuitem"
              onClick={go(() =>
                windows
                  .filter((id) => !minimized.includes(id))
                  .forEach((id) => dispatch(minimizeWindow({ value: id })))
              )}
            >
              Show desktop
            </MenuItem>
            <MenuItem type="button" role="menuitem" onClick={go(() => setPrefs({ petEnabled: !prefs.petEnabled }))}>
              {prefs.petEnabled ? 'Hide desktop pet' : 'Show desktop pet'}
            </MenuItem>
            <MenuItem type="button" role="menuitem" onClick={go(() => window.setTimeout(startScreensaverPreview, 150))}>
              Start screen saver
            </MenuItem>
            <Heading>
              <span>My launches{connected && !loading && launches.length > 0 ? ` (${launches.length})` : ''}</span>
            </Heading>
            {connected ? (
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
            ) : (
              <Note>Connect a wallet to see the collections you launched.</Note>
            )}
            <MenuItem type="button" role="menuitem" onClick={go(() => openApp('launch'))}>
              Launch a new collection
            </MenuItem>
            <MenuItem type="button" role="menuitem" onClick={go(() => openManage(undefined))}>
              Manage by address…
            </MenuItem>
            <WalletSlot>
              {connected ? (
                <Account>
                  <span style={{ minWidth: 0 }}>
                    <div className="who">{displayName}</div>
                    <div className="net">{chainName}</div>
                  </span>
                  <HighlightButton role="menuitem" onClick={go(onWallet)} style={{ flex: '0 0 auto' }}>
                    Wallet
                  </HighlightButton>
                </Account>
              ) : (
                <CTA type="button" role="menuitem" onClick={go(onConnect)}>
                  Connect wallet
                </CTA>
              )}
            </WalletSlot>
            <Banners />
          </PlacesColumn>
        </Columns>
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
        const wrongNetwork = connected && !!chain?.unsupported

        return (
          <div
            {...(!ready
              ? { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' } }
              : { style: { height: '100%', display: 'flex' } })}
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
            {wrongNetwork && (
              <HighlightButton
                onClick={openChainModal}
                className="free-height free-width"
                style={{ height: '100%', paddingLeft: 10, paddingRight: 10 }}
              >
                <span style={{ marginTop: -1 }}>Wrong network</span>
              </HighlightButton>
            )}
            {open && (
              <StartMenu
                connected={connected}
                displayName={account?.displayName}
                chainName={wrongNetwork ? 'Wrong network' : chain?.name}
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

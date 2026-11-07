/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useWindowSize } from 'usehooks-ts'

import DynamicWrapper from '@/components/DynamicWrapper'
import OsLoader from '@/components/OsLoader'
import TaskBar from '@/components/TaskBar'
import Pages from '@/constants/pages'
import { DESKTOP_ICONS } from '@/constants/programs'
import { DesktopOverlays, DesktopPetLayer } from '@/desktop'
import DesktopIconGrid from '@/desktop/icons/DesktopIconGrid'
import { canonicalPath } from '@/pages/Swap/tradePath'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow, openWindow, setToFront } from '@/store/windows/actions'
import { useWindows } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { MOBILE_BREAKPOINT } from '@/theme/tokens'

import Background from './Background'
import FourthWall from './FourthWall'
import NotFound from './NotFound'
import Windows from './Windows'

const Foreground = styled.div`
  position: relative;
  z-index: 1;
  height: calc(100svh - var(--taskbar-h));
  pointer-events: none;
  /* miyaTV tilted on a phone is the whole screen: the taskbar steps off the bottom for it. */
  @media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) {
    &:has(.is-focused:not(.minimized) [data-testid='miyatv']) {
      height: 100svh;
    }
  }
  * {
    pointer-events: auto;
  }
`

const WindowContainer = styled.div<{ mobile?: boolean }>`
  position: absolute;
  z-index: 1000;
  height: 100%;
  width: 100%;
  pointer-events: none;
  > * {
    pointer-events: auto;
  }
  > .fullscreen {
    transform: translate(0, 0) !important;
    width: 100% !important;
    height: 100% !important;
  }

  > .minimized {
    display: none;
  }

  ${({ mobile }) =>
    mobile &&
    `
  > .react-draggable {
    transform: translate(0, 0) !important;
    width: 100% !important;
    height: 100% !important;
  }
  /* Phones: one app at a time, switch from the taskbar. */
  > .react-draggable:not(.is-focused) {
    display: none;
  }
  /* Small jobs float over the desktop at the size of their content. */
  > .react-draggable.phone-card {
    left: 12px;
    top: 50%;
    transform: translate(0, -50%) !important;
    width: calc(100% - 24px) !important;
    height: auto !important;
  }
  > .react-draggable.phone-card > * {
    position: relative !important;
    max-height: calc(100dvh - var(--taskbar-h, 34px) - 24px);
    overflow-y: auto !important;
  }
  `}
`

const Icons = styled.div`
  position: relative;
  z-index: 999;
  height: 100%;
  width: 100%;
  pointer-events: none;
  * {
    pointer-events: auto;
  }
`

export default function OperatingSystem() {
  const location = useLocation()
  const navigate = useNavigate()
  /* Responsiveness stuff */
  const { width, height } = useWindowSize()
  // A phone on its side is still a phone, however wide it has become.
  const isMobile =
    width > 0 &&
    (width <= MOBILE_BREAKPOINT || (height <= 500 && window.matchMedia('(pointer: coarse)').matches))
  const [missing, setMissing] = useState<string>()

  /* Redux stuff */
  const dispatch = useAppDispatch()
  const [windows, zindex, fullScreen, minimized] = useWindows()
  const onTop = useAppSelector((state) => state.windows.onTop)
  const firstLoad = useAppSelector((state) => state.experience.firstLoad)
  // The boot screen greets visitors to the desktop itself; a shared link (/mint/...) goes straight to its window.
  const [bootHere] = useState(() => location.pathname === '/')

  const handleOpen = (id: string) => {
    if (windows.includes(id)) {
      dispatch(setToFront({ value: id }))
      return
    }

    const page = Pages[id]
    if (!page) return
    dispatch(
      openWindow({
        value: id,
        position: {
          x: Math.max(0, width / 2 - page.minSize.width / 2),
          y: Math.max(0, (height - 34) / 2 - page.minSize.height / 2),
        },
      })
    )
  }

  useEffect(() => {
    // Renamed windows: an in-app link to an old path (/swap) lands on the new one (/trade).
    const renamed = canonicalPath(`${location.pathname}${location.search}`)
    if (renamed) {
      navigate(renamed, { replace: true })
      return
    }

    // App names match whatever their case (/MINT is /mint); the rest of the path is left alone.
    const lower = location.pathname.replace(/^\/[^/]+/, (head) => head.toLowerCase())
    if (lower !== location.pathname) {
      navigate(`${lower}${location.search}`, { replace: true })
      return
    }

    // Sub-paths open their window too (e.g. /mint/miyamini opens Mint, which picks the view from the path).
    const page = Object.values(Pages).find(
      (p) => p.path === location.pathname || location.pathname.startsWith(`${p.path}/`)
    )
    if (!page && location.pathname !== '/') {
      setMissing(location.pathname)
      navigate('/', { replace: true })
      return
    }

    if (!page || !width) return
    if (!windows.includes(page.id)) {
      handleOpen(page.id)
      return
    }

    const index = zindex.indexOf(page.id)
    if (index !== zindex.length - 1 || index === -1) {
      dispatch(setToFront({ value: page.id }))
    }
  }, [location, width])

  const handleTaskbar = (id: string) => {
    if (minimized.includes(id) || zindex[zindex.length - 1] !== id) {
      dispatch(setToFront({ value: id }))
      return
    }

    dispatch(minimizeWindow({ value: id }))
  }

  const MemoizedWindows = useMemo(() => {
    return windows.map((window) => {
      const page = Pages[window]!
      return (
        <Fragment key={`${window}-window`}>
          <Windows
            minimized={minimized.includes(window)}
            focused={zindex[zindex.length - 1] === window && !minimized.includes(window)}
            mobile={isMobile || fullScreen.includes(window)}
            baseDepth={zindex.indexOf(window) * 1000 + 2000 + (onTop?.includes(window) ? 100000 : 0)}
            identifier={window}
            label={page.label}
            baseSize={page.minSize}
            shaped={page.shaped}
            noTrail={page.noTrail}
            fixedSize={page.fixedSize}
            corner={page.corner}
            onClick={() => zindex.indexOf(window) !== zindex.length - 1 && dispatch(setToFront({ value: window }))}
          >
            <DynamicWrapper identifier={window} />
          </Windows>
        </Fragment>
      )
    })
  }, [windows, zindex, fullScreen, isMobile, minimized, onTop])

  return (
    <div className="bwindow" style={{ height: '100%', overflow: 'hidden', position: 'relative', zIndex: 0 }}>
      <Helmet>
        {zindex[zindex.length - 1] ? (
          <title>🖤{Pages[zindex[zindex.length - 1] || '']?.label}🖤</title>
        ) : (
          <title>🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤</title>
        )}
      </Helmet>
      {firstLoad && bootHere && <OsLoader />}
      <Background />
      <Foreground>
        <WindowContainer mobile={isMobile}>{MemoizedWindows}</WindowContainer>
        <Icons>
          <DesktopIconGrid icons={DESKTOP_ICONS} onOpen={handleOpen} />
        </Icons>
        <FourthWall />
        <DesktopPetLayer />
      </Foreground>
      <TaskBar
        active={windows}
        focus={zindex[zindex.length - 1]}
        onClick={(id) => handleTaskbar(id)}
        mobile={isMobile}
      />
      <DesktopOverlays />
      {missing && <NotFound path={missing} onClose={() => setMissing(undefined)} />}
    </div>
  )
}

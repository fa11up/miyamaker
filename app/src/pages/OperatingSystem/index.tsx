/* eslint-disable @typescript-eslint/no-non-null-assertion */
import MiyaLogo from 'assets/134321870.png'
import CreateNew from 'assets/miyamints1.png?preset=thumbnail&resize=true'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useWindowSize } from 'usehooks-ts'

import DynamicWrapper from '@/components/DynamicWrapper'
import OsLoader from '@/components/OsLoader'
import TaskBar from '@/components/TaskBar'
import Pages from '@/constants/pages'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow, openWindow, setToFront } from '@/store/windows/actions'
import { useWindows } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { MOBILE_BREAKPOINT } from '@/theme/tokens'

import AppSwitcher from './AppSwitcher'
import Background from './Background'
import DesktopIcon from './DesktopIcon'
import FourthWall from './FourthWall'
import Windows from './Windows'

const Foreground = styled.div`
  position: relative;
  z-index: 1;
  height: calc(100svh - var(--taskbar-h));
  pointer-events: none;
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
  /* Phones: one app at a time, switch via the taskbar app switcher. */
  > .react-draggable:not(.is-focused) {
    display: none;
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

/* Desktop: icons flow top-to-bottom in columns, like a real desktop. Phones: a home-screen grid. */
const IconGrid = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(auto-fill, 104px);
  grid-auto-columns: 96px;
  gap: 8px;
  padding: 16px;
  height: 100%;
  width: max-content;
  align-content: start;

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    grid-auto-flow: row;
    grid-template-rows: none;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    grid-auto-columns: auto;
    width: 100%;
    height: auto;
    padding: 24px 16px;
    row-gap: 20px;
  }
`

// const ComponentPage = Pages.components
export type DesktopApp = { id: PageKey; label: string; src: string | undefined }

const DESKTOP_ICONS: DesktopApp[] = [
  { id: 'mint', label: Pages.mint?.label || 'Mint', src: Pages.mint?.icon?.src },
  { id: 'swap', label: Pages.swap?.label || 'Swap', src: Pages.swap?.icon?.src },
  { id: 'home', label: 'miyanet', src: MiyaLogo },
  { id: 'launch', label: 'Launch', src: CreateNew[0]?.src },
  { id: 'manager', label: Pages.manager?.label || 'Manager', src: Pages.manager?.icon?.src },
  { id: 'auction', label: Pages.auction?.label || 'Auction', src: Pages.auction?.icon?.src },
  { id: 'uploader', label: Pages.uploader?.label || 'Upload', src: Pages.uploader?.icon?.src },
]

export default function OperatingSystem() {
  const location = useLocation()
  /* Responsiveness stuff */
  const { width, height } = useWindowSize()
  const isMobile = width > 0 && width <= MOBILE_BREAKPOINT
  const [switcherOpen, setSwitcherOpen] = useState(false)

  /* Redux stuff */
  const dispatch = useAppDispatch()
  const [windows, zindex, fullScreen, minimized] = useWindows()
  const firstLoad = useAppSelector((state) => state.experience.firstLoad)

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
    const page = Object.values(Pages).find((p) => p.path === location.pathname)
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
            baseDepth={zindex.indexOf(window) * 1000 + 2000}
            identifier={window}
            baseSize={page.minSize}
            onClick={() => zindex.indexOf(window) !== zindex.length - 1 && dispatch(setToFront({ value: window }))}
          >
            <DynamicWrapper identifier={window} />
          </Windows>
        </Fragment>
      )
    })
  }, [windows, zindex, fullScreen, isMobile, minimized])

  return (
    <div className="bwindow" style={{ height: '100%', overflow: 'hidden', position: 'relative', zIndex: 0 }}>
      <Helmet>
        {zindex[zindex.length - 1] ? (
          <title>🖤{Pages[zindex[zindex.length - 1] || '']?.label}🖤</title>
        ) : (
          <title>🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤</title>
        )}
      </Helmet>
      {firstLoad && <OsLoader />}
      <Background />
      <Foreground>
        <WindowContainer mobile={isMobile}>{MemoizedWindows}</WindowContainer>
        <Icons>
          <IconGrid>
            {DESKTOP_ICONS.map((icon) => (
              <DesktopIcon key={icon.id} normalState={icon.src} onClick={() => handleOpen(icon.id)}>
                {icon.label}
              </DesktopIcon>
            ))}
          </IconGrid>
        </Icons>
      </Foreground>
      <TaskBar
        active={windows}
        focus={zindex[zindex.length - 1]}
        onClick={(id) => handleTaskbar(id)}
        mobile={isMobile}
        onOpenSwitcher={() => setSwitcherOpen((open) => !open)}
        onHome={() => {
          const top = zindex[zindex.length - 1]
          if (top) dispatch(minimizeWindow({ value: top }))
        }}
      />
      {isMobile && switcherOpen && (
        <AppSwitcher
          open={windows}
          focus={zindex[zindex.length - 1]}
          apps={DESKTOP_ICONS}
          onSelect={(id) => {
            setSwitcherOpen(false)
            handleOpen(id)
          }}
          onClose={(id) => dispatch(closeWindow({ value: id }))}
          onDismiss={() => setSwitcherOpen(false)}
        />
      )}
      <FourthWall />
    </div>
  )
}

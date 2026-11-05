import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { BUILD_PATH } from '@/pages/Build/starters'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import Home from './page'

const Build = lazy(() => import('@/pages/Build'))

const page = Pages.home

export default function MiyanetPage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('home')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'home' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'home' }))

  // The explorer's pages: /about is the portal, /about/build is Build with the swarm. A plain push to /about is the
  // OS re-focusing the window, which must not drop the page being viewed, so only Back (POP) or the page's own
  // "← miyanet" returns to the portal.
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const onBuild = location.pathname.startsWith(BUILD_PATH)
  const [view, setView] = useState<'portal' | 'build'>(onBuild ? 'build' : 'portal')
  useEffect(() => {
    if (onBuild) setView('build')
    else if (location.pathname === page?.path && navigationType === 'POP') setView('portal')
  }, [location.pathname, navigationType])
  const home = () => {
    setView('portal')
    navigate(page?.path ?? '/about')
  }

  return (
    <WindowWrapper skin="miyanet">
      <TitleBar
        skin="miyanet"
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
      {view === 'build' ? (
        <Suspense fallback={null}>
          <Build onHome={home} />
        </Suspense>
      ) : (
        <Home />
      )}
    </WindowWrapper>
  )
}

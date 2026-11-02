import { lazy, Suspense, useMemo } from 'react'

import { HighlightButton } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow } from '@/store/windows/actions'

const Launch = lazy(() => import('@/pages/Launch'))
const Home = lazy(() => import('@/pages/Home'))
const Components = lazy(() => import('@/pages/Components'))
const Uploader = lazy(() => import('@/pages/Uploader'))
const Manager = lazy(() => import('@/pages/Manage'))
const Auction = lazy(() => import('@/pages/Auction'))
const Mint = lazy(() => import('@/pages/Mint'))
const Swap = lazy(() => import('@/pages/Swap'))
const MyFiles = lazy(() => import('@/desktop/files/MyFiles'))
const DisplayProperties = lazy(() => import('@/desktop/display/DisplayProperties'))

/** Shown in place of a window whose app threw while rendering. The rest of the desktop keeps working. */
function CrashedWindow({ identifier, error, reset }: { identifier: string; error: Error; reset: () => void }) {
  const dispatch = useAppDispatch()
  const close = (e?: { cancelable?: boolean; stopPropagation?: () => void }) => {
    if (e?.cancelable) e.stopPropagation?.()
    dispatch(closeWindow({ value: identifier }))
  }

  const label = Pages[identifier]?.label || identifier
  return (
    <WindowWrapper>
      <TitleBar closeBtn onClose={close}>
        {label}
      </TitleBar>
      <div role="alert" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <b>This app crashed.</b>
        <p style={{ margin: 0 }}>{label} hit an unexpected error. Reload it or close the window.</p>
        <code style={{ wordBreak: 'break-word', fontSize: '0.75rem', opacity: 0.8 }}>{error.message}</code>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {/* A failed chunk import stays rejected inside React.lazy, so that case needs a full page reload. */}
          <HighlightButton
            onClick={() =>
              /dynamically imported module|Loading chunk/i.test(error.message) ? window.location.reload() : reset()
            }
          >
            Reload
          </HighlightButton>
          <HighlightButton onClick={() => close()}>Close</HighlightButton>
        </div>
      </div>
    </WindowWrapper>
  )
}
const TV = lazy(() => import('@/pages/TV'))
const Radio = lazy(() => import('@/pages/Radio'))
const DropMusic = lazy(() => import('@/pages/DropMusic'))

export default function DynamicWrapper({ identifier }: { identifier: string }) {
  const component = useMemo(() => {
    switch (identifier) {
      case 'launch':
        return <Launch />
      case 'home':
        return <Home />
      case 'components':
        return <Components />
      case 'uploader':
        return <Uploader />
      case 'manager':
        return <Manager />
      case 'auction':
        return <Auction />
      case 'mint':
        return <Mint />
      case 'swap':
        return <Swap />
      case 'files':
        return <MyFiles />
      case 'display':
        return <DisplayProperties />
      case 'tv':
        return <TV />
      case 'radio':
        return <Radio />
      case 'dropmusic':
        return <DropMusic />
      default:
        return <></>
    }
  }, [identifier])
  return (
    <ErrorBoundary
      name={identifier}
      fallback={({ error, reset }) => <CrashedWindow identifier={identifier} error={error} reset={reset} />}
    >
      <Suspense fallback={<></>}>{component}</Suspense>
    </ErrorBoundary>
  )
}

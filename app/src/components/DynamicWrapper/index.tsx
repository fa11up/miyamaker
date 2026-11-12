import { lazy, Suspense, useMemo } from 'react'

import { HighlightButton } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import { isChunkLoadError } from '@/components/ErrorBoundary/chunkError'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { APP_LOADERS } from '@/constants/appLoaders'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow } from '@/store/windows/actions'

const Launch = lazy(APP_LOADERS.launch!)
const Home = lazy(APP_LOADERS.home!)
const Uploader = lazy(APP_LOADERS.uploader!)
const Manager = lazy(APP_LOADERS.manager!)
const Auction = lazy(APP_LOADERS.auction!)
const Mint = lazy(APP_LOADERS.mint!)
const Swap = lazy(APP_LOADERS.swap!)
const MyFiles = lazy(APP_LOADERS.files!)
const DisplayProperties = lazy(APP_LOADERS.display!)

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
        {/* The raw text is for whoever reports the bug, so it waits behind a toggle. */}
        <details style={{ fontSize: '0.75rem' }}>
          <summary style={{ cursor: 'pointer' }}>Details</summary>
          <code style={{ wordBreak: 'break-word', opacity: 0.8 }}>{error.message}</code>
        </details>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {/* A failed chunk import stays rejected inside React.lazy, so that case needs a full page reload. */}
          <HighlightButton onClick={() => (isChunkLoadError(error.message) ? window.location.reload() : reset())}>
            Reload
          </HighlightButton>
          <HighlightButton onClick={() => close()}>Close</HighlightButton>
        </div>
      </div>
    </WindowWrapper>
  )
}

const TV = lazy(APP_LOADERS.tv!)
const Radio = lazy(APP_LOADERS.radio!)
const DropMusic = lazy(APP_LOADERS.dropmusic!)
const MusicMaker = lazy(APP_LOADERS.music!)
const Miyakeys = lazy(APP_LOADERS.miyakeys!)

export default function DynamicWrapper({ identifier }: { identifier: string }) {
  const component = useMemo(() => {
    switch (identifier) {
      case 'launch':
        return <Launch />
      case 'home':
        return <Home />
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
      case 'music':
        return <MusicMaker />
      case 'miyakeys':
        return <Miyakeys />
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

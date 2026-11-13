import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Pages from '@/constants/pages'

/**
 * PfpEngine window: embeds the Miya PFP Engine as an iframe.
 * Uses the desktop's WindowWrapper + TitleBar so the window
 * is draggable, minimizable, maximizable (full screen), and closable.
 * The iframe content loads lazily when the window first opens.
 */
export default memo(function PfpEngine() {
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [windowLoaded, setWindowLoaded] = useState(false)

  // Load the iframe content when the window is initialized (lazy)
  useEffect(() => {
    setWindowLoaded(true)
  }, [])

  const handleClose = useCallback(() => {
    // Let the window system close the window via the store
  }, [])

  const handleMinimize = useCallback(() => {
    // Let the window system minimize via the store
  }, [])

  const handleFullscreen = useCallback(() => {
    // Let the window system toggle fullscreen via the store
  }, [])

  return (
    <>
      {/* Title bar with window controls */}
      <div style={{ flex: '0 0 auto', height: 26, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 6, background: 'linear-gradient(90deg, #000080, #1084d0)', color: '#fff', userSelect: 'none' }}>
        <span style={{ flex: 'none', fontSize: 10, lineHeight: 1 }}>
          &#9888;{Pages.pfpEngine?.label}
        </span>
        <div style={{ flex: 1, minWidth: 0, height: '100%', cursor: 'grab' }} />
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            style={{ width: 18, height: 16, border: 'none', background: '#c0c0c0', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Minimize"
            onClick={handleMinimize}
          >
            <svg width="8" height="4" viewBox="0 0 8 4" fill="currentColor"><rect x="1" y="2" width="6" height="1" /></svg>
          </button>
          <button
            style={{ width: 18, height: 16, border: 'none', background: '#c0c0c0', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Maximize"
            onClick={handleFullscreen}
          >
            <svg width="8" height="7" viewBox="0 0 8 7" fill="currentColor"><path d="M0 0h8v2H0zM0 2h6v5H0zM7 2h1v5H7z" /></svg>
          </button>
          <button
            style={{ width: 18, height: 16, border: 'none', background: '#c0c0c0', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
            aria-label="Close"
            onClick={handleClose}
          >
            <svg width="7" height="7" viewBox="0 0 7 7" fill="currentColor"><path d="M1.5 1.5h1.5v1.5H1.5V1.5zm3 3h1.5v1.5h-1.5v-1.5z" /></svg>
          </button>
        </div>
      </div>

      {/* Window body: the iframe */}
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        {windowLoaded && !iframeLoaded && (
          <iframe
            ref={iframeRef}
            src="/apps/pfp-engine/"
            title="Miya PFP Engine"
            style={{ width: '100%', height: '100%', border: 0, display: 'none' }}
            onLoad={() => setIframeLoaded(true)}
          />
        )}
        {iframeLoaded && (
          <iframe
            ref={iframeRef}
            src="/apps/pfp-engine/"
            title="Miya PFP Engine"
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}
      </div>
    </>
  )
})

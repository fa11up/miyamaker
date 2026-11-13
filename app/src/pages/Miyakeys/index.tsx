import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { frameActivity, reportActivity } from '@/desktop/screensaver/activity'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { heldFullScreen } from '@/pages/OperatingSystem/Windows'
import { useWindowSize } from 'usehooks-ts'

/** The configurator is its own page (embed/miyakeys), built beside the desktop. */
export const MIYAKEYS_SRC = '/embed/miyakeys/'

/**
 * The frame runs outside the wallet app: an opaque origin (the sandbox never gives it its own origin back), so it
 * cannot read this page, its storage or its wallet, and this page cannot reach into it. It may run scripts, download
 * its exports and open its links in a new tab. `vite dev` uses the same list, so dev runs what the site runs: its dev server answers the
 * frame's module requests (origin "null") itself, with the Worker's CSP on the page (vite.config.ts,
 * miyakeysEmbedDev; api/_lib/miyakeys.ts).
 */
export const MIYAKEYS_SANDBOX = 'allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox'

const page = Pages.miyakeys

const Frame = styled.iframe`
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0d0d10;

  /* While the window is dragged, the frame would swallow the pointer and the drag would stick. */
  .react-draggable-dragging & {
    pointer-events: none;
  }
`

/**
 * miyakeys, the 3D keyboard configurator (MODKEYS from nuroctane.xyz), in a frame of its own. It holds its page in module
 * state, sets classes on <html>, listens on document and reloads itself at its phone breakpoint, so a frame
 * keeps all of that inside it. The frame's width picks its layout: a phone-sized window gets the phone one.
 *
 * The two talk by postMessage (embed/miyakeys/js/core/host.js): the frame says `miyakeys:ready`, the window answers
 * `miyakeys:init` with the address share links use and the build from /miyakeys#<build>, and `miyakeys:visible`
 * whenever the window is minimised or restored, so the frame stops drawing while nobody can see it.
 */
export default function MiyakeysPage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('miyakeys')
  const { width: viewWidth } = useWindowSize()
  const held = heldFullScreen('miyakeys', viewWidth)
  const minimized = useAppSelector((state) => state.windows.minimized).includes('miyakeys')
  const frame = useRef<HTMLIFrameElement>(null)
  // The frame learns which site it is in from its address; the rest comes by message.
  const [src] = useState(() => `${MIYAKEYS_SRC}?host=${encodeURIComponent(window.location.origin)}`)
  // A shared build (/miyakeys#<build>) goes to the configurator.
  const [hash] = useState(() => (window.location.pathname === page?.path ? window.location.hash.slice(1) : ''))

  // The frame's origin is opaque ("null"), so a message to it can only name '*'. Only its own window is written to.
  const post = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage(message, '*')
  }, [])
  const visible = !minimized
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const init = useCallback(() => {
    post({ type: 'miyakeys:init', shareBase: `${window.location.origin}${page?.path ?? '/miyakeys'}`, hash })
    post({ type: 'miyakeys:visible', visible: visibleRef.current })
  }, [post, hash])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      if ((e.data as { type?: unknown } | null)?.type === 'miyakeys:ready') init()

      // Keys and the pointer stay in the frame: its reports keep the screensaver away (and close one showing), and a
      // press brings this window to the front and closes menus (Windows.tsx, StartButton, SkinMenu).
      const kind = frameActivity(e, frame.current?.contentWindow, 'miyakeys:activity')
      if (kind) reportActivity({ kind, frame: frame.current })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [init])

  useEffect(() => {
    post({ type: 'miyakeys:visible', visible })
  }, [post, visible])

  return (
    <WindowWrapper skin="miyakeys">
      <TitleBar
        skin="miyakeys"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'miyakeys' }))
        }}
        fullscreen={fullscreen || held}
        // On a desktop too narrow for miyakeys the window is already the whole screen: no button that does nothing.
        fullscreenBtn={!held}
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'miyakeys' }))
        }}
      >
        {page?.label}
      </TitleBar>
      <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
        <Frame
          ref={frame}
          src={src}
          title="miyakeys keyboard configurator"
          sandbox={MIYAKEYS_SANDBOX}
          allow="clipboard-write"
          referrerPolicy="no-referrer"
          onLoad={init}
        />
      </div>
    </WindowWrapper>
  )
}

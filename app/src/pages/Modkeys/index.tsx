import { useState } from 'react'
import styled from 'styled-components/macro'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

/** The configurator is its own page (embed/modkeys), built beside the desktop. */
export const MODKEYS_SRC = '/embed/modkeys/'

const page = Pages.modkeys

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
 * MODKEYS, the 3D keyboard configurator from nuroctane.xyz, in a frame of its own. It holds its page in module
 * state, sets classes on <html>, listens on document and reloads itself at its phone breakpoint, so a frame
 * keeps all of that inside it. The frame's width picks its layout: a phone-sized window gets the phone one.
 */
export default function ModkeysPage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('modkeys')
  // A shared build (/modkeys#<build>) goes to the configurator, which reads it from its own address.
  const [src] = useState(() => `${MODKEYS_SRC}${window.location.pathname === page?.path ? window.location.hash : ''}`)

  return (
    <WindowWrapper skin="modkeys">
      <TitleBar
        skin="modkeys"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'modkeys' }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'modkeys' }))
        }}
      >
        {page?.label}
      </TitleBar>
      <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
        <Frame src={src} title="MODKEYS keyboard configurator" allow="clipboard-write" />
      </div>
    </WindowWrapper>
  )
}

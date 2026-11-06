import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import { MiyaMusicMaker } from './MiyaMusicMaker.jsx'
import { boot, restoreSamples, touch } from './model.js'
import css from './styles/miyamaker.css?inline'

const page = Pages.music

/**
 * The sampler's stylesheet sets page-level type, scrollbars, and box sizing.
 * It stays inside this shadow root so it cannot restyle the rest of the desktop.
 * The window title bar above is miyamaker's; the sampler does not draw a second one.
 */
export default function MusicMakerPage() {
  const host = useRef<HTMLDivElement>(null)
  const [fullscreen, toggleFullscreen] = useFullscreen('music')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'music' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'music' }))

  useEffect(() => {
    const el = host.current
    if (!el) return
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    let mount = shadow.querySelector<HTMLDivElement>('[data-mount]')
    if (!mount) {
      const style = document.createElement('style')
      style.textContent = css
      mount = document.createElement('div')
      mount.dataset.mount = ''
      mount.style.height = '100%'
      mount.style.minHeight = '0'
      shadow.append(style, mount)
    }
    boot()
    const root = createRoot(mount)
    root.render(<MiyaMusicMaker />)
    let cancel = false
    restoreSamples().then(() => {
      if (!cancel) touch(false)
    })
    return () => {
      cancel = true
      root.unmount()
    }
  }, [])

  return (
    <WindowWrapper>
      <TitleBar
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
      <div ref={host} data-miya-music="" style={{ height: '100%', minHeight: 0 }} />
    </WindowWrapper>
  )
}

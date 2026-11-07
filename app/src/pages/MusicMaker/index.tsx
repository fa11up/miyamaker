import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import { MiyaMusicMaker } from './MiyaMusicMaker.jsx'
import { armHistory, withoutHistory } from './history.js'
import { ensureBlankSong, openPackedUrl } from './audio/song.js'
import { shutdown, wakeEngine } from './audio/engine.js'
import { boot, model, restoreSamples, touch } from './model.js'
import PublishDialog, { type PublishJob } from './PublishDialog'
import { subscribeRemoteOpen, takeRemoteOpen } from './remoteOpen.js'
import css from './styles/miyamaker.css?inline'

const page = Pages.music

/**
 * The sampler's stylesheet sets page-level type, scrollbars, and box sizing.
 * It stays inside this shadow root so it cannot restyle the rest of the desktop.
 * The window title bar above is miyamaker's; the sampler does not draw a second one.
 */
export default function MusicMakerPage() {
  const host = useRef<HTMLDivElement>(null)
  const [publish, setPublish] = useState<PublishJob | null>(null)
  const [fullscreen, toggleFullscreen] = useFullscreen('music')
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: 'music' }))
  const minimize = () => dispatch(minimizeWindow({ value: 'music' }))

  useEffect(() => {
    const onPublish = (event: Event) => {
      const custom = event as CustomEvent<PublishJob>
      if (!custom.detail?.intent) return
      custom.preventDefault()
      setPublish(custom.detail)
    }
    window.addEventListener('miya-music-publish', onPublish)
    return () => window.removeEventListener('miya-music-publish', onPublish)
  }, [])

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
    wakeEngine()
    boot()
    const root = createRoot(mount)
    root.render(<MiyaMusicMaker />)
    let cancel = false
    let ready = false
    const consume = async (job: { href?: string; kind?: string; name?: string } | null) => {
      if (!job?.href || cancel) return
      try {
        await withoutHistory(() => openPackedUrl(job))
      } catch (error) {
        model.browserNote = (error as Error).message || 'Could not open that file'
        touch(false)
      }
    }
    const unsub = subscribeRemoteOpen((next: { href?: string; kind?: string; name?: string }) => {
      if (!ready || cancel) return
      void consume(takeRemoteOpen() || next)
    })
    restoreSamples().then(async () => {
      if (cancel) return
      armHistory()
      await withoutHistory(() => ensureBlankSong())
      if (cancel) return
      ready = true
      await consume(takeRemoteOpen())
      if (!cancel) touch(false)
    })
    return () => {
      cancel = true
      unsub()
      root.unmount()
      // Closing the window must stop the sound, the clock, the mic, and MIDI, not just React.
      shutdown()
    }
  }, [])

  return (
    <WindowWrapper skin="mint">
      <TitleBar
        skin="mint"
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
      <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
        <div ref={host} data-miya-music="" style={{ height: '100%', minHeight: 0 }} />
        {publish && <PublishDialog job={publish} onClose={() => setPublish(null)} />}
      </div>
    </WindowWrapper>
  )
}

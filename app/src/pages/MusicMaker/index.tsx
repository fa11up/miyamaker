import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'

import { MiyaMusicMaker } from './MiyaMusicMaker.jsx'
import { armHistory, canUndo, withoutHistory } from './history.js'
import { ensureBlankSong, openPackedUrl } from './audio/song.js'
import { shutdown, wakeEngine } from './audio/engine.js'
import { rebuildLibrary } from './media/library.js'
import {
  boot,
  clearUnreadPads,
  compactPatterns,
  dismissBootNotice,
  downloadBackup,
  latestBackup,
  model,
  padLabel,
  restoreBackup,
  restoreSamples,
  retryUnreadPads,
  subscribe,
  touch,
  unreadPads,
} from './model.js'
import PublishDialog, { type PublishJob } from './PublishDialog'
import { subscribeRemoteOpen, takeRemoteOpen } from './remoteOpen.js'
import css from './styles/miyamaker.css?inline'

const page = Pages.music

type RemoteJob = { href?: string; kind?: string; name?: string }

/** Something a remote open would replace: samples on pads, edits this session, or notes in an unsaved song. */
function sessionHasWork() {
  if (model.pads.some((pad: { source?: string }) => pad?.source === 'sample')) return true
  if (canUndo()) return true
  if (!model.songFile && compactPatterns().some((p: { steps: unknown[][] }) => p.steps.some((cell) => cell?.some(Boolean)))) return true
  return false
}

const noticeBox: CSSProperties = {
  position: 'absolute',
  left: 8,
  right: 8,
  bottom: 8,
  zIndex: 20,
  padding: '8px 10px',
  background: '#fff8d6',
  color: '#222',
  border: '1px solid #b89b2a',
  borderRadius: 4,
  font: '12px/1.4 system-ui, sans-serif',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
}
const noticeBtn: CSSProperties = { font: 'inherit', padding: '2px 8px', cursor: 'pointer' }

/**
 * What the session could not open, over the sampler where it is seen on every screen: pads whose samples
 * could not be read (Retry, or clear them) and a saved session that fell back to the factory kit (Restore).
 */
function SessionNotice({ onRestored }: { onRestored: () => void }) {
  const [, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const off = subscribe(setVersion)
    return () => {
      off()
    }
  }, [])
  const unread: number[] = unreadPads()
  const boots: string = model.bootNotice || ''
  if (!unread.length && !boots) return null
  const names = unread.slice(0, 12).map(padLabel).join(', ') + (unread.length > 12 ? ` and ${unread.length - 12} more` : '')
  return (
    <div role="alert" style={{ ...noticeBox, flexDirection: 'column', alignItems: 'stretch' }}>
      {unread.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: '1 1 240px' }}>
            Pad{unread.length > 1 ? 's' : ''} {names}: the sample could not be read from browser storage. Save, mint and upload are off until it loads.
          </span>
          <button
            type="button"
            style={noticeBtn}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const left = await retryUnreadPads()
              model.browserNote = left ? `${left} still could not be read` : 'Every sample is back'
              setBusy(false)
              touch(false)
            }}
          >
            Retry
          </button>
          <button type="button" style={noticeBtn} disabled={busy} onClick={() => clearUnreadPads()}>Clear those pads</button>
        </div>
      )}
      {boots && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: '1 1 240px' }}>{boots}</span>
          {latestBackup() && (
            <>
              <button
                type="button"
                style={noticeBtn}
                disabled={busy}
                onClick={() => {
                  if (restoreBackup()) onRestored()
                }}
              >
                Restore backup
              </button>
              <button type="button" style={noticeBtn} onClick={() => downloadBackup()}>Download backup</button>
            </>
          )}
          <button type="button" style={noticeBtn} onClick={() => dismissBootNotice()}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

/**
 * The sampler's stylesheet sets page-level type, scrollbars, and box sizing.
 * It stays inside this shadow root so it cannot restyle the rest of the desktop.
 * The window title bar above is miyamaker's; the sampler does not draw a second one.
 */
export default function MusicMakerPage() {
  const host = useRef<HTMLDivElement>(null)
  const [publish, setPublish] = useState<PublishJob | null>(null)
  const [replace, setReplace] = useState<{ job: RemoteJob; answer: (yes: boolean) => void } | null>(null)
  const askReplace = useRef<(job: RemoteJob) => Promise<boolean>>(() => Promise.resolve(true))
  askReplace.current = (job) => new Promise((resolve) => setReplace({ job, answer: resolve }))

  useEffect(() => {
    if (!replace) return undefined
    // Escape is Cancel: the current session stays.
    const down = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      replace.answer(false)
      setReplace(null)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [replace])
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
    const consume = async (job: RemoteJob | null) => {
      if (!job?.href || cancel) return
      try {
        // Asked first when it would replace work. It runs with history on, so one Undo puts the session back.
        if (sessionHasWork() && !(await askReplace.current(job))) {
          model.browserNote = 'Kept the current session'
          touch(false)
          return
        }
        if (cancel) return
        await openPackedUrl(job)
      } catch (error) {
        model.browserNote = (error as Error).message || 'Could not open that file'
        touch(false)
      }
    }
    const unsub = subscribeRemoteOpen((next: RemoteJob) => {
      if (!ready || cancel) return
      void consume(takeRemoteOpen() || next)
    })
    const start = async () => {
      // A pad whose sample could not be read stays silent, but the app must still become ready.
      let restoreError = ''
      try {
        await restoreSamples()
      } catch (error) {
        restoreError = (error as Error)?.message || 'Some samples could not be read from browser storage'
      }
      if (cancel) return
      armHistory()
      try {
        // A library list that was lost or damaged is rebuilt from what is in storage before anything adds to it.
        await withoutHistory(() => rebuildLibrary())
      } catch (error) {
        console.warn('the library could not be rebuilt', error)
      }
      try {
        await withoutHistory(() => ensureBlankSong())
      } catch (error) {
        console.warn('the Blank song could not be stored', error)
      }
      if (cancel) return
      ready = true
      if (restoreError) {
        model.browserNote = restoreError
        touch(false)
      }
      await consume(takeRemoteOpen())
      if (!cancel) touch(false)
    }
    void start()
    return () => {
      cancel = true
      unsub()
      root.unmount()
      // Closing the window must stop the sound, the clock, the mic, and MIDI, not just React.
      shutdown()
    }
  }, [])

  return (
    <WindowWrapper skin="music">
      <TitleBar
        skin="music"
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
        <SessionNotice
          onRestored={() => {
            // The restored save is a new session: its samples are read back and history starts over.
            restoreSamples().catch((error) => {
              model.browserNote = (error as Error)?.message || 'Some samples could not be read'
            }).finally(() => {
              armHistory()
              touch(false)
            })
          }}
        />
        {replace && (
          <div role="dialog" aria-modal="true" aria-label="Replace the current session" style={{ ...noticeBox, top: 8, bottom: 'auto', background: '#fff' }}>
            <span style={{ flex: '1 1 240px' }}>
              Replace the current {replace.job.kind === 'kit' ? 'kit' : 'song'} with {String(replace.job.name || 'that file').slice(0, 80)}? Undo brings this one back.
            </span>
            <button type="button" style={noticeBtn} onClick={() => { replace.answer(true); setReplace(null) }}>Replace</button>
            <button type="button" style={noticeBtn} autoFocus onClick={() => { replace.answer(false); setReplace(null) }}>Cancel</button>
          </div>
        )}
        {publish && <PublishDialog job={publish} onClose={() => setPublish(null)} />}
      </div>
    </WindowWrapper>
  )
}

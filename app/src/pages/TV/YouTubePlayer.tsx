import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { setPlaying } from '@/desktop/screensaver/playing'

const Slot = styled.div`
  position: absolute;
  inset: 0;
  iframe,
  > div {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  iframe {
    pointer-events: none;
  }
`

const Curtain = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  background: #000 center / cover no-repeat;
  span {
    padding: 4px 12px;
    background: rgba(0, 0, 0, 0.75);
    color: #e8e8e8;
    font-size: 13px;
    letter-spacing: 0.1em;
  }
`

const Failed = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  color: #f3e7cf;
  background: radial-gradient(ellipse at 50% 40%, #4a2c14 0%, #24130a 55%, #0a0503 100%);
  a {
    color: #ecd48a;
  }
`

/* eslint-disable @typescript-eslint/no-explicit-any */
let api: Promise<any> | undefined

/** YouTube's official IFrame API, loaded once and only when a YouTube channel comes on. */
function loadApi(): Promise<any> {
  const w = window as any
  if (w.YT?.Player) return Promise.resolve(w.YT)
  api =
    api ||
    new Promise((resolve, reject) => {
      const before = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        before?.()
        resolve(w.YT)
      }

      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.onerror = () => {
        // Not kept, so tuning again tries again.
        api = undefined
        script.remove()
        reject(new Error('YouTube did not load'))
      }
      document.head.appendChild(script)
    })
  return api
}

/** How long the first moments stay covered: YouTube shows its title and buttons as a video starts. */
const CURTAIN_AFTER_PLAY_MS = 7500
const CURTAIN_MOST_MS = 15_000
const PLAYING = 1
const BUFFERING = 3
const ENDED = 0
const DEAD_SKIP_MS = 3000

/**
 * A YouTube video we can actually turn up and down: the volume and mute come through YouTube's own API, so changing them
 * never reloads the stream. It starts with sound; if the browser refuses until someone has clicked, it plays muted instead.
 */
export default function YouTubePlayer({
  videoId,
  volume,
  muted,
  paused = false,
  onAutoMuted,
  onEnded,
  onDead,
  onPlaying,
}: {
  videoId: string
  /** 0 to 1 */
  volume: number
  muted: boolean
  paused?: boolean
  onAutoMuted?: () => void
  onEnded?: () => void
  /** Pass it when there is something else to play: it's called a few seconds after a video turns out not to work. */
  onDead?: () => void
  /** Called each time the video actually starts playing. */
  onPlaying?: () => void
}) {
  const slot = useRef<HTMLDivElement>(null)
  const player = useRef<any>()
  const [failed, setFailed] = useState(false)
  const [curtain, setCurtain] = useState(true)
  const latest = useRef({ volume, muted, paused, onAutoMuted, onEnded, onDead, onPlaying })
  latest.current = { volume, muted, paused, onAutoMuted, onEnded, onDead, onPlaying }

  useEffect(() => {
    setFailed(false)
    setCurtain(true)
    let gone = false
    let failedNow = false
    let check: ReturnType<typeof setTimeout>
    let lift: ReturnType<typeof setTimeout>
    let skip: ReturnType<typeof setTimeout>
    // Whatever YouTube does, the picture is never left covered.
    const most = setTimeout(() => setCurtain(false), CURTAIN_MOST_MS)
    const host = document.createElement('div')
    slot.current?.appendChild(host)
    loadApi().then((YT) => {
      if (gone) return
      player.current = new YT.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        // No YouTube buttons: the set has its own. The film stays clear of the pointer, so hovering can't call them up.
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(Math.round(latest.current.volume * 100))
            if (latest.current.muted) e.target.mute()
            else e.target.unMute()
            if (latest.current.paused) e.target.pauseVideo()
            else e.target.playVideo()
            check = setTimeout(() => {
              const state = e.target.getPlayerState?.()
              // Quick, so a refused start isn't a frozen screen. A slow connection reads as buffering, not refused.
              // A video that has failed or already finished isn't refused either, and muting it would be a false alarm.
              if (gone || failedNow || latest.current.paused || [PLAYING, BUFFERING, ENDED].includes(state)) return
              e.target.mute()
              e.target.playVideo()
              latest.current.onAutoMuted?.()
            }, 2000)
          },
          onStateChange: (e: any) => {
            // Told to stay paused (by hand, or because another app has the sound): a stray start from YouTube's own
            // autoplay doesn't take the sound back.
            const on = e.data === PLAYING || e.data === BUFFERING
            if (on && latest.current.paused) e.target.pauseVideo()
            setPlaying('tv-youtube', on && !latest.current.paused)
            if (e.data === PLAYING && !latest.current.paused) latest.current.onPlaying?.()
            if (e.data === ENDED) {
              // With nothing to go on to, this beats YouTube's end frame of other people's videos.
              if (latest.current.onEnded) latest.current.onEnded()
              else setFailed(true)
            }

            if (e.data === PLAYING) {
              clearTimeout(lift)
              lift = setTimeout(() => setCurtain(false), CURTAIN_AFTER_PLAY_MS)
            }
          },
          onError: () => {
            failedNow = true
            setPlaying('tv-youtube', false)
            setFailed(true)
            clearTimeout(skip)
            skip = setTimeout(() => latest.current.onDead?.(), DEAD_SKIP_MS)
          },
        },
      })
    }).catch(() => {
      if (!gone) setFailed(true)
    })
    return () => {
      gone = true
      clearTimeout(check)
      clearTimeout(lift)
      clearTimeout(most)
      clearTimeout(skip)
      setPlaying('tv-youtube', false)
      player.current?.destroy?.()
      player.current = undefined
      host.remove()
      if (slot.current) slot.current.innerHTML = ''
    }
  }, [videoId])

  useEffect(() => {
    const p = player.current
    if (!p?.setVolume) return
    p.setVolume(Math.round(volume * 100))
    if (muted) p.mute()
    else p.unMute()
  }, [volume, muted])

  useEffect(() => {
    const p = player.current
    if (!p?.pauseVideo) return
    if (paused) p.pauseVideo()
    else p.playVideo()
  }, [paused])

  return (
    <>
      <Slot ref={slot} />
      {/* Paused too: YouTube offers other videos over a paused picture. */}
      {(curtain || paused) && !failed && (
        <Curtain
          aria-hidden
          style={{ backgroundImage: `url(https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg)` }}
        >
          <span>{paused ? 'Paused' : 'Tuning in…'}</span>
        </Curtain>
      )}
      {failed && (
        <Failed>
          <strong>This stream has moved or ended.</strong>
          <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">
            Try it on YouTube ↗
          </a>
          {onDead && <span>Next tape coming up.</span>}
        </Failed>
      )}
    </>
  )
}

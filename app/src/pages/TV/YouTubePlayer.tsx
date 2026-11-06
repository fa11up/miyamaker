import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

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
    new Promise((resolve) => {
      const before = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        before?.()
        resolve(w.YT)
      }

      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    })
  return api
}

const PLAYING = 1
const BUFFERING = 3
const ENDED = 0

/**
 * A YouTube video we can actually turn up and down: the volume and mute come through YouTube's own API, so changing them
 * never reloads the stream. It starts with sound; if the browser refuses until someone has clicked, it plays muted instead.
 */
export default function YouTubePlayer({
  videoId,
  volume,
  muted,
  onAutoMuted,
  onEnded,
}: {
  videoId: string
  /** 0 to 1 */
  volume: number
  muted: boolean
  onAutoMuted?: () => void
  onEnded?: () => void
}) {
  const slot = useRef<HTMLDivElement>(null)
  const player = useRef<any>()
  const [failed, setFailed] = useState(false)
  const latest = useRef({ volume, muted, onAutoMuted, onEnded })
  latest.current = { volume, muted, onAutoMuted, onEnded }

  useEffect(() => {
    setFailed(false)
    let gone = false
    let check: ReturnType<typeof setTimeout>
    const host = document.createElement('div')
    slot.current?.appendChild(host)
    loadApi().then((YT) => {
      if (gone) return
      player.current = new YT.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(Math.round(latest.current.volume * 100))
            if (latest.current.muted) e.target.mute()
            else e.target.unMute()
            e.target.playVideo()
            check = setTimeout(() => {
              const state = e.target.getPlayerState?.()
              // Long enough that a slow connection isn't taken for the browser refusing sound.
              if (gone || state === PLAYING || state === BUFFERING) return
              e.target.mute()
              e.target.playVideo()
              latest.current.onAutoMuted?.()
            }, 7000)
          },
          onStateChange: (e: any) => {
            if (e.data === ENDED) latest.current.onEnded?.()
          },
          onError: () => setFailed(true),
        },
      })
    })
    return () => {
      gone = true
      clearTimeout(check)
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

  return (
    <>
      <Slot ref={slot} />
      {failed && (
        <Failed>
          <strong>This stream has moved or ended.</strong>
          <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">
            Try it on YouTube ↗
          </a>
        </Failed>
      )}
    </>
  )
}

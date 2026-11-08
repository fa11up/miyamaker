import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { onSoundTaken, setPlaying as tellScreensaver } from '@/desktop/screensaver/playing'
import { classifyChannels, safeUri } from '@/music/audio'
import type { EqState } from '@/music/eq'
import { clampBalance, dbToGain, effectiveGains, EQ_BANDS, sanitizeEq } from '@/music/eq'
import type { QueueState } from '@/music/queue'
import * as Q from '@/music/queue'
import type { Track } from '@/music/types'
import { resolveUri } from '@/utils/resolveUri'

/**
 * miya radio's engine. Lives above the window manager (App.tsx) so playback continues when the radio
 * window is minimized or closed. Owns two detached HTMLAudioElements:
 *  - `fx`: crossOrigin="anonymous", routed through a WebAudio AnalyserNode for the visualizer
 *  - `plain`: no WebAudio, used when a host sends no CORS headers (routing it through WebAudio would play
 *    silence), on iOS (WebAudio-routed audio stops on lock screen) and with prefers-reduced-motion.
 * Other windows hand tracks over with `useRadio().enqueue/playNow`.
 */

export type VisualizerMode = 'live' | 'reduced' | 'unavailable'

export type RadioApi = {
  queue: QueueState
  current: Track | undefined
  playing: boolean
  loading: boolean
  error: string | undefined
  volume: number
  /** Whether the visualizer can show live data for the current track. */
  visualizer: VisualizerMode
  getAnalyser: () => AnalyserNode | null
  /** 10-band equalizer + preamp. Applied whenever the track plays through WebAudio (`fx`). */
  eq: EqState
  setEq: (eq: Partial<EqState>) => void
  /** Stereo balance, -1 (left) … 1 (right). Applied through WebAudio like the EQ. */
  balance: number
  setBalance: (v: number) => void
  /** True while the current track is routed through WebAudio, i.e. EQ, balance and live visuals work. */
  fx: boolean
  /** Output sample rate of the audio graph (Hz), once it exists. */
  sampleRate: number | undefined
  /** What the current moment of audio looks like across channels; null without the WebAudio path. */
  readChannels: () => 'silent' | 'mono' | 'stereo' | null
  play: () => void
  pause: () => void
  toggle: () => void
  stop: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  jumpTo: (trackIndex: number) => void
  remove: (trackIndex: number) => void
  clear: () => void
  /** Append to the playlist. Starts nothing. */
  enqueue: (tracks: Track | Track[]) => void
  /** Load this track now (queues it after the current one if new) and start playing. */
  playNow: (track: Track) => void
}

export type RadioClock = { time: number; duration: number }

const RadioContext = createContext<RadioApi | null>(null)
const RadioClockContext = createContext<RadioClock>({ time: 0, duration: 0 })

export function useRadio(): RadioApi {
  const ctx = useContext(RadioContext)
  if (!ctx) throw new Error('useRadio must be used inside <RadioProvider>')
  return ctx
}

/** Elapsed/duration, updated ~4×/s while playing. Separate context so only clock readers re-render. */
export function useRadioClock(): RadioClock {
  return useContext(RadioClockContext)
}

// ── persistence (per-viewer convenience; storage may be blocked) ──────────────

const STORAGE_KEY = 'miya-radio:v1'
type Saved = { tracks: Track[]; currentId?: string; repeat: Q.RepeatMode; volume: number }

const persistable = (t: Track) => (t.source === 'station' || t.source === 'onchain') && !!safeUri(t.src)

function restore(): { queue: QueueState; volume: number } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Saved | null
    if (saved && Array.isArray(saved.tracks)) {
      const tracks = saved.tracks.filter(
        (t) => t && typeof t.id === 'string' && typeof t.title === 'string' && persistable(t)
      )
      const repeat = (['off', 'all', 'one'] as const).includes(saved.repeat) ? saved.repeat : 'off'
      let queue = Q.createQueue(tracks, repeat)
      const idx = tracks.findIndex((t) => t.id === saved.currentId)
      if (idx >= 0) queue = Q.jumpTo(queue, idx)
      const volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 0.8
      return { queue, volume }
    }
  } catch {
    // ignore
  }

  return { queue: Q.createQueue(), volume: 0.8 }
}

function save(queue: QueueState, volume: number) {
  try {
    const data: Saved = {
      tracks: queue.tracks.filter(persistable),
      currentId: Q.currentTrack(queue)?.id,
      repeat: queue.repeat,
      volume,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

const FX_KEY = 'miya-radio:fx:v1'

function restoreFx(): { eq: EqState; balance: number } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FX_KEY) || 'null') as {
      eq?: unknown
      balance?: unknown
    } | null
    return {
      eq: sanitizeEq(saved?.eq),
      balance: typeof saved?.balance === 'number' ? clampBalance(saved.balance) : 0,
    }
  } catch {
    return { eq: sanitizeEq(null), balance: 0 }
  }
}

// ── environment ───────────────────────────────────────────────────────────────

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Resolved, playable URL for a track, or '' when its URI is not allowed. */
export function playableUrl(track: Track): string {
  const { src } = track
  // Local previews (Drop Music) and the dev test tone are same-origin or blob: URLs built by this app.
  if ((track.source === 'local' || track.source === 'dev') && (src.startsWith('blob:') || src.startsWith('/'))) {
    return src
  }

  const safe = safeUri(src)
  return safe ? resolveUri(safe) : ''
}

const isCrossOrigin = (url: string) => {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin
  } catch {
    return true
  }
}

type AudioCtor = typeof AudioContext

export default function RadioProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(restore, [])
  const [queue, setQueueState] = useState<QueueState>(initial.queue)
  const queueRef = useRef(queue)
  const [volume, setVolumeState] = useState(initial.volume)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [clock, setClock] = useState<RadioClock>({ time: 0, duration: 0 })
  const [usingFx, setUsingFx] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const initialFx = useMemo(restoreFx, [])
  const [eq, setEqState] = useState<EqState>(initialFx.eq)
  const eqRef = useRef(eq)
  eqRef.current = eq
  const [balance, setBalanceState] = useState(initialFx.balance)
  const balanceRef = useRef(balance)
  balanceRef.current = balance
  const [sampleRate, setSampleRate] = useState<number | undefined>()

  const fxRef = useRef<HTMLAudioElement | null>(null)
  const plainRef = useRef<HTMLAudioElement | null>(null)
  const activeRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const preampRef = useRef<GainNode | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const pannerRef = useRef<StereoPannerNode | null>(null)
  const channelsRef = useRef<[AnalyserNode, AnalyserNode] | null>(null)
  const fxBrokenRef = useRef(false)
  const noCorsRef = useRef(new Set<string>())
  const wantPlayRef = useRef(false)
  const loadedIdRef = useRef<string | undefined>()

  const current = Q.currentTrack(queue)
  const currentRef = useRef(current)
  currentRef.current = current
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  const commit = useCallback((next: QueueState) => {
    queueRef.current = next
    setQueueState(next)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return undefined
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  // WebAudio routing is decided per track load; once an element is wired into a graph it stays wired.
  const fxAllowed = () =>
    !fxBrokenRef.current &&
    !isIOS() &&
    !prefersReducedMotion() &&
    !!(window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)

  // Push the current EQ/balance values into the graph (no-op until it exists).
  const applyFxRef = useRef(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    const gains = effectiveGains(eqRef.current)
    preampRef.current?.gain.setTargetAtTime(dbToGain(gains.preamp), now, 0.02)
    filtersRef.current.forEach((f, i) => f.gain.setTargetAtTime(gains.bands[i] || 0, now, 0.02))
    pannerRef.current?.pan.setTargetAtTime(balanceRef.current, now, 0.02)
  })

  const ensureGraph = useCallback(() => {
    const fx = fxRef.current
    if (!fx || analyserRef.current) {
      if (ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => undefined)
      return
    }

    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(fx)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.78
      // source → preamp → 10 shelf/peaking filters → balance → analyser → speakers
      const preamp = ctx.createGain()
      const filters = EQ_BANDS.map((hz, i) => {
        const f = ctx.createBiquadFilter()
        f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
        f.frequency.value = hz
        f.Q.value = 1.1
        return f
      })
      let chain: AudioNode = source.connect(preamp)
      filters.forEach((f) => {
        chain = chain.connect(f)
      })
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
      if (panner) chain = chain.connect(panner)
      chain.connect(analyser)
      analyser.connect(ctx.destination)
      // Tapped ahead of the balance control, so turning it can't change what the stereo light reads.
      const splitter = ctx.createChannelSplitter(2)
      source.connect(splitter)
      const tap = (channel: number) => {
        const node = ctx.createAnalyser()
        node.fftSize = 256
        splitter.connect(node, channel)
        return node
      }

      channelsRef.current = [tap(0), tap(1)]
      ctxRef.current = ctx
      analyserRef.current = analyser
      preampRef.current = preamp
      filtersRef.current = filters
      pannerRef.current = panner
      applyFxRef.current()
      setSampleRate(ctx.sampleRate)
      if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)
    } catch {
      fxBrokenRef.current = true
      setUsingFx(false)
    }
  }, [])

  const readChannels = useCallback(() => {
    const taps = channelsRef.current
    if (!taps) return null
    const left = new Uint8Array(taps[0].fftSize)
    const right = new Uint8Array(taps[1].fftSize)
    taps[0].getByteTimeDomainData(left)
    taps[1].getByteTimeDomainData(right)
    return classifyChannels(left, right)
  }, [])

  const els = useCallback(() => {
    if (!fxRef.current) {
      const make = (cors: boolean) => {
        const el = new Audio()
        el.preload = 'metadata'
        if (cors) el.crossOrigin = 'anonymous'
        return el
      }

      fxRef.current = make(true)
      plainRef.current = make(false)
    }

    return { fx: fxRef.current, plain: plainRef.current as HTMLAudioElement }
  }, [])

  const startPlayback = useCallback(
    (el: HTMLAudioElement) => {
      if (el === fxRef.current) ensureGraph()
      el.play().catch((e: Error) => {
        // Aborted: something newer took over. Not supported: the element's own error event deals with that.
        if (e?.name === 'AbortError' || e?.name === 'NotSupportedError') return
        wantPlayRef.current = false
        setPlaying(false)
        setLoading(false)
        if (e?.name !== 'NotAllowedError') setError('Could not start playback.')
      })
    },
    [ensureGraph]
  )

  // Tracks that failed in a row: a bad one is skipped, but a queue where nothing loads stops instead of looping.
  const failStreakRef = useRef(0)
  const skipTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const cancelSkip = useCallback(() => clearTimeout(skipTimerRef.current), [])
  const advanceRef = useRef<(auto: boolean) => void>(() => undefined)

  const trackFailed = useCallback(
    (track: Track, why: 'load' | 'link') => {
      setLoading(false)
      setPlaying(false)
      failStreakRef.current += 1
      const name = track.title || 'this track'
      const others = queueRef.current.tracks.length - 1
      if (wantPlayRef.current && failStreakRef.current <= others) {
        setError(`Skipped ${name}: ${why === 'link' ? 'unsupported link' : 'could not load'}.`)
        const { id } = track
        cancelSkip()
        skipTimerRef.current = setTimeout(() => {
          if (wantPlayRef.current && currentRef.current?.id === id) advanceRef.current(false)
        }, 1500)
        return
      }

      // Nothing more to try: the next track someone picks shouldn't start by itself.
      wantPlayRef.current = false
      setError(why === 'link' ? 'This track has an unsupported link.' : `Could not load ${name}.`)
    },
    [cancelSkip]
  )

  const load = useCallback(
    (track: Track | undefined, autoplay: boolean) => {
      cancelSkip()
      const { fx, plain } = els()
      ;[fx, plain].forEach((el) => {
        el.pause()
        el.removeAttribute('src')
        el.load()
      })
      loadedIdRef.current = track?.id
      setError(undefined)
      setClock({ time: 0, duration: track?.duration || 0 })
      if (!track) {
        activeRef.current = null
        setPlaying(false)
        setLoading(false)
        return
      }

      const url = playableUrl(track)
      if (!url) {
        activeRef.current = null
        trackFailed(track, 'link')
        return
      }

      const useFx = fxAllowed() && !(isCrossOrigin(url) && noCorsRef.current.has(track.id))
      const el = useFx ? fx : plain
      activeRef.current = el
      setUsingFx(useFx)
      el.src = url
      el.volume = volumeRef.current
      setLoading(true)
      if (autoplay) startPlayback(el)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [els, startPlayback, cancelSkip, trackFailed]
  )

  // Load whenever the current track changes.
  useEffect(() => {
    if (current?.id === loadedIdRef.current && activeRef.current) return
    load(current, wantPlayRef.current)
  }, [current?.id, load])

  const restart = useCallback(() => {
    cancelSkip()
    const el = activeRef.current
    // Nothing loaded that could start over: load it again.
    if (!el || el.error) {
      load(Q.currentTrack(queueRef.current), wantPlayRef.current)
      return
    }

    el.currentTime = 0
    if (wantPlayRef.current) startPlayback(el)
  }, [cancelSkip, load, startPlayback])

  const advance = useCallback(
    (auto: boolean) => {
      const q = queueRef.current
      const before = Q.currentIndex(q)
      const r = Q.next(q, { auto })
      if (r.stop) {
        wantPlayRef.current = false
        setPlaying(false)
        return
      }

      if (Q.currentIndex(r.state) === before && r.state.order === q.order) {
        restart()
        return
      }

      commit(r.state)
    },
    [commit, restart]
  )
  advanceRef.current = advance

  // Element events (attached once). Events from the inactive element are ignored.
  useEffect(() => {
    const { fx, plain } = els()
    const cleanups: (() => void)[] = []
    const on = (el: HTMLAudioElement, type: string, fn: () => void) => {
      const h = () => {
        if (activeRef.current === el) fn()
      }

      el.addEventListener(type, h)
      cleanups.push(() => el.removeEventListener(type, h))
    }

    ;[fx, plain].forEach((el) => {
      on(el, 'timeupdate', () => setClock((c) => ({ ...c, time: el.currentTime })))
      on(el, 'durationchange', () =>
        setClock((c) => ({ ...c, duration: Number.isFinite(el.duration) ? el.duration : c.duration }))
      )
      on(el, 'loadedmetadata', () =>
        setClock((c) => ({ ...c, duration: Number.isFinite(el.duration) ? el.duration : c.duration }))
      )
      on(el, 'play', () => setPlaying(true))
      on(el, 'playing', () => {
        failStreakRef.current = 0
        setLoading(false)
      })
      on(el, 'canplay', () => setLoading(false))
      on(el, 'waiting', () => setLoading(true))
      on(el, 'pause', () => setPlaying(false))
      on(el, 'ended', () => advanceRef.current(true))
      on(el, 'error', () => {
        const track = currentRef.current
        if (!el.getAttribute('src') || !track) return
        // A CORS-less host fails on the crossOrigin element: retry once without WebAudio.
        if (el === fx && !noCorsRef.current.has(track.id) && isCrossOrigin(el.src)) {
          noCorsRef.current.add(track.id)
          const url = el.src
          el.removeAttribute('src')
          el.load()
          activeRef.current = plain
          setUsingFx(false)
          plain.src = url
          plain.volume = volumeRef.current
          if (wantPlayRef.current) startPlayback(plain)
          return
        }

        trackFailed(track, 'load')
      })
    })
    return () => {
      cleanups.forEach((c) => c())
      cancelSkip()
    }
  }, [els, startPlayback, trackFailed, cancelSkip])

  // ── actions ─────────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    wantPlayRef.current = true
    cancelSkip()
    // Someone asked: it gets another go at the whole list.
    failStreakRef.current = 0
    const q = queueRef.current
    if (!Q.currentTrack(q)) {
      if (q.tracks.length) commit({ ...q, position: 0 })
      return
    }

    const el = activeRef.current
    // A track that failed to load won't play from where it is: load it again, or a dropped connection is permanent.
    if (!el || el.error || loadedIdRef.current !== Q.currentTrack(q)?.id) {
      load(Q.currentTrack(q), true)
      return
    }

    if (el.ended) el.currentTime = 0
    startPlayback(el)
  }, [cancelSkip, commit, load, startPlayback])

  const pause = useCallback(() => {
    wantPlayRef.current = false
    cancelSkip()
    activeRef.current?.pause()
  }, [cancelSkip])

  const toggle = useCallback(() => {
    if (activeRef.current && !activeRef.current.paused) pause()
    else play()
  }, [pause, play])

  const stop = useCallback(() => {
    pause()
    if (activeRef.current) activeRef.current.currentTime = 0
    setClock((c) => ({ ...c, time: 0 }))
  }, [pause])

  const nextAction = useCallback(() => advance(false), [advance])

  const prevAction = useCallback(() => {
    const r = Q.prev(queueRef.current, activeRef.current?.currentTime || 0)
    if (r.restart) {
      restart()
      return
    }

    commit(r.state)
  }, [commit, restart])

  const seek = useCallback((seconds: number) => {
    const el = activeRef.current
    if (!el || !Number.isFinite(seconds)) return
    const max = Number.isFinite(el.duration) ? el.duration : seconds
    el.currentTime = Math.max(0, Math.min(max, seconds))
    setClock((c) => ({ ...c, time: el.currentTime }))
  }, [])

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v))
    setVolumeState(vol)
    if (fxRef.current) fxRef.current.volume = vol
    if (plainRef.current) plainRef.current.volume = vol
  }, [])

  const enqueue = useCallback(
    (tracks: Track | Track[]) => commit(Q.enqueue(queueRef.current, Array.isArray(tracks) ? tracks : [tracks])),
    [commit]
  )

  const playNow = useCallback(
    (track: Track) => {
      const before = Q.currentTrack(queueRef.current)?.id
      wantPlayRef.current = true
      failStreakRef.current = 0
      const next = Q.playNow(queueRef.current, track)
      commit(next)
      if (Q.currentTrack(next)?.id === before) play()
    },
    [commit, play]
  )

  const jumpTo = useCallback(
    (trackIndex: number) => {
      const q = queueRef.current
      wantPlayRef.current = true
      failStreakRef.current = 0
      if (Q.currentIndex(q) === trackIndex) {
        restart()
        return
      }

      commit(Q.jumpTo(q, trackIndex))
    },
    [commit, restart]
  )

  const remove = useCallback((trackIndex: number) => commit(Q.removeAt(queueRef.current, trackIndex)), [commit])
  const clear = useCallback(() => {
    wantPlayRef.current = false
    commit(Q.clearQueue(queueRef.current))
  }, [commit])
  const toggleShuffle = useCallback(() => commit(Q.setShuffle(queueRef.current, !queueRef.current.shuffle)), [commit])
  const cycleRepeat = useCallback(() => commit(Q.cycleRepeat(queueRef.current)), [commit])
  const setEq = useCallback((patch: Partial<EqState>) => {
    setEqState((prev) => {
      const next = sanitizeEq({ ...prev, ...patch })
      eqRef.current = next
      return next
    })
  }, [])

  const setBalance = useCallback((v: number) => {
    // Snap to centre near zero so the slider has a detent.
    const b = Math.abs(v) < 0.06 ? 0 : clampBalance(v)
    balanceRef.current = b
    setBalanceState(b)
  }, [])

  useEffect(() => {
    applyFxRef.current()
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(FX_KEY, JSON.stringify({ eq, balance }))
      } catch {
        // ignore
      }
    }, 300)
    return () => clearTimeout(t)
  }, [eq, balance])

  useEffect(() => tellScreensaver('radio', playing), [playing])
  // One owner of sound: miyaTV or the Drop Music studio starting pauses the radio. It resumes only when pressed.
  useEffect(() => onSoundTaken('radio', pause), [pause])

  const getAnalyser = useCallback(() => (usingFx ? analyserRef.current : null), [usingFx])

  // ── persistence ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => save(queue, volume), 300)
    return () => clearTimeout(t)
  }, [queue, volume])

  // ── Media Session (lock screen / headset controls) ─────────────────────────

  const actionsRef = useRef({ play, pause, next: nextAction, prev: prevAction, seek, stop })
  actionsRef.current = { play, pause, next: nextAction, prev: prevAction, seek, stop }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined
    const ms = navigator.mediaSession
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => actionsRef.current.play()],
      ['pause', () => actionsRef.current.pause()],
      ['stop', () => actionsRef.current.stop()],
      ['nexttrack', () => actionsRef.current.next()],
      ['previoustrack', () => actionsRef.current.prev()],
      ['seekto', (d) => d.seekTime !== undefined && actionsRef.current.seek(d.seekTime)],
      ['seekbackward', (d) => actionsRef.current.seek((activeRef.current?.currentTime || 0) - (d.seekOffset || 10))],
      ['seekforward', (d) => actionsRef.current.seek((activeRef.current?.currentTime || 0) + (d.seekOffset || 10))],
    ]
    handlers.forEach(([action, fn]) => {
      try {
        ms.setActionHandler(action, fn)
      } catch {
        // action unsupported in this browser
      }
    })
    return () =>
      handlers.forEach(([action]) => {
        try {
          ms.setActionHandler(action, null)
        } catch {
          // ignore
        }
      })
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!current) {
      navigator.mediaSession.metadata = null
      return
    }

    const art = current.artwork && safeUri(current.artwork) ? resolveUri(current.artwork) : ''
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist || '',
        album: 'miya radio',
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      })
    } catch {
      // MediaMetadata unsupported
    }
  }, [current?.id])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none'
  }, [playing, current?.id])

  const roundedTime = Math.floor(clock.time / 5)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
    const { duration, time } = clock
    if (!(duration > 0) || !Number.isFinite(duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(time, duration),
        playbackRate: activeRef.current?.playbackRate || 1,
      })
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.duration, roundedTime, playing])

  const visualizer: VisualizerMode = reducedMotion ? 'reduced' : usingFx ? 'live' : 'unavailable'

  const api = useMemo<RadioApi>(
    () => ({
      queue,
      current,
      playing,
      loading,
      error,
      volume,
      visualizer,
      getAnalyser,
      eq,
      setEq,
      balance,
      setBalance,
      fx: usingFx,
      sampleRate,
      readChannels,
      play,
      pause,
      toggle,
      stop,
      next: nextAction,
      prev: prevAction,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      remove,
      clear,
      enqueue,
      playNow,
    }),
    [
      queue,
      current,
      playing,
      loading,
      error,
      volume,
      visualizer,
      getAnalyser,
      eq,
      setEq,
      balance,
      setBalance,
      usingFx,
      sampleRate,
      readChannels,
      play,
      pause,
      toggle,
      stop,
      nextAction,
      prevAction,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      remove,
      clear,
      enqueue,
      playNow,
    ]
  )

  return (
    <RadioContext.Provider value={api}>
      <RadioClockContext.Provider value={clock}>{children}</RadioClockContext.Provider>
    </RadioContext.Provider>
  )
}

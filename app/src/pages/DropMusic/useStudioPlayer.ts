import { useCallback, useEffect, useRef, useState } from 'react'

type AudioCtor = typeof AudioContext

const audioCtor = (): AudioCtor | undefined =>
  typeof window === 'undefined'
    ? undefined
    : window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext

/**
 * The studio's own little player for the track being released. It is separate from miya radio so the
 * artist can audition the file while editing. Local files (blob: URLs) are routed through an AnalyserNode so
 * the stage can react to the music; linked files play without one (cross-origin audio would be silenced).
 */
export function useStudioPlayer(src: string | undefined, { analyse }: { analyse: boolean }) {
  const elRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  // One element per source: an element wired into the graph stays wired, so a new file gets a fresh one.
  useEffect(() => {
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setError('')
    if (!src) return undefined
    const el = new Audio()
    el.preload = 'metadata'
    el.src = src
    elRef.current = el
    let live = true
    const on = (name: string, fn: () => void) => el.addEventListener(name, () => live && fn())
    on('play', () => setPlaying(true))
    on('pause', () => setPlaying(false))
    on('ended', () => setPlaying(false))
    on('timeupdate', () => setTime(el.currentTime))
    on('loadedmetadata', () => Number.isFinite(el.duration) && setDuration(el.duration))
    on('error', () => setError('This track could not be played here.'))
    return () => {
      live = false
      el.pause()
      el.removeAttribute('src')
      el.load()
      nodeRef.current?.disconnect()
      nodeRef.current = null
      analyserRef.current = null
      if (elRef.current === el) elRef.current = null
    }
  }, [src])

  useEffect(
    () => () => {
      ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
    },
    []
  )

  const wire = (el: HTMLAudioElement) => {
    if (!analyse || nodeRef.current) return
    const Ctor = audioCtor()
    if (!Ctor) return
    try {
      const ctx = ctxRef.current || new Ctor()
      ctxRef.current = ctx
      const node = ctx.createMediaElementSource(el)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.8
      node.connect(analyser)
      analyser.connect(ctx.destination)
      nodeRef.current = node
      analyserRef.current = analyser
    } catch {
      // No analyser: the track still plays, the stage just dances on its own.
    }
  }

  const play = useCallback(() => {
    const el = elRef.current
    if (!el) return
    wire(el)
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => undefined)
    el.play().catch(() => setError('The browser blocked playback. Press play again.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyse])

  const pause = useCallback(() => elRef.current?.pause(), [])
  const toggle = useCallback(() => (elRef.current?.paused === false ? pause() : play()), [play, pause])
  const seek = useCallback((seconds: number) => {
    const el = elRef.current
    if (!el || !Number.isFinite(seconds)) return
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds))
    setTime(el.currentTime)
  }, [])

  const getAnalyser = useCallback(() => analyserRef.current, [])
  const getTime = useCallback(() => elRef.current?.currentTime ?? 0, [])

  return { playing, time, duration, error, play, pause, toggle, seek, getAnalyser, getTime }
}

export type StudioPlayer = ReturnType<typeof useStudioPlayer>

/**
 * Peak envelope of an audio file for the waveform strip, decoded once in the browser. Returns undefined while
 * decoding or when the browser cannot decode the file (the strip then draws a placeholder).
 */
export function useWaveformPeaks(file: File | undefined, buckets = 180): number[] | undefined {
  const [peaks, setPeaks] = useState<number[]>()
  useEffect(() => {
    setPeaks(undefined)
    if (!file) return undefined
    let cancelled = false
    const Offline =
      typeof window !== 'undefined'
        ? window.OfflineAudioContext ||
          (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
        : undefined
    if (!Offline) return undefined
    file
      .arrayBuffer()
      .then((buf) => new Offline(1, 1, 44100).decodeAudioData(buf))
      .then((audio) => {
        if (cancelled) return
        const data = audio.getChannelData(0)
        const size = Math.max(1, Math.floor(data.length / buckets))
        const out: number[] = []
        let max = 0
        for (let b = 0; b < buckets; b += 1) {
          let peak = 0
          // Sample every few frames: plenty for a strip this size and fast on long tracks.
          for (let i = b * size; i < (b + 1) * size && i < data.length; i += 16) {
            const v = Math.abs(data[i] as number)
            if (v > peak) peak = v
          }

          out.push(peak)
          if (peak > max) max = peak
        }

        setPeaks(out.map((p) => (max ? p / max : 0)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [file, buckets])
  return peaks
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { onSoundTaken, setPlaying as tellOthers } from '@/desktop/screensaver/playing'
import { waveformPlan } from '@/music/audio'

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
  // The file itself wouldn't load, so pressing play again can't help. A blocked play is another matter: it can.
  const [broken, setBroken] = useState(false)

  // One element per source: an element wired into the graph stays wired, so a new file gets a fresh one.
  useEffect(() => {
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setError('')
    setBroken(false)
    if (!src) return undefined
    const el = new Audio()
    el.preload = 'metadata'
    el.src = src
    elRef.current = el
    let live = true
    const on = (name: string, fn: () => void) => el.addEventListener(name, () => live && fn())
    on('play', () => {
      setPlaying(true)
      setError('')
    })
    on('pause', () => setPlaying(false))
    on('ended', () => setPlaying(false))
    on('timeupdate', () => setTime(el.currentTime))
    on('loadedmetadata', () => Number.isFinite(el.duration) && setDuration(el.duration))
    on('error', () => {
      setBroken(true)
      setError('This track could not be played here.')
    })
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
    setError('')
    el.play().catch((e) => {
      if ((e as Error).name === 'NotAllowedError') setError('The browser blocked playback. Press play again.')
      else if ((e as Error).name !== 'AbortError') setError('This track could not be played here.')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyse])

  const pause = useCallback(() => elRef.current?.pause(), [])

  // One owner of sound: the studio starting pauses the radio and miyaTV, and either of them starting pauses the studio.
  useEffect(() => tellOthers('studio', playing), [playing])
  useEffect(() => () => tellOthers('studio', false), [])
  useEffect(() => onSoundTaken('studio', pause), [pause])
  const toggle = useCallback(() => (elRef.current?.paused === false ? pause() : play()), [play, pause])
  const seek = useCallback((seconds: number) => {
    const el = elRef.current
    if (!el || !Number.isFinite(seconds)) return
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds))
    setTime(el.currentTime)
  }, [])

  const getAnalyser = useCallback(() => analyserRef.current, [])
  const getTime = useCallback(() => elRef.current?.currentTime ?? 0, [])

  return { playing, time, duration, error, broken, play, pause, toggle, seek, getAnalyser, getTime }
}

export type StudioPlayer = ReturnType<typeof useStudioPlayer>

/** Peaks for the waveform, or 'too-long' when the file is past what is worth decoding in the browser. */
export type Peaks = number[] | 'too-long'

// One decode at a time across the app: quick re-picks queue up behind it, and superseded ones never start.
let decoding: Promise<unknown> = Promise.resolve()

/**
 * Peak envelope of an audio file for the waveform strip, decoded once in the browser. Returns undefined while
 * decoding or when the browser cannot decode the file (the strip then draws a placeholder), and 'too-long' for a file
 * too big or too long to decode (see waveformPlan). `seconds` is the file's length once read.
 */
export function useWaveformPeaks(file: File | undefined, seconds: number | undefined, buckets = 180): Peaks | undefined {
  const [peaks, setPeaks] = useState<Peaks>()
  const plan = file ? waveformPlan(file.size, seconds) : undefined
  useEffect(() => {
    setPeaks(undefined)
    if (!file || !plan || plan === 'wait') return undefined
    if (plan === 'skip') {
      setPeaks('too-long')
      return undefined
    }

    let cancelled = false
    const Offline =
      typeof window !== 'undefined'
        ? window.OfflineAudioContext ||
          (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
        : undefined
    if (!Offline) return undefined
    const run = decoding.then(async () => {
      if (cancelled) return
      const buf = await file.arrayBuffer()
      if (cancelled) return
      const audio = await new Offline(1, 1, 44100).decodeAudioData(buf)
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
    decoding = run.catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [file, plan, buckets])
  return peaks
}

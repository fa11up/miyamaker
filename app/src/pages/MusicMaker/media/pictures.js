/** A wallet picture, read and turned into a sample the same way Image… does. */

import { fetchMediaBytes, placePcm } from '../audio/engine.js'
import { IMAGE_LOADER, kitHitSettings, pcmFromImageBytes } from '../audio/imageSpectrum.js'
import { songId } from '../jobs.js'
import { cachePcm } from './library.js'
import { emptyPad, model, plainText, touch } from '../model.js'

export async function importPictureUrl(url, name, { toPad = false, index = model.selected, settings = IMAGE_LOADER } = {}) {
  const song = songId()
  const title = plainText(name, 80) || 'picture'
  model.browserNote = `Reading ${title}`
  touch(false)
  let decoded
  try {
    decoded = await pcmFromImageBytes(await fetchMediaBytes(url), settings)
  } catch (err) {
    throw new Error(pictureProblem(err))
  }
  const { pcm, sr } = decoded
  if (toPad) {
    await placePcm(index, pcm, sr, title, { forceName: true, song })
    return
  }
  await cachePcm('imports', title, pcm, sr, 'wav')
  model.browserNote = `${title} is in Cache. Load it onto a pad to keep it in a song.`
  touch(true)
}

/** How long one kit picture may take, every try included. A slow host is skipped instead of holding the kit. */
export const KIT_PICTURE_MS = 12000

/**
 * What a picture read that failed says on screen. Our own words (too big, too many requests, the host blocked it)
 * come through; anything else, a decoder's or the network's, becomes a plain sentence.
 */
export function pictureProblem(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'That host took too long to answer'
  if (err?.name === 'TooLarge' || err?.status === 429) return err.message
  const words = typeof err?.message === 'string' ? err.message : ''
  if (/^(That |Too many requests)/.test(words)) return words
  return 'That picture could not be read. The host may be down, or it is not a png or jpg.'
}

/**
 * fetch for one kit picture: it stops at `ms`, or when `outer` (the whole kit) is cancelled, whichever is first.
 * The reader's own timeout and signal still apply on top.
 */
function pictureFetch(outer, ms) {
  const picture = new AbortController()
  const timer = setTimeout(() => picture.abort(), ms)
  const fetchImpl = (url, init = {}) => {
    const call = new AbortController()
    const stop = () => call.abort()
    for (const signal of [init.signal, picture.signal, outer]) {
      if (!signal) continue
      if (signal.aborted) call.abort()
      else signal.addEventListener('abort', stop, { once: true })
    }
    return fetch(url, { ...init, signal: call.signal })
  }
  return { fetchImpl, done: () => clearTimeout(timer) }
}

/**
 * Pads and samples for a kit. A picture that cannot be read is skipped.
 * `alive` returning false stops the rest, and `signal` aborting stops the picture being read; nothing is written to the
 * session here.
 * @param {{ url: string, name?: string }[]} picks
 * @param {{ onEach?: (pick: any, i: number) => void, alive?: () => boolean, signal?: AbortSignal, pictureMs?: number }} [options]
 */
export async function pictureKitDoc(picks, { onEach, alive, signal, pictureMs = KIT_PICTURE_MS } = {}) {
  const pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  const samples = []
  let skipped = 0
  let error = ''
  for (let i = 0; i < picks.length; i++) {
    if (alive && !alive()) return { doc: null, made: samples.length, skipped, error, cancelled: true }
    const pick = picks[i]
    onEach?.(pick, i)
    const read = pictureFetch(signal, pictureMs)
    try {
      const bytes = await fetchMediaBytes(pick.url, read.fetchImpl)
      const { pcm, sr } = await pcmFromImageBytes(bytes, kitHitSettings(samples.length))
      const name = plainText(pick.name, 80) || 'picture'
      const pad = pads[samples.length]
      pad.name = name
      pad.source = 'sample'
      pad.sampleName = name
      pad.mode = 'oneshot'
      samples.push({ pad: samples.length, pcm, sr, name })
    } catch (err) {
      if ((alive && !alive()) || signal?.aborted) return { doc: null, made: samples.length, skipped, error, cancelled: true }
      skipped += 1
      if (!error) error = pictureProblem(err)
    } finally {
      read.done()
    }
  }
  if ((alive && !alive()) || signal?.aborted) return { doc: null, made: samples.length, skipped, error, cancelled: true }
  if (!samples.length) return { doc: null, made: 0, skipped, error, cancelled: false }
  return {
    doc: { type: 'k1t', v: 1, name: 'Milady kit', pads, samples },
    made: samples.length,
    skipped,
    error,
    cancelled: false,
  }
}

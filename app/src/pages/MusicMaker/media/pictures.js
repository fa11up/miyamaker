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
  const bytes = await fetchMediaBytes(url)
  const { pcm, sr } = await pcmFromImageBytes(bytes, settings)
  if (toPad) {
    await placePcm(index, pcm, sr, title, { forceName: true, song })
    return
  }
  await cachePcm('imports', title, pcm, sr, 'wav')
  model.browserNote = `${title} is in Cache. Load it onto a pad to keep it in a song.`
  touch(true)
}

/**
 * Pads and samples for a kit. A picture that cannot be read is skipped.
 * `alive` returning false stops the rest; nothing is written to the session here.
 */
export async function pictureKitDoc(picks, { onEach, alive } = {}) {
  const pads = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  const samples = []
  let skipped = 0
  let error = ''
  for (let i = 0; i < picks.length; i++) {
    if (alive && !alive()) return { doc: null, made: samples.length, skipped, error, cancelled: true }
    const pick = picks[i]
    onEach?.(pick, i)
    try {
      const bytes = await fetchMediaBytes(pick.url)
      const { pcm, sr } = await pcmFromImageBytes(bytes, kitHitSettings(samples.length))
      const name = plainText(pick.name, 80) || 'picture'
      const pad = pads[samples.length]
      pad.name = name
      pad.source = 'sample'
      pad.sampleName = name
      pad.mode = 'oneshot'
      samples.push({ pad: samples.length, pcm, sr, name })
    } catch (err) {
      skipped += 1
      if (!error) error = err?.message || 'That picture could not be read'
    }
  }
  if (!samples.length) return { doc: null, made: 0, skipped, error, cancelled: false }
  return {
    doc: { type: 'k1t', v: 1, name: 'Milady kit', pads, samples },
    made: samples.length,
    skipped,
    error,
    cancelled: false,
  }
}

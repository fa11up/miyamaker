import { bounceOrder, bounceSeconds, renderBounce } from './audio/engine.js'
import { captureKit, captureSong } from './audio/song.js'
import { songValue } from './audio/arrange.js'
import { assertPadsRead, model, unreadPads } from './model.js'

/** Pads whose sample could not be read. The release dialog can check this before it offers anything. */
export { unreadPads }

function packedFile(doc, ext) {
  return new File([JSON.stringify(doc)], `${doc.name || 'Song'}.${ext}`, { type: 'application/json' })
}

export async function buildPublish(intent) {
  // A pad whose sample did not load would be silent in the WAV and missing from the pack, for good.
  assertPadsRead(intent.startsWith('mint') ? 'Mint' : 'Upload')
  const name = model.songName || 'Song'
  const bpm = model.bpm
  const packKind = intent === 'upload-kit' || intent === 'mint-kit'
    ? 'kit'
    : intent === 'upload-bounce' || intent === 'mint-audio'
      ? 'audio'
      : 'song'
  const wantsAudio = intent === 'upload-bounce' || intent.startsWith('mint-')
  const wantsPack = packKind !== 'audio'
  let audio
  let duration
  if (wantsAudio) {
    // The length the bounce renders: the whole song order when the song plays, not the open pattern.
    const order = bounceOrder()
    duration = bounceSeconds(order, bpm)
    audio = new File([await renderBounce()], `${name}.wav`, { type: 'audio/wav' })
  }
  let pack
  if (wantsPack) {
    const what = intent.startsWith('mint') ? 'Mint' : 'Upload'
    const doc = packKind === 'kit' ? await captureKit(name, what) : await captureSong(name, what)
    pack = packedFile(doc, packKind === 'kit' ? 'k1t' : 'm1ya')
  }
  return { intent, packKind, name, bpm, audio, duration, pack }
}

export function askPublish(intent) {
  const event = new CustomEvent('miya-music-publish', {
    cancelable: true,
    detail: { intent, name: model.songName || 'Song', bpm: songValue(model, 'bpm') },
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

export function listenForFiles(handler) {
  const onNeed = (event) => {
    event.preventDefault()
    const requestId = event.detail?.requestId
    const intent = event.detail?.intent
    handler(intent)
      .then((built) => {
        window.dispatchEvent(new CustomEvent('miya-music-files', { detail: { requestId, ...built } }))
      })
      .catch((error) => {
        window.dispatchEvent(new CustomEvent('miya-music-files', {
          detail: { requestId, error: error?.message || 'Could not prepare that file' },
        }))
      })
  }
  window.addEventListener('miya-music-need-files', onNeed)
  return () => window.removeEventListener('miya-music-need-files', onNeed)
}

export function requestFiles(intent) {
  const requestId = Math.random().toString(36).slice(2)
  return new Promise((resolve, reject) => {
    const onFiles = (event) => {
      if (event.detail?.requestId !== requestId) return
      window.removeEventListener('miya-music-files', onFiles)
      if (event.detail.error) reject(new Error(event.detail.error))
      else resolve(event.detail)
    }
    window.addEventListener('miya-music-files', onFiles)
    const ask = new CustomEvent('miya-music-need-files', { cancelable: true, detail: { requestId, intent } })
    window.dispatchEvent(ask)
    if (!ask.defaultPrevented) {
      window.removeEventListener('miya-music-files', onFiles)
      reject(new Error('Arweave and mint run inside miyamaker.com'))
    }
  })
}

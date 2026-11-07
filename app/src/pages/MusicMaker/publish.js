import { renderBounce } from './audio/engine.js'
import { captureKit, captureSong } from './audio/song.js'
import { model, stepCount } from './model.js'

function packedFile(doc, ext) {
  return new File([JSON.stringify(doc)], `${doc.name || 'Song'}.${ext}`, { type: 'application/json' })
}

export async function buildPublish(intent) {
  const name = model.songName || 'Song'
  const bpm = model.bpm
  const packKind = intent === 'upload-kit' || intent === 'mint-kit' ? 'kit' : 'song'
  const wantsAudio = intent === 'upload-bounce' || intent.startsWith('mint-')
  const wantsPack = intent !== 'upload-bounce'
  let audio
  let duration
  if (wantsAudio) {
    audio = new File([await renderBounce()], `${name}.wav`, { type: 'audio/wav' })
    duration = stepCount() * (60 / Math.max(1, bpm) / 4) + 0.6
  }
  let pack
  if (wantsPack) {
    const doc = packKind === 'kit' ? await captureKit(name) : await captureSong(name)
    pack = packedFile(doc, packKind === 'kit' ? 'k1t' : 'm1ya')
  }
  return { intent, packKind, name, bpm, audio, duration, pack }
}

export function askPublish(intent) {
  const event = new CustomEvent('miya-music-publish', {
    cancelable: true,
    detail: { intent, name: model.songName || 'Song', bpm: model.bpm },
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

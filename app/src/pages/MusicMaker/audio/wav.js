function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

export function encodeWav(channels, sampleRate) {
  const ch = channels.length
  const n = channels[0].length
  const buffer = new ArrayBuffer(44 + n * ch * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + n * ch * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, ch, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * ch * 2, true)
  view.setUint16(32, ch * 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, n * ch * 2, true)
  let offset = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let s = channels[c][i] || 0
      if (s > 1) s = 1
      else if (s < -1) s = -1
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export function mixToMono(audioBuffer) {
  const n = audioBuffer.length
  const pcm = new Float32Array(n)
  const ch = audioBuffer.numberOfChannels
  for (let c = 0; c < ch; c++) {
    const data = audioBuffer.getChannelData(c)
    for (let i = 0; i < n; i++) pcm[i] += data[i] / ch
  }
  return { pcm, sr: audioBuffer.sampleRate, channels: ch }
}

export function trimSilence(pcm, sampleRate, thresh = 0.012) {
  let a = 0
  let b = pcm.length - 1
  while (a < b && Math.abs(pcm[a]) < thresh) a += 1
  while (b > a && Math.abs(pcm[b]) < thresh) b -= 1
  const pre = Math.floor(sampleRate * 0.004)
  a = Math.max(0, a - pre)
  b = Math.min(pcm.length - 1, b + pre)
  if (b <= a) return { start: 0, end: 1 }
  return { start: a / pcm.length, end: (b + 1) / pcm.length }
}

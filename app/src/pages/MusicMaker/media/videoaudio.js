/**
 * The app's side of the video-to-audio route: which links it takes, and where it asks.
 * The page URL is checked here, by the app before it asks and by the server again (api/_lib/videoaudio.ts, which
 * fetches the audio). No imports, so the Worker and `node --test` load it too.
 */

export const VIDEO_AUDIO_PATH = '/api/video-audio'

export function videoPage(raw) {
  const text = String(raw || '').trim()
  if (/^lbry:\/\//i.test(text)) {
    const lbry = text.split('?')[0]
    if (!/^lbry:\/\/[^/\s]+/i.test(lbry)) return null
    return { kind: 'odysee', lbry, href: lbry }
  }
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] || ''
    return youtubePage(id)
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const watch = url.searchParams.get('v')
    if (watch) return youtubePage(watch)
    const parts = url.pathname.split('/').filter(Boolean)
    const marker = parts.findIndex((part) => part === 'shorts' || part === 'embed' || part === 'live' || part === 'v')
    if (marker >= 0) return youtubePage(parts[marker + 1] || '')
    return null
  }
  if (host === 'odysee.com' || host === 'lbry.tv') {
    const lbry = odyseePathToLbry(url.pathname)
    if (!lbry) return null
    return { kind: 'odysee', lbry, href: url.origin + url.pathname }
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    const match = url.pathname.match(/\/status\/(\d+)/)
    if (!match) return null
    return { kind: 'x', id: match[1], href: `https://x.com/i/status/${match[1]}` }
  }
  return null
}

function youtubePage(id) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return null
  return { kind: 'youtube', id, href: `https://www.youtube.com/watch?v=${id}` }
}

function odyseePathToLbry(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  const embed = parts[0] === '$' && parts[1] === 'embed' ? parts.slice(2) : parts
  if (!embed.length) return null
  try {
    return `lbry://${embed.map((part) => decodeURIComponent(part)).join('/')}`
  } catch {
    return null
  }
}

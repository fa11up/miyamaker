/**
 * Turn a YouTube, Odysee, LBRY, or X link into a short audio file.
 * The page URL is checked here. The bytes are fetched only from the stream
 * host that the page's own API names (googlevideo, odycdn, or twimg).
 */

export const VIDEO_AUDIO_PATH = '/api/video-audio'
export const VIDEO_AUDIO_LIMIT = 8 * 1024 * 1024

const PAGE_UA = 'Mozilla/5.0'

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
  return `lbry://${embed.map((part) => decodeURIComponent(part)).join('/')}`
}

export function allowedStream(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const ok = host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
    || host === 'odycdn.com' || host.endsWith('.odycdn.com')
    || host === 'twimg.com' || host.endsWith('.twimg.com')
  return ok ? url : null
}

export function pickYoutubeAudio(data) {
  const formats = [
    ...(data?.streamingData?.adaptiveFormats || []),
    ...(data?.streamingData?.formats || []),
  ]
  const audio = formats.filter((fmt) => String(fmt?.mimeType || '').startsWith('audio/') && fmt.url && allowedStream(fmt.url))
  audio.sort((a, b) => rankAudio(a) - rankAudio(b) || (a.bitrate || 0) - (b.bitrate || 0))
  if (!audio.length) {
    const reason = data?.playabilityStatus?.reason
    throw new Error(reason || 'That video has no audio stream this app can read')
  }
  const pick = audio[0]
  const title = data?.videoDetails?.title || 'youtube'
  return { name: title, url: pick.url, mime: String(pick.mimeType || 'audio/webm').split(';')[0] }
}

function rankAudio(fmt) {
  const mime = String(fmt.mimeType || '').toLowerCase()
  if (mime.includes('opus') || mime.includes('webm')) return 0
  if (mime.includes('ogg')) return 1
  return 2
}

export function pickOdyseeAudio(claim) {
  if (!claim || claim.error) throw new Error(claim?.error?.message || claim?.error || 'That LBRY claim was not found')
  const name = claim.value?.title || claim.name || 'odysee'
  const mime = claim.value?.source?.media_type || 'video/mp4'
  const direct = odyseeStreamUrl(claim)
  if (!direct || !allowedStream(direct)) throw new Error('That LBRY claim has no audio this app can read')
  return { name, url: direct, mime }
}

function odyseeStreamUrl(claim) {
  const claimName = claim?.name
  const claimId = claim?.claim_id
  if (!claimName || !claimId) return null
  const source = claim.value?.source
  const hash = source?.sd_hash ? String(source.sd_hash).slice(0, 6) : ''
  const ext = extensionFor(source?.media_type)
  const base = `https://player.odycdn.com/api/v3/streams/free/${encodeURIComponent(claimName)}/${claimId}`
  return hash ? `${base}/${hash}${ext}` : base
}

function extensionFor(mime) {
  const type = String(mime || '').toLowerCase()
  if (type.includes('webm')) return '.webm'
  if (type.includes('ogg')) return '.ogg'
  if (type.includes('mp4') || type.includes('mpeg')) return '.mp4'
  if (type.includes('audio')) return '.mp4'
  return '.mp4'
}

export function pickXAudio(data, id) {
  const variants = []
  collectVariants(data, variants)
  const clips = variants.filter((item) => {
    const type = String(item?.type || item?.content_type || '').toLowerCase()
    return type.includes('mp4') && item.url && allowedStream(item.url)
  })
  clips.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))
  if (!clips.length) throw new Error('That post has no video audio')
  const text = String(data?.text || data?.full_text || `Post ${id}`).replace(/\s+/g, ' ').trim()
  return { name: text.slice(0, 80) || `Post ${id}`, url: clips[0].url, mime: 'video/mp4' }
}

function collectVariants(node, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item) => collectVariants(item, out))
    return
  }
  if (Array.isArray(node.variants)) node.variants.forEach((item) => out.push(item))
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectVariants(value, out)
  }
}

export async function resolveVideoAudio(page, fetchImpl = fetch) {
  if (page.kind === 'youtube') return youtubeAudio(page.id, fetchImpl)
  if (page.kind === 'odysee') return odyseeAudio(page.lbry, fetchImpl)
  if (page.kind === 'x') return xAudio(page.id, fetchImpl)
  throw new Error('Use a YouTube, Odysee, LBRY, or X link.')
}

const VISION_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

async function youtubeVisitor(id, fetchImpl) {
  const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': PAGE_UA },
    body: JSON.stringify({
      context: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20260708.00.00' } },
      videoId: id,
    }),
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data?.responseContext?.visitorData || ''
}

async function youtubeAudio(id, fetchImpl) {
  const visitorData = await youtubeVisitor(id, fetchImpl)
  const clients = [
    {
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      clientId: '101',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
      userAgent: VISION_UA,
    },
  ]
  let last = 'That video has no audio stream this app can read'
  for (const client of clients) {
    try {
      const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': client.userAgent,
          'x-youtube-client-name': client.clientId,
          'x-youtube-client-version': client.clientVersion,
          origin: 'https://www.youtube.com',
        },
        body: JSON.stringify({
          context: {
            client: {
              hl: 'en',
              gl: 'US',
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              deviceMake: client.deviceMake,
              deviceModel: client.deviceModel,
              osName: client.osName,
              osVersion: client.osVersion,
              userAgent: client.userAgent,
              visitorData: visitorData || undefined,
            },
          },
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      })
      if (!res.ok) {
        last = 'YouTube did not answer'
        continue
      }
      const picked = pickYoutubeAudio(await res.json())
      return { ...picked, ua: client.userAgent }
    } catch (error) {
      last = error?.message || last
    }
  }
  throw new Error(last)
}

async function odyseeAudio(lbry, fetchImpl) {
  const resolved = await odyseeCall('resolve', { urls: [lbry] }, fetchImpl)
  const claim = claimFrom(resolved, lbry)
  const name = claim?.value?.title || claim?.name || 'odysee'
  const mime = claim?.value?.source?.media_type || 'video/mp4'
  const got = await odyseeCall('get', { uri: lbry }, fetchImpl)
  const streaming = got?.result?.streaming_url || got?.streaming_url
  if (allowedStream(streaming)) return { name, url: streaming, mime }
  return pickOdyseeAudio(claim)
}

async function odyseeCall(method, params, fetchImpl) {
  const res = await fetchImpl(`https://api.na-backend.odysee.com/api/v1/proxy?m=${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': PAGE_UA },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error('Odysee did not answer')
  const data = await res.json()
  if (data?.error) throw new Error(data.error.message || 'Odysee did not answer')
  return data
}

function claimFrom(data, lbry) {
  const result = data?.result && typeof data.result === 'object' ? data.result : data
  if (!result || typeof result !== 'object') return null
  return result[lbry] || Object.values(result).find((item) => item && typeof item === 'object' && item.claim_id) || null
}

async function xAudio(id, fetchImpl) {
  const res = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en`, {
    headers: { 'user-agent': PAGE_UA },
  })
  if (!res.ok) throw new Error('That post could not be read')
  return pickXAudio(await res.json(), id)
}

function json(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readPrefix(response) {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer())
    return buf.byteLength > VIDEO_AUDIO_LIMIT ? buf.slice(0, VIDEO_AUDIO_LIMIT) : buf
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    const value = step.value
    if (!value?.byteLength) continue
    const room = VIDEO_AUDIO_LIMIT - total
    if (value.byteLength > room) {
      chunks.push(value.slice(0, room))
      total += room
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.byteLength
    if (total >= VIDEO_AUDIO_LIMIT) {
      await reader.cancel()
      break
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function refererFor(page) {
  if (page.kind === 'youtube') return 'https://www.youtube.com/'
  if (page.kind === 'odysee') return 'https://odysee.com/'
  return 'https://x.com/'
}

export async function handleVideoAudioRequest(request, env = {}) {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname.replace(/\/+$/, '') !== VIDEO_AUDIO_PATH) return json(404, 'Not found.')
  if (request.method !== 'GET') return json(405, 'GET only.')
  if (env.sameOrigin && !env.sameOrigin(request.headers, url)) return json(403, 'Same-origin only.')
  if (env.limiter && env.clientKey && !env.limiter(env.clientKey(request.headers))) {
    return json(429, 'Too many video reads.')
  }
  const page = videoPage(url.searchParams.get('url'))
  if (!page) return json(400, 'Use a YouTube, Odysee, LBRY, or X link.')
  const fetchImpl = env.fetchImpl ?? fetch
  let resolved
  try {
    resolved = await resolveVideoAudio(page, fetchImpl)
  } catch (error) {
    return json(422, error?.message || 'Could not read that video')
  }
  const stream = allowedStream(resolved.url)
  if (!stream) return json(422, 'Could not read that video')
  const streamHeaders = {
    'user-agent': resolved.ua || PAGE_UA,
    referer: refererFor(page),
    range: `bytes=0-${VIDEO_AUDIO_LIMIT - 1}`,
  }
  let upstream
  try {
    upstream = await fetchImpl(stream, { redirect: 'manual', headers: streamHeaders })
  } catch {
    return json(502, 'The video host did not answer.')
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    const next = allowedStream(upstream.headers.get('location'))
    if (!next) return json(422, 'That audio redirect is not allowed.')
    try {
      upstream = await fetchImpl(next, { redirect: 'manual', headers: streamHeaders })
    } catch {
      return json(502, 'The video host did not answer.')
    }
    if (upstream.status >= 300 && upstream.status < 400) return json(422, 'That audio redirect is not allowed.')
  }
  if (upstream.status === 429) return json(429, 'The video host is busy. Try that link again.')
  if (!upstream.ok && upstream.status !== 206) return json(502, 'The video host refused the audio.')
  const body = await readPrefix(upstream)
  if (!body.byteLength) return json(502, 'The video host sent no audio.')
  const name = String(resolved.name || 'video').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': resolved.mime || 'application/octet-stream',
      'content-length': String(body.byteLength),
      'x-sample-name': encodeURIComponent(name),
      'cache-control': 'private, max-age=300',
    },
  })
}

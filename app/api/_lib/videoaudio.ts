/**
 * Turn a YouTube, Odysee, LBRY, or X link into a short audio file, on the site's own origin.
 * The page URL is checked by the app's own videoPage (media/videoaudio.js, which the app also uses before asking).
 * The bytes are fetched only from the stream host that the page's own API names (googlevideo, odycdn, or twimg).
 * The content type sent back is picked here from the format this file chose, never from what a page or a
 * claim says about itself (a publisher writes an Odysee claim's media_type), see media/serve.js.
 * sameOrigin, clientKey and the limiter are passed in (see zeroex.ts), and without them every request is refused,
 * so this file loads under `node --test` with only import-free modules and can never run unguarded.
 */

import { cappedStream, mediaHeaders, peekStream } from '../../src/pages/MusicMaker/media/serve.js'
import { VIDEO_AUDIO_PATH, videoPage } from '../../src/pages/MusicMaker/media/videoaudio.js'

export { VIDEO_AUDIO_PATH, videoPage }
export const VIDEO_AUDIO_LIMIT = 8 * 1024 * 1024

/** One link costs this many tokens: a page lookup or two, then the stream, and maybe its redirect. */
export const VIDEO_AUDIO_COST = 3
/** Four links in a burst, then one every half minute or so. */
export const VIDEO_AUDIO_RATE = { capacity: 4 * VIDEO_AUDIO_COST, perSecond: 0.1 }

type Page = { kind: 'youtube'; id: string; href: string } | { kind: 'odysee'; lbry: string; href: string } | { kind: 'x'; id: string; href: string }

type Picked = { name: string; url: string; format: string; mime: string; ua?: string }

type Guard = {
  sameOrigin?: (headers: Headers | undefined, url: URL) => boolean
  clientKey?: (headers: Headers | undefined) => string
  limiter?: (key: string, now?: number) => boolean
  /** Tokens one request takes from the limiter. */
  cost?: number
  fetchImpl?: typeof fetch
}

// The answers below come from outside APIs and are read defensively, field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const PAGE_UA = 'Mozilla/5.0'

/** The only types this route answers with, keyed on the container it picked. */
const STREAM_TYPES: Record<string, string> = {
  'audio-webm': 'audio/webm',
  'audio-mp4': 'audio/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
}

export function streamType(format: string) {
  return Object.prototype.hasOwnProperty.call(STREAM_TYPES, format) ? STREAM_TYPES[format]! : 'application/octet-stream'
}

/** An https URL on one of the three stream hosts, or null. */
export function allowedStream(raw: unknown): URL | null {
  if (raw == null || raw === '') return null
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const ok =
    host === 'googlevideo.com' ||
    host.endsWith('.googlevideo.com') ||
    host === 'odycdn.com' ||
    host.endsWith('.odycdn.com') ||
    host === 'twimg.com' ||
    host.endsWith('.twimg.com')
  return ok ? url : null
}

export function pickYoutubeAudio(data: Loose): Picked {
  const formats: Loose[] = [...(data?.streamingData?.adaptiveFormats || []), ...(data?.streamingData?.formats || [])]
  const audio = formats.filter((fmt) => String(fmt?.mimeType || '').startsWith('audio/') && fmt.url && allowedStream(fmt.url))
  audio.sort((a, b) => rankAudio(a) - rankAudio(b) || (a.bitrate || 0) - (b.bitrate || 0))
  if (!audio.length) {
    const reason = data?.playabilityStatus?.reason
    throw new Error(reason || 'That video has no audio stream this app can read')
  }
  const pick = audio[0]
  const title = data?.videoDetails?.title || 'youtube'
  const format = String(pick.mimeType || '').toLowerCase().includes('mp4') ? 'audio-mp4' : 'audio-webm'
  return { name: title, url: pick.url, format, mime: streamType(format) }
}

function rankAudio(fmt: Loose) {
  const mime = String(fmt.mimeType || '').toLowerCase()
  if (mime.includes('opus') || mime.includes('webm')) return 0
  if (mime.includes('ogg')) return 1
  return 2
}

export function pickOdyseeAudio(claim: Loose): Picked {
  if (!claim || claim.error) throw new Error(claim?.error?.message || claim?.error || 'That LBRY claim was not found')
  const name = claim.value?.title || claim.name || 'odysee'
  const format = odyseeFormat(claim.value?.source?.media_type)
  const direct = odyseeStreamUrl(claim)
  if (!direct || !allowedStream(direct)) throw new Error('That LBRY claim has no audio this app can read')
  return { name, url: direct, format, mime: streamType(format) }
}

function odyseeStreamUrl(claim: Loose) {
  const claimName = claim?.name
  const claimId = claim?.claim_id
  if (!claimName || !claimId) return null
  const source = claim.value?.source
  const hash = source?.sd_hash ? String(source.sd_hash).slice(0, 6) : ''
  const ext = `.${odyseeFormat(source?.media_type)}`
  const base = `https://player.odycdn.com/api/v3/streams/free/${encodeURIComponent(claimName)}/${claimId}`
  return hash ? `${base}/${hash}${ext}` : base
}

/** The claim's media_type only steers which container is asked for: webm, ogg, or mp4 for everything else. */
function odyseeFormat(mime: unknown) {
  const type = String(mime || '').toLowerCase()
  if (type.includes('webm')) return 'webm'
  if (type.includes('ogg')) return 'ogg'
  return 'mp4'
}

export function pickXAudio(data: Loose, id: string): Picked {
  const variants: Loose[] = []
  collectVariants(data, variants)
  const clips = variants.filter((item) => {
    const type = String(item?.type || item?.content_type || '').toLowerCase()
    return type.includes('mp4') && item.url && allowedStream(item.url)
  })
  clips.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))
  if (!clips.length) throw new Error('That post has no video audio')
  const text = String(data?.text || data?.full_text || `Post ${id}`)
    .replace(/\s+/g, ' ')
    .trim()
  return { name: text.slice(0, 80) || `Post ${id}`, url: clips[0].url, format: 'mp4', mime: streamType('mp4') }
}

function collectVariants(node: Loose, out: Loose[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item) => collectVariants(item, out))
    return
  }
  if (Array.isArray(node.variants)) node.variants.forEach((item: Loose) => out.push(item))
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectVariants(value, out)
  }
}

export async function resolveVideoAudio(page: Page, fetchImpl: typeof fetch = fetch): Promise<Picked> {
  if (page.kind === 'youtube') return youtubeAudio(page.id, fetchImpl)
  if (page.kind === 'odysee') return odyseeAudio(page.lbry, fetchImpl)
  if (page.kind === 'x') return xAudio(page.id, fetchImpl)
  throw new Error('Use a YouTube, Odysee, LBRY, or X link.')
}

const VISION_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

async function youtubeVisitor(id: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': PAGE_UA },
    body: JSON.stringify({
      context: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20260708.00.00' } },
      videoId: id,
    }),
  })
  if (!res.ok) return ''
  const data: Loose = await res.json()
  return data?.responseContext?.visitorData || ''
}

async function youtubeAudio(id: string, fetchImpl: typeof fetch): Promise<Picked> {
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
      last = (error as Error)?.message || last
    }
  }
  throw new Error(last)
}

async function odyseeAudio(lbry: string, fetchImpl: typeof fetch): Promise<Picked> {
  const resolved = await odyseeCall('resolve', { urls: [lbry] }, fetchImpl)
  const claim = claimFrom(resolved, lbry)
  const name = claim?.value?.title || claim?.name || 'odysee'
  const format = odyseeFormat(claim?.value?.source?.media_type)
  const got = await odyseeCall('get', { uri: lbry }, fetchImpl)
  const streaming = got?.result?.streaming_url || got?.streaming_url
  if (allowedStream(streaming)) return { name, url: streaming, format, mime: streamType(format) }
  return pickOdyseeAudio(claim)
}

async function odyseeCall(method: string, params: unknown, fetchImpl: typeof fetch): Promise<Loose> {
  const res = await fetchImpl(`https://api.na-backend.odysee.com/api/v1/proxy?m=${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': PAGE_UA },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error('Odysee did not answer')
  const data: Loose = await res.json()
  if (data?.error) throw new Error(data.error.message || 'Odysee did not answer')
  return data
}

function claimFrom(data: Loose, lbry: string): Loose {
  const result = data?.result && typeof data.result === 'object' ? data.result : data
  if (!result || typeof result !== 'object') return null
  return result[lbry] || Object.values(result).find((item: Loose) => item && typeof item === 'object' && item.claim_id) || null
}

async function xAudio(id: string, fetchImpl: typeof fetch): Promise<Picked> {
  const res = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en`, {
    headers: { 'user-agent': PAGE_UA },
  })
  if (!res.ok) throw new Error('That post could not be read')
  return pickXAudio(await res.json(), id)
}

function json(status: number, message: string, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })
}

function refererFor(page: Page) {
  if (page.kind === 'youtube') return 'https://www.youtube.com/'
  if (page.kind === 'odysee') return 'https://odysee.com/'
  return 'https://x.com/'
}

/** Takes `cost` tokens. A refused request still spends what it took, so a client over its limit stays there. */
function take(limiter: (key: string) => boolean, key: string, cost: number) {
  for (let i = 0; i < cost; i += 1) if (!limiter(key)) return false
  return true
}

export async function handleVideoAudioRequest(
  request: { method: string; url: string; headers?: Headers },
  env: Guard
): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  // The Worker routes this exact path only, so the handler answers the same one.
  if (url.pathname !== VIDEO_AUDIO_PATH) return json(404, 'Not found.')
  if (request.method !== 'GET') return json(405, 'GET only.', { allow: 'GET' })
  // Fail closed: a caller that forgets a guard gets an error, never an open proxy.
  if (!env?.sameOrigin || !env.clientKey || !env.limiter) return json(500, 'The video reader is not configured.')
  if (!env.sameOrigin(request.headers, url)) return json(403, 'Same-origin only.')
  if (!take(env.limiter, env.clientKey(request.headers), env.cost ?? VIDEO_AUDIO_COST)) {
    return json(429, 'Too many video reads. Wait a minute.', { 'retry-after': '30' })
  }
  const page = videoPage(url.searchParams.get('url')) as Page | null
  if (!page) return json(400, 'Use a YouTube, Odysee, LBRY, or X link.')
  const fetchImpl = env.fetchImpl ?? fetch
  let resolved: Picked
  try {
    resolved = await resolveVideoAudio(page, fetchImpl)
  } catch (error) {
    return json(422, (error as Error)?.message || 'Could not read that video')
  }
  const stream = allowedStream(resolved.url)
  if (!stream) return json(422, 'Could not read that video')
  const streamHeaders = {
    'user-agent': resolved.ua || PAGE_UA,
    referer: refererFor(page),
    range: `bytes=0-${VIDEO_AUDIO_LIMIT - 1}`,
  }
  let upstream: Response
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
  // Passed on as it arrives, cut at the cap, rather than held whole. The first chunk is read so an empty answer is caught.
  let body: ReadableStream<Uint8Array> | null
  try {
    body = upstream.body ? await peekStream(cappedStream(upstream.body, VIDEO_AUDIO_LIMIT, { truncate: true })) : null
  } catch {
    return json(502, 'The video host did not answer.')
  }
  if (!body) return json(502, 'The video host sent no audio.')
  const name =
    String(resolved.name || 'video')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'video'
  try {
    return new Response(body, {
      status: 200,
      headers: mediaHeaders(streamType(resolved.format), { 'x-sample-name': sampleName(name) }),
    })
  } catch {
    await body.cancel().catch(() => undefined)
    return json(502, 'The video host sent audio this site cannot pass on.')
  }
}

/** A header-safe name. encodeURIComponent throws on a broken surrogate pair, which a title can carry. */
function sampleName(name: string) {
  try {
    return encodeURIComponent(name)
  } catch {
    return 'video'
  }
}

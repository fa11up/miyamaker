/**
 * Pure helpers for music drops: client-side file validation, the token metadata builder, and the
 * metadata → Track parser used by miya radio. No DOM/React/env access so `node --test` can run them
 * (tests/music-audio.test.mts).
 *
 * Safety rules (enforced here, relied on by the UI):
 *  - URIs are only accepted with http(s)://, ipfs:// or ar:// schemes (`safeUri`); resolution to a
 *    gateway URL happens later through src/utils/resolveUri.
 *  - Metadata strings are reduced to bounded plain text; the UI renders them as React text, never HTML.
 */
import type { Track } from './types'

// ── File validation ───────────────────────────────────────────────────────────

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Accepted audio extensions → MIME types a browser may report for them (first is canonical). */
export const AUDIO_TYPES: Record<string, readonly string[]> = {
  mp3: ['audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/mpeg3'],
  ogg: ['audio/ogg', 'application/ogg', 'audio/vorbis', 'audio/opus'],
  oga: ['audio/ogg'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  flac: ['audio/flac', 'audio/x-flac'],
}

export const IMAGE_TYPES: Record<string, readonly string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
}

export const AUDIO_ACCEPT = Object.keys(AUDIO_TYPES)
  .map((ext) => `.${ext}`)
  .concat(Array.from(new Set(Object.values(AUDIO_TYPES).flat())))
  .join(',')

export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES)
  .map((ext) => `.${ext}`)
  .join(',')

export type FileLike = { name: string; type: string; size: number }
export type FileCheck = { ok: true; ext: string; mime: string } | { ok: false; error: string }

const extOf = (name: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? (m[1] as string).toLowerCase() : ''
}

function checkFile(file: FileLike, table: Record<string, readonly string[]>, max: number, kind: string): FileCheck {
  const ext = extOf(file.name)
  const allowed = table[ext]
  const list = Object.keys(table).join(', ')
  if (!allowed) return { ok: false, error: `Unsupported ${kind} file. Use ${list}.` }
  const type = (file.type || '').toLowerCase().split(';')[0]?.trim() || ''
  // Browsers sometimes report '' (or octet-stream) for valid files; the extension decides then.
  if (type && type !== 'application/octet-stream' && !allowed.includes(type)) {
    return { ok: false, error: `File type ${type} does not match .${ext}.` }
  }

  if (!(file.size > 0)) return { ok: false, error: 'The file is empty.' }
  if (file.size > max) return { ok: false, error: `The file is too large (max ${Math.round(max / 1024 / 1024)} MB).` }
  return { ok: true, ext, mime: allowed[0] as string }
}

export const validateAudioFile = (file: FileLike) => checkFile(file, AUDIO_TYPES, MAX_AUDIO_BYTES, 'audio')
export const validateImageFile = (file: FileLike) => checkFile(file, IMAGE_TYPES, MAX_IMAGE_BYTES, 'image')

// ── URIs and text ─────────────────────────────────────────────────────────────

const SAFE_SCHEME = /^(https?:\/\/|ipfs:\/\/|ar:\/\/)/i

/** Returns the trimmed URI if it uses an allowed scheme and has no whitespace/control chars, else undefined. */
export function safeUri(uri: unknown): string | undefined {
  if (typeof uri !== 'string') return undefined
  const s = uri.trim()
  if (!s || s.length > 2048) return undefined
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f<>"'`]/.test(s)) return undefined
  if (!SAFE_SCHEME.test(s)) return undefined
  const rest = s.replace(SAFE_SCHEME, '')
  return rest ? s : undefined
}

/** Bounded single-line plain text. */
export function plainText(value: unknown, max = 200): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  )
}

/** Multi-line plain text (descriptions). */
export function plainBlock(value: unknown, max = 2000): string {
  if (typeof value !== 'string') return ''
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '')
      .trim()
      .slice(0, max)
  )
}

// ── Audio detection ───────────────────────────────────────────────────────────

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)(?:[?#].*)?$/i

/** True when a URI looks like audio by extension, or a MIME hint says audio/*. */
export function isAudio(uri: string | undefined, mimeHint?: unknown): boolean {
  if (!uri) return false
  if (typeof mimeHint === 'string' && /^audio\//i.test(mimeHint.trim())) return true
  return AUDIO_EXT.test(uri)
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Average bitrate in kbps from the file's size and length, when both are known. */
export function estimateKbps(bytes: number | undefined, seconds: number | undefined): number | undefined {
  if (!bytes || !seconds || !Number.isFinite(bytes) || !Number.isFinite(seconds) || bytes <= 0 || seconds <= 0) {
    return undefined
  }

  return Math.round((bytes * 8) / seconds / 1000)
}

const WAVE_MID = 128
const WAVE_QUIET = 2

/**
 * Reads one slice of byte waveform per channel. A mono file leaves the right channel empty and a dual-mono file
 * makes the two identical, so only audibly different channels count as stereo.
 */
export function classifyChannels(left: Uint8Array, right: Uint8Array): 'silent' | 'mono' | 'stereo' {
  let l = 0
  let r = 0
  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    const a = (left[i] as number) - WAVE_MID
    const b = (right[i] as number) - WAVE_MID
    l = Math.max(l, Math.abs(a))
    r = Math.max(r, Math.abs(b))
    diff = Math.max(diff, Math.abs(a - b))
  }

  if (l <= WAVE_QUIET && r <= WAVE_QUIET) return 'silent'
  if (l <= WAVE_QUIET || r <= WAVE_QUIET || diff <= WAVE_QUIET) return 'mono'
  return 'stereo'
}

// ── Metadata builder ──────────────────────────────────────────────────────────

export type MusicForm = {
  title: string
  artist: string
  description?: string
  /** Cover art URI (ar://, ipfs://, https://). */
  image: string
  /** Audio URI (ar://, ipfs://, https://). */
  audio: string
  /** Canonical MIME of the audio file, e.g. from validateAudioFile. */
  mime: string
  /** Seconds, read from an Audio element before upload. */
  duration: number
  genre?: string
  /** Optional; whole number 20–400. Empty string means unset. */
  bpm?: string | number
  externalUrl?: string
}

export type MusicMetadata = {
  name: string
  description: string
  image: string
  animation_url: string
  external_url?: string
  content: { mime: string; uri: string }
  properties: { artist: string; duration: number; genre?: string; bpm?: number; mime_type: string }
  attributes: { trait_type: string; value: string | number; display_type?: string }[]
}

export type BuildResult =
  | { ok: true; metadata: MusicMetadata }
  | { ok: false; errors: Partial<Record<keyof MusicForm, string>> }

/**
 * Standard ERC-721/1155 metadata for a track: `image` = cover, `animation_url` = audio, plus
 * `properties` {artist, duration, genre, bpm?} and matching `attributes` for marketplaces.
 * `content` mirrors the audio with its MIME so players can detect audio on extensionless (ar://) URIs.
 */
export function buildMusicMetadata(form: MusicForm): BuildResult {
  const errors: Partial<Record<keyof MusicForm, string>> = {}
  const title = plainText(form.title, 120)
  const artist = plainText(form.artist, 80)
  const genre = plainText(form.genre ?? '', 40)
  const description = plainBlock(form.description ?? '', 2000)
  const image = safeUri(form.image)
  const audio = safeUri(form.audio)
  const externalRaw = (form.externalUrl ?? '').trim()
  const external = externalRaw ? safeUri(externalRaw) : undefined
  const mime = (form.mime || '').toLowerCase()

  if (!title) errors.title = 'Title is required.'
  if (!artist) errors.artist = 'Artist is required.'
  if (!image) errors.image = 'Cover art must be an ipfs://, ar:// or https:// link.'
  if (!audio) errors.audio = 'Audio must be an ipfs://, ar:// or https:// link.'
  if (!/^audio\/[a-z0-9.+-]+$/.test(mime)) errors.mime = 'Unknown audio type.'
  if (!(Number.isFinite(form.duration) && form.duration > 0 && form.duration < 24 * 3600)) {
    errors.duration = 'Could not read the track duration.'
  }

  if (externalRaw && !external) errors.externalUrl = 'Website must be an https:// link.'

  let bpm: number | undefined
  const bpmRaw = typeof form.bpm === 'number' ? String(form.bpm) : (form.bpm ?? '').trim()
  if (bpmRaw) {
    if (!/^\d{1,3}$/.test(bpmRaw) || Number(bpmRaw) < 20 || Number(bpmRaw) > 400) {
      errors.bpm = 'BPM must be a whole number from 20 to 400.'
    } else bpm = Number(bpmRaw)
  }

  if (Object.keys(errors).length) return { ok: false, errors }

  const duration = Math.round(form.duration * 10) / 10
  const attributes: MusicMetadata['attributes'] = [
    { trait_type: 'Artist', value: artist },
    { trait_type: 'Duration', value: formatDuration(duration) },
  ]
  if (genre) attributes.push({ trait_type: 'Genre', value: genre })
  if (bpm !== undefined) attributes.push({ trait_type: 'BPM', value: bpm, display_type: 'number' })

  const metadata: MusicMetadata = {
    name: title,
    description,
    image: image as string,
    animation_url: audio as string,
    ...(external ? { external_url: external } : {}),
    content: { mime, uri: audio as string },
    properties: {
      artist,
      duration,
      ...(genre ? { genre } : {}),
      ...(bpm !== undefined ? { bpm } : {}),
      mime_type: mime,
    },
    attributes,
  }
  return { ok: true, metadata }
}

// ── Metadata → Track ──────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function attr(json: Record<string, unknown>, name: string): unknown {
  const attrs = json.attributes
  if (!Array.isArray(attrs)) return undefined
  const hit = attrs.find((a) => isObj(a) && typeof a.trait_type === 'string' && a.trait_type.toLowerCase() === name)
  return isObj(hit) ? hit.value : undefined
}

export type ParsedMusic = {
  title: string
  artist: string
  description: string
  image?: string
  audio: string
  mime?: string
  duration?: number
  genre?: string
  bpm?: number
}

/**
 * Reads untrusted token metadata. Returns null unless it has an audio `animation_url` (by extension or
 * a declared audio MIME) on an allowed scheme. All strings come back as bounded plain text.
 */
export function parseMusicMetadata(json: unknown): ParsedMusic | null {
  if (!isObj(json)) return null
  const props = isObj(json.properties) ? json.properties : {}
  const content = isObj(json.content) ? json.content : {}
  const audio = safeUri(json.animation_url) ?? safeUri(content.uri)
  const mimeHint = [content.mime, props.mime_type, props.mimeType, json.animation_mime_type].find(
    (m) => typeof m === 'string' && m
  )
  if (!audio || !isAudio(audio, mimeHint)) return null

  const durationRaw = Number(props.duration)
  const bpmRaw = Number(props.bpm ?? attr(json, 'bpm'))
  return {
    title: plainText(json.name, 120) || 'Untitled',
    artist: plainText(props.artist ?? attr(json, 'artist') ?? props.creator, 80),
    description: plainBlock(json.description, 2000),
    image: safeUri(json.image) ?? safeUri(json.image_url),
    audio,
    mime: typeof mimeHint === 'string' ? plainText(mimeHint, 40) : undefined,
    duration: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
    genre: plainText(props.genre ?? attr(json, 'genre'), 40) || undefined,
    bpm: Number.isFinite(bpmRaw) && bpmRaw > 0 ? Math.round(bpmRaw) : undefined,
  }
}

export function musicTrack(music: ParsedMusic, token: { chainId: number; address: string; tokenId: string }): Track {
  return {
    id: `onchain:${token.chainId}:${token.address.toLowerCase()}:${token.tokenId}`,
    title: music.title,
    artist: music.artist || undefined,
    src: music.audio,
    artwork: music.image,
    duration: music.duration,
    source: 'onchain',
    token,
  }
}

export function trackFromMetadata(
  json: unknown,
  token: { chainId: number; address: string; tokenId: string }
): Track | null {
  const music = parseMusicMetadata(json)
  return music ? musicTrack(music, token) : null
}

/**
 * Decodes `data:application/json` token URIs (utf8 or base64) without fetching. Returns undefined for
 * anything else so the caller can fetch http/ipfs/ar URIs through the gateway.
 */
export function decodeDataJson(uri: string): unknown {
  if (!/^data:application\/json[;,]/i.test(uri)) return undefined
  const comma = uri.indexOf(',')
  const header = uri.slice(0, comma).toLowerCase()
  const payload = uri.slice(comma + 1)
  const readers = header.includes(';base64')
    ? [() => atob(payload)]
    : [() => payload, () => decodeURIComponent(payload)]
  let result: unknown
  readers.some((read) => {
    try {
      result = JSON.parse(read())
      return true
    } catch {
      return false
    }
  })
  return result
}

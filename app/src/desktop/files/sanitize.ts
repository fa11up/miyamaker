/**
 * NFT metadata is attacker-controlled. Everything that reaches the DOM goes through here:
 * text is plain text (React escapes it; we only trim and strip control chars), images are
 * http(s) or data:image only, links are http(s) only. The URI resolver (ipfs:// → gateway) is
 * injected so this file stays import-free for `node --test`.
 */

export type Resolve = (uri: string) => string

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g

export function cleanText(value: unknown, max = 160): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const text = String(value).replace(CONTROL, '').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function safeLinkUrl(uri: unknown): string {
  if (typeof uri !== 'string') return ''
  try {
    const url = new URL(uri.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
}

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i

export function safeImageUrl(uri: unknown, resolve: Resolve = (u) => u): string {
  if (typeof uri !== 'string') return ''
  const trimmed = uri.trim()
  if (!trimmed) return ''
  if (DATA_IMAGE.test(trimmed)) return trimmed.length <= 2_000_000 ? trimmed : ''
  let resolved: string
  try {
    resolved = resolve(trimmed)
  } catch {
    return ''
  }

  return safeLinkUrl(resolved)
}

export interface CleanMetadata {
  name: string
  description: string
  image: string
  externalUrl: string
}

export function sanitizeMetadata(raw: unknown, resolve: Resolve = (u) => u): CleanMetadata {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    name: cleanText(obj.name, 120),
    description: cleanText(obj.description, 600),
    image: safeImageUrl(obj.image ?? obj.image_url ?? obj.imageUrl, resolve),
    externalUrl: safeLinkUrl(obj.external_url ?? obj.externalUrl),
  }
}

/** Decodes `data:application/json;base64,...` / `data:application/json,...` token URIs. */
export function decodeDataJson(uri: string): unknown {
  const m = /^data:application\/json(;[^,]*)?,(.*)$/is.exec(uri)
  if (!m) return undefined
  try {
    const body = m[1]?.includes('base64') ? atob(m[2] || '') : decodeURIComponent(m[2] || '')
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

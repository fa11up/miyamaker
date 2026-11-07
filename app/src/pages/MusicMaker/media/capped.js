/**
 * Reads from hosts nobody here controls: a byte cap that counts as the body streams in, and a timeout.
 * No imports, so `node --test` loads it with a fake fetch.
 */

export class TooLarge extends Error {
  constructor(limit) {
    super(`That file is over the ${formatBytes(limit)} limit`)
    this.name = 'TooLarge'
    this.limit = limit
  }
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} bytes`
}

/** The body as an ArrayBuffer, never more than `limit` bytes. A longer body is cancelled where it crosses. */
export async function readCapped(res, limit) {
  const declared = Number(res.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    try { await res.body?.cancel?.() } catch { /* already closed */ }
    throw new TooLarge(limit)
  }
  if (!res.body?.getReader) {
    // No stream (an old browser or a test double): read it, then check.
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > limit) throw new TooLarge(limit)
    return buffer
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    const value = step.value
    if (!value?.byteLength) continue
    total += value.byteLength
    if (total > limit) {
      try { await reader.cancel() } catch { /* already closed */ }
      throw new TooLarge(limit)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out.buffer
}

/**
 * fetch with a timeout over the whole read, headers and body. Resolves `{ res, buffer }` for an ok answer,
 * `{ res }` (no body read) otherwise, so the caller can say what the status means.
 */
export async function fetchCapped(url, { limit, timeoutMs = 20000, init = {}, fetchImpl = fetch } = {}) {
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer = 0
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort?.abort()
      reject(new Error('That host took too long to answer'))
    }, timeoutMs)
  })
  try {
    const run = (async () => {
      const res = await fetchImpl(url, abort ? { ...init, signal: abort.signal } : init)
      if (!res.ok) {
        try { await res.body?.cancel?.() } catch { /* nothing to cancel */ }
        return { res }
      }
      return { res, buffer: await readCapped(res, limit) }
    })()
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** JSON from an untrusted host, capped and timed. Throws on a non-ok status. */
export async function fetchJsonCapped(url, opts = {}) {
  const { res, buffer } = await fetchCapped(url, opts)
  if (!buffer) throw new Error(`That host answered ${res.status}`)
  return JSON.parse(new TextDecoder().decode(buffer))
}

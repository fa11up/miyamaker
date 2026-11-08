/**
 * Reads a response as JSON without ever holding more than `max` bytes of it: a larger Content-Length is turned away
 * before reading, and a body without one (or one that lies) is cut off as soon as it passes the cap. Over the cap, or
 * not JSON, is undefined. Pure Web streams, so `node --test` can run it.
 */
export async function readCappedJson(res: Response, max: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined)
    return undefined
  }

  if (!res.body) return undefined
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) return undefined
      parts.push(value)
    }
  } finally {
    // Stops the download rather than draining whatever is left of it.
    await reader.cancel().catch(() => undefined)
  }

  const all = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(all))
  } catch {
    return undefined
  }
}

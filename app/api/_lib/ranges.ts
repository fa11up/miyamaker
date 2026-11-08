/**
 * Video players ask for pieces of a file, and Safari will not play one at all unless it gets them. Cloudflare's asset
 * store only hands back whole files, so the Worker cuts the piece as the file streams past, never holding the whole film.
 * Pure, so `node --test` can run it.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '')
  if (!m || (!m[1] && !m[2])) return undefined
  // bytes=-500 means the last 500 bytes.
  if (!m[1]) {
    const tail = Math.min(Number(m[2]), size)
    return tail > 0 ? { start: size - tail, end: size - 1 } : undefined
  }

  const start = Number(m[1])
  const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1)
  return start <= end ? { start, end } : undefined
}

/** Passes on bytes start..end (inclusive) of what flows through, then stops reading the rest. */
export function sliceStream(source: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let at = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return controller.close()
        const from = at
        at += value.byteLength
        if (at <= start) continue
        const piece = value.subarray(Math.max(0, start - from), Math.min(value.byteLength, end + 1 - from))
        if (piece.byteLength) controller.enqueue(piece)
        if (at > end) {
          controller.close()
          await reader.cancel().catch(() => undefined)
        }
        return
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

export async function serveRange(request: Request, asset: Response): Promise<Response> {
  const headers = new Headers(asset.headers)
  headers.set('accept-ranges', 'bytes')
  const wanted = request.headers.get('range')
  // Several ranges at once would need a multipart answer; the whole file is a correct answer to any of them.
  if (!asset.ok || !wanted || wanted.includes(',')) return new Response(asset.body, { status: asset.status, headers })

  // The asset store sends the length; without it the file has to be read once to know where its end is.
  let body = asset.body
  let size = Number(asset.headers.get('content-length') ?? '')
  if (!asset.headers.has('content-length') || !Number.isSafeInteger(size) || size < 0) {
    const whole = await asset.arrayBuffer()
    size = whole.byteLength
    body = new Blob([whole]).stream()
  }
  const range = parseRange(wanted, size)
  if (!range || !body) {
    await body?.cancel().catch(() => undefined)
    headers.set('content-range', `bytes */${size}`)
    headers.delete('content-length')
    return new Response(null, { status: 416, headers })
  }

  headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
  headers.set('content-length', String(range.end - range.start + 1))
  return new Response(sliceStream(body, range.start, range.end), { status: 206, headers })
}

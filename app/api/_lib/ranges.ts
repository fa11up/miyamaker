/**
 * Video players ask for pieces of a file, and Safari will not play one at all unless it gets them. Cloudflare's asset
 * store only hands back whole files, so the Worker cuts the piece. Pure, so `node --test` can run it.
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

export async function serveRange(request: Request, asset: Response): Promise<Response> {
  const headers = new Headers(asset.headers)
  headers.set('accept-ranges', 'bytes')
  const wanted = request.headers.get('range')
  if (!asset.ok || !wanted) return new Response(asset.body, { status: asset.status, headers })

  const body = await asset.arrayBuffer()
  const range = parseRange(wanted, body.byteLength)
  if (!range) {
    headers.set('content-range', `bytes */${body.byteLength}`)
    headers.delete('content-length')
    return new Response(null, { status: 416, headers })
  }

  headers.set('content-range', `bytes ${range.start}-${range.end}/${body.byteLength}`)
  headers.set('content-length', String(range.end - range.start + 1))
  return new Response(new Uint8Array(body, range.start, range.end - range.start + 1), { status: 206, headers })
}

/**
 * The Worker's POST routes only ever need a few KB, so a body is never read further than that: a larger Content-Length
 * is turned away before anything is read, and a body without one (or one that lies) stops being read at the limit.
 * Pure Web streams, so `node --test` can run it.
 */
export const BODY_LIMIT = 4096

/**
 * The body as text; undefined when it is larger than `limit` bytes, whether it says so (Content-Length) or runs past
 * it while being read (no length, or one that lies). A body is never cut short and passed on as if it were whole.
 */
export async function readCappedText(request: Request, limit = BODY_LIMIT): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    await request.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!request.body) return ''

  const reader = request.body.getReader()
  const out = new Uint8Array(limit)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > limit) return undefined
      out.set(value, size)
      size += value.byteLength
    }
  } finally {
    // Stops the upload rather than draining whatever is left of it.
    await reader.cancel().catch(() => undefined)
  }
  return new TextDecoder().decode(out.subarray(0, size))
}

/** JSON, said so firmly enough that no browser guesses otherwise. */
export const jsonReply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** The same response with `X-Content-Type-Options: nosniff` added when it is JSON. */
export function noSniff(response: Response): Response {
  if (!/json/i.test(response.headers.get('content-type') ?? '') || response.headers.has('x-content-type-options'))
    return response
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

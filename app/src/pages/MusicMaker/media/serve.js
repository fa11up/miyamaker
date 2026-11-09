/**
 * How the two media proxies (api/_lib/samplemedia.ts and api/_lib/videoaudio.ts) hand bytes back on the site's own origin.
 * The bytes come from hosts nobody here controls, so they go out as audio, video, or plain bytes, never as a page:
 * no sniffing, no scripts, a download if opened directly. No imports, so the Worker and `node --test` load it.
 */

const MEDIA_TYPE = /^(audio|video)\/[a-z0-9][a-z0-9.+-]*$/

/** audio/* or video/* without its parameters. Anything else is plain bytes. */
export function mediaType(raw) {
  const type = String(raw || '').split(';')[0].trim().toLowerCase()
  return MEDIA_TYPE.test(type) ? type : 'application/octet-stream'
}

export function mediaHeaders(type, extra = {}) {
  return {
    'content-type': mediaType(type),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'attachment',
    'cache-control': 'private, max-age=300',
    ...extra,
  }
}

/**
 * The body passed on as it arrives, never more than `limit` bytes. Past the limit the stream fails, or with
 * `truncate` it ends there (the video route only wants the start of a file).
 */
export function cappedStream(body, limit, { truncate = false } = {}) {
  const reader = body.getReader()
  let total = 0
  const stop = () => reader.cancel().catch(() => undefined)
  return new ReadableStream({
    async pull(controller) {
      // Every pull hands on a chunk or ends the stream, so a reader waiting on it is never left hanging.
      for (;;) {
        const step = await reader.read()
        if (step.done) {
          controller.close()
          return
        }
        const value = step.value
        if (!value?.byteLength) continue
        const room = limit - total
        if (value.byteLength > room) {
          await stop()
          if (!truncate) {
            controller.error(new Error('That file is over the size limit.'))
            return
          }
          if (room > 0) controller.enqueue(value.slice(0, room))
          controller.close()
          return
        }
        total += value.byteLength
        controller.enqueue(value)
        if (truncate && total >= limit) {
          await stop()
          controller.close()
        }
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/** Reads the first chunk, so an empty body can be told apart before answering. Null when there is nothing. */
export async function peekStream(stream) {
  const reader = stream.getReader()
  const first = await reader.read()
  if (first.done) return null
  let sent = false
  return new ReadableStream({
    async pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(first.value)
        return
      }
      const step = await reader.read()
      if (step.done) controller.close()
      else controller.enqueue(step.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

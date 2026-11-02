/**
 * IPFS gateway list, URL rewriting and a fetch race. Pure (no import.meta, no React) so tests run under plain node.
 *
 * Measured 2026-11-02 from the dev machine, Miya Auction contract.json (813 B):
 *   ipfs.filebase.io 200 in ~0.22 s (CORS *, cache-control immutable)  <- primary
 *   dweb.link / w3s.link 429 (rate limited), nftstorage.link 302 -> ipfs.io,
 *   ipfs.io: "switching to a service worker gateway only", cloudflare-ipfs.com: gone,
 *   gateway.pinata.cloud / 4everland: timed out at 30 s.
 * So Filebase stays first and the rest are fallbacks, tried only when the primary fails.
 */

export const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://ipfs.io/ipfs/',
] as const

const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`)

/**
 * The `<cid>[/path]` part of an IPFS reference, from any of:
 *   ipfs://<cid>/p, ipfs://ipfs/<cid>/p, https://<any-gateway>/ipfs/<cid>/p, https://<cid>.ipfs.<host>/p.
 * Returns undefined for anything that is not IPFS (http images, data: URIs, arweave).
 */
export function ipfsPath(uri: string | null | undefined): string | undefined {
  const s = uri?.trim()
  if (!s) return undefined
  if (/^ipfs:\/\//i.test(s)) {
    const rest = s.slice('ipfs://'.length).replace(/^ipfs\//i, '')
    return rest || undefined
  }

  let url: URL
  try {
    url = new URL(s)
  } catch {
    return undefined
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const pathMatch = /^\/ipfs\/(.+)$/.exec(url.pathname)
  if (pathMatch) return pathMatch[1]! + url.search
  const sub = /^([a-z0-9]{46,})\.ipfs\./i.exec(url.hostname)
  if (sub) return sub[1]! + (url.pathname === '/' ? '' : url.pathname) + url.search
  return undefined
}

/**
 * Every gateway URL for an IPFS reference, primary first. A non-IPFS http(s) URL comes back as the only candidate,
 * anything else as an empty list.
 */
export function gatewayUrls(
  uri: string | null | undefined,
  gateways: readonly string[] = DEFAULT_IPFS_GATEWAYS
): string[] {
  const path = ipfsPath(uri)
  if (path) return [...new Set(gateways.map((g) => withSlash(g) + path))]
  const s = uri?.trim()
  if (s && /^https?:\/\//i.test(s)) return [s]
  return []
}

/** The gateway URL to try after `failedUrl` fails, or undefined when every gateway has been tried. */
export function nextGatewayUrl(
  failedUrl: string,
  gateways: readonly string[] = DEFAULT_IPFS_GATEWAYS
): string | undefined {
  const all = gatewayUrls(failedUrl, gateways)
  const i = all.findIndex((u) => u === failedUrl)
  // A URL on a gateway that is not in our list (e.g. the contract hard-coded one): fall back to our primary.
  if (i === -1) return all[0] !== failedUrl ? all[0] : undefined
  return all[i + 1]
}

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Fetches JSON from the first candidate that answers, staggered: the primary gets `headStartMs` on its own, then the
 * next candidate joins every `headStartMs` (or straight away once the previous one fails). The first OK response wins
 * and the rest are aborted. Rejects with the last error when every candidate fails.
 */
export async function raceJson<T = unknown>(
  urls: readonly string[],
  { fetchImpl = fetch as unknown as FetchLike, headStartMs = 1500, timeoutMs = 20_000 } = {}
): Promise<T> {
  if (urls.length === 0) throw new Error('no url')
  const controllers = urls.map(() => new AbortController())
  let settled = false
  let lastError: unknown = new Error('all gateways failed')

  return new Promise<T>((resolve, reject) => {
    let started = 0
    let failed = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const finish = () => {
      settled = true
      timers.forEach(clearTimeout)
    }

    const start = (i: number) => {
      if (settled || i >= urls.length || i < started) return
      started = i + 1
      const ctrl = controllers[i]!
      timers.push(setTimeout(() => ctrl.abort(), timeoutMs))
      // Stagger: give this candidate a head start before the next one joins.
      if (i + 1 < urls.length) timers.push(setTimeout(() => start(i + 1), headStartMs))
      fetchImpl(urls[i]!, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const body = (await res.json()) as T
          if (settled) return
          finish()
          controllers.forEach((c, j) => j !== i && c.abort())
          resolve(body)
        })
        .catch((err) => {
          if (settled) return
          lastError = err
          failed += 1
          if (failed >= urls.length) {
            finish()
            reject(lastError)
            return
          }

          start(started) // the next candidate that has not started yet
        })
    }

    start(0)
  })
}

/**
 * Whether contracts are verified on Etherscan, for My Files' Scam folder. The key stays on the server.
 *
 *   GET /api/contracts/verified?a=0x..,0x..   { verified: { '0x..': true | false } }
 *
 * An address missing from the answer is unknown: no key, a rate limit, Etherscan down. Callers must not treat that as
 * unverified, or a bad afternoon at Etherscan would call every NFT a scam. Verifying is permanent, so that answer keeps;
 * an unverified contract can still be verified later, so that one is asked again after a while.
 */
import type { MarketCache } from './market'

export const CONTRACT_CHECK_PATH = '/api/contracts/verified'
export const MAX_ADDRESSES = 20
const VERIFIED_KEEP_MS = 30 * 86_400_000
const UNVERIFIED_KEEP_MS = 6 * 3_600_000
const ADDRESS = /^0x[0-9a-f]{40}$/
/** Etherscan's free tier allows 5 calls a second. */
const AT_ONCE = 3

export type ContractCheckDeps = {
  key?: string
  cache: MarketCache
  /** Etherscan's answer for one address's ABI, parsed; throws when the call fails. */
  etherscan?: (address: string) => Promise<unknown>
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  now?: () => number
}

export const etherscanReader = (key: string) => async (address: string) => {
  const query = new URLSearchParams({ chainid: '1', module: 'contract', action: 'getabi', address, apikey: key })
  const res = await fetch(`https://api.etherscan.io/v2/api?${query}`, { signal: AbortSignal.timeout(10_000) })
  // Only the status: the URL holds the key.
  if (!res.ok) throw new Error(`Etherscan ${res.status}`)
  return res.json()
}

/** true or false only when Etherscan really said so. Rate limits and bad keys also answer status 0. */
export function readVerdict(answer: unknown): boolean | undefined {
  const { status, result } = (answer ?? {}) as { status?: unknown; result?: unknown }
  if (status === '1') return true
  if (status === '0' && typeof result === 'string' && /not verified/i.test(result)) return false
  return undefined
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export async function handleContractCheck(request: Request, deps: ContractCheckDeps): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET') return reply(405, { error: 'GET only.' })
  if (!deps.sameOrigin(request.headers, url)) return reply(403, { error: 'Not from this site.' })
  if (!deps.limiter(deps.clientKey(request.headers))) return reply(429, { error: 'Too many requests.' })

  const addresses = [...new Set((url.searchParams.get('a') ?? '').toLowerCase().split(',').filter(Boolean))]
  if (addresses.length > MAX_ADDRESSES || addresses.some((a) => !ADDRESS.test(a))) {
    return reply(400, { error: `Up to ${MAX_ADDRESSES} contract addresses.` })
  }

  const now = (deps.now ?? Date.now)()
  const verified: Record<string, boolean> = {}
  const toAsk: string[] = []
  await Promise.all(
    addresses.map(async (address) => {
      const hit = await deps.cache.get(`contract-verified:v1:${address}`).catch(() => undefined)
      const kept = hit && typeof hit.body === 'boolean' ? hit.body : undefined
      if (hit && kept !== undefined && now - hit.at < (kept ? VERIFIED_KEEP_MS : UNVERIFIED_KEEP_MS)) {
        verified[address] = kept
      } else toAsk.push(address)
    }),
  )

  const ask = deps.key ? deps.etherscan : undefined
  if (ask) {
    for (let i = 0; i < toAsk.length; i += AT_ONCE) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        toAsk.slice(i, i + AT_ONCE).map(async (address) => {
          const answer = await ask(address).catch((e: Error) => ({ result: e.message }))
          const verdict = readVerdict(answer)
          if (verdict === undefined) {
            // Unknown is safe but silent, so the logs say why. Etherscan's words and the status, never the URL or key.
            console.warn(`contract check: ${String((answer as { result?: unknown })?.result).slice(0, 120)}`)
            return
          }

          verified[address] = verdict
          await deps.cache.put(`contract-verified:v1:${address}`, { at: now, body: verdict }).catch(() => undefined)
        }),
      )
    }
  }

  return reply(200, { verified })
}

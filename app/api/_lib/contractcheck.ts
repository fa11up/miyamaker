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
/** Uncached addresses one request may ask Etherscan about. */
export const MAX_LOOKUPS = 5
/** This key's plan allows 3 calls a second; a little under that, as other isolates may be asking too. */
export const ETHERSCAN_PER_SECOND = 2.5
/** The longest a request waits in line for Etherscan before leaving the rest unknown. */
export const MAX_QUEUE_MS = 4_000
const RETRY_MS = 1100

/**
 * When the next call may go: ms to wait for a turn, or undefined when the line is longer than `maxWaitMs`. Turns are
 * `1000 / perSecond` apart and taken in order, across every request this isolate serves.
 */
export type CallBudget = () => number | undefined
export function createCallBudget({
  perSecond = ETHERSCAN_PER_SECOND,
  maxWaitMs = MAX_QUEUE_MS,
  clock = Date.now,
}: { perSecond?: number; maxWaitMs?: number; clock?: () => number } = {}): CallBudget {
  let next = 0
  return () => {
    const now = clock()
    const slot = Math.max(now, next)
    if (slot - now > maxWaitMs) return undefined
    next = slot + 1000 / perSecond
    return slot - now
  }
}

/** One line for every request in this isolate. */
const etherscanBudget = createCallBudget()

export type ContractCheckDeps = {
  key?: string
  cache: MarketCache
  /** Etherscan's answer for one address's ABI, parsed; throws when the call fails. */
  etherscan?: (address: string) => Promise<unknown>
  sameOrigin: (headers: Headers | undefined, url: URL) => boolean
  clientKey: (headers: Headers | undefined) => string
  limiter: (key: string) => boolean
  now?: () => number
  wait?: (ms: number) => Promise<void>
  /** Turns for Etherscan calls; the isolate's shared one when left out. */
  budget?: CallBudget
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
    const wait = deps.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
    const call = (address: string) => ask(address).catch((e: Error) => ({ result: e.message }))
    const words = (answer: unknown) => String((answer as { result?: unknown })?.result)
    const budget = deps.budget ?? etherscanBudget
    /** Waits for a turn; false when the line is too long, so the address stays unknown. */
    const turn = async (atLeast = 0) => {
      const delay = budget()
      if (delay === undefined) return false
      if (delay || atLeast) await wait(Math.max(delay, atLeast))
      return true
    }
    for (const address of toAsk.slice(0, MAX_LOOKUPS)) {
      /* eslint-disable no-await-in-loop */
      if (!(await turn())) {
        console.warn('contract check: Etherscan budget spent, left unknown')
        break
      }
      let answer = await call(address)
      if (/rate limit/i.test(words(answer)) && (await turn(RETRY_MS))) answer = await call(address)
      const verdict = readVerdict(answer)
      if (verdict === undefined) {
        // Unknown is safe but silent, so the logs say why. Etherscan's words and the status, never the URL or key.
        console.warn(`contract check: ${words(answer).slice(0, 120)}`)
      } else {
        verified[address] = verdict
        const keep = (verdict ? VERIFIED_KEEP_MS : UNVERIFIED_KEEP_MS) / 1000
        await deps.cache.put(`contract-verified:v1:${address}`, { at: now, body: verdict }, keep).catch(() => undefined)
      }
      /* eslint-enable no-await-in-loop */
    }
  }

  return reply(200, { verified })
}

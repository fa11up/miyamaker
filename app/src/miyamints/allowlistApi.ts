/**
 * The page's side of the allowlist route (api/_lib/allowlist.ts): save a pasted list before a drop is created, and get
 * a wallet's proof for a phase. Every proof is checked here against the root read from the chain before it is used, so
 * a wrong or stale answer from the server shows as "couldn't check", never as a mint that fails on chain.
 *
 * Pure apart from fetch, so node:test can run it with a stand-in fetch.
 */
import type { Hex } from 'viem'

import { ALLOWLIST_PATH, verifyProof } from '../../api/_lib/allowlist'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** What the route said about one wallet on one list. */
export type ProofAnswer =
  | { state: 'listed'; proof: Hex[] }
  | { state: 'not-listed' }
  /** miya has no list with this root: nobody can get a proof here. */
  | { state: 'no-list' }
  /** The route could not be reached, or answered something that doesn't check out. */
  | { state: 'unknown'; why: string }

const ZERO_ROOT = /^0x0{64}$/

export async function fetchProof(root: string, address: string, fetcher: Fetch = fetch): Promise<ProofAnswer> {
  if (ZERO_ROOT.test(root)) return { state: 'unknown', why: 'This phase has no list.' }
  let res: Response
  try {
    res = await fetcher(`${ALLOWLIST_PATH}/${root.toLowerCase()}?address=${address}`)
  } catch {
    return { state: 'unknown', why: "Couldn't reach miya to check the list." }
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => undefined)) as { root?: string } | undefined
    // A 404 from the route names the root; any other 404 (an old deploy without the route) is not an answer.
    if (body?.root) return { state: 'no-list' }
    return { state: 'unknown', why: "Couldn't check the list just now." }
  }
  if (!res.ok) return { state: 'unknown', why: "Couldn't check the list just now." }
  const body = (await res.json().catch(() => undefined)) as { listed?: boolean; proof?: unknown } | undefined
  if (!body || typeof body.listed !== 'boolean') return { state: 'unknown', why: "Couldn't check the list just now." }
  if (!body.listed) return { state: 'not-listed' }
  const proof = Array.isArray(body.proof) ? (body.proof as Hex[]) : []
  if (!verifyProof(root, address, proof)) return { state: 'unknown', why: "miya's copy of this list doesn't match the sale." }
  return { state: 'listed', proof }
}

/** A list's name and size, from the route (snapshots carry a name; a pasted list has none). */
export async function fetchListInfo(
  root: string,
  fetcher: Fetch = fetch
): Promise<{ count: number; name?: string } | undefined> {
  try {
    const res = await fetcher(`${ALLOWLIST_PATH}/${root.toLowerCase()}`)
    if (!res.ok) return undefined
    const body = (await res.json()) as { count?: number; source?: { name?: string } }
    if (typeof body.count !== 'number') return undefined
    return { count: body.count, name: typeof body.source?.name === 'string' ? body.source.name.slice(0, 60) : undefined }
  } catch {
    return undefined
  }
}

/**
 * Saves a pasted list so the route can give out its proofs. Resolves only when miya worked out the same root the
 * phase will be set to; anything else throws with words to show.
 */
export async function saveList(addresses: readonly string[], root: string, fetcher: Fetch = fetch): Promise<void> {
  let res: Response
  try {
    res = await fetcher(ALLOWLIST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addresses }),
    })
  } catch {
    throw new Error("Couldn't reach miya to save your allowlist, so nothing was created. Try again.")
  }
  const body = (await res.json().catch(() => undefined)) as { root?: string; error?: string } | undefined
  if (!res.ok) throw new Error(`${body?.error || "miya couldn't save your allowlist."} Nothing was created.`)
  if (body?.root?.toLowerCase() !== root.toLowerCase()) {
    throw new Error("miya saved a different list than the one on screen, so nothing was created. Try again.")
  }
}

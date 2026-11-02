import type { Address, PublicClient } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

import type { Badge } from './protocol'

/** Ethereum mainnet. */
export const MIYAMINI = '0x375a1911c0c2982f59826c227b7830e5d5985d59' as const // ERC-721
export const INFER = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921' as const // ERC-20
export const BADGE_TTL_MS = 10 * 60_000

const balanceOfAbi = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

export type HoldingReader = (address: string) => Promise<{ miyamini: boolean; infer: boolean }>

export function viemHoldingReader(rpcUrl: string): HoldingReader {
  let client: PublicClient | undefined
  return async (address) => {
    client ??= createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 5_000 }) }) as PublicClient
    const read = (token: Address) =>
      client!.readContract({ address: token, abi: balanceOfAbi, functionName: 'balanceOf', args: [address as Address] })
    const [mini, infer] = await Promise.allSettled([read(MIYAMINI), read(INFER)])
    return {
      miyamini: mini.status === 'fulfilled' && mini.value > 0n,
      infer: infer.status === 'fulfilled' && infer.value > 0n,
    }
  }
}

/**
 * Holder badges per address, cached for BADGE_TTL_MS. Lookup failures give no badge (cached
 * briefly so a dead RPC isn't hammered) and never throw: chat must not depend on the RPC.
 */
export class BadgeResolver {
  private cache = new Map<string, { badges: Badge[]; until: number }>()

  constructor(
    private readonly reader: HoldingReader,
    private readonly mods: Set<string>,
    private readonly now: () => number = Date.now
  ) {}

  isMod(address: string) {
    return this.mods.has(address.toLowerCase())
  }

  async badgesFor(address: string): Promise<Badge[]> {
    const key = address.toLowerCase()
    const now = this.now()
    const hit = this.cache.get(key)
    let holder: Badge[]
    if (hit && hit.until > now) {
      holder = hit.badges
    } else {
      let ttl = BADGE_TTL_MS
      try {
        const h = await this.reader(key)
        holder = [...(h.miyamini ? (['miyamini'] as const) : []), ...(h.infer ? (['infer'] as const) : [])]
      } catch {
        holder = []
        ttl = 60_000
      }
      if (this.cache.size > 5_000) this.cache.clear()
      this.cache.set(key, { badges: holder, until: now + ttl })
    }
    return this.isMod(key) ? ['mod', ...holder] : holder
  }
}

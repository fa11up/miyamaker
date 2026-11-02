/**
 * The swap token list: the curated "miya list" pinned on top, then the broader (Uniswap) list below it.
 * No runtime imports, so `node --test` can load it directly (tests/tokenList.test.mts).
 *
 * Every curated address, symbol and decimals value was checked on chain with `cast call` (2026-11-02,
 * https://ethereum-rpc.publicnode.com).
 */

export type ListToken = {
  chainId: number
  address: `0x${string}`
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  /** true for user-pasted addresses that are not on any list we trust */
  unverified?: boolean
  /** On the curated miya list. */
  miya?: boolean
  /** Shown but not selectable; the one-line reason why. */
  blocked?: string
  /** Monogram colour when there is no logo. */
  tint?: string
  /** Monogram text when there is no logo (defaults to the first letters of the symbol). */
  mark?: string
}

export const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const MAINNET = 1
const ROBINHOOD = 4663

export const INFER_ADDRESS = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921'
export const IMDUSD_ADDRESS = '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'
export const MIYA_ADDRESS = '0xa358491CA72B793ddf21cF46C7289CC6e0ce9e5A'

/**
 * MIYA (CharlotteFang.sol) reverts any transfer unless the sender or receiver holds an approved Miya NFT (or is
 * the token owner, now the LegacyRedeemer). A 0x route moves tokens through AllowanceHolder, Settler and a pool,
 * none of which hold those NFTs, and MIYA has no Uniswap v2 pair, so 0x cannot route it.
 */
export const MIYA_BLOCKED = 'NFT-gated transfers, so 0x can’t route it. Redeem MIYA for INFER in miyanet.'

const eth = (chainId: number): ListToken => ({
  chainId,
  address: NATIVE,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  miya: true,
  tint: '#627eea',
  mark: 'Ξ',
})

/** Curated list per chain, in display order. */
export const MIYA_LIST: Record<number, ListToken[]> = {
  [MAINNET]: [
    eth(MAINNET),
    {
      chainId: MAINNET,
      address: INFER_ADDRESS,
      symbol: 'INFER',
      name: 'Inference Backed Endogenous Financial Reserve',
      decimals: 18,
      miya: true,
      tint: '#8f5fd0',
      mark: 'IN',
    },
    {
      chainId: MAINNET,
      address: IMDUSD_ADDRESS,
      symbol: 'imdUSD',
      name: 'imdUSD v1',
      decimals: 18,
      miya: true,
      tint: '#1f7a47',
      mark: '$',
    },
    {
      chainId: MAINNET,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      miya: true,
      tint: '#2775ca',
      mark: '$',
    },
    {
      chainId: MAINNET,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      miya: true,
      tint: '#3c3c6e',
      mark: 'W',
    },
    {
      chainId: MAINNET,
      address: '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7',
      symbol: 'IMD',
      name: 'Identity.md',
      decimals: 18,
      miya: true,
      tint: '#14101f',
      mark: 'IM',
    },
    {
      chainId: MAINNET,
      address: '0x0000000000c5dc95539589fbD24BE07c6C14eCa4',
      symbol: 'CULT',
      name: 'Milady Cult Coin',
      decimals: 18,
      miya: true,
      tint: '#b3261e',
      mark: 'CU',
    },
    {
      chainId: MAINNET,
      address: MIYA_ADDRESS,
      symbol: 'MIYA',
      name: 'Black Hearted Cyber Baby Angel Token',
      decimals: 18,
      miya: true,
      blocked: MIYA_BLOCKED,
    },
  ],
  [ROBINHOOD]: [
    eth(ROBINHOOD),
    {
      chainId: ROBINHOOD,
      // verified on Robinhood Chain: name "Global Dollar", symbol USDG, 6 decimals
      address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      symbol: 'USDG',
      name: 'Global Dollar',
      decimals: 6,
      miya: true,
      tint: '#1f7a47',
      mark: '$',
    },
  ],
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const key = (address: string) => address.toLowerCase()

/** A remote list entry we can use: right chain, a real address, sane decimals and a symbol. */
export function isUsable(t: Partial<ListToken> | null | undefined, chainId: number): t is ListToken {
  return (
    !!t &&
    t.chainId === chainId &&
    typeof t.address === 'string' &&
    ADDRESS.test(t.address) &&
    typeof t.symbol === 'string' &&
    t.symbol.trim().length > 0 &&
    typeof t.decimals === 'number' &&
    Number.isInteger(t.decimals) &&
    t.decimals >= 0 &&
    t.decimals <= 36
  )
}

/**
 * The picker's list: the curated tokens first (in their order, with their metadata, never overridden by the
 * remote list), then every other usable remote token for this chain, deduped by address (first wins) and
 * sorted by symbol. Remote entries never carry `miya`, `blocked` or `unverified` flags.
 */
export function mergeTokenLists(
  pinned: readonly ListToken[],
  remote: readonly unknown[],
  chainId: number
): ListToken[] {
  const seen = new Set<string>()
  const fresh = (address: string) => {
    if (seen.has(key(address))) return false
    seen.add(key(address))
    return true
  }

  const out = pinned.filter((t) => t.chainId === chainId && fresh(t.address))
  const rest: ListToken[] = remote
    .filter((raw): raw is ListToken => isUsable(raw as Partial<ListToken>, chainId))
    .filter((t) => fresh(t.address))
    .map((t) => ({
      chainId,
      address: t.address,
      symbol: t.symbol.trim(),
      name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : t.symbol.trim(),
      decimals: t.decimals,
      logoURI: typeof t.logoURI === 'string' && /^(https:|ipfs:)/.test(t.logoURI) ? t.logoURI : undefined,
    }))

  rest.sort((a, b) => a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' }))
  return [...out, ...rest]
}

/**
 * Search by symbol or name. Ranking: exact symbol, then symbol prefix, then symbol/name contains; inside a rank the
 * list order is kept (so curated tokens stay ahead). An empty query returns the list unchanged.
 */
export function searchTokens<T extends Pick<ListToken, 'symbol' | 'name'>>(tokens: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...tokens]
  const rank = (t: T) => {
    const s = t.symbol.toLowerCase()
    if (s === q) return 0
    if (s.startsWith(q)) return 1
    if (s.includes(q) || t.name.toLowerCase().includes(q)) return 2
    return -1
  }

  return tokens
    .map((t, i) => ({ t, i, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t)
}

/** Selectable curated tokens for the quick-pick chips. */
export const quickPicks = (chainId: number) => (MIYA_LIST[chainId] || []).filter((t) => !t.blocked)

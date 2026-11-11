/**
 * Payment tokens for miyamints collections (contracts/docs/IMD-INFER-VAULT.md). A collection accepts a list of tokens
 * from the registry allowlist and prices each one on its own (`TokenPrice{token, price}[]`): no exchange rates, and the
 * artist collects each token exactly as paid. ETH is `address(0)`.
 *
 * Pure (only viem), so node:test can load it. Amounts are parsed with viem's parseUnits at each token's decimals.
 */
import type { Address } from 'viem'
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress } from 'viem'

export const ETH: Address = zeroAddress

/** `fromChain`: the symbol was read from the token itself, not the table below, so it is only what the token says. */
export type PayToken = { address: Address; symbol: string; decimals: number; fromChain?: boolean }

export const IMD: Address = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'
export const INFER: Address = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921'

const ETH_TOKEN: PayToken = { address: ETH, symbol: 'ETH', decimals: 18 }

/** The allowlist the contracts were built for, read from chain 2026-11-08. Mainnet only for now. */
const MAINNET: PayToken[] = [
  ETH_TOKEN,
  { address: IMD, symbol: 'IMD', decimals: 18 },
  { address: INFER, symbol: 'INFER', decimals: 18 },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  { address: '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25', symbol: 'imdUSD', decimals: 18 },
  { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', decimals: 8 },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
]

/** Most tokens one collection can accept (PaymentLib.MAX_TOKENS). */
export const MAX_TOKENS = 8

/**
 * Tokens a new collection on `chainId` can be priced in. ETH everywhere; the ERC-20s only on mainnet. `allowed` is the
 * registry's `paymentTokens()` when it was read: a token it no longer lists is not offered (ETH is always allowed).
 */
export function payTokens(chainId: number, allowed?: readonly string[]): PayToken[] {
  const list = chainId === 1 ? MAINNET : [ETH_TOKEN]
  if (!allowed) return list
  const set = new Set(allowed.map((a) => a.toLowerCase()))
  return list.filter((t) => t.address === ETH || set.has(t.address.toLowerCase()))
}

export const isEth = (token: string) => token.toLowerCase() === ETH

export const sameToken = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** What we know about a token on a chain from the table above; undefined for anything else (read it on chain). */
export function knownToken(chainId: number, token: string): PayToken | undefined {
  if (isEth(token)) return ETH_TOKEN
  return (chainId === 1 ? MAINNET : []).find((t) => sameToken(t.address, token))
}

/** Longest symbol shown for a token read from chain, before the "?" that marks it. */
export const MAX_SYMBOL = 12

/**
 * A symbol read from a token contract, made safe to show: control and direction-changing characters removed, at most
 * MAX_SYMBOL characters, and a "?" after it so it never passes for one of the tokens in the table above (anyone can
 * deploy a token that calls itself USDC).
 */
export function chainSymbol(raw: unknown): string {
  const chars = Array.from(
    String(raw ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
      .trim()
  )
  const cut = chars.length > MAX_SYMBOL ? `${chars.slice(0, MAX_SYMBOL - 1).join('')}…` : chars.join('')
  return `${cut || 'token'}?`
}

// ── amounts ──────────────────────────────────────────────────────────────────

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }
export type Result<T> = Ok<T> | Err

/**
 * An amount typed by a person → the token's smallest unit, via parseUnits at its decimals (never floats). Up to 12
 * whole digits and no more decimals than the token has: 0.0000001 USDC (6 decimals) is refused, not rounded.
 */
export function parseTokenAmount(
  input: string,
  token: Pick<PayToken, 'symbol' | 'decimals'>,
  opts: { allowZero?: boolean; label?: string } = {}
): Result<{ amount: bigint }> {
  const label = opts.label || 'Price'
  const s = (input || '').trim()
  const example = token.decimals >= 2 ? '0.01' : '1'
  if (!s) return { ok: false, error: `${label}: type an amount in ${token.symbol}, like ${example}.` }
  const d = token.decimals
  const re = d > 0 ? new RegExp(`^(\\d{1,12}(\\.\\d{0,${d}})?|\\.\\d{1,${d}})$`) : /^\d{1,12}$/
  if (!re.test(s)) {
    const more = /^\d*\.\d+$/.test(s) && (s.split('.')[1] || '').length > d
    return {
      ok: false,
      error: more
        ? `${label}: ${token.symbol} has at most ${d} decimals.`
        : `${label}: use a plain number like ${example}.`,
    }
  }
  const amount = parseUnits(s.startsWith('.') ? `0${s}` : s, d)
  if (amount === 0n && !opts.allowZero) return { ok: false, error: `${label} must be more than 0.` }
  return { ok: true, amount }
}

/** Short amount for copy: at most `places` decimals, cut (never rounded up), "<0.0001 USDC" for dust, "0 ETH" for 0. */
export function tokenLabel(amount: bigint, token: Pick<PayToken, 'symbol' | 'decimals'>, places = 4): string {
  if (amount === 0n) return `0 ${token.symbol}`
  const s = formatUnits(amount, token.decimals)
  const [w, f = ''] = s.split('.')
  const cut = f.slice(0, places).replace(/0+$/, '')
  if (w === '0' && !cut) return `<0.${'0'.repeat(Math.max(0, places - 1))}1 ${token.symbol}`
  return `${w}${cut ? `.${cut}` : ''} ${token.symbol}`
}

/** The exact amount, every decimal kept: for "you send exactly …" and approvals. */
export const tokenExact = (amount: bigint, token: Pick<PayToken, 'symbol' | 'decimals'>) =>
  `${formatUnits(amount, token.decimals)} ${token.symbol}`

// ── prices ───────────────────────────────────────────────────────────────────

export type TokenPrice = { token: Address; price: bigint }

/** Form state for prices: typed text per token address (lowercase). */
export type PriceInputs = Record<string, string>

/**
 * The accepted-token choice in a launch form: at least one, at most MAX_TOKENS, each one we know on this chain.
 * Returns the checksummed addresses in the order of `payTokens`.
 */
export function parseAccepted(
  chosen: readonly string[],
  chainId: number,
  allowed?: readonly string[]
): Result<{ tokens: PayToken[] }> {
  const offered = payTokens(chainId, allowed)
  const set = new Set(chosen.map((c) => c.toLowerCase()))
  const tokens = offered.filter((t) => set.has(t.address.toLowerCase()))
  const dropped = payTokens(chainId).filter((t) => set.has(t.address.toLowerCase()) && !tokens.includes(t))
  if (dropped.length) {
    return { ok: false, error: `miya no longer accepts ${dropped.map((t) => t.symbol).join(', ')}. Take it off the list.` }
  }
  if (!tokens.length) return { ok: false, error: 'Pick at least one token buyers can pay with.' }
  if (tokens.length > MAX_TOKENS) return { ok: false, error: `At most ${MAX_TOKENS} tokens.` }
  if (tokens.length !== set.size) return { ok: false, error: 'One of the tokens is not available on this network.' }
  return { ok: true, tokens }
}

/**
 * A launch draft against the registry's allowlist (`allowed`, paymentTokens()): tokens it no longer lists are taken
 * off the accepted list (ETH stays, and is put back if nothing else is left) and a delisted auction currency goes back
 * to ETH. `removed` names what was taken off, for a note on screen; empty when nothing changed.
 */
export function dropDelisted(
  draft: { tokens: readonly string[]; currency: string },
  chainId: number,
  allowed: readonly string[]
): { tokens: string[]; currency: string; removed: string[] } {
  const ok = (t: string) => payTokens(chainId, allowed).some((p) => sameToken(p.address, t))
  const name = (t: string) => knownToken(chainId, t)?.symbol ?? `${t.slice(0, 6)}…`
  const removed = draft.tokens.filter((t) => !ok(t)).map(name)
  let tokens = draft.tokens.filter(ok)
  if (!tokens.length && removed.length) tokens = [ETH]
  let currency = draft.currency || ETH
  if (!ok(currency)) {
    if (!removed.includes(name(currency))) removed.push(name(currency))
    currency = ETH
  }
  return { tokens, currency, removed }
}

/**
 * A price per accepted token, as the contracts take it (`TokenPrice[]`). `required`: every token needs a price (1155
 * editions); otherwise a blank leaves that token out of this phase and at least one must be set (drop phases).
 * `allowZero`: a free price (drops); 1155 editions refuse 0 (InvalidPrice).
 */
export function buildPrices(
  inputs: PriceInputs,
  tokens: readonly PayToken[],
  opts: { required: boolean; allowZero: boolean; label?: string }
): Result<{ prices: TokenPrice[] }> {
  const prices: TokenPrice[] = []
  for (const t of tokens) {
    const raw = (inputs[t.address.toLowerCase()] || '').trim()
    if (!raw && !opts.required) continue
    const p = parseTokenAmount(raw, t, {
      allowZero: opts.allowZero,
      label: `${opts.label || 'Price'} in ${t.symbol}`,
    })
    if (!p.ok) return p
    prices.push({ token: t.address, price: p.amount })
  }
  if (!prices.length) return { ok: false, error: `${opts.label || 'Price'}: set a price in at least one token.` }
  return { ok: true, prices }
}

/** "0.01 ETH or 25 USDC", in the order given; "Free" when every price is 0. */
export function pricesWords(prices: readonly { price: bigint; token: PayToken }[]): string {
  if (!prices.length) return '—'
  if (prices.every((p) => p.price === 0n)) return 'Free'
  return prices.map((p) => (p.price === 0n ? `free in ${p.token.symbol}` : tokenLabel(p.price, p.token))).join(' or ')
}

// ── paying ───────────────────────────────────────────────────────────────────

/**
 * The token a buyer pays with: the one they picked if it is still on offer, else ETH if offered, else the first.
 * Undefined when nothing is on offer.
 */
export function pickToken(offered: readonly string[], current?: string): Address | undefined {
  if (current && offered.some((t) => sameToken(t, current))) {
    return getAddress(offered.find((t) => sameToken(t, current)) as string)
  }
  const eth = offered.find((t) => isEth(t))
  const first = eth ?? offered[0]
  return first !== undefined && isAddress(first) ? getAddress(first) : undefined
}

/**
 * How a mint or bid of `cost` in `token` is paid. ETH: `value = cost`, no approval. An ERC-20: `value = 0`, and an
 * approval of exactly `cost` first unless the allowance already covers it. `maxCost` is always the cost quoted, so a
 * price that moved up reverts (ExceedsMaxCost) instead of charging more. `allowance` undefined = not read yet.
 */
export function payPlan(token: string, cost: bigint, allowance?: bigint) {
  if (isEth(token)) return { value: cost, maxCost: cost, approve: undefined, ready: true }
  const approve = allowance === undefined || allowance < cost ? cost : undefined
  return { value: 0n, maxCost: cost, approve, ready: allowance !== undefined }
}

/** The approval, in words, before the wallet opens. */
export const approveWords = (amount: bigint, token: PayToken, spender = 'this collection') =>
  `First your wallet asks to let ${spender} take exactly ${tokenExact(amount, token)}, and no more. Then it asks for the payment itself.`

// ── vault fee claims ─────────────────────────────────────────────────────────

/** ClaimMode in contracts/src/interfaces/IAlignmentVault.sol. */
export const CLAIM_MODE = { TOKENS: 0, ETH: 1, REINVEST: 2 } as const
export type ClaimModeName = keyof typeof CLAIM_MODE

/**
 * Args for `claimVaultFees(mode, floor)`. TOKENS takes no floor (0). The other two need a real quoted floor, and
 * without one (no quote, or 0) the claim is refused here rather than sent with a floor that protects nothing: ETH's is
 * the least ETH out of its swap; REINVEST's is the least vault shares minted, and its balancing swap has no price limit
 * of its own, so a 0 floor would let a moved pool take the fees for almost nothing.
 */
export function claimArgs(mode: ClaimModeName, floor?: bigint): Result<{ args: readonly [number, bigint] }> {
  if (mode === 'TOKENS') return { ok: true, args: [CLAIM_MODE.TOKENS, 0n] as const }
  if (!floor || floor <= 0n) {
    return {
      ok: false,
      error:
        mode === 'ETH'
          ? 'Taking fees as ETH needs a live price quote, which is not available yet.'
          : 'Reinvesting fees needs a live price quote, which is not available yet.',
    }
  }
  return { ok: true, args: [CLAIM_MODE[mode], floor] as const }
}

/** The vault's claimable fees, from `claimable(benefactor) -> (infer, imd, eth)`. */
export function feesWords(c: { infer: bigint; imd: bigint; eth: bigint }): string {
  const parts = [
    tokenLabel(c.infer, { symbol: 'INFER', decimals: 18 }),
    tokenLabel(c.imd, { symbol: 'IMD', decimals: 18 }),
    ...(c.eth > 0n ? [tokenLabel(c.eth, { symbol: 'ETH', decimals: 18 })] : []),
  ]
  return parts.join(' + ')
}

export const hasFees = (c: { infer: bigint; imd: bigint; eth: bigint }) => c.infer > 0n || c.imd > 0n || c.eth > 0n

/** Fees `mode` can claim: REINVEST only puts INFER and IMD back, so ETH alone is nothing to reinvest. */
export const hasFeesFor = (mode: ClaimModeName, c: { infer: bigint; imd: bigint; eth: bigint }) =>
  mode === 'REINVEST' ? c.infer > 0n || c.imd > 0n : hasFees(c)

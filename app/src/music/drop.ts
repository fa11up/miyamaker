/**
 * Pure argument builders for launching a music edition on the existing ERC1155Factory / ERC1155Instance
 * contracts (contracts/src/factories/erc1155). Prices are parsed with viem's parseEther — never floats.
 * Tested in tests/music-drop.test.mts.
 */
import type { Address } from 'viem'
import { parseEther, zeroAddress } from 'viem'

/** ERC1155Instance.PricingModel */
export const PRICING_MODEL = { UNLIMITED: 0, LIMITED_FIXED: 1, LIMITED_DYNAMIC: 2 } as const

/** IGatingModule GatingScope.BOTH (irrelevant when no gating module is set). */
export const GATING_SCOPE_BOTH = 0

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }

/** ETH amount as typed by a person → wei. ERC1155Instance.addEdition rejects a zero price. */
export function parsePriceEth(input: string): Ok<{ wei: bigint }> | Err {
  const s = (input || '').trim()
  if (!s) return { ok: false, error: 'Set a price in ETH.' }
  if (!/^(\d{1,9}(\.\d{0,18})?|\.\d{1,18})$/.test(s)) {
    return { ok: false, error: 'Price must be a number like 0.01 (max 18 decimals).' }
  }

  const wei = parseEther(s.startsWith('.') ? `0${s}` : s)
  if (wei <= 0n) return { ok: false, error: 'The edition contract needs a price above 0.' }
  return { ok: true, wei }
}

/** '' or '0' = open edition (UNLIMITED); a whole number = LIMITED_FIXED with that supply. */
export function parseSupply(input: string): Ok<{ supply: bigint; model: number }> | Err {
  const s = (input || '').trim()
  if (!s || /^0+$/.test(s)) return { ok: true, supply: 0n, model: PRICING_MODEL.UNLIMITED }
  if (!/^\d{1,9}$/.test(s)) return { ok: false, error: 'Number of copies must be a whole number (blank = no limit).' }
  return { ok: true, supply: BigInt(s), model: PRICING_MODEL.LIMITED_FIXED }
}

/**
 * Alignment share typed as a percent ("10" or "12.5") → basis points. The registry enforces a
 * minimum; protocol fee + alignment must stay within 100%.
 */
export function parseAlignmentPct(input: string, minBps: number, protocolFeeBps = 0): Ok<{ bps: number }> | Err {
  const s = (input || '').trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Type the vault share as a percent like 10 or 12.5.' }
  const [whole, frac = ''] = s.split('.')
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (bps < minBps) return { ok: false, error: `The vault share must be at least ${minBps / 100}%.` }
  if (bps + protocolFeeBps > 10_000) return { ok: false, error: 'The vault share plus the miya fee cannot pass 100%.' }
  return { ok: true, bps }
}

/**
 * Blank rise keeps parseSupply (open edition or fixed price). A percent such as 1 or 2.5 is the
 * LIMITED_DYNAMIC curve: each mint costs base * (1 + percent) ^ already minted. Supply must be above 0.
 * The rate is basis points, which is what ERC1155Instance stores (100 = 1%).
 */
export function parseEdition(
  supplyInput: string,
  riseInput: string
): Ok<{ supply: bigint; model: number; rate: bigint }> | Err {
  const rise = (riseInput || '').trim()
  if (!rise || /^0+(?:\.0+)?$/.test(rise)) {
    const parsed = parseSupply(supplyInput)
    if (!parsed.ok) return parsed
    return { ok: true, supply: parsed.supply, model: parsed.model, rate: 0n }
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(rise)) return { ok: false, error: 'Rise must be a percent like 1 or 2.5.' }
  const [whole, frac = ''] = rise.split('.')
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (bps <= 0 || bps > 10_000) return { ok: false, error: 'Rise must be above 0 and at most 100%.' }
  const supply = parseSupply(supplyInput)
  if (!supply.ok) return supply
  if (supply.supply <= 0n) return { ok: false, error: 'A rising price needs a supply above 0.' }
  return { ok: true, supply: supply.supply, model: PRICING_MODEL.LIMITED_DYNAMIC, rate: BigInt(bps) }
}

/** The tokens a Drop Music release accepts: ETH only for now (Launch → Editions offers the other tokens). */
export const MUSIC_TOKENS: readonly Address[] = [zeroAddress]

/** ERC1155Factory.createInstance's CreateParams for a music collection: no gating, no free mints, MUSIC_TOKENS. */
export function collectionParams(p: {
  name: string
  metadataURI: string
  creator: Address
  vault: Address
  alignmentBps: number
}) {
  return {
    name: p.name,
    metadataURI: p.metadataURI,
    creator: p.creator,
    vault: p.vault,
    alignmentBps: p.alignmentBps,
    styleUri: '',
    gatingModule: zeroAddress as Address,
    freeMint: { allocation: 0n, scope: GATING_SCOPE_BOTH },
    acceptedTokens: [...MUSIC_TOKENS],
  }
}

/** ERC1155Instance.addEdition(pieceTitle, prices, supply, metadataURI, pricingModel, priceIncreaseRate, openTime) */
export function editionArgs(p: {
  title: string
  /** One price per accepted token (TokenPrice[]); `priceWei` alone means an ETH price. */
  prices?: readonly { token: Address; price: bigint }[]
  priceWei?: bigint
  supply: bigint
  model: number
  metadataURI: string
  priceIncreaseRate?: bigint
}) {
  const prices = p.prices ? [...p.prices] : [{ token: zeroAddress as Address, price: p.priceWei ?? 0n }]
  return [p.title, prices, p.supply, p.metadataURI, p.model, p.priceIncreaseRate ?? 0n, 0n] as const
}

/**
 * CreateX permissioned salt for ERC1155Factory.createInstance: the factory is CreateX's caller, so the
 * first 20 bytes must be the factory address, then 0x00 (no cross-chain redeploy protection), then
 * 11 random bytes.
 */
export function makeSalt(factory: string, random: Uint8Array): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error('bad factory address')
  if (random.length < 11) throw new Error('need 11 random bytes')
  const tail = Array.from(random.slice(0, 11), (b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${factory.slice(2).toLowerCase()}00${tail}`
}

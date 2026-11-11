// What an ETH amount is worth in imdUSD, IMD and INFER right now, for pricing a drop phase in all four. Read-only.
//
//   imdUSD  ETH x Chainlink ETH/USD (0x5f4e…8419), imdUSD taken as 1 USD (as the keeper does, keeper/config.example.mjs).
//   IMD     the spot price of the hookless IMD/ETH v4 pool (fee 10000, tick spacing 200: the pool the keeper treats as
//           IMD's market), read from the PoolManager's storage (StateLibrary layout: pools at slot 6).
//   INFER   that IMD at the spot price of the alignment pool, whose key the default vault reports (alignmentPoolKey()).
//
// Spot prices are mid prices, before pool fees and price impact: "the same value as the ETH price", not "what that ETH
// would buy". The V4Quoter's figure for the same ETH (fees and impact included) is read alongside, as a check.
import type { Address, PublicClient } from 'viem'
import { encodeAbiParameters, formatUnits, getAddress, hexToBigInt, keccak256, parseAbi, zeroAddress } from 'viem'

export const IMDUSD: Address = '0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'
export const IMD: Address = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'
export const INFER: Address = '0x53d0eA0A685220718Dc6a0a6e4617194C6F37921'
const POOL_MANAGER: Address = '0x000000000004444c5dc75cB358380D2e3dE08A90'
const V4_QUOTER: Address = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
const ETH_USD: Address = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DEFAULT_VAULT: Address = '0x34bE8C25C7922B3052D1955b8E63fB97F778AA08'
const Q192 = 1n << 192n

type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
const KEY = '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
const abi = parseAbi([
  'function extsload(bytes32 slot) view returns (bytes32)',
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)',
  `function alignmentPoolKey() view returns (${KEY})`,
  `function quoteExactInputSingle((${KEY} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
])

const poolId = (k: PoolKey) =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]
    )
  )

/** sqrtPriceX96 of a v4 pool (currency1 per currency0), at `block`. */
async function sqrtPrice(c: PublicClient, k: PoolKey, block?: bigint): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId(k), 6n]))
  const s0 = await c.readContract({ address: POOL_MANAGER, abi, functionName: 'extsload', args: [slot], blockNumber: block })
  const p = hexToBigInt(s0) & ((1n << 160n) - 1n)
  if (p === 0n) throw new Error(`v4 pool ${poolId(k)} is not initialized`)
  return p
}

/** `amountIn` of `tokenIn` in the pool's other token at its spot price. */
function atSpot(amountIn: bigint, sqrtP: bigint, k: PoolKey, tokenIn: Address): bigint {
  const in0 = getAddress(tokenIn) === getAddress(k.currency0)
  return in0 ? (amountIn * sqrtP * sqrtP) / Q192 : (amountIn * Q192) / (sqrtP * sqrtP)
}

async function quote(c: PublicClient, k: PoolKey, tokenIn: Address, amount: bigint, block?: bigint) {
  const zeroForOne = getAddress(tokenIn) === getAddress(k.currency0)
  const { result } = await c.simulateContract({
    address: V4_QUOTER,
    abi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: k, zeroForOne, exactAmount: amount, hookData: '0x' }],
    blockNumber: block,
  })
  return result[0]
}

export type Equivalents = {
  wei: bigint
  imdUSD: bigint
  imd: bigint
  infer: bigint
  ethUsd: number
  /** What the V4Quoter says the ETH would actually buy, fees and impact included (undefined if it failed). */
  quoted: { imd?: bigint; infer?: bigint }
  notes: string[]
}

export const IMD_ETH_POOL: PoolKey = { currency0: zeroAddress, currency1: IMD, fee: 10000, tickSpacing: 200, hooks: zeroAddress }

/** `wei` of ETH in imdUSD, IMD and INFER at `block` (default: latest). */
export async function ethEquivalents(c: PublicClient, wei: bigint, block?: bigint): Promise<Equivalents> {
  const notes: string[] = []
  const [, answer, , updatedAt] = await c.readContract({ address: ETH_USD, abi, functionName: 'latestRoundData', blockNumber: block })
  const at = block ? (await c.getBlock({ blockNumber: block })).timestamp : (await c.getBlock()).timestamp
  if (answer <= 0n) throw new Error('Chainlink ETH/USD answered 0')
  const age = Number(at - updatedAt)
  if (age > 3600) throw new Error(`Chainlink ETH/USD is ${age}s old (its heartbeat is 1 h)`)
  const imdUSD = (wei * answer) / 10n ** 8n
  const imdSqrt = await sqrtPrice(c, IMD_ETH_POOL, block)
  const imd = atSpot(wei, imdSqrt, IMD_ETH_POOL, zeroAddress)
  const key = (await c.readContract({ address: DEFAULT_VAULT, abi, functionName: 'alignmentPoolKey', blockNumber: block })) as PoolKey
  const inferSqrt = await sqrtPrice(c, key, block)
  const infer = atSpot(imd, inferSqrt, key, IMD)
  const quoted: Equivalents['quoted'] = {}
  try {
    quoted.imd = await quote(c, IMD_ETH_POOL, zeroAddress, wei, block)
    quoted.infer = await quote(c, key, IMD, quoted.imd, block)
  } catch (e) {
    notes.push(`V4Quoter check failed: ${String((e as Error).message).split('\n')[0]}`)
  }
  notes.push('imdUSD is taken as 1 USD (Chainlink ETH/USD), as the keeper does.')
  return { wei, imdUSD, imd, infer, ethUsd: Number(answer) / 1e8, quoted, notes }
}

/** A price cut to `sig` significant digits (rounded down), so it reads like 25.31 rather than 25.3104912… */
export function roundPrice(amount: bigint, sig = 4): bigint {
  if (amount <= 0n) return amount
  const unit = 10n ** BigInt(Math.max(0, amount.toString().length - sig))
  return (amount / unit) * unit
}

export const fmt = (v: bigint | undefined, d = 18) => (v === undefined ? 'n/a' : formatUnits(v, d))

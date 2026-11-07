/**
 * Fren Pet, read from its own contracts on Base. The ABI pieces are the ones its site uses. Pure apart from the types, so
 * `node --test` can run the parsing.
 */
export const FRENPET_DIAMOND = '0x0e22b5f3e11944578b37ed04f5312dfc246f443c' as const
export const FRENPET_NFT = '0x5b51Cf49Cb48617084eF35e7c7d7A21914769ff1' as const
export const FRENPET_SITE = 'https://www.frenpet.xyz/'
/** A strong, long-lived pet to show until someone picks their own. */
export const FIRST_PET = 1

const uint = { type: 'uint256' } as const
export const frenpetAbi = [
  {
    type: 'function',
    name: 'getPetInfo',
    stateMutability: 'view',
    inputs: [{ name: '_nftId', ...uint }],
    outputs: [
      { name: '_name', type: 'string' },
      { name: '_status', ...uint },
      { name: '_score', ...uint },
      { name: '_level', ...uint },
      { name: '_timeUntilStarving', ...uint },
      { name: '_lastAttacked', ...uint },
      { name: '_lastAttackUsed', ...uint },
      { name: '_owner', type: 'address' },
      { name: '_rewards', ...uint },
    ],
  },
  {
    type: 'function',
    name: 'getPetAttackDefense',
    stateMutability: 'view',
    inputs: [{ name: 'petId', ...uint }],
    outputs: [
      { name: 'attack', ...uint },
      { name: 'defense', ...uint },
    ],
  },
] as const
export const frenpetNftAbi = [
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'id', ...uint }],
    outputs: [{ type: 'string' }],
  },
] as const

const ZERO = '0x0000000000000000000000000000000000000000'
/** Score is stored with 12 decimals. */
const SCORE_UNIT = 1_000_000_000_000n

export type PetView = {
  id: number
  name: string
  alive: boolean
  level: number
  points: bigint
  attack: number
  defense: number
  /** Seconds till it needs feeding; 0 once it is past that. */
  fedFor: number
  owner: string
}

/** One plain line from a name a stranger chose, which the chain lets hold anything. */
const cleanName = (raw: string, id: number) =>
  // eslint-disable-next-line no-control-regex
  raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .trim()
    .slice(0, 28) || `Pet #${id}`

export function parsePet(
  id: number,
  info: readonly [string, bigint, bigint, bigint, bigint, bigint, bigint, string, bigint],
  stats: readonly [bigint, bigint],
  nowSeconds: number,
): PetView {
  const [name, , score, level, starving, , , owner] = info
  return {
    id,
    name: cleanName(name, id),
    alive: owner !== ZERO,
    level: Number(level),
    points: score / SCORE_UNIT,
    attack: Number(stats[0]),
    defense: Number(stats[1]),
    fedFor: Math.max(0, Number(starving) - nowSeconds),
    owner,
  }
}

/** The picture from tokenURI: on-chain SVG only, or nothing. Shown in an <img>, where an SVG cannot run anything. */
export function petImage(uri: string): string | undefined {
  const at = uri.indexOf('data:image/svg+xml')
  if (!uri.startsWith('data:application/json') || at < 0) return undefined
  const start = uri.indexOf('<svg', at)
  const end = uri.lastIndexOf('</svg>')
  if (start < 0 || end < start) return undefined
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(uri.slice(start, end + 6))}`
}

export const fedWords = (seconds: number) => {
  if (seconds <= 0) return 'Hungry'
  const hours = Math.floor(seconds / 3600)
  return hours >= 1 ? `Fed for ${hours}h` : `Fed for ${Math.ceil(seconds / 60)}m`
}

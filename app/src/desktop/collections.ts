import { mainnet } from 'viem/chains'

import {
  DEFAULT_NFT_CONTRACT,
  MIYAMINI_CHAIN_ID,
  MIYAMINI_CONTRACT,
  MIYAMINI_METADATA_BASE,
  PARENTS,
} from '@/constants/contracts'

import type { KnownCollection } from './files/indexer/types'

/**
 * Collections the desktop knows about without an indexer:
 *  - `watchMints` ones feed the live mint ticker / confetti
 *  - all of them are enumerated by the wallet "My Files" on-chain fallback
 *
 * MiyaRegistry collections can be appended here later (e.g. map the registry list from
 * constants/miyanet into this shape); the watcher polls every watched address in one getLogs call
 * per chain.
 */
export interface DesktopCollection extends KnownCollection {
  watchMints?: boolean
}

export const DESKTOP_COLLECTIONS: DesktopCollection[] = [
  {
    chainId: MIYAMINI_CHAIN_ID,
    address: MIYAMINI_CONTRACT.toLowerCase(),
    name: 'miyamaker mini',
    app: 'mint',
    strategy: 'sweep',
    firstTokenId: 0,
    watchMints: true,
    // Same convention as the Mint window: the metadata host sends no CORS headers, the images path works.
    imageFor: (id) => MIYAMINI_METADATA_BASE.replace(/json\/$/, `images/${id}.png`),
  },
  {
    chainId: mainnet.id,
    address: (DEFAULT_NFT_CONTRACT[mainnet.id] || '').toLowerCase(),
    name: 'Miya Auction',
    app: 'auction',
    strategy: 'sweep',
    firstTokenId: 0,
    sweepMax: 64,
  },
  {
    chainId: mainnet.id,
    address: PARENTS[mainnet.id].milady_maker.toLowerCase(),
    name: 'Milady',
    strategy: 'enumerable',
    // tokenURI JSON has no CORS headers; the image path does load.
    imageFor: (id) => `https://www.miladymaker.net/milady/${id}.png`,
  },
]

export const WATCHED_COLLECTIONS = DESKTOP_COLLECTIONS.filter((c) => c.watchMints)

export function findCollection(chainId: number, address: string): DesktopCollection | undefined {
  const a = address.toLowerCase()
  return DESKTOP_COLLECTIONS.find((c) => c.chainId === chainId && c.address === a)
}

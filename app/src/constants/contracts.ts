import type { Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

interface ContractAddresses {
  [key: number]: Address | ''
}

export const AUCTION_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0x5892Cad52d9e6bDd757947B56E2760E0DcE21CE9',
  [sepolia.id]: '0xc5def3e07c426dd40248e694e5f428b04c52a129',
}

/** Auctions run on Ethereum whatever network the wallet is on. A development build can set VITE_AUCTION_CHAIN_ID to Sepolia. */
export const AUCTION_CHAIN_ID =
  import.meta.env.DEV && Number(import.meta.env.VITE_AUCTION_CHAIN_ID) === sepolia.id ? sepolia.id : mainnet.id

export const DEFAULT_NFT_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0xaE6f241885d5eeD67ca97728d4e423Aaf9D81C59',
  [sepolia.id]: '0x2e28b5cc90d8a9e4d661417568eb83bdd2df26c3',
}

/** Legacy MiyaMints v1 factory (ERC721M). Retired: Launch now uses the miyamints factories below. */
export const FACTORY_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0x37d2127ed8fc713cbb30c8dd2f6ef6d329e43420',
}

export const PARENTS = {
  [mainnet.id]: {
    milady_maker: '0x5af0d9827e0c53e4799bb226655a1de152a425a5',
  },
}

/** MIYAMINI (ERC721M clone) on Ethereum mainnet: the collection the Mint window sells. */
export const MIYAMINI_CONTRACT: Address = '0x375a1911c0c2982f59826c227b7830e5d5985d59'
export const MIYAMINI_CHAIN_ID = mainnet.id
export const MIYAMINI_METADATA_BASE = 'https://koolskull.com/miyamakermini/metadata/json/'

/**
 * miyamints: the contracts/ system (MiyaRegistry, ERC721 drop/auction factories, ERC1155 music factory,
 * MiyaPoolFactory, UniAlignmentVaultFactory and the default alignment vault), deployed by
 * contracts/script/DeployMiyamints.s.sol. Separate from the legacy MiyaMints factory/auction above, which stay.
 *
 * Source per chain, highest priority first:
 *   1. env, e.g. VITE_MUSIC_FACTORY_1 / VITE_MUSIC_VAULT_1 / VITE_MIYA_REGISTRY_1 (printed by the deploy script);
 *   2. contracts/deployments/<chainId>.json, written only by a broadcast deploy (dry runs write *.local.json).
 * A chain with neither is simply absent: callers treat that as "not deployed here".
 */
export type MiyamintsAddresses = {
  registry?: Address
  erc721DropFactory?: Address
  erc721AuctionFactory?: Address
  erc1155Factory?: Address
  defaultVault?: Address
  miyaPoolFactory?: Address
  vaultFactory?: Address
}

/** Env prefix per address; the chain id is appended (VITE_MUSIC_FACTORY_1, ...). */
export const MIYAMINTS_ENV: Record<keyof MiyamintsAddresses, string> = {
  registry: 'VITE_MIYA_REGISTRY_',
  erc721DropFactory: 'VITE_ERC721_DROP_FACTORY_',
  erc721AuctionFactory: 'VITE_ERC721_AUCTION_FACTORY_',
  erc1155Factory: 'VITE_MUSIC_FACTORY_',
  defaultVault: 'VITE_MUSIC_VAULT_',
  miyaPoolFactory: 'VITE_MIYA_POOL_FACTORY_',
  vaultFactory: 'VITE_VAULT_FACTORY_',
}

const MIYAMINTS_KEYS = Object.keys(MIYAMINTS_ENV) as (keyof MiyamintsAddresses)[]

const asAddress = (v: unknown): Address | undefined =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) && !/^0x0{40}$/.test(v.trim())
    ? (v.trim() as Address)
    : undefined

/** Bundled deployment files. Only `<chainId>.json` counts; dry-run `*.local.json` files are ignored. */
const deploymentFiles = import.meta.glob(
  ['../../../contracts/deployments/*.json', '!../../../contracts/deployments/*.local.json'],
  { eager: true, import: 'default' }
) as Record<string, Record<string, unknown> | undefined>

export const MIYAMINTS_DEPLOYMENTS: Record<number, MiyamintsAddresses> = (() => {
  const out: Record<number, MiyamintsAddresses> = {}
  for (const [path, json] of Object.entries(deploymentFiles)) {
    const m = /\/(\d+)\.json$/.exec(path)
    if (!m || !json) continue
    const entry: MiyamintsAddresses = {}
    for (const key of MIYAMINTS_KEYS) {
      const v = asAddress(json[key])
      if (v) entry[key] = v
    }
    out[Number(m[1])] = entry
  }
  return out
})()

/** miyamints addresses for one chain: env overrides first, then contracts/deployments/<chainId>.json. */
export function miyamintsAddresses(chainId: number): MiyamintsAddresses {
  const env = import.meta.env as Record<string, string | undefined>
  const file = MIYAMINTS_DEPLOYMENTS[chainId] || {}
  const out: MiyamintsAddresses = {}
  for (const key of MIYAMINTS_KEYS) {
    const v = asAddress(env[`${MIYAMINTS_ENV[key]}${chainId}`]) || file[key]
    if (v) out[key] = v
  }
  return out
}

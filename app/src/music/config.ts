import type { Address } from 'viem'
import { mainnet, robinhood, sepolia } from 'viem/chains'

import { miyamintsAddresses } from '@/constants/contracts'

/**
 * Where music drops live per chain: the ERC1155Factory and default alignment vault deployed by
 * contracts/script/DeployMiyamints.s.sol, resolved by miyamintsAddresses() (constants/contracts.ts):
 *   VITE_MUSIC_FACTORY_<chainId>  ERC1155Factory (its registry() is read on-chain)
 *   VITE_MUSIC_VAULT_<chainId>    alignment vault registered in MiyaRegistry (required by createInstance)
 * falling back to contracts/deployments/<chainId>.json (erc1155Factory / defaultVault).
 * Without a factory, Drop Music can still upload and build metadata but cannot launch, and the Music
 * listing only shows collections pasted in or launched from this browser.
 */
export type MusicChainConfig = { chainId: number; name: string; factory?: Address; vault?: Address }

export const MUSIC_CHAINS: MusicChainConfig[] = [mainnet, sepolia, robinhood].map((c) => {
  const a = miyamintsAddresses(c.id)
  return { chainId: c.id, name: c.name, factory: a.erc1155Factory, vault: a.defaultVault }
})

export function musicConfig(chainId: number | undefined): MusicChainConfig {
  return MUSIC_CHAINS.find((c) => c.chainId === chainId) || (MUSIC_CHAINS[0] as MusicChainConfig)
}

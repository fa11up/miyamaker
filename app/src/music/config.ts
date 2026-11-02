import type { Address } from 'viem'
import { isAddress } from 'viem'
import { mainnet, robinhood, sepolia } from 'viem/chains'

/**
 * Where music drops live per chain. The ERC1155Factory / MiyaRegistry / UniAlignmentVault from contracts/
 * are not deployed yet, so addresses come from env (see .env.example):
 *   VITE_MUSIC_FACTORY_<chainId>  ERC1155Factory (its registry() is read on-chain)
 *   VITE_MUSIC_VAULT_<chainId>    alignment vault registered in MiyaRegistry (required by createInstance)
 * Without a factory, Drop Music can still upload and build metadata but cannot launch, and the Music
 * listing only shows collections pasted in or launched from this browser.
 */
export type MusicChainConfig = { chainId: number; name: string; factory?: Address; vault?: Address }

const env = import.meta.env as Record<string, string | undefined>
const addr = (v: string | undefined) => (v && isAddress(v.trim()) ? (v.trim() as Address) : undefined)

export const MUSIC_CHAINS: MusicChainConfig[] = [mainnet, sepolia, robinhood].map((c) => ({
  chainId: c.id,
  name: c.name,
  factory: addr(env[`VITE_MUSIC_FACTORY_${c.id}`]),
  vault: addr(env[`VITE_MUSIC_VAULT_${c.id}`]),
}))

export function musicConfig(chainId: number | undefined): MusicChainConfig {
  return MUSIC_CHAINS.find((c) => c.chainId === chainId) || (MUSIC_CHAINS[0] as MusicChainConfig)
}

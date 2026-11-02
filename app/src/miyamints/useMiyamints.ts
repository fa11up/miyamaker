import type { Address } from 'viem'
import { isAddress, zeroAddress } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'

import { chains, mainnet, type SupportedChainId } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'

import { erc20SymbolAbi, registryAbi, vaultAbi } from './abi'

/** The chain Launch works against: the wallet's chain when supported, else Ethereum. */
export function useLaunchChain() {
  const { chainId, isConnected } = useAccount()
  const supported = chains.some((c) => c.id === chainId)
  const id = (supported ? chainId : mainnet.id) as SupportedChainId
  const chain = chains.find((c) => c.id === id) || mainnet
  const addresses = miyamintsAddresses(id)
  const deployed = !!(
    addresses.registry &&
    addresses.erc721DropFactory &&
    addresses.erc721AuctionFactory &&
    addresses.erc1155Factory &&
    addresses.defaultVault
  )
  return { chainId: id, chain, addresses, deployed, isConnected, wrongChain: isConnected && !supported }
}

/** Registry rules for new launches on a chain (protocol fee, minimum alignment share). */
export function useRegistryRules(chainId: SupportedChainId, registry?: Address) {
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: registryAbi, functionName: 'minAlignmentBps', chainId },
      { address: registry, abi: registryAbi, functionName: 'protocolFeeBps', chainId },
    ],
    query: { enabled: !!registry },
  })
  const [min, fee] = q.data || []
  return {
    minAlignmentBps: (min?.result as number | undefined) ?? 1000,
    protocolFeeBps: (fee?.result as number | undefined) ?? 100,
    loaded: !!q.data,
    loading: q.isLoading,
  }
}

/** What a vault aligns to: whether the registry knows it, its target name and token ticker. */
export function useVaultInfo(chainId: SupportedChainId, registry?: Address, vault?: string) {
  const v = vault && isAddress(vault) ? (vault as Address) : undefined
  const base = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: registryAbi, functionName: 'isVault', args: [v || zeroAddress], chainId },
      { address: v, abi: vaultAbi, functionName: 'alignmentToken', chainId },
      { address: v, abi: vaultAbi, functionName: 'alignmentTargetId', chainId },
    ],
    query: { enabled: !!registry && !!v },
  })
  const [isVault, token, targetId] = base.data || []
  const tokenAddr = token?.result as Address | undefined
  const symbol = useReadContract({
    address: tokenAddr,
    abi: erc20SymbolAbi,
    functionName: 'symbol',
    chainId,
    query: { enabled: !!tokenAddr },
  })
  const target = useReadContract({
    address: registry,
    abi: registryAbi,
    functionName: 'getTarget',
    args: [(targetId?.result as bigint | undefined) ?? 0n],
    chainId,
    query: { enabled: !!registry && targetId?.result !== undefined },
  })
  return {
    registered: isVault?.result as boolean | undefined,
    token: tokenAddr,
    symbol: symbol.data as string | undefined,
    targetName: (target.data as readonly [string, boolean, readonly Address[]] | undefined)?.[0],
    loading: base.isLoading || symbol.isLoading || target.isLoading,
  }
}

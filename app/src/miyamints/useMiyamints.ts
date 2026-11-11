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
  // Only what the registry said: a guess shown as fact could promise a share or a fee the contract won't take.
  const minAlignmentBps = min?.status === 'success' ? (min.result as number) : undefined
  const protocolFeeBps = fee?.status === 'success' ? (fee.result as number) : undefined
  return {
    minAlignmentBps,
    protocolFeeBps,
    /** Both rules were read. */
    loaded: minAlignmentBps !== undefined && protocolFeeBps !== undefined,
    loading: q.isLoading,
    /** The registry could not be read: the share rules are unknown, so nothing can be created yet. */
    failed:
      !!registry &&
      !q.isLoading &&
      (q.isError || (!!q.data && (minAlignmentBps === undefined || protocolFeeBps === undefined))),
  }
}

/**
 * What a vault does with its share: whether the registry knows it, its target name, and the pair it builds liquidity
 * in (`symbol`, e.g. "INFER/IMD", read from the vault's infer() and imd()). A vault without those reads (not a v2
 * vault) has no `symbol`, and the screens say "community vault" rather than guess.
 */
export function useVaultInfo(chainId: SupportedChainId, registry?: Address, vault?: string) {
  const v = vault && isAddress(vault) ? (vault as Address) : undefined
  const base = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: registryAbi, functionName: 'isVault', args: [v || zeroAddress], chainId },
      { address: v, abi: vaultAbi, functionName: 'infer', chainId },
      { address: v, abi: vaultAbi, functionName: 'imd', chainId },
      { address: v, abi: vaultAbi, functionName: 'alignmentTargetId', chainId },
    ],
    query: { enabled: !!registry && !!v },
  })
  const [isVault, infer, imd, targetId] = base.data || []
  const inferAddr = infer?.status === 'success' ? (infer.result as Address) : undefined
  const imdAddr = imd?.status === 'success' ? (imd.result as Address) : undefined
  const symbols = useReadContracts({
    allowFailure: true,
    contracts: [inferAddr, imdAddr].map((address) => ({
      address,
      abi: erc20SymbolAbi,
      functionName: 'symbol' as const,
      chainId,
    })),
    query: { enabled: !!inferAddr && !!imdAddr },
  })
  const [a, b] = symbols.data || []
  const target = useReadContract({
    address: registry,
    abi: registryAbi,
    functionName: 'getTarget',
    args: [(targetId?.result as bigint | undefined) ?? 0n],
    chainId,
    query: { enabled: !!registry && targetId?.result !== undefined },
  })
  const pair =
    a?.status === 'success' && b?.status === 'success' ? `${String(a.result)}/${String(b.result)}` : undefined
  return {
    registered: isVault?.result as boolean | undefined,
    infer: inferAddr,
    imd: imdAddr,
    /** The liquidity pair, e.g. "INFER/IMD". */
    symbol: pair,
    targetName: (target.data as readonly [string, boolean, readonly Address[]] | undefined)?.[0],
    loading: base.isLoading || symbols.isLoading || target.isLoading,
  }
}

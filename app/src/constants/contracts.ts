import type { Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

interface ContractAddresses {
  [key: number]: Address | ''
}

export const AUCTION_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0x5892Cad52d9e6bDd757947B56E2760E0DcE21CE9',
  [sepolia.id]: '0xc5def3e07c426dd40248e694e5f428b04c52a129',
}

export const DEFAULT_NFT_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0xaE6f241885d5eeD67ca97728d4e423Aaf9D81C59',
  [sepolia.id]: '0x2e28b5cc90d8a9e4d661417568eb83bdd2df26c3',
}

export const FACTORY_CONTRACT: ContractAddresses = {
  [mainnet.id]: '0x37d2127ed8fc713cbb30c8dd2f6ef6d329e43420',
}

export const PARENTS = {
  [mainnet.id]: {
    milady_maker: '0x5af0d9827e0c53e4799bb226655a1de152a425a5',
  },
}

export const DEFAULT_PARENT: ContractAddresses = {
  [mainnet.id]: PARENTS[mainnet.id].milady_maker as Address,
}

interface VaultIds {
  [key: number]: string
}

export const DEFAULT_VAULT: VaultIds = {
  [mainnet.id]: '392',
}

/** MIYAMINI (ERC721M clone) on Ethereum mainnet: the collection the Mint window sells. */
export const MIYAMINI_CONTRACT: Address = '0x375a1911c0c2982f59826c227b7830e5d5985d59'
export const MIYAMINI_CHAIN_ID = mainnet.id
export const MIYAMINI_METADATA_BASE = 'https://koolskull.com/miyamakermini/metadata/json/'

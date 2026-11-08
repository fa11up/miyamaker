type Collection = {
  name: string
  symbol: string
  address: string
  createdAt: string
  metadataUri: string
  totalSupply: number
  /** The chain it lives on: reads and the mint go there, whatever network the wallet is on. */
  chainId?: number
}

export type { Collection }

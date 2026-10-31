import type { Address, Hex } from 'viem'

/** Subset of the 0x Swap API v2 AllowanceHolder price/quote response we use. */
export type ZeroExFee = { amount: string; token: Address; type: string } | null

export type ZeroExIssues = {
  allowance: { actual: string; spender: Address } | null
  balance: { token: Address; actual: string; expected: string } | null
  simulationIncomplete: boolean
  invalidSourcesPassed: string[]
}

export type ZeroExRoute = {
  fills: { from: Address; to: Address; source: string; proportionBps: string }[]
  tokens: { address: Address; symbol: string }[]
}

type Liquid = {
  liquidityAvailable: true
  blockNumber: string
  buyAmount: string
  buyToken: Address
  sellAmount: string
  sellToken: Address
  minBuyAmount: string
  fees: { integratorFee: ZeroExFee; zeroExFee: ZeroExFee; gasFee: ZeroExFee }
  issues: ZeroExIssues
  route: ZeroExRoute
  gas: string | null
  gasPrice: string
  totalNetworkFee: string | null
  allowanceTarget: Address | null
  zid: string
}

export type ZeroExPrice = Liquid | { liquidityAvailable: false; zid: string }

export type ZeroExQuote =
  | (Liquid & { transaction: { to: Address; data: Hex; gas: string | null; gasPrice: string; value: string } })
  | { liquidityAvailable: false; zid: string }

export type SwapRequest = {
  chainId: number
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  taker?: Address
  slippageBps: number
}

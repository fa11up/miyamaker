import { type Abi, type Address, encodeFunctionData, type Hex } from 'viem'

/**
 * One step of a batch: a contract call in the shape simulateContract takes, or a ready-made { to, data } such as a 0x
 * quote. Pure, so tests run under plain node.
 */
export type BatchStep =
  | { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }
  | { to: Address; data: Hex; value?: bigint }

export const toCall = (step: BatchStep) => {
  if ('to' in step) return { to: step.to, data: step.data, value: step.value }
  return {
    to: step.address,
    data: encodeFunctionData({ abi: step.abi as Abi, functionName: step.functionName, args: step.args as unknown[] }),
    value: step.value,
  }
}

/** EIP-5792: `ready` is a wallet that upgrades the account (EIP-7702) when asked, `supported` one that already can. */
export const canBatch = (capabilities: unknown) => {
  const status = (capabilities as { atomic?: { status?: string } } | undefined)?.atomic?.status
  return status === 'supported' || status === 'ready'
}

// 4200 no such method; 57xx the wallet cannot do this batch, or the person declined the account upgrade it needs.
const NO_BATCH_CODES = [4200, 5700, 5710, 5720, 5730, 5740, 5750, 5760]

/** The wallet will not batch, so the separate steps are still open. A plain rejection (4001) is not this: it means stop. */
export function batchRefused(error: unknown) {
  let e = error as { code?: number; message?: string; cause?: unknown } | undefined
  for (let depth = 0; e && depth < 6; depth += 1) {
    if (e.code === 4001) return false
    if (e.code !== undefined && NO_BATCH_CODES.includes(e.code)) return true
    e = e.cause as typeof e
  }

  return /wallet_sendCalls|does not support|not supported|method not found/i.test((error as Error)?.message || '')
}

/** The factories' preview of a new collection's address: fixed by salt and creator, so a batch can call it in advance. */
export const instanceAddressAbi = [
  {
    type: 'function',
    name: 'computeInstanceAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'salt', type: 'bytes32' },
      { name: 'creator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

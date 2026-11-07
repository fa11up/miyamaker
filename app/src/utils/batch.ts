import { getCapabilities, sendCalls, simulateContract, waitForCallsStatus } from '@wagmi/core'
import type { Address, Hash } from 'viem'
import { useAccount, useCapabilities } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { TxEndError } from '@/miyamints/txOutcome'

import { batchRefused, type BatchStep, canBatch, toCall } from './batchCalls'

// Wallets that said they could batch and then would not: this session they get the separate steps.
const refused = new Set<string>()

/** Whether the connected wallet can take several steps as one signature on this chain. */
export function useCanBatch(chainId: number | undefined) {
  const { address } = useAccount()
  const { data } = useCapabilities({
    account: address,
    chainId,
    query: { enabled: !!address && !!chainId, retry: false },
  })
  return !!address && !refused.has(address.toLowerCase()) && canBatch(data)
}

/**
 * Sends the steps as one signature, all or nothing, the way the imdUSD terminal does. Resolves to undefined when the
 * wallet cannot batch, and nothing has been sent: the caller goes on with separate steps.
 */
export async function tryBatch(
  steps: BatchStep[],
  {
    account,
    chainId,
    onAsk,
    onSent,
  }: { account: Address; chainId: number; onAsk?: () => void; onSent?: (id: string) => void }
) {
  if (refused.has(account.toLowerCase())) return undefined
  const capabilities = await getCapabilities(wagmiConfig, { account, chainId: chainId as never }).catch(() => undefined)
  if (!canBatch(capabilities)) return undefined

  // Later steps depend on the earlier ones landing, so only the first can be simulated; it catches most bad input.
  const [first] = steps
  if (first && 'abi' in first) {
    await simulateContract(wagmiConfig, { account, chainId, ...first } as never)
  }

  onAsk?.()
  let id: string
  try {
    ;({ id } = await sendCalls(wagmiConfig, {
      account,
      chainId: chainId as never,
      forceAtomic: true,
      calls: steps.map(toCall),
    }))
  } catch (e) {
    if (!batchRefused(e)) throw e
    refused.add(account.toLowerCase())
    return undefined
  }

  onSent?.(id)
  return waitForBatch(id)
}

/**
 * Waits for a batch already sent. Only a batch the wallet reports as failed counts as failed: running out of time or losing
 * the connection says nothing, since it may yet land, so that throws "unconfirmed" and nothing should send it again.
 */
export async function waitForBatch(id: string) {
  let result
  try {
    result = await waitForCallsStatus(wagmiConfig, { id, timeout: 180_000 })
  } catch {
    throw new TxEndError('unconfirmed')
  }

  if (result.status !== 'success') {
    throw new Error('The batch did not go through. It is all or nothing, so none of its steps were applied.')
  }

  const receipts = result.receipts ?? []
  return { hash: receipts[receipts.length - 1]?.transactionHash as Hash | undefined, receipts }
}

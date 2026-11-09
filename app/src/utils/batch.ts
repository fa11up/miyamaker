import { getCapabilities, sendCalls, simulateContract, waitForCallsStatus } from '@wagmi/core'
import type { Address, Hash } from 'viem'
import { useAccount, useCapabilities } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { TxEndError } from '@/miyamints/txOutcome'

import { batchRefused, type BatchStep, canBatch, toCall } from './batchCalls'

/**
 * A batch or transaction that was sent, but whose ending could not be read: the wait ran out or the connection dropped.
 * It may yet land, so a caller keeps what it sent and waits on it again rather than sending it a second time.
 */
export class UnconfirmedError extends TxEndError {
  constructor(message?: string) {
    super('unconfirmed')
    if (message) this.message = message
  }
}

export const isUnconfirmed = (e: unknown) => !!(e as UnconfirmedError | undefined)?.unconfirmed

/**
 * The wallet no longer knows the batch id (it was reset or reconnected). Waiting on that id again can never answer,
 * so the caller looks at the chain instead to see whether the batch landed.
 */
export const batchForgotten = () =>
  Object.assign(new Error('Your wallet no longer knows this batch. Looking at the chain instead.'), { forgotten: true })

export const isBatchForgotten = (e: unknown) => !!(e as { forgotten?: boolean } | undefined)?.forgotten

/** EIP-5792 code 5730, and the words wallets use for it when they leave the code out. */
export function unknownBatchId(error: unknown) {
  let e = error as { code?: number; name?: string; message?: string; details?: string; cause?: unknown } | undefined
  for (let depth = 0; e && depth < 6; depth += 1) {
    if (e.code === 5730 || e.name === 'UnknownBundleIdError') return true
    if (
      /unknown bundle|bundle id is unknown|(bundle|batch|calls?) (id )?not found|unknown (batch|calls?) id/i.test(
        `${e.message || ''} ${e.details || ''}`
      )
    )
      return true
    e = e.cause as typeof e
  }

  return false
}

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
 * Waits for a batch already sent. Only the wallet reporting it failed counts as failed: running out of time or losing
 * the connection says nothing about how it ended, so that throws an UnconfirmedError and nothing should send it again.
 * A wallet that has forgotten the id throws a batchForgotten() error: only the chain can say how that one ended.
 */
export async function waitForBatch(id: string) {
  let result
  try {
    result = await waitForCallsStatus(wagmiConfig, { id, timeout: 180_000 })
  } catch (e) {
    if (unknownBatchId(e)) throw batchForgotten()
    throw new UnconfirmedError()
  }

  if (result.status !== 'success') {
    throw new Error('The batch did not go through. It is all or nothing, so none of its steps were applied.')
  }

  const receipts = result.receipts ?? []
  return { hash: receipts[receipts.length - 1]?.transactionHash as Hash | undefined, receipts }
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

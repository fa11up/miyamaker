import { getPublicClient, readContract, simulateContract, writeContract } from '@wagmi/core'
import type { Address, Hash, Log, TransactionReceipt } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { TxEndError } from '@/miyamints/txOutcome'
import { waitForTx } from '@/miyamints/useTxOutcome'
import { tryBatch, waitForBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'

import type { LaunchAsk, LaunchProgress, NonceRead } from './resume'
import { batchInstance, leftoverVerdict, nextLaunchStep, sentVerdict } from './resume'

/**
 * Sends a launch to the chain (Launch and Drop Music): create the collection, then its first piece, as one batch when
 * the wallet can. `progress` is saved after every change, and before every wallet prompt, so a reload carries on from
 * it. Nothing is sent again while it may still land, and the chain is read before anything is sent: code at the
 * predicted address, the first piece already there. The ideas are the MusicMaker branch's launchEdition.ts.
 */

/** Written for people here, shown as it is. */
export class SaidError extends Error {
  plain = true
}

/** Something may still be out and can't be told apart yet. Carries `unconfirmed`, so it is kept and waited on. */
export class StillOutError extends SaidError {
  unconfirmed = true
}

export const COULD_NOT_READ_WORDS =
  'The network could not be read just now, so nothing was sent. Try again in a minute: it looks again first.'
export const CHECK_WALLET_WORDS =
  "Your wallet may still be sending the earlier request. Check your wallet's activity. Try again looks again and sends nothing new."

export type ContractCall = {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

export type ChainLaunch = {
  chainId: number
  account: Address
  progress: LaunchProgress
  /** Saves the record. Throws when it could not be saved: a reload would then send again. */
  save(): void
  /** Throws when the window has closed, so no prompt opens for nobody. */
  stopIfClosed(): void
  create: ContractCall
  /** The factory places the collection by the salt (auction, editions). False for drops. */
  salted: boolean
  createdFrom(logs: Log[]): Address | undefined
  /** Unsalted (drops): one this wallet made from this block on, if any. Throws when it can't be searched. */
  findCreated?: (fromBlock: bigint) => Promise<Address | undefined>
  first?: {
    call(instance: Address): ContractCall
    /** The first piece's id if it is on the chain already. Throws when it can't be read. */
    find(instance: Address): Promise<bigint | undefined>
    idFromLogs(logs: Log[]): bigint | undefined
    /** "your piece", "the edition" */
    name: string
  }
  mark(step: 'deploy' | 'first', state: 'active' | 'done'): void
  onDeployed(instance: Address): void
}

export type ChainResult = { instance: Address; deployHash?: Hash; firstHash?: Hash; firstId?: bigint }

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

/** Reads until it finds something. Not found only when the last read answered; a failed last read throws. */
async function lookAgain<T>(read: () => Promise<T | undefined>, tries: number, gap = 3000): Promise<T | undefined> {
  let failed = false
  const found = await read().catch(() => {
    failed = true
    return undefined
  })
  if (found !== undefined) return found
  if (tries <= 1) {
    if (failed) throw new StillOutError(COULD_NOT_READ_WORDS)
    return undefined
  }
  await pause(gap)
  return lookAgain(read, tries - 1, gap)
}

type Waited = { status: 'success'; receipt: TransactionReceipt } | { status: 'reverted' } | { status: 'dropped' }

export async function launchOnChain(l: ChainLaunch): Promise<ChainResult> {
  const p = l.progress
  const chainId = l.chainId as never
  const client = getPublicClient(wagmiConfig, { chainId })
  if (!client) throw new SaidError(COULD_NOT_READ_WORDS)

  const nonces = async (): Promise<NonceRead> => {
    try {
      const [pending, latest] = await Promise.all([
        client.getTransactionCount({ address: l.account, blockTag: 'pending' }),
        client.getTransactionCount({ address: l.account, blockTag: 'latest' }),
      ])
      return { pending, latest }
    } catch {
      throw new SaidError(COULD_NOT_READ_WORDS)
    }
  }

  const hasCode = async (address: Address) => {
    const code = await client.getCode({ address })
    return code && code !== '0x' ? true : undefined
  }

  /** Records the nonce, block and prompt, and saves, before the wallet opens. */
  const ask = async (what: LaunchAsk) => {
    l.stopIfClosed()
    const [n, block] = await Promise.all([nonces(), client.getBlockNumber().catch(() => undefined)])
    p.askNonce = n.pending
    p.askBlock = block?.toString()
    p.sentAt = Date.now()
    p.dropped = undefined
    p.asking = what
    l.save()
    try {
      l.stopIfClosed()
    } catch (e) {
      // Closed before the wallet opened: nothing was asked for.
      p.asking = undefined
      l.save()
      throw e
    }
  }

  const settled = () => {
    p.asking = undefined
    l.save()
  }

  /** Waits for a kept hash. A cancel, a replacement, or its nonce used by something else means ours did not run. */
  const waitSent = async (hash: Hash, sentNonce: number | undefined): Promise<Waited> => {
    const found = await client.getTransactionReceipt({ hash }).then(
      (r) => r,
      (e: { name?: string }) => (e?.name === 'TransactionReceiptNotFoundError' ? null : undefined)
    )
    if (found) return found.status === 'success' ? { status: 'success', receipt: found } : { status: 'reverted' }
    if (found === null) {
      const { latest } = await nonces()
      if (sentVerdict(sentNonce, latest, false) === 'dropped') {
        // A sped-up copy mines under another hash and would look the same: one more look for ours first.
        await pause(3000)
        const again = await client.getTransactionReceipt({ hash }).catch(() => undefined)
        if (again) return again.status === 'success' ? { status: 'success', receipt: again } : { status: 'reverted' }
        return { status: 'dropped' }
      }
    }
    try {
      return { status: 'success', receipt: await waitForTx(l.chainId, hash) }
    } catch (e) {
      if ((e as TxEndError).cancelled) return { status: 'dropped' }
      if ((e as TxEndError).reverted) return { status: 'reverted' }
      throw e
    }
  }

  /** A hash we sent did not run. Ours may still have run under another hash, so the next try looks first. */
  const dropped = (what: LaunchAsk, nonce: number | undefined, words: string) => {
    p.asking = what
    p.askNonce = nonce
    p.dropped = true
    l.save()
    return new SaidError(words)
  }

  const deployed = (instance: Address) => {
    p.instance = instance
    p.dropped = undefined
    l.save()
    l.onDeployed(instance)
    l.mark('deploy', 'done')
  }

  // A wallet prompt that was open when the app went away. If something left the wallet since and is not mined, wait:
  // the chain then says whether it was ours. Never send another while it is out.
  const leftover = p.asking
  let verdict: ReturnType<typeof leftoverVerdict> | undefined
  if (leftover) {
    const now = await nonces()
    verdict = leftoverVerdict(p.askNonce, now)
    if (verdict === 'in-flight') {
      const deadline = Date.now() + 120_000
      let { latest } = now
      while (latest < now.pending) {
        if (Date.now() > deadline) throw new StillOutError(CHECK_WALLET_WORDS)
        // eslint-disable-next-line no-await-in-loop
        await pause(4000)
        // eslint-disable-next-line no-await-in-loop
        latest = (await nonces()).latest
      }
    }
  }

  // Look on the chain before sending anything: the collection may be there without a word back.
  if (!p.instance) {
    if (l.salted) {
      const [salt] = (l.create.args ?? []) as readonly [`0x${string}`]
      p.predicted ??= (await readContract(wagmiConfig, {
        address: l.create.address,
        abi: instanceAddressAbi,
        functionName: 'computeInstanceAddress',
        args: [salt, l.account],
        chainId,
      }).catch(() => undefined)) as Address | undefined
      l.save()
      const { predicted } = p
      if (predicted && (await lookAgain(() => hasCode(predicted), leftover || p.batchId || p.deployHash ? 2 : 1))) {
        // A batch is all or nothing: the first piece came with it, and is never sent again.
        if (p.batchId || leftover === 'batch') p.batched = true
        p.batchId = undefined
        deployed(predicted)
      }
    } else if (leftover === 'deploy' && verdict !== 'not-sent') {
      // A drop has no fixed address, so sending again would make a second one: look for one this wallet made since
      // the prompt opened.
      const searchFailed = new StillOutError(
        'A create request was open when this closed, and the network could not be searched for it. Check My launches before trying again.'
      )
      if (!p.askBlock || !l.findCreated) throw searchFailed
      const made = await l.findCreated(BigInt(p.askBlock)).catch(() => {
        throw searchFailed
      })
      if (made) deployed(made)
    }
  }
  // The collection was looked for. A first piece left open is looked for below, and stays marked until it is.
  if (leftover && leftover !== 'first') settled()

  let step = nextLaunchStep(p, !!l.first)

  if (step === 'wait-batch' && p.batchId) {
    l.mark('deploy', 'active')
    const id = p.batchId
    const sent = await waitForBatch(id).catch((e) => {
      // Only the wallet saying it failed frees it. A wait that ran out keeps it, to be waited on again.
      if (!(e as TxEndError).unconfirmed) {
        p.batchId = undefined
        l.save()
      }
      throw e
    })
    await batchLanded(sent)
    step = nextLaunchStep(p, !!l.first)
  }

  async function batchLanded(sent: Awaited<ReturnType<typeof waitForBatch>>) {
    const logs = sent.receipts.flatMap((r) => r.logs ?? []) as Log[]
    const logged = l.createdFrom(logs)
    const code = logged || !p.predicted ? undefined : await lookAgain(() => hasCode(p.predicted as Address), 4)
    // Throws when the collection can't be told yet: the batch is kept, so a retry looks again and sends nothing.
    const instance = batchInstance(logged, p.predicted, code)
    p.batched = true
    p.batchId = undefined
    p.deployHash = sent.hash
    const firstId = l.first?.idFromLogs(logs)
    if (firstId !== undefined) {
      p.firstId = firstId
      p.firstDone = true
      p.firstHash = sent.hash
    }
    deployed(instance)
  }

  if (step === 'deploy') {
    const { predicted } = p
    let batchSent: Awaited<ReturnType<typeof waitForBatch>> | undefined
    // Create it and add the first piece as one signature. Its address is fixed by the salt, so the second call can
    // name it in advance; if anything is off, the whole batch reverts and nothing was created.
    if (l.first && l.salted && predicted) {
      await ask('batch')
      try {
        batchSent = await tryBatch([l.create, l.first.call(predicted)], {
          account: l.account,
          chainId: l.chainId,
          onAsk: () => l.mark('deploy', 'active'),
          onSent: (id) => {
            p.batchId = id
            p.asking = undefined
            p.sentAt = Date.now()
            l.save()
            l.mark('first', 'active')
          },
        })
      } catch (e) {
        p.asking = undefined
        if (!(e as TxEndError).unconfirmed) p.batchId = undefined
        l.save()
        throw e
      }
      // No batching here: nothing was sent, so it goes as separate steps.
      if (!batchSent) settled()
      else await batchLanded(batchSent)
    }

    if (!batchSent) {
      l.mark('deploy', 'active')
      const { request } = await simulateContract(wagmiConfig, { account: l.account, chainId, ...l.create } as never)
      await ask('deploy')
      try {
        p.deployHash = (await writeContract(wagmiConfig, request as never)) as Hash
        p.deployNonce = p.askNonce
        p.sentAt = Date.now()
      } finally {
        settled()
      }
    }
    step = nextLaunchStep(p, !!l.first)
  }

  if (step === 'wait-deploy' && p.deployHash) {
    l.mark('deploy', 'active')
    const waited = await waitSent(p.deployHash, p.deployNonce)
    const atPredicted = async (tries: number) =>
      p.predicted ? ((await lookAgain(() => hasCode(p.predicted as Address), tries)) && p.predicted) || undefined : undefined
    if (waited.status === 'success') {
      // The hash stays until the collection is known, so a retry reads it again rather than deploying again.
      const instance = l.createdFrom(waited.receipt.logs) ?? (await atPredicted(4))
      if (!instance)
        throw new SaidError('Created, but the new address could not be read yet. Try again in a minute: it sends nothing new.')
      deployed(instance)
    } else {
      // The same salt can only make one collection, so an earlier send may have made it: look before saying not.
      const instance = await atPredicted(2)
      if (instance) deployed(instance)
      else {
        const nonce = p.deployNonce
        p.deployHash = undefined
        p.deployNonce = undefined
        l.save()
        if (waited.status === 'dropped')
          throw dropped(
            'deploy',
            nonce,
            'Your wallet cancelled or replaced the create request, so it did not run. Try again looks on the chain first, then sends it again.'
          )
        throw new SaidError('The create transaction failed on the network. Nothing was created. You only paid the network fee.')
      }
    }
    step = nextLaunchStep(p, !!l.first)
  }

  const instance = p.instance
  if (!instance) throw new SaidError('Created, but the new address could not be read yet. Try again in a minute: it sends nothing new.')

  if (l.first && step === 'first') {
    l.mark('first', 'active')
    // Sending this twice would pay twice (the auction's deposit), so the chain is read first: one that went out
    // without a word back is found, never sent again.
    const careful = p.batched || !!leftover || !!p.dropped
    const there = await lookAgain(() => l.first!.find(instance), careful ? 3 : 1)
    if (p.asking === 'first') p.asking = undefined
    if (there !== undefined) {
      p.firstId = there
      p.firstDone = true
      l.save()
    } else if (p.batched) {
      throw new SaidError(
        `The collection is live, and ${l.first.name} came with it in the same batch, but it could not be read yet. Try again in a minute: nothing new is sent.`
      )
    } else {
      const { request } = await simulateContract(wagmiConfig, {
        account: l.account,
        chainId,
        ...l.first.call(instance),
      } as never)
      await ask('first')
      try {
        p.firstHash = (await writeContract(wagmiConfig, request as never)) as Hash
        p.firstNonce = p.askNonce
        p.sentAt = Date.now()
      } finally {
        settled()
      }
    }
    step = nextLaunchStep(p, true)
  }

  if (l.first && step === 'wait-first' && p.firstHash) {
    l.mark('first', 'active')
    const waited = await waitSent(p.firstHash, p.firstNonce)
    if (waited.status !== 'success') {
      const nonce = p.firstNonce
      p.firstHash = undefined
      p.firstNonce = undefined
      l.save()
      if (waited.status === 'dropped')
        throw dropped(
          'first',
          nonce,
          `The collection is live, but your wallet cancelled or replaced adding ${l.first.name}, so it did not run. Try again looks on the chain first, then adds it.`
        )
      throw new SaidError(`The collection is live, but adding ${l.first.name} failed on the network. Try again to add it.`)
    }
    const id = l.first.idFromLogs(waited.receipt.logs) ?? (await lookAgain(() => l.first!.find(instance), 3))
    p.firstId = id
    p.firstDone = true
    l.save()
  }

  if (l.first && p.firstDone) l.mark('first', 'done')
  return { instance, deployHash: p.deployHash, firstHash: p.firstHash, firstId: p.firstId }
}

/** The auction's first piece is token 1: queued once `nextTokenId` has moved past it. */
export const auctionFirstAbi = [
  { type: 'function', name: 'nextTokenId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
] as const

export const editionIdsAbi = [
  { type: 'function', name: 'getAllEditionIds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256[]' }] },
] as const

export async function findAuctionPiece(chainId: number, instance: Address): Promise<bigint | undefined> {
  const next = await readContract(wagmiConfig, {
    address: instance,
    abi: auctionFirstAbi,
    functionName: 'nextTokenId',
    chainId: chainId as never,
  })
  return Number(next) > 1 ? 1n : undefined
}

export async function findFirstEdition(chainId: number, instance: Address): Promise<bigint | undefined> {
  const ids = await readContract(wagmiConfig, {
    address: instance,
    abi: editionIdsAbi,
    functionName: 'getAllEditionIds',
    chainId: chainId as never,
  })
  return ids[0]
}

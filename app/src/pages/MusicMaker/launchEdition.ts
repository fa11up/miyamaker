import { getPublicClient, readContract, simulateContract, writeContract } from '@wagmi/core'
import type { Address, Hash, TransactionReceipt } from 'viem'
import { parseEventLogs, zeroAddress, zeroHash } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { erc1155FactoryAbi, erc1155InstanceAbi } from '@/music/abi'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { isBatchForgotten, isUnconfirmed, tryBatch, UnconfirmedError, waitForBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'

import {
  batchEdition,
  batchLanded,
  type ChainReads,
  findEdition,
  findInstance,
  type LaunchProgress,
  nextLaunchStep,
} from './mintPlan'

type ChainId = (typeof wagmiConfig.chains)[number]['id']

export type EditionLaunch = {
  account: Address
  chainId: number
  factory: Address
  vault: Address
  name: string
  title: string
  metadataURI: string
  priceWei: bigint
  supply: bigint
  model: number
  rate: bigint
  alignmentBps: number
  mintFirst: boolean
}

export type EditionResult = {
  instance: Address
  editionId?: bigint
  minted: boolean
}

const freshSalt = (factory: Address) => makeSalt(factory, crypto.getRandomValues(new Uint8Array(11)))

const balanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

function createCall(
  input: Pick<EditionLaunch, 'account' | 'factory' | 'vault' | 'name' | 'metadataURI' | 'alignmentBps'>,
  salt: Hash
) {
  return {
    address: input.factory,
    abi: erc1155FactoryAbi,
    functionName: 'createInstance' as const,
    args: [
      salt,
      {
        name: input.name,
        metadataURI: input.metadataURI,
        creator: input.account,
        vault: input.vault,
        alignmentBps: input.alignmentBps,
        styleUri: '',
        gatingModule: zeroAddress,
        freeMint: { allocation: 0n, scope: GATING_SCOPE_BOTH },
      },
    ],
  }
}

/** Dry-runs the create call with a stand-in metadata link, so a problem shows before any upload is paid for. */
export async function checkLaunch(
  input: Pick<EditionLaunch, 'account' | 'chainId' | 'factory' | 'vault' | 'name' | 'alignmentBps'>
) {
  const call = createCall({ ...input, metadataURI: 'ar://placeholder-metadata' }, freshSalt(input.factory))
  await simulateContract(wagmiConfig, { account: input.account, chainId: input.chainId as ChainId, ...call } as never)
}

/**
 * Waits through the public client, which returns a reverted receipt rather than throwing. A lookup that fails or runs
 * out of time says nothing about the transaction, so that is unconfirmed and the hash is kept.
 */
async function waitFor(
  chainId: ChainId,
  hash: Hash,
  onReverted: () => void,
  words: string
): Promise<TransactionReceipt> {
  const client = getPublicClient(wagmiConfig, { chainId })
  if (!client) throw new UnconfirmedError()
  let receipt: TransactionReceipt
  try {
    receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 })
  } catch {
    throw new UnconfirmedError()
  }

  if (receipt.status !== 'success') {
    onReverted()
    throw new Error(words)
  }

  return receipt
}

/**
 * Deploy an ERC-1155 music edition and optionally mint the first copy to the creator.
 * `progress` is kept by the caller across attempts and updated as each step lands, so a retry after a failure or a
 * timeout carries on from the deployed collection, and never sends again something that is still out. The collection
 * is always sent with the same salt, so even a send nobody heard back from can only ever make one.
 */
export async function launchEdition(
  input: EditionLaunch,
  progress: LaunchProgress,
  onDeployed?: (instance: Address) => void
): Promise<EditionResult> {
  const chainId = input.chainId as ChainId
  const editionCall = {
    abi: erc1155InstanceAbi,
    functionName: 'addEdition' as const,
    args: editionArgs({
      title: input.title,
      priceWei: input.priceWei,
      supply: input.supply,
      model: input.model,
      metadataURI: input.metadataURI,
      priceIncreaseRate: input.rate,
    }),
  }

  const client = getPublicClient(wagmiConfig, { chainId })
  const reads: ChainReads = {
    hasCode: async (address) => {
      if (!client) throw new Error('No connection to the network')
      const code = await client.getCode({ address })
      return !!code && code !== '0x'
    },
    editionIds: (address) =>
      readContract(wagmiConfig, {
        address,
        abi: erc1155InstanceAbi,
        functionName: 'getAllEditionIds',
        chainId,
      }) as Promise<readonly bigint[]>,
    pause: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
  }

  const deployed = (instance: Address) => {
    progress.instance = instance
    addKnownCollection(chainId, instance)
    onDeployed?.(instance)
    return instance
  }

  // A wallet prompt that was open when the app went away: what it sent, if anything, is looked for on the chain
  // below, and it stays marked until then.
  const leftover = progress.asking

  /**
   * Something with this salt may have landed without a word back. If the collection is there, carry on from it, and
   * take its edition if it has one. A collection a batch made has its edition, even if it can't be read yet.
   */
  const foundAt = async (fromBatch: boolean, tries: number) => {
    const instance = await findInstance(progress, reads, tries)
    if (!instance) return undefined
    deployed(instance)
    const editionId = await findEdition(instance, reads, fromBatch ? 4 : 2)
    if (editionId !== undefined) progress.editionId = editionId
    else if (fromBatch) progress.batched = true
    return instance
  }

  let step = nextLaunchStep(progress, input.mintFirst)

  if (step === 'deploy') {
    progress.salt ??= freshSalt(input.factory)
    progress.predicted ??= (await readContract(wagmiConfig, {
      address: input.factory,
      abi: instanceAddressAbi,
      functionName: 'computeInstanceAddress',
      args: [progress.salt, input.account],
      chainId,
    }).catch(() => undefined)) as Address | undefined
    await foundAt(leftover === 'batch', leftover ? 3 : 1)
    // Found, or not there: sending again with the same salt can only ever make the one collection.
    progress.asking = undefined
    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (step === 'deploy' || step === 'wait-batch') {
    let sent: Awaited<ReturnType<typeof waitForBatch>> | undefined
    try {
      if (progress.batchId) sent = await waitForBatch(progress.batchId)
      else {
        const salt = progress.salt ?? freshSalt(input.factory)
        progress.salt = salt
        const create = createCall(input, salt)
        const { predicted } = progress
        sent =
          (predicted &&
            (await tryBatch([create, { address: predicted, ...editionCall }], {
              account: input.account,
              chainId,
              onAsk: () => {
                progress.asking = 'batch'
              },
              onSent: (id) => {
                progress.batchId = id
                progress.asking = undefined
              },
            }))) ||
          undefined
        if (!sent) {
          const { request } = await simulateContract(wagmiConfig, {
            account: input.account,
            chainId,
            ...create,
          } as never)
          progress.asking = 'deploy'
          progress.deployHash = (await writeContract(wagmiConfig, request as never)) as Hash
          progress.asking = undefined
        }
      }
    } catch (e) {
      progress.asking = undefined
      if (!isBatchForgotten(e)) {
        // Only the wallet saying the batch failed frees it. A wait that ran out keeps it, to be waited on again.
        if (!isUnconfirmed(e)) progress.batchId = undefined
        throw e
      }

      // The wallet lost the id, so waiting on it would never end. The chain says whether the batch landed.
      progress.batchId = undefined
      if (!(await foundAt(true, 4))) {
        throw new Error(
          'Your wallet no longer knows that batch, and nothing is at the new collection’s address yet. Try again to send it again: it can only ever make the one collection.'
        )
      }
    }

    if (sent) {
      // The batch is all or nothing, so the collection and its edition are both there. Some wallets hand back
      // receipts without every log: then they are read from the chain, and the batch is kept until they are.
      const logs = sent.receipts.flatMap((r) => r.logs ?? []) as never
      const logged = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs })[0]?.args.instance
      const instance = deployed(await batchLanded(progress, logged, reads))
      const added = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs })[0]
      await batchEdition(progress, instance, added?.args.editionId, reads)
    }

    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (step === 'wait-deploy' && progress.deployHash) {
    const receipt = await waitFor(
      chainId,
      progress.deployHash,
      () => {
        progress.deployHash = undefined
      },
      'The deploy transaction failed on the network. Nothing was created. You only paid the network fee.'
    )
    const logged = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })[0]?.args
      .instance
    const instance = logged ?? (await findInstance(progress, reads))
    // The hash stays until the collection is known, so a retry reads it again rather than deploying again.
    if (!instance)
      throw new Error(
        'Deployed, but the new collection address could not be read yet. Try again in a minute, or check the explorer.'
      )
    deployed(instance)
    step = nextLaunchStep(progress, input.mintFirst)
  }

  const { instance } = progress
  if (!instance)
    throw new Error('Deployed, but could not find the new collection address in the receipt. Check the explorer.')

  if (step === 'find-edition') {
    await batchEdition(progress, instance, undefined, reads)
    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (step === 'add-edition') {
    // A new collection's only edition: if one is there already (a send that was never heard back from), it is the one.
    const already = await findEdition(instance, reads, leftover === 'edition' ? 3 : 1)
    if (already !== undefined) {
      progress.editionId = already
      progress.asking = undefined
    } else {
      const edition = await simulateContract(wagmiConfig, {
        account: input.account,
        chainId,
        address: instance,
        ...editionCall,
      })
      progress.asking = 'edition'
      try {
        progress.editionHash = await writeContract(wagmiConfig, edition.request)
      } finally {
        progress.asking = undefined
      }
    }

    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (step === 'wait-edition' && progress.editionHash) {
    const receipt = await waitFor(
      chainId,
      progress.editionHash,
      () => {
        progress.editionHash = undefined
      },
      `The collection is live at ${instance}, but adding the edition failed. Try again to add it.`
    )
    const added = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs: receipt.logs })[0]
    // A new collection's only edition. Read it back if the log is missing, rather than guess, and keep the hash
    // until it is found: the edition is there, so it is never added a second time.
    const editionId = added ? added.args.editionId : await findEdition(instance, reads)
    if (editionId === undefined) {
      throw new Error(
        `The edition was added to ${instance}, but it could not be read back yet. Try again in a minute: it sends nothing new.`
      )
    }

    progress.editionId = editionId
    progress.editionHash = undefined
    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (progress.editionId == null) {
    // Nothing found where an edition should be: say so instead of quietly skipping the first copy.
    throw new Error(`The collection is live at ${instance}, but no edition was found on it. Check the explorer.`)
  }

  const { editionId } = progress

  if (step === 'mint' && leftover === 'mint') {
    // The mint prompt was open when the app went away. If the copy is in the wallet, it went through.
    const held = (await readContract(wagmiConfig, {
      address: instance,
      abi: balanceAbi,
      functionName: 'balanceOf',
      args: [input.account, editionId],
      chainId,
    }).catch(() => undefined)) as bigint | undefined
    if (held === undefined) throw new UnconfirmedError()
    progress.asking = undefined
    if (held > 0n) {
      progress.minted = true
      step = 'done'
    }
  }

  if (step === 'mint') {
    const mint = await simulateContract(wagmiConfig, {
      account: input.account,
      chainId,
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'mint',
      args: [editionId, 1n, zeroHash, '', input.priceWei],
      value: input.priceWei,
    })
    progress.asking = 'mint'
    try {
      progress.mintHash = (await writeContract(wagmiConfig, mint.request)) as Hash
    } finally {
      progress.asking = undefined
    }

    step = 'wait-mint'
  }

  if (step === 'wait-mint' && progress.mintHash) {
    await waitFor(
      chainId,
      progress.mintHash,
      () => {
        progress.mintHash = undefined
      },
      'The edition is live, but minting the first copy failed. Try again, or mint it from Music drops.'
    )
    progress.minted = true
    progress.mintHash = undefined
  }

  return { instance, editionId, minted: !!progress.minted }
}

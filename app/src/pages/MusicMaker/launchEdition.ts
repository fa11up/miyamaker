import { getPublicClient, readContract, simulateContract, writeContract } from '@wagmi/core'
import type { Address, Hash, TransactionReceipt } from 'viem'
import { parseEventLogs, zeroAddress, zeroHash } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { erc1155FactoryAbi, erc1155InstanceAbi } from '@/music/abi'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { isUnconfirmed, tryBatch, UnconfirmedError, waitForBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'

import { type LaunchProgress, nextLaunchStep } from './mintPlan'

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

function createCall(
  input: Pick<EditionLaunch, 'account' | 'factory' | 'vault' | 'name' | 'metadataURI' | 'alignmentBps'>
) {
  const salt = makeSalt(input.factory, crypto.getRandomValues(new Uint8Array(11)))
  return {
    salt,
    call: {
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
    },
  }
}

/** Dry-runs the create call with a stand-in metadata link, so a problem shows before any upload is paid for. */
export async function checkLaunch(
  input: Pick<EditionLaunch, 'account' | 'chainId' | 'factory' | 'vault' | 'name' | 'alignmentBps'>
) {
  const { call } = createCall({ ...input, metadataURI: 'ar://placeholder-metadata' })
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
 * timeout carries on from the deployed collection, and never sends again something that is still out.
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

  const deployed = (instance: Address | undefined) => {
    if (!instance)
      throw new Error('Deployed, but could not find the new collection address in the receipt. Check the explorer.')
    progress.instance = instance
    addKnownCollection(chainId, instance)
    onDeployed?.(instance)
    return instance
  }

  /** A batch that landed without an EditionAdded log in what the wallet gave back: read what the collection has. */
  const editionOnChain = async (instance: Address) => {
    const ids = (await readContract(wagmiConfig, {
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'getAllEditionIds',
      chainId,
    }).catch(() => undefined)) as readonly bigint[] | undefined
    if (ids === undefined) {
      throw new Error(
        `The collection is live at ${instance}, but its edition could not be read. Check the explorer before trying again.`
      )
    }

    return ids[0]
  }

  let step = nextLaunchStep(progress, input.mintFirst)

  if (step === 'deploy' || step === 'wait-batch') {
    let sent: Awaited<ReturnType<typeof waitForBatch>> | undefined
    try {
      if (progress.batchId) sent = await waitForBatch(progress.batchId)
      else {
        const { salt, call: create } = createCall(input)
        const predicted = await readContract(wagmiConfig, {
          address: input.factory,
          abi: instanceAddressAbi,
          functionName: 'computeInstanceAddress',
          args: [salt, input.account],
          chainId,
        }).catch(() => undefined)
        sent =
          (predicted &&
            (await tryBatch([create, { address: predicted, ...editionCall }], {
              account: input.account,
              chainId,
              onSent: (id) => {
                progress.batchId = id
              },
            }))) ||
          undefined
        if (!sent) {
          const { request } = await simulateContract(wagmiConfig, {
            account: input.account,
            chainId,
            ...create,
          } as never)
          progress.deployHash = (await writeContract(wagmiConfig, request as never)) as Hash
        }
      }
    } catch (e) {
      // Only the wallet saying the batch failed frees it. A wait that ran out keeps it, to be waited on again.
      if (!isUnconfirmed(e)) progress.batchId = undefined
      throw e
    }

    if (sent) {
      progress.batchId = undefined
      const logs = sent.receipts.flatMap((r) => r.logs ?? []) as never
      const instance = deployed(
        parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs })[0]?.args.instance
      )
      const added = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs })[0]
      // The batch is all or nothing, so the edition is there. Some wallets hand back receipts without every log.
      progress.editionId = added ? added.args.editionId : await editionOnChain(instance)
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
    deployed(
      parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })[0]?.args.instance
    )
    step = nextLaunchStep(progress, input.mintFirst)
  }

  const { instance } = progress
  if (!instance)
    throw new Error('Deployed, but could not find the new collection address in the receipt. Check the explorer.')

  if (step === 'add-edition') {
    const edition = await simulateContract(wagmiConfig, {
      account: input.account,
      chainId,
      address: instance,
      ...editionCall,
    })
    progress.editionHash = await writeContract(wagmiConfig, edition.request)
    step = 'wait-edition'
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
    // A new collection's only edition. Read it back if the log is missing, rather than guess.
    progress.editionId = added ? added.args.editionId : await editionOnChain(instance)
    progress.editionHash = undefined
    step = nextLaunchStep(progress, input.mintFirst)
  }

  if (progress.editionId == null) {
    // Nothing found where an edition should be: say so instead of quietly skipping the first copy.
    throw new Error(`The collection is live at ${instance}, but no edition was found on it. Try again to add it.`)
  }

  const { editionId } = progress

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
    progress.mintHash = (await writeContract(wagmiConfig, mint.request)) as Hash
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

import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import type { Address, Hash } from 'viem'
import { parseEventLogs, zeroAddress, zeroHash } from 'viem'

import { wagmiConfig } from '@/config/wagmi'
import { erc1155FactoryAbi, erc1155InstanceAbi } from '@/music/abi'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { tryBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'

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

/** Deploy an ERC-1155 music edition and optionally mint the first copy to the creator. */
export async function launchEdition(input: EditionLaunch): Promise<EditionResult> {
  const chainId = input.chainId as ChainId
  const salt = makeSalt(input.factory, crypto.getRandomValues(new Uint8Array(11)))
  const create = {
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

  let instance: Address | undefined
  let editionId: bigint | undefined

  const predicted = await readContract(wagmiConfig, {
    address: input.factory,
    abi: instanceAddressAbi,
    functionName: 'computeInstanceAddress',
    args: [salt, input.account],
    chainId,
  }).catch(() => undefined)

  const sent =
    predicted &&
    (await tryBatch([create, { address: predicted, ...editionCall }], { account: input.account, chainId }))

  if (sent) {
    const logs = sent.receipts.flatMap((r) => r.logs ?? []) as never
    instance = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs })[0]?.args.instance
    editionId = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs })[0]?.args.editionId
  } else {
    const { request } = await simulateContract(wagmiConfig, { account: input.account, chainId, ...create } as never)
    const hash = await writeContract(wagmiConfig, request as never)
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
    if (receipt.status !== 'success') throw new Error('The deploy transaction reverted.')
    instance = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })[0]?.args
      .instance
    if (!instance) throw new Error('Deployed, but could not find the new collection address in the receipt.')
    const edition = await simulateContract(wagmiConfig, {
      account: input.account,
      chainId,
      address: instance,
      ...editionCall,
    })
    const editionHash = await writeContract(wagmiConfig, edition.request)
    const editionReceipt = await waitForTransactionReceipt(wagmiConfig, { hash: editionHash, chainId })
    if (editionReceipt.status !== 'success') throw new Error('The edition transaction reverted.')
    editionId = parseEventLogs({
      abi: erc1155InstanceAbi,
      eventName: 'EditionAdded',
      logs: editionReceipt.logs,
    })[0]?.args.editionId
  }

  if (!instance) throw new Error('Deployed, but could not find the new collection address in the receipt.')
  addKnownCollection(chainId, instance)

  let minted = false
  if (input.mintFirst && editionId != null) {
    const mint = await simulateContract(wagmiConfig, {
      account: input.account,
      chainId,
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'mint',
      args: [editionId, 1n, zeroHash, '', input.priceWei],
      value: input.priceWei,
    })
    const hash = (await writeContract(wagmiConfig, mint.request)) as Hash
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
    if (receipt.status !== 'success') throw new Error('The edition is live, but minting the first copy reverted.')
    minted = true
  }

  return { instance, editionId, minted }
}

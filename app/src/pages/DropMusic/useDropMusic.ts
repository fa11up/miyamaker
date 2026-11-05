import { simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { useCallback, useState } from 'react'
import type { Address, Hash } from 'viem'
import { BaseError, parseEventLogs, zeroAddress } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { erc1155FactoryAbi, erc1155InstanceAbi, miyaRegistryAbi } from '@/music/abi'
import type { MusicMetadata } from '@/music/audio'
import { musicConfig } from '@/music/config'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

type ChainId = (typeof wagmiConfig.chains)[number]['id']

export type StepId = 'audio' | 'cover' | 'metadata' | 'deploy' | 'edition'
export type StepState = 'idle' | 'active' | 'done' | 'error' | 'skipped'
export const STEPS: { id: StepId; label: string }[] = [
  { id: 'audio', label: 'Upload audio to Arweave (Irys)' },
  { id: 'cover', label: 'Upload cover art' },
  { id: 'metadata', label: 'Upload token metadata' },
  { id: 'deploy', label: 'Deploy ERC-1155 edition collection' },
  { id: 'edition', label: 'Add the track as edition #1' },
]

/** Registry rules for the connected chain: alignment minimum, protocol fee, and whether the vault is valid. */
export function useMusicChain() {
  const { chainId } = useAccount()
  const cfg = musicConfig(chainId)
  const onChain = chainId === cfg.chainId
  const deployed = !!cfg.factory && !!cfg.vault
  const registry = useReadContract({
    address: cfg.factory,
    abi: erc1155FactoryAbi,
    functionName: 'registry',
    chainId: cfg.chainId as ChainId,
    query: { enabled: !!cfg.factory },
  })
  const reg = registry.data as Address | undefined
  const rules = useReadContracts({
    contracts: [
      { address: reg, abi: miyaRegistryAbi, functionName: 'minAlignmentBps', chainId: cfg.chainId as ChainId },
      { address: reg, abi: miyaRegistryAbi, functionName: 'protocolFeeBps', chainId: cfg.chainId as ChainId },
      {
        address: reg,
        abi: miyaRegistryAbi,
        functionName: 'isVault',
        args: [cfg.vault || zeroAddress],
        chainId: cfg.chainId as ChainId,
      },
    ],
    query: { enabled: !!reg },
  })
  const [minBps, feeBps, vaultOk] = rules.data || []
  return {
    cfg,
    onChain,
    deployed,
    wrongChain: !!chainId && !onChain,
    ready: !!cfg.factory && !!cfg.vault && onChain,
    minAlignmentBps: (minBps?.result as number | undefined) ?? 1000,
    protocolFeeBps: (feeBps?.result as number | undefined) ?? 0,
    vaultRegistered: vaultOk?.result as boolean | undefined,
    loading: registry.isLoading || rules.isLoading,
  }
}

export function describeTxError(error: unknown): string {
  if (!error) return ''
  const base = error instanceof BaseError ? error : undefined
  const msg = base?.shortMessage || (error as Error).message || 'Something went wrong.'
  if (/reject|denied|cancel/i.test(base?.details || msg)) return 'Cancelled in wallet.'
  return msg
}

export type Uploaded = { audio?: string; cover?: string; metadata?: string }
export type Launched = { instance?: Address; editionId?: bigint; deployHash?: Hash; editionHash?: Hash }

/**
 * The launch pipeline. Every finished step is kept, so a failed or cancelled step can be retried without
 * re-uploading or redeploying.
 */
export function useDropMusic() {
  const { address, chain } = useAccount()
  const [steps, setSteps] = useState<Record<StepId, StepState>>({
    audio: 'idle',
    cover: 'idle',
    metadata: 'idle',
    deploy: 'idle',
    edition: 'idle',
  })
  const [uploaded, setUploaded] = useState<Uploaded>({})
  const [launched, setLaunched] = useState<Launched>({})
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const mark = (id: StepId, state: StepState) => setSteps((s) => ({ ...s, [id]: state }))

  const upload = async (id: StepId, file: File): Promise<string> => {
    mark(id, 'active')
    const tx = await fundAndUpload(
      file,
      [
        { name: 'Content-Type', value: file.type || 'application/octet-stream' },
        { name: 'application-id', value: 'MiyaOS' },
        { name: 'miya-kind', value: `music-${id}` },
      ],
      undefined,
      getIrysToken(chain?.id || 1),
      chain
    ).catch((e) => {
      mark(id, 'error')
      throw e
    })

    mark(id, 'done')
    return `ar://${tx}`
  }

  const run = useCallback(
    async (input: {
      audioFile?: File
      audioUri?: string
      coverFile?: File
      coverUri?: string
      buildMetadata: (audio: string, cover: string) => MusicMetadata | null
      collectionName: string
      title: string
      priceWei: bigint
      supply: bigint
      model: number
      alignmentBps: number
    }) => {
      const cfg = musicConfig(chain?.id)
      setError('')
      setRunning(true)
      try {
        if (!address) throw new Error('Connect a wallet first.')
        let { audio, cover, metadata } = uploaded

        if (!audio) {
          if (input.audioUri) {
            audio = input.audioUri
            mark('audio', 'skipped')
          } else if (input.audioFile) audio = await upload('audio', input.audioFile)
          else throw new Error('Add an audio file.')
          setUploaded((u) => ({ ...u, audio }))
        }

        if (!cover) {
          if (input.coverUri) {
            cover = input.coverUri
            mark('cover', 'skipped')
          } else if (input.coverFile) cover = await upload('cover', input.coverFile)
          else throw new Error('Add cover art.')
          setUploaded((u) => ({ ...u, cover }))
        }

        if (!metadata) {
          const json = input.buildMetadata(audio, cover)
          if (!json) throw new Error('Fix the highlighted fields first.')
          const file = new File([JSON.stringify(json, null, 2)], 'metadata.json', { type: 'application/json' })
          metadata = await upload('metadata', file)
          setUploaded((u) => ({ ...u, metadata }))
        }

        if (!cfg.factory || !cfg.vault || chain?.id !== cfg.chainId) {
          throw new Error('Releasing opens soon. Your uploads are saved.')
        }

        const chainId = cfg.chainId as ChainId

        let { instance } = launched
        if (!instance) {
          mark('deploy', 'active')
          const salt = makeSalt(cfg.factory, crypto.getRandomValues(new Uint8Array(11)))
          const { request } = await simulateContract(wagmiConfig, {
            account: address,
            chainId,
            address: cfg.factory,
            abi: erc1155FactoryAbi,
            functionName: 'createInstance',
            args: [
              salt,
              {
                name: input.collectionName,
                metadataURI: metadata,
                creator: address,
                vault: cfg.vault,
                alignmentBps: input.alignmentBps,
                styleUri: '',
                gatingModule: zeroAddress,
                freeMint: { allocation: 0n, scope: GATING_SCOPE_BOTH },
              },
            ],
          })
          const hash = await writeContract(wagmiConfig, request)
          setLaunched((l) => ({ ...l, deployHash: hash }))
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
          if (receipt.status !== 'success') throw new Error('The deploy transaction reverted.')
          const [created] = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })
          instance = created?.args.instance
          if (!instance) throw new Error('Deployed, but could not find the new collection address in the receipt.')
          addKnownCollection(chainId, instance)
          setLaunched((l) => ({ ...l, instance }))
          mark('deploy', 'done')
        }

        mark('edition', 'active')
        const { request } = await simulateContract(wagmiConfig, {
          account: address,
          chainId,
          address: instance,
          abi: erc1155InstanceAbi,
          functionName: 'addEdition',
          args: editionArgs({
            title: input.title,
            priceWei: input.priceWei,
            supply: input.supply,
            model: input.model,
            metadataURI: metadata,
          }),
        })
        const hash = await writeContract(wagmiConfig, request)
        setLaunched((l) => ({ ...l, editionHash: hash }))
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
        if (receipt.status !== 'success') throw new Error('The edition transaction reverted.')
        const [added] = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs: receipt.logs })
        setLaunched((l) => ({ ...l, editionId: added?.args.editionId ?? 1n }))
        mark('edition', 'done')
      } catch (e) {
        setSteps((s) => {
          const next = { ...s }
          ;(Object.keys(next) as StepId[]).forEach((k) => {
            if (next[k] === 'active') next[k] = 'error'
          })
          return next
        })
        setError(describeTxError(e))
      } finally {
        setRunning(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, chain, uploaded, launched]
  )

  const reset = () => {
    setSteps({ audio: 'idle', cover: 'idle', metadata: 'idle', deploy: 'idle', edition: 'idle' })
    setUploaded({})
    setLaunched({})
    setError('')
  }

  /** Inputs changed after an upload: drop the derived uploads so they are redone. */
  const invalidate = (what: 'audio' | 'cover' | 'metadata') => {
    if (launched.instance) return
    setUploaded((u) => {
      if (what === 'audio') return { cover: u.cover }
      if (what === 'cover') return { audio: u.audio }
      return { audio: u.audio, cover: u.cover }
    })
    setSteps((s) => ({
      ...s,
      ...(what === 'audio' ? { audio: 'idle' } : {}),
      ...(what === 'cover' ? { cover: 'idle' } : {}),
      metadata: 'idle',
    }))
  }

  return { steps, uploaded, launched, error, running, run, reset, invalidate }
}

import { getAccount, readContract, simulateContract, writeContract } from '@wagmi/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hash } from 'viem'
import { parseEventLogs, zeroAddress } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'

import { TxEndError } from '@/miyamints/txOutcome'
import { latestOnly } from '@/pages/Swap/swapLogic'
import { waitForTx } from '@/miyamints/useTxOutcome'
import { wagmiConfig } from '@/config/wagmi'
import { plainTxError, TX_CHECK_WORDS } from '@/miyamints/errors'
import { erc1155FactoryAbi, erc1155InstanceAbi, miyaRegistryAbi } from '@/music/abi'
import type { MusicMetadata } from '@/music/audio'
import { musicConfig } from '@/music/config'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { tryBatch, waitForBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

export type ChainId = (typeof wagmiConfig.chains)[number]['id']

export type StepId = 'audio' | 'cover' | 'metadata' | 'deploy' | 'edition'
export type StepState = 'idle' | 'active' | 'done' | 'error' | 'skipped'
export const STEPS: { id: StepId; label: string }[] = [
  { id: 'audio', label: 'Store your track' },
  { id: 'cover', label: 'Store your cover' },
  { id: 'metadata', label: 'Store the track details' },
  { id: 'deploy', label: 'Create your collection' },
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
    protocolFeeBps: (feeBps?.result as number | undefined) ?? 100,
    vaultRegistered: vaultOk?.result as boolean | undefined,
    loading: registry.isLoading || rules.isLoading,
    /** The minimum vault share and the fee were read from the registry, not the fallbacks above. */
    rulesKnown: minBps?.status === 'success' && feeBps?.status === 'success',
  }
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
  /** A create-and-add-track batch the wallet has, until it says how it ended. */
  const [sentBatch, setSentBatch] = useState<{ id: string; predicted: Address }>()
  /** Uploads under way, so the station and a release never pay for the same file at once. */
  const uploading = useRef(new Map<string, Promise<string>>())
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  /** What the current upload is waiting for, in the storage service's own steps. */
  const [note, setNote] = useState('')
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; message?: string }>({
    state: 'idle',
  })

  const checks = useRef(latestOnly()).current

  // Gone from the screen: no more wallet prompts, as SweepReview. Reset on mount for React's double effects.
  const left = useRef(false)
  useEffect(() => {
    left.current = false
    return () => {
      left.current = true
    }
  }, [])
  const stopIfClosed = () => {
    if (left.current) throw new Error('The window was closed, so this stopped.')
  }
  // fundAndUpload says what it is about to ask before each prompt, so throwing here stops it between them.
  const uploadNote = (words: string) => {
    stopIfClosed()
    setNote(words)
  }

  const mark = (id: StepId, state: StepState) => setSteps((s) => ({ ...s, [id]: state }))

  const upload = (id: StepId, file: File): Promise<string> => {
    stopIfClosed()
    const key = `${id}:${file.name}:${file.size}:${file.lastModified}`
    const under = uploading.current.get(key)
    if (under) return under
    const started = uploadOnce(id, file).finally(() => uploading.current.delete(key))
    uploading.current.set(key, started)
    return started
  }

  const uploadOnce = async (id: StepId, file: File): Promise<string> => {
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
      chain,
      uploadNote,
    )
      .catch((e) => {
        mark(id, 'error')
        throw e
      })
      .finally(() => setNote(''))

    mark(id, 'done')
    return `ar://${tx}`
  }

  /** The create call. Its address depends on the salt, so the dry run and the real thing each take their own. */
  const createCall = (
    factory: Address,
    vault: Address,
    creator: Address,
    c: { name: string; bps: number; uri: string },
  ) => {
    const salt = makeSalt(factory, crypto.getRandomValues(new Uint8Array(11)))
    return {
      salt,
      call: {
        address: factory,
        abi: erc1155FactoryAbi,
        functionName: 'createInstance' as const,
        args: [
          salt,
          {
            name: c.name,
            metadataURI: c.uri,
            creator,
            vault,
            alignmentBps: c.bps,
            styleUri: '',
            gatingModule: zeroAddress,
            freeMint: { allocation: 0n, scope: GATING_SCOPE_BOTH },
          },
        ],
      },
    }
  }

  /** Dry-run the create call, so a problem shows before any money goes to storage. Throws when it would fail. */
  const dryRun = async (name: string, bps: number) => {
    const cfg = musicConfig(chain?.id)
    if (!address || !cfg.factory || !cfg.vault) return
    const { call } = createCall(cfg.factory, cfg.vault, address, { name, bps, uri: 'ar://placeholder-metadata' })
    await simulateContract(wagmiConfig, { account: address, chainId: cfg.chainId as ChainId, ...call } as never)
  }

  const simulate = useCallback(
    async (name: string, bps: number) => {
      // Only the newest check counts: an older one landing late would speak for settings no longer on the screen.
      const ticket = checks.begin()
      setCheck({ state: 'checking' })
      try {
        await dryRun(name, bps)
        if (checks.isCurrent(ticket)) setCheck({ state: 'ok' })
      } catch (e) {
        if (checks.isCurrent(ticket)) setCheck({ state: 'error', message: plainTxError(e, TX_CHECK_WORDS) })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, chain],
  )

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
      rate: bigint
      alignmentBps: number
    }) => {
      const cfg = musicConfig(chain?.id)
      setError('')
      setRunning(true)
      try {
        if (!address) throw new Error('Connect a wallet first.')
        // Before any upload: storage is paid for good, whatever happens to the release after it.
        if (!cfg.factory || !cfg.vault || chain?.id !== cfg.chainId) {
          throw new Error('Releasing opens soon. Nothing was charged.')
        }

        if (!launched.instance) {
          await dryRun(input.collectionName, input.alignmentBps).catch((e) => {
            throw new Error(plainTxError(e, TX_CHECK_WORDS))
          })
        }

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

        const chainId = cfg.chainId as ChainId
        // Paying for storage takes the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
        if (getAccount(wagmiConfig).chainId !== chainId) {
          throw new Error('Your wallet is on another network. Switch it back, then try again. Your uploads are kept.')
        }

        let { instance } = launched
        const editionCall = {
          abi: erc1155InstanceAbi,
          functionName: 'addEdition' as const,
          args: editionArgs({
            title: input.title,
            priceWei: input.priceWei,
            supply: input.supply,
            model: input.model,
            metadataURI: metadata,
            priceIncreaseRate: input.rate,
          }),
        }

        if (!instance) {
          mark('deploy', 'active')
          const { salt, call: create } = createCall(cfg.factory, cfg.vault, address, {
            name: input.collectionName,
            bps: input.alignmentBps,
            uri: metadata,
          })
          // Create the collection and add the edition as one signature: its address is fixed by the salt, so the
          // second call can name it in advance. If anything is off, the whole batch reverts.
          const predicted =
            sentBatch?.predicted ??
            (await readContract(wagmiConfig, {
              address: cfg.factory,
              abi: instanceAddressAbi,
              functionName: 'computeInstanceAddress',
              args: [salt, address],
              chainId,
            }).catch(() => undefined))
          stopIfClosed()
          // A batch already out is waited on, never sent again. Only the wallet saying it failed frees it.
          const sent = await Promise.resolve(
            sentBatch
              ? waitForBatch(sentBatch.id)
              : predicted &&
                  tryBatch([create, { address: predicted, ...editionCall }], {
                    account: address,
                    chainId,
                    onSent: (id) => {
                      setSentBatch({ id, predicted })
                      mark('edition', 'active')
                    },
                  }),
          ).catch((e) => {
            if (!(e as TxEndError).unconfirmed) setSentBatch(undefined)
            throw e
          })
          if (sent) {
            setSentBatch(undefined)
            const logs = sent.receipts.flatMap((r) => r.logs ?? []) as never
            instance = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs })[0]?.args.instance
            if (!instance) throw new Error('Created, but the new address was not in the receipt. Check the explorer.')
            const [added] = parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs })
            addKnownCollection(chainId, instance)
            setLaunched((l) => ({ ...l, instance, deployHash: sent.hash }))
            mark('deploy', 'done')
            if (added) {
              setLaunched((l) => ({ ...l, editionHash: sent.hash, editionId: added.args.editionId }))
              mark('edition', 'done')
              return
            }
          } else {
            // One already sent is waited on, not sent again: a failed lookup says nothing about how it ended.
            let hash = launched.deployHash
            if (!hash) {
              const { request } = await simulateContract(wagmiConfig, { account: address, chainId, ...create } as never)
              stopIfClosed()
              const sentHash: Hash = await writeContract(wagmiConfig, request as never)
              hash = sentHash
              setLaunched((l) => ({ ...l, deployHash: sentHash }))
            }

            const receipt = await waitForTx(chainId, hash).catch((e) => {
              if ((e as TxEndError).reverted || (e as TxEndError).cancelled) {
                setLaunched((l) => ({ ...l, deployHash: undefined }))
              }

              throw e
            })

            const [created] = parseEventLogs({
              abi: erc1155FactoryAbi,
              eventName: 'InstanceCreated',
              logs: receipt.logs,
            })
            instance = created?.args.instance
            if (!instance) throw new Error('Created, but the new address was not in the receipt. Check the explorer.')
            addKnownCollection(chainId, instance)
            setLaunched((l) => ({ ...l, instance }))
            mark('deploy', 'done')
          }
        }

        mark('edition', 'active')
        let editionHash = launched.editionHash
        if (!editionHash) {
          const { request } = await simulateContract(wagmiConfig, {
            account: address,
            chainId,
            address: instance,
            ...editionCall,
          })
          stopIfClosed()
          const sentHash = await writeContract(wagmiConfig, request)
          editionHash = sentHash
          setLaunched((l) => ({ ...l, editionHash: sentHash }))
        }

        const receipt = await waitForTx(chainId, editionHash).catch((e) => {
          if ((e as TxEndError).reverted || (e as TxEndError).cancelled) {
            setLaunched((l) => ({ ...l, editionHash: undefined }))
          }

          throw e
        })

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
        setError(e instanceof TxEndError ? e.message : plainTxError(e))
      } finally {
        setRunning(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, chain, uploaded, launched, sentBatch],
  )

  /** Store one file outside a release (the community station). The release reuses it, so nothing is paid twice. */
  const store = async (id: 'audio' | 'cover', file: File) => {
    const known = uploaded[id]
    if (known) return known
    // A failure here is told where it was asked for, on the station. It isn't a release step that failed.
    const uri = await upload(id, file).catch((e) => {
      mark(id, 'idle')
      throw e
    })
    setUploaded((u) => ({ ...u, [id]: uri }))
    return uri
  }

  const reset = () => {
    setSteps({ audio: 'idle', cover: 'idle', metadata: 'idle', deploy: 'idle', edition: 'idle' })
    setUploaded({})
    setLaunched({})
    setSentBatch(undefined)
    setError('')
    checks.cancel()
    setCheck({ state: 'idle' })
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

  /** Something has gone to the chain, so what it was built from can't change any more. */
  const committed = !!launched.instance || !!launched.deployHash || !!sentBatch

  return { committed, steps, uploaded, launched, error, running, note, check, simulate, run, store, reset, invalidate }
}

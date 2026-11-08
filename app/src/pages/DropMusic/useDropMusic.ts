import { getAccount, simulateContract } from '@wagmi/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hash, Log } from 'viem'
import { parseEventLogs, zeroAddress } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'

import { TxEndError } from '@/miyamints/txOutcome'
import { latestOnly } from '@/pages/Swap/swapLogic'
import { wagmiConfig } from '@/config/wagmi'
import { plainTxError, TX_CHECK_WORDS } from '@/miyamints/errors'
import { erc1155FactoryAbi, erc1155InstanceAbi, miyaRegistryAbi } from '@/music/abi'
import type { MusicMetadata } from '@/music/audio'
import { musicConfig } from '@/music/config'
import { editionArgs, GATING_SCOPE_BOTH, makeSalt, MUSIC_TOKENS } from '@/music/drop'
import { addKnownCollection } from '@/music/known'
import { findFirstEdition, launchOnChain, SaidError } from '@/pages/Launch/launchChain'
import type { SavedLaunch } from '@/pages/Launch/resume'
import {
  browserStore,
  bumpLaunchRound,
  clearLaunch,
  contentKey,
  discardChoice,
  draftId,
  draftSalt,
  findLaunches,
  fundingPlan,
  knownUpload,
  launchCommitted,
  launchRound,
  launchUnsettled,
  loadLaunch,
  rememberUpload,
  saveLaunch,
} from '@/pages/Launch/resume'
import { FREE_BYTES, fundAndUpload, fundStorage } from '@/utils/fundAndUpload'
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
    // Only what the registry said: a guess shown as fact could promise a share or a fee the contract won't take.
    minAlignmentBps: minBps?.result as number | undefined,
    protocolFeeBps: feeBps?.result as number | undefined,
    vaultRegistered: vaultOk?.result as boolean | undefined,
    loading: registry.isLoading || rules.isLoading,
    /** The registry could not be read: the share rules are unknown, so nothing can be released yet. */
    rulesFailed:
      !!cfg.factory &&
      !registry.isLoading &&
      !rules.isLoading &&
      (registry.isError || rules.isError || (!!rules.data && (minBps?.result === undefined || feeBps?.result === undefined))),
  }
}

export type Uploaded = { audio?: string; cover?: string; metadata?: string }
export type Launched = { instance?: Address; editionId?: bigint; deployHash?: Hash; editionHash?: Hash }

/** What a saved release is built from, so a reload can finish it without the form or the files. */
export type MusicSaved = {
  factory: Address
  vault: Address
  collectionName: string
  title: string
  priceWei: bigint
  supply: bigint
  model: number
  alignmentBps: number
  audioKey?: string
  coverKey?: string
}

export type ReleaseInput = {
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
}

const IDLE: Record<StepId, StepState> = { audio: 'idle', cover: 'idle', metadata: 'idle', deploy: 'idle', edition: 'idle' }

/** An ar:// link as long as a real one, so the metadata priced before upload weighs what the real one will. */
const AR_STANDIN = `ar://${'x'.repeat(43)}`

const NOT_SAVED_WORDS =
  "This browser would not keep the release's progress, so nothing more was sent. Allow this site to store data, then try again."

function stepsOf(saved: SavedLaunch<MusicSaved>): Record<StepId, StepState> {
  const p = saved.progress
  return {
    audio: saved.uploads.audio ? 'done' : 'idle',
    cover: saved.uploads.cover ? 'done' : 'idle',
    metadata: saved.uploads.metadata ? 'done' : 'idle',
    deploy: p.instance ? 'done' : p.batchId || p.deployHash || p.asking ? 'error' : 'idle',
    edition: p.firstDone ? 'done' : p.firstHash ? 'error' : 'idle',
  }
}

/**
 * The launch pipeline. Every step is saved in the browser as it lands (Launch/resume.ts), so a failed or cancelled
 * step, or a reload, carries on without re-uploading, redeploying or adding the edition twice.
 */
export function useDropMusic() {
  const { address, chain } = useAccount()
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE)
  const [uploaded, setUploaded] = useState<Uploaded>({})
  /** The release being worked on, saved after every change. Mutated in place, so `bump` re-renders. */
  const record = useRef<SavedLaunch<MusicSaved>>()
  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)
  /** A release from an earlier visit with something on the chain, offered on the screen. */
  const [saved, setSaved] = useState<SavedLaunch<MusicSaved>>()
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

  // A release with something on the chain, left on this wallet and chain, is offered again. One under another wallet
  // or chain is not this one's to carry on. Ones that never reached the chain need nothing: their files are kept by
  // content, so picking the same files again pays for nothing twice.
  const findSaved = () =>
    address && chain
      ? findLaunches<MusicSaved>(browserStore(), 'music', address, chain.id).find((r) => launchCommitted(r.progress))
      : undefined
  useEffect(() => {
    const active = record.current
    if (active && (active.account.toLowerCase() !== address?.toLowerCase() || active.chainId !== chain?.id)) {
      record.current = undefined
      setSteps(IDLE)
      setUploaded({})
      setError('')
      bump()
    }
    setSaved(findSaved())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chain?.id])

  const mark = (id: StepId, state: StepState) => setSteps((s) => ({ ...s, [id]: state }))

  const adopt = (r: SavedLaunch<MusicSaved>) => {
    record.current = r
    setUploaded({ ...r.uploads })
    setSteps(stepsOf(r))
    setSaved((s) => (s?.draft === r.draft ? undefined : s))
    bump()
  }

  const save = () => {
    const r = record.current
    if (!r) return
    r.savedAt = Date.now()
    const ok = saveLaunch(browserStore(), r)
    bump()
    if (!ok) throw new SaidError(NOT_SAVED_WORDS)
  }

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
      uploadNote
    )
      .catch((e) => {
        mark(id, 'error')
        throw e
      })
      .finally(() => setNote(''))

    mark(id, 'done')
    return `ar://${tx}`
  }

  /** The create call. The dry run takes a random salt; the real one always the release's own. */
  const createCall = (
    factory: Address,
    vault: Address,
    creator: Address,
    c: { name: string; bps: number; uri: string },
    salt: `0x${string}` = makeSalt(factory, crypto.getRandomValues(new Uint8Array(11)))
  ) => ({
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
        acceptedTokens: MUSIC_TOKENS,
      },
    ] as const,
  })

  /** Dry-run the create call, so a problem shows before any money goes to storage. Throws when it would fail. */
  const dryRun = async (name: string, bps: number) => {
    const cfg = musicConfig(chain?.id)
    if (!address || !cfg.factory || !cfg.vault) return
    const call = createCall(cfg.factory, cfg.vault, address, { name, bps, uri: 'ar://placeholder-metadata' })
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
    [address, chain]
  )

  /** A file stored before, by its exact bytes: the link, or undefined. */
  const fromCache = (key: string | undefined) => (key ? knownUpload(browserStore(), key) : undefined)

  /**
   * Releases the track. Without `input` it carries on with the release on the screen (one from an earlier visit):
   * once anything may be on the chain, it carries on as saved, whatever the form says.
   */
  const run = useCallback(
    async (input?: ReleaseInput) => {
      const cfg = musicConfig(chain?.id)
      setError('')
      setRunning(true)
      try {
        if (!address) throw new Error('Connect a wallet first.')
        // Before any upload: storage is paid for good, whatever happens to the release after it.
        if (!cfg.factory || !cfg.vault || chain?.id !== cfg.chainId) {
          throw new Error('Releasing opens soon. Nothing was charged.')
        }
        const chainId = cfg.chainId as ChainId
        const store = browserStore()

        let r = record.current
        if (!r || !launchCommitted(r.progress)) {
          if (!input) throw new Error('Fill in the release first.')
          await dryRun(input.collectionName, input.alignmentBps).catch((e) => {
            throw new Error(plainTxError(e, TX_CHECK_WORDS))
          })
          const audioKey = input.audioFile ? await contentKey('audio', input.audioFile) : undefined
          const coverKey = input.coverFile ? await contentKey('cover', input.coverFile) : undefined
          const standIn = input.buildMetadata(AR_STANDIN, AR_STANDIN)
          if (!standIn) throw new Error('Fix the highlighted fields first.')
          const fields: MusicSaved = {
            factory: cfg.factory,
            vault: cfg.vault,
            collectionName: input.collectionName,
            title: input.title,
            priceWei: input.priceWei,
            supply: input.supply,
            model: input.model,
            alignmentBps: input.alignmentBps,
            audioKey,
            coverKey,
          }
          const draft = draftId({
            app: 'music',
            ...fields,
            audio: audioKey ?? input.audioUri,
            cover: coverKey ?? input.coverUri,
            metadata: standIn,
          })
          if (!r || r.draft !== draft) {
            // The old draft never reached the chain: its files are kept by content, nothing else needs keeping.
            if (r) clearLaunch(store, r)
            const round = launchRound(store, 'music', address, chainId, draft)
            r = loadLaunch<MusicSaved>(store, 'music', address, chainId, draft) ?? {
              app: 'music',
              account: address,
              chainId,
              draft,
              round,
              label: input.title,
              input: fields,
              uploads: { ...uploaded },
              // Fixed by the draft: a reload, or the same release sent again, can only ever make the one collection.
              progress: { salt: draftSalt(cfg.factory, address, chainId, 'music', draft, round) },
              savedAt: Date.now(),
            }
            adopt(r)
          }
          // Written before the first upload is paid for, so a reload finds it.
          save()

          const rec = r
          let audio = rec.uploads.audio || input.audioUri || fromCache(audioKey)
          let cover = rec.uploads.cover || input.coverUri || fromCache(coverKey)
          let metadata = rec.uploads.metadata
          if (!audio && !input.audioFile) throw new Error('Add an audio file.')
          if (!cover && !input.coverFile) throw new Error('Add cover art.')

          // Pay once for every file still to store: one Ethereum payment and one wait, before the first upload.
          const standInBytes = new Blob([JSON.stringify(standIn, null, 2)]).size
          const toPay = fundingPlan(
            [
              ...(input.audioFile ? [{ size: input.audioFile.size, stored: !!audio }] : []),
              ...(input.coverFile ? [{ size: input.coverFile.size, stored: !!cover }] : []),
              { size: standInBytes, stored: !!metadata },
            ],
            FREE_BYTES
          )
          if (toPay.length) {
            const firstUp: StepId = !audio ? 'audio' : !cover ? 'cover' : 'metadata'
            mark(firstUp, 'active')
            await fundStorage(toPay, undefined, getIrysToken(chain?.id || 1), chain, uploadNote)
              .catch((e) => {
                mark(firstUp, 'error')
                throw e
              })
              .finally(() => setNote(''))
          }

          if (!audio) {
            audio = await upload('audio', input.audioFile as File)
            if (audioKey) rememberUpload(store, audioKey, audio)
          } else mark('audio', input.audioUri && !rec.uploads.audio ? 'skipped' : 'done')
          rec.uploads.audio = audio
          setUploaded((u) => ({ ...u, audio }))
          save()

          if (!cover) {
            cover = await upload('cover', input.coverFile as File)
            if (coverKey) rememberUpload(store, coverKey, cover)
          } else mark('cover', input.coverUri && !rec.uploads.cover ? 'skipped' : 'done')
          rec.uploads.cover = cover
          setUploaded((u) => ({ ...u, cover }))
          save()

          if (!metadata) {
            const json = input.buildMetadata(audio, cover)
            if (!json) throw new Error('Fix the highlighted fields first.')
            const file = new File([JSON.stringify(json, null, 2)], 'metadata.json', { type: 'application/json' })
            metadata = await upload('metadata', file)
            rec.uploads.metadata = metadata
            setUploaded((u) => ({ ...u, metadata }))
            save()
          } else mark('metadata', 'done')
        }

        const rec = r
        const metadata = rec.uploads.metadata
        if (!metadata) throw new Error('Fix the highlighted fields first.')
        const f = rec.input

        // Paying for storage takes the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
        if (getAccount(wagmiConfig).chainId !== chainId) {
          throw new Error('Your wallet is on another network. Switch it back, then try again. Your uploads are kept.')
        }

        const create = createCall(
          f.factory,
          f.vault,
          address,
          { name: f.collectionName, bps: f.alignmentBps, uri: metadata },
          rec.progress.salt
        )
        const editionArgsList = editionArgs({
          title: f.title,
          priceWei: f.priceWei,
          supply: f.supply,
          model: f.model,
          metadataURI: metadata,
        })

        await launchOnChain({
          chainId,
          account: address,
          progress: rec.progress,
          save,
          stopIfClosed,
          create,
          salted: true,
          createdFrom: (logs: Log[]) =>
            parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: logs as never })[0]?.args
              .instance,
          first: {
            call: (target) => ({
              address: target,
              abi: erc1155InstanceAbi,
              functionName: 'addEdition',
              args: editionArgsList,
            }),
            find: (inst) => findFirstEdition(chainId, inst),
            idFromLogs: (logs) =>
              parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs: logs as never })[0]?.args
                .editionId,
            name: 'the track',
          },
          mark: (step, state) => mark(step === 'first' ? 'edition' : 'deploy', state),
          onDeployed: (inst) => addKnownCollection(chainId, inst),
        })

        // Finished: the same release made again on purpose gets its own address.
        rec.progress.firstId ??= 1n
        bumpLaunchRound(store, rec)
        clearLaunch(store, rec)
      } catch (e) {
        setSteps((s) => {
          const next = { ...s }
          ;(Object.keys(next) as StepId[]).forEach((k) => {
            if (next[k] === 'active') next[k] = 'error'
          })
          return next
        })
        setError(e instanceof TxEndError || (e as SaidError).plain ? (e as Error).message : plainTxError(e))
      } finally {
        setRunning(false)
        bump()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, chain, uploaded]
  )

  /** Store one file outside a release (the community station). The release reuses it, so nothing is paid twice. */
  const store = async (id: 'audio' | 'cover', file: File) => {
    const key = await contentKey(id, file)
    const known = uploaded[id] || fromCache(key)
    if (known) {
      setUploaded((u) => ({ ...u, [id]: known }))
      return known
    }
    // A failure here is told where it was asked for, on the station. It isn't a release step that failed.
    const uri = await upload(id, file).catch((e) => {
      mark(id, 'idle')
      throw e
    })
    rememberUpload(browserStore(), key, uri)
    setUploaded((u) => ({ ...u, [id]: uri }))
    return uri
  }

  const p = record.current?.progress
  const discard = p ? discardChoice(p, Date.now()) : 'free'

  /** Drops the release on the screen. Refused while something sent may still land. */
  const reset = () => {
    const r = record.current
    if (r && !p?.firstDone) {
      if (discardChoice(r.progress, Date.now()) === 'no') return
      const st = browserStore()
      // Its collection is live: making this release again gets a new address rather than finding this one.
      if (r.progress.instance) bumpLaunchRound(st, r)
      clearLaunch(st, r)
    }
    record.current = undefined
    setSteps(IDLE)
    setUploaded({})
    setError('')
    checks.cancel()
    setCheck({ state: 'idle' })
    setSaved(findSaved())
    bump()
  }

  /** Carry on with a release from an earlier visit. */
  const resume = (s: SavedLaunch<MusicSaved>) => {
    adopt(s)
    setError('')
    return run()
  }

  /** Drops a release from an earlier visit, when nothing it sent may still land (or, with a warning, long after). */
  const discardSaved = (s: SavedLaunch<MusicSaved>) => {
    if (discardChoice(s.progress, Date.now()) === 'no') return
    const st = browserStore()
    if (s.progress.instance) bumpLaunchRound(st, s)
    clearLaunch(st, s)
    setSaved(findSaved())
  }

  /** Inputs changed after an upload: drop the derived uploads so they are redone. */
  const invalidate = (what: 'audio' | 'cover' | 'metadata') => {
    if (p && launchCommitted(p)) return
    const drop = (u: Uploaded): Uploaded => {
      if (what === 'audio') return { cover: u.cover }
      if (what === 'cover') return { audio: u.audio }
      return { audio: u.audio, cover: u.cover }
    }
    if (record.current) record.current.uploads = drop(record.current.uploads) as Record<string, string>
    setUploaded(drop)
    setSteps((s) => ({
      ...s,
      ...(what === 'audio' ? { audio: 'idle' } : {}),
      ...(what === 'cover' ? { cover: 'idle' } : {}),
      metadata: 'idle',
    }))
  }

  const launched: Launched = {
    instance: p?.instance as Address | undefined,
    // Only once it is known to be on the chain: the release screen reads this as "done".
    editionId: p?.firstDone ? p.firstId ?? 1n : undefined,
    deployHash: p?.deployHash as Hash | undefined,
    editionHash: p?.firstHash as Hash | undefined,
  }

  /** Something has gone to the chain, or may have, so what it was built from can't change any more. */
  const committed = !!p && launchCommitted(p)
  /** Something sent may still land: nothing is sent again, and nothing may be paid for, until it is known. */
  const unsettled = !!p && launchUnsettled(p)

  return {
    committed,
    unsettled,
    /** A prompt was open, or what was sent did not run: after looking on the chain, it may be sent again. */
    mayResend: !!p?.asking,
    discard,
    steps,
    uploaded,
    launched,
    /** The release's track title, also when it was carried on from an earlier visit. */
    title: record.current?.input.title,
    error,
    running,
    note,
    check,
    saved,
    simulate,
    run,
    store,
    reset,
    resume,
    discardSaved,
    invalidate,
  }
}

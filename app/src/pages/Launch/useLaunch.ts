import { useQueryClient } from '@tanstack/react-query'
import { getAccount, getPublicClient, simulateContract } from '@wagmi/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hash, Log } from 'viem'
import { getAbiItem, parseEventLogs } from 'viem'
import { useAccount } from 'wagmi'

import { TxEndError } from '@/miyamints/txOutcome'
import { latestOnly } from '@/pages/Swap/swapLogic'
import type { TxStepState } from '@/components/LaunchKit'
import type { SupportedChainId } from '@/config/wagmi'
import { wagmiConfig } from '@/config/wagmi'
import type { MiyamintsAddresses } from '@/constants/contracts'
import {
  auctionFactoryAbi,
  auctionInstanceAbi,
  dropFactoryAbi,
  erc1155FactoryAbi,
  erc1155InstanceAbi,
} from '@/miyamints/abi'
import { describeError, plainTxError, TX_CHECK_WORDS } from '@/miyamints/errors'
import type { LaunchForm, LaunchType, Resolved } from '@/miyamints/launch'
import { buildAuctionArgs, buildDropArgs, buildEditionArgs, makeSalt } from '@/miyamints/launch'
import { rememberLaunch } from '@/miyamints/local'
import { addKnownCollection } from '@/music/known'
import { FREE_BYTES, fundAndUpload, fundStorage } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

import { findAuctionPiece, findFirstEdition, launchOnChain, SaidError } from './launchChain'
import type { SavedLaunch } from './resume'
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
} from './resume'

export type PipeStep = 'image' | 'audio' | 'deploy' | 'first'
export type PipeState = Record<PipeStep, TxStepState>

const IDLE: PipeState = { image: 'idle', audio: 'idle', deploy: 'idle', first: 'idle' }

export { describeError }

export type Media = { file?: File; uri?: string; mime?: string }

export type LaunchResult = {
  chainId: number
  instance: Address
  type: LaunchType
  deployHash?: Hash
  firstHash?: Hash
}

/** What a saved launch is built from, so a reload can finish it without the form or the files. */
export type LaunchSaved = {
  form: LaunchForm
  resolved: Omit<Resolved, 'image' | 'audio' | 'audioMime'>
  audioMime?: string
  /** The picked files' content keys, so the same draft is recognised after a reload without them. */
  imageKey?: string
  audioKey?: string
}

/** Only for the dry run: the real create always uses the draft's own salt. */
const randomSalt = (factory: Address) => makeSalt(factory, crypto.getRandomValues(new Uint8Array(11)))

const NOT_SAVED_WORDS =
  "This browser would not keep the launch's progress, so nothing more was sent. Allow this site to store data, then try again."

/** The steps as a saved launch left them. */
function stepsOf(saved: SavedLaunch<LaunchSaved>): PipeState {
  const p = saved.progress
  const { form } = saved.input
  const music = form.type === 'editions' && form.editionKind === 'music'
  return {
    image: saved.uploads.image ? (form.imageMode === 'link' ? 'skipped' : 'done') : 'idle',
    audio: music && saved.uploads.audio ? (form.audioMode === 'link' ? 'skipped' : 'done') : 'idle',
    deploy: p.instance ? 'done' : p.batchId || p.deployHash || p.asking ? 'error' : 'idle',
    first: p.firstDone ? 'done' : p.firstHash ? 'error' : 'idle',
  }
}

/**
 * The launch pipeline: upload artwork (and audio) through Irys unless a link was given, simulate, deploy, then
 * the type's first action (auction: queue the piece; editions: add the edition). Every step is saved in the browser
 * as it lands (resume.ts), so a failed or cancelled step, or a reload, carries on without uploading, paying the
 * deposit or deploying twice.
 */
export function useLaunch() {
  const { address, chain } = useAccount()
  const qc = useQueryClient()
  const [steps, setSteps] = useState<PipeState>(IDLE)
  const [uploaded, setUploaded] = useState<{ image?: string; audio?: string }>({})
  /** The launch being worked on, saved after every change. Mutated in place, so `bump` re-renders. */
  const record = useRef<SavedLaunch<LaunchSaved>>()
  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)
  /** A launch from an earlier visit, still open, offered on the screen. */
  const [saved, setSaved] = useState<SavedLaunch<LaunchSaved>>()
  const [result, setResult] = useState<LaunchResult>()
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

  // A launch left open on this wallet and chain is offered again. One made under another wallet or chain is not
  // this one's to carry on.
  useEffect(() => {
    const active = record.current
    if (active && (active.account.toLowerCase() !== address?.toLowerCase() || active.chainId !== chain?.id)) {
      record.current = undefined
      setSteps(IDLE)
      setUploaded({})
      setResult(undefined)
      setError('')
      bump()
    }
    setSaved(address && chain ? findLaunches<LaunchSaved>(browserStore(), 'launch', address, chain.id)[0] : undefined)
  }, [address, chain?.id])

  const mark = (id: PipeStep, state: TxStepState) => setSteps((s) => ({ ...s, [id]: state }))

  const adopt = (r: SavedLaunch<LaunchSaved>) => {
    record.current = r
    setUploaded({ image: r.uploads.image, audio: r.uploads.audio })
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

  const upload = async (id: 'image' | 'audio', file: File) => {
    stopIfClosed()
    mark(id, 'active')
    const tx = await fundAndUpload(
      file,
      [
        { name: 'Content-Type', value: file.type || 'application/octet-stream' },
        { name: 'application-id', value: 'MiyaOS' },
        { name: 'miya-kind', value: `launch-${id}` },
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

  /** Builds the deploy call (with placeholder media when not uploaded yet). */
  const deployCall = (form: LaunchForm, r: Resolved, a: MiyamintsAddresses, now: bigint, salt?: `0x${string}`) => {
    if (form.type === 'drop') {
      return {
        address: a.erc721DropFactory as Address,
        abi: dropFactoryAbi,
        functionName: 'createDrop' as const,
        args: buildDropArgs(form, r, now),
      }
    }

    if (form.type === 'auction') {
      const factory = a.erc721AuctionFactory as Address
      const built = buildAuctionArgs(form, r, salt ?? randomSalt(factory))
      return {
        address: factory,
        abi: auctionFactoryAbi,
        functionName: 'createInstance' as const,
        args: built.create,
        queue: built.queue,
      }
    }

    const factory = a.erc1155Factory as Address
    const built = buildEditionArgs(form, r, salt ?? randomSalt(factory))
    return {
      address: factory,
      abi: erc1155FactoryAbi,
      functionName: 'createInstance' as const,
      args: built.create,
      edition: built.edition,
    }
  }

  /** Dry-run the deploy so problems show before the wallet opens. */
  const simulate = useCallback(
    async (
      form: LaunchForm,
      r: Omit<Resolved, 'image'> & { image?: string },
      a: MiyamintsAddresses,
      chainId: SupportedChainId
    ) => {
      if (!address) return
      // Only the newest check counts: an older one landing late would speak for settings no longer on the screen.
      const ticket = checks.begin()
      setCheck({ state: 'checking' })
      try {
        const now = BigInt(Math.floor(Date.now() / 1000))
        const call = deployCall(form, { ...r, image: r.image || 'ar://placeholder-artwork' }, a, now)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await simulateContract(wagmiConfig, { account: address, chainId, ...(call as any) })
        if (checks.isCurrent(ticket)) setCheck({ state: 'ok' })
      } catch (e) {
        if (checks.isCurrent(ticket)) setCheck({ state: 'error', message: plainTxError(e, TX_CHECK_WORDS) })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address]
  )

  const run = useCallback(
    async (input: {
      form: LaunchForm
      resolved: Omit<Resolved, 'image' | 'audio'>
      image: Media
      audio?: Media
      addresses: MiyamintsAddresses
      chainId: SupportedChainId
    }) => {
      const { addresses: a, chainId } = input
      setError('')
      setRunning(true)
      try {
        if (!address) throw new Error('Connect a wallet first.')
        if (chain?.id !== chainId) throw new Error('Switch your wallet to the network shown at the top.')
        if (!input.form.type) throw new Error('Pick what you are launching.')
        const store = browserStore()

        // The draft is fixed once anything may be on the chain: then it carries on as saved, whatever the form says.
        let r = record.current
        if (!r || !launchCommitted(r.progress)) {
          const imageKey = input.image.file ? await contentKey('image', input.image.file) : r?.input.imageKey
          const audioKey = input.audio?.file ? await contentKey('audio', input.audio.file) : r?.input.audioKey
          const resolved = { creator: input.resolved.creator, vault: input.resolved.vault, alignmentBps: input.resolved.alignmentBps }
          const draft = draftId({
            app: 'launch',
            form: input.form,
            resolved,
            image: imageKey ?? input.image.uri,
            audio: input.audio ? audioKey ?? input.audio.uri : undefined,
          })
          if (!r || r.draft !== draft) {
            // The old draft never reached the chain, so nothing of it needs keeping but its uploads (kept by content).
            if (r) clearLaunch(store, r)
            const round = launchRound(store, 'launch', address, chainId, draft)
            const factory = input.form.type === 'auction' ? a.erc721AuctionFactory : a.erc1155Factory
            r = loadLaunch<LaunchSaved>(store, 'launch', address, chainId, draft) ?? {
              app: 'launch',
              account: address,
              chainId,
              draft,
              round,
              label: input.form.name.trim(),
              input: { form: input.form, resolved, audioMime: input.audio?.mime, imageKey, audioKey },
              uploads: {},
              // Fixed by the draft: a reload, or the same draft sent again, can only ever make the one collection.
              progress: {
                salt:
                  input.form.type !== 'drop' && factory
                    ? draftSalt(factory, address, chainId, 'launch', draft, round)
                    : undefined,
              },
              savedAt: Date.now(),
            }
            adopt(r)
          }
          // Written before the first upload is paid for, so a reload finds it.
          save()
        }

        const rec = r
        const { form } = rec.input
        if (!form.type) throw new Error('Pick what you are launching.')

        // Already stored (this launch, or the same bytes before), or a link given: nothing to pay for.
        let image =
          rec.uploads.image || input.image.uri?.trim() || (rec.input.imageKey && knownUpload(store, rec.input.imageKey)) || undefined
        const wantsAudio = form.type === 'editions' && form.editionKind === 'music'
        let audio =
          rec.uploads.audio ||
          (wantsAudio ? input.audio?.uri?.trim() || (rec.input.audioKey && knownUpload(store, rec.input.audioKey)) : undefined) ||
          undefined
        if (!image && !input.image.file) throw new Error('Add your artwork.')
        if (wantsAudio && !audio && !input.audio?.file) throw new Error('Add your track.')

        // Pay once for every file still to store: one Ethereum payment and one wait, before the first upload.
        const toPay = fundingPlan(
          [
            ...(input.image.file ? [{ size: input.image.file.size, stored: !!image }] : []),
            ...(wantsAudio && input.audio?.file ? [{ size: input.audio.file.size, stored: !!audio }] : []),
          ],
          FREE_BYTES
        )
        if (toPay.length) {
          const firstUp: PipeStep = image ? 'audio' : 'image'
          mark(firstUp, 'active')
          await fundStorage(toPay, undefined, getIrysToken(chain?.id || 1), chain, uploadNote)
            .catch((e) => {
              mark(firstUp, 'error')
              throw e
            })
            .finally(() => setNote(''))
        }

        if (!image) {
          image = await upload('image', input.image.file as File)
          if (rec.input.imageKey) rememberUpload(store, rec.input.imageKey, image)
        } else mark('image', form.imageMode === 'link' ? 'skipped' : 'done')
        rec.uploads.image = image
        setUploaded((u) => ({ ...u, image }))
        save()

        if (wantsAudio) {
          if (!audio) {
            audio = await upload('audio', input.audio?.file as File)
            if (rec.input.audioKey) rememberUpload(store, rec.input.audioKey, audio)
          } else mark('audio', form.audioMode === 'link' ? 'skipped' : 'done')
          rec.uploads.audio = audio
          setUploaded((u) => ({ ...u, audio }))
          save()
        }

        // Paying for storage takes the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
        if (getAccount(wagmiConfig).chainId !== chainId) {
          throw new Error('Your wallet is on another network. Switch it back, then try again. Your uploads are kept.')
        }

        const resolved: Resolved = { ...rec.input.resolved, image, audio, audioMime: rec.input.audioMime }
        const now = BigInt(Math.floor(Date.now() / 1000))
        const call = deployCall(form, resolved, a, now, rec.progress.salt)
        const type = form.type

        const done = await launchOnChain({
          chainId,
          account: address,
          progress: rec.progress,
          save,
          stopIfClosed,
          create: { address: call.address, abi: call.abi, functionName: call.functionName, args: call.args },
          salted: type !== 'drop',
          createdFrom: (logs: Log[]) =>
            type === 'drop'
              ? parseEventLogs({ abi: dropFactoryAbi, eventName: 'DropCreated', logs: logs as never })[0]?.args.drop
              : type === 'auction'
              ? parseEventLogs({ abi: auctionFactoryAbi, eventName: 'InstanceCreated', logs: logs as never })[0]?.args
                  .instance
              : parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: logs as never })[0]?.args
                  .instance,
          findCreated:
            type === 'drop'
              ? async (fromBlock) => {
                  const client = getPublicClient(wagmiConfig, { chainId })
                  if (!client) throw new Error('no client')
                  const logs = await client.getLogs({
                    address: call.address,
                    event: getAbiItem({ abi: dropFactoryAbi, name: 'DropCreated' }),
                    args: { creator: address },
                    fromBlock,
                  })
                  return logs[0]?.args.drop
                }
              : undefined,
          first:
            type === 'auction'
              ? {
                  call: (target) => ({
                    address: target,
                    abi: auctionInstanceAbi,
                    functionName: 'queuePiece',
                    args: [(call as { queue: { tokenURI: string } }).queue.tokenURI],
                    value: (call as { queue: { value: bigint } }).queue.value,
                  }),
                  find: (inst) => findAuctionPiece(chainId, inst),
                  idFromLogs: (logs) => {
                    const [queued] = parseEventLogs({ abi: auctionInstanceAbi, eventName: 'PieceQueued', logs: logs as never })
                    return queued ? BigInt(queued.args.tokenId) : undefined
                  },
                  name: 'your piece',
                }
              : type === 'editions'
              ? {
                  call: (target) => ({
                    address: target,
                    abi: erc1155InstanceAbi,
                    functionName: 'addEdition',
                    args: (call as { edition: readonly unknown[] }).edition,
                  }),
                  find: (inst) => findFirstEdition(chainId, inst),
                  idFromLogs: (logs) =>
                    parseEventLogs({ abi: erc1155InstanceAbi, eventName: 'EditionAdded', logs: logs as never })[0]?.args
                      .editionId,
                  name: 'the first edition',
                }
              : undefined,
          mark,
          onDeployed: (inst) => {
            rememberLaunch(chainId, inst, type)
            if (type === 'editions') addKnownCollection(chainId, inst)
          },
        })

        setResult({ chainId, instance: done.instance, type, deployHash: done.deployHash, firstHash: done.firstHash })
        // Finished: the same draft made again on purpose gets its own address.
        bumpLaunchRound(store, rec)
        clearLaunch(store, rec)
        qc.invalidateQueries({ queryKey: ['my-launches'] })
      } catch (e) {
        setSteps((s) => {
          const next = { ...s }
          ;(Object.keys(next) as PipeStep[]).forEach((k) => {
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
    [address, chain]
  )

  const p = record.current?.progress
  const unsettled = !!p && launchUnsettled(p)
  /** Whether this launch can be dropped: never while something sent may still land. */
  const discard = p ? discardChoice(p, Date.now()) : 'free'

  /** Drops the launch on the screen (and its saved record). Refused while something sent may still land. */
  const reset = () => {
    const r = record.current
    if (r && !result) {
      if (discardChoice(r.progress, Date.now()) === 'no') return
      const store = browserStore()
      // Its collection is live: making this draft again gets a new address rather than finding this one.
      if (r.progress.instance) bumpLaunchRound(store, r)
      clearLaunch(store, r)
    }
    record.current = undefined
    setSteps(IDLE)
    setUploaded({})
    setResult(undefined)
    setError('')
    checks.cancel()
    setCheck({ state: 'idle' })
    bump()
  }

  /** Carry on with a launch from an earlier visit. Returns what it was built from, for the form. */
  const resume = (s: SavedLaunch<LaunchSaved>) => {
    adopt(s)
    setResult(undefined)
    setError('')
    return s.input
  }

  /** Drops a launch from an earlier visit, when nothing it sent may still land (or, with a warning, long after). */
  const discardSaved = (s: SavedLaunch<LaunchSaved>) => {
    if (discardChoice(s.progress, Date.now()) === 'no') return
    const store = browserStore()
    if (s.progress.instance) bumpLaunchRound(store, s)
    clearLaunch(store, s)
    setSaved(address && chain ? findLaunches<LaunchSaved>(store, 'launch', address, chain.id)[0] : undefined)
  }

  /** The form changed, so the last try's error is about what's no longer on the screen. Not once it's on the chain. */
  const clearError = () => {
    if (!p || !launchCommitted(p)) setError('')
  }

  /** Media changed: forget its upload (only before anything went to the chain). */
  const invalidate = (what: 'image' | 'audio') => {
    clearError()
    if (p && launchCommitted(p)) return
    if (record.current) delete record.current.uploads[what]
    setUploaded((u) => ({ ...u, [what]: undefined }))
    mark(what, 'idle')
  }

  /** Something has gone to the chain, or may have, so what it was built from can't change any more. */
  const committed = !!p && launchCommitted(p)

  return {
    committed,
    /** Something sent may still land: nothing is sent again, and nothing may be paid for, until it is known. */
    unsettled,
    /** A prompt was open, or what was sent did not run: after looking on the chain, it may be sent again. */
    mayResend: !!p?.asking,
    discard,
    steps,
    uploaded,
    instance: p?.instance as Address | undefined,
    hashes: { deploy: p?.deployHash as Hash | undefined, first: p?.firstHash as Hash | undefined },
    result,
    error,
    running,
    note,
    check,
    saved,
    simulate,
    run,
    reset,
    resume,
    discardSaved,
    invalidate,
    clearError,
  }
}

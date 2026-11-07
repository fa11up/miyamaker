import { useQueryClient } from '@tanstack/react-query'
import { getAccount, readContract, simulateContract, writeContract } from '@wagmi/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hash } from 'viem'
import { parseEventLogs } from 'viem'
import { useAccount } from 'wagmi'

import { TxEndError } from '@/miyamints/txOutcome'
import { latestOnly } from '@/pages/Swap/swapLogic'
import { waitForTx } from '@/miyamints/useTxOutcome'
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
import { tryBatch, waitForBatch } from '@/utils/batch'
import { instanceAddressAbi } from '@/utils/batchCalls'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

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

const randomSalt = (factory: Address) => makeSalt(factory, crypto.getRandomValues(new Uint8Array(11)))

/**
 * The launch pipeline: upload artwork (and audio) through Irys unless a link was given, simulate, deploy, then
 * the type's first action (auction: queue the piece; editions: add the edition). Finished steps are kept, so a
 * failed or cancelled step can be retried without uploading or deploying twice.
 */
export function useLaunch() {
  const { address, chain } = useAccount()
  const qc = useQueryClient()
  const [steps, setSteps] = useState<PipeState>(IDLE)
  const [uploaded, setUploaded] = useState<{ image?: string; audio?: string }>({})
  const [instance, setInstance] = useState<Address>()
  const [hashes, setHashes] = useState<{ deploy?: Hash; first?: Hash }>({})
  /** A create-and-first-piece batch the wallet has, until it says how it ended. */
  const [sentBatch, setSentBatch] = useState<{ id: string; predicted: Address }>()
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

  const mark = (id: PipeStep, state: TxStepState) => setSteps((s) => ({ ...s, [id]: state }))

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

  /** Builds the deploy call (with placeholder media when not uploaded yet). */
  const deployCall = (form: LaunchForm, r: Resolved, a: MiyamintsAddresses, now: bigint) => {
    if (form.type === 'drop') {
      return {
        address: a.erc721DropFactory as Address,
        abi: dropFactoryAbi,
        functionName: 'createDrop' as const,
        args: buildDropArgs(form, r, now),
      }
    }

    if (form.type === 'auction') {
      const built = buildAuctionArgs(form, r, randomSalt(a.erc721AuctionFactory as Address))
      return {
        address: a.erc721AuctionFactory as Address,
        abi: auctionFactoryAbi,
        functionName: 'createInstance' as const,
        args: built.create,
        queue: built.queue,
      }
    }

    const built = buildEditionArgs(form, r, randomSalt(a.erc1155Factory as Address))
    return {
      address: a.erc1155Factory as Address,
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
      chainId: SupportedChainId,
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
    [address],
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
      const { form, addresses: a, chainId } = input
      setError('')
      setRunning(true)
      try {
        if (!address) throw new Error('Connect a wallet first.')
        if (chain?.id !== chainId) throw new Error('Switch your wallet to the network shown at the top.')
        if (!form.type) throw new Error('Pick what you are launching.')

        let { image, audio } = uploaded
        if (!image) {
          if (input.image.uri) {
            image = input.image.uri
            mark('image', 'skipped')
          } else if (input.image.file) image = await upload('image', input.image.file)
          else throw new Error('Add your artwork.')
          setUploaded((u) => ({ ...u, image }))
        }

        if (input.audio && !audio) {
          if (input.audio.uri) {
            audio = input.audio.uri
            mark('audio', 'skipped')
          } else if (input.audio.file) audio = await upload('audio', input.audio.file)
          else throw new Error('Add your track.')
          setUploaded((u) => ({ ...u, audio }))
        }

        // Paying for storage takes the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
        if (getAccount(wagmiConfig).chainId !== chainId) {
          throw new Error('Your wallet is on another network. Switch it back, then try again. Your uploads are kept.')
        }

        const r: Resolved = { ...input.resolved, image, audio, audioMime: input.audio?.mime }
        const now = BigInt(Math.floor(Date.now() / 1000))
        const call = deployCall(form, r, a, now)

        let inst = instance
        let deployHash = hashes.deploy
        let firstHash: Hash | undefined
        const firstCall = (target: Address) =>
          form.type === 'auction'
            ? {
                address: target,
                abi: auctionInstanceAbi,
                functionName: 'queuePiece' as const,
                args: [(call as { queue: { tokenURI: string } }).queue.tokenURI],
                value: (call as { queue: { value: bigint } }).queue.value,
              }
            : {
                address: target,
                abi: erc1155InstanceAbi,
                functionName: 'addEdition' as const,
                args: (call as { edition: readonly unknown[] }).edition,
              }

        // Create it and add the first piece as one signature. Its address is fixed by the salt, so the second call
        // can name it in advance; if anything is off, the whole batch reverts and nothing was created.
        if (!inst && form.type !== 'drop') {
          const {
            address: factory,
            abi,
            functionName,
            args,
          } = call as {
            address: Address
            abi: readonly unknown[]
            functionName: string
            args: readonly [`0x${string}`, unknown]
          }
          const predicted =
            sentBatch?.predicted ??
            (await readContract(wagmiConfig, {
              address: factory,
              abi: instanceAddressAbi,
              functionName: 'computeInstanceAddress',
              args: [args[0], address],
              chainId,
            }).catch(() => undefined))
          stopIfClosed()
          // A batch already out is waited on, never sent again. Only the wallet saying it failed frees it.
          const sent = await Promise.resolve(
            sentBatch
              ? waitForBatch(sentBatch.id)
              : predicted &&
                  tryBatch([{ address: factory, abi, functionName, args }, firstCall(predicted)], {
                    account: address,
                    chainId,
                    onAsk: () => mark('deploy', 'active'),
                    onSent: (id) => {
                      setSentBatch({ id, predicted })
                      mark('first', 'active')
                    },
                  }),
          ).catch((e) => {
            if (!(e as TxEndError).unconfirmed) setSentBatch(undefined)
            throw e
          })
          if (sent) {
            setSentBatch(undefined)
            const logs = sent.receipts.flatMap((receipt) => receipt.logs ?? [])
            inst = (
              form.type === 'auction'
                ? parseEventLogs({ abi: auctionFactoryAbi, eventName: 'InstanceCreated', logs: logs as never })
                : parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: logs as never })
            )[0]?.args.instance
            if (!inst) throw new Error('Created, but the new address was not in the receipt. Check the explorer.')
            deployHash = sent.hash
            setHashes((h) => ({ ...h, deploy: sent.hash }))
            rememberLaunch(chainId, inst, form.type)
            if (form.type === 'editions') addKnownCollection(chainId, inst)
            setInstance(inst)
            mark('deploy', 'done')
            // Same address as named means the first piece went in with it. Otherwise it goes in as its own step below.
            if (inst.toLowerCase() === predicted?.toLowerCase()) {
              firstHash = sent.hash
              setHashes((h) => ({ ...h, first: sent.hash }))
              mark('first', 'done')
            }
          }
        }

        if (!inst) {
          mark('deploy', 'active')
          // One already sent is waited on, not sent again: a failed lookup says nothing about how it ended.
          if (!deployHash) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { request } = await simulateContract(wagmiConfig, { account: address, chainId, ...(call as any) })
            stopIfClosed()
            const hash = await writeContract(wagmiConfig, request)
            deployHash = hash
            setHashes((h) => ({ ...h, deploy: hash }))
          }

          const receipt = await waitForTx(chainId, deployHash).catch((e) => {
            if ((e as TxEndError).reverted || (e as TxEndError).cancelled) {
              setHashes((h) => ({ ...h, deploy: undefined }))
            }

            throw e
          })

          if (form.type === 'drop') {
            inst = parseEventLogs({ abi: dropFactoryAbi, eventName: 'DropCreated', logs: receipt.logs })[0]?.args.drop
          } else if (form.type === 'auction') {
            inst = parseEventLogs({ abi: auctionFactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })[0]?.args
              .instance
          } else {
            inst = parseEventLogs({ abi: erc1155FactoryAbi, eventName: 'InstanceCreated', logs: receipt.logs })[0]?.args
              .instance
          }

          if (!inst) throw new Error('Created, but the new address was not in the receipt. Check the explorer.')
          rememberLaunch(chainId, inst, form.type)
          if (form.type === 'editions') addKnownCollection(chainId, inst)
          setInstance(inst)
          mark('deploy', 'done')
        }

        if (form.type !== 'drop' && !firstHash) {
          mark('first', 'active')
          // Sending this one twice would pay the auction's deposit twice, so one already out is only waited on.
          let sending = hashes.first
          if (!sending) {
            const { request } = await simulateContract(wagmiConfig, {
              account: address,
              chainId,
              ...firstCall(inst),
            } as never)
            stopIfClosed()
            const hash: Hash = await writeContract(wagmiConfig, request as never)
            sending = hash
            setHashes((h) => ({ ...h, first: hash }))
          }

          await waitForTx(chainId, sending).catch((e) => {
            if ((e as TxEndError).reverted || (e as TxEndError).cancelled) {
              setHashes((h) => ({ ...h, first: undefined }))
            }

            throw e
          })
          firstHash = sending
          mark('first', 'done')
        }

        setResult({ chainId, instance: inst, type: form.type, deployHash, firstHash })
        qc.invalidateQueries({ queryKey: ['my-launches'] })
      } catch (e) {
        setSteps((s) => {
          const next = { ...s }
          ;(Object.keys(next) as PipeStep[]).forEach((k) => {
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
    [address, chain, uploaded, instance, hashes, sentBatch],
  )

  const reset = () => {
    setSteps(IDLE)
    setUploaded({})
    setInstance(undefined)
    setHashes({})
    setSentBatch(undefined)
    setResult(undefined)
    setError('')
    checks.cancel()
    setCheck({ state: 'idle' })
  }

  /** The form changed, so the last try's error is about what's no longer on the screen. Not once it's on the chain. */
  const clearError = () => {
    if (!instance && !hashes.deploy && !sentBatch) setError('')
  }

  /** Media changed: forget its upload (only before deploying). */
  const invalidate = (what: 'image' | 'audio') => {
    clearError()
    if (instance) return
    setUploaded((u) => ({ ...u, [what]: undefined }))
    mark(what, 'idle')
  }

  /** Something has gone to the chain, so what it was built from can't change any more. */
  const committed = !!instance || !!hashes.deploy || !!sentBatch

  return {
    committed,
    steps,
    uploaded,
    instance,
    hashes,
    result,
    error,
    running,
    note,
    check,
    simulate,
    run,
    reset,
    invalidate,
    clearError,
  }
}

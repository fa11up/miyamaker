import { useQueryClient } from '@tanstack/react-query'
import { simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { useCallback, useState } from 'react'
import type { Address, Hash } from 'viem'
import { parseEventLogs } from 'viem'
import { useAccount } from 'wagmi'

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
import { describeError } from '@/miyamints/errors'
import type { LaunchForm, LaunchType, Resolved } from '@/miyamints/launch'
import { buildAuctionArgs, buildDropArgs, buildEditionArgs, makeSalt } from '@/miyamints/launch'
import { rememberLaunch } from '@/miyamints/local'
import { addKnownCollection } from '@/music/known'
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
  const [result, setResult] = useState<LaunchResult>()
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; message?: string }>({
    state: 'idle',
  })

  const mark = (id: PipeStep, state: TxStepState) => setSteps((s) => ({ ...s, [id]: state }))

  const upload = async (id: 'image' | 'audio', file: File) => {
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
      chain
    )
    if (!tx) {
      mark(id, 'error')
      throw new Error('The upload did not go through. Check this wallet has a little ETH for storage and try again.')
    }

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
      chainId: SupportedChainId
    ) => {
      if (!address) return
      setCheck({ state: 'checking' })
      try {
        const now = BigInt(Math.floor(Date.now() / 1000))
        const call = deployCall(form, { ...r, image: r.image || 'ar://placeholder-artwork' }, a, now)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await simulateContract(wagmiConfig, { account: address, chainId, ...(call as any) })
        setCheck({ state: 'ok' })
      } catch (e) {
        setCheck({ state: 'error', message: describeError(e) })
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

        const r: Resolved = { ...input.resolved, image, audio, audioMime: input.audio?.mime }
        const now = BigInt(Math.floor(Date.now() / 1000))
        const call = deployCall(form, r, a, now)

        let inst = instance
        let deployHash = hashes.deploy
        if (!inst) {
          mark('deploy', 'active')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { request } = await simulateContract(wagmiConfig, { account: address, chainId, ...(call as any) })
          const hash = await writeContract(wagmiConfig, request)
          deployHash = hash
          setHashes((h) => ({ ...h, deploy: hash }))
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
          if (receipt.status !== 'success') throw new Error('The create transaction failed on-chain.')
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

        let firstHash: Hash | undefined
        if (form.type !== 'drop') {
          mark('first', 'active')
          if (form.type === 'auction') {
            const { request } = await simulateContract(wagmiConfig, {
              account: address,
              chainId,
              address: inst,
              abi: auctionInstanceAbi,
              functionName: 'queuePiece',
              args: [(call as { queue: { tokenURI: string } }).queue.tokenURI],
              value: (call as { queue: { value: bigint } }).queue.value,
            })
            firstHash = await writeContract(wagmiConfig, request)
          } else {
            const { request } = await simulateContract(wagmiConfig, {
              account: address,
              chainId,
              address: inst,
              abi: erc1155InstanceAbi,
              functionName: 'addEdition',
              args: (call as { edition: readonly [string, bigint, bigint, string, number, bigint, bigint] }).edition,
            })
            firstHash = await writeContract(wagmiConfig, request)
          }

          setHashes((h) => ({ ...h, first: firstHash }))
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: firstHash, chainId })
          if (receipt.status !== 'success') throw new Error('That transaction failed on-chain. You can retry it.')
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
        setError(describeError(e))
      } finally {
        setRunning(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, chain, uploaded, instance, hashes]
  )

  const reset = () => {
    setSteps(IDLE)
    setUploaded({})
    setInstance(undefined)
    setHashes({})
    setResult(undefined)
    setError('')
    setCheck({ state: 'idle' })
  }

  /** Media changed: forget its upload (only before deploying). */
  const invalidate = (what: 'image' | 'audio') => {
    if (instance) return
    setUploaded((u) => ({ ...u, [what]: undefined }))
    mark(what, 'idle')
  }

  return { steps, uploaded, instance, hashes, result, error, running, check, simulate, run, reset, invalidate }
}

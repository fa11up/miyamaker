import { formatEther } from 'viem'

/**
 * The parts of minting from MiyaMusicMaker that need no wallet, so `node --test` can load them
 * (tests/music-maker-mint.test.mts). launchEdition.ts and PublishDialog.tsx do the rest.
 */

/** What has gone to the chain so far. The dialog keeps one across attempts, so a retry carries on from it. */
export type LaunchProgress = {
  /** A create-and-add-edition batch the wallet has, until it says how it ended. */
  batchId?: string
  deployHash?: `0x${string}`
  instance?: `0x${string}`
  editionHash?: `0x${string}`
  editionId?: bigint
  mintHash?: `0x${string}`
  minted?: boolean
}

export type LaunchStep =
  | 'wait-batch'
  | 'deploy'
  | 'wait-deploy'
  | 'add-edition'
  | 'wait-edition'
  | 'mint'
  | 'wait-mint'
  | 'done'

/**
 * The next thing to do. Anything already sent is waited on, never sent again: only a clear failure clears it.
 */
export function nextLaunchStep(p: LaunchProgress, mintFirst: boolean): LaunchStep {
  if (!p.instance) {
    if (p.batchId) return 'wait-batch'
    if (p.deployHash) return 'wait-deploy'
    return 'deploy'
  }

  if (p.editionId == null) return p.editionHash ? 'wait-edition' : 'add-edition'
  if (!mintFirst || p.minted) return 'done'
  return p.mintHash ? 'wait-mint' : 'mint'
}

/** Something is on the chain, or may be, so what it was built from can't change any more. */
export function launchCommitted(p: LaunchProgress): boolean {
  return !!(p.batchId || p.deployHash || p.instance)
}

/** Names an upload by its exact bytes, so a retry reuses what is stored and pays for nothing twice. */
export async function contentKey(kind: string, file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${kind}:${file.type}:${hex}`
}

/** The metadata wants a whole number from 20 to 400. The sampler's tempo can be fractional. */
export function publishBpm(bpm: unknown): number | undefined {
  const n = Number(bpm)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.min(400, Math.max(20, Math.round(n)))
}

export function firstCopyLabel(priceWei: bigint | undefined): string {
  const cost = priceWei && priceWei > 0n ? `${formatEther(priceWei)} ETH` : 'the edition price'
  return `Mint the first copy to this wallet (costs ${cost})`
}

export function shortAddress(address: string | undefined): string {
  if (!address) return ''
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** The artist when the field is left blank: the wallet's ENS name, or its short address. */
export function defaultArtist(ens: string | null | undefined, address: string | undefined): string {
  return (ens || '').trim() || shortAddress(address)
}

/**
 * Why a release can't start yet, said before anything is uploaded or paid for. Empty when it can.
 */
export function releaseBlocker(m: {
  connected: boolean
  wrongChain: boolean
  deployed: boolean
  chainName: string
  openChain?: string
}): string {
  if (!m.connected) return 'Connect a wallet first.'
  if (m.wrongChain) return `Switch to ${m.chainName} to release. Nothing was uploaded or charged.`
  if (!m.deployed) {
    return m.openChain
      ? `Music drops are not open on ${m.chainName} yet. Switch to ${m.openChain}. Nothing was uploaded or charged.`
      : `Music drops are not open on ${m.chainName} yet. Nothing was uploaded or charged.`
  }

  return ''
}

/** Placeholder links, so the metadata can be checked before any upload is paid for. */
export const PLACEHOLDER_URIS = {
  audio: 'ar://placeholder-audio',
  image: 'ar://placeholder-cover',
  pack: 'ar://placeholder-file',
}

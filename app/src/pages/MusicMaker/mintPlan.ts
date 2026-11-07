import { formatEther, keccak256, stringToBytes } from 'viem'

/**
 * The parts of minting from MiyaMusicMaker that need no wallet, so `node --test` can load them
 * (tests/music-maker-mint.test.mts). launchEdition.ts and PublishDialog.tsx do the rest.
 */

type Hex = `0x${string}`

/** A wallet prompt that was open. If the app went away while it was, what it sent (if anything) was never heard. */
export type LaunchAsk = 'batch' | 'deploy' | 'edition' | 'mint'

/** What has gone to the chain so far. The dialog keeps one across attempts, so a retry carries on from it. */
export type LaunchProgress = {
  /** The create salt. Every send of the collection reuses it, so the collection can only ever be made once. */
  salt?: Hex
  /** Where the factory said that salt puts the collection, so it can be found without a receipt. */
  predicted?: Hex
  /** The wallet is being asked, or was when the app went away. */
  asking?: LaunchAsk
  /** A create-and-add-edition batch the wallet has, until it says how it ended. */
  batchId?: string
  /** The collection came from a batch, which is all or nothing: its edition came with it and is never added again. */
  batched?: boolean
  deployHash?: Hex
  instance?: Hex
  editionHash?: Hex
  editionId?: bigint
  mintHash?: Hex
  minted?: boolean
  /**
   * The wallet's pending nonce read just before the open prompt. If the wallet's count has moved past it when the app
   * comes back, something went out while the prompt was open, and it is waited for instead of sending again.
   */
  askNonce?: number
  /** The nonce the kept hash went out at (the pending count before its prompt), so a dropped one can be told. */
  sentNonce?: number
  /** When the kept hash was sent. After a long time without an ending, Discard is offered anyway, with a warning. */
  sentAt?: number
  /** The kept hash's nonce was used by something else: what we sent never ran. */
  dropped?: boolean
}

export type LaunchStep =
  | 'wait-batch'
  | 'deploy'
  | 'wait-deploy'
  | 'find-edition'
  | 'add-edition'
  | 'wait-edition'
  | 'mint'
  | 'wait-mint'
  | 'done'

/**
 * The next thing to do. Anything already sent is waited on, never sent again: only a clear failure clears it.
 * `mintFirst` is what the release was sealed with; a mint already sent is waited on whatever it says now.
 */
export function nextLaunchStep(p: LaunchProgress, mintFirst: boolean): LaunchStep {
  if (!p.instance) {
    if (p.batchId) return 'wait-batch'
    if (p.deployHash) return 'wait-deploy'
    return 'deploy'
  }

  if (p.editionId == null) {
    if (p.batched) return 'find-edition'
    return p.editionHash ? 'wait-edition' : 'add-edition'
  }

  if (p.minted) return 'done'
  if (p.mintHash) return 'wait-mint'
  return mintFirst ? 'mint' : 'done'
}

/** Something is on the chain, or may be, so what it was built from can't change any more. */
export function launchCommitted(p: LaunchProgress): boolean {
  return !!(p.batchId || p.deployHash || p.instance || p.asking)
}

/** Something was sent and how it ended is not known yet. Until it is, the release can't be dropped or made again. */
export function launchUnsettled(p: LaunchProgress): boolean {
  return !!(p.batchId || p.deployHash || p.editionHash || p.mintHash || p.asking)
}

/** Where a release stands, in a few words for the dialog. */
export function describeLaunch(p: LaunchProgress, mintFirst: boolean): string {
  const at = p.instance ? `the collection is live at ${p.instance}` : ''
  if (p.asking && !p.batchId && !p.deployHash && !p.editionHash && !p.mintHash)
    return 'a wallet request was open when the app closed. Continue looks on the chain before sending anything'
  switch (nextLaunchStep(p, mintFirst)) {
    case 'wait-batch':
      return 'the wallet is sending the collection and its edition'
    case 'wait-deploy':
      return 'the collection is being deployed'
    case 'deploy':
      return 'nothing has landed yet'
    case 'find-edition':
      return `${at}, with its edition. Its number could not be read yet`
    case 'add-edition':
      return `${at}, without its edition yet`
    case 'wait-edition':
      return `${at}, and its edition is being added`
    case 'mint':
      return `${at}, the first copy is not minted yet`
    case 'wait-mint':
      return `${at}, and the first copy is being minted`
    default:
      return `${at}, and it is done`
  }
}

/** The reads that find what a batch made when the wallet's receipts leave it out. launchEdition.ts gives the real ones. */
export type ChainReads = {
  /** Whether there is code at the address. Throws when it can't be read. */
  hasCode: (address: Hex) => Promise<boolean>
  /** The collection's edition ids. Throws when they can't be read. */
  editionIds: (address: Hex) => Promise<readonly bigint[]>
  pause: (ms: number) => Promise<void>
}

/** An error written for people here, shown as it is (plainTxError would hide one that names an address). */
export class SaidError extends Error {
  plain = true
}

/**
 * The chain could not be read, so nothing is known: not "not there". A caller that took it for "not there" would send
 * a second edition or mint. Carries `unconfirmed`, so the dialog's isUnconfirmed (utils/batch) treats it as one.
 */
export class CouldNotReadError extends Error {
  unconfirmed = true

  plain = true

  constructor(message = 'The network could not be read just now, so nothing was sent. Try again in a minute: it looks again first.') {
    super(message)
    this.name = 'CouldNotReadError'
  }
}

/**
 * Reads until it finds something, a few times apart, since a node can be a block or two behind the wallet. Not found
 * only when the last read answered; a read that failed last throws CouldNotReadError instead.
 */
async function lookAgain<T>(
  read: () => Promise<T | undefined>,
  reads: ChainReads,
  tries: number,
  gap: number
): Promise<T | undefined> {
  let failed = false
  const found = await read().catch(() => {
    failed = true
    return undefined
  })
  if (found !== undefined) return found
  if (tries <= 1) {
    if (failed) throw new CouldNotReadError()
    return undefined
  }
  await reads.pause(gap)
  return lookAgain(read, reads, tries - 1, gap)
}

/** The collection at the predicted address, once the chain shows code there. */
export function findInstance(p: LaunchProgress, reads: ChainReads, tries = 4, gap = 3000) {
  const { predicted } = p
  if (!predicted) return Promise.resolve(undefined)
  return lookAgain(async () => ((await reads.hasCode(predicted)) ? predicted : undefined), reads, tries, gap)
}

/** A new collection's only edition. */
export function findEdition(instance: Hex, reads: ChainReads, tries = 4, gap = 3000) {
  return lookAgain(async () => (await reads.editionIds(instance))[0], reads, tries, gap)
}

/**
 * A batch the wallet confirmed. The collection comes from its log, or else from the predicted address once code is
 * there. The batch is only let go once the collection is known, so a retry waits on it again instead of sending anew.
 */
export async function batchLanded(p: LaunchProgress, logged: Hex | undefined, reads: ChainReads): Promise<Hex> {
  const instance = logged ?? (await findInstance(p, reads))
  if (!instance) {
    throw new SaidError(
      'The batch went through, but the new collection could not be read back yet. Try again in a minute: it looks again and sends nothing new.'
    )
  }

  p.instance = instance
  p.batched = true
  p.batchId = undefined
  return instance
}

/** The edition a batch added. It is there (all or nothing), so it is looked for, never added a second time. */
export async function batchEdition(p: LaunchProgress, instance: Hex, logged: bigint | undefined, reads: ChainReads) {
  const editionId = logged ?? (await findEdition(instance, reads))
  if (editionId === undefined) {
    throw new SaidError(
      `The collection is live at ${instance} and its edition came with it, but the edition could not be read yet. Check the explorer, or try again in a minute. Nothing new is sent.`
    )
  }

  p.editionId = editionId
  return editionId
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

/**
 * The first-copy box. The copy is a real mint: it is one of the supply, it pays the price into the collection (yours
 * to withdraw, less the vault share and fee), and on a rising edition it raises the next buyer's price.
 */
export function firstCopyLabel(priceWei: bigint | undefined, rising = false): string {
  const cost = priceWei && priceWei > 0n ? `${formatEther(priceWei)} ETH` : 'the edition price'
  const rise = rising ? ' and raises the price for the next buyer' : ''
  return `Mint the first copy to this wallet (costs ${cost}). It uses one copy of the supply${rise}.`
}

/** A percent from basis points, without trailing zeros: 1000 is "10%", 250 is "2.5%". */
export function pctWords(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`
}

/** Where each sale's money goes, said before Mint. The split happens when the creator withdraws from the collection. */
export function moneyWords(alignmentBps: number, protocolFeeBps: number): string {
  const keep = 10_000 - alignmentBps - protocolFeeBps
  return `Sales stay in the collection until you withdraw them. On each withdrawal ${pctWords(alignmentBps)} goes to the community vault and ${pctWords(protocolFeeBps)} to miya. You keep the other ${pctWords(keep)}.`
}

/**
 * The create salt, from the wallet, the chain and the exact content, so a reload (or a lost record) can't change it
 * and the same content can only ever make the one collection. `round` moves on only when a live release of that
 * content was discarded, so making it again gets a new address. Shaped like makeSalt (music/drop.ts): the factory,
 * a zero byte, then 11 bytes, here from the hash.
 */
export function releaseSalt(factory: string, account: string, chainId: number, content: string, round = 0): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error('bad factory address')
  const digest = keccak256(stringToBytes(`miya-music-salt:${account.toLowerCase()}:${chainId}:${content}:${round}`))
  return `0x${factory.slice(2).toLowerCase()}00${digest.slice(2, 24)}`
}

/** The wallet's transaction counts: `pending` counts what it has sent, `latest` what is mined. */
export type NonceRead = { pending: number; latest: number }

/**
 * A wallet prompt that was open when the app went away, judged by the wallet's nonce.
 * - 'not-sent': nothing has left the wallet since the prompt opened, so nothing of ours is out.
 * - 'in-flight': something has left and is not mined yet. It may be ours: wait for it, never send another.
 * - 'mined': everything that left is mined, so the chain's state now says whether ours ran.
 * Without a recorded nonce (an older record) only the last two can be told.
 */
export function leftoverVerdict(askNonce: number | undefined, now: NonceRead): 'not-sent' | 'in-flight' | 'mined' {
  if (askNonce !== undefined && now.pending <= askNonce) return 'not-sent'
  if (now.latest < now.pending) return 'in-flight'
  return 'mined'
}

/**
 * A kept hash with no receipt. Its nonce mined while the hash has no receipt means something else took that nonce
 * (a cancel or a replacement): ours never ran. Otherwise it is still out.
 */
export function sentVerdict(sentNonce: number | undefined, latest: number, receiptFound: boolean): 'landed' | 'dropped' | 'waiting' {
  if (receiptFound) return 'landed'
  if (sentNonce !== undefined && latest > sentNonce) return 'dropped'
  return 'waiting'
}

/** How long a sent transaction waits without an ending before Discard is offered anyway. */
export const STALE_SEND_MS = 30 * 60_000

/**
 * Whether the release can be dropped: 'free' when nothing is out, 'anyway' (with a warning) when what is out was
 * dropped or has had no ending for a long time, and 'no' while it may still land.
 */
export function discardChoice(p: LaunchProgress, now: number): 'free' | 'anyway' | 'no' {
  if (!launchUnsettled(p)) return 'free'
  if (p.dropped) return 'anyway'
  if (p.sentAt !== undefined && now - p.sentAt > STALE_SEND_MS) return 'anyway'
  return 'no'
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

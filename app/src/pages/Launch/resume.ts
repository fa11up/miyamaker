import { keccak256, stringToBytes } from 'viem'

/**
 * A launch under way (Launch and Drop Music), kept in the browser so a reload or a closed window loses nothing: what
 * is uploaded, the create salt, the address it gives, and what has gone to the chain. Coming back looks at the chain
 * before anything is sent again, so a deposit is never paid twice and a second collection is never made.
 * Needs no wallet or `@/` imports, so `node --test` loads it (tests/launch-resume.test.mts).
 * The ideas are the MusicMaker branch's (releaseStore.ts, mintPlan.ts).
 */

type Hex = `0x${string}`

export type LaunchApp = 'launch' | 'music'

/** A wallet prompt that was open. If the app went away while it was, what it sent (if anything) was never heard. */
export type LaunchAsk = 'batch' | 'deploy' | 'first'

export type LaunchProgress = {
  /** The create salt. Every send reuses it, so the collection can only ever be made once. Drops have none. */
  salt?: Hex
  /** Where the factory said that salt puts the collection, so it can be found without a receipt. */
  predicted?: Hex
  /** The wallet is being asked, or was when the app went away. */
  asking?: LaunchAsk
  /** The wallet's pending nonce just before the open prompt: if it has moved on, something went out meanwhile. */
  askNonce?: number
  /** The block just before the open prompt, so a drop sent meanwhile can be looked for from there. */
  askBlock?: string
  /** When the last thing was asked for or sent. After a long time without an ending, Discard is offered anyway. */
  sentAt?: number
  /** A create-and-first-piece batch the wallet has, until the collection is known. */
  batchId?: string
  deployHash?: Hex
  /** The nonce the deploy went out at, so a dropped one can be told. */
  deployNonce?: number
  instance?: Hex
  /** The collection came from a batch, which is all or nothing: its first piece came with it and is never sent again. */
  batched?: boolean
  firstHash?: Hex
  firstNonce?: number
  /** The first piece (auction) or edition is on the chain. */
  firstDone?: boolean
  /** Its id, when known: the edition id, or the auction's token id. */
  firstId?: bigint
  /** What we sent was cancelled, replaced or never ran (its nonce was used by something else). */
  dropped?: boolean
}

export type SavedLaunch<T = unknown> = {
  app: LaunchApp
  account: string
  chainId: number
  /** The draft's content id (draftId): the same draft always finds the same record and salt. */
  draft: string
  /** What the record was made under, so the salt can be rebuilt. Moves on after a finished or discarded launch. */
  round: number
  /** A name for the banner. */
  label: string
  /** What the calls are built from, so a reload can finish without the form or the files. */
  input: T
  /** Upload kind ("image", "audio", "cover", "metadata") to its ar:// link. */
  uploads: Record<string, string>
  progress: LaunchProgress
  savedAt: number
}

/** The part of Storage this needs, so a test can hand in a map. */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'miya-launch:v1:'
const ROUND = 'miya-launch-round:v1:'
const UPLOAD = 'miya-launch-upload:v1:'

const scope = (app: LaunchApp, account: string, chainId: number) => `${PREFIX}${app}:${account.toLowerCase()}:${chainId}:`

export const launchKey = (app: LaunchApp, account: string, chainId: number, draft: string) =>
  `${scope(app, account, chainId)}${draft}`

/** The browser's storage, or nothing when it is blocked (a private window, cleared site data). */
export function browserStore(): KeyStore | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

// JSON has no bigint: each one is written as {"$bigint":"123"} and read back.
const BIG = '$bigint'

export function serializeLaunch(saved: SavedLaunch): string {
  return JSON.stringify(saved, (_, value) => (typeof value === 'bigint' ? { [BIG]: value.toString() } : value))
}

export function parseLaunch<T = unknown>(raw: string | null | undefined): SavedLaunch<T> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw, (_, value) =>
      value && typeof value === 'object' && typeof value[BIG] === 'string' && Object.keys(value).length === 1
        ? BigInt(value[BIG])
        : value
    ) as SavedLaunch<T>
    if (
      !parsed ||
      typeof parsed.account !== 'string' ||
      typeof parsed.draft !== 'string' ||
      !parsed.progress ||
      typeof parsed.progress !== 'object' ||
      !parsed.uploads ||
      typeof parsed.uploads !== 'object'
    )
      return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Writes the record and reads it back. False when there is no storage, it refused, or what came back differs: then a
 * reload would not find this launch and could send it again, so nothing may go to the chain.
 */
export function saveLaunch(store: KeyStore | undefined, saved: SavedLaunch): boolean {
  if (!store) return false
  try {
    const key = launchKey(saved.app, saved.account, saved.chainId, saved.draft)
    const raw = serializeLaunch(saved)
    store.setItem(key, raw)
    return store.getItem(key) === raw
  } catch {
    return false
  }
}

export function loadLaunch<T = unknown>(
  store: KeyStore | undefined,
  app: LaunchApp,
  account: string,
  chainId: number,
  draft: string
): SavedLaunch<T> | undefined {
  try {
    return parseLaunch<T>(store?.getItem(launchKey(app, account, chainId, draft)))
  } catch {
    return undefined
  }
}

/** Every launch this wallet has under way in this app on this chain, the latest first. */
export function findLaunches<T = unknown>(
  store: KeyStore | undefined,
  app: LaunchApp,
  account: string,
  chainId: number
): SavedLaunch<T>[] {
  if (!store) return []
  const at = scope(app, account, chainId)
  try {
    return Array.from({ length: store.length }, (_, i) => store.key(i))
      .filter((key): key is string => !!key?.startsWith(at))
      .map((key) => parseLaunch<T>(store.getItem(key)))
      .filter((saved): saved is SavedLaunch<T> => !!saved)
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

export function clearLaunch(store: KeyStore | undefined, saved: Pick<SavedLaunch, 'app' | 'account' | 'chainId' | 'draft'>) {
  try {
    store?.removeItem(launchKey(saved.app, saved.account, saved.chainId, saved.draft))
  } catch {
    // It stays until storage works again.
  }
}

/**
 * How many launches of this draft this wallet has finished or discarded. The salt includes it, so making the same
 * draft again on purpose gets its own address instead of finding the old collection.
 */
export function launchRound(store: KeyStore | undefined, app: LaunchApp, account: string, chainId: number, draft: string) {
  try {
    const n = Number(store?.getItem(`${ROUND}${app}:${account.toLowerCase()}:${chainId}:${draft}`))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function bumpLaunchRound(store: KeyStore | undefined, saved: Pick<SavedLaunch, 'app' | 'account' | 'chainId' | 'draft' | 'round'>) {
  try {
    const key = `${ROUND}${saved.app}:${saved.account.toLowerCase()}:${saved.chainId}:${saved.draft}`
    store?.setItem(key, String(Math.max(saved.round + 1, launchRound(store, saved.app, saved.account, saved.chainId, saved.draft))))
  } catch {
    // Only means the same draft made again would find this one's address, and be told it is already live.
  }
}

/** Uploads by their content key (contentKey). Arweave keeps a file for good, so the same bytes are paid for once. */
export function knownUpload(store: KeyStore | undefined, key: string): string | undefined {
  try {
    const uri = store?.getItem(`${UPLOAD}${key}`)
    return uri && uri.startsWith('ar://') ? uri : undefined
  } catch {
    return undefined
  }
}

export function rememberUpload(store: KeyStore | undefined, key: string, uri: string) {
  try {
    store?.setItem(`${UPLOAD}${key}`, uri)
  } catch {
    // Only loses the shortcut next time.
  }
}

/** JSON with keys sorted and bigints as strings, so the same draft always gives the same text. */
export function stableJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(`${value}n`)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** A draft's content id: everything the launch is built from (fields, files by their hash, links). */
export function draftId(parts: unknown): string {
  return keccak256(stringToBytes(stableJson(parts))).slice(2, 34)
}

/**
 * The create salt, from the wallet, the chain, the app and the draft's content, so a reload (or a lost record) can't
 * change it and the same draft can only make the one collection. Shaped like makeSalt (miyamints/launch.ts): the
 * factory, a zero byte, then 11 bytes, here from the hash.
 */
export function draftSalt(factory: string, account: string, chainId: number, app: LaunchApp, draft: string, round = 0): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error('bad factory address')
  const digest = keccak256(stringToBytes(`miya-launch-salt:${app}:${account.toLowerCase()}:${chainId}:${draft}:${round}`))
  return `0x${factory.slice(2).toLowerCase()}00${digest.slice(2, 24)}`
}

export type LaunchStep = 'wait-batch' | 'deploy' | 'wait-deploy' | 'first' | 'wait-first' | 'done'

/** The next thing to do. Anything already sent is waited on, never sent again: only a clear failure clears it. */
export function nextLaunchStep(p: LaunchProgress, hasFirst: boolean): LaunchStep {
  if (!p.instance) {
    if (p.batchId) return 'wait-batch'
    if (p.deployHash) return 'wait-deploy'
    return 'deploy'
  }
  if (!hasFirst || p.firstDone) return 'done'
  return p.firstHash ? 'wait-first' : 'first'
}

/** Something is on the chain, or may be, so what it was built from can't change any more. */
export function launchCommitted(p: LaunchProgress): boolean {
  return !!(p.batchId || p.deployHash || p.instance || p.asking)
}

/** Something was sent (or a prompt was open) and how it ended is not known yet. Until it is, nothing is sent again. */
export function launchUnsettled(p: LaunchProgress): boolean {
  return !!(p.asking || p.batchId || (p.deployHash && !p.instance) || (p.firstHash && !p.firstDone))
}

/** The wallet's transaction counts: `pending` counts what it has sent, `latest` what is mined. */
export type NonceRead = { pending: number; latest: number }

/**
 * A wallet prompt that was open when the app went away, judged by the wallet's nonce.
 * - 'not-sent': nothing has left the wallet since the prompt opened.
 * - 'in-flight': something left and is not mined yet. It may be ours: wait for it, never send another.
 * - 'mined': everything that left is mined, so the chain now says whether ours ran.
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

/** How long a send waits without an ending before Discard is offered anyway, with a warning. */
export const STALE_SEND_MS = 30 * 60_000

/**
 * Whether the launch can be dropped: 'free' when nothing is out, 'anyway' (with a warning) when what is out was dropped
 * or has had no ending for a long time, and 'no' while it may still land.
 */
export function discardChoice(p: LaunchProgress, now: number): 'free' | 'anyway' | 'no' {
  if (!launchUnsettled(p)) return 'free'
  if (p.dropped) return 'anyway'
  if (p.sentAt !== undefined && now - p.sentAt > STALE_SEND_MS) return 'anyway'
  return 'no'
}

/**
 * What a confirmed batch made: the collection from its log, or else the predicted address once code is there. Throws
 * (and the caller keeps the batch) when neither is known, so a retry waits on it again instead of sending anew.
 */
export function batchInstance(logged: Hex | undefined, predicted: Hex | undefined, codeAtPredicted: boolean | undefined): Hex {
  if (logged) return logged
  if (predicted && codeAtPredicted) return predicted
  throw new Error(
    'The batch went through, but the new collection could not be read back yet. Try again in a minute: it looks again and sends nothing new.'
  )
}

/** Where a saved launch stands, for the banner. */
export function resumeWords(p: LaunchProgress, hasFirst: boolean, firstName = 'the first piece'): string {
  const at = p.instance ? `The collection is live at ${p.instance.slice(0, 6)}…${p.instance.slice(-4)}` : ''
  // The create's hash stays once it has landed, so a prompt for the first piece is told by `asking` alone: it may
  // have paid (the auction's deposit), so it is never "without it yet".
  if (p.asking === 'first' && !p.firstHash)
    return `${at ? `${at}. ` : ''}A wallet request for ${firstName} was open when this closed. Continue checks the chain before sending anything.`
  if (p.asking && !p.batchId && !p.deployHash && !p.firstHash)
    return 'A wallet request was open when this closed. Continue checks the chain before sending anything.'
  switch (nextLaunchStep(p, hasFirst)) {
    case 'wait-batch':
      return 'Your wallet was sending the collection. Continue checks how it went and sends nothing new.'
    case 'wait-deploy':
      return 'The collection was sent. Continue checks how it went and sends nothing new.'
    case 'deploy':
      return 'Your files are stored. Nothing has gone to the chain yet.'
    case 'first':
      return `${at}, without ${firstName} yet. Continue checks the chain, then adds it.`
    case 'wait-first':
      return `${at}, and ${firstName} was sent. Continue checks how it went and sends nothing new.`
    default:
      return `${at}, and it is done.`
  }
}

/** Names an upload by its exact bytes, so a retry or a reload reuses what is stored and pays for nothing twice. */
export async function contentKey(kind: string, file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${kind}:${file.type}:${hex}`
}

/**
 * What to pay for before the first upload: every file still to be stored, as one total. Files already stored (by
 * their content key, or a link given instead) cost nothing.
 */
export function fundingPlan(files: { size: number; stored: boolean }[], freeBytes: number): number[] {
  return files.filter((f) => !f.stored && f.size > freeBytes).map((f) => f.size)
}

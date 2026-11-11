/**
 * Launch wizard form, validation and contract-argument builders for the miyamints factories:
 *   drop     → ERC721DropFactory.createDrop(InitParams, vault, alignmentBps)
 *   auction  → ERC721AuctionFactory.createInstance(salt, CreateParams), then queuePiece(tokenURI, deposit)
 *   editions → ERC1155Factory.createInstance(salt, CreateParams), then addEdition(...)
 * Drops and editions accept a list of tokens, each with its own price (TokenPrice[]); an auction house has one
 * currency. Amounts go through parseUnits at each token's decimals (./tokens); links must be http(s), ipfs or ar.
 * The edition curve is ../music/drop, imported without an extension so Vite and tsc load it and node:test appends .ts.
 */
import type { Address } from 'viem'
import { getAddress, isAddress, parseEther, zeroAddress } from 'viem'

import type { PayToken, PriceInputs, TokenPrice } from './tokens'
import { buildPrices, ETH, knownToken, parseAccepted, parseTokenAmount, pricesWords } from './tokens'
import { parseEdition } from '../music/drop'

/**
 * makeSalt and PRICING_MODEL match src/music/drop.ts. tests/miyamints-launch.test.mts checks both agree.
 */
export const PRICING_MODEL = { UNLIMITED: 0, LIMITED_FIXED: 1, LIMITED_DYNAMIC: 2 } as const
export const GATING_SCOPE_BOTH = 0

/** CreateX permissioned salt: factory ‖ 0x00 ‖ 11 random bytes (the factory is CreateX's caller). */
export function makeSalt(factory: string, random: Uint8Array): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error('bad factory address')
  if (random.length < 11) throw new Error('need 11 random bytes')
  const tail = Array.from(random.slice(0, 11), (b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${factory.slice(2).toLowerCase()}00${tail}`
}

/** Alignment share typed as a percent ("10" or "12.5") → bps, at least `minBps`, protocol fee + share ≤ 100%. */
export function parseAlignmentPct(
  input: string,
  minBps: number,
  protocolFeeBps = 0
): { ok: true; bps: number } | { ok: false; error: string } {
  const s = (input || '').trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Type a percent like 10 or 12.5.' }
  const [whole, frac = ''] = s.split('.')
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (bps < minBps) return { ok: false, error: `The share must be at least ${minBps / 100}%.` }
  if (bps + protocolFeeBps > 10_000) return { ok: false, error: 'The share plus the miya fee cannot pass 100%.' }
  return { ok: true, bps }
}

export type LaunchType = 'drop' | 'auction' | 'editions'
export type EditionKind = 'art' | 'music'
export type MediaMode = 'upload' | 'link'

/** `prices`: typed price per token address (lowercase). Blank = this phase doesn't sell for that token. */
export type PhaseForm = { start: string; end: string; prices: PriceInputs; maxPerWallet: string; supplyCap: string }

export type LaunchForm = {
  type: LaunchType | ''
  editionKind: EditionKind
  // artwork & metadata
  name: string
  symbol: string
  description: string
  website: string
  imageMode: MediaMode
  /** Files come from the wallet's earlier uploads: link mode, with the links picked from a menu. */
  fromUploads: boolean
  imageUri: string
  audioMode: MediaMode
  audioUri: string
  /** Known only when the track was picked from the wallet's uploads. */
  audioMime: string
  artist: string
  /** Drops and editions: the tokens buyers can pay with (addresses, lowercase). ETH is chosen to start. */
  tokens: string[]
  // drop
  supply: string
  ownerReserve: string
  phases: PhaseForm[]
  royaltyPct: string
  revealUri: string
  // auction
  /** The house's one currency (address, lowercase): deposit, bids and refunds are all in it. */
  currency: string
  reserve: string
  durationHours: string
  bidStep: string
  // editions
  /** Price per copy for each accepted token: every one needs a price above 0. */
  editionPrices: PriceInputs
  editionSupply: string
  /** Bonding-curve rise, as a percent. Blank or 0 is a flat price. 1 is 1% more each copy. */
  editionRise: string
  editionStart: string
  // alignment
  vaultChoice: 'default' | 'custom'
  customVault: string
  alignmentPct: string
}

export const MAX_PHASES = 3
export const AUCTION_TIME_BUFFER_SECONDS = 300
export const MAX_ROYALTY_BPS = 1000

export const EMPTY_PHASE: PhaseForm = { start: '', end: '', prices: {}, maxPerWallet: '', supplyCap: '' }

export const EMPTY_FORM: LaunchForm = {
  type: '',
  editionKind: 'art',
  name: '',
  symbol: '',
  description: '',
  website: '',
  imageMode: 'upload',
  fromUploads: false,
  imageUri: '',
  audioMode: 'upload',
  audioUri: '',
  audioMime: '',
  artist: '',
  tokens: [ETH],
  supply: '',
  ownerReserve: '',
  phases: [{ ...EMPTY_PHASE }],
  royaltyPct: '5',
  revealUri: '',
  currency: ETH,
  reserve: '',
  durationHours: '24',
  bidStep: '0.01',
  editionPrices: {},
  editionSupply: '',
  editionRise: '',
  editionStart: '',
  vaultChoice: 'default',
  customVault: '',
  alignmentPct: '10',
}

/**
 * A form saved before multi-token sales (one ETH `price`, `editionPrice`), as today's form: its ETH prices are kept,
 * ETH is the one token, and an auction is in ETH.
 */
export function upgradeForm(saved: LaunchForm): LaunchForm {
  const old = saved as LaunchForm & { editionPrice?: string; phases: (PhaseForm & { price?: string })[] }
  const f: LaunchForm = { ...EMPTY_FORM, ...old }
  if (!Array.isArray(old.tokens) || !old.tokens.length) f.tokens = [ETH]
  if (typeof old.currency !== 'string' || !old.currency) f.currency = ETH
  if (!old.editionPrices || typeof old.editionPrices !== 'object') {
    f.editionPrices = old.editionPrice ? { [ETH]: old.editionPrice } : {}
  }
  const phases: (PhaseForm & { price?: string })[] = old.phases?.length ? old.phases : [EMPTY_PHASE]
  f.phases = phases.map((p) => {
    const { price, ...rest } = p
    const prices = p.prices && typeof p.prices === 'object' ? p.prices : price ? { [ETH]: price } : {}
    return { ...EMPTY_PHASE, ...rest, prices }
  })
  delete (f as { editionPrice?: string }).editionPrice
  return f
}

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }
export type Result<T> = Ok<T> | Err

// ── field parsers ────────────────────────────────────────────────────────────

const LINK = /^(https?:\/\/[^\s/$.?#][^\s]*|ipfs:\/\/[^\s]+|ar:\/\/[^\s]+)$/i

/** A link people paste: http(s), ipfs:// or ar:// only, no spaces or quotes, at most 2048 characters. */
export function parseLink(input: string, required = true): Result<{ uri: string }> {
  const s = (input || '').trim()
  if (!s) return required ? { ok: false, error: 'Add a link.' } : { ok: true, uri: '' }
  // eslint-disable-next-line no-control-regex
  if (s.length > 2048 || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(s) || !LINK.test(s)) {
    return { ok: false, error: 'Use a link that starts with https://, ipfs:// or ar://.' }
  }

  if (/^https?:/i.test(s)) {
    try {
      const u = new URL(s)
      if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('host')
    } catch {
      return { ok: false, error: 'That web link does not look right.' }
    }
  }

  return { ok: true, uri: s }
}

/** ETH typed by a person → wei via parseEther. `allowZero` for free mints. */
export function parseEth(input: string, opts: { allowZero?: boolean; label?: string } = {}): Result<{ wei: bigint }> {
  const label = opts.label || 'Price'
  const s = (input || '').trim()
  if (!s) return { ok: false, error: `${label}: type an amount in ETH, like 0.01.` }
  if (!/^(\d{1,9}(\.\d{0,18})?|\.\d{1,18})$/.test(s)) {
    return { ok: false, error: `${label}: use a plain number like 0.01.` }
  }

  const wei = parseEther(s.startsWith('.') ? `0${s}` : s)
  if (wei === 0n && !opts.allowZero) return { ok: false, error: `${label} must be more than 0.` }
  return { ok: true, wei }
}

export function parseWhole(
  input: string,
  opts: { min: number; max: number; label: string; blank?: number }
): Result<{ n: number }> {
  const s = (input || '').trim()
  if (!s && opts.blank !== undefined) return { ok: true, n: opts.blank }
  if (!/^\d{1,10}$/.test(s)) return { ok: false, error: `${opts.label}: use a whole number.` }
  const n = Number(s)
  if (n < opts.min) return { ok: false, error: `${opts.label} must be at least ${opts.min}.` }
  if (n > opts.max) return { ok: false, error: `${opts.label} can be at most ${opts.max.toLocaleString('en-US')}.` }
  return { ok: true, n }
}

/** Pieces kept for the artist to give away. Blank means none. At least one must stay on sale, or no phase can sell. */
export const parseReserve = (input: string, supply: number) =>
  parseWhole(input, { min: 0, max: supply - 1, label: 'Pieces kept back', blank: 0 })

export function parseName(input: string): Result<{ name: string }> {
  const s = (input || '').replace(/\s+/g, ' ').trim()
  if (!s) return { ok: false, error: 'Give your collection a name.' }
  if (s.length > 64) return { ok: false, error: 'Keep the name under 64 characters.' }
  return { ok: true, name: s }
}

export function parseSymbol(input: string): Result<{ symbol: string }> {
  const s = (input || '').trim().toUpperCase()
  if (!s) return { ok: false, error: 'Add a short ticker, like MIYA.' }
  if (!/^[A-Z0-9]{1,10}$/.test(s)) return { ok: false, error: 'Ticker: 1 to 10 letters or numbers, no spaces.' }
  return { ok: true, symbol: s }
}

/** Royalty on resales, percent → bps (uint96), 0 to 10%. */
export function parseRoyaltyPct(input: string): Result<{ bps: number }> {
  const s = (input || '').trim()
  if (!s) return { ok: true, bps: 0 }
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Royalty: a percent like 5 or 7.5.' }
  const [w, f = ''] = s.split('.')
  const bps = Number(w) * 100 + Number(f.padEnd(2, '0'))
  if (bps > MAX_ROYALTY_BPS) return { ok: false, error: 'Royalty can be at most 10%.' }
  return { ok: true, bps }
}

/** `<input type="datetime-local">` value → unix seconds. Blank = `blank`. */
export function parseLocalTime(input: string, blank: bigint): Result<{ at: bigint }> {
  const s = (input || '').trim()
  if (!s) return { ok: true, at: blank }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return { ok: false, error: 'Pick a date and time.' }
  const ms = new Date(s).getTime()
  if (!Number.isFinite(ms)) return { ok: false, error: 'Pick a date and time.' }
  return { ok: true, at: BigInt(Math.floor(ms / 1000)) }
}

export function parseVault(input: string): Result<{ vault: Address }> {
  const s = (input || '').trim()
  if (!isAddress(s, { strict: false }))
    return { ok: false, error: 'Paste a vault address (0x followed by 40 characters).' }
  if (s.toLowerCase() === zeroAddress) return { ok: false, error: 'That is the empty address.' }
  return { ok: true, vault: getAddress(s) }
}

// ── phases ───────────────────────────────────────────────────────────────────

export type Phase = {
  start: bigint
  end: bigint
  maxPerWallet: number
  merkleRoot: `0x${string}`
  supplyCap: number
  prices: TokenPrice[]
}

const ZERO_ROOT = `0x${'0'.repeat(64)}` as const

/**
 * Sale phases for ERC721DropInstance. Public only (no allowlist). A blank start means "right away" (`now`). Each phase
 * prices some of the accepted `tokens` (0 = free in that token); a blank leaves a token out of that phase.
 */
export function buildPhases(
  phases: PhaseForm[],
  now: bigint,
  tokens: readonly PayToken[]
): Result<{ phases: Phase[]; errors: string[] }> {
  const errors: string[] = []
  const out: Phase[] = []
  if (!phases.length) return { ok: false, error: 'Add at least one sale phase.' }
  if (phases.length > MAX_PHASES) return { ok: false, error: `At most ${MAX_PHASES} phases.` }
  phases.forEach((p, i) => {
    const n = phases.length > 1 ? ` (phase ${i + 1})` : ''
    const start = parseLocalTime(p.start, now)
    const end = parseLocalTime(p.end, 0n)
    const price = buildPrices(p.prices || {}, tokens, { required: false, allowZero: true, label: `Price${n}` })
    const cap = parseWhole(p.maxPerWallet, { min: 1, max: 100_000, label: `Per-wallet limit${n}`, blank: 0 })
    const supplyCap = parseWhole(p.supplyCap, { min: 1, max: 100_000, label: `Pieces for sale${n}`, blank: 0 })
    if (!start.ok) errors[i] = `Start${n}: ${start.error}`
    else if (!end.ok) errors[i] = `End${n}: ${end.error}`
    else if (!price.ok) errors[i] = price.error
    else if (!cap.ok) errors[i] = cap.error
    else if (!supplyCap.ok) errors[i] = supplyCap.error
    else if (end.at !== 0n && end.at <= start.at) errors[i] = `The end${n} must be after the start.`
    else if (end.at !== 0n && end.at <= now) errors[i] = `The end${n} is already in the past.`
    else {
      out.push({
        start: start.at,
        end: end.at,
        maxPerWallet: cap.n,
        merkleRoot: ZERO_ROOT,
        supplyCap: supplyCap.n,
        prices: price.prices,
      })
    }
  })
  if (errors.some(Boolean)) return { ok: false, error: errors.filter(Boolean)[0] as string }
  return { ok: true, phases: out, errors }
}

// ── metadata ─────────────────────────────────────────────────────────────────

/** JSON stored on-chain as a percent-encoded data URI (readable by Mint, Manage and marketplaces). */
export function jsonDataUri(json: unknown): string {
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(json))}`
}

export function collectionJson(f: { name: string; description: string; image: string; website: string }) {
  return {
    name: f.name,
    description: f.description,
    image: f.image,
    ...(f.website ? { external_link: f.website } : {}),
  }
}

export function tokenJson(f: {
  name: string
  description: string
  image: string
  website: string
  audio?: { uri: string; mime?: string; artist?: string }
}) {
  return {
    name: f.name,
    description: f.description,
    image: f.image,
    ...(f.website ? { external_url: f.website } : {}),
    ...(f.audio
      ? {
          animation_url: f.audio.uri,
          ...(f.audio.mime ? { mime_type: f.audio.mime } : {}),
          properties: { category: 'audio', ...(f.audio.artist ? { artist: f.audio.artist } : {}) },
          attributes: f.audio.artist ? [{ trait_type: 'Artist', value: f.audio.artist }] : [],
        }
      : {}),
  }
}

// ── validation per wizard step ───────────────────────────────────────────────

export type StepKey = 'type' | 'art' | 'sale' | 'align' | 'review'
export const STEP_ORDER: StepKey[] = ['type', 'art', 'sale', 'align', 'review']

export type Media = { hasFile: boolean; fileError?: string }

export type ValidationContext = {
  now: bigint
  /** The chain the launch goes to: which tokens exist there. */
  chainId: number
  /** The registry's allowlist (paymentTokens()) once read: a token it dropped can't be picked. */
  allowed?: readonly string[]
  /** Undefined until the registry has been read: the share can't be checked against a guess. */
  minAlignmentBps?: number
  protocolFeeBps?: number
  /** The registry read failed, so the share rules are unknown. */
  rulesFailed?: boolean
  image: Media
  audio: Media
}

export type FieldErrors = Partial<Record<string, string>>

export function validateStep(step: StepKey, f: LaunchForm, ctx: ValidationContext): FieldErrors {
  const e: FieldErrors = {}
  if (step === 'type') {
    if (!f.type) e.type = 'Pick what you are launching.'
    return e
  }

  if (step === 'art') {
    const name = parseName(f.name)
    if (!name.ok) e.name = name.error
    if (f.type !== 'editions') {
      const sym = parseSymbol(f.symbol)
      if (!sym.ok) e.symbol = sym.error
    }

    if (f.description.length > 1000) e.description = 'Keep the description under 1000 characters.'
    const web = parseLink(f.website, false)
    if (!web.ok || (web.uri && !/^https?:/i.test(web.uri))) e.website = 'Website: use a link that starts with https://.'
    if (f.imageMode === 'upload') {
      if (!ctx.image.hasFile) e.image = 'Add your artwork.'
      else if (ctx.image.fileError) e.image = ctx.image.fileError
    } else {
      const img = parseLink(f.imageUri)
      if (!img.ok) e.image = img.error
    }

    if (f.type === 'editions' && f.editionKind === 'music') {
      if (f.audioMode === 'upload') {
        if (!ctx.audio.hasFile) e.audio = 'Add your track.'
        else if (ctx.audio.fileError) e.audio = ctx.audio.fileError
      } else {
        const a = parseLink(f.audioUri)
        if (!a.ok) e.audio = a.error
      }

      if (f.artist.length > 100) e.artist = 'Keep the artist name under 100 characters.'
    }

    return e
  }

  if (step === 'sale') {
    const accepted = parseAccepted(f.tokens, ctx.chainId, ctx.allowed)
    if (f.type !== 'auction' && !accepted.ok) e.tokens = accepted.error
    const tokens = accepted.ok ? accepted.tokens : []
    if (f.type === 'drop') {
      const s = parseWhole(f.supply, { min: 1, max: 100_000, label: 'Supply' })
      if (!s.ok) e.supply = s.error
      const reserve = parseReserve(f.ownerReserve, s.ok ? s.n : 100_000)
      if (!reserve.ok) e.ownerReserve = reserve.error
      const ph = buildPhases(f.phases, ctx.now, tokens)
      if (!ph.ok) e.phases = accepted.ok ? ph.error : undefined
      else if (s.ok && reserve.ok && ph.phases.some((p) => p.supplyCap > s.n - reserve.n)) {
        e.phases = `A phase can sell at most ${(s.n - reserve.n).toLocaleString('en-US')} pieces.`
      }

      const r = parseRoyaltyPct(f.royaltyPct)
      if (!r.ok) e.royaltyPct = r.error
      const reveal = parseLink(f.revealUri, false)
      if (!reveal.ok) e.revealUri = reveal.error
    } else if (f.type === 'auction') {
      const cur = auctionCurrency(f, ctx.chainId, ctx.allowed)
      if (!cur) {
        const was = knownToken(ctx.chainId, f.currency || ETH)
        e.currency = was
          ? `miya no longer accepts ${was.symbol}. Pick another token for bids.`
          : 'Pick the token bids are made in.'
      }
      else {
        const r = parseTokenAmount(f.reserve, cur, { label: 'Starting bid' })
        if (!r.ok) e.reserve = r.error
        const b = parseTokenAmount(f.bidStep, cur, { label: 'Bid step' })
        if (!b.ok) e.bidStep = b.error
      }
      const d = parseWhole(f.durationHours, { min: 1, max: 24 * 30, label: 'Auction length' })
      if (!d.ok) e.durationHours = d.error
    } else if (f.type === 'editions') {
      const p = buildPrices(f.editionPrices, tokens, { required: true, allowZero: false, label: 'Price per copy' })
      if (!p.ok && accepted.ok) e.editionPrices = p.error
      const s = parseWhole(f.editionSupply, { min: 1, max: 1_000_000, label: 'Supply', blank: 0 })
      if (!s.ok) e.editionSupply = s.error
      else {
        const curve = parseEdition(s.n ? String(s.n) : '', f.editionRise || '')
        if (!curve.ok) e.editionRise = curve.error
      }
      const t = parseLocalTime(f.editionStart, 0n)
      if (!t.ok) e.editionStart = t.error
    }

    return e
  }

  if (step === 'align') {
    if (ctx.minAlignmentBps === undefined || ctx.protocolFeeBps === undefined) {
      e.alignmentPct = ctx.rulesFailed
        ? "Couldn't read the vault share rules from the network. Try again in a minute."
        : 'Loading the vault share rules…'
    } else {
      const a = parseAlignmentPct(f.alignmentPct, ctx.minAlignmentBps, ctx.protocolFeeBps)
      if (!a.ok) e.alignmentPct = a.error
    }
    if (f.vaultChoice === 'custom') {
      const v = parseVault(f.customVault)
      if (!v.ok) e.customVault = v.error
    }

    return e
  }

  return {
    ...validateStep('type', f, ctx),
    ...validateStep('art', f, ctx),
    ...validateStep('sale', f, ctx),
    ...validateStep('align', f, ctx),
  }
}

// ── contract arguments ───────────────────────────────────────────────────────

export type Resolved = {
  creator: Address
  vault: Address
  alignmentBps: number
  /** Final artwork / audio URIs (after any upload). */
  image: string
  audio?: string
  audioMime?: string
}

function clean(f: LaunchForm) {
  const name = parseName(f.name)
  const web = parseLink(f.website, false)
  return {
    name: name.ok ? name.name : '',
    description: f.description.trim(),
    website: web.ok ? web.uri : '',
  }
}

/** The auction house's currency as a known token on this chain (and on `allowed`, once read), or undefined. */
export function auctionCurrency(
  f: Pick<LaunchForm, 'currency'>,
  chainId: number,
  allowed?: readonly string[]
): PayToken | undefined {
  const t = knownToken(chainId, f.currency || ETH)
  return t && parseAccepted([t.address], chainId, allowed).ok ? t : undefined
}

/** The accepted tokens, or throws: only for builders, after validateStep passed. */
function acceptedOrThrow(f: LaunchForm, chainId: number): PayToken[] {
  const a = parseAccepted(f.tokens, chainId)
  if (!a.ok) throw new Error('Fix the highlighted fields first.')
  return a.tokens
}

/** ERC721DropFactory.createDrop args. */
export function buildDropArgs(f: LaunchForm, r: Resolved, now: bigint, chainId: number) {
  const c = clean(f)
  const sym = parseSymbol(f.symbol)
  const supply = parseWhole(f.supply, { min: 1, max: 100_000, label: 'Supply' })
  const tokens = acceptedOrThrow(f, chainId)
  const phases = buildPhases(f.phases, now, tokens)
  const royalty = parseRoyaltyPct(f.royaltyPct)
  const reveal = parseLink(f.revealUri, false)
  const reserve = parseReserve(f.ownerReserve, supply.ok ? supply.n : 100_000)
  if (!sym.ok || !supply.ok || !reserve.ok || !phases.ok || !royalty.ok || !reveal.ok || !c.name) {
    throw new Error('Fix the highlighted fields first.')
  }

  const contractURI = jsonDataUri(collectionJson({ ...c, image: r.image }))
  const unrevealedURI = jsonDataUri(tokenJson({ ...c, image: r.image }))
  return [
    {
      name: c.name,
      symbol: sym.symbol,
      maxSupply: supply.n,
      ownerReserve: reserve.n,
      baseURI: reveal.uri,
      unrevealedURI,
      contractURI,
      royaltyReceiver: royalty.bps > 0 ? r.creator : zeroAddress,
      royaltyBps: BigInt(royalty.bps),
      acceptedTokens: tokens.map((t) => t.address),
      phases: phases.phases,
    },
    r.vault,
    r.alignmentBps,
  ] as const
}

/**
 * ERC721AuctionFactory.createInstance args + the first queuePiece(tokenURI, deposit) call. ETH: `value` is the deposit.
 * An ERC-20: `value` 0 and `approve` is the exact deposit, approved to the new house before queuePiece.
 */
export function buildAuctionArgs(f: LaunchForm, r: Resolved, salt: `0x${string}`, chainId: number) {
  const c = clean(f)
  const sym = parseSymbol(f.symbol)
  const cur = auctionCurrency(f, chainId)
  if (!cur) throw new Error('Fix the highlighted fields first.')
  const reserve = parseTokenAmount(f.reserve, cur, { label: 'Starting bid' })
  const hours = parseWhole(f.durationHours, { min: 1, max: 24 * 30, label: 'Auction length' })
  const step = parseTokenAmount(f.bidStep, cur, { label: 'Bid step' })
  if (!sym.ok || !reserve.ok || !hours.ok || !step.ok || !c.name) throw new Error('Fix the highlighted fields first.')
  const eth = cur.address === ETH
  return {
    create: [
      salt,
      {
        name: c.name,
        metadataURI: jsonDataUri(collectionJson({ ...c, image: r.image })),
        creator: r.creator,
        vault: r.vault,
        alignmentBps: r.alignmentBps,
        symbol: sym.symbol,
        lines: 1,
        baseDuration: hours.n * 3600,
        timeBuffer: AUCTION_TIME_BUFFER_SECONDS,
        bidIncrement: step.amount,
        currency: cur.address,
      },
    ] as const,
    queue: {
      tokenURI: jsonDataUri(tokenJson({ ...c, image: r.image })),
      deposit: reserve.amount,
      value: eth ? reserve.amount : 0n,
      approve: eth ? undefined : { token: cur.address, amount: reserve.amount },
    },
    currency: cur,
  }
}

/** ERC1155Factory.createInstance args + the first addEdition call. */
export function buildEditionArgs(f: LaunchForm, r: Resolved, salt: `0x${string}`, chainId: number) {
  const c = clean(f)
  const tokens = acceptedOrThrow(f, chainId)
  const price = buildPrices(f.editionPrices, tokens, { required: true, allowZero: false, label: 'Price per copy' })
  const supply = parseWhole(f.editionSupply, { min: 1, max: 1_000_000, label: 'Supply', blank: 0 })
  const open = parseLocalTime(f.editionStart, 0n)
  if (!price.ok || !supply.ok || !open.ok || !c.name) throw new Error('Fix the highlighted fields first.')
  const curve = parseEdition(supply.n ? String(supply.n) : '', f.editionRise || '')
  if (!curve.ok) throw new Error(curve.error)
  const music = f.editionKind === 'music' && r.audio
  const token = tokenJson({
    ...c,
    image: r.image,
    audio: music ? { uri: r.audio as string, mime: r.audioMime, artist: f.artist.trim() || undefined } : undefined,
  })
  const metadataURI = jsonDataUri(token)
  return {
    create: [
      salt,
      {
        name: c.name,
        metadataURI: jsonDataUri(collectionJson({ ...c, image: r.image })),
        creator: r.creator,
        vault: r.vault,
        alignmentBps: r.alignmentBps,
        styleUri: '',
        gatingModule: zeroAddress,
        freeMint: { allocation: 0n, scope: GATING_SCOPE_BOTH },
        acceptedTokens: tokens.map((t) => t.address),
      },
    ] as const,
    // ERC1155Instance.addEdition(pieceTitle, prices, supply, metadataURI, pricingModel, priceIncreaseRate, openTime)
    edition: [c.name, price.prices, curve.supply, metadataURI, curve.model, curve.rate, open.at] as const,
  }
}

/** What happens on-chain, in order, for the review screen. */
export function txPlan(type: LaunchType, currency?: PayToken): { id: 'deploy' | 'first'; label: string }[] {
  if (type === 'drop') return [{ id: 'deploy', label: 'Create the collection' }]
  if (type === 'auction') {
    const erc20 = !!currency && currency.address !== ETH
    return [
      { id: 'deploy', label: 'Create the auction house' },
      {
        id: 'first',
        label: erc20
          ? `Put your piece up (allow exactly the starting bid in ${currency.symbol}, then pay it)`
          : 'Put your piece up (pays the starting bid)',
      },
    ]
  }

  return [
    { id: 'deploy', label: 'Create the collection' },
    { id: 'first', label: 'Add your first edition' },
  ]
}

// ── plain words for the Review step ──────────────────────────────────────────

/** A datetime-local value as "12 Nov 18:00", in the person's own time zone. */
export function whenWords(local: string): string {
  return new Date(local)
    .toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
}

/** The phase's prices in words: "0.02 ETH or 50 USDC", "Free", or "—" while one can't be read. */
export function phasePriceWords(p: PhaseForm, tokens: readonly PayToken[]): string {
  const built = buildPrices(p.prices || {}, tokens, { required: false, allowZero: true })
  if (!built.ok) return '—'
  return pricesWords(built.prices.map((x) => ({ price: x.price, token: tokens.find((t) => t.address === x.token)! })))
}

/** One sale phase on one line: "0.02 ETH or 50 USDC, limit 2 per wallet, starts 12 Nov 18:00". */
export function phaseLine(p: PhaseForm, tokens: readonly PayToken[]): string {
  const cap = parseWhole(p.maxPerWallet, { min: 1, max: 100_000, label: 'Limit', blank: 0 })
  const sale = parseWhole(p.supplyCap, { min: 1, max: 100_000, label: 'Pieces', blank: 0 })
  return [
    phasePriceWords(p, tokens),
    cap.ok && cap.n ? `limit ${cap.n} per wallet` : 'no limit per wallet',
    ...(sale.ok && sale.n ? [`${sale.n.toLocaleString('en-US')} for sale`] : []),
    p.start ? `starts ${whenWords(p.start)}` : 'starts right away',
    ...(p.end ? [`ends ${whenWords(p.end)}`] : []),
  ].join(', ')
}

/** Which of a phase's boxes hold something that cannot be used. The step's error names the phase; these mark the box. */
export function phaseFieldsBad(
  p: PhaseForm,
  tokens: readonly PayToken[]
): Partial<Record<Exclude<keyof PhaseForm, 'prices'>, boolean>> & { prices: Record<string, boolean> } {
  const start = parseLocalTime(p.start, 0n)
  const end = parseLocalTime(p.end, 0n)
  const prices: Record<string, boolean> = {}
  // Blank leaves a token out, but a phase with no price at all is what the step refuses: then every box is at fault.
  const none = tokens.every((t) => !(p.prices?.[t.address.toLowerCase()] || '').trim())
  for (const t of tokens) {
    const raw = (p.prices?.[t.address.toLowerCase()] || '').trim()
    prices[t.address.toLowerCase()] = none || (!!raw && !parseTokenAmount(raw, t, { allowZero: true }).ok)
  }
  return {
    prices,
    maxPerWallet: !parseWhole(p.maxPerWallet, { min: 1, max: 100_000, label: 'Limit', blank: 0 }).ok,
    supplyCap: !parseWhole(p.supplyCap, { min: 1, max: 100_000, label: 'Pieces', blank: 0 }).ok,
    start: !start.ok,
    end: !end.ok || (end.at !== 0n && start.ok && start.at !== 0n && end.at <= start.at),
  }
}

/** The fields worth asking about before closing. Picking a kind or leaving a default is nothing to lose. */
const DRAFT_FIELDS: (keyof LaunchForm)[] = [
  'name',
  'symbol',
  'description',
  'website',
  'imageUri',
  'audioUri',
  'artist',
  'supply',
  'ownerReserve',
  'royaltyPct',
  'revealUri',
  'reserve',
  'durationHours',
  'bidStep',
  'editionSupply',
  'editionRise',
  'editionStart',
  'customVault',
]

/** Whether closing the window would lose anything typed or chosen. */
export function draftHasData(f: LaunchForm, hasFiles: boolean): boolean {
  if (hasFiles) return true
  if (DRAFT_FIELDS.some((k) => f[k] !== EMPTY_FORM[k])) return true
  if (Object.values(f.editionPrices || {}).some((v) => !!v.trim())) return true
  const p = f.phases[0]
  return (
    f.phases.length > 1 ||
    !!(p && (p.start || p.end || p.maxPerWallet || p.supplyCap || Object.values(p.prices || {}).some((v) => !!v.trim())))
  )
}

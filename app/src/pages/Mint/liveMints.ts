/**
 * Live mints shown on the Mint window's home page.
 *
 * Pure data + logic (no React, no `@/` imports, no import.meta) so `yarn test` can run it under plain node.
 * On-chain reads live in useLiveMints.ts; this file turns a curated list plus whatever the chain says into the
 * ordered cards the home page renders.
 */

export type LiveMintKind =
  /** Legacy ERC721M clone from the old MiyaMints factory: price(), mintOpen(), mint(amount). MIYAMINI is one. */
  | 'erc721m'
  /** miyamints ERC721DropInstance (contracts/src/factories/erc721drop): phases(), mint(phaseId, qty, proof, token, maxCost). */
  | 'drop'

export type LiveMintEntry = {
  /** URL slug: /mint/<slug>. Lowercase letters, digits and dashes. */
  slug: string
  name: string
  kind: LiveMintKind
  chainId: number
  /** Contract address, or undefined while we don't know it yet (renders as a "coming soon" card). */
  address?: `0x${string}`
  /** Optional overrides: cover image, one-line pitch, artist credit. */
  image?: string
  blurb?: string
  artist?: string
  /** Path of the artist's logo (under public/) and a link for their name. */
  artistLogo?: string
  artistUrl?: string
  /** Dedicated view instead of the generic mint view (MIYAMINI keeps its own page). */
  view?: 'miyamini'
  /** Pin to the top of the list (lower first). Unpinned entries sort after pinned ones. */
  pin?: number
}

/** What the chain told us about one collection. Any field may be missing when a read failed. */
export type LiveMintReads = {
  name?: string
  /** Drops: who owns the collection, credited when there is no curated artist. */
  owner?: `0x${string}`
  /** The price in ETH; undefined when the live phase doesn't sell for ETH (see `prices`). */
  price?: bigint
  /** Drops: every token the live phase sells for, with its price per piece (address(0) = ETH). */
  prices?: readonly TokenPriceRead[]
  /** Short price words when there is no ETH price ("25 USDC"), for the cards. */
  priceLabel?: string
  totalSupply?: number
  maxSupply?: number
  mintOpen?: boolean
  /** Drops: pieces phases can still sell, after the artist's reserve. */
  publicRemaining?: number
  /** Drops: what the live phase can still sell, or publicRemaining when no phase is live. */
  left?: number
  image?: string
  /** Contract-level metadata (cover image) for collections without a curated image. */
  contractURI?: string
}

export type TokenPriceRead = { token: `0x${string}`; price: bigint }

export type LiveMintStatus = 'open' | 'closed' | 'soldout' | 'soon' | 'unknown'

export type LiveMintCard = {
  key: string
  slug: string
  name: string
  kind: LiveMintKind
  chainId: number
  chainName: string
  address?: `0x${string}`
  image?: string
  contractURI?: string
  blurb?: string
  artist?: string
  artistLogo?: string
  artistUrl?: string
  /** Drops with no curated credit: the collection's owner. */
  artistAddress?: `0x${string}`
  view?: 'miyamini'
  status: LiveMintStatus
  price?: bigint
  prices?: readonly TokenPriceRead[]
  priceLabel?: string
  minted?: number
  supply?: number
  /** Drops: what can still be minted right now. */
  left?: number
  /** 0..1, undefined when supply is unknown. */
  progress?: number
  /** Cards that can open a mint view (has an address). */
  clickable: boolean
  source: 'curated' | 'registry'
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const ZERO_RE = /^0x0{40}$/

export function isLiveAddress(a: unknown): a is `0x${string}` {
  return typeof a === 'string' && ADDRESS_RE.test(a) && !ZERO_RE.test(a)
}

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  8453: 'Base',
  4663: 'Robinhood Chain',
}

export const chainName = (chainId: number) => CHAIN_NAMES[chainId] || `Chain ${chainId}`

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'collection'
  )
}

/**
 * Curated list. MIYAMINI first; then the rest of the miyamaker group.
 *
 * Verified 2026-11-02: the legacy MiyaMints factory (0x37d2…3420) emitted exactly one `Deployed` event (MIYAMINI),
 * so there are no other old factory collections to list.
 */
export const LIVE_MINTS: LiveMintEntry[] = [
  {
    slug: 'miyamini',
    name: 'miyamaker mini',
    kind: 'erc721m',
    chainId: 1,
    // Same as MIYAMINI_CONTRACT in constants/contracts.ts (kept literal so this file stays importable from tests).
    address: '0x375a1911c0c2982f59826c227b7830e5d5985d59',
    image: 'https://koolskull.com/miyamakermini/metadata/images/1.png',
    blurb: '1,024 tiny miyamakers. The first miyamaker mint.',
    artist: 'koolskull.eth',
    artistLogo: '/artists/koolskull.png',
    artistUrl: 'https://koolskull.com/',
    view: 'miyamini',
    pin: 0,
  },
]

function finiteOrUndefined(n: number | undefined) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Lookup key for a curated entry's reads. */
export function entryKey(entry: Pick<LiveMintEntry, 'chainId' | 'address' | 'slug'>) {
  return `${entry.chainId}:${(isLiveAddress(entry.address) ? entry.address : entry.slug).toLowerCase()}`
}

/** Turns one entry plus its chain reads into a card. Never throws: bad or missing data becomes a quieter card. */
export function toCard(
  entry: LiveMintEntry,
  reads: LiveMintReads | undefined,
  source: LiveMintCard['source']
): LiveMintCard {
  const address = isLiveAddress(entry.address) ? entry.address : undefined
  const minted = finiteOrUndefined(reads?.totalSupply)
  const supply = finiteOrUndefined(reads?.maxSupply)
  const soldOut =
    reads?.publicRemaining === 0 || (minted !== undefined && supply !== undefined && supply > 0 && minted >= supply)

  let status: LiveMintStatus
  if (!address) status = 'soon'
  else if (soldOut) status = 'soldout'
  else if (reads?.mintOpen === true) status = 'open'
  else if (reads?.mintOpen === false) status = 'closed'
  else status = 'unknown'

  return {
    key: `${entry.chainId}:${(address || entry.slug).toLowerCase()}`,
    slug: entry.slug,
    name: entry.name || reads?.name || 'Untitled',
    kind: entry.kind,
    chainId: entry.chainId,
    chainName: chainName(entry.chainId),
    address,
    image: entry.image || reads?.image,
    contractURI: reads?.contractURI,
    blurb: entry.blurb,
    artist: entry.artist,
    artistLogo: entry.artistLogo,
    artistUrl: entry.artistUrl,
    artistAddress: entry.artist ? undefined : reads?.owner,
    view: entry.view,
    status,
    price: reads?.price,
    prices: reads?.prices,
    priceLabel: reads?.priceLabel,
    minted,
    supply,
    left: finiteOrUndefined(reads?.left),
    progress: minted !== undefined && supply ? Math.min(1, Math.max(0, minted / supply)) : undefined,
    clickable: !!address,
    source,
  }
}

const STATUS_ORDER: Record<LiveMintStatus, number> = { open: 0, unknown: 1, closed: 2, soldout: 3, soon: 4 }

/**
 * Merges curated entries and registry-discovered collections into the ordered card list:
 * - one card per chain+address (curated wins over registry, so overrides stick);
 * - pinned curated entries first (MIYAMINI at 0) - except "coming soon" entries, which always sit at the end;
 * - then open before closed before sold out; registry entries keep their discovery order within a status.
 * Slugs are made unique so every card has its own deep link.
 */
export function buildLiveMintList(
  curated: LiveMintEntry[],
  curatedReads: Record<string, LiveMintReads | undefined>,
  registry: { entry: LiveMintEntry; reads?: LiveMintReads }[] = []
): LiveMintCard[] {
  const seen = new Set<string>()
  const cards: (LiveMintCard & { pin: number; order: number })[] = []

  const push = (entry: LiveMintEntry, reads: LiveMintReads | undefined, source: LiveMintCard['source']) => {
    const card = toCard(entry, reads, source)
    if (seen.has(card.key)) return
    seen.add(card.key)
    cards.push({ ...card, pin: entry.pin ?? Number.POSITIVE_INFINITY, order: cards.length })
  }

  curated.forEach((entry) => push(entry, curatedReads[entryKey(entry)], 'curated'))
  registry.forEach(({ entry, reads }) => push(entry, reads, 'registry'))

  cards.sort((a, b) => {
    const aSoon = a.status === 'soon' ? 1 : 0
    const bSoon = b.status === 'soon' ? 1 : 0
    if (aSoon !== bSoon) return aSoon - bSoon
    if (a.pin !== b.pin) return a.pin - b.pin
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    return a.order - b.order
  })

  const slugs = new Set<string>()
  return cards.map(({ pin: _pin, order: _order, ...card }) => {
    let slug = slugify(card.slug)
    for (let n = 2; slugs.has(slug); n += 1) slug = `${slugify(card.slug)}-${n}`
    slugs.add(slug)
    return { ...card, slug }
  })
}

/** Registry-discovered drop as an entry (name comes from the chain). */
export function registryEntry(chainId: number, address: `0x${string}`, name?: string): LiveMintEntry {
  return { slug: slugify(name || address.slice(0, 10)), name: name || '', kind: 'drop', chainId, address }
}

export type DropPhase = {
  start: bigint | number
  end: bigint | number
  maxPerWallet: number
  merkleRoot: string
  supplyCap: number
  /** TokenPrice[]: what one piece costs in each token this phase sells for (address(0) = ETH). */
  prices: readonly TokenPriceRead[]
}

const ETH_RE = /^0x0{40}$/

/**
 * The phase a public minter can use right now: active (start <= now < end, end 0 = open-ended) and not allowlisted
 * (merkleRoot 0), with supply left under its cap. Returns its index, its prices (`price` is the ETH one, if it sells
 * for ETH) and how many it can still sell (undefined with no cap), or undefined when nothing public is live. `sold` is
 * phasesMinted(), in the same order.
 */
export function activePublicPhase(phases: readonly DropPhase[] | undefined, nowSec: number, sold?: readonly bigint[]) {
  if (!phases) return undefined
  for (let i = 0; i < phases.length; i += 1) {
    const p = phases[i]!
    const start = Number(p.start)
    const end = Number(p.end)
    const live = start <= nowSec && (end === 0 || nowSec < end)
    const isPublic = /^0x0*$/.test(p.merkleRoot)
    const cap = Number(p.supplyCap)
    const left = cap ? cap - Number(sold?.[i] ?? 0n) : undefined
    if (live && isPublic && (left === undefined || left > 0)) {
      const prices = p.prices || []
      const price = prices.find((x) => ETH_RE.test(x.token))?.price
      return { phaseId: i, price, prices, maxPerWallet: p.maxPerWallet, left }
    }
  }

  return undefined
}

/** One phase that is running now, public or allowlist, with what it can still sell. */
export type LivePhase = {
  phaseId: number
  /** True for an allowlist phase: only wallets with a proof under `root` can mint. */
  isList: boolean
  root: string
  prices: readonly TokenPriceRead[]
  /** The ETH price, when the phase sells for ETH. */
  price?: bigint
  maxPerWallet: number
  /** What its own cap still allows (undefined with no cap). */
  left?: number
}

/**
 * Every phase running right now (start <= now < end, end 0 = open-ended), public and allowlist alike, in phase order,
 * with supply left under its own cap. Full phases are kept (left 0), so the screen can say a list's spots are gone.
 */
export function livePhases(phases: readonly DropPhase[] | undefined, nowSec: number, sold?: readonly bigint[]): LivePhase[] {
  if (!phases) return []
  const out: LivePhase[] = []
  phases.forEach((p, i) => {
    const start = Number(p.start)
    const end = Number(p.end)
    if (!(start <= nowSec && (end === 0 || nowSec < end))) return
    const cap = Number(p.supplyCap)
    const prices = p.prices || []
    out.push({
      phaseId: i,
      isList: !/^0x0*$/.test(p.merkleRoot),
      root: p.merkleRoot,
      prices,
      price: prices.find((x) => ETH_RE.test(x.token))?.price,
      maxPerWallet: Number(p.maxPerWallet),
      left: cap ? Math.max(0, cap - Number(sold?.[i] ?? 0n)) : undefined,
    })
  })
  return out
}

/** Where a wallet stands on one allowlist phase, for the words beside it and the mint button. */
export type ListStanding =
  | 'connect'
  | 'checking'
  | 'unknown'
  | 'no-list'
  | 'not-listed'
  | 'claimed'
  | 'full'
  | 'soldout'
  | 'eligible'

/**
 * A wallet's standing on a list phase. `proof` is what the allowlist route said (undefined while asking), `minted` its
 * mintedInPhase (undefined while reading; `mintedFailed` when that read failed and never answered), `capLeft` what the
 * phase's own cap still allows (undefined with no cap) and `publicRemaining` what the whole collection can still sell.
 */
export function listStanding(opts: {
  account?: string
  proof?: { state: 'listed' | 'not-listed' | 'no-list' | 'unknown' }
  maxPerWallet: number
  minted?: number
  mintedFailed?: boolean
  capLeft?: number
  publicRemaining?: number
}): ListStanding {
  const { account, proof, maxPerWallet, minted, capLeft, publicRemaining } = opts
  if (!account) return 'connect'
  if (!proof) return 'checking'
  if (proof.state === 'unknown') return 'unknown'
  if (proof.state === 'no-list') return 'no-list'
  if (proof.state === 'not-listed') return 'not-listed'
  if (maxPerWallet && minted !== undefined && minted >= maxPerWallet) return 'claimed'
  // The list's own spots used up, or the whole collection sold: two different things to say.
  if (capLeft === 0) return 'full'
  if (publicRemaining === 0) return 'soldout'
  if (maxPerWallet && minted === undefined) return opts.mintedFailed ? 'unknown' : 'checking'
  return 'eligible'
}

/** The standing in words, beside the phase. */
export const STANDING_WORDS: Record<ListStanding, string> = {
  connect: 'Connect a wallet to check the list.',
  checking: 'Checking the list…',
  unknown: "Couldn't check the list just now.",
  'no-list': 'miya does not have this list, so nobody can claim through this page.',
  'not-listed': 'This wallet is not on the list.',
  claimed: 'This wallet has claimed all it can on this list.',
  full: 'Every spot on this list has been claimed.',
  soldout: 'The collection is sold out.',
  eligible: 'This wallet is on the list.',
}

/** The words for a standing, with the wallet's limit where it matters ("has claimed its 2"). */
export function standingWords(standing: ListStanding, maxPerWallet: number): string {
  if (standing === 'claimed' && maxPerWallet > 0) {
    return `This wallet has claimed ${maxPerWallet === 1 ? 'its 1 piece' : `all ${maxPerWallet} of its pieces`} on this list.`
  }
  return STANDING_WORDS[standing]
}

/** What the mint button says when this standing stops a claim. */
export const STANDING_BUTTON: Partial<Record<ListStanding, string>> = {
  checking: 'Checking the list…',
  unknown: "Couldn't check the list",
  'no-list': 'List not available',
  'not-listed': 'Not on this list',
  claimed: 'Already claimed',
  full: 'List spots all claimed',
  soldout: 'Sold out',
}

/**
 * The phase to show first: a list phase this wallet can claim in, else the first public phase with room, else the
 * first live phase. `standing` maps phase id → standing for the list phases.
 */
export function defaultPhase(phases: readonly LivePhase[], standing: Record<number, ListStanding | undefined>) {
  const claim = phases.find((p) => p.isList && standing[p.phaseId] === 'eligible')
  if (claim) return claim.phaseId
  const open = phases.find((p) => !p.isList && p.left !== 0)
  return (open ?? phases[0])?.phaseId
}

/**
 * The most this wallet can mint in one go: the transaction limit, what is left for sale and what is left of its
 * per-wallet limit (`maxPerWallet` 0 = no limit, as in the contract). 0 means this wallet has reached its limit.
 */
export function mintableNow(opts: { maxPerTx: number; left?: number; maxPerWallet?: number; walletMinted?: number }) {
  const { maxPerTx, left, maxPerWallet, walletMinted = 0 } = opts
  const forWallet = maxPerWallet ? Math.max(0, maxPerWallet - walletMinted) : Infinity
  return Math.min(maxPerTx, left ?? Infinity, forWallet)
}

/** One read's answer, as wagmi's useReadContracts gives it. */
export type ReadAnswer = { status: 'success' | 'failure'; result?: unknown; error?: unknown } | undefined

/** A read's identity for remembering its last good answer: chain, contract, function and arguments. */
export const readKey = (r: { chainId?: number; address: string; functionName: string; args?: readonly unknown[] }) =>
  `${r.chainId ?? ''}:${r.address.toLowerCase()}:${r.functionName}:${(r.args ?? []).map(String).join(',')}`

/**
 * The last good answer for every read. A refetch where a read failed (or the whole multicall failed, which gives every
 * read a failure) keeps that read's last good answer instead of blanking it, so a screen doesn't turn "unknown" after one
 * bad poll. `memory` is kept by the caller (a ref) and updated here. `allFailed`: this answer had no good read at all;
 * `everGood`: some read has answered at least once.
 */
export function mergeReads(
  memory: Map<string, ReadAnswer>,
  keys: readonly string[],
  next: readonly ReadAnswer[] | undefined
): { results: ReadAnswer[] | undefined; allFailed: boolean; everGood: boolean } {
  next?.forEach((r, i) => {
    if (r?.status === 'success') memory.set(keys[i] as string, r)
  })
  const allFailed = !!next && next.length > 0 && next.every((r) => r?.status !== 'success')
  const everGood = keys.some((k) => memory.has(k))
  if (!next && !everGood) return { results: undefined, allFailed, everGood }
  return { results: keys.map((k, i) => memory.get(k) ?? next?.[i]), allFailed, everGood }
}

/** Path for a card: /mint/<slug>. Parses back with `slugFromPath`. */
export const MINT_BASE_PATH = '/mint'
export const mintPath = (slug?: string) => (slug ? `${MINT_BASE_PATH}/${slug}` : MINT_BASE_PATH)

/** '/mint/miyamini' -> 'miyamini'; '/mint' or anything else -> undefined. */
export function slugFromPath(pathname: string): string | undefined {
  const m = /^\/mint\/([^/?#]+)\/?$/i.exec(pathname)
  return m ? decodeURIComponent(m[1]!).toLowerCase() : undefined
}

/** The card's price words: the ETH price, or the other token's when the phase doesn't sell for ETH. */
export const cardPrice = (c: Pick<LiveMintCard, 'price' | 'priceLabel'>) =>
  c.price === undefined && c.priceLabel ? c.priceLabel : formatEthShort(c.price)

/** Trims an ether amount to at most 4 decimals without rounding up. Input is wei. */
export function formatEthShort(wei: bigint | undefined): string {
  if (wei === undefined) return '…'
  if (wei === 0n) return 'Free'
  const neg = wei < 0n
  const abs = neg ? -wei : wei
  const whole = abs / 10n ** 18n
  const frac = (abs % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '')
  const s = frac ? `${whole}.${frac}` : `${whole}`
  return `${neg ? '-' : ''}${s === '0' ? '<0.0001' : s} ETH`
}

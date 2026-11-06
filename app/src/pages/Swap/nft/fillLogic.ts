/**
 * What an OpenSea fill needs approved, and what to say when one fails. No imports, so `node --test` can load it
 * (tests/fillLogic.test.mts).
 */

export type NftKind = 'erc721' | 'erc1155'

const sameAddress = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export type NftApprovalFacts = {
  kind: NftKind
  operator: string | undefined
  /** isApprovedForAll(owner, operator); undefined until read. */
  approvedForAll: boolean | undefined
  /** getApproved(tokenId) (ERC-721 only); undefined until read, or when the contract would not answer. */
  approvedAddress: string | undefined
  /** The getApproved read has finished, whether it answered or not. */
  approvedKnown: boolean
}

/**
 * Whether the NFT can move yet. ERC-721 approves the one token (tested against real Seaport fills on a fork); an
 * existing blanket approval also counts, and is never added. ERC-1155 has no per-token approval, so it needs the
 * blanket one, and the screen says so.
 */
export function nftApprovalState(f: NftApprovalFacts): 'checking' | 'ready' | 'needs-one' | 'needs-all' {
  if (!f.operator || f.approvedForAll === undefined) return 'checking'
  if (f.approvedForAll) return 'ready'
  if (f.kind === 'erc1155') return 'needs-all'
  if (!f.approvedKnown) return 'checking'
  return sameAddress(f.approvedAddress, f.operator) ? 'ready' : 'needs-one'
}

/** The wallet call for an approval state. Undefined when nothing is needed. */
export function nftApprovalCall(state: ReturnType<typeof nftApprovalState>, operator: string, tokenId: string) {
  if (state === 'needs-one') return { functionName: 'approve' as const, args: [operator, BigInt(tokenId)] as const }
  if (state === 'needs-all') return { functionName: 'setApprovalForAll' as const, args: [operator, true] as const }
  return undefined
}

export type FillFailureKind =
  | 'gone'
  | 'opensea-only'
  | 'offline'
  | 'restricted'
  | 'busy'
  | 'cancelled'
  | 'funds'
  | 'unconfirmed'
  | 'failed-onchain'
  | 'generic'

export type FillSide = 'buy' | 'sell'

/** The fill is no longer there to take: Seaport's own errors for a filled, cancelled or expired order. */
const GONE_ERRORS = new Set([
  'OrderAlreadyFilled',
  'OrderIsCancelled',
  'OrderPartiallyFilled',
  'InvalidTime',
  'NoSpecifiedOrdersAvailable',
])

/** Everything an error says about itself, however deep it is wrapped. Duck-typed so this file needs no imports. */
export function failureFacts(error: unknown) {
  const texts: string[] = []
  let errorName: string | undefined
  let reverted = false
  let code: string | undefined
  let status: number | undefined
  let e = error as Record<string, unknown> | undefined
  for (let depth = 0; e && typeof e === 'object' && depth < 8; depth += 1) {
    for (const part of [e.shortMessage, e.details, e.message]) if (typeof part === 'string') texts.push(part)
    const data = e.data as { errorName?: unknown } | undefined
    if (typeof data?.errorName === 'string') errorName = data.errorName
    if (e.name === 'ContractFunctionRevertedError') reverted = true
    if (typeof e.code === 'string') code = code ?? e.code
    if (typeof e.status === 'number') status = status ?? e.status
    e = e.cause as Record<string, unknown> | undefined
  }

  return { text: texts.join(' '), errorName, reverted, code, status }
}

/** Sorts a failed fill into something we can say plainly. Anything not recognised is `generic`: its text stays hidden. */
export function fillFailureKind(error: unknown, side: FillSide = 'buy'): FillFailureKind {
  const { text, errorName, code, status } = failureFacts(error)
  const flags = error as { reverted?: unknown; unconfirmed?: unknown } | undefined
  if (flags?.reverted === true) return 'failed-onchain'
  if (flags?.unconfirmed === true) return 'unconfirmed'
  if (/user rejected|user denied|rejected the request|denied transaction|you cancelled/i.test(text)) return 'cancelled'
  if (/insufficient funds|not enough eth/i.test(text)) return 'funds'
  if (errorName && GONE_ERRORS.has(errorName)) return 'gone'
  // Buying, the seller's NFT would not move: it has left their wallet. Selling, that NFT is the seller's own.
  if (side === 'buy' && errorName === 'TokenTransferGenericFailure') return 'gone'
  if (code === 'MARKET_NOT_CONFIGURED' || code === 'NETWORK' || code === 'UPSTREAM_UNREACHABLE') return 'offline'
  if (code === 'RATE_LIMITED' || status === 429) return 'busy'
  if (code === 'NOT_FOUND') return 'gone'
  if (/can not perform trading|cannot perform trading/i.test(text)) return 'restricted'
  if (
    /not found|does not exist|no longer|already (been )?(filled|fulfilled|sold|cancel)|cancell?ed|expired|not (active|fillable|available)|inactive/i.test(
      text,
    )
  )
    return 'gone'
  if (/timed? ?out/i.test(text)) return 'unconfirmed'
  return 'generic'
}

/** One plain sentence and what to do next. The screen adds a real OpenSea link when `link` is set. */
export function fillFailureWords(
  kind: FillFailureKind,
  side: FillSide,
): { words: string; link?: boolean; quiet?: boolean } {
  const buying = side === 'buy'
  switch (kind) {
    case 'gone':
      return {
        words: buying
          ? 'Someone just bought this one. You paid nothing. Pick another.'
          : 'This offer is no longer open. Nothing was sold. Look for another offer.',
      }
    case 'opensea-only':
      return { words: `This one can only be ${buying ? 'bought' : 'sold'} on OpenSea.`, link: true }
    case 'offline':
      return {
        words: `${buying ? 'Buying' : 'Selling'} here is offline right now. Try again later, or ${
          buying ? 'buy' : 'sell'
        } it on OpenSea.`,
        link: true,
      }
    case 'restricted':
      return { words: 'OpenSea has restricted this wallet from trading. Try another wallet.' }
    case 'busy':
      return { words: 'OpenSea is busy right now. Wait a moment, then try again.' }
    case 'cancelled':
      return { words: 'You cancelled in your wallet. Nothing moved.', quiet: true }
    case 'funds':
      return { words: 'Not enough ETH in this wallet for this and the network fee.' }
    case 'unconfirmed':
      return { words: 'We could not confirm this yet. It may still go through. Check it before trying again.' }
    case 'failed-onchain':
      return {
        words: buying
          ? 'This buy failed on the network. Nothing was bought. You only paid the network fee.'
          : 'This sale failed on the network. Nothing was sold. You only paid the network fee.',
      }
    default:
      return { words: `That did not go through. Nothing was ${buying ? 'bought' : 'sold'}. Try again.` }
  }
}

/**
 * The network fee on top of a checked plan: the sum of what could be estimated. Sweep estimates that fail (one sold in
 * the meantime) are filled in with the average of the rest. Undefined when nothing could be estimated.
 */
export function feeFromEstimates(
  gas: readonly (bigint | undefined)[],
  gasPrice: bigint | undefined,
): bigint | undefined {
  if (!gasPrice) return undefined
  const known = gas.filter((g): g is bigint => g !== undefined)
  if (!known.length) return undefined
  const sum = known.reduce((a, b) => a + b, 0n)
  const average = sum / BigInt(known.length)
  return (sum + average * BigInt(gas.length - known.length)) * gasPrice
}

/** Whether a wallet can pay for a fill and its network fee. An unknown fee is left out rather than guessed. */
export function isShort(
  balance: bigint | undefined,
  total: bigint,
  fee: bigint | undefined,
  feeIsSameMoney: boolean,
): boolean {
  if (balance === undefined) return false
  return balance < total + (feeIsSameMoney ? (fee ?? 0n) : 0n)
}

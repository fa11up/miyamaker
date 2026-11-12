/* eslint-disable no-restricted-syntax -- the checks read clearer as loops with early returns */
/**
 * Batched OpenSea fills: several listings bought, or several NFTs sold into their bids, in ONE Seaport call
 * (`fulfillAvailableAdvancedOrders` on Seaport 1.6). Pure logic, so `node --test` can load it (tests/batch.test.mts,
 * and tests/batch.fork.test.mts against real Seaport on a mainnet fork).
 *
 * sweep.ts sends one call per NFT because "rewriting OpenSea's calls is where money could go wrong". This file rewrites
 * only the envelope, never an order, and proves it before anything is signed:
 *
 * 1. Every order first passes planFill on its own, exactly as a single fill would (Seaport address, chain, this NFT,
 *    the goods to this wallet, no optional fees or extra ETH, and signedFillProblem: the call says what the screen
 *    says). An order planFill refuses is never batched.
 * 2. The order going into the batch is taken from that checked call, field for field: parameters, numerator and
 *    denominator, signature, extraData (OpenSea's zone signature), and its criteria resolvers. Nothing is taken from
 *    anywhere else, and nothing in it is changed except a resolver's orderIndex. A basic order is turned into the full
 *    order it stands for (Seaport's own derivation), so its signature still has to match or Seaport refuses it.
 *    Seaport checks each order's signature, so an order we got wrong is refused, never filled differently.
 * 3. What the fulfiller chooses is set here, not taken from OpenSea: recipient = the wallet, msg.value = the sum of the
 *    ETH the orders ask for (recomputed from the orders), fulfillerConduitKey = none for buys / the one every sell's
 *    approval goes to, maximumFulfilled = the number of orders, and the fulfillments (each offer item on its own,
 *    payments to the same address in the same money joined, every NFT on its own: the shape OpenSea's own batches
 *    use, seen on mainnet Nov 2026). Seaport refuses a fulfillment group whose items differ.
 * 4. batchCallProblem then decodes the encoded call (what the wallet will sign) and checks it again: each order equals
 *    its checked single fill, every item is in exactly one fulfillment, the value is what the orders ask for, the
 *    goods go to the wallet, and (sells) what comes back is each bid minus its fees. Any difference: no plan.
 * 5. The simulation's own answer (availableOrders, executions) is checked against the plan before the wallet opens
 *    (simulationCheck), and after the transaction only Seaport's OrderFulfilled events say what was filled
 *    (receiptOutcome): a row is never called bought or sold unless the receipt shows it.
 *
 * Anything else falls back to one-by-one (sweep.ts / FillReview), with a plain reason: see BatchExcluded.
 */

import type { Abi, Hex } from 'viem'
import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData } from 'viem'

import type { FillContext, FillLine, FillPlan } from './markets'
import { allowedConduitKey, OPENSEA_CONDUIT_KEY, planFill } from './markets'
import { INPUT_ALIASES, OPENSEA_FEE_RECIPIENT, seaportAbi, seaportEventsAbi, SEAPORT_ADDRESSES } from './seaport'
import { MAX_SWEEP, sweepTotals } from './sweep'

/** The only Seaport a batch goes to (1.6). An order on 1.5 is filled on its own. */
export const BATCH_SEAPORT = SEAPORT_ADDRESSES[0]

/**
 * OpenSea's signed zone ("OpenSeaSignedZone", getSeaportMetadata): most OpenSea orders are restricted to it. Its
 * extraData (SIP-7) is a signature OpenSea gives per fulfiller in fulfillment_data, valid for a few minutes (175 s
 * left when one real batch landed). It does not name the other orders, so OpenSea's own batches carry each order's
 * extraData as is, and so does this file.
 */
export const OPENSEA_SIGNED_ZONE = '0x000056F7000000EcE9003ca63978907a00FFD100'

/** The conduit OPENSEA_CONDUIT_KEY stands for (ConduitController.getConduit, checked on a fork). */
export const OPENSEA_CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71'

/**
 * Most orders in one batch. Each needs its own fulfillment_data, and the fulfillment route lets a visitor have 10 at
 * once, then one per 5 s (api/worker.ts), so 8 leaves room for a refresh of one or a normal buy. Gas is about 140k
 * per listing and 160k per offer on mainnet (OpenSea's own 5-listing batch: 689k), so 8 stays near 1.3M.
 */
export const MAX_BATCH = MAX_SWEEP

/** A signed-zone permission closer to running out than this is fetched again before the wallet opens. */
export const EXPIRY_MARGIN_S = 30

const ZERO32 = `0x${'0'.repeat(64)}` as Hex
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const lc = (v: unknown) => String(v ?? '').toLowerCase()

/* ---------- Seaport structs (viem's shapes for seaportAbi) ---------- */

export type OfferItem = {
  itemType: number
  token: Hex
  identifierOrCriteria: bigint
  startAmount: bigint
  endAmount: bigint
}
export type ConsiderationItem = OfferItem & { recipient: Hex }
export type OrderParameters = {
  offerer: Hex
  zone: Hex
  offer: OfferItem[]
  consideration: ConsiderationItem[]
  orderType: number
  startTime: bigint
  endTime: bigint
  zoneHash: Hex
  salt: bigint
  conduitKey: Hex
  totalOriginalConsiderationItems: bigint
}
export type AdvancedOrder = {
  parameters: OrderParameters
  numerator: bigint
  denominator: bigint
  signature: Hex
  extraData: Hex
}
export type CriteriaResolver = {
  orderIndex: bigint
  side: number
  index: bigint
  identifier: bigint
  criteriaProof: Hex[]
}
export type FulfillmentComponent = { orderIndex: bigint; itemIndex: bigint }

const batchFn = seaportAbi.find((f) => f.name === 'fulfillAvailableAdvancedOrders')!
const ORDER_TUPLE = [{ type: 'tuple', components: batchFn.inputs[0]!.components }] as const

/** One order in a canonical form (the ABI encoding), so orders from different sources compare exactly. */
const orderBytes = (o: AdvancedOrder) =>
  encodeAbiParameters(ORDER_TUPLE as never, [o] as never)

const n = (v: unknown) => Number(v)
const b = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(v as string | number))
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)

/** viem-ready copies (numbers for uint8, bigints for the rest), whatever the source used. */
const offerItem = (i: Record<string, unknown>): OfferItem => ({
  itemType: n(i.itemType),
  token: i.token as Hex,
  identifierOrCriteria: b(i.identifierOrCriteria),
  startAmount: b(i.startAmount),
  endAmount: b(i.endAmount),
})
const considerationItem = (i: Record<string, unknown>): ConsiderationItem => ({
  ...offerItem(i),
  recipient: i.recipient as Hex,
})
function orderParameters(raw: unknown): OrderParameters {
  const p = obj(raw)
  if (!p) throw new Error('order parameters missing')
  return {
    offerer: p.offerer as Hex,
    zone: p.zone as Hex,
    offer: (p.offer as unknown[]).map((i) => offerItem(obj(i)!)),
    consideration: (p.consideration as unknown[]).map((i) => considerationItem(obj(i)!)),
    orderType: n(p.orderType),
    startTime: b(p.startTime),
    endTime: b(p.endTime),
    zoneHash: p.zoneHash as Hex,
    salt: b(p.salt),
    conduitKey: p.conduitKey as Hex,
    totalOriginalConsiderationItems: b(p.totalOriginalConsiderationItems),
  }
}
const resolver = (raw: unknown): CriteriaResolver => {
  const r = obj(raw)!
  return {
    orderIndex: b(r.orderIndex),
    side: n(r.side),
    index: b(r.index),
    identifier: b(r.identifier),
    criteriaProof: [...((r.criteriaProof as Hex[]) ?? [])],
  }
}

/**
 * Seaport's basic order as the full order it stands for: the same derivation Seaport uses for the order hash, so the
 * offerer's signature covers it. basicOrderType = orderType + 4 × route; routes 0-3 sell an NFT for ETH/ERC-20,
 * 4-5 sell an ERC-20 offer for an NFT. Additional recipients are paid in the route's money token; only the original
 * ones are part of the order (planFill has already refused any extra).
 */
export function basicToAdvanced(raw: unknown): AdvancedOrder {
  const p = obj(raw)
  if (!p) throw new Error('basic parameters missing')
  const type = n(p.basicOrderType)
  const route = Math.floor(type / 4)
  if (!Number.isInteger(type) || type < 0 || route > 5) throw new Error('unknown basic order type')
  const offerer = p.offerer as Hex
  const nftFirst = route < 4
  const nftType = route === 0 || route === 2 || route === 4 ? 2 : 3
  const payType = route < 2 ? 0 : 1
  const original = b(p.totalOriginalAdditionalRecipients)
  const extras = (p.additionalRecipients as unknown[]).slice(0, Number(original)).map((r) => obj(r)!)
  if (BigInt(extras.length) !== original) throw new Error('additional recipients missing')
  const item = (itemType: number, token: unknown, id: unknown, amount: unknown): OfferItem => ({
    itemType,
    token: token as Hex,
    identifierOrCriteria: b(id),
    startAmount: b(amount),
    endAmount: b(amount),
  })
  const offer = nftFirst
    ? [item(nftType, p.offerToken, p.offerIdentifier, p.offerAmount)]
    : [item(1, p.offerToken, p.offerIdentifier, p.offerAmount)]
  const extraType = nftFirst ? payType : 1
  const extraToken = nftFirst ? p.considerationToken : p.offerToken
  const consideration: ConsiderationItem[] = [
    {
      ...item(nftFirst ? payType : nftType, p.considerationToken, p.considerationIdentifier, p.considerationAmount),
      recipient: offerer,
    },
    ...extras.map((r) => ({ ...item(extraType, extraToken, 0n, r.amount), recipient: r.recipient as Hex })),
  ]
  return {
    parameters: {
      offerer,
      zone: p.zone as Hex,
      offer,
      consideration,
      orderType: type % 4,
      startTime: b(p.startTime),
      endTime: b(p.endTime),
      zoneHash: p.zoneHash as Hex,
      salt: b(p.salt),
      conduitKey: p.offererConduitKey as Hex,
      totalOriginalConsiderationItems: original + 1n,
    },
    numerator: 1n,
    denominator: 1n,
    signature: p.signature as Hex,
    extraData: '0x',
  }
}

/**
 * The one order a checked single fill (planFill's functionName + args) fills, as an AdvancedOrder with its criteria
 * resolvers. Throws for anything that is not one order.
 */
export function toAdvancedOrder(plan: Pick<FillPlan, 'functionName' | 'args'>): {
  order: AdvancedOrder
  resolvers: CriteriaResolver[]
} {
  const a = plan.args
  const plain = (o: unknown): AdvancedOrder => {
    const x = obj(o)!
    return {
      parameters: orderParameters(x.parameters),
      numerator: 1n,
      denominator: 1n,
      signature: x.signature as Hex,
      extraData: '0x',
    }
  }
  const advanced = (o: unknown): AdvancedOrder => {
    const x = obj(o)!
    return {
      parameters: orderParameters(x.parameters),
      numerator: b(x.numerator),
      denominator: b(x.denominator),
      signature: x.signature as Hex,
      extraData: ((x.extraData as Hex) || '0x') as Hex,
    }
  }
  const one = (list: unknown) => {
    if (!Array.isArray(list) || list.length !== 1) throw new Error('not a single order')
    return list[0]
  }
  let order: AdvancedOrder
  let resolvers: CriteriaResolver[] = []
  switch (plan.functionName) {
    case 'fulfillBasicOrder':
    case 'fulfillBasicOrder_efficient_6GL6yc':
      order = basicToAdvanced(a[0])
      break
    case 'fulfillOrder':
      order = plain(a[0])
      break
    case 'fulfillAdvancedOrder':
      order = advanced(a[0])
      resolvers = (a[1] as unknown[]).map(resolver)
      break
    case 'fulfillAvailableOrders':
      order = plain(one(a[0]))
      break
    case 'fulfillAvailableAdvancedOrders':
      order = advanced(one(a[0]))
      resolvers = (a[1] as unknown[]).map(resolver)
      break
    default:
      throw new Error('not a fill function')
  }
  if (resolvers.some((r) => r.orderIndex !== 0n)) throw new Error('resolver for another order')
  return { order, resolvers }
}

/* ---------- OpenSea's signed zone (SIP-7 extraData) ---------- */

/**
 * OpenSea's zone extraData: version 0x00, the fulfiller it is for (zero = anyone), when it runs out (unix s),
 * a 64-byte signature, then context (what else it binds, e.g. the token id a criteria offer takes). Undefined when
 * it is not that shape.
 */
export function signedZoneFacts(extraData: string): { fulfiller: string; expiration: number; context: Hex } | undefined {
  const hex = extraData.toLowerCase()
  if (!/^0x[0-9a-f]*$/.test(hex) || hex.length < 2 + 93 * 2 || hex.slice(2, 4) !== '00') return undefined
  return {
    fulfiller: `0x${hex.slice(4, 44)}`,
    expiration: Number(BigInt(`0x${hex.slice(44, 60)}`)),
    context: `0x${hex.slice(2 + 93 * 2)}` as Hex,
  }
}

/* ---------- fulfillments ---------- */

/**
 * The fulfillments for these orders: each offer item on its own (they all go to the recipient), and each
 * consideration item on its own except payments (ETH or an ERC-20) to the same address in the same money, which are
 * joined into one transfer. NFTs, criteria items included, are never joined. Seaport refuses a group whose items
 * differ (type, token, id, recipient), and skips the items of an order it does not fill.
 */
export function fulfillmentsFor(orders: readonly AdvancedOrder[]): {
  offerFulfillments: FulfillmentComponent[][]
  considerationFulfillments: FulfillmentComponent[][]
} {
  const offerFulfillments: FulfillmentComponent[][] = []
  const considerationFulfillments: FulfillmentComponent[][] = []
  const joined = new Map<string, FulfillmentComponent[]>()
  orders.forEach((o, i) => {
    o.parameters.offer.forEach((_, j) => offerFulfillments.push([{ orderIndex: BigInt(i), itemIndex: BigInt(j) }]))
  })
  orders.forEach((o, i) => {
    o.parameters.consideration.forEach((c, j) => {
      const at = { orderIndex: BigInt(i), itemIndex: BigInt(j) }
      if (c.itemType !== 0 && c.itemType !== 1) {
        considerationFulfillments.push([at])
        return
      }
      const key = `${c.itemType}|${lc(c.token)}|${c.identifierOrCriteria}|${lc(c.recipient)}`
      const group = joined.get(key)
      if (group) group.push(at)
      else {
        const fresh = [at]
        joined.set(key, fresh)
        considerationFulfillments.push(fresh)
      }
    })
  })
  return { offerFulfillments, considerationFulfillments }
}

/** What an order asks of the fulfiller in ETH: its native consideration, scaled to the share filled. */
export const nativeDue = (o: AdvancedOrder) =>
  o.parameters.consideration
    .filter((c) => c.itemType === 0)
    .reduce((s, c) => s + (c.startAmount * o.numerator) / o.denominator, 0n)

/* ---------- the plan ---------- */

export type BatchSide = 'buy' | 'sell'

/** One order to batch: OpenSea's fulfillment_data for it, and which NFT it is for. */
export type BatchInput = {
  /** The caller's id for this row (the OpenSea order hash is a good one). */
  key: string
  /** OpenSea's order hash, used to match the receipt's OrderFulfilled event. */
  orderHash?: string
  /** The /api/opensea fulfill_listing or fulfill_offer answer, untouched. */
  response: unknown
  contract: string
  tokenId: string
  /** The collection's creator fee payees from OpenSea, as for planFill. */
  creatorFees?: readonly string[]
}

export type BatchOptions = {
  side: BatchSide
  chainId: number
  account: string
  /** Unix seconds; defaults to now. A signed-zone permission running out within EXPIRY_MARGIN_S is refused. */
  now?: number
}

/** One order in the batch, in call order. */
export type BatchLine = {
  key: string
  orderHash?: string
  contract: string
  tokenId: string
  offerer: string
  /** Its place in the call (orderIndex, availableOrders). */
  index: number
  /** planFill's checked single fill: lines, total (buy: paid; sell: received after fees), fees owed (fromYou). */
  plan: FillPlan
  order: AdvancedOrder
  resolvers: CriteriaResolver[]
  /** Sell only: the bid, the fees out of it, and what is left for the seller. Buy: price = total paid. */
  gross: bigint
  fees: bigint
  net: bigint
  /** When OpenSea's zone permission for this order runs out (unix s), for a restricted order. */
  expiresAt?: number
}

/** Why an order is left out of the batch. `oneByOne`: it passed planFill, so it can still be filled on its own. */
export type BatchExcluded = { key: string; reason: string; oneByOne: boolean; openSea?: boolean }

export type BatchCall = { to: Hex; data: Hex; value: bigint }

export type BatchPlan = {
  ok: true
  side: BatchSide
  /** The one transaction: send exactly this (to, data, value). */
  call: BatchCall
  /** The same call as functionName + args, for viem/wagmi simulateContract with seaportCallAbi. */
  functionName: 'fulfillAvailableAdvancedOrders'
  args: readonly unknown[]
  lines: BatchLine[]
  excluded: BatchExcluded[]
  /** Buy: ETH paid, by label (To the seller / OpenSea fee / Creator fee). Sell: the offers and what comes off them. */
  totals: { total: bigint; lines: FillLine[] }
  /** Who gets the money, by address, in the batch's money token (buy: what you pay; sell: the fees). */
  byRecipient: { recipient: string; amount: bigint }[]
  currency: { native: boolean; token: string }
  /** The batch's fulfillerConduitKey: what the NFTs (sell) and fee token are approved to. Zero = Seaport itself. */
  conduitKey: string
  /** Sell: the NFTs that must be approved to the conduit first: a separate, explicit step the person presses. */
  approvals: { contract: string; kind: 'erc721' | 'erc1155'; tokenIds: string[] }[]
  /** Sell: the fee token allowance the conduit needs (Seaport pulls the fees from the seller). 0 for buys. */
  fromYou: bigint
  /** The earliest OpenSea zone permission's end (unix s): refetch the fulfillment data before this. */
  expiresAt?: number
}

const UNREADABLE = 'OpenSea sent an order we could not read. Nothing has moved.'

/**
 * Plans one batch from OpenSea's fulfillment data. Every order is first checked by planFill exactly as a single
 * fill; the ones that pass and can be batched become one fulfillAvailableAdvancedOrders call, which is then decoded
 * and checked again (batchCallProblem). The rest come back in `excluded` with a plain reason.
 */
export function planBatch(
  inputs: readonly BatchInput[],
  opts: BatchOptions
): BatchPlan | { ok: false; error: string; excluded: BatchExcluded[] } {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const me = lc(opts.account)
  const buying = opts.side === 'buy'
  const excluded: BatchExcluded[] = []
  const out = (key: string, reason: string, oneByOne = true, openSea?: boolean) =>
    excluded.push({ key, reason, oneByOne, ...(openSea ? { openSea } : {}) })

  type Candidate = Omit<BatchLine, 'index'>
  const candidates: Candidate[] = []
  const seenNft = new Set<string>()
  const seenOrder = new Set<string>()
  for (const input of inputs) {
    const ctx: FillContext = {
      side: opts.side,
      chainId: opts.chainId,
      contract: input.contract,
      tokenId: input.tokenId,
      account: opts.account,
      seaports: SEAPORT_ADDRESSES,
      abi: seaportAbi,
      aliases: INPUT_ALIASES,
      creatorFees: input.creatorFees,
    }
    const plan = planFill(input.response, ctx)
    if (!plan.ok) {
      out(input.key, plan.error, false, plan.openSea)
      continue
    }

    let order: AdvancedOrder
    let resolvers: CriteriaResolver[]
    try {
      ;({ order, resolvers } = toAdvancedOrder(plan))
    } catch {
      out(input.key, UNREADABLE, true)
      continue
    }

    const p = order.parameters
    const nftKey = `${lc(input.contract)}:${input.tokenId}`
    const orderKey = lc(input.orderHash) || orderBytes(order)
    if (lc(plan.to) !== lc(BATCH_SEAPORT)) {
      out(input.key, `This one is on an older Seaport, so it is ${buying ? 'bought' : 'sold'} on its own.`)
      continue
    }
    if (seenNft.has(nftKey) || seenOrder.has(orderKey)) {
      out(input.key, 'Already in this batch.', false)
      continue
    }
    if (lc(p.offerer) === me) {
      out(input.key, buying ? 'This is your own listing.' : 'This is your own offer.', false)
      continue
    }
    if (buying && !plan.currency.native) {
      out(input.key, 'Priced in a token, not ETH, so it is bought on its own.')
      continue
    }
    if (p.orderType > 3) {
      out(input.key, `This kind of order can only be ${buying ? 'bought' : 'sold'} on its own.`)
      continue
    }
    if (p.consideration.some((c) => lc(c.recipient) === me)) {
      // A payment to the fulfiller makes no sense in a fill: it would be netted in ways the screen can't show.
      out(input.key, `This order pays you as well, so it is ${buying ? 'bought' : 'sold'} on its own.`)
      continue
    }

    let expiresAt: number | undefined
    if (p.orderType === 2 || p.orderType === 3) {
      // Restricted: the zone must agree. Only OpenSea's signed zone is known; its permission is carried as is.
      if (lc(p.zone) !== lc(OPENSEA_SIGNED_ZONE)) {
        out(input.key, `This order has its own extra check, so it is ${buying ? 'bought' : 'sold'} on its own.`)
        continue
      }
      const z = signedZoneFacts(order.extraData)
      if (!z) {
        out(input.key, `OpenSea sent no permission for this one, so it is ${buying ? 'bought' : 'sold'} on its own.`)
        continue
      }
      if (z.fulfiller !== ZERO_ADDR && z.fulfiller !== me) {
        out(input.key, 'OpenSea gave this one to another wallet. Refresh and try again.', false)
        continue
      }
      if (z.expiration <= now + EXPIRY_MARGIN_S) {
        out(input.key, "OpenSea's permission for this one has run out. Refresh and try again.", false)
        continue
      }
      expiresAt = z.expiration
    }

    // Buy: the price paid. Sell: the bid, then the fees out of it (planFill's lines: Offer, then negatives).
    const gross = buying ? plan.total : plan.lines[0]!.amount
    const fees = buying ? 0n : plan.fromYou
    seenNft.add(nftKey)
    seenOrder.add(orderKey)
    candidates.push({
      key: input.key,
      orderHash: input.orderHash,
      contract: input.contract,
      tokenId: input.tokenId,
      offerer: lc(p.offerer),
      plan,
      order,
      resolvers,
      gross,
      fees,
      net: plan.total,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    })
  }

  // Sells: one call has one conduit and one money token. Keep the most common pair (OpenSea's conduit first).
  let kept = candidates
  let conduitKey: string = ZERO32
  let currency = { native: true, token: ZERO_ADDR }
  if (!buying && candidates.length) {
    const count = new Map<string, number>()
    for (const c of candidates) {
      const k = `${lc(c.plan.conduitKey)}|${lc(c.plan.currency.token)}`
      count.set(k, (count.get(k) ?? 0) + 1)
    }
    const best = [...count.entries()].sort(
      (x, y) => y[1] - x[1] || Number(y[0].startsWith(lc(OPENSEA_CONDUIT_KEY))) - Number(x[0].startsWith(lc(OPENSEA_CONDUIT_KEY)))
    )[0]![0]
    const [key, token] = best.split('|') as [string, string]
    kept = []
    for (const c of candidates) {
      if (lc(c.plan.currency.token) !== token) out(c.key, 'Paid in another token than the rest, so it is sold on its own.')
      else if (lc(c.plan.conduitKey) !== key || !allowedConduitKey(key))
        out(c.key, 'This one needs a different approval than the rest, so it is sold on its own.')
      else kept.push(c)
    }
    conduitKey = key
    currency = { native: false, token }
  }

  if (kept.length > MAX_BATCH) {
    for (const c of kept.slice(MAX_BATCH)) out(c.key, `A batch holds at most ${MAX_BATCH}.`)
    kept = kept.slice(0, MAX_BATCH)
  }

  if (!kept.length)
    return {
      ok: false,
      error: buying ? 'None of these can be bought together.' : 'None of these can be sold together.',
      excluded,
    }

  const lines: BatchLine[] = kept.map((c, index) => ({ ...c, index }))
  const orders = lines.map((l) => l.order)
  const resolvers = lines.flatMap((l) => l.resolvers.map((r) => ({ ...r, orderIndex: BigInt(l.index) })))
  const { offerFulfillments, considerationFulfillments } = fulfillmentsFor(orders)
  const value = buying ? orders.reduce((s, o) => s + nativeDue(o), 0n) : 0n
  const args = [
    orders,
    resolvers,
    offerFulfillments,
    considerationFulfillments,
    conduitKey as Hex,
    opts.account as Hex,
    BigInt(orders.length),
  ] as const
  const data = encodeFunctionData({
    abi: seaportAbi as Abi,
    functionName: 'fulfillAvailableAdvancedOrders',
    args: args as unknown as unknown[],
  })

  const plan: BatchPlan = {
    ok: true,
    side: opts.side,
    call: { to: BATCH_SEAPORT as Hex, data, value },
    functionName: 'fulfillAvailableAdvancedOrders',
    args,
    lines,
    excluded,
    totals: sweepTotals(lines.map((l) => l.plan)),
    byRecipient: byRecipient(lines, buying),
    currency,
    conduitKey,
    approvals: buying ? [] : approvalsFor(lines),
    fromYou: buying ? 0n : lines.reduce((s, l) => s + l.fees, 0n),
    expiresAt: lines.reduce<number | undefined>(
      (m, l) => (l.expiresAt === undefined ? m : m === undefined ? l.expiresAt : Math.min(m, l.expiresAt)),
      undefined
    ),
  }

  const problem = batchCallProblem(plan.call, plan, opts.account)
  if (problem) return { ok: false, error: MISMATCH_WORDS[opts.side], excluded }
  return plan
}

/** Shown when the encoded batch does not say what the plan says (never expected: a bug, not OpenSea). */
export const MISMATCH_WORDS = {
  buy: "The batch didn't match what you're buying, so nothing was sent. Buy them one by one.",
  sell: "The batch didn't match the offers you're accepting, so nothing was sent. Sell them one by one.",
} as const

function byRecipient(lines: readonly BatchLine[], buying: boolean) {
  const sums = new Map<string, bigint>()
  for (const l of lines) {
    const o = l.order
    for (const c of o.parameters.consideration) {
      if (c.itemType !== 0 && c.itemType !== 1) continue
      if (buying && c.itemType !== 0) continue
      const amount = (c.startAmount * o.numerator) / o.denominator
      sums.set(lc(c.recipient), (sums.get(lc(c.recipient)) ?? 0n) + amount)
    }
  }
  return [...sums].map(([recipient, amount]) => ({ recipient, amount }))
}

function approvalsFor(lines: readonly BatchLine[]) {
  const by = new Map<string, { contract: string; kind: 'erc721' | 'erc1155'; tokenIds: string[] }>()
  for (const l of lines) {
    const k = lc(l.contract)
    const a = by.get(k) ?? { contract: l.contract, kind: l.plan.nftKind, tokenIds: [] }
    a.tokenIds.push(l.tokenId)
    by.set(k, a)
  }
  return [...by.values()]
}

/* ---------- the guard on what is signed ---------- */

/**
 * Why the batch call about to be signed does not say what the plan says, or undefined when it does. Decodes the
 * calldata itself (what the wallet signs) and checks: Seaport 1.6, fulfillAvailableAdvancedOrders, the wallet as
 * recipient, the plan's conduit (none for buys), maximumFulfilled = every order, each order byte-for-byte the checked
 * single fill with its own resolvers, every item in exactly one fulfillment, msg.value = the ETH the orders ask for
 * (buys) or none (sells), every offer item an NFT (buys) or the sell's money token (sells), and per sell: one NFT to
 * the bidder, fees in the same token, and what is left equal to what the screen shows. Reasons are for tests.
 */
export function batchCallProblem(
  call: BatchCall,
  plan: Pick<BatchPlan, 'side' | 'lines' | 'conduitKey' | 'currency'>,
  account: string
): string | undefined {
  if (lc(call.to) !== lc(BATCH_SEAPORT)) return 'not Seaport 1.6'
  let decoded: { functionName: string; args?: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi: seaportAbi as Abi, data: call.data }) as typeof decoded
  } catch {
    return 'calldata does not decode'
  }
  if (decoded.functionName !== 'fulfillAvailableAdvancedOrders') return 'not a batch fill'
  const [rawOrders, rawResolvers, offF, conF, key, recipient, max] = decoded.args as [
    unknown[],
    unknown[],
    FulfillmentComponent[][],
    FulfillmentComponent[][],
    string,
    string,
    bigint,
  ]
  const me = lc(account)
  if (lc(recipient) !== me) return 'recipient differs'
  if (lc(key) !== lc(plan.conduitKey) || !allowedConduitKey(lc(key))) return 'conduit differs'
  if (plan.side === 'buy' && lc(key) !== ZERO32) return 'conduit differs'
  const orders = rawOrders.map((o) => obj(o) as unknown as AdvancedOrder)
  if (orders.length !== plan.lines.length || orders.length === 0) return 'order count differs'
  if (max !== BigInt(orders.length)) return 'maximumFulfilled differs'

  // Each order is the checked single fill, unchanged.
  for (const [i, line] of plan.lines.entries()) {
    if (line.index !== i) return 'order index differs'
    if (orderBytes(orders[i]!) !== orderBytes(line.order)) return `order ${i} differs`
  }

  // Resolvers: exactly each order's own, re-pointed at it.
  const resolvers = rawResolvers.map(resolver)
  const expected = plan.lines.flatMap((l) => l.resolvers.map((r) => ({ ...r, orderIndex: BigInt(l.index) })))
  const rKey = (r: CriteriaResolver) =>
    `${r.orderIndex}|${r.side}|${r.index}|${r.identifier}|${r.criteriaProof.map(lc).join(',')}`
  if (resolvers.length !== expected.length || resolvers.some((r, i) => rKey(r) !== rKey(expected[i]!)))
    return 'resolvers differ'

  // Every item in exactly one fulfillment, and the items of a group alike.
  const cover = (groups: FulfillmentComponent[][], side: 'offer' | 'consideration') => {
    const seen = new Set<string>()
    for (const g of groups) {
      if (!g.length) return `empty ${side} fulfillment`
      let first: (OfferItem & { recipient?: Hex }) | undefined
      let firstOfferer = ''
      for (const c of g) {
        const o = orders[Number(c.orderIndex)]
        const item = o?.parameters[side][Number(c.itemIndex)] as (OfferItem & { recipient?: Hex }) | undefined
        if (!o || !item) return `${side} fulfillment points nowhere`
        const k = `${c.orderIndex}.${c.itemIndex}`
        if (seen.has(k)) return `${side} item used twice`
        seen.add(k)
        if (!first) {
          first = item
          firstOfferer = lc(o.parameters.offerer)
        } else if (
          n(item.itemType) !== n(first.itemType) ||
          lc(item.token) !== lc(first.token) ||
          b(item.identifierOrCriteria) !== b(first.identifierOrCriteria) ||
          lc(item.recipient) !== lc(first.recipient) ||
          (side === 'offer' && lc(o.parameters.offerer) !== firstOfferer) ||
          n(item.itemType) > 1
        )
          return `${side} fulfillment joins different items`
      }
    }
    const total = orders.reduce((s, o) => s + o.parameters[side].length, 0)
    return seen.size === total ? undefined : `${side} item left out`
  }
  const coverProblem = cover(offF, 'offer') ?? cover(conF, 'consideration')
  if (coverProblem) return coverProblem

  const due = orders.reduce((s, o) => s + nativeDue(o), 0n)
  if (plan.side === 'buy') {
    if (call.value !== due) return 'value differs'
    if (call.value !== plan.lines.reduce((s, l) => s + l.plan.total, 0n)) return 'value differs from the plan'
    for (const o of orders) {
      if (!o.parameters.offer.every((i) => n(i.itemType) === 2 || n(i.itemType) === 3)) return 'offer holds more than NFTs'
      if (!o.parameters.consideration.every((c) => n(c.itemType) === 0)) return 'asks for something other than ETH'
      if (o.parameters.consideration.some((c) => lc(c.recipient) === me)) return 'pays the buyer'
    }
    return undefined
  }

  if (call.value !== 0n) return 'a sell sends ETH'
  const token = lc(plan.currency.token)
  for (const [i, o] of orders.entries()) {
    const line = plan.lines[i]!
    const part = (x: bigint) => (x * o.numerator) / o.denominator
    if (!o.parameters.offer.every((it) => n(it.itemType) === 1 && lc(it.token) === token)) return 'offer is not the sell token'
    const nfts = o.parameters.consideration.filter((c) => n(c.itemType) >= 2)
    if (nfts.length !== 1) return 'asks for more than one NFT'
    if (lc(nfts[0]!.recipient) !== lc(o.parameters.offerer) || lc(nfts[0]!.token) !== lc(line.contract))
      return 'NFT goes elsewhere'
    const fees = o.parameters.consideration.filter((c) => n(c.itemType) < 2)
    if (!fees.every((c) => n(c.itemType) === 1 && lc(c.token) === token)) return 'fees in another token'
    if (fees.some((c) => lc(c.recipient) === me)) return 'pays the seller twice'
    const gross = o.parameters.offer.reduce((s, it) => s + part(it.startAmount), 0n)
    const cut = fees.reduce((s, c) => s + part(c.startAmount), 0n)
    if (gross !== line.gross || cut !== line.fees || gross - cut !== line.net) return 'amount received differs'
  }
  return undefined
}

/* ---------- the simulation's answer ---------- */

type Execution = {
  item: { itemType: number; token: string; identifier: bigint; amount: bigint; recipient: string }
  offerer: string
  conduitKey: string
}

export type SimulationCheck = {
  /** Keys Seaport will fill, and keys it will skip (sold, cancelled or expired since). */
  fills: string[]
  skips: string[]
  /** Buy: the ETH actually spent (the rest of value comes back). Sell: what the seller gets after fees. */
  amount: bigint
  /** Set when Seaport's executions do not match the plan: do not send. For tests and logs. */
  problem?: string
}

/**
 * Checks the simulation's return (availableOrders, executions) against the plan: which orders Seaport will fill, and
 * that what it will move is exactly what those orders say: buys, every NFT to the wallet and only the ETH those
 * orders ask for; sells, each NFT to its bidder, the bids to the wallet and only those orders' fees out of them.
 */
export function simulationCheck(plan: Pick<BatchPlan, 'side' | 'lines' | 'currency'>, result: readonly unknown[], account: string): SimulationCheck {
  const available = (result[0] as readonly boolean[]) ?? []
  const executions = ((result[1] as readonly Execution[]) ?? []).map((e) => ({
    itemType: n(e.item.itemType),
    token: lc(e.item.token),
    identifier: b(e.item.identifier),
    amount: b(e.item.amount),
    recipient: lc(e.item.recipient),
    from: lc(e.offerer),
  }))
  const fills = plan.lines.filter((_, i) => available[i] === true)
  const outcome = {
    fills: fills.map((l) => l.key),
    skips: plan.lines.filter((_, i) => available[i] !== true).map((l) => l.key),
    amount: 0n,
  }
  const me = lc(account)
  if (available.length !== plan.lines.length) return { ...outcome, problem: 'availableOrders length differs' }
  const sum = (list: { amount: bigint }[]) => list.reduce((s, e) => s + e.amount, 0n)
  const nfts = executions.filter((e) => e.itemType >= 2)
  const money = executions.filter((e) => e.itemType < 2)

  if (plan.side === 'buy') {
    const spent = sum(money)
    const expected = fills.reduce((s, l) => s + l.plan.total, 0n)
    if (money.some((e) => e.itemType !== 0)) return { ...outcome, problem: 'moves a token' }
    if (spent !== expected) return { ...outcome, amount: spent, problem: 'ETH spent differs' }
    if (money.some((e) => e.recipient === me)) return { ...outcome, amount: spent, problem: 'pays the buyer' }
    const want = new Set(fills.map((l) => `${lc(l.contract)}:${l.tokenId}`))
    if (nfts.length !== fills.length || nfts.some((e) => e.recipient !== me || !want.delete(`${e.token}:${e.identifier}`)))
      return { ...outcome, amount: spent, problem: 'NFTs moved differ' }
    return { ...outcome, amount: spent }
  }

  const token = lc(plan.currency.token)
  if (money.some((e) => e.itemType !== 1 || e.token !== token)) return { ...outcome, problem: 'moves another token' }
  const toMe = sum(money.filter((e) => e.recipient === me))
  const fromMe = sum(money.filter((e) => e.recipient !== me))
  const gross = fills.reduce((s, l) => s + l.gross, 0n)
  const fees = fills.reduce((s, l) => s + l.fees, 0n)
  if (toMe !== gross || fromMe !== fees) return { ...outcome, amount: toMe - fromMe, problem: 'amount received differs' }
  const want = new Map(fills.map((l) => [`${lc(l.contract)}:${l.tokenId}`, l.offerer]))
  if (nfts.length !== fills.length || nfts.some((e) => want.get(`${e.token}:${e.identifier}`) !== e.recipient))
    return { ...outcome, amount: toMe - fromMe, problem: 'NFTs moved differ' }
  return { ...outcome, amount: toMe - fromMe }
}

/* ---------- after the transaction ---------- */

export type BatchItemState = 'bought' | 'sold' | 'skipped' | 'failed' | 'unconfirmed'

export const BATCH_STATE_WORDS: Record<BatchItemState, string> = {
  bought: 'Bought',
  sold: 'Sold',
  skipped: 'No longer available, skipped. Nothing paid for it.',
  failed: 'Not filled: the transaction failed. Only the network fee was paid.',
  unconfirmed: 'Not confirmed yet',
}

type Log = { address: string; topics: readonly Hex[] | readonly string[]; data: Hex | string }

/**
 * What each order of a sent batch came to, from the receipt alone. A row is bought/sold only when Seaport 1.6 emitted
 * OrderFulfilled for that order's offerer (and order hash, when known) with this wallet as recipient and this NFT in
 * it. A successful transaction without that event skipped the row (sold or cancelled first). A failed transaction
 * filled nothing. No receipt: every row stays unconfirmed.
 */
export function receiptOutcome(
  plan: Pick<BatchPlan, 'side' | 'lines'>,
  receipt: { status?: string; logs?: readonly Log[] } | undefined,
  account: string
): { key: string; state: BatchItemState }[] {
  if (!receipt || !receipt.status) return plan.lines.map((l) => ({ key: l.key, state: 'unconfirmed' }))
  if (receipt.status !== 'success') return plan.lines.map((l) => ({ key: l.key, state: 'failed' }))
  const me = lc(account)
  const events: { orderHash: string; offerer: string; recipient: string; nfts: string[]; nftTo: string[] }[] = []
  for (const log of receipt.logs ?? []) {
    if (lc(log.address) !== lc(BATCH_SEAPORT)) continue
    try {
      const e = decodeEventLog({ abi: seaportEventsAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex })
      if (e.eventName !== 'OrderFulfilled') continue
      const a = e.args
      events.push({
        orderHash: lc(a.orderHash),
        offerer: lc(a.offerer),
        recipient: lc(a.recipient),
        nfts: a.offer.filter((i) => i.itemType >= 2).map((i) => `${lc(i.token)}:${i.identifier}`),
        nftTo: a.consideration
          .filter((i) => i.itemType >= 2)
          .map((i) => `${lc(i.token)}:${i.identifier}:${lc(i.recipient)}`),
      })
    } catch {
      // Not an event we read: it says nothing about these orders.
    }
  }

  const done: BatchItemState = plan.side === 'buy' ? 'bought' : 'sold'
  return plan.lines.map((l) => {
    const nft = `${lc(l.contract)}:${l.tokenId}`
    const hit = events.some(
      (e) =>
        e.offerer === l.offerer &&
        e.recipient === me &&
        (!l.orderHash || e.orderHash === lc(l.orderHash)) &&
        (plan.side === 'buy' ? e.nfts.includes(nft) : e.nftTo.includes(`${nft}:${l.offerer}`))
    )
    return { key: l.key, state: hit ? done : 'skipped' }
  })
}

/** For the fee line: OpenSea's own fee recipient, so the screen can name it. */
export const isOpenSeaFee = (recipient: string) => lc(recipient) === lc(OPENSEA_FEE_RECIPIENT)

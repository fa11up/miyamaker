// src/pages/Swap/nft/markets.ts: what is signed is what is shown. planFill builds the screen from OpenSea's
// orders[0] but signs transaction.input_data, so the encoded Seaport call is decoded and checked against that order
// (signedFillProblem). Calldata here is built with viem's encodeFunctionData in the shapes Seaport 1.6 takes.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encodeFunctionData } from 'viem'

import { quoteBigInts } from '../api/_lib/opensea.ts'
import {
  allowedConduitKey,
  MISMATCH,
  OPENSEA_CONDUIT_KEY,
  planFill,
  signedFillProblem,
} from '../src/pages/Swap/nft/markets.ts'
import { INPUT_ALIASES, OPENSEA_FEE_RECIPIENT, seaportAbi, SEAPORT_ADDRESSES } from '../src/pages/Swap/nft/seaport.ts'

type Hex = `0x${string}`
const MILADY = '0x5af0d9827e0c53e4799bb226655a1de152a425a5' as Hex
const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281' as Hex
const SELLER = '0x1111111111111111111111111111111111111111' as Hex
const BIDDER = '0x2222222222222222222222222222222222222222' as Hex
const EVIL = '0x000000000000000000000000000000000000dead' as Hex
const CREATOR = '0x6426df811c4e223ccb16448f08f42bf2f54e0ade' as Hex
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
const ZERO = '0x0000000000000000000000000000000000000000' as Hex
const ZERO32 = `0x${'0'.repeat(64)}` as Hex
const OS_KEY = OPENSEA_CONDUIT_KEY as Hex
const SIG = `0x${'11'.repeat(64)}` as Hex

const PRICE = 700000000000000000n
const OS_FEE = PRICE / 100n
const ROYALTY = (PRICE * 5n) / 100n
const TO_SELLER = PRICE - OS_FEE - ROYALTY

const ctx = (over: Record<string, unknown> = {}) => ({
  side: 'buy' as const,
  chainId: 1,
  contract: MILADY,
  tokenId: '42',
  account: ME,
  seaports: SEAPORT_ADDRESSES,
  abi: seaportAbi,
  aliases: INPUT_ALIASES,
  creatorFees: [CREATOR],
  ...over,
})
const err = (r: ReturnType<typeof planFill>) => (r.ok ? '' : r.error)

/* ---------- a listing, filled with fulfillBasicOrder_efficient (what OpenSea returns for most buys) ---------- */

/** OpenSea's orders[0].parameters for a 0.7 ETH listing of Milady #42. */
const listing = () => ({
  offerer: SELLER,
  zone: ZERO,
  offer: [{ itemType: 2, token: MILADY, identifierOrCriteria: '42', startAmount: '1', endAmount: '1' }],
  consideration: [
    [TO_SELLER, SELLER],
    [OS_FEE, OPENSEA_FEE_RECIPIENT],
    [ROYALTY, CREATOR],
  ].map(([amount, recipient]) => ({
    itemType: 0,
    token: ZERO,
    identifierOrCriteria: '0',
    startAmount: String(amount),
    endAmount: String(amount),
    recipient,
  })),
  orderType: 2,
  startTime: '1790000000',
  endTime: '1800000000',
  zoneHash: ZERO32,
  salt: '7',
  conduitKey: OS_KEY,
  totalOriginalConsiderationItems: 3,
})

/** BasicOrderParameters, as Seaport takes them (ETH_TO_ERC721 route, FULL_RESTRICTED: basicOrderType 2). */
const basicParams = (over: Record<string, unknown> = {}) => ({
  considerationToken: ZERO,
  considerationIdentifier: 0n,
  considerationAmount: TO_SELLER,
  offerer: SELLER,
  zone: ZERO,
  offerToken: MILADY,
  offerIdentifier: 42n,
  offerAmount: 1n,
  basicOrderType: 2,
  startTime: 1790000000n,
  endTime: 1800000000n,
  zoneHash: ZERO32,
  salt: 7n,
  offererConduitKey: OS_KEY,
  fulfillerConduitKey: OS_KEY,
  totalOriginalAdditionalRecipients: 2n,
  additionalRecipients: [
    { amount: OS_FEE, recipient: OPENSEA_FEE_RECIPIENT as Hex },
    { amount: ROYALTY, recipient: CREATOR },
  ],
  signature: SIG,
  ...over,
})

const basicCall = (over: Record<string, unknown> = {}) =>
  encodeFunctionData({
    abi: seaportAbi,
    functionName: 'fulfillBasicOrder_efficient_6GL6yc',
    args: [basicParams(over) as never],
  })

const shownBuy = { total: PRICE, token: ZERO, native: true, conduitKey: OS_KEY, numerator: 1n, denominator: 1n }

/** OpenSea's whole fulfillment_data for that listing, with input_data overridable. */
function buyResponse(input: Record<string, unknown> = {}, value = PRICE) {
  const p = basicParams(input)
  return JSON.parse(
    quoteBigInts(
      JSON.stringify(
        {
          fulfillment_data: {
            orders: [{ parameters: listing(), signature: SIG }],
            transaction: {
              function: 'fulfillBasicOrder_efficient_6GL6yc((…))',
              chain: 1,
              to: SEAPORT_ADDRESSES[0],
              value: String(value),
              input_data: { parameters: p },
            },
          },
        },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    ),
  )
}

test('a matching buy passes, and its calldata checks out on its own', () => {
  const plan = planFill(buyResponse(), ctx())
  assert.equal(plan.ok, true, err(plan))
  assert.equal(signedFillProblem(basicCall(), ctx(), listing(), shownBuy), undefined)
})

test('a buy for a different token id than the order is refused', () => {
  assert.equal(signedFillProblem(basicCall({ offerIdentifier: 43n }), ctx(), listing(), shownBuy), 'offer differs')
  // orders[0] (what the screen shows) says #42; the call OpenSea built buys #43.
  assert.equal(err(planFill(buyResponse({ offerIdentifier: 43n }), ctx())), MISMATCH.buy)
  // A different collection, or two instead of one, likewise.
  assert.equal(signedFillProblem(basicCall({ offerToken: EVIL }), ctx(), listing(), shownBuy), 'offer differs')
  assert.equal(signedFillProblem(basicCall({ offerAmount: 2n }), ctx(), listing(), shownBuy), 'offer differs')
})

test('a buy that pays a different amount than shown is refused', () => {
  // More to the seller, the same ETH sent: Seaport would pull the shortfall from elsewhere or revert; never signed.
  const more = { considerationAmount: TO_SELLER + 1n }
  assert.equal(signedFillProblem(basicCall(more), ctx(), listing(), shownBuy), 'consideration differs')
  assert.equal(err(planFill(buyResponse(more), ctx())), MISMATCH.buy)
  // A fee paid to someone else than the order names.
  const redirected = {
    additionalRecipients: [
      { amount: OS_FEE, recipient: EVIL },
      { amount: ROYALTY, recipient: CREATOR },
    ],
  }
  assert.equal(signedFillProblem(basicCall(redirected), ctx(), listing(), shownBuy), 'consideration differs')
  assert.equal(err(planFill(buyResponse(redirected), ctx())), MISMATCH.buy)
  // The order itself, but a screen total that is not what it adds up to.
  assert.equal(
    signedFillProblem(basicCall(), ctx(), listing(), { ...shownBuy, total: PRICE - 1n }),
    'amount paid differs',
  )
  // Paid in WETH (ERC20_TO_ERC721 route) while the order and screen say ETH.
  assert.equal(
    signedFillProblem(basicCall({ basicOrderType: 10, considerationToken: WETH }), ctx(), listing(), shownBuy),
    'consideration differs',
  )
})

test('a buy that sends the NFT to a different recipient is refused', () => {
  const order = listing()
  const advanced = (recipient: Hex) =>
    encodeFunctionData({
      abi: seaportAbi,
      functionName: 'fulfillAdvancedOrder',
      args: [
        {
          parameters: {
            ...order,
            offer: order.offer.map((i) => ({
              ...i,
              identifierOrCriteria: 42n,
              startAmount: 1n,
              endAmount: 1n,
              token: MILADY,
            })),
            consideration: order.consideration.map((i) => ({
              ...i,
              token: ZERO,
              identifierOrCriteria: 0n,
              startAmount: BigInt(i.startAmount),
              endAmount: BigInt(i.endAmount),
              recipient: i.recipient as Hex,
            })),
            startTime: 1790000000n,
            endTime: 1800000000n,
            salt: 7n,
            totalOriginalConsiderationItems: 3n,
          },
          numerator: 1n,
          denominator: 1n,
          signature: SIG,
          extraData: '0x',
        },
        [],
        OS_KEY,
        recipient,
      ] as never,
    })
  assert.equal(signedFillProblem(advanced(ME), ctx(), order, shownBuy), undefined)
  assert.equal(signedFillProblem(advanced(ZERO), ctx(), order, shownBuy), undefined, '0x0 = the sender')
  assert.equal(signedFillProblem(advanced(EVIL), ctx(), order, shownBuy), 'recipient differs')
})

test('a conduit OpenSea does not own is refused: approving it could hand over the tokens', () => {
  const other = `0x${'ab'.repeat(20)}${'0'.repeat(24)}` as Hex
  assert.equal(allowedConduitKey(ZERO32), true)
  assert.equal(allowedConduitKey(OS_KEY), true)
  assert.equal(allowedConduitKey(other), false)
  assert.equal(
    signedFillProblem(basicCall({ fulfillerConduitKey: other }), ctx(), listing(), { ...shownBuy, conduitKey: other }),
    'conduit differs',
  )
  assert.equal(err(planFill(buyResponse({ fulfillerConduitKey: other }), ctx())), MISMATCH.buy)
  // The key on screen (used for the approval) must be the one in the call.
  assert.equal(signedFillProblem(basicCall(), ctx(), listing(), { ...shownBuy, conduitKey: ZERO32 }), 'conduit differs')
})

test('calldata that does not decode, or fills several orders, is refused', () => {
  assert.equal(signedFillProblem('0xdeadbeef', ctx(), listing(), shownBuy), 'calldata does not decode')
  const two = encodeFunctionData({
    abi: seaportAbi,
    functionName: 'fulfillAvailableOrders',
    args: [[], [], [], OS_KEY, 2n] as never,
  })
  assert.equal(signedFillProblem(two, ctx(), listing(), shownBuy), 'not a single-order fill')
})

/* ---------- accepting a collection offer with fulfillAdvancedOrder ---------- */

const GROSS = 1300000000000000000n // a 2-unit WETH collection offer
const FEE = GROSS / 100n
const bid = (over: { offer?: bigint; fee?: bigint } = {}) => ({
  offerer: BIDDER,
  zone: ZERO,
  offer: [
    {
      itemType: 1,
      token: WETH,
      identifierOrCriteria: 0n,
      startAmount: over.offer ?? GROSS,
      endAmount: over.offer ?? GROSS,
    },
  ],
  consideration: [
    { itemType: 4, token: MILADY, identifierOrCriteria: 0n, startAmount: 2n, endAmount: 2n, recipient: BIDDER },
    {
      itemType: 1,
      token: WETH,
      identifierOrCriteria: 0n,
      startAmount: over.fee ?? FEE,
      endAmount: over.fee ?? FEE,
      recipient: OPENSEA_FEE_RECIPIENT as Hex,
    },
  ],
  orderType: 3,
  startTime: 1790000000n,
  endTime: 1800000000n,
  zoneHash: ZERO32,
  salt: 7n,
  conduitKey: OS_KEY,
  totalOriginalConsiderationItems: 2n,
})
const accept = (params = bid(), identifier = 42n) =>
  encodeFunctionData({
    abi: seaportAbi,
    functionName: 'fulfillAdvancedOrder',
    args: [
      { parameters: params, numerator: 1n, denominator: 2n, signature: SIG, extraData: '0x' },
      [{ orderIndex: 0n, side: 1, index: 0n, identifier, criteriaProof: [] }],
      OS_KEY,
      ZERO,
    ] as never,
  })
const NET = GROSS / 2n - FEE / 2n
const shownSell = { total: NET, token: WETH, native: false, conduitKey: OS_KEY, numerator: 1n, denominator: 2n }
const sellCtx = ctx({ side: 'sell' })

function sellResponse(signedParams = bid(), identifier = 42n) {
  const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))
  return {
    fulfillment_data: {
      orders: [{ parameters: json(bid()), signature: '0x' }],
      transaction: {
        function: 'fulfillAdvancedOrder((…))',
        chain: 1,
        to: SEAPORT_ADDRESSES[0],
        value: '0',
        input_data: json({
          advancedOrder: { parameters: signedParams, numerator: 1, denominator: 2, signature: SIG, extraData: '0x' },
          criteriaResolvers: [{ orderIndex: 0, side: 1, index: 0, identifier, criteriaProof: [] }],
          fulfillerConduitKey: OS_KEY,
          recipient: ZERO,
        }),
      },
    },
  }
}

test('a matching offer acceptance passes: half the offer, less half its fee', () => {
  assert.equal(signedFillProblem(accept(), sellCtx, bid(), shownSell), undefined)
  const plan = planFill(sellResponse(), sellCtx)
  assert.equal(plan.ok && plan.total, NET, err(plan))
})

test('a sell whose call pays less than the order shown is refused', () => {
  // A lower offer in the call than in orders[0]: the seller would get less than the screen says.
  const lower = bid({ offer: GROSS - 10n ** 17n })
  assert.equal(signedFillProblem(accept(lower), sellCtx, bid(), shownSell), 'offer differs')
  assert.equal(err(planFill(sellResponse(lower), sellCtx)), MISMATCH.sell)
  // A bigger fee taken out of it.
  const fee = bid({ fee: FEE * 3n })
  assert.equal(signedFillProblem(accept(fee), sellCtx, bid(), shownSell), 'consideration differs')
  assert.equal(err(planFill(sellResponse(fee), sellCtx)), MISMATCH.sell)
  // The call is the order, but the screen promises more than it nets.
  assert.equal(
    signedFillProblem(accept(), sellCtx, bid(), { ...shownSell, total: NET + 1n }),
    'amount received differs',
  )
})

test('a sell that hands over a different NFT than shown is refused', () => {
  // The criteria resolve to #43 while the screen sells #42.
  assert.equal(signedFillProblem(accept(bid(), 43n), sellCtx, bid(), shownSell), 'NFT differs')
  assert.equal(err(planFill(sellResponse(bid(), 43n), sellCtx)), MISMATCH.sell)
})

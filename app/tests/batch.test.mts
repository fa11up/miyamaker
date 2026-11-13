// Batched OpenSea fills: src/pages/Swap/nft/batch.ts. Several listings bought, or several NFTs sold into their bids,
// in one Seaport 1.6 fulfillAvailableAdvancedOrders call. Fixtures are OpenSea fulfillment_data in the shapes seen on
// mainnet (Nov 2026): basic orders, and restricted orders on OpenSea's signed zone with extraData per fulfiller.
// The same code runs against real Seaport in tests/batch.fork.test.mts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData } from 'viem'

import { quoteBigInts } from '../api/_lib/opensea.ts'
import './ts-paths.mts'
import type { AdvancedOrder, BatchInput, BatchPlan } from '../src/pages/Swap/nft/batch.ts'

// batch.ts imports its siblings without an extension (as Vite does): loaded once ts-paths.mts has set up the resolver.
const {
  basicToAdvanced,
  BATCH_SEAPORT,
  batchCallProblem,
  fulfillmentsFor,
  MAX_BATCH,
  OPENSEA_SIGNED_ZONE,
  planBatch,
  receiptOutcome,
  signedZoneFacts,
  simulationCheck,
} = await import('../src/pages/Swap/nft/batch.ts')
import { OPENSEA_CONDUIT_KEY } from '../src/pages/Swap/nft/markets.ts'
import { OPENSEA_FEE_RECIPIENT, seaportAbi, seaportEventsAbi, SEAPORT_ADDRESSES } from '../src/pages/Swap/nft/seaport.ts'

type Hex = `0x${string}`
const NFT = '0x5af0d9827e0c53e4799bb226655a1de152a425a5' as Hex
const NFT2 = '0x9c0da8000000000000000000000000000000beef' as Hex
const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281' as Hex
const SELLER = '0x1111111111111111111111111111111111111111' as Hex
const SELLER2 = '0x3333333333333333333333333333333333333333' as Hex
const BIDDER = '0x2222222222222222222222222222222222222222' as Hex
const BIDDER2 = '0x4444444444444444444444444444444444444444' as Hex
const CREATOR = '0x6426df811c4e223ccb16448f08f42bf2f54e0ade' as Hex
const OTHER_ZONE = '0x00000000000000000000000000000000000000aa' as Hex
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Hex
const ZERO = '0x0000000000000000000000000000000000000000' as Hex
const ZERO32 = `0x${'0'.repeat(64)}` as Hex
const OS_KEY = OPENSEA_CONDUIT_KEY as Hex
const SIG = `0x${'11'.repeat(64)}` as Hex
const NOW = 1_794_516_767
const OS = OPENSEA_FEE_RECIPIENT as Hex

/** A stand-in OpenSea order hash for a row key. */
const hashOf = (key: string) => `0x${Buffer.from(key).toString('hex').padStart(64, '0')}`

const j = (v: unknown) =>
  JSON.parse(quoteBigInts(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))))

/** OpenSea's signed-zone extraData: 0x00, fulfiller, expiration (8 bytes), 64-byte signature, context. */
const zoneData = (fulfiller: string = ME, expiration = NOW + 300, context = `08${'0'.repeat(64)}`) =>
  `0x00${fulfiller.slice(2).toLowerCase()}${expiration.toString(16).padStart(16, '0')}${'ab'.repeat(64)}${context}` as Hex

type Over = Partial<{
  tokenId: bigint
  price: bigint
  seller: Hex
  orderType: number
  zone: Hex
  extraData: Hex
  money: { itemType: number; token: Hex }
  to: string
  salt: bigint
  contract: Hex
}>

/** A listing's parameters: price split 1% OpenSea, 5% creator, the rest to the seller. */
function listing(o: Over = {}) {
  const price = o.price ?? 1_000_000_000_000_000_000n
  const seller = o.seller ?? SELLER
  const money = o.money ?? { itemType: 0, token: ZERO }
  const pay = (amount: bigint, recipient: Hex) => ({
    ...money,
    identifierOrCriteria: 0n,
    startAmount: amount,
    endAmount: amount,
    recipient,
  })
  return {
    offerer: seller,
    zone: o.zone ?? OPENSEA_SIGNED_ZONE,
    offer: [{ itemType: 2, token: o.contract ?? NFT, identifierOrCriteria: o.tokenId ?? 1n, startAmount: 1n, endAmount: 1n }],
    consideration: [pay((price * 94n) / 100n, seller), pay(price / 100n, OS), pay((price * 5n) / 100n, CREATOR)],
    orderType: o.orderType ?? 2,
    startTime: 1_790_000_000n,
    endTime: 1_800_000_000n,
    zoneHash: ZERO32,
    salt: o.salt ?? 7n,
    conduitKey: OS_KEY,
    totalOriginalConsiderationItems: 3n,
  }
}

/** fulfillment_data for a listing as fulfillAdvancedOrder (OpenSea's shape for signed-zone orders). */
function advancedBuy(o: Over = {}) {
  const parameters = listing(o)
  const value = parameters.consideration.filter((c) => c.itemType === 0).reduce((s, c) => s + c.startAmount, 0n)
  return j({
    fulfillment_data: {
      orders: [{ parameters, signature: SIG }],
      transaction: {
        function: 'fulfillAdvancedOrder(((…)),…)',
        chain: 1,
        to: o.to ?? SEAPORT_ADDRESSES[0],
        value: String(value),
        input_data: {
          advancedOrder: { parameters, numerator: 1n, denominator: 1n, signature: SIG, extraData: o.extraData ?? zoneData() },
          criteriaResolvers: [],
          fulfillerConduitKey: OS_KEY,
          recipient: ZERO,
        },
      },
    },
  })
}

/** fulfillment_data for an open listing as a basic order (OpenSea's shape for most unrestricted buys). */
function basicBuy(o: Over = {}) {
  const parameters = { ...listing({ ...o, orderType: 0, zone: ZERO }) }
  const [toSeller, ...rest] = parameters.consideration
  return j({
    fulfillment_data: {
      orders: [{ parameters, signature: SIG }],
      transaction: {
        function: 'fulfillBasicOrder_efficient_6GL6yc((…))',
        chain: 1,
        to: SEAPORT_ADDRESSES[0],
        value: String(parameters.consideration.reduce((s, c) => s + c.startAmount, 0n)),
        input_data: {
          parameters: {
            considerationToken: ZERO,
            considerationIdentifier: 0n,
            considerationAmount: toSeller!.startAmount,
            offerer: parameters.offerer,
            zone: ZERO,
            offerToken: parameters.offer[0]!.token,
            offerIdentifier: parameters.offer[0]!.identifierOrCriteria,
            offerAmount: 1n,
            basicOrderType: 0,
            startTime: parameters.startTime,
            endTime: parameters.endTime,
            zoneHash: ZERO32,
            salt: parameters.salt,
            offererConduitKey: OS_KEY,
            fulfillerConduitKey: OS_KEY,
            totalOriginalAdditionalRecipients: 2n,
            additionalRecipients: rest.map((c) => ({ amount: c.startAmount, recipient: c.recipient })),
            signature: SIG,
          },
        },
      },
    },
  })
}

/** An offer (WETH) for one NFT (item offer) or any of the collection (criteria offer), as fulfillAdvancedOrder. */
function offerResponse(o: { tokenId: bigint; bidder?: Hex; criteria?: boolean; bid?: bigint; token?: Hex; conduitKey?: Hex; contract?: Hex }) {
  const bid = o.bid ?? 500_000_000_000_000_000n
  const bidder = o.bidder ?? BIDDER
  const token = o.token ?? WETH
  const fee = (amount: bigint, recipient: Hex) => ({
    itemType: 1,
    token,
    identifierOrCriteria: 0n,
    startAmount: amount,
    endAmount: amount,
    recipient,
  })
  const parameters = {
    offerer: bidder,
    zone: OPENSEA_SIGNED_ZONE,
    offer: [{ itemType: 1, token, identifierOrCriteria: 0n, startAmount: bid, endAmount: bid }],
    consideration: [
      {
        itemType: o.criteria ? 4 : 2,
        token: o.contract ?? NFT,
        identifierOrCriteria: o.criteria ? 0n : o.tokenId,
        startAmount: 1n,
        endAmount: 1n,
        recipient: bidder,
      },
      fee(bid / 100n, OS),
      fee((bid * 5n) / 100n, CREATOR),
    ],
    orderType: 2,
    startTime: 1_790_000_000n,
    endTime: 1_800_000_000n,
    zoneHash: ZERO32,
    salt: o.tokenId,
    conduitKey: OS_KEY,
    totalOriginalConsiderationItems: 3n,
  }
  return j({
    fulfillment_data: {
      orders: [{ parameters, signature: SIG }],
      transaction: {
        function: 'fulfillAdvancedOrder(((…)),…)',
        chain: 1,
        to: SEAPORT_ADDRESSES[0],
        value: '0',
        input_data: {
          advancedOrder: {
            parameters,
            numerator: 1n,
            denominator: 1n,
            signature: SIG,
            extraData: zoneData(ME, NOW + 300, `00${o.tokenId.toString(16).padStart(64, '0')}`),
          },
          criteriaResolvers: o.criteria
            ? [{ orderIndex: 0n, side: 1, index: 0n, identifier: o.tokenId, criteriaProof: [] }]
            : [],
          fulfillerConduitKey: o.conduitKey ?? OS_KEY,
          recipient: ZERO,
        },
      },
    },
  })
}

const buyInput = (key: string, response: unknown, tokenId = '1', contract: string = NFT): BatchInput => ({
  key,
  orderHash: hashOf(key),
  response,
  contract,
  tokenId,
  creatorFees: [CREATOR],
})
const opts = (side: 'buy' | 'sell' = 'buy') => ({ side, chainId: 1, account: ME, now: NOW })
const ok = (r: ReturnType<typeof planBatch>): BatchPlan => {
  assert.ok(r.ok, r.ok ? '' : `${r.error} ${JSON.stringify(r.excluded)}`)
  return r
}
const decode = (data: Hex) => decodeFunctionData({ abi: seaportAbi, data }).args as unknown as readonly any[]

const ETH = 1_000_000_000_000_000_000n

/* ---------- buys ---------- */

test('three listings become one call: value is their sum, NFTs to the wallet, no conduit, all orders filled', () => {
  const plan = ok(
    planBatch(
      [
        buyInput('a', advancedBuy({ tokenId: 1n, price: ETH })),
        buyInput('b', basicBuy({ tokenId: 2n, price: 2n * ETH, seller: SELLER2 })),
        buyInput('c', advancedBuy({ tokenId: 3n, price: 3n * ETH, salt: 9n }), '3'),
      ].map((x, i) => ({ ...x, tokenId: String(i + 1) })),
      opts()
    )
  )
  assert.equal(plan.call.to, BATCH_SEAPORT)
  assert.equal(plan.call.value, 6n * ETH)
  assert.equal(plan.totals.total, 6n * ETH)
  assert.deepEqual(plan.excluded, [])
  const [orders, resolvers, offF, conF, key, recipient, max] = decode(plan.call.data)
  assert.equal(orders.length, 3)
  assert.equal(resolvers.length, 0)
  assert.equal(key, ZERO32)
  assert.equal(recipient.toLowerCase(), ME)
  assert.equal(max, 3n)
  // Each offer item on its own; the OpenSea fee and the creator fee joined across the three orders.
  assert.equal(offF.length, 3)
  assert.deepEqual(
    conF.map((g: { orderIndex: bigint; itemIndex: bigint }[]) => g.map((c) => `${c.orderIndex}.${c.itemIndex}`).join(',')),
    ['0.0,2.0', '0.1,1.1,2.1', '0.2,1.2,2.2', '1.0']
  )
  // The zone permission is carried with its order, and the earliest one sets when the plan runs out.
  assert.equal(orders[0].extraData, zoneData())
  assert.equal(orders[1].extraData, '0x')
  assert.equal(plan.expiresAt, NOW + 300)
  assert.deepEqual(
    plan.byRecipient.map((r) => [r.recipient, r.amount]),
    [
      [SELLER, (ETH * 94n) / 100n + (3n * ETH * 94n) / 100n],
      [OS, (6n * ETH) / 100n],
      [CREATOR, (6n * ETH * 5n) / 100n],
      [SELLER2, (2n * ETH * 94n) / 100n],
    ]
  )
  assert.deepEqual(
    plan.totals.lines.map((l) => l.label),
    ['To the seller', 'OpenSea fee', 'Creator fee (required)']
  )
  assert.equal(batchCallProblem(plan.call, plan, ME), undefined)
})

test('a basic order becomes the full order it stands for (same fields Seaport hashes)', () => {
  const resp = basicBuy({ tokenId: 5n, price: ETH })
  const want = listing({ tokenId: 5n, price: ETH, orderType: 0, zone: ZERO })
  const got = basicToAdvanced(resp.fulfillment_data.transaction.input_data.parameters)
  assert.deepEqual(
    JSON.parse(JSON.stringify(got.parameters, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).toLowerCase()),
    JSON.parse(JSON.stringify(want, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).toLowerCase())
  )
  assert.equal(got.signature, SIG)
})

test('what cannot be batched is left out with a reason, and the rest still go', () => {
  const r = planBatch(
    [
      buyInput('good', advancedBuy({ tokenId: 1n }), '1'),
      buyInput('token', advancedBuy({ tokenId: 2n, money: { itemType: 1, token: WETH } }), '2'),
      buyInput('old', advancedBuy({ tokenId: 3n, to: SEAPORT_ADDRESSES[1] }), '3'),
      buyInput('zone', advancedBuy({ tokenId: 4n, zone: OTHER_ZONE }), '4'),
      buyInput('expired', advancedBuy({ tokenId: 5n, extraData: zoneData(ME, NOW + 10) }), '5'),
      buyInput('theirs', advancedBuy({ tokenId: 6n, extraData: zoneData(BIDDER) }), '6'),
      buyInput('nozone', advancedBuy({ tokenId: 7n, extraData: '0x' }), '7'),
      buyInput('mine', advancedBuy({ tokenId: 8n, seller: ME }), '8'),
      buyInput('again', advancedBuy({ tokenId: 1n, salt: 99n }), '1'),
      buyInput('wrong', advancedBuy({ tokenId: 10n }), '11'),
      buyInput('contract', advancedBuy({ tokenId: 12n, orderType: 4 }), '12'),
    ],
    opts()
  )
  const plan = ok(r)
  assert.deepEqual(plan.lines.map((l) => l.key), ['good'])
  const why = Object.fromEntries(plan.excluded.map((e) => [e.key, e]))
  assert.match(why.token!.reason, /token/)
  assert.equal(why.token!.oneByOne, true)
  assert.match(why.old!.reason, /older Seaport/)
  assert.match(why.zone!.reason, /extra check/)
  assert.match(why.expired!.reason, /run out/)
  assert.match(why.theirs!.reason, /another wallet/)
  assert.match(why.nozone!.reason, /no permission/)
  assert.match(why.mine!.reason, /your own listing/)
  assert.match(why.again!.reason, /Already/)
  assert.equal(why.wrong!.oneByOne, false) // planFill refused it: not for this NFT
  assert.match(why.contract!.reason, /on its own/)
  assert.equal(plan.excluded.length, 10)
})

test(`a batch holds at most ${MAX_BATCH}`, () => {
  const many = Array.from({ length: MAX_BATCH + 2 }, (_, i) =>
    buyInput(`k${i}`, advancedBuy({ tokenId: BigInt(i + 1), salt: BigInt(i) }), String(i + 1))
  )
  const plan = ok(planBatch(many, opts()))
  assert.equal(plan.lines.length, MAX_BATCH)
  assert.deepEqual(plan.excluded.map((e) => e.key), [`k${MAX_BATCH}`, `k${MAX_BATCH + 1}`])
  assert.equal(MAX_BATCH <= 8, true) // the fulfillment route's burst is 10 per visitor
})

test('nothing batchable: no plan, only reasons', () => {
  const r = planBatch([buyInput('t', advancedBuy({ money: { itemType: 1, token: WETH } }))], opts())
  assert.equal(r.ok, false)
  assert.equal(r.ok ? 0 : r.excluded.length, 1)
})

/* ---------- the guard on what is signed ---------- */

const threeBuys = () =>
  ok(
    planBatch(
      [1n, 2n, 3n].map((id) => buyInput(`k${id}`, advancedBuy({ tokenId: id, salt: id }), String(id))),
      opts()
    )
  )

/** Re-encodes the plan's call with one argument changed. */
const tampered = (plan: BatchPlan, change: (args: any[]) => void, value = plan.call.value) => {
  const args = structuredClone(decode(plan.call.data)) as any[]
  change(args)
  return { ...plan.call, value, data: encodeFunctionData({ abi: seaportAbi, functionName: 'fulfillAvailableAdvancedOrders', args: args as never }) }
}

test('batchCallProblem catches every change to the signed call', () => {
  const plan = threeBuys()
  const cases: [string, ReturnType<typeof tampered>][] = [
    ['recipient differs', tampered(plan, (a) => { a[5] = BIDDER })],
    ['conduit differs', tampered(plan, (a) => { a[4] = OS_KEY })],
    ['maximumFulfilled differs', tampered(plan, (a) => { a[6] = 2n })],
    ['value differs', tampered(plan, () => {}, plan.call.value + 1n)],
    ['order 1 differs', tampered(plan, (a) => { a[0][1].parameters.consideration[0].recipient = BIDDER })],
    ['order 0 differs', tampered(plan, (a) => { a[0][0].numerator = 1n; a[0][0].denominator = 2n })],
    ['order 2 differs', tampered(plan, (a) => { a[0][2].extraData = '0x' })],
    ['offer item left out', tampered(plan, (a) => { a[2].pop() })],
    ['consideration item used twice', tampered(plan, (a) => { a[3].push([{ orderIndex: 0n, itemIndex: 0n }]) })],
    ['consideration fulfillment joins different items', tampered(plan, (a) => { a[3][0].push(a[3].pop()[0]) })],
    ['resolvers differ', tampered(plan, (a) => { a[1].push({ orderIndex: 0n, side: 1, index: 0n, identifier: 1n, criteriaProof: [] }) })],
  ]
  for (const [want, call] of cases) assert.equal(batchCallProblem(call, plan, ME), want, want)
  assert.equal(batchCallProblem({ ...plan.call, to: SEAPORT_ADDRESSES[1] as Hex }, plan, ME), 'not Seaport 1.6')
  assert.equal(batchCallProblem(plan.call, plan, BIDDER), 'recipient differs')
})

test('fulfillments never join NFTs, nor payments to different people', () => {
  const o = (recipient: Hex, nftType = 2): AdvancedOrder =>
    ({
      parameters: {
        ...listing({ seller: recipient }),
        consideration: [
          { itemType: 0, token: ZERO, identifierOrCriteria: 0n, startAmount: 1n, endAmount: 1n, recipient },
          { itemType: nftType, token: NFT, identifierOrCriteria: 0n, startAmount: 1n, endAmount: 1n, recipient },
        ],
      },
    }) as unknown as AdvancedOrder
  const f = fulfillmentsFor([o(SELLER, 4), o(SELLER2, 4), o(SELLER, 4)])
  assert.deepEqual(
    f.considerationFulfillments.map((g) => g.map((c) => `${c.orderIndex}.${c.itemIndex}`).join(',')),
    ['0.0,2.0', '0.1', '1.0', '1.1', '2.1']
  )
})

/* ---------- sells ---------- */

const sellInput = (key: string, response: unknown, tokenId: string, contract: string = NFT): BatchInput => ({
  key,
  orderHash: hashOf(key),
  response,
  contract,
  tokenId,
  creatorFees: [CREATOR],
})

test('an item offer and a collection offer sold in one call: resolvers re-pointed, no ETH, fees out of each bid', () => {
  const plan = ok(
    planBatch(
      [
        sellInput('item', offerResponse({ tokenId: 7n }), '7'),
        sellInput('coll', offerResponse({ tokenId: 9n, criteria: true, bidder: BIDDER2, bid: ETH }), '9'),
      ],
      opts('sell')
    )
  )
  assert.equal(plan.call.value, 0n)
  assert.equal(plan.conduitKey, OS_KEY)
  assert.deepEqual(plan.currency, { native: false, token: WETH })
  const [orders, resolvers, , , key, recipient] = decode(plan.call.data)
  assert.equal(orders.length, 2)
  assert.equal(key, OS_KEY)
  assert.equal(recipient.toLowerCase(), ME)
  // The collection offer is order 1 in the batch, so its resolver now points there.
  assert.deepEqual(resolvers, [{ orderIndex: 1n, side: 1, index: 0n, identifier: 9n, criteriaProof: [] }])
  const half = ETH / 2n
  const fees = (x: bigint) => x / 100n + (x * 5n) / 100n
  assert.deepEqual(plan.lines.map((l) => [l.gross, l.fees, l.net]), [
    [half, fees(half), half - fees(half)],
    [ETH, fees(ETH), ETH - fees(ETH)],
  ])
  assert.equal(plan.totals.total, half + ETH - fees(half) - fees(ETH))
  assert.equal(plan.fromYou, fees(half) + fees(ETH))
  assert.deepEqual(plan.approvals, [{ contract: NFT, kind: 'erc721', tokenIds: ['7', '9'] }])
  assert.equal(batchCallProblem(plan.call, plan, ME), undefined)
})

test('sells: another token or another conduit is sold on its own; the same NFT is sold once', () => {
  const plan = ok(
    planBatch(
      [
        sellInput('a', offerResponse({ tokenId: 1n }), '1'),
        sellInput('b', offerResponse({ tokenId: 2n }), '2'),
        sellInput('usdc', offerResponse({ tokenId: 3n, token: USDC }), '3'),
        sellInput('conduit', offerResponse({ tokenId: 4n, conduitKey: ZERO32 }), '4'),
        sellInput('twice', offerResponse({ tokenId: 1n, criteria: true, bidder: BIDDER2 }), '1'),
        sellInput('mine', offerResponse({ tokenId: 5n, bidder: ME }), '5'),
      ],
      opts('sell')
    )
  )
  assert.deepEqual(plan.lines.map((l) => l.key), ['a', 'b'])
  const why = Object.fromEntries(plan.excluded.map((e) => [e.key, e.reason]))
  assert.match(why.usdc!, /another token/)
  assert.match(why.conduit!, /different approval/)
  assert.match(why.twice!, /Already/)
  assert.match(why.mine!, /your own offer/)
})

test('a sell call that pays the seller less than the screen says is refused', () => {
  const plan = ok(
    planBatch([sellInput('a', offerResponse({ tokenId: 1n }), '1'), sellInput('b', offerResponse({ tokenId: 2n }), '2')], opts('sell'))
  )
  const lines = plan.lines.map((l, i) => (i === 0 ? { ...l, net: l.net + 1n } : l))
  assert.equal(batchCallProblem(plan.call, { ...plan, lines }, ME), 'amount received differs')
  assert.equal(batchCallProblem({ ...plan.call, value: 1n }, plan, ME), 'a sell sends ETH')
})

/* ---------- the simulation and the receipt ---------- */

const exec = (itemType: number, token: Hex, identifier: bigint, amount: bigint, recipient: Hex, offerer: Hex = ME) => ({
  item: { itemType, token, identifier, amount, recipient },
  offerer,
  conduitKey: ZERO32,
})

test('simulationCheck: which orders fill, and that Seaport moves exactly what they say', () => {
  const plan = threeBuys()
  const price = ETH
  const pays = (id: bigint) => [
    exec(0, ZERO, 0n, (price * 94n) / 100n, SELLER),
    exec(0, ZERO, 0n, price / 100n, OS),
    exec(0, ZERO, 0n, (price * 5n) / 100n, CREATOR),
    exec(2, NFT, id, 1n, ME, SELLER),
  ]
  // k2 sold first: Seaport skips it, and only the other two are paid for.
  const good = simulationCheck(plan, [[true, false, true], [...pays(1n), ...pays(3n)]], ME)
  assert.deepEqual(good, { fills: ['k1', 'k3'], skips: ['k2'], amount: 2n * ETH })
  const extra = simulationCheck(plan, [[true, false, true], [...pays(1n), ...pays(3n), exec(0, ZERO, 0n, 1n, BIDDER)]], ME)
  assert.equal(extra.problem, 'ETH spent differs')
  const elsewhere = simulationCheck(plan, [[true, false, true], [...pays(1n), ...pays(3n).slice(0, 3), exec(2, NFT, 3n, 1n, BIDDER)]], ME)
  assert.equal(elsewhere.problem, 'NFTs moved differ')
})

test('simulationCheck on a sell: the bids to the wallet, the fees out, each NFT to its bidder', () => {
  const plan = ok(
    planBatch(
      [sellInput('item', offerResponse({ tokenId: 7n }), '7'), sellInput('coll', offerResponse({ tokenId: 9n, criteria: true, bidder: BIDDER2, bid: ETH }), '9')],
      opts('sell')
    )
  )
  const half = ETH / 2n
  const r = simulationCheck(
    plan,
    [
      [true, true],
      [
        exec(1, WETH, 0n, half, ME, BIDDER),
        exec(1, WETH, 0n, ETH, ME, BIDDER2),
        exec(2, NFT, 7n, 1n, BIDDER),
        exec(2, NFT, 9n, 1n, BIDDER2),
        exec(1, WETH, 0n, (half + ETH) / 100n, OS),
        exec(1, WETH, 0n, ((half + ETH) * 5n) / 100n, CREATOR),
      ],
    ],
    ME
  )
  assert.equal(r.problem, undefined)
  assert.equal(r.amount, plan.totals.total)
  const wrongBidder = simulationCheck(plan, [[true, true], [exec(1, WETH, 0n, half, ME), exec(1, WETH, 0n, ETH, ME), exec(2, NFT, 7n, 1n, BIDDER2), exec(2, NFT, 9n, 1n, BIDDER), exec(1, WETH, 0n, (half + ETH) / 100n, OS), exec(1, WETH, 0n, ((half + ETH) * 5n) / 100n, CREATOR)]], ME)
  assert.equal(wrongBidder.problem, 'NFTs moved differ')
})

/** An OrderFulfilled log as Seaport emits it. */
const fulfilled = (o: { hash: string; offerer: Hex; recipient: Hex; nft: [Hex, bigint]; address?: string }) => ({
  address: o.address ?? BATCH_SEAPORT,
  topics: encodeEventTopics({ abi: seaportEventsAbi, eventName: 'OrderFulfilled', args: { offerer: o.offerer, zone: OPENSEA_SIGNED_ZONE as Hex } }) as Hex[],
  data: encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }] },
      { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }] },
    ],
    [o.hash as Hex, o.recipient, [[2, o.nft[0], o.nft[1], 1n]], [[0, ZERO, 0n, 1n, o.offerer]]]
  ),
})

test('receiptOutcome: bought only where the receipt shows it', () => {
  const plan = threeBuys()
  const h = hashOf
  const logs = [
    fulfilled({ hash: h('k1'), offerer: SELLER, recipient: ME, nft: [NFT, 1n] }),
    // Right order, but the NFT went to someone else: not a buy for this wallet.
    fulfilled({ hash: h('k2'), offerer: SELLER, recipient: BIDDER, nft: [NFT, 2n] }),
    // From a contract that is not Seaport 1.6: ignored.
    fulfilled({ hash: h('k3'), offerer: SELLER, recipient: ME, nft: [NFT, 3n], address: SEAPORT_ADDRESSES[1] }),
  ]
  assert.deepEqual(receiptOutcome(plan, { status: 'success', logs }, ME), [
    { key: 'k1', state: 'bought' },
    { key: 'k2', state: 'skipped' },
    { key: 'k3', state: 'skipped' },
  ])
  assert.deepEqual(receiptOutcome(plan, { status: 'reverted', logs }, ME).map((x) => x.state), ['failed', 'failed', 'failed'])
  assert.deepEqual(receiptOutcome(plan, undefined, ME).map((x) => x.state), ['unconfirmed', 'unconfirmed', 'unconfirmed'])
  // A different order hash for the same NFT is not this order.
  const other = [fulfilled({ hash: h('zz'), offerer: SELLER, recipient: ME, nft: [NFT, 1n] })]
  assert.equal(receiptOutcome(plan, { status: 'success', logs: other }, ME)[0]!.state, 'skipped')
})

test('signedZoneFacts reads OpenSea zone extraData; anything else is not it', () => {
  const z = signedZoneFacts(zoneData(ME, NOW + 175))
  assert.deepEqual(z, { fulfiller: ME, expiration: NOW + 175, context: `0x08${'0'.repeat(64)}` })
  assert.equal(signedZoneFacts('0x'), undefined)
  assert.equal(signedZoneFacts(`0x01${'00'.repeat(120)}`), undefined)
  // A real one from mainnet (a collection offer accepted in an OpenSea batch, Nov 2026).
  const real =
    '0x008c654ee8d13077af894b541a0b69761e277eda0c000000006af627cebf5130e59238c652c0ed82d50d084d3080dce9b77f7fdd88193f68bb18ac79acb633a50b47a5965383ac44b4f62824920401a3c31577a1d52b25bdd8e619f6040000000000000000000000000000000000000000000000000000000000000002b6'
  assert.equal(signedZoneFacts(real)!.fulfiller, '0x8c654ee8d13077af894b541a0b69761e277eda0c')
  assert.equal(signedZoneFacts(real)!.expiration, 1794516942)
})

test('both sides keep NFT2 contracts apart: two collections, two approvals', () => {
  const plan = ok(
    planBatch(
      [sellInput('a', offerResponse({ tokenId: 1n }), '1'), sellInput('b', offerResponse({ tokenId: 1n, contract: NFT2 }), '1', NFT2)],
      opts('sell')
    )
  )
  assert.deepEqual(plan.approvals.map((a) => [a.contract, a.tokenIds]), [[NFT, ['1']], [NFT2, ['1']]])
})

// Batched OpenSea fills (src/pages/Swap/nft/batch.ts) against the real Seaport 1.6 on an anvil mainnet fork.
// Skipped unless FORK_RPC_URL is set (an archive-capable mainnet RPC) and anvil (Foundry) is installed, so
// `yarn test` stays offline. Run from app/:
//   FORK_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key> node --test tests/batch.fork.test.mts
//
// 1. Own orders, signed here with fresh keys on a test ERC-721: three listings bought in one call after the first
//    sold to someone else (skipped, its ETH refunded), one of them sent as a basic order (so the basic → full order
//    conversion must hash to what the seller signed); then an item offer and a collection (criteria) offer accepted
//    in one sell call, the fees to OpenSea and the creator out of each bid.
// 2. Real OpenSea orders on its signed zone (restricted, extraData per fulfiller), taken from mainnet transactions
//    of Nov 2026 and replayed on a fork of the block before: five listings bought in one call (one bought singly
//    first, so skipped), and two collection offers (one a part fill of an offer for 2 NFTs) accepted in one call.
import assert from 'node:assert/strict'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeFunctionData,
  type Hex,
  http,
  parseAbi,
  type PublicClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import './ts-paths.mts'
import type { BatchInput, BatchPlan } from '../src/pages/Swap/nft/batch.ts'
import { OPENSEA_CONDUIT_KEY } from '../src/pages/Swap/nft/markets.ts'
import { conduitControllerAbi, CONDUIT_CONTROLLER, OPENSEA_FEE_RECIPIENT, seaportAbi, seaportCallAbi } from '../src/pages/Swap/nft/seaport.ts'

const RPC = process.env.FORK_RPC_URL
const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const skip = !RPC ? 'FORK_RPC_URL not set' : !hasAnvil ? 'anvil not installed' : false

const { BATCH_SEAPORT, OPENSEA_CONDUIT, planBatch, receiptOutcome, simulationCheck } = await import(
  '../src/pages/Swap/nft/batch.ts'
)

const SEAPORT = BATCH_SEAPORT as Address
const OS_KEY = OPENSEA_CONDUIT_KEY as Hex
const OS_FEE = OPENSEA_FEE_RECIPIENT as Address
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const ZERO32 = `0x${'0'.repeat(64)}` as Hex
const ETH = 10n ** 18n

/** TestNft.sol, solc 0.8.28 (optimizer 200): a bare ERC-721 anyone can mint. Source in the comment below. */
const NFT_BYTECODE = '0x6080604052348015600e575f5ffd5b5061089e8061001c5f395ff3fe608060405234801561000f575f5ffd5b50600436106100a6575f3560e01c806342842e0e1161006e57806342842e0e1461014d5780636352211e1461016057806370a0823114610188578063a22cb465146101b5578063b88d4fde146101c8578063e985e9c5146101db575f5ffd5b806301ffc9a7146100aa578063081812fc146100d2578063095ea7b31461011257806323b872dd1461012757806340c10f191461013a575b5f5ffd5b6100bd6100b836600461064d565b610208565b60405190151581526020015b60405180910390f35b6100fa6100e036600461067b565b60026020525f90815260409020546001600160a01b031681565b6040516001600160a01b0390911681526020016100c9565b6101256101203660046106ad565b61023e565b005b6101256101353660046106d5565b61031e565b6101256101483660046106ad565b6104f4565b61012561015b3660046106d5565b6105c0565b6100fa61016e36600461067b565b5f602081905290815260409020546001600160a01b031681565b6101a761019636600461070f565b60016020525f908152604090205481565b6040519081526020016100c9565b6101256101c3366004610728565b6105d0565b6101256101d6366004610761565b61063b565b6100bd6101e93660046107f6565b600360209081525f928352604080842090915290825290205460ff1681565b5f6301ffc9a760e01b6001600160e01b03198316148061023857506380ac58cd60e01b6001600160e01b03198316145b92915050565b5f818152602081905260409020546001600160a01b03163381148061028557506001600160a01b0381165f90815260036020908152604080832033845290915290205460ff165b6102c35760405162461bcd60e51b81526004016102ba906020808252600490820152630c2eae8d60e31b604082015260600190565b60405180910390fd5b5f8281526002602052604080822080546001600160a01b0319166001600160a01b0387811691821790925591518593918516917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92591a4505050565b5f818152602081905260409020546001600160a01b0384811691161461036f5760405162461bcd60e51b81526004016102ba9060208082526004908201526366726f6d60e01b604082015260600190565b6001600160a01b0382166103aa5760405162461bcd60e51b8152602060048201526002602482015261746f60f01b60448201526064016102ba565b336001600160a01b03841614806103e357506001600160a01b0383165f90815260036020908152604080832033845290915290205460ff165b8061040357505f818152600260205260409020546001600160a01b031633145b6104385760405162461bcd60e51b81526004016102ba906020808252600490820152630c2eae8d60e31b604082015260600190565b6001600160a01b0383165f90815260016020526040812080549161045b8361083b565b90915550506001600160a01b0382165f90815260016020526040812080549161048383610850565b90915550505f8181526020818152604080832080546001600160a01b038088166001600160a01b031992831681179093556002909452828520805490911690559051849391928716917fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef91a4505050565b5f818152602081905260409020546001600160a01b0316156105415760405162461bcd60e51b81526020600482015260066024820152651b5a5b9d195960d21b60448201526064016102ba565b5f8181526020818152604080832080546001600160a01b0319166001600160a01b03871690811790915583526001909152812080549161058083610850565b909155505060405181906001600160a01b038416905f907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef908290a45050565b6105cb83838361031e565b505050565b335f8181526003602090815260408083206001600160a01b03871680855290835292819020805460ff191686151590811790915590519081529192917f17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31910160405180910390a35050565b61064685858561031e565b5050505050565b5f6020828403121561065d575f5ffd5b81356001600160e01b031981168114610674575f5ffd5b9392505050565b5f6020828403121561068b575f5ffd5b5035919050565b80356001600160a01b03811681146106a8575f5ffd5b919050565b5f5f604083850312156106be575f5ffd5b6106c783610692565b946020939093013593505050565b5f5f5f606084860312156106e7575f5ffd5b6106f084610692565b92506106fe60208501610692565b929592945050506040919091013590565b5f6020828403121561071f575f5ffd5b61067482610692565b5f5f60408385031215610739575f5ffd5b61074283610692565b915060208301358015158114610756575f5ffd5b809150509250929050565b5f5f5f5f5f60808688031215610775575f5ffd5b61077e86610692565b945061078c60208701610692565b935060408601359250606086013567ffffffffffffffff8111156107ae575f5ffd5b8601601f810188136107be575f5ffd5b803567ffffffffffffffff8111156107d4575f5ffd5b8860208284010111156107e5575f5ffd5b959894975092955050506020019190565b5f5f60408385031215610807575f5ffd5b61081083610692565b915061081e60208401610692565b90509250929050565b634e487b7160e01b5f52601160045260245ffd5b5f8161084957610849610827565b505f190190565b5f6001820161086157610861610827565b506001019056fea264697066735822122007f8e176dd6377e13f6071394f35089fc68e5829901ee378721e1c227db3a8b964736f6c634300081c0033' as Hex
/*
  contract TestNft {
    mapping(uint256 => address) public ownerOf; mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved; mapping(address => mapping(address => bool)) public isApprovedForAll;
    function mint(address to, uint256 id) external;                // requires unminted
    function approve(address spender, uint256 id) external;        // owner or operator
    function setApprovalForAll(address operator, bool approved) external;
    function transferFrom(address from, address to, uint256 id) public; // owner, operator or approved
    function safeTransferFrom(address, address, uint256[, bytes]) external; // = transferFrom (no receiver check)
    function supportsInterface(bytes4) external pure returns (bool);  // ERC-165, ERC-721
  }
*/
const nftAbi = parseAbi([
  'function mint(address to, uint256 id)',
  'function ownerOf(uint256 id) view returns (address)',
  'function setApprovalForAll(address operator, bool approved)',
])
const erc721Abi = parseAbi(['function ownerOf(uint256 id) view returns (address)'])
const wethAbi = parseAbi([
  'function deposit() payable',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
])
const seaportExtraAbi = parseAbi(['function getCounter(address offerer) view returns (uint256)'])

/* ---------- anvil ---------- */

async function startFork(blockNumber?: bigint) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const args = ['--fork-url', RPC!, '--port', String(port), '--silent', '--no-rate-limit', '--chain-id', '1']
  if (blockNumber !== undefined) args.push('--fork-block-number', String(blockNumber))
  const proc: ChildProcess = spawn('anvil', args, { stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  const transport = http(url, { timeout: 120_000 })
  const client = createPublicClient({ transport }) as PublicClient
  for (let i = 0; i < 300; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.getChainId()
      break
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const testClient = createTestClient({ mode: 'anvil', transport })
  const wallet = createWalletClient({ transport })
  return { client, testClient, wallet, stop: () => proc.kill() }
}
type Fork = Awaited<ReturnType<typeof startFork>>

async function fundedKey(fork: Fork, eth = 100n * ETH) {
  const account = privateKeyToAccount(generatePrivateKey())
  await fork.testClient.setBalance({ address: account.address, value: eth })
  return account
}

/** Sends and mines one transaction, returning its receipt (asserted successful unless allowed to fail). */
async function send(fork: Fork, tx: { account: unknown; to?: Address; data: Hex; value?: bigint }) {
  const hash = await fork.wallet.sendTransaction({ ...tx, chain: null } as never)
  return fork.client.waitForTransactionReceipt({ hash })
}
async function write(fork: Fork, account: unknown, address: Address, abi: readonly unknown[], functionName: string, args: unknown[], value?: bigint) {
  const hash = await fork.wallet.writeContract({ chain: null, account, address, abi, functionName, args, value } as never)
  const r = await fork.client.waitForTransactionReceipt({ hash })
  assert.equal(r.status, 'success', `${functionName} failed`)
  return r
}

/* ---------- Seaport orders ---------- */

type Item = { itemType: number; token: Address; identifierOrCriteria: bigint; startAmount: bigint; endAmount: bigint }
type CItem = Item & { recipient: Address }
type Params = {
  offerer: Address
  zone: Address
  offer: Item[]
  consideration: CItem[]
  orderType: number
  startTime: bigint
  endTime: bigint
  zoneHash: Hex
  salt: bigint
  conduitKey: Hex
  totalOriginalConsiderationItems: bigint
}

const item = (itemType: number, token: Address, id: bigint, amount: bigint): Item => ({
  itemType,
  token,
  identifierOrCriteria: id,
  startAmount: amount,
  endAmount: amount,
})
const pay = (itemType: number, token: Address, amount: bigint, recipient: Address): CItem => ({
  ...item(itemType, token, 0n, amount),
  recipient,
})

const TYPES = {
  OrderComponents: [
    { name: 'offerer', type: 'address' },
    { name: 'zone', type: 'address' },
    { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' },
    { name: 'orderType', type: 'uint8' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'zoneHash', type: 'bytes32' },
    { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' },
    { name: 'counter', type: 'uint256' },
  ],
  OfferItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
} as const

async function signOrder(fork: Fork, signer: ReturnType<typeof privateKeyToAccount>, p: Params): Promise<Hex> {
  const counter = await fork.client.readContract({ address: SEAPORT, abi: seaportExtraAbi, functionName: 'getCounter', args: [p.offerer] })
  const { totalOriginalConsiderationItems: _, ...rest } = p
  return signer.signTypedData({
    domain: { name: 'Seaport', version: '1.6', chainId: 1, verifyingContract: SEAPORT },
    types: TYPES,
    primaryType: 'OrderComponents',
    message: { ...rest, counter },
  })
}

const big = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))

/** OpenSea's fulfillment_data for one order, as fulfillAdvancedOrder (its shape for signed-zone orders and offers). */
function advancedResponse(p: Params, signature: Hex, o: { extraData?: Hex; numerator?: bigint; denominator?: bigint; resolvers?: unknown[] } = {}) {
  const num = o.numerator ?? 1n
  const den = o.denominator ?? 1n
  const value = p.consideration.filter((c) => c.itemType === 0).reduce((s, c) => s + (c.startAmount * num) / den, 0n)
  return big({
    fulfillment_data: {
      orders: [{ parameters: p, signature }],
      transaction: {
        function: 'fulfillAdvancedOrder(((…)),…)',
        chain: 1,
        to: SEAPORT,
        value,
        input_data: {
          advancedOrder: { parameters: p, numerator: num, denominator: den, signature, extraData: o.extraData ?? '0x' },
          criteriaResolvers: o.resolvers ?? [],
          fulfillerConduitKey: OS_KEY,
          recipient: ZERO,
        },
      },
    },
  })
}

/** OpenSea's fulfillment_data for an open ETH listing of one ERC-721, as a basic order. */
function basicResponse(p: Params, signature: Hex) {
  const [toSeller, ...rest] = p.consideration
  return big({
    fulfillment_data: {
      orders: [{ parameters: p, signature }],
      transaction: {
        function: 'fulfillBasicOrder_efficient_6GL6yc((…))',
        chain: 1,
        to: SEAPORT,
        value: p.consideration.reduce((s, c) => s + c.startAmount, 0n),
        input_data: {
          parameters: {
            considerationToken: ZERO,
            considerationIdentifier: 0n,
            considerationAmount: toSeller!.startAmount,
            offerer: p.offerer,
            zone: p.zone,
            offerToken: p.offer[0]!.token,
            offerIdentifier: p.offer[0]!.identifierOrCriteria,
            offerAmount: 1n,
            basicOrderType: p.orderType,
            startTime: p.startTime,
            endTime: p.endTime,
            zoneHash: p.zoneHash,
            salt: p.salt,
            offererConduitKey: p.conduitKey,
            fulfillerConduitKey: OS_KEY,
            totalOriginalAdditionalRecipients: BigInt(rest.length),
            additionalRecipients: rest.map((c) => ({ amount: c.startAmount, recipient: c.recipient })),
            signature,
          },
        },
      },
    },
  })
}

async function simulate(fork: Fork, plan: BatchPlan, account: Address) {
  const { result } = await fork.client.simulateContract({
    account,
    address: plan.call.to,
    abi: seaportCallAbi,
    functionName: 'fulfillAvailableAdvancedOrders',
    args: plan.args as never,
    value: plan.call.value,
  })
  return result as readonly unknown[]
}

const ok = (r: ReturnType<typeof planBatch>): BatchPlan => {
  assert.ok(r.ok, r.ok ? '' : `${r.error} ${JSON.stringify(r.excluded)}`)
  return r
}
const balance = (fork: Fork, address: Address) => fork.client.getBalance({ address })
const wethOf = (fork: Fork, address: Address) => fork.client.readContract({ address: WETH, abi: wethAbi, functionName: 'balanceOf', args: [address] })
const now = async (fork: Fork) => Number((await fork.client.getBlock()).timestamp)

/* ---------- 1. own orders ---------- */

test('own orders: 3 listings in one buy (first sold first), then an item and a collection offer in one sell', { skip, timeout: 300_000 }, async () => {
  const fork = await startFork()
  try {
    const conduit = await fork.client.readContract({ address: CONDUIT_CONTROLLER, abi: conduitControllerAbi, functionName: 'getConduit', args: [OS_KEY] })
    assert.equal(conduit[0].toLowerCase(), OPENSEA_CONDUIT.toLowerCase())
    assert.equal(conduit[1], true)

    const [deployer, me, sellerA, sellerB, early, bidderX, bidderY] = await Promise.all(
      Array.from({ length: 7 }, () => fundedKey(fork))
    )
    const creator = privateKeyToAccount(generatePrivateKey()).address
    const deploy = await send(fork, { account: deployer!, data: NFT_BYTECODE })
    const nft = deploy.contractAddress!
    const mint = (to: Address, id: bigint) => write(fork, deployer, nft, nftAbi, 'mint', [to, id])
    await mint(sellerA!.address, 1n)
    await mint(sellerA!.address, 2n)
    await mint(sellerB!.address, 3n)
    await write(fork, sellerA, nft, nftAbi, 'setApprovalForAll', [OPENSEA_CONDUIT, true])
    await write(fork, sellerB, nft, nftAbi, 'setApprovalForAll', [OPENSEA_CONDUIT, true])

    const t = BigInt(await now(fork))
    const listing = (seller: Address, id: bigint, price: bigint): Params => ({
      offerer: seller,
      zone: ZERO,
      offer: [item(2, nft, id, 1n)],
      consideration: [pay(0, ZERO, (price * 94n) / 100n, seller), pay(0, ZERO, price / 100n, OS_FEE), pay(0, ZERO, (price * 5n) / 100n, creator)],
      orderType: 0,
      startTime: t - 3600n,
      endTime: t + 86400n,
      zoneHash: ZERO32,
      salt: id,
      conduitKey: OS_KEY,
      totalOriginalConsiderationItems: 3n,
    })
    const prices = [ETH, 2n * ETH, 3n * ETH]
    const l1 = listing(sellerA!.address, 1n, prices[0]!)
    const l2 = listing(sellerA!.address, 2n, prices[1]!)
    const l3 = listing(sellerB!.address, 3n, prices[2]!)
    const s1 = await signOrder(fork, sellerA!, l1)
    const s2 = await signOrder(fork, sellerA!, l2)
    const s3 = await signOrder(fork, sellerB!, l3)
    const inputs: BatchInput[] = [
      { key: 'one', response: advancedResponse(l1, s1), contract: nft, tokenId: '1', creatorFees: [creator] },
      { key: 'two', response: basicResponse(l2, s2), contract: nft, tokenId: '2', creatorFees: [creator] },
      { key: 'three', response: advancedResponse(l3, s3), contract: nft, tokenId: '3', creatorFees: [creator] },
    ]
    const buy = ok(planBatch(inputs, { side: 'buy', chainId: 1, account: me!.address, now: await now(fork) }))
    assert.equal(buy.call.value, 6n * ETH)

    // At review: all three are there.
    const review = simulationCheck(buy, await simulate(fork, buy, me!.address), me!.address)
    assert.deepEqual(review, { fills: ['one', 'two', 'three'], skips: [], amount: 6n * ETH })

    // Someone else buys #1 first, as a single fill.
    await write(fork, early, SEAPORT, seaportAbi, 'fulfillOrder', [{ parameters: l1, signature: s1 }, ZERO32], prices[0])
    assert.equal(await fork.client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [1n] }), early!.address)

    // Right before the wallet: the batch still goes, and Seaport says #1 will be skipped.
    const before = simulationCheck(buy, await simulate(fork, buy, me!.address), me!.address)
    assert.deepEqual(before, { fills: ['two', 'three'], skips: ['one'], amount: 5n * ETH })
    assert.equal(before.problem, undefined)

    const b0 = { me: await balance(fork, me!.address), a: await balance(fork, sellerA!.address), b: await balance(fork, sellerB!.address), os: await balance(fork, OS_FEE), creator: await balance(fork, creator) }
    const receipt = await send(fork, { account: me!, to: buy.call.to, data: buy.call.data, value: buy.call.value })
    assert.equal(receipt.status, 'success')
    const gas = receipt.gasUsed * receipt.effectiveGasPrice
    console.log(`  buy batch of 3 (1 skipped): gas ${receipt.gasUsed}`)
    assert.deepEqual(receiptOutcome(buy, receipt, me!.address), [
      { key: 'one', state: 'skipped' },
      { key: 'two', state: 'bought' },
      { key: 'three', state: 'bought' },
    ])
    // Paid exactly #2 and #3: #1's 1 ETH came back.
    assert.equal(b0.me - (await balance(fork, me!.address)), 5n * ETH + gas)
    assert.equal((await balance(fork, sellerA!.address)) - b0.a, (prices[1]! * 94n) / 100n)
    assert.equal((await balance(fork, sellerB!.address)) - b0.b, (prices[2]! * 94n) / 100n)
    assert.equal((await balance(fork, OS_FEE)) - b0.os, (5n * ETH) / 100n)
    assert.equal((await balance(fork, creator)) - b0.creator, (5n * ETH * 5n) / 100n)
    for (const id of [2n, 3n])
      assert.equal(await fork.client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [id] }), me!.address)
    assert.equal(await balance(fork, SEAPORT), 0n) // nothing left behind in Seaport

    /* --- sell: an item offer for #10 and a collection offer taken with #11 --- */
    await mint(me!.address, 10n)
    await mint(me!.address, 11n)
    for (const bidder of [bidderX!, bidderY!]) {
      await write(fork, bidder, WETH, wethAbi, 'deposit', [], 5n * ETH)
      await write(fork, bidder, WETH, wethAbi, 'approve', [OPENSEA_CONDUIT, 5n * ETH])
    }
    const offer = (bidder: Address, bid: bigint, wants: Item, salt: bigint): Params => ({
      offerer: bidder,
      zone: ZERO,
      offer: [item(1, WETH, 0n, bid)],
      consideration: [{ ...wants, recipient: bidder }, pay(1, WETH, bid / 100n, OS_FEE), pay(1, WETH, (bid * 5n) / 100n, creator)],
      orderType: 0,
      startTime: t - 3600n,
      endTime: t + 86400n,
      zoneHash: ZERO32,
      salt,
      conduitKey: OS_KEY,
      totalOriginalConsiderationItems: 3n,
    })
    const itemOffer = offer(bidderX!.address, ETH / 2n, item(2, nft, 10n, 1n), 100n)
    const collOffer = offer(bidderY!.address, ETH, item(4, nft, 0n, 1n), 101n)
    const so1 = await signOrder(fork, bidderX!, itemOffer)
    const so2 = await signOrder(fork, bidderY!, collOffer)
    const sell = ok(
      planBatch(
        [
          { key: 'item', response: advancedResponse(itemOffer, so1), contract: nft, tokenId: '10', creatorFees: [creator] },
          {
            key: 'coll',
            response: advancedResponse(collOffer, so2, { resolvers: [{ orderIndex: 0n, side: 1, index: 0n, identifier: 11n, criteriaProof: [] }] }),
            contract: nft,
            tokenId: '11',
            creatorFees: [creator],
          },
        ],
        { side: 'sell', chainId: 1, account: me!.address, now: await now(fork) }
      )
    )
    const fees = (x: bigint) => x / 100n + (x * 5n) / 100n
    const net = ETH / 2n + ETH - fees(ETH / 2n) - fees(ETH)
    assert.equal(sell.totals.total, net)
    assert.equal(sell.call.value, 0n)
    // The approvals are their own explicit steps, never part of the batch.
    assert.deepEqual(sell.approvals, [{ contract: nft, kind: 'erc721', tokenIds: ['10', '11'] }])
    await assert.rejects(simulate(fork, sell, me!.address)) // not approved yet: the batch cannot move the NFTs
    await write(fork, me, nft, nftAbi, 'setApprovalForAll', [OPENSEA_CONDUIT, true])
    await write(fork, me, WETH, wethAbi, 'approve', [OPENSEA_CONDUIT, sell.fromYou])
    const sold = simulationCheck(sell, await simulate(fork, sell, me!.address), me!.address)
    assert.deepEqual(sold, { fills: ['item', 'coll'], skips: [], amount: net })

    const w0 = { me: await wethOf(fork, me!.address), os: await wethOf(fork, OS_FEE), creator: await wethOf(fork, creator) }
    const sr = await send(fork, { account: me!, to: sell.call.to, data: sell.call.data, value: 0n })
    assert.equal(sr.status, 'success')
    console.log(`  sell batch of 2 (item + collection offer): gas ${sr.gasUsed}`)
    assert.deepEqual(receiptOutcome(sell, sr, me!.address).map((x) => x.state), ['sold', 'sold'])
    assert.equal((await wethOf(fork, me!.address)) - w0.me, net)
    assert.equal((await wethOf(fork, OS_FEE)) - w0.os, (ETH / 2n + ETH) / 100n)
    assert.equal((await wethOf(fork, creator)) - w0.creator, ((ETH / 2n + ETH) * 5n) / 100n)
    assert.equal(await fork.client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [10n] }), bidderX!.address)
    assert.equal(await fork.client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [11n] }), bidderY!.address)
  } finally {
    fork.stop()
  }
})

/* ---------- 2. real OpenSea signed-zone orders ---------- */

/** The orders of a real OpenSea batch, each turned back into the single fulfillment_data OpenSea gives for it. */
async function realOrders(hash: Hex) {
  const live = createPublicClient({ transport: http(RPC!) })
  const tx = await live.getTransaction({ hash })
  const d = decodeFunctionData({ abi: seaportAbi, data: tx.input })
  assert.equal(d.functionName, 'fulfillAvailableAdvancedOrders')
  const [orders, resolvers] = d.args as unknown as [any[], any[]]
  return {
    from: tx.from,
    block: tx.blockNumber!,
    orders: orders.map((o, i) => ({
      order: o,
      resolvers: resolvers.filter((r) => r.orderIndex === BigInt(i)).map((r) => ({ ...r, orderIndex: 0n })),
    })),
  }
}

test('real OpenSea listings on its signed zone: 5 bought in one call, one bought singly first', { skip, timeout: 300_000 }, async () => {
  const real = await realOrders('0xe2afffb3e6287f98d3ebfe524786c3f9e81730af61e490235eca7f4c10d7faeb')
  const fork = await startFork(real.block - 1n)
  try {
    const me = real.from
    await fork.testClient.impersonateAccount({ address: me })
    await fork.testClient.setBalance({ address: me, value: 100n * ETH })
    const inputs: BatchInput[] = real.orders.map(({ order }, i) => ({
      key: `l${i}`,
      response: advancedResponse(order.parameters, order.signature, { extraData: order.extraData }),
      contract: order.parameters.offer[0].token,
      tokenId: String(order.parameters.offer[0].identifierOrCriteria),
    }))
    const t = await now(fork)
    const buy = ok(planBatch(inputs, { side: 'buy', chainId: 1, account: me, now: t }))
    assert.equal(buy.lines.length, 5)
    assert.ok(buy.expiresAt! > t, 'the zone permissions are still good on this block')
    // Every order is restricted to OpenSea's signed zone, its permission carried as is.
    for (const l of buy.lines) {
      assert.equal(l.order.parameters.orderType, 2)
      assert.ok(l.order.extraData.length > 2)
    }

    // Order 2 bought on its own first (OpenSea's permission is for this wallet, so this wallet does it).
    const single = real.orders[2]!.order
    await write(fork, me, SEAPORT, seaportAbi, 'fulfillAdvancedOrder', [single, [], ZERO32, ZERO], buy.lines[2]!.plan.total)

    const check = simulationCheck(buy, await simulate(fork, buy, me), me)
    assert.equal(check.problem, undefined)
    assert.deepEqual(check.skips, ['l2'])
    const b0 = await balance(fork, me)
    const receipt = await send(fork, { account: me, to: buy.call.to, data: buy.call.data, value: buy.call.value })
    assert.equal(receipt.status, 'success')
    console.log(`  real signed-zone buy of 5 (1 skipped): gas ${receipt.gasUsed}`)
    const spent = buy.lines.filter((_, i) => i !== 2).reduce((s, l) => s + l.plan.total, 0n)
    assert.equal(b0 - (await balance(fork, me)), spent + receipt.gasUsed * receipt.effectiveGasPrice)
    assert.deepEqual(receiptOutcome(buy, receipt, me).map((x) => x.state), ['bought', 'bought', 'skipped', 'bought', 'bought'])
    for (const l of buy.lines)
      assert.equal((await fork.client.readContract({ address: l.contract as Address, abi: erc721Abi, functionName: 'ownerOf', args: [BigInt(l.tokenId)] })).toLowerCase(), me.toLowerCase())
  } finally {
    fork.stop()
  }
})

test('real OpenSea collection offers on its signed zone: 2 accepted in one call (one a part fill of a 2-NFT offer)', { skip, timeout: 300_000 }, async () => {
  const real = await realOrders('0x225594865913a9079b8d8654ddc5e0cf6f1006a19cff7a9df185912b295389bb')
  const fork = await startFork(real.block - 1n)
  try {
    const me = real.from
    await fork.testClient.impersonateAccount({ address: me })
    await fork.testClient.setBalance({ address: me, value: 10n * ETH })
    const inputs: BatchInput[] = real.orders.map(({ order, resolvers }, i) => ({
      key: `o${i}`,
      response: advancedResponse(order.parameters, order.signature, {
        extraData: order.extraData,
        numerator: order.numerator,
        denominator: order.denominator,
        resolvers,
      }),
      contract: order.parameters.consideration[0].token,
      tokenId: String(resolvers[0].identifier),
    }))
    const sell = ok(planBatch(inputs, { side: 'sell', chainId: 1, account: me, now: await now(fork) }))
    assert.equal(sell.lines.length, 2)
    assert.equal(sell.conduitKey, OS_KEY)
    const check = simulationCheck(sell, await simulate(fork, sell, me), me)
    assert.equal(check.problem, undefined)
    assert.deepEqual(check.fills, ['o0', 'o1'])
    const w0 = { me: await wethOf(fork, me), os: await wethOf(fork, OS_FEE) }
    const receipt = await send(fork, { account: me, to: sell.call.to, data: sell.call.data, value: 0n })
    assert.equal(receipt.status, 'success')
    console.log(`  real signed-zone sell of 2: gas ${receipt.gasUsed}`)
    assert.deepEqual(receiptOutcome(sell, receipt, me).map((x) => x.state), ['sold', 'sold'])
    assert.equal((await wethOf(fork, me)) - w0.me, sell.totals.total)
    assert.equal((await wethOf(fork, OS_FEE)) - w0.os, sell.fromYou)
    for (const l of sell.lines)
      assert.equal((await fork.client.readContract({ address: l.contract as Address, abi: erc721Abi, functionName: 'ownerOf', args: [BigInt(l.tokenId)] })).toLowerCase(), l.offerer)
  } finally {
    fork.stop()
  }
})

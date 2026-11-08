// Approvals and failure words for OpenSea fills: src/pages/Swap/nft/fillLogic.ts. Run: yarn test
//
// The approval rule itself was proven against real Seaport fills, not here: on an Ethereum fork, approve(conduit, tokenId)
// let fulfillOrder and fulfillAdvancedOrder (including a collection offer) move the NFT for seven real collections.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  failureFacts,
  feeFromEstimates,
  fillFailureKind,
  fillFailureWords,
  isShort,
  nftApprovalCall,
  nftApprovalState,
} from '../src/pages/Swap/nft/fillLogic.ts'

const CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71'
const OTHER = '0x2222222222222222222222222222222222222222'
const base = {
  kind: 'erc721' as const,
  operator: CONDUIT,
  approvedForAll: false,
  approvedAddress: '0x0000000000000000000000000000000000000000',
  approvedKnown: true,
}

test('ERC-721 approves the one token, never the whole collection', () => {
  assert.equal(nftApprovalState(base), 'needs-one')
  assert.deepEqual(nftApprovalCall('needs-one', CONDUIT, '42'), { functionName: 'approve', args: [CONDUIT, 42n] })
})

test('getApproved: already this operator is ready; another one still needs asking', () => {
  assert.equal(nftApprovalState({ ...base, approvedAddress: CONDUIT.toLowerCase() }), 'ready')
  assert.equal(nftApprovalState({ ...base, approvedAddress: OTHER }), 'needs-one')
  assert.equal(nftApprovalCall('ready', CONDUIT, '42'), undefined)
})

test('a failed blanket-approval read asks again instead of checking for good', () => {
  assert.equal(nftApprovalState({ ...base, approvedForAll: undefined }), 'checking')
  assert.equal(nftApprovalState({ ...base, approvedForAll: undefined, readFailed: true }), 'failed')
  assert.equal(nftApprovalState({ ...base, approvedForAll: undefined, operator: undefined, readFailed: true }), 'failed')
  assert.equal(nftApprovalCall('failed', CONDUIT, '42'), undefined)
})

test('a blanket approval already given is enough, and is never added', () => {
  assert.equal(nftApprovalState({ ...base, approvedForAll: true }), 'ready')
})

test('a contract that will not answer getApproved falls back to asking, not to selling blind', () => {
  assert.equal(nftApprovalState({ ...base, approvedAddress: undefined, approvedKnown: true }), 'needs-one')
})

test('nothing is decided until the reads are in', () => {
  assert.equal(nftApprovalState({ ...base, operator: undefined }), 'checking')
  assert.equal(nftApprovalState({ ...base, approvedForAll: undefined }), 'checking')
  assert.equal(nftApprovalState({ ...base, approvedAddress: undefined, approvedKnown: false }), 'checking')
})

test('ERC-1155 has no approval for one token: it is the blanket one, named as such', () => {
  const kind = 'erc1155' as const
  assert.equal(nftApprovalState({ ...base, kind, approvedAddress: undefined, approvedKnown: false }), 'needs-all')
  assert.deepEqual(nftApprovalCall('needs-all', CONDUIT, '42'), {
    functionName: 'setApprovalForAll',
    args: [CONDUIT, true],
  })
})

/** The shape viem gives a decoded revert. */
const reverted = (errorName?: string) =>
  Object.assign(new Error('The contract function "fulfillOrder" reverted.'), {
    shortMessage: 'The contract function "fulfillOrder" reverted.',
    cause: { name: 'ContractFunctionRevertedError', data: errorName ? { errorName } : undefined, message: 'x' },
  })

test('facts are read through the wrapping', () => {
  const facts = failureFacts(reverted('OrderAlreadyFilled'))
  assert.equal(facts.errorName, 'OrderAlreadyFilled')
  assert.equal(facts.reverted, true)
})

test('sold, cancelled and expired orders are gone', () => {
  for (const name of ['OrderAlreadyFilled', 'OrderIsCancelled', 'InvalidTime', 'NoSpecifiedOrdersAvailable'])
    assert.equal(fillFailureKind(reverted(name)), 'gone', name)
  // What OpenSea or our proxy says when the order has left.
  assert.equal(
    fillFailureKind(Object.assign(new Error('OpenSea has no such item.'), { code: 'NOT_FOUND', status: 404 })),
    'gone',
  )
  assert.equal(fillFailureKind(new Error('Order not found')), 'gone')
  assert.equal(fillFailureKind(new Error('The listing has expired')), 'gone')
})

test('a node that cannot answer is not a sold listing', () => {
  for (const words of [
    'header not found',
    'block not found',
    'the method eth_simulateV1 does not exist/is not available',
    'Method not found',
    'missing trie node 0xabc (path ) state 0xdef is not available',
    'RPC Request failed. Details: transaction not found',
  ]) {
    const kind = fillFailureKind(new Error(words))
    assert.notEqual(kind, 'gone', words)
  }
  assert.equal(fillFailureKind(Object.assign(new Error('x'), { shortMessage: 'HTTP request failed.', details: 'header not found' })), 'generic')
})

test('only plain words about the order mean it has gone', () => {
  for (const words of [
    'Order not found',
    'This listing is no longer available',
    'The order has already been filled',
    'Listing was cancelled',
    'The offer has expired',
  ])
    assert.equal(fillFailureKind(new Error(words)), 'gone', words)
  for (const words of ['not found', 'Request cancelled', 'Resource not found', 'does not exist'])
    assert.notEqual(fillFailureKind(new Error(words)), 'gone', words)
})

test('a failed NFT transfer means the listing is gone when buying, but not when selling your own', () => {
  assert.equal(fillFailureKind(reverted('TokenTransferGenericFailure'), 'buy'), 'gone')
  assert.equal(fillFailureKind(reverted('TokenTransferGenericFailure'), 'sell'), 'generic')
})

test('the other endings each have their own words', () => {
  const coded = (code: string, status = 400) => Object.assign(new Error('raw upstream words'), { code, status })
  assert.equal(fillFailureKind(coded('MARKET_NOT_CONFIGURED', 503)), 'offline')
  assert.equal(fillFailureKind(coded('NETWORK', 0)), 'offline')
  assert.equal(fillFailureKind(coded('RATE_LIMITED', 429)), 'busy')
  assert.equal(fillFailureKind(new Error('Wallet can not perform trading on OpenSea')), 'restricted')
  assert.equal(fillFailureKind(new Error('User rejected the request.')), 'cancelled')
  assert.equal(fillFailureKind(new Error('insufficient funds for gas')), 'funds')
  assert.equal(fillFailureKind(Object.assign(new Error('x'), { reverted: true })), 'failed-onchain')
  assert.equal(fillFailureKind(Object.assign(new Error('x'), { unconfirmed: true })), 'unconfirmed')
})

test('anything unknown stays off the screen', () => {
  const kind = fillFailureKind(new Error('Execution reverted at 0xdeadbeef with raw calldata'))
  assert.equal(kind, 'generic')
  // It may have reached the network, so it can't promise nothing moved.
  assert.equal(fillFailureWords(kind, 'buy').words, "That did not go through. Check your wallet's activity, then try again.")
  assert.equal(fillFailureWords(kind, 'sell').words, "That did not go through. Check your wallet's activity, then try again.")
})

test('the words the review promised', () => {
  assert.equal(fillFailureWords('gone', 'buy').words, 'Someone just bought this one. You paid nothing. Pick another.')
  const onlyThere = fillFailureWords('opensea-only', 'buy')
  assert.equal(onlyThere.words, 'This one can only be bought on OpenSea.')
  assert.equal(onlyThere.link, true, 'a real link goes with it')
  const offline = fillFailureWords('offline', 'buy')
  assert.match(offline.words, /^Buying here is offline right now\. Try again later, or buy it on OpenSea\.$/)
  assert.equal(offline.link, true)
  assert.equal(fillFailureWords('gone', 'buy').link, undefined, 'no OpenSea link where none is needed')
  for (const kind of [
    'gone',
    'opensea-only',
    'offline',
    'restricted',
    'busy',
    'funds',
    'unconfirmed',
    'generic',
  ] as const)
    for (const side of ['buy', 'sell'] as const)
      assert.doesNotMatch(fillFailureWords(kind, side).words, /API|key|Seaport|0x/)
})

test('the network fee is the estimates added up, with failed ones filled by the average', () => {
  assert.equal(feeFromEstimates([100n, 200n], 3n), 900n)
  assert.equal(feeFromEstimates([100n, undefined, 300n], 2n), (400n + 200n) * 2n)
  assert.equal(feeFromEstimates([undefined], 2n), undefined)
  assert.equal(feeFromEstimates([100n], undefined), undefined)
  assert.equal(feeFromEstimates([], 2n), undefined)
})

test('the fee counts when it is paid in the same money', () => {
  assert.equal(isShort(100n, 90n, 20n, true), true, 'price fits, price and fee do not')
  assert.equal(isShort(100n, 90n, 20n, false), false, 'fee is in another token')
  assert.equal(isShort(100n, 90n, undefined, true), false, 'an unknown fee is not guessed')
  assert.equal(isShort(undefined, 90n, 20n, true), false, 'an unknown balance blocks nothing')
})

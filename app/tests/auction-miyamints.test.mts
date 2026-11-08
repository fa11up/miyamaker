// src/pages/Auction/miyamints/rules.ts: the rules of a miyamints auction lot, from ERC721AuctionInstance.sol, and the
// words for them. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { parseEther } from 'viem'

import {
  antiSnipeWords,
  bpsWords,
  canCloseUnsold,
  endAfterBid,
  lotIds,
  minimumNextBid,
  mmFacts,
  mmPhase,
  phaseTag,
  REFUND_WORDS,
  settleWords,
  sortLots,
  spanWords,
  UNSOLD_CLOSE_GRACE_S,
  unsoldWords,
} from '../src/pages/Auction/miyamints/rules.ts'

const ZERO = `0x${'0'.repeat(40)}`
const BOB = `0x${'b'.repeat(40)}`
const NOW_S = 1_700_000_000
const NOW = NOW_S * 1000
const lot = {
  tokenId: 1,
  tokenURI: 'ipfs://x',
  minBid: parseEther('0.1'),
  highBidder: ZERO,
  highBid: 0n,
  startTime: NOW_S - 100,
  endTime: NOW_S + 3600,
  settled: false,
}
const sol = readFileSync(new URL('../../contracts/src/factories/erc721/ERC721AuctionInstance.sol', import.meta.url), 'utf8')

test('phase from the times: queued has no start, bids close at the end second exactly', () => {
  assert.equal(mmPhase({ ...lot, startTime: 0, endTime: 0 }, NOW), 'queued')
  assert.equal(mmPhase(lot, NOW), 'live')
  assert.equal(mmPhase({ ...lot, endTime: NOW_S }, NOW), 'ended', 'createBid reverts at block.timestamp >= endTime')
  assert.equal(mmPhase({ ...lot, endTime: NOW_S - 1 }, NOW), 'ended')
  assert.equal(mmPhase({ ...lot, settled: true, highBidder: BOB }, NOW), 'sold')
  assert.equal(mmPhase({ ...lot, settled: true }, NOW), 'unsold')
  // The contract keeps the same rule.
  assert.match(sol, /if \(block\.timestamp >= auction\.endTime\) revert AuctionExpired\(\);/)
})

test('the first bid must reach the deposit; later ones the high bid plus the increment', () => {
  const inc = parseEther('0.01')
  assert.equal(minimumNextBid(lot, inc), parseEther('0.1'))
  assert.equal(minimumNextBid({ ...lot, highBidder: BOB, highBid: parseEther('0.2') }, inc), parseEther('0.21'))
  assert.match(sol, /if \(msg\.value < auction\.minBid\) revert BidBelowMinimum\(\);/)
  assert.match(sol, /if \(msg\.value < auction\.highBid \+ bidIncrement\) revert BidTooLow\(\);/)
})

test('anti-snipe: a late bid moves the end to timeBuffer after the bid, an early one leaves it', () => {
  assert.equal(endAfterBid(NOW_S + 3600, 900, NOW_S), NOW_S + 3600)
  assert.equal(endAfterBid(NOW_S + 60, 900, NOW_S), NOW_S + 900)
  assert.equal(endAfterBid(NOW_S + 900, 900, NOW_S), NOW_S + 900, 'exactly timeBuffer left is not extended')
  assert.match(sol, /if \(auction\.endTime - block\.timestamp < timeBuffer\) \{\s*auction\.endTime = uint40\(block\.timestamp\) \+ timeBuffer;/)
  assert.equal(antiSnipeWords(900), 'A bid with less than 15 minutes left moves the end to 15 minutes after that bid.')
  assert.equal(antiSnipeWords(3600), 'A bid with less than 1 hour left moves the end to 1 hour after that bid.')
})

test('spans read as people say them', () => {
  assert.equal(spanWords(60), '1 minute')
  assert.equal(spanWords(300), '5 minutes')
  assert.equal(spanWords(90), '90 seconds')
  assert.equal(spanWords(86_400), '1 day')
  assert.equal(spanWords(7200), '2 hours')
})

test('the refund is in the same transaction, as the contract does it (no withdraw to call)', () => {
  assert.match(sol, /SafeTransferLib\.forceSafeTransferETH\(previousBidder, previousBid\);/)
  assert.doesNotMatch(sol, /function withdraw\w*\(/)
  assert.match(REFUND_WORDS, /same transaction/)
})

test('settle words: the deposit comes back and the split is the launch shares', () => {
  const sold = { ...lot, highBidder: BOB, highBid: parseEther('1') }
  const words = settleWords(sold, 100, 1000)
  assert.match(words, /0\.1 ETH deposit back/)
  assert.match(words, /1% is the miya fee, 10% goes to the collection's alignment vault, and the rest goes to the artist/)
  assert.match(words, /Anyone can settle/)
  assert.match(sol, /SafeTransferLib\.forceSafeTransferETH\(owner\(\), auction\.minBid\);/)
  assert.doesNotMatch(settleWords(sold), /miya fee/, 'no shares read, no numbers made up')
  assert.equal(bpsWords(1250), '12.5%')
})

test('unsold: the deposit goes to the treasury; the owner may close at once, anyone after the grace', () => {
  assert.equal(canCloseUnsold(lot, { isOwner: true, nowMs: NOW }), true)
  assert.equal(canCloseUnsold(lot, { isOwner: false, nowMs: (lot.endTime + UNSOLD_CLOSE_GRACE_S - 1) * 1000 }), false)
  assert.equal(canCloseUnsold(lot, { isOwner: false, nowMs: (lot.endTime + UNSOLD_CLOSE_GRACE_S) * 1000 }), true)
  assert.match(sol, /UNSOLD_CLOSE_GRACE = 7 days/)
  assert.match(unsoldWords(lot, true), /your 0\.1 ETH deposit to the miya treasury/)
  assert.match(unsoldWords(lot, false), /artist's 0\.1 ETH deposit goes to the miya treasury/)
})

test('facts and tags in the words for the phase', () => {
  assert.deepEqual(mmFacts(lot, 'live'), {
    bidLabel: 'Starting price',
    bidValue: '0.1 ETH',
    bidderLabel: 'Highest bidder',
    bidderValue: 'No bids yet',
  })
  const sold = { ...lot, highBidder: BOB, highBid: parseEther('0.3') }
  assert.equal(mmFacts(sold, 'sold').bidLabel, 'Winning bid')
  assert.equal(mmFacts(sold, 'live').bidValue, '0.3 ETH')
  const left = () => '1h left'
  assert.equal(phaseTag(lot, 'live', NOW, left), 'Live · 1h left')
  assert.equal(phaseTag(lot, 'queued', NOW, left), 'Up next')
  assert.equal(phaseTag(sold, 'ended', NOW, left), 'Ended · to settle')
  assert.equal(phaseTag(lot, 'ended', NOW, left), 'Ended · no bids')
})

test('lots sort live first, ending soonest; ids are newest first and capped', () => {
  const a = { key: 'a', phase: 'sold' as const, lot }
  const b = { key: 'b', phase: 'live' as const, lot: { ...lot, endTime: NOW_S + 50 } }
  const c = { key: 'c', phase: 'live' as const, lot: { ...lot, endTime: NOW_S + 10 } }
  const d = { key: 'd', phase: 'queued' as const, lot }
  assert.deepEqual(
    sortLots([a, b, c, d]).map((x) => x.key),
    ['c', 'b', 'd', 'a']
  )
  assert.deepEqual(lotIds(1, 10), [], 'nothing queued yet')
  assert.deepEqual(lotIds(4, 10), [3, 2, 1])
  assert.deepEqual(lotIds(100, 2), [99, 98])
})

test('a bid message is one plain line, capped, and never a non-string', async () => {
  const { cleanBidMessage, MAX_BID_MESSAGE } = await import('../src/pages/Auction/miyamints/rules.ts')
  assert.equal(cleanBidMessage('  gm\n\tgm  '), 'gm gm')
  assert.equal(cleanBidMessage('a‮b​c'), 'a b c')
  assert.equal(cleanBidMessage({ text: 'x' }), '')
  assert.equal(cleanBidMessage('x'.repeat(500)).length, MAX_BID_MESSAGE)
  assert.equal([...cleanBidMessage('😀'.repeat(200))].length, MAX_BID_MESSAGE)
})

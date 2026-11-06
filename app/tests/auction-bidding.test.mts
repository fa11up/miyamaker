// src/pages/Auction/bidding.ts: the bid rules from MiyaAuction's verified source, and the words for each outcome.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEther } from 'viem'

import {
  balanceWords,
  bidErrorWords,
  bidStanding,
  checkBid,
  collectionStatus,
  lotFacts,
  lotPhase,
  minimumBid,
  parseBidAmount,
  timeLeftWords,
} from '../src/pages/Auction/bidding.ts'
import { getTokenAttribute } from '../src/utils/getTokenAttribute.ts'

const NOW = 1_000_000_000
const ZERO = `0x${'0'.repeat(40)}`
const ME = `0x${'a'.repeat(40)}`
const ready = { status: 'ready' as const, startTime: 100, endTime: 2_000_000, settled: false }

test('a pending or failed read never says a lot has ended', () => {
  assert.equal(lotPhase({ ...ready, status: 'loading', endTime: 0 }, NOW), 'loading')
  assert.equal(lotPhase({ ...ready, status: 'failed', endTime: 0 }, NOW), 'failed')
})

test('only a real end time in the past means ended', () => {
  assert.equal(lotPhase(ready, NOW), 'live')
  assert.equal(lotPhase({ ...ready, endTime: 500_000 }, NOW), 'ended')
  assert.equal(lotPhase({ ...ready, endTime: NOW / 1000 }, NOW), 'ended', 'closes as the countdown completes')
  assert.equal(lotPhase({ ...ready, settled: true }, NOW), 'ended')
  assert.equal(lotPhase({ ...ready, endTime: 0 }, NOW), 'missing', 'an answer with no auction in it')
  assert.equal(lotPhase({ ...ready, startTime: 1_500_000 }, NOW), 'upcoming')
})

test('the minimum follows placeBid: reach both minPrice and amount + bidIncrement', () => {
  const bidIncrement = parseEther('0.01')
  assert.equal(minimumBid({ currentBid: 0n, minPrice: parseEther('0.1'), bidIncrement }), parseEther('0.1'))
  assert.equal(
    minimumBid({ currentBid: parseEther('0.15'), minPrice: parseEther('0.1'), bidIncrement }),
    parseEther('0.16'),
  )
  assert.equal(
    minimumBid({ currentBid: 0n, minPrice: 0n, bidIncrement }),
    bidIncrement,
    'a first bid still needs the increment',
  )
})

test('checkBid names the amount, and blocks what the contract or the wallet would refuse', () => {
  const minimum = parseEther('0.16')
  assert.deepEqual(checkBid('', minimum, undefined), { valid: false, label: 'Enter at least 0.16 ETH' })
  assert.equal(checkBid('0.15', minimum, undefined).valid, false)
  assert.deepEqual(checkBid('0.16', minimum, undefined), { valid: true, value: minimum, label: 'Bid 0.16 ETH' })
  assert.equal(checkBid('1', minimum, parseEther('0.803')).label, 'Not enough ETH')
  assert.equal(checkBid('1', minimum, parseEther('0.803')).valid, false)
  assert.equal(checkBid('0.2', minimum, parseEther('0.803')).label, 'Bid 0.2 ETH')
})

test('parseBidAmount takes only a plain positive decimal', () => {
  assert.equal(parseBidAmount('.5'), parseEther('0.5'))
  assert.equal(parseBidAmount('1.'), parseEther('1'))
  for (const bad of ['', '0', '.', 'abc', '1e3', '-1', '0x10']) assert.equal(parseBidAmount(bad), undefined, bad)
})

test('balance words round down, never saying more than the wallet holds', () => {
  assert.equal(balanceWords(parseEther('0.8039')), '0.803 ETH')
  assert.equal(balanceWords(parseEther('12')), '12.000 ETH')
  assert.equal(balanceWords(0n), '0.000 ETH')
})

test('the lot labels change with its phase', () => {
  const bid = { bidder: ME, currentBid: parseEther('0.2'), minPrice: parseEther('0.1') }
  assert.deepEqual(lotFacts({ ...bid, phase: 'live' }), {
    bidLabel: 'Current bid',
    bidValue: '0.2 ETH',
    bidderLabel: 'Highest bidder',
    bidderValue: '',
  })
  assert.deepEqual(lotFacts({ ...bid, phase: 'ended' }), {
    bidLabel: 'Winning bid',
    bidValue: '0.2 ETH',
    bidderLabel: 'Winner',
    bidderValue: '',
  })
  const none = { bidder: ZERO, currentBid: 0n, minPrice: parseEther('0.1') }
  assert.deepEqual(lotFacts({ ...none, phase: 'live' }), {
    bidLabel: 'Starting price',
    bidValue: '0.1 ETH',
    bidderLabel: 'Highest bidder',
    bidderValue: 'No bids yet',
  })
  assert.equal(lotFacts({ ...none, phase: 'ended' }).bidderValue, 'No bids')
})

test('standing: leading, then outbid only for a wallet seen in the lead', () => {
  assert.equal(bidStanding(ME.toUpperCase().replace('0X', '0x'), ME, false), 'leading')
  assert.equal(bidStanding(ZERO, ME, false), 'none')
  assert.equal(bidStanding(ZERO, ME, true), 'outbid')
  assert.equal(bidStanding(ME, undefined, true), 'none')
})

test('time left reads as words', () => {
  assert.equal(timeLeftWords((5 * 3600 + 12 * 60 + 33) * 1000), '5h 12m 33s left')
  assert.equal(timeLeftWords((2 * 86_400 + 3600) * 1000), '2d 1h 0m left')
  assert.equal(timeLeftWords(61_000), '1m 1s left')
  assert.equal(timeLeftWords(-5), '0s left')
})

test('a collection says how many lots and whether any is live', () => {
  const ended = { startTime: 1, endTime: Date.UTC(2024, 1, 10) / 1000, settled: true }
  const live = { startTime: 1, endTime: 2_000_000, settled: false }
  assert.equal(collectionStatus([ended, ended], NOW * 2000, 'en-US'), '2 lots · Ended Feb 2024')
  assert.equal(collectionStatus([ended, live], NOW, 'en-US'), '2 lots · Live now')
  assert.equal(collectionStatus([ended], NOW * 2000, 'en-US'), '1 lot · Ended Feb 2024')
})

test('bid errors become plain words, wherever in the cause chain the reason sits', () => {
  const wrapped = (cause: unknown) => ({
    name: 'ContractFunctionExecutionError',
    shortMessage: 'The contract function "placeBid" reverted.',
    cause,
  })
  assert.equal(bidErrorWords({ code: 4001 }), 'You cancelled in your wallet. No bid was placed.')
  assert.equal(
    bidErrorWords(wrapped({ shortMessage: 'User rejected the request.' })),
    'You cancelled in your wallet. No bid was placed.',
  )
  assert.equal(
    bidErrorWords(wrapped({ data: { errorName: 'InsufficientBid' } })),
    'Someone bid more. Your bid must beat the new price.',
  )
  assert.equal(bidErrorWords(wrapped({ data: { errorName: 'EndedAuction' } })), 'This auction has just ended.')
  assert.equal(
    bidErrorWords(wrapped({ details: 'insufficient funds for gas * price + value' })),
    "This wallet doesn't have enough ETH for this bid and gas.",
  )
  assert.equal(
    bidErrorWords({ name: 'ConnectorChainMismatchError' }),
    'Your wallet is on another network. Switch to Ethereum and try again.',
  )
})

test('an unknown error, or one with no message at all, still says something plain', () => {
  const plain = "The bid didn't go through. No ETH left your wallet. Try again."
  assert.equal(bidErrorWords(new Error('0xdeadbeef ContractFunctionExecutionError')), plain)
  assert.equal(bidErrorWords({}), plain)
  assert.equal(bidErrorWords(undefined), plain)
})

test('a missing trait is empty, never the word undefined', () => {
  assert.equal(getTokenAttribute([], 'Artist'), '')
  assert.equal(getTokenAttribute([{ trait_type: 'Artist', value: 'Remi' }], 'Artist'), 'Remi')
})

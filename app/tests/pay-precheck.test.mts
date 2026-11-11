// src/miyamints/precheck.ts and the approval's own words (src/pages/Auction/bidding.ts): what is read again before an
// approval, and what a stopped or failed approval says. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { zeroAddress } from 'viem'

import './ts-paths.mts'
import {
  APPROVAL_CANCELLED,
  APPROVAL_FAILED,
  APPROVAL_UNCONFIRMED,
  approvalEnding,
  bidEnding,
} from '../src/pages/Auction/bidding.ts'

// precheck.ts and launch.ts import ./tokens without an extension (as Vite does): loaded after ts-paths.mts.
const { auctionCurrency, EMPTY_FORM, validateStep } = await import('../src/miyamints/launch.ts')
const { bidGate, COULDNT_CHECK_WORDS, editionGate, freshCost, phaseGate, priceRoseWords, tokenGate } = await import(
  '../src/miyamints/precheck.ts'
)

const ETH = zeroAddress
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

test('a rising price is read fresh: higher stops before the wallet, lower or equal goes on at the fresh cost', () => {
  assert.deepEqual(freshCost(100n, 100n), { amount: 100n, rose: false, changed: false })
  assert.deepEqual(freshCost(100n, 110n), { amount: 110n, rose: true, changed: true })
  assert.deepEqual(freshCost(100n, 90n), { amount: 90n, rose: false, changed: true })
  assert.match(priceRoseWords('0.011 ETH'), /went up to 0\.011 ETH\. Nothing was sent/)
})

test('the token must still be on the collection and on the registry; a failed read never passes', () => {
  assert.equal(tokenGate(USDC, 'USDC', [ETH, USDC.toLowerCase()], true), undefined)
  assert.equal(tokenGate(ETH, 'ETH', [ETH], undefined), undefined, 'ETH needs no registry read')
  assert.match(tokenGate(USDC, 'USDC', [ETH], true)!, /no longer takes USDC/)
  assert.match(tokenGate(USDC, 'USDC', [USDC], false)!, /miya no longer accepts USDC/)
  assert.equal(tokenGate(USDC, 'USDC', undefined, true), COULDNT_CHECK_WORDS)
  assert.equal(tokenGate(USDC, 'USDC', [USDC], undefined), COULDNT_CHECK_WORDS)
})

test('an edition read again: not open, sold out, or too few left', () => {
  const now = 1_000
  assert.equal(editionGate({ supply: 0n, minted: 50n, openTime: 0n }, 1n, now), undefined, 'supply 0 = no limit')
  assert.match(editionGate({ supply: 10n, minted: 10n, openTime: 0n }, 1n, now)!, /just sold out/)
  assert.match(editionGate({ supply: 10n, minted: 9n, openTime: 0n }, 2n, now)!, /not that many/)
  assert.match(editionGate({ supply: 0n, minted: 0n, openTime: 2_000n }, 1n, now)!, /not open yet/)
})

test("a drop's phase read again: running, public, room left, priced in the token; its price comes back", () => {
  const phase = { start: 100n, end: 0n, merkleRoot: `0x${'0'.repeat(64)}`, supplyCap: 10, prices: [{ token: ETH, price: 5n }] }
  assert.deepEqual(phaseGate(phase, ETH, 2, 200, 3n, 50n), { ok: true, price: 5n })
  assert.equal(phaseGate(undefined, ETH, 1, 200, 0n, 50n).ok, false)
  assert.match((phaseGate(phase, ETH, 1, 50, 0n, 50n) as { error: string }).error, /not started/)
  assert.match((phaseGate({ ...phase, end: 150n }, ETH, 1, 200, 0n, 50n) as { error: string }).error, /has ended/)
  assert.match((phaseGate({ ...phase, merkleRoot: `0x${'1'.repeat(64)}` }, ETH, 1, 200, 0n, 50n) as { error: string }).error, /allowlist/)
  assert.match((phaseGate(phase, ETH, 1, 200, 0n, 0n) as { error: string }).error, /Sold out/)
  assert.match((phaseGate(phase, ETH, 2, 200, 9n, 50n) as { error: string }).error, /that many pieces left/)
  assert.match((phaseGate(phase, USDC, 1, 200, 0n, 50n) as { error: string }).error, /no longer takes that token/)
})

test('a bid read again: ended, settled or outbid stops before the approval', () => {
  const lot = { startTime: 100, endTime: 1_000, settled: false }
  const money = (v: bigint) => `${v} USDC`
  assert.equal(bidGate(lot, 10n, 10n, 500, money), undefined)
  assert.match(bidGate(lot, 12n, 10n, 500, money)!, /next bid is now 12 USDC or more\. No bid was sent/)
  assert.match(bidGate(lot, 10n, 10n, 1_000, money)!, /just ended/)
  assert.match(bidGate({ ...lot, settled: true }, 10n, 10n, 500, money)!, /no longer up for auction/)
  assert.match(bidGate({ ...lot, startTime: 0, endTime: 0 }, 10n, 10n, 500, money)!, /hasn't opened/)
})

test("an approval's ending says the bid was never sent, in the approval's own words", () => {
  assert.equal(approvalEnding({ phase: 'pending' }), undefined)
  assert.equal(approvalEnding({ phase: 'done' }), undefined, 'a landed approval is only step one')
  assert.deepEqual(approvalEnding({ phase: 'error', stage: 'wait', error: { unconfirmed: true } }), {
    kind: 'unconfirmed',
    words: APPROVAL_UNCONFIRMED,
  })
  assert.equal(approvalEnding({ phase: 'error', error: { cancelled: true } })?.words, APPROVAL_CANCELLED)
  assert.match(approvalEnding({ phase: 'error', error: { reverted: true } })!.words, /^The approval didn't go through\. No bid was sent/)
  assert.match(approvalEnding({ phase: 'error', stage: 'check', error: new Error('rpc') }, 'USDC')!.words, /No USDC left your wallet/)
  assert.match(approvalEnding({ phase: 'error', stage: 'wallet', error: { code: 4001 } })!.words, /cancelled the approval/)
  for (const e of [{ unconfirmed: true }, { cancelled: true }, { reverted: true }, new Error('x')]) {
    const words = approvalEnding({ phase: 'error', stage: 'wallet', error: e })!.words
    assert.match(words, /approval/i)
    assert.doesNotMatch(words, /your bid/i)
  }
  assert.ok(APPROVAL_FAILED.includes('No bid was sent'))
})

test("a check the screen made itself keeps its own words in the bid's ending", () => {
  const message = 'This auction has just ended. No bid was sent.'
  assert.deepEqual(bidEnding({ phase: 'error', stage: 'check', message, error: { precheck: true, message } }), {
    kind: 'refused',
    words: message,
  })
})

test("launch validation refuses tokens and a bid currency the registry's allowlist dropped", () => {
  const ctx = {
    now: 0n,
    chainId: 1,
    allowed: [USDC.toLowerCase()],
    image: { hasFile: true },
    audio: { hasFile: true },
  }
  const editions = { ...EMPTY_FORM, type: 'editions' as const, tokens: [ETH, WBTC.toLowerCase()] }
  assert.match(validateStep('sale', editions, ctx).tokens!, /no longer accepts WBTC/)
  assert.equal(validateStep('sale', editions, { ...ctx, allowed: undefined }).tokens, undefined, 'unread: the table stands')
  const auction = { ...EMPTY_FORM, type: 'auction' as const, currency: WBTC.toLowerCase(), reserve: '1', bidStep: '1' }
  assert.match(validateStep('sale', auction, ctx).currency!, /no longer accepts WBTC/)
  assert.equal(auctionCurrency(auction, 1, ctx.allowed), undefined)
  assert.equal(auctionCurrency({ currency: USDC.toLowerCase() }, 1, ctx.allowed)?.symbol, 'USDC')
})

test('the screens wire it: every token payment re-reads first, and Reinvest stays off without a quote', async () => {
  const { code } = await import('./source-scan.mts')
  const src = (p: string) => code(new URL(`../src/${p}`, import.meta.url).pathname)
  const music = src('pages/Mint/Music/index.tsx')
  assert.match(music, /functionName: 'calculateMintCost', args: \[item\.tokenId, 1n, token\]/)
  assert.match(music, /prepare: async/)
  assert.match(music, /revertName\(tx\.error\) === 'ExceedsMaxCost'\) onStale\(\)/)
  assert.match(src('pages/Auction/miyamints/MmLotDetail.tsx'), /prepare: async[\s\S]*bidGate\(/)
  const manage = src('pages/Manage/MiyamintsManage.tsx')
  assert.match(manage, /'queuePiece'[\s\S]*prepare: async[\s\S]*readTokenGate\(/)
  assert.match(manage, /NEEDS_QUOTE: readonly ClaimModeName\[\] = \['REINVEST', 'ETH'\]/)
  assert.match(manage, /disabled=\{NEEDS_QUOTE\.includes\(m\.mode\)\}/)
  const live = src('pages/Mint/LiveMint/index.tsx')
  // A new press clears the last approval's error before anything else. The order (read again -> approve -> send) and
  // its stops are runPay's, tested on its own in pay-run.test.mts; here only that both payment paths run it.
  assert.match(live, /\) => \{\s+approval\.reset\(\)\s+setCheckError\(undefined\)/)
  assert.match(live, /await runPay\(/)
  assert.match(live, /prepare: async \(\) => \{\s+const fresh = await recheck\(/)
  assert.match(src('miyamints/usePay.ts'), /return runPay\(/)
})

// src/miyamints/tokens.ts: multi-token prices, maxCost, the token picker and vault claim modes. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEther, zeroAddress } from 'viem'

import {
  approveWords,
  buildPrices,
  chainSymbol,
  claimArgs,
  CLAIM_MODE,
  dropDelisted,
  feesWords,
  hasFees,
  hasFeesFor,
  knownToken,
  MAX_SYMBOL,
  parseAccepted,
  parseTokenAmount,
  payPlan,
  payTokens,
  pickToken,
  pricesWords,
  tokenLabel,
} from '../src/miyamints/tokens.ts'

const ETH = zeroAddress
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as const
const usdc = { symbol: 'USDC', decimals: 6 }
const wbtc = { symbol: 'WBTC', decimals: 8 }

test('the allowlist: seven tokens on mainnet, ETH only elsewhere, the registry can drop one', () => {
  assert.deepEqual(
    payTokens(1).map((t) => [t.symbol, t.decimals]),
    [['ETH', 18], ['IMD', 18], ['INFER', 18], ['USDC', 6], ['imdUSD', 18], ['cbBTC', 8], ['WBTC', 8]]
  )
  assert.deepEqual(payTokens(11155111).map((t) => t.symbol), ['ETH'])
  assert.deepEqual(payTokens(1, [USDC.toLowerCase()]).map((t) => t.symbol), ['ETH', 'USDC'], 'ETH is always allowed')
  assert.equal(knownToken(1, USDC.toLowerCase())?.decimals, 6)
  assert.equal(knownToken(8453, USDC), undefined)
})

test('amounts parse at the decimals of each token, never rounded', () => {
  assert.deepEqual(parseTokenAmount('25.5', usdc), { ok: true, amount: 25_500_000n })
  assert.deepEqual(parseTokenAmount('.000001', usdc), { ok: true, amount: 1n })
  assert.match((parseTokenAmount('0.0000001', usdc) as { error: string }).error, /USDC has at most 6 decimals/)
  assert.deepEqual(parseTokenAmount('0.00000001', wbtc), { ok: true, amount: 1n })
  assert.equal(parseTokenAmount('0.000000001', wbtc).ok, false)
  assert.deepEqual(parseTokenAmount('0.30000000000000001', { symbol: 'ETH', decimals: 18 }), {
    ok: true,
    amount: 300000000000000010n,
  })
  assert.equal(parseTokenAmount('0', usdc).ok, false)
  assert.deepEqual(parseTokenAmount('0', usdc, { allowZero: true }), { ok: true, amount: 0n })
  for (const bad of ['', '1e6', '-1', '1,5', 'abc']) assert.equal(parseTokenAmount(bad, usdc).ok, false, bad)
})

test('labels cut, never round up', () => {
  assert.equal(tokenLabel(25_500_000n, usdc), '25.5 USDC')
  assert.equal(tokenLabel(1n, usdc), '<0.0001 USDC')
  assert.equal(tokenLabel(0n, usdc), '0 USDC')
  assert.equal(tokenLabel(12_345_678n, wbtc), '0.1234 WBTC')
})

test('accepted tokens and prices as the contracts take them', () => {
  assert.equal(parseAccepted([], 1).ok, false)
  assert.equal(parseAccepted([USDC], 11155111).ok, false, 'USDC is not offered off mainnet')
  const a = parseAccepted([USDC.toLowerCase(), ETH], 1)
  assert.ok(a.ok)
  assert.deepEqual(a.tokens.map((t) => t.address), [ETH, USDC], 'in allowlist order, checksummed')
  const tokens = a.tokens
  // Editions: every token needs a price above 0.
  assert.equal(buildPrices({ [ETH]: '0.01' }, tokens, { required: true, allowZero: false }).ok, false)
  assert.equal(buildPrices({ [ETH]: '0', [USDC.toLowerCase()]: '5' }, tokens, { required: true, allowZero: false }).ok, false)
  // Drops: blanks are left out, 0 is free, at least one.
  assert.deepEqual(buildPrices({ [USDC.toLowerCase()]: '0' }, tokens, { required: false, allowZero: true }), {
    ok: true,
    prices: [{ token: USDC, price: 0n }],
  })
  assert.equal(buildPrices({}, tokens, { required: false, allowZero: true }).ok, false)
  const [eth, us] = tokens
  assert.equal(pricesWords([{ price: parseEther('0.01'), token: eth! }, { price: 25_000_000n, token: us! }]), '0.01 ETH or 25 USDC')
  assert.equal(pricesWords([{ price: 0n, token: eth! }]), 'Free')
})

test('the token picker keeps a pick that is still offered, else ETH, else the first', () => {
  assert.equal(pickToken([USDC, ETH]), ETH)
  assert.equal(pickToken([USDC, ETH], USDC.toLowerCase()), USDC)
  assert.equal(pickToken([USDC, WBTC], ETH), USDC, 'ETH not offered: the first token')
  assert.equal(pickToken([]), undefined)
})

test('pay plan: ETH sends value; an ERC-20 sends none and approves exactly the cost when short', () => {
  assert.deepEqual(payPlan(ETH, 5n), { value: 5n, maxCost: 5n, approve: undefined, ready: true })
  assert.deepEqual(payPlan(USDC, 25_000_000n, 0n), { value: 0n, maxCost: 25_000_000n, approve: 25_000_000n, ready: true })
  assert.equal(payPlan(USDC, 25_000_000n, 30_000_000n).approve, undefined, 'enough allowance already')
  assert.equal(payPlan(USDC, 25_000_000n).approve, 25_000_000n, 'unread allowance: ask for exactly the cost')
  assert.equal(payPlan(USDC, 25_000_000n).ready, false)
  assert.match(approveWords(25_000_000n, { address: USDC, ...usdc }), /exactly 25 USDC, and no more/)
})

test('claim modes: TOKENS needs no floor; ETH and REINVEST are refused without a real quoted one', () => {
  assert.deepEqual(CLAIM_MODE, { TOKENS: 0, ETH: 1, REINVEST: 2 })
  assert.deepEqual(claimArgs('TOKENS'), { ok: true, args: [0, 0n] })
  // REINVEST's second argument is the least shares to mint, and its balancing swap has no price limit: never 0.
  assert.equal(claimArgs('REINVEST').ok, false)
  assert.match((claimArgs('REINVEST', 0n) as { error: string }).error, /live price quote/)
  assert.deepEqual(claimArgs('REINVEST', 7n), { ok: true, args: [2, 7n] })
  assert.equal(claimArgs('ETH').ok, false)
  assert.equal(claimArgs('ETH', 0n).ok, false)
  assert.deepEqual(claimArgs('ETH', 123n), { ok: true, args: [1, 123n] })
  const fees = { infer: parseEther('12.5'), imd: parseEther('3'), eth: 0n }
  assert.equal(feesWords(fees), '12.5 INFER + 3 IMD')
  assert.equal(feesWords({ ...fees, eth: parseEther('0.001') }), '12.5 INFER + 3 IMD + 0.001 ETH')
  assert.equal(hasFees({ infer: 0n, imd: 0n, eth: 0n }), false)
  // Only ETH dust ready: something to take, nothing to reinvest (REINVEST puts back INFER and IMD only).
  const dust = { infer: 0n, imd: 0n, eth: 5n }
  assert.equal(hasFeesFor('TOKENS', dust), true)
  assert.equal(hasFeesFor('REINVEST', dust), false)
  assert.equal(hasFeesFor('REINVEST', { ...dust, imd: 1n }), true)
})

test('a symbol read from chain is cut short, cleaned and marked; table symbols are not', () => {
  assert.equal(chainSymbol('FOO'), 'FOO?')
  assert.equal(chainSymbol('USDC'), 'USDC?', 'a lookalike never passes for the real one')
  assert.equal(chainSymbol('A'.repeat(40)), `${'A'.repeat(11)}…?`)
  assert.equal(chainSymbol('US\u202eDC\u0000'), 'USDC?')
  assert.equal(chainSymbol(''), 'token?')
  assert.ok(chainSymbol('🦄'.repeat(20)).length <= MAX_SYMBOL * 2 + 2, 'cut by character, not UTF-16 unit')
  assert.equal(knownToken(1, USDC)?.fromChain, undefined)
})

test('a launch draft loses tokens the registry dropped, with their names, and keeps something to pay with', () => {
  const allowed = [USDC.toLowerCase()]
  assert.deepEqual(parseAccepted([ETH, USDC.toLowerCase()], 1, allowed).ok, true)
  assert.match(
    (parseAccepted([ETH, WBTC.toLowerCase()], 1, allowed) as { error: string }).error,
    /no longer accepts WBTC/
  )
  assert.deepEqual(dropDelisted({ tokens: [ETH, WBTC.toLowerCase()], currency: ETH }, 1, allowed), {
    tokens: [ETH],
    currency: ETH,
    removed: ['WBTC'],
  })
  assert.deepEqual(dropDelisted({ tokens: [WBTC.toLowerCase()], currency: WBTC.toLowerCase() }, 1, allowed), {
    tokens: [ETH],
    currency: ETH,
    removed: ['WBTC'],
  })
  assert.deepEqual(dropDelisted({ tokens: [ETH, USDC.toLowerCase()], currency: USDC.toLowerCase() }, 1, allowed).removed, [])
})

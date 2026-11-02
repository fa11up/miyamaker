// src/pages/Swap/tokenList.ts: the curated miya list is pinned on top, the remote list is merged below it,
// deduped and sorted, and MIYA is shown but blocked. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  IMDUSD_ADDRESS,
  INFER_ADDRESS,
  MIYA_ADDRESS,
  MIYA_LIST,
  mergeTokenLists,
  NATIVE,
  quickPicks,
  searchTokens,
} from '../src/pages/Swap/tokenList.ts'
import * as fee from '../src/pages/Swap/fee.ts'

const MAIN = MIYA_LIST[1] || []
const RH = MIYA_LIST[4663] || []
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
const remote = [
  { chainId: 1, address: DAI, symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
  { chainId: 1, address: USDC.toLowerCase(), symbol: 'USDC', name: 'Remote USDC name', decimals: 6, logoURI: 'https://x/usdc.png' },
  { chainId: 1, address: AAVE, symbol: 'AAVE', name: 'Aave Token', decimals: 18, logoURI: 'javascript:alert(1)' },
  { chainId: 1, address: AAVE.toLowerCase(), symbol: 'AAVE2', name: 'dupe', decimals: 18 },
  { chainId: 10, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Optimism WETH', decimals: 18 },
  { chainId: 1, address: '0x1234', symbol: 'BAD', name: 'short address', decimals: 18 },
  { chainId: 1, address: '0x1111111111111111111111111111111111111111', symbol: '', name: 'no symbol', decimals: 18 },
  { chainId: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'NODEC', name: 'no decimals' },
  { chainId: 1, address: MIYA_ADDRESS, symbol: 'MIYA', name: 'remote MIYA', decimals: 18 },
  null,
  'junk',
]

test('the miya list is pinned first, in order, with its own metadata', () => {
  const merged = mergeTokenLists(MAIN, remote, 1)
  const pinned = MAIN
  assert.deepEqual(
    merged.slice(0, pinned.length).map((t) => t.symbol),
    ['ETH', 'INFER', 'imdUSD', 'USDC', 'WETH', 'IMD', 'CULT', 'MIYA']
  )
  const usdc = merged.find((t) => t.address.toLowerCase() === USDC.toLowerCase())
  assert.equal((usdc || {}).name, 'USD Coin', 'remote metadata never overrides the curated entry')
  assert.equal((usdc || {}).miya, true)
})

test('remote tokens are deduped against the pins and each other, filtered and sorted', () => {
  const merged = mergeTokenLists(MAIN, remote, 1)
  const rest = merged.slice(MAIN.length)
  assert.deepEqual(rest.map((t) => t.symbol), ['AAVE', 'DAI'])
  const lower = merged.map((t) => t.address.toLowerCase())
  assert.equal(new Set(lower).size, lower.length, 'no duplicate addresses')
  assert.equal(rest[0].logoURI, undefined, 'non-https logo dropped')
  assert.ok(rest.every((t) => !t.miya && !t.blocked && !t.unverified))
})

test('MIYA stays blocked even when the remote list has it', () => {
  const merged = mergeTokenLists(MAIN, remote, 1)
  const miya = merged.filter((t) => t.address.toLowerCase() === MIYA_ADDRESS.toLowerCase())
  assert.equal(miya.length, 1)
  assert.match(miya[0].blocked || '', /NFT-gated/)
  assert.ok(!quickPicks(1).some((t) => t.symbol === 'MIYA'), 'blocked tokens are not quick picks')
})

test('other chains: only their own tokens; INFER and imdUSD are mainnet-only', () => {
  const merged = mergeTokenLists(RH, remote, 4663)
  assert.deepEqual(merged.map((t) => t.symbol), ['ETH', 'USDG'])
  assert.ok(!RH.some((t) => [INFER_ADDRESS, IMDUSD_ADDRESS].includes(t.address)))
})

test('a broken or missing remote list still yields the miya list', () => {
  assert.deepEqual(mergeTokenLists(MAIN, [], 1), MIYA_LIST[1])
})

test('curated entries: checksummed-looking addresses, verified decimals, ETH is the native placeholder', () => {
  const m = MAIN
  assert.equal(m[0].address, NATIVE)
  const dec = Object.fromEntries(m.map((t) => [t.symbol, t.decimals]))
  assert.deepEqual(dec, { ETH: 18, INFER: 18, imdUSD: 18, USDC: 6, WETH: 18, IMD: 18, CULT: 18, MIYA: 18 })
  for (const t of m) assert.match(t.address, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(IMDUSD_ADDRESS.toLowerCase(), fee.IMDUSD.toLowerCase(), 'fee-free token matches the list')
})

test('search ranks exact symbol, then prefix, then contains, keeping list order inside a rank', () => {
  const merged = mergeTokenLists(MAIN, remote, 1)
  assert.deepEqual(searchTokens(merged, 'usd').map((t) => t.symbol), ['USDC', 'imdUSD'])
  assert.deepEqual(searchTokens(merged, 'INFER').map((t) => t.symbol), ['INFER'])
  assert.deepEqual(searchTokens(merged, 'ether').map((t) => t.symbol), ['ETH', 'WETH'])
  assert.deepEqual(searchTokens(merged, 'cult')[0].symbol, 'CULT')
  assert.equal(searchTokens(merged, '  ').length, merged.length)
  assert.equal(searchTokens(merged, 'zzzz').length, 0)
})

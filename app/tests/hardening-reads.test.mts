// "Couldn't tell" must not become a confident answer: read-failure classing, music scan completeness, Manage payouts,
// pool lookups. Pure parts of src/hooks/readFailure.ts, src/music/scan.ts, src/pages/Manage/payout.ts and
// src/pages/Swap/nft/pool.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  TimeoutError,
} from 'viem'

import { isRevert, readOutcome } from '../src/hooks/readFailure.ts'
import { MusicScanError, combineScan, mintLabel, scanNote } from '../src/music/scan.ts'
import { anyPayout, cappedNote, editionTotals, tokenPayout } from '../src/pages/Manage/payout.ts'
import { freeUnits, heldAmount, pickLocks, poolLookup } from '../src/pages/Swap/nft/pool.ts'

const abi = [{ type: 'function', name: 'f', inputs: [], outputs: [], stateMutability: 'view' }] as const

const wrap = (cause: BaseError) =>
  new ContractFunctionExecutionError(cause, { abi, functionName: 'f', args: [], contractAddress: '0x0000000000000000000000000000000000000001' })

test('a revert or missing contract is an answer; a transport failure is not', () => {
  assert.equal(isRevert(wrap(new ContractFunctionRevertedError({ abi, functionName: 'f' }))), true)
  assert.equal(isRevert(wrap(new ContractFunctionZeroDataError({ functionName: 'f' }))), true)
  const http = new HttpRequestError({ url: 'https://rpc.example', status: 503 })
  assert.equal(isRevert(wrap(new CallExecutionError(http, {}))), false)
  assert.equal(isRevert(new TimeoutError({ body: {}, url: 'https://rpc.example' })), false)
  assert.equal(isRevert(new Error('boom')), false)
  assert.equal(isRevert(undefined), false)
})

test('readOutcome: value, null for "no", undefined for unknown', () => {
  assert.equal(readOutcome<bigint>({ status: 'success', result: 5n }), 5n)
  assert.equal(readOutcome({ status: 'failure', error: wrap(new ContractFunctionZeroDataError({ functionName: 'f' })) }), null)
  assert.equal(readOutcome({ status: 'failure', error: new Error('fetch failed') }), undefined)
  assert.equal(readOutcome(undefined), undefined)
})

test('music scan: a failed registry or every collection failing throws instead of "no drops yet"', () => {
  assert.throws(() => combineScan([], { registryFailed: true, capped: false }), MusicScanError)
  assert.throws(() => combineScan([undefined, undefined], { registryFailed: false, capped: false }), MusicScanError)
  // No collections at all on a chain is a real empty list.
  assert.deepEqual(combineScan([], { registryFailed: false, capped: false }), { items: [], tried: 0, failed: 0, capped: false })
})

test('music scan: some failing, part-read or capped is partial and says so', () => {
  const some = combineScan([{ items: [1] }, undefined, { items: [], someFailed: true }], { registryFailed: false, capped: false })
  assert.deepEqual(some.items, [1])
  assert.equal(some.failed, 2)
  assert.match(scanNote(some)!, /couldn't load \(2 collections\)/)
  const capped = combineScan([{ items: [1], capped: true }], { registryFailed: false, capped: false })
  assert.equal(scanNote(capped), 'Showing the newest drops only.')
  assert.equal(scanNote(combineScan([{ items: [] }], { registryFailed: false, capped: true })), 'Showing the newest drops only.')
  assert.equal(scanNote(combineScan([{ items: [1] }], { registryFailed: false, capped: false })), undefined)
})

test('an unread edition price is never a guess on the Mint button', () => {
  assert.equal(mintLabel(undefined, String), 'Price unavailable')
  assert.equal(mintLabel(10n, () => '0.01 ETH'), 'Mint · 0.01 ETH')
  assert.equal(mintLabel(25_000_000n, () => '25 USDC'), 'Mint · 25 USDC')
})

test('Manage payouts per token: unknown unless every read landed, unsplit proceeds split as PaymentLib does', () => {
  assert.equal(tokenPayout(undefined, 0n, 100, 1000), undefined)
  assert.equal(tokenPayout(10n, undefined, 100, 1000), undefined)
  assert.equal(tokenPayout(10n, 0n, undefined, undefined), 10n, 'nothing to split: the balance is the payout')
  assert.equal(tokenPayout(10n, 5n, undefined, 1000), undefined, 'split terms unread')
  // 1% protocol, 10% vault: 1_000_000 unsplit → 10_000 + 100_000 cut, 890_000 to the artist, plus the balance.
  assert.equal(tokenPayout(7n, 1_000_000n, 100, 1000), 890_007n)
  // Cuts round down, the artist gets the dust: 99 * 1% = 0, 99 * 10% = 9.
  assert.equal(tokenPayout(0n, 99n, 100, 1000), 90n)
  assert.equal(anyPayout([{ token: '0x0000000000000000000000000000000000000000', payout: 0n }]), false)
  assert.equal(anyPayout([{ token: '0x0000000000000000000000000000000000000000', payout: undefined }]), undefined)
  assert.equal(
    anyPayout([
      { token: '0x0000000000000000000000000000000000000000', payout: undefined },
      { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', payout: 3n },
    ]),
    true
  )
})

test('pools: a failed poolOf read is neither free nor taken', () => {
  const zero = '0x0000000000000000000000000000000000000000'
  const pool = '0x00000000000000000000000000000000000000aa'
  assert.deepEqual(poolLookup(zero), { state: 'none' })
  assert.deepEqual(poolLookup(pool), { state: 'found', address: pool })
  assert.deepEqual(poolLookup(undefined), { state: 'unknown' })
})

test('pools: a picked NFT whose lock read failed is not treated as free to pick', () => {
  const lock: Record<string, boolean | undefined> = { '1': false, '2': true, '3': undefined }
  assert.deepEqual(pickLocks(['1', '2', '3', '4'], (id) => lock[id]), { locked: ['2'], unknown: ['3', '4'] })
  assert.deepEqual(pickLocks(['1'], (id) => lock[id]), { locked: [], unknown: [] })
})

test('pools: free units and held amounts stay unknown when their reads failed', () => {
  assert.equal(freeUnits(undefined, 0n), undefined)
  assert.equal(freeUnits(5n, undefined), undefined)
  assert.equal(freeUnits(5n, 2n), 3)
  assert.equal(freeUnits(2n, 5n), 0)
  const me = '0x00000000000000000000000000000000000000Ab'
  assert.equal(heldAmount({ status: 'success', result: me.toLowerCase() }, true, me), 1n)
  assert.equal(heldAmount({ status: 'success', result: '0x0000000000000000000000000000000000000001' }, true, me), 0n)
  assert.equal(heldAmount({ status: 'failure', reverted: true }, true, me), 0n, 'ownerOf reverting: not held')
  assert.equal(heldAmount({ status: 'failure', reverted: false }, true, me), undefined, 'RPC down: unknown')
  assert.equal(heldAmount({ status: 'success', result: 3n }, false, me), 3n)
  assert.equal(heldAmount(undefined, false, me), undefined)
})

test("Manage's editions Sold counts every edition, not the table's page", () => {
  const ed = (minted: bigint, supply: bigint) => ({ minted, supply })
  const many = Array.from({ length: 120 }, () => ed(2n, 10n))
  // 120 editions while the table shows 50: all 120 are counted.
  assert.deepEqual(editionTotals(many, 120), { minted: 240n, supply: 1200n, scope: undefined })
  // An open edition means no overall cap.
  assert.equal(editionTotals([ed(1n, 0n), ed(1n, 5n)], 2).supply, undefined)
  // A failed or missing read is not a smaller total.
  assert.deepEqual(editionTotals([ed(1n, 5n), undefined], 2), {})
  assert.deepEqual(editionTotals([ed(1n, 5n)], 2), {})
  assert.deepEqual(editionTotals(undefined, 2), {})
  // Past the cap, it says what it counted.
  assert.equal(editionTotals([ed(1n, 1n), ed(1n, 1n)], 5, 2).scope, 'of the first 2 of 5 editions')
})

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
import { cappedNote, dropWaiting, editionsWaiting } from '../src/pages/Manage/payout.ts'
import { freeModesFrom, freeUnits, heldAmount, MODE } from '../src/pages/Swap/nft/pool.ts'

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
  assert.equal(mintLabel(10n, () => '0.01'), 'Mint · 0.01 ETH')
})

test('Manage payouts: unknown unless every read landed, and the drop leaves parked cuts out', () => {
  assert.equal(editionsWaiting(undefined, 0n), undefined)
  assert.equal(editionsWaiting(10n, undefined), undefined)
  assert.equal(editionsWaiting(10n, 4n), 6n)
  assert.equal(editionsWaiting(4n, 10n), 0n)
  assert.equal(dropWaiting(100n, undefined, 0n), undefined)
  assert.equal(dropWaiting(undefined, 0n, 0n), undefined)
  assert.equal(dropWaiting(100n, 20n, 5n), 75n, 'withdraw() pays balance - pendingVaultCut - pendingProtocolCut')
  assert.equal(dropWaiting(10n, 20n, 5n), 0n)
  assert.equal(cappedNote(50, 120, 'editions'), 'Showing the first 50 of 120 editions.')
  assert.equal(cappedNote(50, 50, 'editions'), undefined)
  assert.equal(cappedNote(50, undefined, 'pieces'), undefined)
})

test('pools: a failed poolOf read is neither free nor taken', () => {
  const zero = '0x0000000000000000000000000000000000000000'
  const pool = '0x00000000000000000000000000000000000000aa'
  const modes = [MODE.TARGETED, MODE.RANDOM]
  assert.deepEqual(freeModesFrom([zero, pool], modes), { free: [MODE.TARGETED], unknown: [] })
  assert.deepEqual(freeModesFrom([undefined, zero], modes), { free: [MODE.RANDOM], unknown: [MODE.TARGETED] })
  assert.deepEqual(freeModesFrom([], modes), { free: [], unknown: modes })
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

// src/utils/batchCalls.ts: what goes into a one-signature batch, and when a wallet still gets separate steps. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeFunctionData, erc20Abi, type Address } from 'viem'

import { batchRefused, canBatch, toCall } from '../src/utils/batchCalls.ts'

const spender = '0x000000000000000000000000000000000000dEaD' as Address
const token = '0x00000000000000000000000000000000000000AA' as Address

test('only supported and ready count as able to batch', () => {
  assert.equal(canBatch({ atomic: { status: 'supported' } }), true)
  assert.equal(canBatch({ atomic: { status: 'ready' } }), true)
  assert.equal(canBatch({ atomic: { status: 'unsupported' } }), false)
  assert.equal(canBatch({}), false)
  assert.equal(canBatch(undefined), false)
})

test('a contract step encodes to the call it describes', () => {
  const call = toCall({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, 5n] })
  assert.equal(call.to, token)
  const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
  assert.equal(decoded.functionName, 'approve')
  assert.deepEqual(decoded.args, [spender, 5n])
})

test('a ready-made step passes through with its value', () => {
  const call = toCall({ to: token, data: '0x1234', value: 7n })
  assert.deepEqual(call, { to: token, data: '0x1234', value: 7n })
})

test('a wallet that cannot batch falls back; a person saying no does not', () => {
  assert.equal(batchRefused({ code: 4200 }), true)
  assert.equal(batchRefused({ code: 5750, message: 'upgrade rejected' }), true)
  assert.equal(batchRefused({ message: 'x', cause: { cause: { code: 5760 } } }), true)
  assert.equal(batchRefused(new Error('the method wallet_sendCalls does not exist')), true)
  assert.equal(batchRefused({ code: 4001, message: 'User rejected wallet_sendCalls' }), false)
  assert.equal(batchRefused({ message: 'x', cause: { code: 4001 } }), false)
  assert.equal(batchRefused(new Error('execution reverted: SoldOut')), false)
})

// src/utils/uploadError.ts: what a failed upload may honestly say about the money. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { uploadErrorWords } from '../src/utils/uploadError.ts'

test('raw text never reaches the screen', () => {
  const raw = new Error('irys node 500: 0xabc123 stack at foo.js')
  for (const stage of ['free', 'paying', 'paid'] as const) {
    const words = uploadErrorWords(raw, stage)
    assert.ok(!/0xabc|foo\.js|irys/i.test(words), words)
  }
})

test('a safe payment is only claimed once the balance covers the upload', () => {
  const raw = new Error('boom')
  assert.match(uploadErrorWords(raw, 'paid'), /safe on your storage balance/)
  assert.doesNotMatch(uploadErrorWords(raw, 'free'), /payment/)
  assert.match(uploadErrorWords(raw, 'paying'), /Check your wallet/)
})

test('cancelling says what happened', () => {
  const rejected = { shortMessage: 'User rejected the request.' }
  assert.equal(uploadErrorWords(rejected, 'free'), 'You cancelled it in your wallet. Nothing was uploaded.')
  assert.match(uploadErrorWords(rejected, 'paid'), /safe on your storage balance/)
})

test('out of ETH, and a payment not counted yet, use one word for the service', () => {
  assert.match(uploadErrorWords(new Error('insufficient funds for gas'), 'paying'), /needs a little more ETH/)
  const late = uploadErrorWords(new Error('402: not enough funds yet'), 'paid')
  assert.match(late, /storage service/)
  assert.doesNotMatch(late, /Irys/)
})

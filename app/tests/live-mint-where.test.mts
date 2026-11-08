// src/pages/Mint/LiveMint/where.ts: a finished mint says where it went. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mintedWhere } from '../src/pages/Mint/LiveMint/where.ts'

const ME = '0x5167d014a056e43883e1bbea5530c3c0dc993281'
const FRIEND = '0x1234567890abcdef1234567890abcdef12345634'

test('a plain mint, or mintTo your own wallet, is in your wallet', () => {
  assert.equal(mintedWhere(undefined, ME), 'It is in your wallet.')
  assert.equal(mintedWhere(ME.toUpperCase().replace('0X', '0x'), ME), 'It is in your wallet.')
})

test('a mint sent to another wallet says where it went, never "your wallet"', () => {
  assert.equal(mintedWhere(FRIEND, ME), 'It went to 0x1234…5634.')
  assert.equal(mintedWhere(FRIEND, undefined), 'It went to 0x1234…5634.')
})

// src/miyamints/referral.ts: ref links are read, tagged onto a mint and read back. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encodeFunctionData, getAddress, parseAbi } from 'viem'

import { currentRef, REF_BPS, REF_EARLY_BPS, REF_EARLY_UNTIL, REF_MAGIC, refBps, refRewardWords, refFromInput, refFromSearch, refLink, refSuffix } from '../src/miyamints/referral.ts'

const REF = getAddress('0x5167d014a056e43883e1bbea5530c3c0dc993281')
const DAY = 86_400_000
const abi = parseAbi(['function mint(uint256,uint256,bytes32[],address,uint256)'])
const call = encodeFunctionData({ abi, functionName: 'mint', args: [0n, 1n, [], '0x0000000000000000000000000000000000000000', 0n] })

test('a ref link names a real, nonzero address, or nothing', () => {
  assert.equal(refFromSearch(`?ref=${REF.toLowerCase()}`), REF)
  assert.equal(refFromSearch(`?x=1&ref=${REF}`), REF)
  assert.equal(refFromSearch('?ref=0x0000000000000000000000000000000000000000'), undefined)
  assert.equal(refFromSearch('?ref=vitalik.eth'), undefined)
  assert.equal(refFromSearch('?ref=0x1234'), undefined)
  assert.equal(refFromSearch(''), undefined)
})

test('the tag is the address then the magic, and reads back from the end of a plain mint', () => {
  const suffix = refSuffix(REF)
  assert.equal(suffix, `0x${REF.slice(2).toLowerCase()}${REF_MAGIC}`)
  assert.equal(refFromInput(`${call}${suffix.slice(2)}`), REF)
  assert.equal(refFromInput(call), undefined)
})

test('the tag reads back from inside a wrapped (smart wallet) call, padded after it', () => {
  const inner = `${call}${refSuffix(REF).slice(2)}`
  const wrapped = `0xb61d27f6${'00'.repeat(96)}${inner.slice(2)}${'00'.repeat(4)}` as `0x${string}`
  assert.equal(refFromInput(wrapped), REF)
})

test('the magic at an odd (half-byte) offset is not a tag', () => {
  assert.equal(refFromInput(`0x0${'11'.repeat(20)}${REF_MAGIC}0`), undefined)
})

test('the address bar at Mint wins; else the ref link opened earlier in this tab; junk is nothing', () => {
  const OTHER = getAddress('0x1234567890abcdef1234567890abcdef12345634')
  assert.equal(currentRef(`?ref=${OTHER}`, REF), OTHER)
  assert.equal(currentRef('', REF), REF)
  assert.equal(currentRef('?ref=junk', REF), REF)
  assert.equal(currentRef('', 'junk'), undefined)
  assert.equal(currentRef('', null), undefined)
})

test('the share link is the page plus the wallet, checksummed', () => {
  assert.equal(
    refLink('https://www.miyamaker.com', '/mint/miyamaker', REF.toLowerCase() as `0x${string}`),
    `https://www.miyamaker.com/mint/miyamaker?ref=${REF}`
  )
})

test('25% through Nov 21 UTC, 10% from Nov 22, and the share box says the same', () => {
  assert.equal(REF_EARLY_UNTIL, Date.parse('2026-11-22T00:00:00Z') / 1000)
  assert.equal(refBps(REF_EARLY_UNTIL - 1), REF_EARLY_BPS)
  assert.equal(refBps(REF_EARLY_UNTIL), REF_BPS)
  assert.equal([REF_EARLY_BPS, REF_BPS].join(), '2500,1000')
  assert.match(refRewardWords(REF_EARLY_UNTIL - 1), /^Earn 25% .* through Nov 21 \(UTC\), then 10%\./)
  assert.match(refRewardWords(REF_EARLY_UNTIL), /^Earn 10% of what mints from your link pay\./)
})

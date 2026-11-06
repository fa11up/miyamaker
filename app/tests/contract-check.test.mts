// Etherscan verification for My Files' Scam folder. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleContractCheck, readVerdict } from '../api/_lib/contractcheck.ts'
import { scamReason, splitScam } from '../src/desktop/files/scam.ts'

const A = `0x${'a'.repeat(40)}`
const B = `0x${'b'.repeat(40)}`
const memory = () => {
  const store = new Map<string, { at: number; body: unknown }>()
  return {
    store,
    get: async (k: string) => store.get(k),
    put: async (k: string, v: { at: number; body: unknown }) => void store.set(k, v),
  }
}
const deps = (over = {}) => ({
  key: 'k',
  cache: memory(),
  sameOrigin: () => true,
  clientKey: () => 'me',
  limiter: () => true,
  ...over,
})
const ask = (query: string) => new Request(`https://www.miyamaker.com/api/contracts/verified?a=${query}`)
const VERIFIED = { status: '1', result: '[]' }
const UNVERIFIED = { status: '0', result: 'Contract source code not verified' }

test('only a real answer from Etherscan counts', () => {
  assert.equal(readVerdict(VERIFIED), true)
  assert.equal(readVerdict(UNVERIFIED), false)
  assert.equal(readVerdict({ status: '0', result: 'Max rate limit reached' }), undefined)
  assert.equal(readVerdict({ status: '0', result: 'Missing/Invalid API Key' }), undefined)
  assert.equal(readVerdict(undefined), undefined)
})

test('answers per address, and a failure is left unknown', async () => {
  const res = await handleContractCheck(
    ask(`${A},${B}`),
    deps({
      etherscan: async (a: string) => {
        if (a === A) return UNVERIFIED
        throw new Error('down')
      },
    }),
  )
  assert.deepEqual(await res.json(), { verified: { [A]: false } })
})

test('with no key nothing is called unverified', async () => {
  const res = await handleContractCheck(ask(A), deps({ key: undefined, etherscan: async () => UNVERIFIED }))
  assert.deepEqual(await res.json(), { verified: {} })
})

test('verified is kept a long time, unverified is asked again', async () => {
  let calls = 0
  const cache = memory()
  const etherscan = async (a: string) => {
    calls += 1
    return a === A ? VERIFIED : UNVERIFIED
  }
  const at = (now: number) => deps({ cache, etherscan, now: () => now })
  await handleContractCheck(ask(`${A},${B}`), at(0))
  assert.equal(calls, 2)
  await handleContractCheck(ask(`${A},${B}`), at(3_600_000))
  assert.equal(calls, 2)
  await handleContractCheck(ask(`${A},${B}`), at(7 * 3_600_000))
  assert.equal(calls, 3)
})

test('refuses other sites, floods, bad addresses and big batches', async () => {
  assert.equal((await handleContractCheck(ask(A), deps({ sameOrigin: () => false }))).status, 403)
  assert.equal((await handleContractCheck(ask(A), deps({ limiter: () => false }))).status, 429)
  assert.equal((await handleContractCheck(ask('nope'), deps())).status, 400)
  const many = Array.from({ length: 21 }, (_, i) => `0x${String(i).padStart(40, '0')}`).join(',')
  assert.equal((await handleContractCheck(ask(many), deps())).status, 400)
})

const nft = (over = {}) => ({
  chainId: 1,
  contract: A,
  collectionName: 'C',
  tokenId: '1',
  name: 'n',
  description: 'd',
  image: 'https://evil.test/a.png',
  externalUrl: 'https://evil.test',
  ...over,
})

test('flagged or unverified goes in the folder; unknown does not', () => {
  assert.match(scamReason(nft({ spam: true }), {}, () => false) ?? '', /spam/i)
  assert.match(scamReason(nft(), { [A]: false }, () => false) ?? '', /not verified/i)
  assert.equal(
    scamReason(nft(), {}, () => false),
    undefined,
  )
  assert.equal(
    scamReason(nft(), { [A]: true }, () => false),
    undefined,
  )
})

test('a collection of ours is not sent there for being unverified, but a flag still counts', () => {
  assert.equal(
    scamReason(nft(), { [A]: false }, () => true),
    undefined,
  )
  assert.ok(scamReason(nft({ spam: true }), {}, () => true))
})

test('a scam file loses its link and never loads from its own server', () => {
  const { clean, scam } = splitScam(
    [
      nft({ spam: true, hostedThumb: 'https://cdn.test/t.png', hostedFull: 'https://cdn.test/f.png' }),
      nft({ spam: true }),
      nft({ contract: B }),
    ],
    {},
    () => false,
  )
  assert.equal(clean.length, 1)
  assert.equal(scam[0]?.image, 'https://cdn.test/t.png')
  assert.equal(scam[0]?.fullImage, 'https://cdn.test/f.png')
  assert.equal(scam[0]?.externalUrl, '')
  assert.equal(scam[1]?.image, '')
  assert.equal(scam[1]?.fullImage, '')
})

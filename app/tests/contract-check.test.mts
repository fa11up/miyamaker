// Etherscan verification for My Files' Scam folder. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONTRACT_CHECK_PATH, handleContractCheck, readVerdict } from '../api/_lib/contractcheck.ts'
import { fileLabel, fileType, scamReason, splitScam } from '../src/desktop/files/scam.ts'

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
  wait: async () => undefined,
  budget: () => 0,
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

test('a rate limit is tried again once, and stays unknown if it persists', async () => {
  let calls = 0
  const once = await handleContractCheck(
    ask(A),
    deps({
      etherscan: async () => {
        calls += 1
        return calls === 1 ? { status: '0', result: 'Max calls per sec rate limit reached (3/sec)' } : VERIFIED
      },
    }),
  )
  assert.deepEqual(await once.json(), { verified: { [A]: true } })
  const never = await handleContractCheck(
    ask(A),
    deps({ etherscan: async () => ({ status: '0', result: 'Max calls per sec rate limit reached (3/sec)' }) }),
  )
  assert.deepEqual(await never.json(), { verified: {} })
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
    { [B]: true },
    () => false,
  )
  assert.equal(clean.length, 1)
  assert.equal(scam[0]?.image, 'https://cdn.test/t.png')
  assert.equal(scam[0]?.fullImage, 'https://cdn.test/f.png')
  assert.equal(scam[0]?.externalUrl, '')
  assert.equal(scam[1]?.image, '')
  assert.equal(scam[1]?.fullImage, '')
})

test("a scam file loses the words it wrote about itself", () => {
  const { scam } = splitScam(
    [nft({ spam: true, name: 'Claim 5000 USDC', description: 'at evil.test', collectionName: 'Free USDC', tokenId: '7' })],
    {},
    () => false,
  )
  assert.equal(scam[0]?.name, '#7')
  assert.equal(scam[0]?.description, '')
  assert.equal(scam[0]?.collectionName, '')
})

test('a contract with no answer yet waits apart from the main folders, stripped like a scam file', () => {
  const held = nft({ hostedThumb: 'https://cdn.test/t.png', name: 'Claim now' })
  const waiting = splitScam([held], {}, () => false)
  assert.equal(waiting.clean.length, 0)
  assert.equal(waiting.scam.length, 0)
  assert.equal(waiting.checking[0]?.checking, true)
  assert.equal(waiting.checking[0]?.image, 'https://cdn.test/t.png')
  assert.equal(waiting.checking[0]?.externalUrl, '')
  assert.equal(waiting.checking[0]?.name, '#1')

  assert.equal(splitScam([held], { [A]: true }, () => false).clean.length, 1, 'verified')
  assert.equal(splitScam([held], { [A]: false }, () => false).scam.length, 1, 'not verified')
  assert.equal(splitScam([held], {}, () => true).clean.length, 1, 'our own collections never wait')
})

test('a file is labelled by its name, or a short id', () => {
  const long = '1'.repeat(78)
  assert.equal(fileLabel(nft({ name: 'vitalik.eth', tokenId: long })), 'vitalik.eth')
  assert.equal(fileLabel(nft({ name: `#${long}`, tokenId: long })), '#1111…1111')
  assert.equal(fileLabel(nft({ name: '', tokenId: '12' })), '#12')
  assert.equal(fileLabel(nft({ name: 'Claim now', tokenId: '12', scamReason: 'x' })), '#12', 'a scam file keeps its id')
})

test('the type row says what the indexer said', () => {
  assert.equal(fileType(nft({ tokenType: 'ERC1155', balance: '3' })), 'ERC-1155, you hold 3')
  assert.equal(fileType(nft({ tokenType: 'ERC1155' })), 'ERC-1155 token')
  assert.equal(fileType(nft({ tokenType: 'ERC721' })), 'ERC-721 token')
  assert.equal(fileType(nft()), 'NFT')
})

test('each answer is kept for its own time, not the cache default', async () => {
  const kept: Record<string, number | undefined> = {}
  const addresses = [`0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`]
  const res = await handleContractCheck(new Request(`https://x.test${CONTRACT_CHECK_PATH}?a=${addresses.join(',')}`), {
    key: 'k',
    etherscan: async (a) =>
      a === addresses[0] ? { status: '1', result: '[]' } : { status: '0', result: 'Contract source code not verified' },
    cache: {
      get: async () => undefined,
      put: async (key, _value, ttl) => {
        kept[key.split(':').pop()!] = ttl
      },
    },
    sameOrigin: () => true,
    clientKey: () => 'k',
    limiter: () => true,
    wait: async () => undefined,
    budget: () => 0,
  })
  assert.equal(res.status, 200)
  assert.equal(kept[addresses[0]!], 30 * 86_400)
  assert.equal(kept[addresses[1]!], 6 * 3_600)
})

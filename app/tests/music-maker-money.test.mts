// The money rules of the MiyaMusicMaker release flow (src/pages/MusicMaker/mintPlan.ts, releaseStore.ts): the salt
// can't change on a reload, a prompt left open is judged by the wallet's nonce, a failed read is never "not there",
// a record that can't be saved blocks sending, and the same bytes are never paid for twice. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type ChainReads,
  CouldNotReadError,
  discardChoice,
  findEdition,
  findInstance,
  leftoverVerdict,
  moneyWords,
  releaseSalt,
  sentVerdict,
  STALE_SEND_MS,
} from '../src/pages/MusicMaker/mintPlan.ts'
import {
  bumpReleaseRound,
  type KeyStore,
  knownUpload,
  lastUpload,
  loadRelease,
  rememberLastUpload,
  rememberUpload,
  releaseRound,
  saveRelease,
  type SavedRelease,
} from '../src/pages/MusicMaker/releaseStore.ts'

const factory = '0x00000000000000000000000000000000000000f1'
const account = '0x00000000000000000000000000000000000000Aa'
const predicted = '0x00000000000000000000000000000000000000c1' as const
const hash = `0x${'ab'.repeat(32)}` as const

function memoryStore(): KeyStore {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

function release(): SavedRelease {
  return {
    account,
    chainId: 1,
    content: 'song:application/json:abc',
    intent: 'mint-song',
    launch: {
      account,
      chainId: 1,
      factory,
      vault: '0x00000000000000000000000000000000000000f2',
      name: 'Song',
      title: 'Song',
      metadataURI: '',
      priceWei: 1n,
      supply: 0n,
      model: 1,
      rate: 0n,
      alignmentBps: 1000,
      mintFirst: false,
    },
    links: [],
    uploads: {},
    progress: {},
    savedAt: 1,
    sealed: false,
  }
}

test('the salt comes from the wallet, chain and content, so a reload keeps it', () => {
  const a = releaseSalt(factory, account, 1, 'song:x:1')
  assert.equal(a, releaseSalt(factory, account.toLowerCase(), 1, 'song:x:1'))
  assert.match(a, /^0x[0-9a-f]{40}00[0-9a-f]{22}$/)
  assert.ok(a.startsWith(factory.toLowerCase()), 'shaped like makeSalt: the factory first')
  assert.notEqual(a, releaseSalt(factory, account, 1, 'song:x:2'))
  assert.notEqual(a, releaseSalt(factory, account, 8453, 'song:x:1'))
  assert.notEqual(a, releaseSalt(factory, account, 1, 'song:x:1', 1), 'a discarded live release moves the round on')
})

test('the round moves on only when told, and reads 0 without storage', () => {
  const store = memoryStore()
  assert.equal(releaseRound(store, account, 1, 'c'), 0)
  bumpReleaseRound(store, account, 1, 'c', 0)
  assert.equal(releaseRound(store, account, 1, 'c'), 1)
  assert.equal(releaseRound(undefined, account, 1, 'c'), 0)
})

test('a prompt left open: nothing left the wallet, something is out, or all is mined', () => {
  assert.equal(leftoverVerdict(5, { pending: 5, latest: 5 }), 'not-sent')
  assert.equal(leftoverVerdict(5, { pending: 6, latest: 5 }), 'in-flight', 'out and not mined: wait, never resend')
  assert.equal(leftoverVerdict(5, { pending: 6, latest: 6 }), 'mined', 'mined: the chain state decides')
  assert.equal(leftoverVerdict(undefined, { pending: 6, latest: 5 }), 'in-flight', 'an older record still waits')
  assert.equal(leftoverVerdict(undefined, { pending: 6, latest: 6 }), 'mined')
})

test('a kept hash whose nonce mined without it was dropped or replaced', () => {
  assert.equal(sentVerdict(5, 6, false), 'dropped')
  assert.equal(sentVerdict(5, 5, false), 'waiting')
  assert.equal(sentVerdict(5, 6, true), 'landed')
  assert.equal(sentVerdict(undefined, 9, false), 'waiting', 'no nonce known: never guess dropped')
})

test('discard: free when settled, anyway when dropped or stale, never while it may land', () => {
  const now = 10 * STALE_SEND_MS
  assert.equal(discardChoice({ instance: predicted, editionId: 1n }, now), 'free')
  assert.equal(discardChoice({ mintHash: hash, sentAt: now - 1000 }, now), 'no')
  assert.equal(discardChoice({ mintHash: hash, sentAt: now - STALE_SEND_MS - 1 }, now), 'anyway')
  assert.equal(discardChoice({ asking: 'mint', dropped: true }, now), 'anyway')
  assert.equal(discardChoice({ batchId: 'b1' }, now), 'no')
})

function reads(code: (boolean | Error)[], ids: (readonly bigint[] | Error)[]): ChainReads {
  let c = 0
  let i = 0
  return {
    hasCode: async () => {
      const next = code[Math.min(c++, code.length - 1)]
      if (next instanceof Error) throw next
      return !!next
    },
    editionIds: async () => {
      const next = ids[Math.min(i++, ids.length - 1)] ?? []
      if (next instanceof Error) throw next
      return next
    },
    pause: async () => undefined,
  }
}

test('a read that failed is not "not there": it throws, so nothing is added again', async () => {
  const down = new Error('rpc down')
  await assert.rejects(findEdition(predicted, reads([], [down]), 1), CouldNotReadError)
  await assert.rejects(findEdition(predicted, reads([], [[], down]), 2), CouldNotReadError)
  await assert.rejects(findInstance({ predicted }, reads([down], []), 3), (e: { unconfirmed?: boolean }) => !!e.unconfirmed)
  assert.equal(await findEdition(predicted, reads([], [[]]), 2), undefined, 'answered empty: not there')
  assert.equal(await findEdition(predicted, reads([], [down, [4n]]), 2), 4n)
  assert.equal(await findInstance({ predicted }, reads([down, false], []), 2), undefined)
})

test('a record that cannot be saved says so, so nothing is sent', () => {
  assert.equal(saveRelease(undefined, release()), false, 'no storage is not a save')
  const store = memoryStore()
  assert.equal(saveRelease(store, release()), true)
  assert.ok(loadRelease(store, account, 1, release().content))
  const lying: KeyStore = { ...memoryStore(), setItem: () => undefined, getItem: () => null }
  assert.equal(saveRelease(lying, release()), false, 'a write that does not read back is a failure')
})

test('uploads are kept by content key, so the same bytes are never paid twice', () => {
  const store = memoryStore()
  assert.equal(knownUpload(store, 'bounce:audio/wav:aa'), undefined)
  assert.equal(rememberUpload(store, 'bounce:audio/wav:aa', 'ar://one'), true)
  assert.equal(knownUpload(store, 'bounce:audio/wav:aa'), 'ar://one')
  assert.equal(knownUpload(store, 'bounce:audio/wav:bb'), undefined)
  assert.equal(rememberUpload(undefined, 'k', 'ar://x'), false)
  rememberLastUpload(store, 'upload-song', 'ar://two', 5)
  assert.deepEqual(lastUpload(store, 'upload-song'), { uri: 'ar://two', at: 5 })
  assert.equal(lastUpload(store, 'upload-kit'), undefined)
})

test('the split is said before Mint', () => {
  assert.equal(
    moneyWords(1000, 100),
    'Sales stay in the collection until you withdraw them. On each withdrawal 10% goes to the community vault and 1% to miya. You keep the other 89%.'
  )
})

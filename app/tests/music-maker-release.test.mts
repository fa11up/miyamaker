// src/pages/MusicMaker/releaseStore.ts and the batch recovery in mintPlan.ts: a release under way survives the
// dialog closing, and a confirmed batch is never sent again. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  batchEdition,
  batchLanded,
  type ChainReads,
  describeLaunch,
  findInstance,
  launchCommitted,
  type LaunchProgress,
  launchUnsettled,
  nextLaunchStep,
} from '../src/pages/MusicMaker/mintPlan.ts'
import {
  clearRelease,
  findReleases,
  type KeyStore,
  loadRelease,
  parseRelease,
  releaseKey,
  saveRelease,
  type SavedRelease,
  serializeRelease,
  watchProgress,
} from '../src/pages/MusicMaker/releaseStore.ts'

const account = '0x00000000000000000000000000000000000000Aa'
const other = '0x00000000000000000000000000000000000000Bb'
const predicted = '0x00000000000000000000000000000000000000c1' as const
const logged = '0x00000000000000000000000000000000000000c2' as const
const hash = `0x${'ab'.repeat(32)}` as const

function memoryStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
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

function release(over: Partial<SavedRelease> = {}): SavedRelease {
  return {
    account,
    chainId: 1,
    content: 'song:application/json:abc',
    intent: 'mint-song',
    launch: {
      account,
      chainId: 1,
      factory: '0x00000000000000000000000000000000000000f1',
      vault: '0x00000000000000000000000000000000000000f2',
      name: 'Song',
      title: 'Song',
      metadataURI: 'ar://meta',
      priceWei: 10_000_000_000_000_000n,
      supply: 0n,
      model: 1,
      rate: 0n,
      alignmentBps: 500,
      mintFirst: true,
    },
    links: ['ar://audio', 'ar://pack', 'ar://meta'],
    uploads: { 'bounce:audio/wav:00': 'ar://audio' },
    progress: { batchId: 'b1', salt: hash, predicted, editionId: 3n },
    savedAt: 1,
    ...over,
  }
}

function fakeReads(code: boolean[], ids: (readonly bigint[] | Error)[]) {
  const calls = { code: 0, ids: 0, pauses: 0 }
  const reads: ChainReads = {
    hasCode: async () => code[Math.min(calls.code++, code.length - 1)] ?? false,
    editionIds: async () => {
      const next = ids[Math.min(calls.ids++, ids.length - 1)] ?? []
      if (next instanceof Error) throw next
      return next
    },
    pause: async () => {
      calls.pauses += 1
    },
  }
  return { reads, calls }
}

test('a saved release reads back whole, bigints and all', () => {
  const saved = release()
  const back = parseRelease(serializeRelease(saved))
  assert.deepEqual(back, saved)
  assert.equal(typeof back?.launch.priceWei, 'bigint')
  assert.equal(back?.progress.editionId, 3n)
  assert.equal(parseRelease('not json'), undefined)
  assert.equal(parseRelease(null), undefined)
})

test('a release is kept by wallet, chain and content', () => {
  const store = memoryStore()
  saveRelease(store, release())
  saveRelease(store, release({ content: 'song:application/json:def', savedAt: 5 }))
  saveRelease(store, release({ account: other }))
  saveRelease(store, release({ chainId: 8453 }))
  assert.equal(findReleases(store, account, 1).length, 2)
  assert.equal(findReleases(store, account.toLowerCase(), 1)[0].content, 'song:application/json:def', 'latest first')
  assert.equal(findReleases(store, other, 1).length, 1)
  assert.equal(findReleases(store, account, 8453).length, 1)
  assert.equal(findReleases(store, account, 10).length, 0)
  assert.equal(loadRelease(store, account, 1, 'song:application/json:abc')?.progress.batchId, 'b1')
  assert.notEqual(releaseKey(account, 1, 'a'), releaseKey(account, 1, 'b'))
})

test('a finished release is cleared, and only that one', () => {
  const store = memoryStore()
  saveRelease(store, release())
  saveRelease(store, release({ chainId: 8453 }))
  clearRelease(store, account, 1, 'song:application/json:abc')
  assert.equal(loadRelease(store, account, 1, 'song:application/json:abc'), undefined)
  assert.equal(findReleases(store, account, 8453).length, 1)
})

test('blocked storage loses nothing in memory and throws nothing', () => {
  const broken: KeyStore = {
    length: 1,
    key: () => {
      throw new Error('blocked')
    },
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  assert.equal(saveRelease(broken, release()), false)
  assert.equal(loadRelease(broken, account, 1, 'x'), undefined)
  assert.deepEqual(findReleases(broken, account, 1), [])
  clearRelease(broken, account, 1, 'x')
  assert.deepEqual(findReleases(undefined, account, 1), [])
})

test('every change to the progress is saved the moment it happens', () => {
  const store = memoryStore()
  const saved = release({ progress: {} })
  saved.progress = watchProgress(saved.progress, () => saveRelease(store, saved))
  saved.progress.batchId = 'b2'
  assert.equal(loadRelease(store, account, 1, saved.content)?.progress.batchId, 'b2')
  saved.progress.instance = predicted
  saved.progress.batchId = undefined
  const back = loadRelease(store, account, 1, saved.content)
  assert.equal(back?.progress.instance, predicted)
  assert.equal(back?.progress.batchId, undefined)
})

test('the first copy is waited on once sent, whatever the box says now', () => {
  const p: LaunchProgress = { instance: predicted, editionId: 1n, mintHash: hash }
  assert.equal(nextLaunchStep(p, true), 'wait-mint')
  assert.equal(nextLaunchStep(p, false), 'wait-mint')
  assert.equal(nextLaunchStep({ instance: predicted, editionId: 1n, minted: true }, true), 'done')
  assert.equal(nextLaunchStep({ instance: predicted, editionId: 1n }, false), 'done')
  // Sealed with the first copy: the saved release carries it, not the checkbox.
  const sealed = parseRelease(serializeRelease(release({ progress: { instance: predicted, editionId: 1n } })))
  assert.ok(sealed)
  assert.equal(nextLaunchStep(sealed.progress, sealed.launch.mintFirst), 'mint')
})

test('an edition that came in a batch is looked for, never added again', () => {
  assert.equal(nextLaunchStep({ instance: predicted, batched: true }, false), 'find-edition')
  assert.equal(nextLaunchStep({ instance: predicted, batched: true, editionId: 0n }, false), 'done')
  assert.equal(nextLaunchStep({ instance: predicted }, false), 'add-edition')
})

test('a wallet prompt left open seals the release and holds off a fresh one', () => {
  const p: LaunchProgress = { salt: hash, predicted, asking: 'batch' }
  assert.equal(launchCommitted(p), true)
  assert.equal(launchUnsettled(p), true)
  assert.match(describeLaunch(p, false), /looks on the chain/)
  assert.equal(launchUnsettled({ instance: predicted, editionId: 1n }), false)
  assert.equal(launchUnsettled({ instance: predicted, editionId: 1n, mintHash: hash }), true)
  assert.equal(launchCommitted({ salt: hash, predicted }), false, 'a clear failure leaves only the salt')
})

test('a batch receipt without logs finds the collection at the predicted address', async () => {
  const p: LaunchProgress = { batchId: 'b1', predicted }
  const { reads, calls } = fakeReads([false, true], [[7n]])
  const instance = await batchLanded(p, undefined, reads)
  assert.equal(instance, predicted)
  assert.equal(p.instance, predicted)
  assert.equal(p.batched, true)
  assert.equal(p.batchId, undefined, 'let go only once the collection is known')
  assert.equal(calls.pauses, 1)
  await batchEdition(p, instance, undefined, reads)
  assert.equal(p.editionId, 7n)
  assert.equal(nextLaunchStep(p, false), 'done')
})

test('the log wins when it is there', async () => {
  const p: LaunchProgress = { batchId: 'b1', predicted }
  const { reads, calls } = fakeReads([false], [[]])
  assert.equal(await batchLanded(p, logged, reads), logged)
  await batchEdition(p, logged, 2n, reads)
  assert.equal(p.editionId, 2n)
  assert.equal(calls.code + calls.ids, 0)
})

test('no collection found yet keeps the batch, so a retry waits instead of deploying', async () => {
  const p: LaunchProgress = { batchId: 'b1', predicted }
  const { reads } = fakeReads([false], [[]])
  await assert.rejects(batchLanded(p, undefined, reads), /sends nothing new/)
  assert.equal(p.batchId, 'b1')
  assert.equal(p.instance, undefined)
  assert.equal(nextLaunchStep(p, false), 'wait-batch')
  assert.equal(await findInstance({}, reads), undefined, 'no prediction, nothing to look at')
})

test('an edition that cannot be read says check the explorer and stays found-not-added', async () => {
  const p: LaunchProgress = { batchId: 'b1', predicted }
  const { reads, calls } = fakeReads([true], [new Error('rpc down'), [], []])
  const instance = await batchLanded(p, undefined, reads)
  await assert.rejects(batchEdition(p, instance, undefined, reads), /Check the explorer/)
  assert.ok(calls.ids >= 3, 'read a few times before giving up')
  assert.equal(p.editionId, undefined)
  assert.equal(nextLaunchStep(p, false), 'find-edition')
  assert.equal(nextLaunchStep(p, true), 'find-edition')
})

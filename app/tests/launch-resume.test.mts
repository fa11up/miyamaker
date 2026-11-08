// A launch under way survives a reload: src/pages/Launch/resume.ts (shared by Launch and Drop Music). Run: yarn test
import assert from 'node:assert/strict'
import test from 'node:test'

import { makeSalt } from '../src/miyamints/launch.ts'
import type { KeyStore, LaunchProgress, SavedLaunch } from '../src/pages/Launch/resume.ts'
import {
  batchInstance,
  bumpLaunchRound,
  clearLaunch,
  contentKey,
  discardChoice,
  draftId,
  draftSalt,
  findLaunches,
  knownUpload,
  launchCommitted,
  launchRound,
  launchUnsettled,
  leftoverVerdict,
  loadLaunch,
  nextLaunchStep,
  parseLaunch,
  rememberUpload,
  resumeWords,
  saveLaunch,
  sentVerdict,
  serializeLaunch,
  STALE_SEND_MS,
  stableJson,
} from '../src/pages/Launch/resume.ts'

const FACTORY = '0x00000000000000000000000000000000000000Fa'
const ACCOUNT = '0x00000000000000000000000000000000000000C1'
const OTHER = '0x00000000000000000000000000000000000000C2'
const PREDICTED = '0x0000000000000000000000000000000000001234' as const

function mapStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

const record = (over: Partial<SavedLaunch> = {}): SavedLaunch => ({
  app: 'launch',
  account: ACCOUNT,
  chainId: 1,
  draft: 'abc',
  round: 0,
  label: 'Test',
  input: { price: 5n },
  uploads: { image: 'ar://img' },
  progress: {},
  savedAt: 1,
  ...over,
})

test('the salt is fixed by the draft: same draft, same salt; anything else, another', () => {
  const draft = draftId({ form: { name: 'A', price: '0.1' }, image: 'image:image/png:ff' })
  assert.equal(draft, draftId({ image: 'image:image/png:ff', form: { price: '0.1', name: 'A' } }), 'key order does not matter')
  const salt = draftSalt(FACTORY, ACCOUNT, 1, 'launch', draft)
  assert.equal(salt, draftSalt(FACTORY, ACCOUNT.toUpperCase().replace('0X', '0x'), 1, 'launch', draft), 'case of the account does not matter')
  assert.notEqual(salt, draftSalt(FACTORY, ACCOUNT, 1, 'launch', draftId({ form: { name: 'B', price: '0.1' } })))
  assert.notEqual(salt, draftSalt(FACTORY, OTHER, 1, 'launch', draft), 'another wallet')
  assert.notEqual(salt, draftSalt(FACTORY, ACCOUNT, 4663, 'launch', draft), 'another chain')
  assert.notEqual(salt, draftSalt(FACTORY, ACCOUNT, 1, 'music', draft), 'another app')
  assert.notEqual(salt, draftSalt(FACTORY, ACCOUNT, 1, 'launch', draft, 1), 'a later round')
})

test('the salt has the factory-permissioned shape makeSalt gives', () => {
  const salt = draftSalt(FACTORY, ACCOUNT, 1, 'launch', 'abc')
  assert.match(salt, /^0x[0-9a-f]{64}$/)
  assert.equal(salt.slice(0, 44), makeSalt(FACTORY, new Uint8Array(11)).slice(0, 44), 'factory, then a zero byte')
  assert.throws(() => draftSalt('0x12', ACCOUNT, 1, 'launch', 'abc'))
})

test('stable JSON writes bigints and drops undefined, so drafts with them hash the same each time', () => {
  assert.equal(stableJson({ b: 2n, a: undefined, c: [1, { z: 1, y: 2 }] }), '{"b":"2n","c":[1,{"y":2,"z":1}]}')
})

test('a file is named by its bytes, not its name', async () => {
  const a = await contentKey('image', new Blob(['same'], { type: 'image/png' }))
  const b = await contentKey('image', new Blob(['same'], { type: 'image/png' }))
  const c = await contentKey('image', new Blob(['other'], { type: 'image/png' }))
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^image:image\/png:[0-9a-f]{64}$/)
})

test('a record saves, reads back with its bigints, and is found by wallet and chain only', () => {
  const store = mapStore()
  const saved = record({ progress: { salt: '0x01', firstId: 3n, instance: PREDICTED } })
  assert.equal(saveLaunch(store, saved), true)
  const back = loadLaunch(store, 'launch', ACCOUNT.toLowerCase(), 1, 'abc')
  assert.equal(back?.progress.firstId, 3n)
  assert.deepEqual((back?.input as { price: bigint }).price, 5n)
  assert.equal(findLaunches(store, 'launch', ACCOUNT, 1).length, 1)
  assert.equal(findLaunches(store, 'launch', OTHER, 1).length, 0, 'another wallet sees nothing')
  assert.equal(findLaunches(store, 'launch', ACCOUNT, 4663).length, 0, 'another chain sees nothing')
  assert.equal(findLaunches(store, 'music', ACCOUNT, 1).length, 0, 'another app sees nothing')
  clearLaunch(store, saved)
  assert.equal(findLaunches(store, 'launch', ACCOUNT, 1).length, 0)
})

test('no storage, or storage that will not keep it, says so: then nothing may be sent', () => {
  assert.equal(saveLaunch(undefined, record()), false)
  const refusing = { ...mapStore(), setItem: () => { throw new Error('quota') } }
  assert.equal(saveLaunch(refusing, record()), false)
  const forgetting = { ...mapStore(), getItem: () => null }
  assert.equal(saveLaunch(forgetting, record()), false)
})

test('junk in storage is ignored, not trusted', () => {
  assert.equal(parseLaunch('not json'), undefined)
  assert.equal(parseLaunch('{"account":1}'), undefined)
  assert.equal(parseLaunch(null), undefined)
  assert.ok(parseLaunch(serializeLaunch(record())))
})

test('the round moves on after a finished or discarded launch, so the same draft gets a new address', () => {
  const store = mapStore()
  assert.equal(launchRound(store, 'launch', ACCOUNT, 1, 'abc'), 0)
  bumpLaunchRound(store, record())
  assert.equal(launchRound(store, 'launch', ACCOUNT, 1, 'abc'), 1)
  bumpLaunchRound(store, record({ round: 0 }))
  assert.equal(launchRound(store, 'launch', ACCOUNT, 1, 'abc'), 1, 'an old record never moves it back or twice')
})

test('uploads are reused by content, and only real ar:// links count', () => {
  const store = mapStore()
  rememberUpload(store, 'k', 'ar://abc')
  assert.equal(knownUpload(store, 'k'), 'ar://abc')
  rememberUpload(store, 'bad', 'https://evil.example')
  assert.equal(knownUpload(store, 'bad'), undefined)
  assert.equal(knownUpload(undefined, 'k'), undefined)
})

test('the next step: anything sent is waited on, never sent again', () => {
  assert.equal(nextLaunchStep({}, true), 'deploy')
  assert.equal(nextLaunchStep({ batchId: 'b' }, true), 'wait-batch')
  assert.equal(nextLaunchStep({ deployHash: '0x1' }, true), 'wait-deploy')
  assert.equal(nextLaunchStep({ instance: PREDICTED }, true), 'first')
  assert.equal(nextLaunchStep({ instance: PREDICTED, firstHash: '0x2' }, true), 'wait-first')
  assert.equal(nextLaunchStep({ instance: PREDICTED, firstHash: '0x2', firstDone: true }, true), 'done')
  assert.equal(nextLaunchStep({ instance: PREDICTED }, false), 'done', 'a drop has no first piece')
})

test('committed and unsettled: what locks the form, and what blocks sending or paying again', () => {
  const p: LaunchProgress = { salt: '0x01', predicted: PREDICTED }
  assert.equal(launchCommitted(p), false, 'a salt and an address are not on the chain')
  assert.equal(launchCommitted({ asking: 'batch' }), true, 'a prompt that was open may have sent it')
  assert.equal(launchUnsettled({ asking: 'first' }), true)
  assert.equal(launchUnsettled({ batchId: 'b' }), true)
  assert.equal(launchUnsettled({ deployHash: '0x1' }), true)
  assert.equal(launchUnsettled({ deployHash: '0x1', instance: PREDICTED }), false, 'the deploy landed')
  assert.equal(launchUnsettled({ instance: PREDICTED }), false, 'live, first piece not sent yet: nothing out')
  assert.equal(launchUnsettled({ instance: PREDICTED, firstHash: '0x2' }), true, 'the deposit may still land')
  assert.equal(launchUnsettled({ instance: PREDICTED, firstHash: '0x2', firstDone: true }), false)
})

test('a prompt left open: the nonce says whether anything left the wallet', () => {
  assert.equal(leftoverVerdict(5, { pending: 5, latest: 5 }), 'not-sent')
  assert.equal(leftoverVerdict(5, { pending: 6, latest: 5 }), 'in-flight', 'something is out: wait, never send another')
  assert.equal(leftoverVerdict(5, { pending: 6, latest: 6 }), 'mined', 'the chain now says whether it was ours')
  assert.equal(leftoverVerdict(undefined, { pending: 6, latest: 6 }), 'mined', 'no record of the nonce: look on the chain')
})

test('a kept hash with no receipt: dropped only once its nonce was used by something else', () => {
  assert.equal(sentVerdict(5, 5, false), 'waiting')
  assert.equal(sentVerdict(5, 6, false), 'dropped')
  assert.equal(sentVerdict(5, 6, true), 'landed')
  assert.equal(sentVerdict(undefined, 9, false), 'waiting', 'no nonce kept: never assume it was dropped')
})

test('discard: free when nothing is out, never while it may still land, with a warning long after', () => {
  const now = 10 * STALE_SEND_MS
  assert.equal(discardChoice({}, now), 'free')
  assert.equal(discardChoice({ instance: PREDICTED }, now), 'free')
  assert.equal(discardChoice({ batchId: 'b', sentAt: now - 1000 }, now), 'no')
  assert.equal(discardChoice({ instance: PREDICTED, firstHash: '0x2', sentAt: now - 1000 }, now), 'no')
  assert.equal(discardChoice({ deployHash: '0x1', dropped: true }, now), 'anyway')
  assert.equal(discardChoice({ batchId: 'b', sentAt: now - STALE_SEND_MS - 1 }, now), 'anyway')
  assert.equal(discardChoice({ asking: 'deploy' }, now), 'no', 'no time kept: keep waiting')
})

test('a batch that came back without receipts is known only from its log or code at the predicted address', () => {
  assert.equal(batchInstance(PREDICTED, undefined, undefined), PREDICTED)
  assert.equal(batchInstance(undefined, PREDICTED, true), PREDICTED, 'no log: the predicted address, once code is there')
  assert.throws(() => batchInstance(undefined, PREDICTED, undefined), /sends nothing new/, 'no code yet: kept, not guessed')
  assert.throws(() => batchInstance(undefined, undefined, true), /sends nothing new/)
})

test('the banner never offers to pay while something is out', () => {
  assert.match(resumeWords({ batchId: 'b' }, true), /sends nothing new/)
  assert.match(resumeWords({ deployHash: '0x1' }, true), /sends nothing new/)
  assert.match(resumeWords({ asking: 'first', instance: PREDICTED }, true), /checks the chain before sending/)
  assert.match(resumeWords({ instance: PREDICTED, firstHash: '0x2' }, true, 'your piece'), /your piece was sent.*sends nothing new/)
  assert.match(resumeWords({ instance: PREDICTED }, true, 'your piece'), /without your piece yet/)
  assert.doesNotMatch(resumeWords({ batchId: 'b' }, true), /pay/i)
})

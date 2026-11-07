// src/pages/MusicMaker/mintPlan.ts: minting from the sampler resumes where it stopped and checks before paying.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMusicMetadata } from '../src/music/audio.ts'
import {
  contentKey,
  defaultArtist,
  firstCopyLabel,
  launchCommitted,
  nextLaunchStep,
  PLACEHOLDER_URIS,
  publishBpm,
  releaseBlocker,
} from '../src/pages/MusicMaker/mintPlan.ts'

const instance = '0x00000000000000000000000000000000000000c1' as const
const hash = `0x${'ab'.repeat(32)}` as const

test('a fresh release deploys first', () => {
  assert.equal(nextLaunchStep({}, false), 'deploy')
  assert.equal(launchCommitted({}), false)
})

test('a batch or deploy still out is waited on, never sent again', () => {
  assert.equal(nextLaunchStep({ batchId: 'b1' }, true), 'wait-batch')
  assert.equal(nextLaunchStep({ deployHash: hash }, true), 'wait-deploy')
  assert.equal(launchCommitted({ batchId: 'b1' }), true)
  assert.equal(launchCommitted({ deployHash: hash }), true)
})

test('a deployed collection is carried on from, not redeployed', () => {
  assert.equal(nextLaunchStep({ instance }, false), 'add-edition')
  assert.equal(nextLaunchStep({ instance, editionHash: hash }, false), 'wait-edition')
  assert.equal(nextLaunchStep({ instance, editionId: 1n }, false), 'done')
  assert.equal(nextLaunchStep({ instance, editionId: 0n }, true), 'mint', 'edition 0 is still an edition')
  assert.equal(nextLaunchStep({ instance, editionId: 1n, mintHash: hash }, true), 'wait-mint')
  assert.equal(nextLaunchStep({ instance, editionId: 1n, minted: true }, true), 'done')
  assert.equal(launchCommitted({ instance }), true)
})

test('uploads are keyed on their exact bytes', async () => {
  const a = await contentKey('bounce', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
  const same = await contentKey('bounce', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
  const other = await contentKey('bounce', new Blob([new Uint8Array([1, 2, 4])], { type: 'audio/wav' }))
  const kind = await contentKey('cover', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
  assert.equal(a, same)
  assert.notEqual(a, other)
  assert.notEqual(a, kind)
})

test('the tempo is rounded to what the metadata takes', () => {
  assert.equal(publishBpm(127.6), 128)
  assert.equal(publishBpm(12), 20)
  assert.equal(publishBpm(999), 400)
  assert.equal(publishBpm(Number.NaN), undefined)
  const meta = buildMusicMetadata({
    title: 'Song',
    artist: 'miya',
    image: PLACEHOLDER_URIS.image,
    audio: PLACEHOLDER_URIS.audio,
    song: PLACEHOLDER_URIS.pack,
    mime: 'audio/wav',
    duration: 4,
    bpm: publishBpm(127.6),
  })
  assert.equal(meta.ok, true)
  assert.equal(buildMusicMetadata({ title: 'Song', artist: 'miya', image: PLACEHOLDER_URIS.image, audio: PLACEHOLDER_URIS.audio, mime: 'audio/wav', duration: 4, bpm: 127.6 }).ok, false)
})

test('the placeholder check catches a bad field before any upload', () => {
  const meta = buildMusicMetadata({ title: '  ', artist: 'miya', image: PLACEHOLDER_URIS.image, audio: PLACEHOLDER_URIS.audio, mime: 'audio/wav', duration: 4 })
  assert.equal(meta.ok, false)
})

test('the first copy says what it costs', () => {
  assert.equal(firstCopyLabel(10_000_000_000_000_000n), 'Mint the first copy to this wallet (costs 0.01 ETH)')
  assert.equal(firstCopyLabel(undefined), 'Mint the first copy to this wallet (costs the edition price)')
})

test('a blank artist is the wallet, not miya', () => {
  assert.equal(defaultArtist('miya.eth', '0x1234567890abcdef1234567890abcdef12345678'), 'miya.eth')
  assert.equal(defaultArtist(null, '0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678')
  assert.equal(defaultArtist(undefined, undefined), '')
})

test('the wrong chain is named before anything is paid', () => {
  const base = { connected: true, wrongChain: false, deployed: true, chainName: 'Ethereum' }
  assert.equal(releaseBlocker(base), '')
  assert.match(releaseBlocker({ ...base, wrongChain: true }), /^Switch to Ethereum/)
  assert.match(releaseBlocker({ ...base, deployed: false, chainName: 'Sepolia', openChain: 'Ethereum' }), /Switch to Ethereum/)
  assert.equal(releaseBlocker({ ...base, connected: false }), 'Connect a wallet first.')
})

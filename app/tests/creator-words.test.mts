// src/music/creatorWords.ts, plainTxError and Launch's review words: what the creator windows say about money. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem'

import { plainTxError, TX_CHECK_WORDS, TX_RETRY_WORDS } from '../src/miyamints/errors.ts'
import { draftHasData, EMPTY_FORM, EMPTY_PHASE, phaseFieldsBad, phaseLine, whenWords } from '../src/miyamints/launch.ts'
import {
  addedWords,
  nextStepsWords,
  refusedWords,
  sourceWords,
  stationFailWords,
  stationStorageWords,
  storageWords,
  storedBytes,
} from '../src/music/creatorWords.ts'
import { countNew, createQueue, enqueue } from '../src/music/queue.ts'
import type { Track } from '../src/music/types.ts'

const FREE = 90 * 1024

test('only files over the free size are priced, and all-free still counts as chosen', () => {
  assert.equal(storedBytes([], FREE), undefined)
  assert.equal(storedBytes([FREE, 10], FREE), 1, 'two small files are each free, however much they add up to')
  assert.equal(storedBytes([FREE + 1, 10], FREE), FREE + 1, 'the small one costs nothing')
  assert.equal(storedBytes([FREE + 1, FREE + 2], FREE), 2 * FREE + 3)
})

test('storage lines say a price only when there is one', () => {
  const priced = { state: 'priced', wei: 1n, words: 'about 0.0012 ETH' } as const
  assert.equal(storageWords(priced), 'Storing your files: about 0.0012 ETH, paid once on Ethereum, plus network fees.')
  assert.equal(
    stationStorageWords(priced),
    'Storage: about 0.0012 ETH, paid once on Ethereum. Listing is free. The file stays on Arweave for good.',
  )
  assert.equal(storageWords({ state: 'none' }), '')
  assert.equal(storageWords({ state: 'failed' }), 'Your wallet shows the storage price before you pay.')
  assert.match(stationStorageWords({ state: 'failed' }), /^Your wallet shows the storage price before you pay\./)
  assert.match(stationStorageWords({ state: 'none' }), /already on Arweave/)
  for (const state of ['free', 'loading'] as const) {
    assert.doesNotMatch(storageWords({ state }), /ETH/)
    assert.doesNotMatch(stationStorageWords({ state }), /ETH/)
  }
})

test('what happens next counts the uploads and transactions that are really coming', () => {
  assert.equal(
    nextStepsWords({ uploads: 2, paying: true, txs: 2 }),
    'What happens next: pay for storage, sign each upload, then up to 2 transactions',
  )
  assert.equal(
    nextStepsWords({ uploads: 1, paying: false, txs: 1 }),
    'What happens next: sign the upload, then 1 transaction',
  )
  assert.equal(nextStepsWords({ uploads: 0, paying: false, txs: 1 }), 'What happens next: 1 transaction')
})

test('the station keeps its own words and never shows a bare status', () => {
  assert.equal(stationFailWords(503, 'The community station opens soon.'), 'The community station opens soon.')
  assert.equal(stationFailWords(500), 'The station is having trouble. Try again in a minute.')
  assert.doesNotMatch(stationFailWords(404), /404/)
})

test('the playlist note counts only what is new', () => {
  assert.equal(addedWords('Community station', 5, 2), 'Added 2 tracks from Community station.')
  assert.equal(addedWords('Community station', 5, 1), 'Added 1 track from Community station.')
  assert.equal(addedWords('Community station', 5, 0), 'Everything from Community station is already in your list.')
  assert.equal(addedWords('Community station', 0, 0), 'Community station: nothing to add yet.')

  const t = (id: string): Track => ({ id, title: id, src: `ar://${id}`, source: 'station' })
  const queue = enqueue(createQueue(), [t('a'), t('b')])
  assert.equal(countNew(queue, [t('a'), t('b'), t('c')]), 1)
  assert.equal(countNew(queue, [t('a')]), 0)
})

test('a refused file says what to do about it', () => {
  assert.equal(
    refusedWords('cover', 'The file is too large (max 10 MB).', 10),
    'That cover is too big. Use a picture up to 10 MB.',
  )
  assert.equal(
    refusedWords('track', 'The file is too large (max 50 MB).', 50),
    'That track is too big. Use a file up to 50 MB.',
  )
  assert.equal(refusedWords('cover', 'The file is empty.', 10), 'That cover did not work. The file is empty.')
})

test('track info names where a track came from', () => {
  assert.equal(sourceWords({ id: 'community:abc', source: 'station' }), 'Community station')
  assert.equal(sourceWords({ id: 'station:abc', source: 'station' }), 'Curated station')
  assert.equal(sourceWords({ id: 'local:x', source: 'local' }), 'Your file')
  assert.equal(
    sourceWords({ id: 'x', source: 'onchain', token: { chainId: 1, address: '0x', tokenId: '7' } }),
    'On-chain, token 7',
  )
})

test('plainTxError keeps sentences written for people and replaces developer text', () => {
  const abi = [
    { type: 'error', name: 'InvalidVault', inputs: [] },
    { type: 'error', name: 'Weird', inputs: [] },
  ] as const
  const reverted = (errorName: 'InvalidVault' | 'Weird') => {
    const cause = new ContractFunctionRevertedError({
      abi,
      functionName: 'createInstance',
      data: encodeErrorResult({ abi, errorName }),
    })
    return new BaseError('The contract function "createInstance" reverted.', { cause })
  }

  assert.match(plainTxError(reverted('InvalidVault')), /not registered with miya/)
  assert.equal(plainTxError(reverted('Weird')), TX_RETRY_WORDS, 'an error with no friendly words is not shown raw')
  assert.equal(plainTxError(reverted('Weird'), TX_CHECK_WORDS), TX_CHECK_WORDS)
  assert.equal(plainTxError(new BaseError('RPC Request failed.')), TX_RETRY_WORDS)
  assert.equal(
    plainTxError(new BaseError('User rejected the request.')),
    'You cancelled in your wallet.',
    'a cancel stays a cancel',
  )

  // Plain errors: this codebase's own sentences pass; a library's text does not.
  const ours = 'Creating the collection failed. Your uploads are saved, so press Retry.'
  assert.equal(plainTxError(new Error(ours)), ours)
  assert.equal(plainTxError(new Error('User rejected the request')), 'You cancelled in your wallet.')
  for (const raw of [
    'execution reverted: 0xdeadbeef',
    'Failed to fetch',
    'line one\nVersion: viem@2',
    'x'.repeat(300),
  ]) {
    assert.equal(plainTxError(new Error(raw)), TX_RETRY_WORDS, raw)
  }

  assert.equal(plainTxError(undefined), '')
})

test('a sale phase reads as one line, with every money setting on it', () => {
  const start = '2026-11-12T18:00'
  assert.equal(whenWords(start), '12 Nov 18:00')
  assert.equal(
    phaseLine({ ...EMPTY_PHASE, price: '0.02', maxPerWallet: '2', start }),
    '0.02 ETH, limit 2 per wallet, starts 12 Nov 18:00',
  )
  assert.equal(phaseLine({ ...EMPTY_PHASE, price: '0' }), 'Free, no limit per wallet, starts right away')
  assert.equal(
    phaseLine({ ...EMPTY_PHASE, price: '1', supplyCap: '1000', end: start }),
    '1 ETH, no limit per wallet, 1,000 for sale, starts right away, ends 12 Nov 18:00',
  )
  assert.match(phaseLine({ ...EMPTY_PHASE, price: 'abc' }), /^—,/)
})

test('phaseFieldsBad marks the box at fault', () => {
  const good = { ...EMPTY_PHASE, price: '0.01' }
  assert.deepEqual(Object.values(phaseFieldsBad(good)).filter(Boolean), [])
  assert.equal(phaseFieldsBad(EMPTY_PHASE).price, true, 'a blank price is what the step refuses')
  assert.equal(phaseFieldsBad({ ...good, maxPerWallet: 'x' }).maxPerWallet, true)
  assert.equal(phaseFieldsBad({ ...good, supplyCap: '0' }).supplyCap, true)
  assert.equal(phaseFieldsBad({ ...good, start: '2026-11-12T18:00', end: '2026-11-12T17:00' }).end, true)
  assert.equal(phaseFieldsBad({ ...good, start: '2026-11-12T18:00', end: '2026-11-12T19:00' }).end, false)
})

test('closing only asks when there is something to lose', () => {
  assert.equal(draftHasData(EMPTY_FORM, false), false)
  assert.equal(
    draftHasData({ ...EMPTY_FORM, type: 'auction', alignmentPct: '20' }, false),
    false,
    'a kind is nothing to lose',
  )
  assert.equal(draftHasData(EMPTY_FORM, true), true, 'a chosen file')
  assert.equal(draftHasData({ ...EMPTY_FORM, name: 'x' }, false), true)
  assert.equal(draftHasData({ ...EMPTY_FORM, bidStep: '0.5' }, false), true, 'a changed default')
  assert.equal(draftHasData({ ...EMPTY_FORM, phases: [{ ...EMPTY_PHASE, price: '1' }] }, false), true)
  assert.equal(draftHasData({ ...EMPTY_FORM, phases: [EMPTY_PHASE, EMPTY_PHASE] }, false), true)
})

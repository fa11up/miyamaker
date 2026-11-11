// Launch wizard + My launches pure logic: src/miyamints/{split,launch,collections}.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEther, zeroAddress } from 'viem'

import { KIND_LABEL, kindFromFactory, mergeLaunches, progressLabel, scanRange } from '../src/miyamints/collections.ts'
import type { LaunchForm } from '../src/miyamints/launch.ts'
import {
  buildAuctionArgs,
  buildDropArgs,
  buildEditionArgs,
  buildPhases,
  EMPTY_FORM,
  jsonDataUri,
  makeSalt,
  parseAlignmentPct,
  parseEth,
  parseLink,
  parseReserve,
  parseRoyaltyPct,
  parseSymbol,
  txPlan,
  validateStep,
} from '../src/miyamints/launch.ts'
import { describeSplit, ethLabel, pctLabel, splitAmount } from '../src/miyamints/split.ts'
import * as musicDrop from '../src/music/drop.ts'

const CREATOR = '0x00000000000000000000000000000000000000C1' as const
const VAULT = '0x00000000000000000000000000000000000000Fa' as const
const FACTORY = '0x00000000000000000000000000000000000000AA'
const NOW = 1_800_000_000n

const ctx = {
  now: NOW,
  minAlignmentBps: 1000,
  protocolFeeBps: 100,
  image: { hasFile: true },
  audio: { hasFile: false },
}

const form = (patch: Partial<LaunchForm>): LaunchForm => ({ ...EMPTY_FORM, ...patch })

// ── fee split display ────────────────────────────────────────────────────────

test('splitAmount mirrors RevenueSplitLib: cuts round down, the artist gets the dust', () => {
  assert.deepEqual(splitAmount(parseEther('1'), 100, 1000), {
    protocol: parseEther('0.01'),
    vault: parseEther('0.1'),
    artist: parseEther('0.89'),
  })
  // 999 wei: 1% = 9.99 → 9, 10% = 99.9 → 99, artist 891
  assert.deepEqual(splitAmount(999n, 100, 1000), { protocol: 9n, vault: 99n, artist: 891n })
  const s = splitAmount(123456789n, 100, 1250)
  assert.equal(s.protocol + s.vault + s.artist, 123456789n)
})

test('percent and ETH labels are short and exact', () => {
  assert.equal(pctLabel(1000), '10%')
  assert.equal(pctLabel(1250), '12.5%')
  assert.equal(pctLabel(8875), '88.75%')
  assert.equal(pctLabel(100), '1%')
  assert.equal(ethLabel(parseEther('0.89')), '0.89 ETH')
  assert.equal(ethLabel(parseEther('1')), '1 ETH')
  assert.equal(ethLabel(1n), '<0.0001 ETH')
  assert.equal(ethLabel(0n), '0 ETH')
})

test('describeSplit says the 1% / alignment / artist split in plain words, artist first', () => {
  const d = describeSplit({ protocolBps: 100, alignmentBps: 1000, vaultName: 'CULT' })
  assert.deepEqual(
    d.parts.map((p) => [p.key, p.pct, p.words]),
    [
      ['artist', '89%', 'goes to you'],
      ['vault', '10%', 'buys into the CULT vault'],
      ['protocol', '1%', 'goes to miya'],
    ]
  )
  assert.equal(
    d.sentence,
    'Of every 1 ETH collected, 0.89 ETH goes to you, 0.1 ETH buys into the CULT vault and 0.01 ETH goes to miya.'
  )
  assert.equal(describeSplit({ protocolBps: 100, alignmentBps: 9950 }).valid, false)
})

test('alignment share: minimum 10%, protocol + share ≤ 100%, same rules as Drop Music', () => {
  for (const [input, min, fee] of [
    ['10', 1000, 100],
    ['12.5', 1000, 100],
    ['9.99', 1000, 100],
    ['99', 1000, 100],
    ['100', 1000, 100],
    ['ten', 1000, 100],
  ] as const) {
    assert.equal(parseAlignmentPct(input, min, fee).ok, musicDrop.parseAlignmentPct(input, min, fee).ok, input)
  }
  assert.deepEqual(parseAlignmentPct('12.5', 1000, 100), { ok: true, bps: 1250 })
  assert.equal(parseAlignmentPct('9.5', 1000, 100).ok, false)
})

// ── field validation ─────────────────────────────────────────────────────────

test('links: only http(s), ipfs and ar', () => {
  for (const ok of ['https://x.io/a.png', 'ipfs://bafy/1.png', 'ar://abc', 'http://example.com']) {
    assert.equal(parseLink(ok).ok, true, ok)
  }

  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,xx', 'ftp://x', 'https://', 'ipfs://', 'https://x .io', 'file:///etc', '//x.io', 'https://a"b.io']) {
    assert.equal(parseLink(bad).ok, false, bad)
  }

  assert.deepEqual(parseLink('', false), { ok: true, uri: '' })
})

test('ETH amounts go through parseEther exactly', () => {
  assert.deepEqual(parseEth('0.30000000000000001'), { ok: true, wei: 300000000000000010n })
  assert.deepEqual(parseEth('.5'), { ok: true, wei: parseEther('0.5') })
  assert.equal(parseEth('0').ok, false)
  assert.deepEqual(parseEth('0', { allowZero: true }), { ok: true, wei: 0n })
  for (const bad of ['', '1e18', '-1', '1,5', '0.1234567890123456789']) assert.equal(parseEth(bad).ok, false, bad)
})

test('ticker and royalty', () => {
  assert.deepEqual(parseSymbol(' miya '), { ok: true, symbol: 'MIYA' })
  assert.equal(parseSymbol('MI YA').ok, false)
  assert.equal(parseSymbol('ABCDEFGHIJK').ok, false)
  assert.deepEqual(parseRoyaltyPct('7.5'), { ok: true, bps: 750 })
  assert.deepEqual(parseRoyaltyPct(''), { ok: true, bps: 0 })
  assert.equal(parseRoyaltyPct('11').ok, false)
})

test('phases: blank start = now, end after start, free mints allowed, at most 3', () => {
  const r = buildPhases([{ start: '', end: '', price: '0', maxPerWallet: '', supplyCap: '' }], NOW)
  assert.ok(r.ok)
  assert.deepEqual(r.phases[0], { start: NOW, end: 0n, price: 0n, maxPerWallet: 0, merkleRoot: `0x${'0'.repeat(64)}`, supplyCap: 0 })
  const bad = buildPhases([{ start: '2030-01-02T00:00', end: '2030-01-01T00:00', price: '0.1', maxPerWallet: '2', supplyCap: '' }], NOW)
  assert.equal(bad.ok, false)
  const four = Array.from({ length: 4 }, () => ({ start: '', end: '', price: '0.1', maxPerWallet: '', supplyCap: '' }))
  assert.equal(buildPhases(four, NOW).ok, false)
})

test('validateStep gates each wizard step', () => {
  assert.ok(validateStep('type', form({}), ctx).type)
  assert.deepEqual(validateStep('type', form({ type: 'drop' }), ctx), {})
  const art = validateStep('art', form({ type: 'drop', name: '', symbol: '' }), { ...ctx, image: { hasFile: false } })
  assert.ok(art.name && art.symbol && art.image)
  // Editions need no ticker; music needs a track.
  const music = validateStep('art', form({ type: 'editions', editionKind: 'music', name: 'Song' }), ctx)
  assert.deepEqual(Object.keys(music), ['audio'])
  assert.ok(validateStep('art', form({ type: 'drop', name: 'A', symbol: 'A', imageMode: 'link', imageUri: 'javascript:x' }), ctx).image)
  assert.ok(validateStep('sale', form({ type: 'auction', reserve: '0' }), ctx).reserve)
  assert.ok(validateStep('align', form({ alignmentPct: '5' }), ctx).alignmentPct)
  assert.ok(validateStep('align', form({ vaultChoice: 'custom', customVault: '0x123' }), ctx).customVault)
})

// ── contract argument builders ───────────────────────────────────────────────

const resolved = { creator: CREATOR, vault: VAULT, alignmentBps: 1500, image: 'ar://img' } as const

test('buildDropArgs → ERC721DropFactory.createDrop(InitParams, vault, alignmentBps)', () => {
  const f = form({
    type: 'drop',
    name: 'Miya Friends',
    symbol: 'mf',
    description: 'hi',
    supply: '100',
    royaltyPct: '5',
    phases: [{ start: '', end: '', price: '0.01', maxPerWallet: '3', supplyCap: '' }],
  })
  const [params, vault, bps] = buildDropArgs(f, resolved, NOW)
  assert.equal(vault, VAULT)
  assert.equal(bps, 1500)
  assert.equal(params.name, 'Miya Friends')
  assert.equal(params.symbol, 'MF')
  assert.equal(params.maxSupply, 100)
  assert.equal(params.baseURI, '')
  assert.equal(params.royaltyReceiver, CREATOR)
  assert.equal(params.royaltyBps, 500n)
  assert.deepEqual(params.phases[0], {
    start: NOW,
    end: 0n,
    price: parseEther('0.01'),
    maxPerWallet: 3,
    supplyCap: 0,
    merkleRoot: `0x${'0'.repeat(64)}`,
  })
  assert.ok(params.unrevealedURI.startsWith('data:application/json;utf8,'))
  const token = JSON.parse(decodeURIComponent(params.unrevealedURI.split(',')[1] as string))
  assert.deepEqual(token, { name: 'Miya Friends', description: 'hi', image: 'ar://img' })
  // No royalty → no receiver.
  assert.equal(buildDropArgs({ ...f, royaltyPct: '0' }, resolved, NOW)[0].royaltyReceiver, zeroAddress)
})

test('buildAuctionArgs → createInstance(salt, CreateParams) + queuePiece with the starting bid as value', () => {
  const salt = makeSalt(FACTORY, new Uint8Array(11).fill(1))
  const f = form({ type: 'auction', name: 'One', symbol: 'ONE', reserve: '0.25', durationHours: '48', bidStep: '0.01' })
  const { create, queue } = buildAuctionArgs(f, resolved, salt)
  assert.equal(create[0], salt)
  assert.deepEqual(
    { ...create[1], metadataURI: undefined },
    {
      name: 'One',
      metadataURI: undefined,
      creator: CREATOR,
      vault: VAULT,
      alignmentBps: 1500,
      symbol: 'ONE',
      lines: 1,
      baseDuration: 48 * 3600,
      timeBuffer: 300,
      bidIncrement: parseEther('0.01'),
    }
  )
  assert.equal(queue.value, parseEther('0.25'))
  assert.ok(queue.tokenURI.startsWith('data:application/json;utf8,'))
})

test('buildEditionArgs → ERC1155Factory.createInstance + addEdition (open edition, music metadata)', () => {
  const salt = makeSalt(FACTORY, new Uint8Array(11))
  const f = form({
    type: 'editions',
    editionKind: 'music',
    name: 'Night Tone',
    artist: 'Miya',
    editionPrice: '0.005',
    editionRise: '',
  })
  const { create, edition } = buildEditionArgs(f, { ...resolved, audio: 'ar://song', audioMime: 'audio/mpeg' }, salt)
  assert.equal(create[1].gatingModule, zeroAddress)
  assert.equal(create[1].creator, CREATOR)
  assert.deepEqual(create[1].freeMint, { allocation: 0n, scope: 0 })
  const [title, price, supply, uri, model, rate, open] = edition
  assert.deepEqual([title, price, supply, model, rate, open], ['Night Tone', parseEther('0.005'), 0n, 0, 0n, 0n])
  const meta = JSON.parse(decodeURIComponent(uri.split(',')[1] as string))
  assert.equal(meta.animation_url, 'ar://song')
  assert.equal(meta.mime_type, 'audio/mpeg')
  // Limited edition with a flat curve stays one price.
  assert.equal(buildEditionArgs({ ...f, editionKind: 'art', editionSupply: '50' }, resolved, salt).edition[4], 1)
  // The default gentle curve is 1% more each copy.
  const curved = buildEditionArgs({ ...f, editionSupply: '50', editionRise: '1' }, resolved, salt).edition
  assert.equal(curved[4], 2)
  assert.equal(curved[5], 100n)
  assert.equal(validateStep('sale', form({ type: 'editions', editionPrice: '0.01', editionRise: '1' }), ctx).editionRise?.length > 0, true)
})

test('makeSalt matches music/drop.ts; data URIs are percent-encoded JSON', () => {
  const r = new Uint8Array(11).fill(0xab)
  assert.equal(makeSalt(FACTORY, r), musicDrop.makeSalt(FACTORY, r))
  assert.equal(jsonDataUri({ a: '#%' }), 'data:application/json;utf8,%7B%22a%22%3A%22%23%25%22%7D')
  assert.equal(txPlan('drop').length, 1)
  assert.equal(txPlan('auction').length, 2)
})

// ── My launches list merge ───────────────────────────────────────────────────

test('mergeLaunches dedupes by chain + address, prefers the registry and sorts newest first', () => {
  const A = '0x00000000000000000000000000000000000000aa' as const
  const Aup = '0x00000000000000000000000000000000000000AA' as const
  const B = '0x00000000000000000000000000000000000000bb' as const
  const merged = mergeLaunches(
    [
      { chainId: 1, address: Aup, kind: 'unknown', order: 3, source: 'registry' },
      { chainId: 1, address: B, kind: 'drop', order: 7, source: 'registry' },
    ],
    [
      { chainId: 1, address: A, kind: 'editions', order: -1, source: 'local' },
      { chainId: 11155111, address: A, kind: 'legacy', order: -1, source: 'legacy' },
    ]
  )
  assert.deepEqual(
    merged.map((m) => [m.chainId, m.address.toLowerCase(), m.kind, m.source]),
    [
      [1, B, 'drop', 'registry'],
      [1, A, 'editions', 'registry'],
      [11155111, A, 'legacy', 'legacy'],
    ]
  )
})

test('kindFromFactory, scanRange and progress labels', () => {
  const f = { erc721DropFactory: '0xD0', erc721AuctionFactory: '0xA0', erc1155Factory: '0xE0' }
  assert.equal(kindFromFactory('0xd0', f), 'drop')
  assert.equal(kindFromFactory('0xA0', f), 'auction')
  assert.equal(kindFromFactory('0xE0', f), 'editions')
  assert.equal(kindFromFactory('0x00', f), 'unknown')
  assert.equal(kindFromFactory(undefined, f), 'unknown')
  assert.deepEqual(scanRange(5, 3), [4, 3, 2])
  assert.deepEqual(scanRange(0, 3), [])
  assert.equal(progressLabel('drop', 12n, 100n), '12 / 100 minted')
  assert.equal(progressLabel('editions', 3n, undefined), '3 minted')
  assert.equal(progressLabel('auction', 1n), '1 piece')
  assert.equal(KIND_LABEL.legacy, 'Legacy (MiyaMints v1)')
})

test('buildPhases: a phase can cap what it sells', () => {
  const r = buildPhases([{ start: '', end: '', price: '0.1', maxPerWallet: '', supplyCap: '50' }], NOW)
  assert.ok(r.ok)
  assert.equal(r.phases[0]?.supplyCap, 50)
  const zero = buildPhases([{ start: '', end: '', price: '0.1', maxPerWallet: '', supplyCap: '0' }], NOW)
  assert.equal(zero.ok, false)
})

test('parseReserve: blank is none, and one piece must stay on sale', () => {
  assert.deepEqual(parseReserve('', 10), { ok: true, n: 0 })
  assert.deepEqual(parseReserve('9', 10), { ok: true, n: 9 })
  assert.equal(parseReserve('10', 10).ok, false, 'a fully reserved drop could never sell')
})

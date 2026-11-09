// src/pages/MusicMaker: data that must not be lost and input that must not be trusted. A pad whose sample
// could not be read blocks Save, mint and upload; files from anywhere go through the normalizers (no NaN, no
// prototype keys, capped render work); wallet listings say when they are partial; deleted songs stay deleted;
// every sample form counts toward what a song can hold; remote reads are byte-capped and timed.
// Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  audioBank,
  assertPadsRead,
  clearUnreadPads,
  idbSet,
  loadFactoryKit,
  model as musicModel,
  normalizeBuses,
  normalizeComp,
  normalizePad,
  normalizePatch,
  PACK_SAMPLES,
  plainText,
  restoreSamples,
  sampleBudget,
  unreadPads,
} from '../src/pages/MusicMaker/model.js'
import { mergePatch, MAX_PARTIALS, renderSynth } from '../src/pages/MusicMaker/audio/synth.js'
import {
  b64Samples,
  captureKit,
  captureSong,
  checkSongSamples,
  decodeKitSamples,
  loadKit,
  normalizePatterns,
  packSong,
  syncProfileSongs,
} from '../src/pages/MusicMaker/audio/song.js'
import { buildPublish } from '../src/pages/MusicMaker/publish.js'
import { ensureLibrary, removeCached } from '../src/pages/MusicMaker/media/library.js'
import { linksFromItem, loadWalletPacks, pageTokens, walletSummary } from '../src/pages/MusicMaker/media/nft.js'
import { fetchCapped, readCapped } from '../src/pages/MusicMaker/media/capped.js'
import { heldBytes, trimStack } from '../src/pages/MusicMaker/history.js'
import { bounceSeconds, BOUNCE_MAX_SECONDS, looksLikeVideo } from '../src/pages/MusicMaker/audio/engine.js'
import { imageSize } from '../src/pages/MusicMaker/audio/imageSpectrum.js'

// The sampler's state is plain JS; the tests poke at it freely, so it is typed loosely here.
const model = musicModel as unknown as { pads: any[]; buses: any[]; [key: string]: any }

const g = globalThis as any

/** IndexedDB in memory, enough for one store: put, get, delete, getAllKeys. */
function memoryIdb(failGet: (key: string) => boolean = () => false) {
  const data = new Map<string, any>()
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const tx: any = {}
      const req: any = {}
      let job = () => {}
      tx.objectStore = () => ({
        put(value: any, key: string) { job = () => { data.set(key, value) }; return req },
        delete(key: string) { job = () => { data.delete(key) }; return req },
        get(key: string) {
          job = () => {
            if (failGet(key)) throw new Error('read failed')
            req.result = data.get(key)
          }
          return req
        },
        getAllKeys() { job = () => { req.result = [...data.keys()] }; return req },
      })
      setTimeout(() => {
        try {
          job()
          req.onsuccess?.()
          tx.oncomplete?.()
        } catch (err) {
          tx.error = err
          tx.onabort?.()
        }
      }, 0)
      return tx
    },
  }
  return {
    data,
    api: {
      open() {
        const r: any = {}
        setTimeout(() => { r.result = db; r.onsuccess?.() }, 0)
        return r
      },
    },
  }
}

async function withIdb<T>(idb: ReturnType<typeof memoryIdb>, fn: () => Promise<T>) {
  g.indexedDB = idb.api
  try {
    return await fn()
  } finally {
    delete g.indexedDB
    model.saveError = ''
  }
}

test('a sample pad that could not be read is unread, and Save, Save as, kit save, mint and upload refuse', async () => {
  const idb = memoryIdb((key) => key === 'pad:5')
  idb.data.set('pad:4', { pcm: new Float32Array([0.2, 0.3]), sr: 44100 })
  idb.data.set('pad:5', { pcm: new Float32Array([0.2]), sr: 44100 })
  await withIdb(idb, async () => {
    loadFactoryKit()
    for (const i of [4, 5, 6]) {
      model.pads[i].source = 'sample'
      audioBank.delete(i)
    }
    // Pad 5 fails to read; pad 6 has no record at all, which counts as a failure too.
    const warn = console.warn
    console.warn = () => {}
    try {
      await assert.rejects(restoreSamples(), /2 samples could not be read/)
    } finally {
      console.warn = warn
    }
    assert.deepEqual(unreadPads(), [5, 6])
    await assert.rejects(captureSong('Song'), /Save is off.*A6, A7/)
    await assert.rejects(captureKit('Kit'), /Save is off/)
    await assert.rejects(buildPublish('mint-song'), /Mint is off/)
    await assert.rejects(buildPublish('upload-bounce'), /Upload is off/)
    await assert.rejects(buildPublish('upload-kit'), /Upload is off/)
    clearUnreadPads()
    assert.deepEqual(unreadPads(), [])
    assert.doesNotThrow(() => assertPadsRead())
    const doc = await captureSong('Song')
    assert.deepEqual(doc.samples.map((s: any) => s.pad), [4])
  })
})

test('normalizers drop prototype keys, junk oscillators, and cap render work', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"freq":220,"bogus":5,"unison":99,"fmFrom":"x","oscs":[{"__proto__":{"p":1},"type":"evil","ratio":1e9},"junk",null],"partials":' + JSON.stringify(Array(500).fill(0.1)) + '}')
  const p = normalizePatch(hostile) as any
  assert.equal(({} as any).polluted, undefined)
  assert.equal(Object.getPrototypeOf(p), Object.prototype)
  assert.equal('bogus' in p, false)
  assert.equal(p.freq, 220)
  assert.equal(p.unison, 4)
  assert.equal(p.oscs.length, 3)
  assert.equal(p.oscs[0].type, 'sine')
  assert.equal(p.oscs[0].ratio, 64)
  assert.equal(p.partials.length, MAX_PARTIALS)
  // mergePatch never copies a prototype key, and a short oscillator list still renders.
  const merged = mergePatch(JSON.parse('{"__proto__":{"evil":1},"oscs":[{"type":"saw"}]}'))
  assert.equal(Object.getPrototypeOf(merged), Object.prototype)
  assert.equal(merged.oscs.length, 3)
  assert.ok(renderSynth({ oscs: [{ type: 'saw' }], partials: 'x' as any, aD: 0.01, aR: 0.01 }).pcm.length > 0)
  const pad = normalizePad(JSON.parse('{"__proto__":{"x":1},"source":"synth","name":{"a":1},"patch":{"oscs":"nope"}}'), 0)
  assert.equal(pad.name, 'Empty')
  assert.equal(Object.getPrototypeOf(pad), Object.prototype)
  assert.equal(pad.source, 'synth')
})

test('comp, bus and LFO normalizers turn NaN and junk into the defaults, and keep justice as it is', () => {
  const comp: any = normalizeComp({ threshold: NaN, ratio: 'x', knee: Infinity, attack: null, makeup: {}, kKnee: NaN, kPitch: NaN, justice: true, lfo: { kPolice: { rate: NaN, depth: 'x', on: 1 }, kFold: 7 } })
  for (const key of ['threshold', 'ratio', 'knee', 'attack', 'release', 'makeup', 'kKnee', 'kPolice', 'kFold', 'kPitch']) {
    assert.ok(Number.isFinite(comp[key]), `${key} is ${comp[key]}`)
  }
  assert.equal(comp.threshold, -18)
  assert.equal(comp.knee, 10)
  assert.equal(comp.justice, true)
  assert.equal(comp.lfo.kPolice.rate, 1)
  assert.equal(comp.lfo.kPolice.depth, 0.5)
  assert.equal(comp.lfo.kPolice.on, true)
  assert.equal(normalizeComp({ justice: false }).justice, false)
  const buses: any[] = normalizeBuses([{ volume: NaN, pan: 'x', name: { a: 1 }, fx: [{ type: 'delay', amount: NaN }, 'junk'] }])
  assert.equal(buses[0].volume, 0.82)
  assert.equal(buses[0].pan, 0)
  assert.equal(buses[0].name, '01')
  assert.equal(buses[0].fx[0].amount, 0.45)
  assert.equal(buses[0].fx[1].type, 'none')
})

test('a kit with a junk pad list or a hostile patch is refused or cleaned before any pad changes', async () => {
  await withIdb(memoryIdb(), async () => {
    loadFactoryKit()
    const before = model.pads[0].name
    await assert.rejects(loadKit({ type: 'k1t', name: 'Bad', pads: { 0: {} }, samples: [] }), /pad list is damaged/)
    assert.equal(model.pads[0].name, before)
    const pads = Array.from({ length: 64 }, () => null) as any[]
    pads[0] = JSON.parse('{"name":"Hostile","source":"synth","patch":{"__proto__":{"x":1},"oscs":[1],"unison":1e9,"partials":[1,2,3]}}')
    await loadKit({ type: 'k1t', name: 'Ok', pads, samples: [] })
    assert.equal(model.pads[0].name, 'Hostile')
    assert.equal(model.pads[0].patch.unison, 4)
    assert.ok(audioBank.get(0)?.pcm?.length)
    assert.equal(model.kitName, 'Ok')
  })
})

test('every sample form counts toward what a song holds, and the decoder refuses past it', () => {
  loadFactoryKit()
  model.pads[1].source = 'sample'
  audioBank.set(1, { pcm: new Float32Array(44100 * 10), sr: 44100, rev: 1 })
  const budget = sampleBudget()
  assert.equal(budget.used, 441000)
  assert.equal(budget.over, false)
  assert.equal(budget.leftSeconds, Math.floor((PACK_SAMPLES - 441000) / 44100))
  assert.equal(sampleBudget(PACK_SAMPLES).over, true)
  // A base64 sample is counted by its length, without decoding it.
  const big = 'A'.repeat(Math.ceil((PACK_SAMPLES + 10) * 16 / 3))
  assert.ok(b64Samples(big) > PACK_SAMPLES)
  assert.throws(() => packSong({ name: 'x', samples: [{ pad: 0, pcm: big }] }), /too long to pack/)
  assert.throws(() => decodeKitSamples([{ pad: 0, pcm: big }]), /too long to pack/)
  assert.throws(() => checkSongSamples({ samples: [{ pad: 0, pcm: new Float32Array(PACK_SAMPLES + 1) }] }), /run about 46 s/)
  audioBank.delete(1)
  model.pads[1].source = 'empty'
})

test('patterns from a file are capped, deduped, and lose unknown keys', () => {
  const list = [
    { i: 0, name: 'x'.repeat(500), bars: NaN, steps: [[{ pad: 1, vel: NaN, evil: 1 }, 'junk']], extra: 1 },
    { i: 0, name: 'dup' },
    { i: 300 },
    ...Array.from({ length: 400 }, (_, n) => ({ i: n % 256, name: String(n) })),
  ]
  const out = normalizePatterns(list) as any[]
  assert.equal(out.length, 256)
  assert.equal(out[0].name.length, 48)
  assert.equal(out[0].bars, 1)
  assert.equal('extra' in out[0], false)
  assert.deepEqual(out[0].steps[0][0], { pad: 1, vel: 0.9, pitch: 0, nudge: 0 })
  assert.equal(out[0].steps[0][1], null)
  assert.equal(plainText({ toString: () => 'x' } as any), '')
  assert.equal(plainText('a\u0000b'.repeat(50), 80).length, 80)
})

function page(items: any[], next: any = null) {
  return new Response(JSON.stringify({ items, next_page_params: next }), { status: 200 })
}

test('a wallet listing pages until done, and a failed or capped one says partial, not empty', async () => {
  let calls = 0
  const fetchAll = async (url: string) => {
    calls += 1
    if (!String(url).includes('ERC-1155')) return page([])
    const n = Number(new URL(url).searchParams.get('n') || 0)
    return n < 4 ? page([{ id: n, token: { address_hash: '0x' + '1'.repeat(40), name: { bad: 1 } }, animation_url: `https://x.test/${n}.mp3`, metadata: { name: { not: 'text' } } }], { n: n + 1 }) : page([])
  }
  const all = await pageTokens('0x' + 'a'.repeat(40), 'ERC-1155', { fetchImpl: fetchAll as any })
  assert.equal(all.items.length, 4)
  assert.equal(all.partial, false)
  assert.ok(calls >= 5)

  const capped = await pageTokens('0x' + 'a'.repeat(40), 'ERC-1155', { fetchImpl: fetchAll as any, maxPages: 2 })
  assert.equal(capped.items.length, 2)
  assert.equal(capped.partial, true)

  // Page two fails: what was read stays, marked partial. Ravepigs is then checked on its own.
  const flaky = async (url: string) => {
    if (String(url).includes('token-balances')) return new Response('[]', { status: 200 })
    if (!String(url).includes('ERC-1155')) return page([])
    if (new URL(url).searchParams.get('n')) return new Response('down', { status: 502 })
    return page([{ id: 1, token: { address_hash: '0x' + '1'.repeat(40) }, animation_url: 'https://x.test/a.mp3', metadata: { name: 12345 } }], { n: 1 })
  }
  const result = await loadWalletPacks('0x' + 'a'.repeat(40), { fetchImpl: flaky as any })
  assert.equal(result.partial, true)
  assert.equal(result.shown, 1)
  assert.equal(result.packs[0].tokens[0].name, '12345')
  assert.equal(result.packs[0].name, 'Collection')
  assert.deepEqual(result.locked.map((c: any) => c.id), ['ravepigs'])
  assert.match(walletSummary(result), /Showing 1 token with media.*More not loaded/)
  assert.equal(walletSummary({ ...result, partial: false, shown: 0 }), 'No audio or video in this wallet yet')

  // The balance check failing too: Ravepigs is "not checked", never "locked".
  const worse = async (url: string) => (String(url).includes('token-balances') ? new Response('x', { status: 500 }) : flaky(url))
  const unknown = await loadWalletPacks('0x' + 'a'.repeat(40), { fetchImpl: worse as any })
  assert.deepEqual(unknown.locked, [])
  assert.deepEqual(unknown.unknown.map((c: any) => c.id), ['ravepigs'])
})

test('walking metadata links is bounded in depth and count', () => {
  let deep: any = { animation_url: 'https://x.test/top.mp3' }
  for (let i = 0; i < 5000; i++) deep = { next: deep }
  assert.doesNotThrow(() => linksFromItem({ metadata: deep }))
  const wide = { metadata: { files: Array.from({ length: 5000 }, (_, i) => `https://x.test/${i}.wav`) } }
  assert.ok(linksFromItem(wide).length <= 32)
})

test('removing a song deletes its wallet copy, and a wallet sync never stores a song again', async () => {
  const who = '0x' + 'b'.repeat(40)
  const idb = memoryIdb()
  await withIdb(idb, async () => {
    model.library = null
    model.wallet = who
    const library = ensureLibrary() as any
    const doc = { type: 'm1ya', v: 2, name: 'Gone', patterns: [], pads: [], samples: [] }
    await idbSet('song:g1', doc)
    await idbSet(`profile:${who}:g1`, doc)
    await idbSet(`profile:${'c'.repeat(40)}:other`, doc)
    library.files.push({ id: 'g1', folder: 'songs', name: 'Gone', ext: 'm1ya' })
    await removeCached('g1')
    assert.equal(idb.data.has('song:g1'), false)
    assert.equal(idb.data.has(`profile:${who}:g1`), false)
    assert.equal(await syncProfileSongs(who), 0)

    // A wallet copy whose row was lost comes back under its own id, with no new wallet copy written.
    await idbSet(`profile:${who}:k2`, { ...doc, name: 'Kept' })
    const keys = idb.data.size
    assert.equal(await syncProfileSongs(who), 1)
    assert.equal((ensureLibrary() as any).files.find((f: any) => f.id === 'k2')?.name, 'Kept')
    assert.equal(idb.data.size, keys + 1, 'only song:k2 was written')
    assert.equal(await syncProfileSongs(who), 0)
    model.wallet = ''
  })
})

function streamResponse(chunks: number[], headers: Record<string, string> = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const n of chunks) controller.enqueue(new Uint8Array(n))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers })
}

test('remote reads stop at their byte cap while streaming, and give up after the timeout', async () => {
  assert.equal((await readCapped(streamResponse([10, 10]), 20)).byteLength, 20)
  await assert.rejects(readCapped(streamResponse([10, 10, 10]), 20), /over the 20 bytes limit/)
  await assert.rejects(readCapped(streamResponse([1], { 'content-length': '999999' }), 1000), /over/)
  const slow = () => new Promise<Response>(() => {})
  await assert.rejects(fetchCapped('https://x.test', { limit: 10, timeoutMs: 20, fetchImpl: slow as any }), /too long/)
  const notOk = await fetchCapped('https://x.test', { limit: 10, fetchImpl: (async () => new Response('', { status: 429 })) as any })
  assert.equal(notOk.res.status, 429)
  assert.equal(notOk.buffer, undefined)
})

test('undo keeps at most its byte budget of held audio, and always the newest step', () => {
  const pcm = (n: number) => ({ key: 'pad:0', value: { pcm: new Float32Array(n) } })
  assert.equal(heldBytes({ pcm: new Float32Array(10) }), 40)
  assert.equal(heldBytes({ samples: [{ pcm: 'abcd' }] }), 4)
  const list: any[] = Array.from({ length: 5 }, () => ({ json: '', blobs: [pcm(1000)] }))
  assert.equal(trimStack(list, 30, 8000), 8000)
  assert.equal(list.length, 2)
  const huge: any[] = [{ json: '', blobs: [pcm(1e6)] }]
  trimStack(huge, 30, 10)
  assert.equal(huge.length, 1)
})

test('bounce length comes from the song order, and the video decoder only gets video', () => {
  loadFactoryKit()
  model.bpm = 120
  assert.ok(Math.abs(bounceSeconds([0, 0], 120) - (32 * 0.125 + 0.6)) < 1e-9)
  // 256 one-bar patterns at 40 bpm run past the cap: renderBounce refuses that order instead of cutting it.
  assert.ok(bounceSeconds(Array.from({ length: 256 }, (_, i) => i), 40) > BOUNCE_MAX_SECONDS)
  const mp4 = new Uint8Array(12)
  mp4.set([0x66, 0x74, 0x79, 0x70], 4)
  assert.equal(looksLikeVideo(mp4.buffer, 'ipfs://cid'), true)
  assert.equal(looksLikeVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer, ''), true)
  assert.equal(looksLikeVideo(new TextEncoder().encode('hello there').buffer, 'notes.txt'), false)
  assert.equal(looksLikeVideo(new Uint8Array(4).buffer, 'clip.MOV'), true)
})

test('image headers give the size before a huge bitmap is decoded', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47])
  png.set([0, 0, 0x75, 0x30], 16)
  png.set([0, 0, 0x75, 0x30], 20)
  assert.deepEqual(imageSize(png), { width: 30000, height: 30000 })
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0, 0x20, 0])
  assert.deepEqual(imageSize(gif), { width: 16, height: 32 })
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null)
})

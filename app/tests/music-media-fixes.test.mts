// Small fixes around the music maker's wallet reads, release metadata, the desktop program, and two Radio/TV details:
// ERC-721 metadata links, the minted length at the song's own tempo, a kit build that can be cancelled and does not
// wait on a slow host, plain words for a picture that would not read, and the Kick note. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { isMediaHost } from '../src/pages/MusicMaker/media/allow.js'
import { DESKTOP_PUBLISH_NOTE, isDesktopApp } from '../src/pages/MusicMaker/media/desktop.js'
import { tokenUri } from '../src/pages/MusicMaker/media/nft.js'
import { pictureKitDoc, pictureProblem } from '../src/pages/MusicMaker/media/pictures.js'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** An ABI string answer, the way eth_call returns one. */
function abiString(text: string) {
  const hex = Buffer.from(text, 'utf8').toString('hex')
  const len = text.length.toString(16).padStart(64, '0')
  return `0x${'20'.padStart(64, '0')}${len}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`
}

const MILADY = '0x5af0d9827e0c53e4799bb226655a1de152a425a5'
const OTHER = '0x1111111111111111111111111111111111111111'

test('tokenUri asks an ERC-721 (or a Milady contract) tokenURI, not the ERC-1155 uri', async () => {
  const asked: string[] = []
  const call = async (_to: string, data: string) => {
    asked.push(data.slice(0, 10))
    if (data.startsWith('0xc87b56dd')) return abiString('ipfs://meta/7')
    throw new Error('execution reverted')
  }
  assert.equal(await tokenUri(MILADY, 7, { call }), 'ipfs://meta/7')
  assert.deepEqual(asked, ['0xc87b56dd'], 'an ECOSYSTEM contract goes straight to tokenURI')
  asked.length = 0
  assert.equal(await tokenUri(OTHER, 7, { standard: 'ERC-721', call }), 'ipfs://meta/7')
  assert.deepEqual(asked, ['0xc87b56dd'])
})

test('tokenUri falls back to tokenURI when uri reverts or answers empty, and fills {id} only on the 1155 path', async () => {
  const id64 = (7).toString(16).padStart(64, '0')
  const reverts = async (_to: string, data: string) => {
    if (data.startsWith('0x0e89341c')) throw new Error('execution reverted')
    return abiString('https://x.test/{id}.json')
  }
  assert.equal(await tokenUri(OTHER, 7, { call: reverts }), 'https://x.test/{id}.json', '721 answer is left as it is')
  const empty = async (_to: string, data: string) => (data.startsWith('0x0e89341c') ? '0x' : abiString('ar://abc'))
  assert.equal(await tokenUri(OTHER, 7, { call: empty }), 'ar://abc')
  const is1155 = async (_to: string, data: string) => {
    if (data.startsWith('0x0e89341c')) return abiString('https://x.test/{id}.json')
    throw new Error('should not be asked')
  }
  assert.equal(await tokenUri(OTHER, 7, { standard: 'ERC-1155', call: is1155 }), `https://x.test/${id64}.json`)
  const none = async () => {
    throw new Error('execution reverted')
  }
  await assert.rejects(tokenUri(OTHER, 7, { call: none }), /reverted/, 'both failing is an error, not an empty link')
})

test('the wallet read tells tokenUri which standard each listing came from', () => {
  assert.match(source('src/pages/MusicMaker/media/nft.js'), /tokenUri\(contract, item\.id, \{ standard: from721\.has\(item\)/)
})

test('buildPublish measures the minted length at the song tempo, the one the bounce renders at', () => {
  const text = source('src/pages/MusicMaker/publish.js')
  const body = text.slice(text.indexOf('export async function buildPublish'), text.indexOf('export function askPublish'))
  assert.match(body, /const bpm = songValue\(model, 'bpm'\)/)
  assert.doesNotMatch(body, /model\.bpm\b/)
  assert.match(body, /bounceSeconds\(order, bpm\)/)
})

test('a kit picture that hangs is skipped at its own deadline, and a cancelled kit stops', async () => {
  const g = globalThis as any
  const realFetch = g.fetch
  // A host that never answers until the read is aborted.
  g.fetch = (_url: string, init: any = {}) =>
    new Promise((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      // Like fetch: a signal that is already aborted fails at once.
      if (init.signal?.aborted) fail()
      else init.signal?.addEventListener('abort', fail)
    })
  try {
    const picks = [{ url: 'https://miladymaker.net/a.png', name: 'a' }]
    const started = Date.now()
    const slow = await pictureKitDoc(picks, { pictureMs: 30 })
    assert.ok(Date.now() - started < 5000, 'one picture does not hold the kit for the reader’s long timeout')
    assert.equal(slow.made, 0)
    assert.equal(slow.skipped, 1)
    assert.equal(slow.error, 'That host took too long to answer')

    const abort = new AbortController()
    const run = pictureKitDoc([...picks, ...picks], { signal: abort.signal, pictureMs: 60_000 })
    setTimeout(() => abort.abort(), 20)
    const cancelled = await run
    assert.equal(cancelled.cancelled, true)
    assert.equal(cancelled.doc, null)
  } finally {
    g.fetch = realFetch
  }
})

test('a picture that will not read says so in plain words, never a decoder or network message', () => {
  assert.equal(pictureProblem(new TypeError('Failed to fetch')), 'That picture could not be read. The host may be down, or it is not a png or jpg.')
  assert.equal(pictureProblem(new Error('InvalidStateError: The source image could not be decoded.')), 'That picture could not be read. The host may be down, or it is not a png or jpg.')
  assert.equal(pictureProblem(undefined), 'That picture could not be read. The host may be down, or it is not a png or jpg.')
  // Our own sentences come through.
  assert.equal(pictureProblem(new Error('That host took too long to answer')), 'That host took too long to answer')
  assert.equal(pictureProblem(Object.assign(new Error('Too many requests to the sample reader: wait a moment and try again.'), { status: 429 })), 'Too many requests to the sample reader: wait a moment and try again.')
  assert.doesNotMatch(source('src/pages/MusicMaker/media/pictures.js'), /error = err\?\.message/)
})

test('the File menu kit build has a Cancel and does not lock the Wallet window', () => {
  const text = source('src/pages/MusicMaker/screens/FileMenu.jsx')
  assert.match(text, /Cancel kit/)
  assert.match(text, /signal: abort\.signal/)
  // The kit build has its own flag; the window's busy (which blocks Escape and Close) is not set by it.
  const make = text.slice(text.indexOf('async function makeKit'), text.indexOf('async function makeVideo'))
  assert.doesNotMatch(make, /setBusy\(/)
})

test('the desktop program is told apart by its user agent, and its release window only says where to publish', () => {
  assert.equal(isDesktopApp('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 MiyaMusicMaker/1.0.0 Chrome/128.0 Electron/32.1.2 Safari/537.36'), true)
  assert.equal(isDesktopApp('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0 Safari/537.36'), false)
  assert.equal(isDesktopApp(''), false)
  assert.equal(DESKTOP_PUBLISH_NOTE, 'Publishing and minting work on miyamaker.com, not in the desktop app.')
  const dialog = source('src/pages/MusicMaker/PublishDialog.tsx')
  assert.match(dialog, /if \(isDesktopApp\(\)\) return <DesktopOnly/)
  assert.match(source('src/pages/MusicMaker/screens/FileMenu.jsx'), /DESKTOP_VIDEO_NOTE/)
})

test('an Arweave sandbox subdomain is a sample host; other names under arweave.net are not', () => {
  assert.equal(isMediaHost('arweave.net'), true)
  assert.equal(isMediaHost(`${'a'.repeat(50)}23.arweave.net`), true)
  assert.equal(isMediaHost('evil.arweave.net'), false)
  assert.equal(isMediaHost(`${'a'.repeat(52)}.arweave.net.evil.test`), false)
  assert.equal(isMediaHost(`x.${'a'.repeat(52)}.arweave.net`), false)
})

test('the Radio play button glow does not lean on a --lvl nothing on the page sets', () => {
  const text = source('src/pages/Radio/parts.tsx')
  assert.doesNotMatch(text, /var\(--lvl\)/, 'a bare var(--lvl) voids the whole box-shadow, ring and drop shadow too')
})

test('miyaTV on Kick with nobody to play talks about who is live, not about sound', () => {
  const text = source('src/pages/TV/index.tsx')
  const note = text.slice(text.indexOf('const soundNote'), text.indexOf('const tapes'))
  assert.ok(note.indexOf('onKick && !source') >= 0, 'the empty Kick channel is checked')
  assert.ok(note.indexOf('onKick && !source') < note.indexOf("source?.provider === 'kick'"), 'before the source is')
  assert.match(note, /Nobody is live right now\./)
  assert.match(note, /Couldn't check who's live\./)
})

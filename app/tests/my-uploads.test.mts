// Reading a wallet's uploads back from Irys: src/utils/myUploads.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isJunkFile, parseManifest, parseUpload, pathInFolder } from '../src/utils/myUploads.ts'

const ID = 'a'.repeat(43)
const OTHER = 'b'.repeat(43)
const tags = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }))

test('images and audio are listed with their names', () => {
  const song = parseUpload({ id: ID, timestamp: 5, tags: tags({ 'Content-Type': 'Audio/WAV', 'File-Name': 'a.wav' }) })
  assert.deepEqual(song, { id: ID, kind: 'audio', mime: 'audio/wav', name: 'a.wav', at: 5 })
  assert.equal(parseUpload({ id: ID, tags: tags({ 'Content-Type': 'image/png' }) })?.kind, 'image')
})

test('token metadata and other files are not offered', () => {
  assert.equal(parseUpload({ id: ID, tags: tags({ 'Content-Type': 'application/json' }) }), undefined)
  assert.equal(parseUpload({ id: ID, tags: [] }), undefined)
})

test('a folder is listed under its manifest, not the record that points at it', () => {
  const folder = parseUpload({
    id: OTHER,
    tags: tags({
      'Content-Type': 'application/json',
      'miya-kind': 'folder',
      'Folder-Manifest': ID,
      'Folder-Name': 'art',
      'File-Count': '3',
    }),
  })
  assert.equal(folder?.id, ID)
  assert.equal(folder?.kind, 'folder')
  assert.equal(folder?.name, 'art')
  assert.equal(folder?.files, 3)
})

test('a folder record with a bad manifest id is dropped', () => {
  const bad = { id: OTHER, tags: tags({ 'miya-kind': 'folder', 'Folder-Manifest': 'x/../y' }) }
  assert.equal(parseUpload(bad), undefined)
})

test('a manifest gives each file a kind from its name and skips bad ids', () => {
  const files = parseManifest({
    paths: { '1.png': { id: ID }, 'a/song.MP3': { id: OTHER }, 'notes.txt': { id: ID }, 'bad.png': { id: 'nope' } },
  })
  assert.deepEqual(
    files.map((f) => [f.path, f.kind]),
    [['1.png', 'image'], ['a/song.MP3', 'audio'], ['notes.txt', undefined]]
  )
  assert.equal(files[1]?.mime, 'audio/mpeg')
  assert.deepEqual(parseManifest('not a manifest'), [])
})

test('paths lose the folder name, and system files are left out', () => {
  assert.equal(pathInFolder('art/1.png'), '1.png')
  assert.equal(pathInFolder('art/sub/1.png'), 'sub/1.png')
  assert.equal(pathInFolder('1.png'), '1.png')
  assert.ok(isJunkFile('art/.DS_Store'))
  assert.ok(isJunkFile('art/Thumbs.db'))
  assert.ok(!isJunkFile('art/1.png'))
})

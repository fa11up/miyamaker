import { stashUndo } from '../history.js'
import { idbDelete, idbGet, idbKeys, idbSet, model, touch } from '../model.js'

export const MEDIA_RE = /\.(wav|mp3|m4a|aac|ogg|flac|aiff|aif|mp4|webm|mov|m4v)$/i

export function defaultLibrary() {
  return {
    folders: [
      { id: 'imports', parent: '', name: 'Imports' },
      { id: 'slices', parent: '', name: 'Slices' },
      { id: 'songs', parent: '', name: 'Songs' },
      { id: 'templates', parent: '', name: 'Templates' },
      { id: 'kits', parent: '', name: 'Kits' },
    ],
    files: [],
  }
}

export function ensureLibrary() {
  const raw = model.library
  if (!raw || Array.isArray(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.files)) {
    model.library = defaultLibrary()
  }
  for (const folder of defaultLibrary().folders) {
    if (model.library.folders.some((item) => item.id === folder.id)) continue
    if (folder.id === 'songs' || folder.id === 'kits' || folder.id === 'templates') model.library.folders.push(folder)
    else model.library.folders.unshift(folder)
  }
  if (!Array.isArray(model.library.sliceSets)) model.library.sliceSets = []
  return model.library
}

export function newFolder(name, parent = '') {
  const library = ensureLibrary()
  const clean = String(name || '').trim().slice(0, 48)
  if (!clean) return null
  const id = `f${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  library.folders.push({ id, parent, name: clean })
  touch(true)
  return id
}

export async function cachePcm(folder, name, pcm, sr, ext = 'wav') {
  const library = ensureLibrary()
  const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  stashUndo(`lib:${id}`, null)
  library.files.push({ id, folder, name: name || 'sample', ext })
  await idbSet(`lib:${id}`, { pcm, sr, name: name || 'sample' })
  touch(true)
  return id
}

/** Slice chops of one source stay unnamed by extension. Other files show theirs. */
export function fileLabel(file) {
  const library = ensureLibrary()
  const chopped = (library.sliceSets || []).some((set) => set.folder === file.folder && (set.cuts || []).some((cut) => cut.fileId === file.id))
  if (chopped || !file.ext) return file.name
  return `${file.name}.${String(file.ext).replace(/^\./, '')}`
}

export function loadCached(id) {
  return idbGet(`lib:${id}`)
}

function pruneSliceFile(id) {
  const library = ensureLibrary()
  for (const set of library.sliceSets || []) {
    set.cuts = (set.cuts || []).filter((cut) => cut.fileId !== id)
  }
  library.sliceSets = (library.sliceSets || []).filter((set) => set.cuts && set.cuts.length)
  const alive = new Set(library.sliceSets.map((set) => set.folder))
  library.folders = library.folders.filter((folder) => {
    if (folder.parent !== 'slices') return true
    if (alive.has(folder.id)) return true
    return library.files.some((file) => file.folder === folder.id)
  })
}

export async function removeCached(id) {
  const library = ensureLibrary()
  const file = library.files.find((item) => item.id === id)
  if (file?.ext === 'm1ya') {
    const doc = await idbGet(`song:${id}`)
    stashUndo(`song:${id}`, doc || null)
    await idbDelete(`song:${id}`)
  } else if (file?.ext === 'k1t') {
    const doc = await idbGet(`kit:${id}`)
    stashUndo(`kit:${id}`, doc || null)
    await idbDelete(`kit:${id}`)
  } else {
    const rec = await idbGet(`lib:${id}`)
    stashUndo(`lib:${id}`, rec || null)
    await idbDelete(`lib:${id}`)
  }
  library.files = library.files.filter((item) => item.id !== id)
  pruneSliceFile(id)
  touch(true)
}

export async function savedDirectories() {
  const keys = await idbKeys()
  const dirs = []
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith('dir:')) continue
    const handle = await idbGet(key)
    if (handle) dirs.push({ key, name: key.slice(4), handle })
  }
  return dirs
}

export async function rememberDirectory(handle) {
  const name = handle.name || 'Folder'
  await idbSet(`dir:${name}`, handle)
  return name
}

export async function forgetDirectory(key) {
  await idbDelete(key)
}

export async function readDirectoryFile(handle) {
  const file = await handle.getFile()
  return file
}

const previewCache = new Map()

export function cachedPreview(id) {
  return previewCache.get(id) || null
}

export function keepPreview(id, entry) {
  previewCache.set(id, entry)
  while (previewCache.size > 4) previewCache.delete(previewCache.keys().next().value)
}

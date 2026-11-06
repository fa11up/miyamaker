import { idbDelete, idbGet, idbKeys, idbSet, model, touch } from '../model.js'

export const MEDIA_RE = /\.(wav|mp3|m4a|aac|ogg|flac|aiff|aif|mp4|webm|mov|m4v)$/i

export function defaultLibrary() {
  return {
    folders: [
      { id: 'imports', parent: '', name: 'Imports' },
      { id: 'slices', parent: '', name: 'Slices' },
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
    if (!model.library.folders.some((item) => item.id === folder.id)) model.library.folders.unshift(folder)
  }
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
  library.files.push({ id, folder, name: name || 'sample', ext })
  await idbSet(`lib:${id}`, { pcm, sr, name: name || 'sample' })
  touch(true)
  return id
}

export function loadCached(id) {
  return idbGet(`lib:${id}`)
}

export async function removeCached(id) {
  const library = ensureLibrary()
  library.files = library.files.filter((file) => file.id !== id)
  await idbDelete(`lib:${id}`)
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

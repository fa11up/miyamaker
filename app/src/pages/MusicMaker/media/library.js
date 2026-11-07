import { stashUndo } from '../history.js'
import { idbDelete, idbGet, idbKeys, idbSet, model, plainText, touch } from '../model.js'

/** The library was missing or malformed and was reset: rebuildLibrary() puts the stored files back. */
let needsRebuild = false

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
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || !Array.isArray(raw.folders) || !Array.isArray(raw.files)) {
    model.library = defaultLibrary()
    needsRebuild = true
  }
  for (const folder of defaultLibrary().folders) {
    if (model.library.folders.some((item) => item.id === folder.id)) continue
    if (folder.id === 'songs' || folder.id === 'kits' || folder.id === 'templates') model.library.folders.push(folder)
    else model.library.folders.unshift(folder)
  }
  if (!Array.isArray(model.library.sliceSets)) model.library.sliceSets = []
  return model.library
}

export function libraryNeedsRebuild() {
  return needsRebuild
}

/**
 * The library index was reset: list every song, kit and sample still in IndexedDB again, so none are
 * orphaned. Rows that are already listed stay as they are. Resolves with how many came back.
 */
export async function rebuildLibrary({ force = false } = {}) {
  if (!needsRebuild && !force) return 0
  needsRebuild = false
  const library = ensureLibrary()
  const known = new Set(library.files.map((file) => file.id))
  const keys = await idbKeys()
  let added = 0
  for (const key of keys) {
    if (typeof key !== 'string') continue
    const match = /^(song|kit|lib):([a-z0-9]{1,40})$/i.exec(key)
    if (!match || known.has(match[2])) continue
    const [, kind, id] = match
    let rec = null
    try {
      rec = await idbGet(key)
    } catch {
      rec = null
    }
    if (!rec) continue
    if (kind === 'song') {
      if (rec.type !== 'm1ya') continue
      library.files.push({ id, folder: 'songs', name: plainText(rec.name, 48) || 'Song', ext: 'm1ya' })
    } else if (kind === 'kit') {
      library.files.push({ id, folder: 'kits', name: plainText(rec.name, 48) || 'Kit', ext: 'k1t' })
    } else {
      if (!rec.pcm) continue
      library.files.push({ id, folder: 'imports', name: plainText(rec.name, 80) || 'sample', ext: 'wav' })
    }
    known.add(id)
    added += 1
  }
  if (added) {
    model.browserNote = `The library list was lost. ${added} stored file${added > 1 ? 's are' : ' is'} back in Songs, Kits and Imports.`
    touch(true)
  }
  return added
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
  name = plainText(name, 80)
  // Storage first: a failed write must not leave a library row with no audio behind it.
  await idbSet(`lib:${id}`, { pcm, sr, name: name || 'sample' })
  stashUndo(`lib:${id}`, null)
  library.files.push({ id, folder, name: name || 'sample', ext })
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
    // The copy kept under a wallet goes too, or the next wallet read would bring the song back.
    for (const key of await idbKeys()) {
      if (typeof key !== 'string' || !key.startsWith('profile:') || !key.endsWith(`:${id}`)) continue
      const kept = await idbGet(key)
      stashUndo(key, kept || null)
      await idbDelete(key)
    }
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

/** Linked folders. Older ones were stored as the bare handle under dir:<name>; newer as { name, handle }. */
export async function savedDirectories() {
  const keys = await idbKeys()
  const dirs = []
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith('dir:')) continue
    const rec = await idbGet(key)
    if (!rec) continue
    const handle = rec.handle && typeof rec.handle === 'object' ? rec.handle : rec
    const name = plainText(rec.handle ? rec.name : handle.name, 80) || plainText(key.slice(4), 80) || 'Folder'
    dirs.push({ key, name, handle })
  }
  return dirs
}

/**
 * Link a folder. Each gets its own id, so two folders that share a name do not replace each other.
 * Linking the same folder again keeps the one entry.
 */
export async function rememberDirectory(handle) {
  const name = plainText(handle.name, 80) || 'Folder'
  for (const dir of await savedDirectories()) {
    try {
      if (dir.handle?.isSameEntry && (await dir.handle.isSameEntry(handle))) return name
    } catch {
      /* a handle that cannot be compared is treated as another folder */
    }
  }
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  await idbSet(`dir:${id}`, { name, handle })
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

import { applyDrafts, draftsFor } from './drafts'
import { fileWeight } from './publishedWeights'
import {
  ensureEmptyOptions,
  metaText,
  nameError,
  newId,
  orderLayers,
  parseMeta,
  parseTraitFile,
  placeKey,
  sidecarName,
  traitFileName,
  traitPath,
  type Layer,
  type StudioDoc,
  type Trait,
} from './model'
import { traitImage } from './remote'
import { unzip, zipStore, type ZipEntry } from './zip'

const SKIP = new Set([
  '.git',
  '.gitbook',
  'node_modules',
  'documentation',
  'src',
  'utils',
  'modules',
  'Tezos',
  'Solana',
  'ultraRares',
  '__MACOSX',
])

/** A zip of the whole engine will not fit in a tab. Open the layers folder for that. */
export const ZIP_LIMIT = 180 * 1024 * 1024

export type FolderLoad = {
  doc: StudioDoc
  dirs: Map<string, FileSystemDirectoryHandle>
}

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  if (!picker) throw new Error('This browser cannot open a folder. Import a zip instead.')
  return picker({ mode: 'readwrite' })
}

async function list(dir: FileSystemDirectoryHandle): Promise<{ name: string; handle: FileSystemHandle }[]> {
  const listing = dir as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }
  if (typeof listing.entries !== 'function') throw new Error('This browser cannot list a folder. Import a zip instead.')
  const out: { name: string; handle: FileSystemHandle }[] = []
  for await (const [name, handle] of listing.entries()) out.push({ name, handle })
  return out
}

function sidecarFromDisk(diskName: string): string {
  return diskName.replace(/\.(png|jpe?g|webp)$/i, '.meta.json')
}

export async function loadFolder(handle: FileSystemDirectoryHandle): Promise<FolderLoad> {
  const top = await list(handle)
  const nested = top.find((entry) => entry.handle.kind === 'directory' && entry.name === 'layers')
  const root = nested ? (nested.handle as FileSystemDirectoryHandle) : handle
  const rootName = nested ? `${handle.name}/layers` : handle.name
  const entries = nested ? await list(root) : top
  const dirs = new Map<string, FileSystemDirectoryHandle>()
  const traits: Trait[] = []
  const layerNames: string[] = []
  const metas = new Map<string, ReturnType<typeof parseMeta>>()

  async function walk(dir: FileSystemDirectoryHandle, layer: string, group: string) {
    dirs.set(placeKey(layer, group), dir)
    for (const child of await list(dir)) {
      if (child.name.startsWith('.') || SKIP.has(child.name)) continue
      if (child.handle.kind === 'directory') {
        const next = group ? `${group}/${child.name}` : child.name
        await walk(child.handle as FileSystemDirectoryHandle, layer, next)
        continue
      }
      const fileHandle = child.handle as FileSystemFileHandle
      if (child.name.endsWith('.meta.json')) {
        metas.set(`${placeKey(layer, group)}/${child.name}`, parseMeta(await (await fileHandle.getFile()).text()))
        continue
      }
      const parsed = parseTraitFile(child.name)
      if (!parsed || nameError(parsed.name)) continue
      traits.push({
        id: newId(),
        layer,
        group,
        name: parsed.name,
        weight: fileWeight(group ? `${layer}/${group}/${child.name}` : `${layer}/${child.name}`),
        notes: '',
        fields: [],
        hidden: false,
        dirty: false,
        diskName: child.name,
        file: await fileHandle.getFile(),
        draft: null,
        sourceUrl: null,
      })
    }
  }

  for (const entry of entries) {
    if (entry.handle.kind !== 'directory' || entry.name.startsWith('.') || SKIP.has(entry.name)) continue
    layerNames.push(entry.name)
    await walk(entry.handle as FileSystemDirectoryHandle, entry.name, '')
  }

  for (const trait of traits) {
    const meta = metas.get(`${placeKey(trait.layer, trait.group)}/${sidecarName(trait.name, trait.weight)}`)
    if (!meta) continue
    trait.notes = meta.notes
    trait.fields = meta.fields
  }

  const layers = orderLayers(layerNames)
  const doc: StudioDoc = { rootName, layers, traits: ensureEmptyOptions(layers, traits) }
  try {
    doc.traits = applyDrafts(doc.traits, await draftsFor(rootName))
  } catch {
    // A draft store that fails still leaves the folder readable.
  }
  return { doc, dirs }
}

export async function writeTrait(dir: FileSystemDirectoryHandle, trait: Trait, png: Blob): Promise<string> {
  const next = traitFileName(trait.name, trait.weight)
  const side = sidecarName(trait.name, trait.weight)
  if (trait.diskName && trait.diskName !== next) {
    await dir.removeEntry(trait.diskName).catch(() => undefined)
    const previousSide = sidecarFromDisk(trait.diskName)
    if (previousSide !== side) await dir.removeEntry(previousSide).catch(() => undefined)
  }
  const pngHandle = await dir.getFileHandle(next, { create: true })
  const pngOut = await pngHandle.createWritable()
  await pngOut.write(png)
  await pngOut.close()
  const metaHandle = await dir.getFileHandle(side, { create: true })
  const metaOut = await metaHandle.createWritable()
  await metaOut.write(metaText(trait))
  await metaOut.close()
  return next
}

export async function docFromZip(bytes: Uint8Array, rootName: string): Promise<StudioDoc> {
  const entries = await unzip(bytes)
  const traits: Trait[] = []
  const layers = new Set<string>()
  const metas = new Map<string, ReturnType<typeof parseMeta>>()
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean)
    const marker = parts.lastIndexOf('layers')
    const rest = marker >= 0 ? parts.slice(marker + 1) : parts
    if (rest.length < 2) continue
    const layer = rest[0]
    const file = rest[rest.length - 1]
    if (!layer || !file) continue
    const group = rest.slice(1, -1).join('/')
    if (file.endsWith('.meta.json')) {
      layers.add(layer)
      metas.set(`${placeKey(layer, group)}/${file}`, parseMeta(new TextDecoder().decode(entry.data)))
      continue
    }
    const parsed = parseTraitFile(file)
    if (!parsed || nameError(parsed.name)) continue
    layers.add(layer)
    traits.push({
      id: newId(),
      layer,
      group,
      name: parsed.name,
      weight: fileWeight(group ? `${layer}/${group}/${file}` : `${layer}/${file}`),
      notes: '',
      fields: [],
      hidden: false,
      dirty: false,
      diskName: file,
      file: null,
      draft: new Blob([Uint8Array.from(entry.data)], { type: 'image/png' }),
      sourceUrl: null,
    })
  }
  for (const trait of traits) {
    const meta = metas.get(`${placeKey(trait.layer, trait.group)}/${sidecarName(trait.name, trait.weight)}`)
    if (!meta) continue
    trait.notes = meta.notes
    trait.fields = meta.fields
  }
  const ordered = orderLayers([...layers])
  return { rootName, layers: ordered, traits: ensureEmptyOptions(ordered, traits) }
}

export async function docToZip(doc: StudioDoc): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const files: ZipEntry[] = []
  let total = 0
  for (const trait of doc.traits) {
    const blob = await traitImage(trait)
    if (!blob) continue
    total += blob.size
    if (total > ZIP_LIMIT) {
      throw new Error('This set is too large to zip in the browser. Save writes into the folder instead.')
    }
    const path = traitPath(trait)
    files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) })
    files.push({ name: path.replace(/\.png$/i, '.meta.json'), data: encoder.encode(metaText(trait)) })
  }
  if (!files.length) throw new Error('There is nothing to export yet.')
  return zipStore(files)
}

export function firstWorn(layers: readonly Layer[], traits: readonly Trait[]): Record<string, string> {
  const worn: Record<string, string> = {}
  for (const layer of layers) {
    const inLayer = traits.filter((item) => item.layer === layer.id && !item.hidden)
    const trait = inLayer.find((item) => !/^z-\d+,/i.test(item.name)) ?? inLayer[0]
    if (trait) worn[layer.id] = trait.id
  }
  return worn
}

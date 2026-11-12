import { parseLayerIndex } from './catalog'
import { applyDrafts, draftsFor } from './drafts'
import { ensureEmptyOptions, nameError, newId, orderLayers, parseTraitFile, type StudioDoc, type Trait } from './model'
import { fileWeight } from './publishedWeights'

/** Same-origin path. Keep it the same as LAYERS_PROXY_PATH in api/_lib/layers.ts. */
export const LAYER_PROXY = '/miyamaker-layers'

export const PUBLISHED_ROOT = 'koolskull.com/miyamaker/layers'

function indexUrl(dirPath: string): string {
  const parts = dirPath.split('/').filter(Boolean).map((part) => encodeURIComponent(part))
  return `${LAYER_PROXY}/${parts.join('/')}${parts.length ? '/' : ''}`
}

function fileUrl(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean).map((part) => encodeURIComponent(part))
  return `${LAYER_PROXY}/${parts.join('/')}`
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not read the published layers.')
  return response.text()
}

function traitFromFile(relativePath: string): Trait | null {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const layer = parts[0]
  const name = parts[parts.length - 1]
  if (!layer || !name) return null
  const parsed = parseTraitFile(name)
  if (!parsed || nameError(parsed.name)) return null
  return {
    id: newId(),
    layer,
    group: parts.slice(1, -1).join('/'),
    name: parsed.name,
    weight: fileWeight(relativePath),
    notes: '',
    fields: [],
    hidden: false,
    dirty: false,
    diskName: name,
    file: null,
    draft: null,
    sourceUrl: fileUrl(relativePath),
  }
}

async function walk(dirPath: string): Promise<Trait[]> {
  const entries = parseLayerIndex(await fetchText(indexUrl(dirPath)), dirPath)
  const nested = await Promise.all(entries.filter((entry) => entry.kind === 'dir').map((entry) => walk(entry.path)))
  const traits: Trait[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file') continue
    const trait = traitFromFile(entry.path)
    if (trait) traits.push(trait)
  }
  return [...nested.flat(), ...traits]
}

/** Read the folder listing. Picture bytes wait until a trait is shown. */
export async function loadPublishedLayers(): Promise<StudioDoc> {
  const listed = await walk('')
  const layers = orderLayers([...new Set(listed.map((trait) => trait.layer))])
  const doc: StudioDoc = {
    rootName: PUBLISHED_ROOT,
    layers,
    traits: ensureEmptyOptions(layers, listed),
  }
  try {
    doc.traits = applyDrafts(doc.traits, await draftsFor(doc.rootName))
  } catch {
    // A draft store that fails still leaves the published pictures readable.
  }
  return doc
}

/**
 * `now` is the trait on the canvas. `soon` is the wearing preview.
 * `later` is a sidebar thumbnail. The published files are often 4000px,
 * so background reads stay one at a time and never cut ahead of the canvas.
 */
export type LayerPriority = 'now' | 'soon' | 'later'

const LRU_MAX = 24
const blobs = new Map<string, Blob>()
const inflight = new Map<string, Promise<Blob>>()
let urgent = 0
let background = 0
const waiters: { rank: number; start: () => void }[] = []

function remember(url: string, blob: Blob) {
  blobs.delete(url)
  blobs.set(url, blob)
  while (blobs.size > LRU_MAX) {
    const oldest = blobs.keys().next().value
    if (oldest === undefined) break
    blobs.delete(oldest)
  }
}

function download(url: string): Promise<Blob> {
  const cached = blobs.get(url)
  if (cached) {
    remember(url, cached)
    return Promise.resolve(cached)
  }
  const pending = inflight.get(url)
  if (pending) return pending
  const promise = fetch(url).then((response) => {
    if (!response.ok) throw new Error('Could not download that picture.')
    return response.blob()
  })
  inflight.set(url, promise)
  promise.then(
    (blob) => {
      inflight.delete(url)
      remember(url, blob)
    },
    () => {
      inflight.delete(url)
    },
  )
  return promise
}

function pump() {
  if (urgent > 0 || background > 0) return
  waiters.sort((a, b) => a.rank - b.rank)
  const next = waiters.shift()
  if (!next) return
  background += 1
  next.start()
}

export function fetchLayerBlob(url: string, priority: LayerPriority = 'now', signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(new DOMException('The download was cancelled.', 'AbortError'))
  if (priority === 'now') {
    urgent += 1
    return download(url).finally(() => {
      urgent -= 1
      pump()
    })
  }
  const rank = priority === 'soon' ? 0 : 1
  return new Promise((resolve, reject) => {
    const entry = {
      rank,
      start() {
        if (signal?.aborted) {
          background -= 1
          reject(new DOMException('The download was cancelled.', 'AbortError'))
          pump()
          return
        }
        download(url).then(resolve, reject).finally(() => {
          background -= 1
          pump()
        })
      },
    }
    signal?.addEventListener(
      'abort',
      () => {
        const index = waiters.indexOf(entry)
        if (index < 0) return
        waiters.splice(index, 1)
        reject(new DOMException('The download was cancelled.', 'AbortError'))
      },
      { once: true },
    )
    waiters.push(entry)
    pump()
  })
}

/** The picture to paint: a local edit, the file from disk, or the published URL. */
export async function traitImage(
  trait: Pick<Trait, 'draft' | 'file' | 'sourceUrl'>,
  priority: LayerPriority = 'now',
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (trait.draft && trait.draft.size > 0) return trait.draft
  if (trait.file && trait.file.size > 0) return trait.file
  if (!trait.sourceUrl) return null
  return fetchLayerBlob(trait.sourceUrl, priority, signal)
}

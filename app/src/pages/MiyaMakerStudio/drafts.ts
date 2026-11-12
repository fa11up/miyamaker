import type { Trait, TraitField } from './model'

const DB = 'miyamaker-studio'
const LEGACY_DB = 'miya-trait-studio'
const STORE = 'drafts'

export type DraftRow = {
  root: string
  layer: string
  group: string
  diskName: string | null
  id: string
  name: string
  weight: number
  notes: string
  fields: TraitField[]
  png: Blob
  updated: number
}

function draftKey(row: Pick<DraftRow, 'root' | 'layer' | 'group' | 'diskName' | 'id'>): string {
  return [row.root, row.layer, row.group, row.diskName ?? `new:${row.id}`].join('\0')
}

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open drafts.'))
  })
}

let migrated: Promise<void> | null = null

/** One copy from the previous draft store, then that store is removed. */
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  const count = await new Promise<number>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not read drafts.'))
  })
  if (count > 0 || typeof indexedDB.databases !== 'function') return
  const known = await indexedDB.databases()
  if (!known.some((entry) => entry.name === LEGACY_DB)) return
  const legacy = await openNamed(LEGACY_DB)
  try {
    if (!legacy.objectStoreNames.contains(STORE)) return
    const rows = await new Promise<DraftRow[]>((resolve, reject) => {
      const request = legacy.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as DraftRow[])
      request.onerror = () => reject(request.error ?? new Error('Could not read drafts.'))
    })
    if (rows.length === 0) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const row of rows) store.put(row, draftKey(row))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not keep the draft.'))
    })
  } finally {
    legacy.close()
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

function openDb(): Promise<IDBDatabase> {
  const opening = openNamed(DB)
  if (!migrated) migrated = opening.then((db) => migrateLegacy(db)).catch(() => undefined)
  return Promise.all([opening, migrated]).then(([db]) => db)
}

export async function rememberDraft(root: string, trait: Trait): Promise<void> {
  const row: DraftRow = {
    root,
    layer: trait.layer,
    group: trait.group,
    diskName: trait.diskName,
    id: trait.id,
    name: trait.name,
    weight: trait.weight,
    notes: trait.notes,
    fields: trait.fields,
    png: trait.draft ?? trait.file ?? new Blob(),
    updated: Date.now(),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(row, draftKey(row))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not keep the draft.'))
  })
  db.close()
}

export async function forgetDraft(root: string, trait: Pick<Trait, 'layer' | 'group' | 'diskName' | 'id'>): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(draftKey({ root, ...trait }))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not drop the draft.'))
  })
  db.close()
}

export async function draftsFor(root: string): Promise<DraftRow[]> {
  const db = await openDb()
  const rows = await new Promise<DraftRow[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).getAll()
    request.onsuccess = () => resolve((request.result as DraftRow[]).filter((row) => row.root === root))
    request.onerror = () => reject(request.error ?? new Error('Could not read drafts.'))
  })
  db.close()
  return rows
}

export function applyDrafts(traits: Trait[], drafts: readonly DraftRow[]): Trait[] {
  const next = traits.map((trait) => ({ ...trait, fields: trait.fields.map((field) => ({ ...field })) }))
  for (const draft of drafts) {
    const match = draft.diskName
      ? next.find((trait) => trait.layer === draft.layer && trait.group === draft.group && trait.diskName === draft.diskName)
      : next.find((trait) => trait.id === draft.id)
    if (match) {
      match.name = draft.name
      match.weight = draft.weight
      match.notes = draft.notes
      match.fields = draft.fields.map((field) => ({ ...field }))
      if (draft.png.size > 0) match.draft = draft.png
      match.dirty = true
      continue
    }
    if (draft.diskName) continue
    next.push({
      id: draft.id,
      layer: draft.layer,
      group: draft.group,
      name: draft.name,
      weight: draft.weight,
      notes: draft.notes,
      fields: draft.fields.map((field) => ({ ...field })),
      hidden: false,
      dirty: true,
      diskName: null,
      file: null,
      draft: draft.png.size > 0 ? draft.png : null,
      sourceUrl: null,
    })
  }
  return next
}

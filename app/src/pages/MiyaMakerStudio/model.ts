/**
 * Trait files follow the HashLips art engine: `Name#weight.png` in a layer folder.
 * The number is a weight, not a percent. Notes live in a sidecar the generator does not read.
 */

export const CANVAS = 1024
export const DEFAULT_WEIGHT = 20
/** Starting weight of a layer's blank. Higher means the layer is left out more often. */
export const EMPTY_WEIGHT = 20

/**
 * Back to front, matching the z-index on https://koolskull.com/miyamaker/
 * (BG 10 … Hat 100). Unknown names sort after these.
 */
export const LAYER_ORDER = [
  'BG',
  'Background',
  'Top Behind',
  'Hat Behind',
  'Hair Behind',
  'Body',
  'Mouth',
  'Mouths',
  'Top',
  'Nose',
  'Noses',
  'Eyes',
  'Mask',
  'Hair',
  'Hair Front',
  'Earrings',
  'Hat',
  'Hand',
  'Left Arm',
  'Right Arm',
  'Overlay',
  'Overlay 2',
  'Overlay 3',
] as const

export const EMPTY_LAYERS = ['BG', 'Body', 'Eyes', 'Mouth', 'Nose', 'Top', 'Hair', 'z-1,Hair', 'Mask', 'Hat', 'Left Arm', 'Right Arm']

const RANK = new Map<string, number>(LAYER_ORDER.map((name, index) => [name.toLowerCase(), index]))

export type TraitField = { key: string; value: string }

export type Trait = {
  id: string
  layer: string
  /** Path under the layer folder. Empty when the file sits in the layer itself. */
  group: string
  name: string
  weight: number
  notes: string
  fields: TraitField[]
  hidden: boolean
  dirty: boolean
  /** `Name#weight.png` last written, so a rename can remove it. */
  diskName: string | null
  file: File | null
  draft: Blob | null
  /** Same-origin URL of a published picture. Empty for a trait made in the browser. */
  sourceUrl: string | null
}

export type Layer = { id: string; name: string; order: number }

export type StudioDoc = {
  rootName: string
  layers: Layer[]
  traits: Trait[]
}

const IMAGE = /\.(png|jpe?g|webp)$/i

export function layerRank(name: string): number {
  return RANK.get(name.toLowerCase()) ?? 1000
}

export function orderLayers(names: readonly string[]): Layer[] {
  const unique = [...new Set(names)]
  unique.sort((a, b) => layerRank(a) - layerRank(b) || a.localeCompare(b))
  return unique.map((name, order) => ({ id: name, name, order }))
}

/** Left list. Front of the stack at the top, background at the bottom. Paint order stays in `orderLayers`. */
export function sidebarLayers(layers: readonly Layer[]): Layer[] {
  return [...layers].reverse()
}

/** `Miyamaker Cap#20.png` → name and weight. A picture with no # imports at weight 1. */
export function parseTraitFile(filename: string): { name: string; weight: number } | null {
  const base = filename.split(/[/\\]/).pop() ?? filename
  if (base.startsWith('.') || !IMAGE.test(base)) return null
  const stem = base.replace(/\.[^.]+$/, '')
  const hash = stem.lastIndexOf('#')
  if (hash <= 0) return stem ? { name: stem, weight: 1 } : null
  const name = stem.slice(0, hash).trim()
  const raw = stem.slice(hash + 1).trim()
  const weight = Number(raw)
  if (!name) return null
  if (!raw || !Number.isFinite(weight) || weight < 0) return { name: stem, weight: 1 }
  return { name, weight }
}

export function formatWeight(weight: number): string {
  if (!Number.isFinite(weight) || weight < 0) return '1'
  if (Number.isInteger(weight)) return String(weight)
  return String(Math.round(weight * 1000) / 1000)
}

export function traitFileName(name: string, weight: number): string {
  return `${name}#${formatWeight(weight)}.png`
}

export function sidecarName(name: string, weight: number): string {
  return `${name}#${formatWeight(weight)}.meta.json`
}

/** What save will write, including a nested group folder. */
export function traitPath(trait: Pick<Trait, 'layer' | 'group' | 'name' | 'weight'>): string {
  const file = traitFileName(trait.name, trait.weight)
  return trait.group ? `${trait.layer}/${trait.group}/${file}` : `${trait.layer}/${file}`
}

export function nameError(name: string): string | null {
  if (!name.trim()) return 'A trait needs a name.'
  if (name !== name.trim()) return 'The name cannot start or end with a space.'
  if (/[#/\\]/.test(name)) return 'The name cannot contain # or a slash.'
  return null
}

export function traitClash(traits: readonly Trait[], trait: Pick<Trait, 'id' | 'layer' | 'group' | 'name' | 'weight'>): boolean {
  const file = traitFileName(trait.name, trait.weight)
  return traits.some(
    (other) =>
      other.id !== trait.id && other.layer === trait.layer && other.group === trait.group && traitFileName(other.name, other.weight) === file
  )
}

export function freshName(traits: readonly Trait[], layer: string): string {
  const used = new Set(traits.filter((trait) => trait.layer === layer && trait.group === '').map((trait) => traitFileName(trait.name, trait.weight)))
  if (!used.has(traitFileName('New trait', DEFAULT_WEIGHT))) return 'New trait'
  for (let n = 2; n < 1000; n += 1) {
    const name = `New trait ${n}`
    if (!used.has(traitFileName(name, DEFAULT_WEIGHT))) return name
  }
  return `New trait ${Date.now()}`
}

export function parseMeta(text: string): { notes: string; fields: TraitField[] } {
  try {
    const raw = JSON.parse(text) as { notes?: unknown; fields?: unknown }
    const notes = typeof raw.notes === 'string' ? raw.notes : ''
    const fields = Array.isArray(raw.fields)
      ? raw.fields.flatMap((row) => {
          if (!row || typeof row !== 'object') return []
          const key = 'key' in row && typeof row.key === 'string' ? row.key : ''
          const value = 'value' in row && typeof row.value === 'string' ? row.value : ''
          return key || value ? [{ key, value }] : []
        })
      : []
    return { notes, fields }
  } catch {
    return { notes: '', fields: [] }
  }
}

export function metaText(trait: Pick<Trait, 'notes' | 'fields'>): string {
  return `${JSON.stringify({ notes: trait.notes, fields: trait.fields.filter((field) => field.key || field.value) }, null, 2)}\n`
}

/** Nearest-neighbor placement of a source image on the 1024 plate. */
export function letterbox(srcW: number, srcH: number, dst = CANVAS): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dst, h: dst }
  const scale = Math.min(dst / srcW, dst / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { x: Math.floor((dst - w) / 2), y: Math.floor((dst - h) / 2), w, h }
}

const Z_PIECE = /^z-(\d+),/i

/** Same numbers as the img z-index on koolskull.com/miyamaker. Higher paints in front. */
const STACK_Z: Record<string, number> = {
  bg: 10,
  background: 10,
  'top behind': 20,
  'hat behind': 25,
  'hair behind': 30,
  body: 40,
  mouth: 50,
  mouths: 50,
  top: 50,
  nose: 60,
  noses: 60,
  eyes: 70,
  mask: 80,
  hair: 90,
  'hair front': 90,
  earrings: 92,
  hat: 100,
  hand: 110,
  'left arm': 112,
  'right arm': 114,
  overlay: 120,
  'overlay 2': 122,
  'overlay 3': 124,
}

/** `z-3,` files are the Behind slots on the site: top 20, hat 25, hair 30. */
const BEHIND_Z: Record<string, number> = {
  top: 20,
  hat: 25,
  hair: 30,
}

/** Back pieces sit in that layer's Behind slot. Everything else uses the layer z-index. */
export function paintOrder(trait: Pick<Trait, 'name' | 'layer'>, layers: readonly Layer[]): number {
  const key = trait.layer.toLowerCase()
  if (Z_PIECE.test(trait.name)) return BEHIND_Z[key] ?? 15
  const stacked = STACK_Z[key]
  if (stacked !== undefined) return stacked
  const layer = layers.find((item) => item.id === trait.layer)
  return ((layer?.order ?? 1000) + 1) * 10
}

function wornPieces(traits: readonly Trait[], trait: Trait): Trait[] {
  const folder = traits.filter((item) => item.layer === trait.layer && item.group === trait.group && trait.group !== '' && !item.hidden)
  const own = folder.some((item) => Z_PIECE.test(item.name)) ? folder : [trait]
  const slash = trait.group.lastIndexOf('/')
  if (slash <= 0) return own
  const parent = trait.group.slice(0, slash)
  const parentFiles = traits.filter((item) => item.layer === trait.layer && item.group === parent && !item.hidden && !Z_PIECE.test(item.name))
  if (parentFiles.length === 0 || parentFiles.length > 4) return own
  const parentBack = traits.filter((item) => item.layer === trait.layer && item.group === parent && !item.hidden && Z_PIECE.test(item.name))
  return [...parentFiles, ...parentBack, ...own]
}

/** HashLips `NONE`: a weighted blank. Winning this roll leaves the layer out of the picture. */
export function isEmptyOption(trait: Pick<Trait, 'name'>): boolean {
  return /^none$/i.test(trait.name.trim())
}

export function emptyOptionId(layer: string): string {
  return `blank:${layer}`
}

/** One blank per layer that does not already have one, so every layer can roll as absent. */
export function ensureEmptyOptions(layers: readonly Layer[], traits: readonly Trait[]): Trait[] {
  const next = traits.slice()
  for (const layer of layers) {
    if (next.some((trait) => trait.layer === layer.id && isEmptyOption(trait))) continue
    next.push({
      id: emptyOptionId(layer.id),
      layer: layer.id,
      group: '',
      name: 'NONE',
      weight: EMPTY_WEIGHT,
      notes: '',
      fields: [],
      hidden: false,
      dirty: false,
      diskName: null,
      file: null,
      draft: null,
      sourceUrl: null,
    })
  }
  return next
}

export function previewStack(layers: readonly Layer[], traits: readonly Trait[], worn: Readonly<Record<string, string>>): Trait[] {
  const byId = new Map(traits.map((trait) => [trait.id, trait]))
  const seen = new Set<string>()
  const out: Trait[] = []
  for (const layer of layers) {
    const trait = byId.get(worn[layer.id] ?? '')
    if (!trait || trait.hidden || trait.layer !== layer.id || isEmptyOption(trait)) continue
    for (const piece of wornPieces(traits, trait)) {
      if (seen.has(piece.id)) continue
      seen.add(piece.id)
      out.push(piece)
    }
  }
  out.sort((a, b) => paintOrder(a, layers) - paintOrder(b, layers) || a.name.localeCompare(b.name))
  return out
}

/** The worn stack with the trait on the canvas taken out, so the rest can sit behind and in front. */
export function aroundActive(stack: readonly Trait[], activeId: string | null): { behind: Trait[]; ahead: Trait[] } {
  const index = stack.findIndex((trait) => trait.id === activeId)
  if (index < 0) return { behind: [...stack], ahead: [] }
  return { behind: stack.slice(0, index), ahead: stack.slice(index + 1) }
}

export function byTraitName(a: Pick<Trait, 'id' | 'name' | 'group'>, b: Pick<Trait, 'id' | 'name' | 'group'>): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id)
}

/** Visible traits in one layer, A to Z. Back pieces stay in the list so they can be opened. */
export function traitsInOrder(traits: readonly Trait[], layer: string): Trait[] {
  return traits.filter((trait) => trait.layer === layer && !trait.hidden).slice().sort(byTraitName)
}

export function cycleTrait(traits: readonly Trait[], layer: string, currentId: string | null, direction: -1 | 1): Trait | null {
  const rows = traitsInOrder(traits, layer)
  if (!rows.length) return null
  const index = rows.findIndex((trait) => trait.id === currentId)
  const next = index < 0 ? (direction > 0 ? 0 : rows.length - 1) : (index + direction + rows.length) % rows.length
  return rows[next] ?? null
}

function weightedPick<T extends { weight: number }>(pool: readonly T[], random: () => number): T | undefined {
  if (!pool.length) return undefined
  const total = pool.reduce((sum, item) => sum + Math.max(0, item.weight), 0)
  if (total <= 0) return pool[0]
  let cursor = random() * total
  for (const item of pool) {
    cursor -= Math.max(0, item.weight)
    if (cursor < 0) return item
  }
  return pool[pool.length - 1]
}

/** One trait per layer. A back piece is worn only when the layer has nothing else. */
export function randomWorn(layers: readonly Layer[], traits: readonly Trait[], random: () => number = Math.random): Record<string, string> {
  const worn: Record<string, string> = {}
  for (const layer of layers) {
    const inLayer = traits.filter((trait) => trait.layer === layer.id && !trait.hidden)
    const mains = inLayer.filter((trait) => !Z_PIECE.test(trait.name))
    const pick = weightedPick(mains.length ? mains : inLayer, random)
    if (pick) worn[layer.id] = pick.id
  }
  return worn
}

export function placeKey(layer: string, group: string): string {
  return group ? `${layer}/${group}` : layer
}

export function blankTrait(layer: string, traits: readonly Trait[]): Trait {
  return {
    id: newId(),
    layer,
    group: '',
    name: freshName(traits, layer),
    weight: DEFAULT_WEIGHT,
    notes: '',
    fields: [],
    hidden: false,
    dirty: true,
    diskName: null,
    file: null,
    draft: null,
    sourceUrl: null,
  }
}

export function newId(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && 'randomUUID' in cryptoRef) return cryptoRef.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

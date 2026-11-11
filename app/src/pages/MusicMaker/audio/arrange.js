/** Song-arranger launch rules and the automation stored on a pattern. No model or engine imports. */

const SONG = [
  { id: 'bpm', label: 'BPM', min: 40, max: 240, step: 1 },
  { id: 'swing', label: 'Swing', min: 0, max: 0.6, step: 0.01 },
  { id: 'master', label: 'Master', min: 0, max: 1, step: 0.01 },
]

const PAD_PARAMS = [
  ['volume', 'Volume', 0, 1, 0.01],
  ['pan', 'Pan', -1, 1, 0.01],
  ['pitch', 'Pitch', -48, 48, 1],
  ['fine', 'Fine', -100, 100, 1],
  ['cutoff', 'Cutoff', 40, 18000, 1],
  ['q', 'Reso', 0.1, 18, 0.01],
  ['drive', 'Drive', 0, 1, 0.01],
  ['crush', 'Crush', 0, 1, 0.01],
  ['amp', 'Amp', 0, 1, 0.01],
  ['tone', 'Tone', 0, 1, 0.01],
  ['reverb', 'Reverb', 0, 1, 0.01],
  ['width', 'Width', 0, 1, 0.01],
  ['chorus', 'Chorus', 0, 1, 0.01],
]

function param(id, label, min, max, step) {
  return { id, label, min, max, step }
}

function buildGroups() {
  const groups = [{ id: 'song', label: 'Song', params: SONG.map((row) => param(row.id, row.label, row.min, row.max, row.step)) }]
  for (let i = 0; i < 16; i++) {
    const params = [
      param(`bus:${i}:volume`, 'Volume', 0, 1, 0.01),
      param(`bus:${i}:pan`, 'Pan', -1, 1, 0.01),
    ]
    for (let slot = 0; slot < 5; slot++) params.push(param(`bus:${i}:fx${slot}`, `FX ${slot + 1}`, 0, 1, 0.01))
    groups.push({ id: `bus${i}`, label: `Bus ${String(i + 1).padStart(2, '0')}`, params })
  }
  for (let i = 0; i < 64; i++) {
    const bank = 'ABCD'[i >> 4] || 'A'
    const params = PAD_PARAMS.map(([key, label, min, max, step]) => param(`pad:${i}:${key}`, label, min, max, step))
    groups.push({ id: `pad${i}`, label: `${bank}${(i % 16) + 1}`, params })
  }
  return groups
}

export const AUTO_GROUPS = buildGroups()

const AUTO_BY_ID = new Map()
for (const group of AUTO_GROUPS) {
  for (const row of group.params) AUTO_BY_ID.set(row.id, { ...row, group: group.label })
}

export function autoTarget(id) {
  return AUTO_BY_ID.get(id) || null
}

export function autoLabel(id) {
  const row = autoTarget(id)
  return row ? `${row.group} ${row.label}` : ''
}

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

/** Last point at or before this step. Null when the lane has not started yet. */
export function valueAt(points, step) {
  if (!Array.isArray(points) || !points.length) return null
  const at = step | 0
  let found = null
  for (const point of points) {
    if (!point || !Number.isFinite(point.s) || !Number.isFinite(point.v)) continue
    if (point.s <= at) found = point.v
    else break
  }
  return found
}

/** Keep known lanes, clamp values, and drop repeated steps. An empty lane stays so it can be named before the first point. */
export function normalizeAuto(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const lane of raw) {
    if (!lane || typeof lane !== 'object' || seen.has(lane.id)) continue
    const spec = autoTarget(lane.id)
    if (!spec) continue
    seen.add(lane.id)
    const byStep = new Map()
    const list = Array.isArray(lane.points) ? lane.points : []
    for (const point of list) {
      if (!point || !Number.isFinite(Number(point.s)) || !Number.isFinite(Number(point.v))) continue
      const s = Math.max(0, Math.min(255, point.s | 0))
      byStep.set(s, clamp(point.v, spec.min, spec.max))
    }
    const points = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => ({ s, v }))
    out.push({ id: spec.id, points })
  }
  return out.slice(0, 64)
}

export function normalizeLaunch(mode) {
  if (mode === 'now' || mode === 'grid') return mode
  return 'end'
}

/**
 * What a queued cell does at this step.
 * now: switch immediately and start at step 0.
 * end: switch only when the current part wraps, then start at 0.
 * grid: switch immediately and stay on the same step of the BPM grid.
 */
export function launchStep({ mode, queued, atWrap, step, nextLength }) {
  const m = normalizeLaunch(mode)
  const at = step | 0
  if (!queued && atWrap) return { take: false, advance: true, step: 0 }
  if (!queued) return { take: false, advance: false, step: at }
  if (m === 'end' && !atWrap) return { take: false, advance: false, step: at }
  const n = Math.max(1, nextLength | 0)
  if (m === 'grid' && !atWrap) return { take: true, advance: false, step: ((at % n) + n) % n }
  return { take: true, advance: false, step: 0 }
}

function changed(prev, next) {
  if (prev === next) return false
  return !(typeof prev === 'number' && typeof next === 'number' && Math.abs(prev - next) < 1e-6)
}

function put(obj, key, value) {
  if (!obj || !changed(obj[key], value)) return false
  obj[key] = value
  return true
}

/** Write one automated value onto the live song. True when the mixer faders must follow. */
export function writeAuto(model, id, value) {
  const spec = autoTarget(id)
  if (!spec || !model) return false
  const v = clamp(value, spec.min, spec.max)
  if (id === 'bpm') {
    model.bpm = Math.round(v)
    return false
  }
  if (id === 'swing') {
    model.swing = v
    return false
  }
  if (id === 'master') return put(model, 'master', v)
  const bus = /^bus:(\d+):(volume|pan|fx[0-4])$/.exec(id)
  if (bus) {
    const row = model.buses?.[Number(bus[1])]
    if (!row) return false
    if (bus[2] === 'volume' || bus[2] === 'pan') return put(row, bus[2], v)
    const slot = row.fx?.[Number(bus[2].slice(2))]
    return put(slot, 'amount', v)
  }
  const pad = /^pad:(\d+):([a-z]+)$/.exec(id)
  if (!pad) return false
  const row = model.pads?.[Number(pad[1])]
  if (!row) return false
  const key = pad[2]
  if (key === 'cutoff') put(row.filter, 'cutoff', v)
  else if (key === 'q') put(row.filter, 'q', v)
  else if (key === 'drive' || key === 'crush' || key === 'amp' || key === 'tone' || key === 'reverb' || key === 'width' || key === 'chorus') put(row.fx, key, v)
  else if (key === 'volume' || key === 'pan' || key === 'pitch' || key === 'fine') put(row, key, key === 'pitch' || key === 'fine' ? Math.round(v) : v)
  return false
}

/** Tempo for this step: a BPM lane, then the pattern tempo, then the song tempo. */
export function clockBpm(model, seq, step) {
  const lane = Array.isArray(seq?.auto) ? seq.auto.find((item) => item.id === 'bpm') : null
  const auto = lane ? valueAt(lane.points, step) : null
  if (auto != null) return auto
  if (Number.isFinite(seq?.bpm)) return clamp(seq.bpm, 40, 240)
  const bpm = Number(model?.bpm)
  return Number.isFinite(bpm) ? bpm : 96
}

/** Apply every lane that has started by this step. True when the mixer should update. */
export function applyAutoStep(model, seq, step) {
  const lanes = Array.isArray(seq?.auto) ? seq.auto : []
  let mix = false
  for (const lane of lanes) {
    const value = valueAt(lane.points, step)
    if (value == null) continue
    if (writeAuto(model, lane.id, value)) mix = true
  }
  return mix
}

/**
 * miya radio's 10-band graphic equalizer: band layout, presets and the state helpers the RadioProvider
 * and the EQ panel share. Pure (no DOM/WebAudio) so `node --test` can run it (tests/radio-eq.test.mts).
 */

/** Centre frequencies (Hz) of the ten peaking filters, low to high. */
export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const

/** Gain range for the preamp and every band, in dB. */
export const EQ_MIN_DB = -12
export const EQ_MAX_DB = 12

export type EqState = {
  enabled: boolean
  /** Preamp gain in dB. */
  preamp: number
  /** One gain per EQ_BANDS entry, in dB. */
  bands: number[]
}

export type EqPreset = { id: string; label: string; preamp: number; bands: number[] }

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'flat', label: 'Flat', preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'club', label: 'Y2K club', preamp: -2, bands: [6, 5, 3, 0, -1, 1, 3, 4, 4, 3] },
  { id: 'bass', label: 'Subwoofer heart', preamp: -4, bands: [9, 7, 5, 2, 0, -1, -2, -2, -2, -2] },
  { id: 'vocal', label: 'Angel vocals', preamp: -1, bands: [-3, -2, 0, 3, 5, 5, 3, 1, 0, -1] },
  { id: 'air', label: 'Sparkle', preamp: -2, bands: [-1, -1, 0, 0, 1, 3, 5, 7, 7, 8] },
  { id: 'lofi', label: 'Dial-up lo-fi', preamp: 0, bands: [-8, -4, 2, 5, 6, 4, -2, -8, -10, -12] },
]

export const clampDb = (v: number) =>
  Number.isFinite(v) ? Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(v * 2) / 2)) : 0

export const defaultEq = (): EqState => ({ enabled: true, preamp: 0, bands: EQ_BANDS.map(() => 0) })

/** Validates a stored/foreign value into a usable EqState (falls back to flat). */
export function sanitizeEq(value: unknown): EqState {
  const base = defaultEq()
  if (!value || typeof value !== 'object') return base
  const v = value as Partial<EqState>
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
    preamp: typeof v.preamp === 'number' ? clampDb(v.preamp) : 0,
    bands: EQ_BANDS.map((_, i) => {
      const b = Array.isArray(v.bands) ? v.bands[i] : 0
      return typeof b === 'number' ? clampDb(b) : 0
    }),
  }
}

export const clampBalance = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)

/** The gains to apply to the audio graph: everything 0 dB while the EQ is switched off. */
export function effectiveGains(eq: EqState): { preamp: number; bands: number[] } {
  if (!eq.enabled) return { preamp: 0, bands: EQ_BANDS.map(() => 0) }
  return { preamp: eq.preamp, bands: eq.bands.slice(0, EQ_BANDS.length) }
}

/** dB → linear gain for the preamp GainNode. */
export const dbToGain = (db: number) => 10 ** (db / 20)

/** The preset whose values match the state exactly, if any. */
export function matchPreset(eq: EqState): EqPreset | undefined {
  return EQ_PRESETS.find((p) => p.preamp === eq.preamp && p.bands.every((b, i) => b === eq.bands[i]))
}

/** Short band label: 60, 170, 1K, 12K… */
export const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}K` : String(hz))

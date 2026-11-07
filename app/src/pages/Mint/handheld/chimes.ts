/** The opening's chime, Halo: a soft climb over a held low note, timed from `delay`. */
type Note = { hz: number; at: number; len: number; gain: number }

const low = { hz: 261.63, at: 0, len: 1.9, gain: 0.03 }
export const HALO: Note[] = [
  low,
  ...[523.25, 659.25, 783.99, 987.77, 1174.66].map((hz, i, all) => ({
    hz,
    at: i * 0.13,
    len: i === all.length - 1 ? 1.6 : 0.8,
    gain: 0.045,
  })),
]

/** Plays Halo `delay` seconds from now. Browsers may refuse sound before a press, which is simply silence. */
export function playChime(delay = 0): () => void {
  try {
    const ctx = new AudioContext()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    HALO.forEach((n) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.hz
      const start = ctx.currentTime + delay + n.at
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(n.gain, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0004, start + n.len)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + n.len + 0.05)
    })
    return () => {
      ctx.close().catch(() => {})
    }
  } catch {
    return () => {}
  }
}

/**
 * miya radio's bitmap lettering: our own 4×5 pixel font on a 5×6 cell, and blocky 9×13 LED digits. Everything
 * comes out as one SVG path of whole pixels, so it stays sharp at any zoom.
 */
export const CELL_W = 5
export const CELL_H = 6
export const DIGIT_W = 9
export const DIGIT_H = 13

// Five rows per glyph, one hex digit per row, top bit on the left.
const GLYPHS: Record<string, string> = {
  A: '69F99',
  B: 'E9E9E',
  C: '78887',
  D: 'E999E',
  E: 'F8E8F',
  F: 'F8E88',
  G: '78B97',
  H: '99F99',
  I: 'E444E',
  J: '11196',
  K: '9ACA9',
  L: '8888F',
  M: '9FF99',
  N: '9DFB9',
  O: '69996',
  P: 'E9E88',
  Q: '699A5',
  R: 'E9EA9',
  S: '7861E',
  T: 'F6666',
  U: '99996',
  V: '99966',
  W: '99FF9',
  X: '99699',
  Y: '99666',
  Z: 'F168F',
  '0': '6BD96',
  '1': '26227',
  '2': 'E168F',
  '3': 'E161E',
  '4': '99F11',
  '5': 'F8E1E',
  '6': '78E96',
  '7': 'F1244',
  '8': '69696',
  '9': '6971E',
  ' ': '00000',
  '.': '00004',
  ',': '00048',
  ':': '04040',
  ';': '04048',
  '-': '00F00',
  _: '0000F',
  '*': '09690',
  '/': '12248',
  '(': '24442',
  ')': '42224',
  '[': '64446',
  ']': '62226',
  "'": '44000',
  '"': 'AA000',
  '!': '44404',
  '?': 'E1604',
  '&': '4A5A5',
  '+': '04E40',
  '=': '0F0F0',
  '#': '5F5F5',
  '%': '91689',
  '@': '69B87',
  $: '7A65E',
  '~': '05A00',
  '♥': '09F60',
}

const FALLBACK = GLYPHS['?'] as string

/** Folds text into what the font can draw: capitals, accents dropped, anything else a question mark. */
export function foldText(text: string) {
  // Separators the 4x5 font has no glyph for become ones it has.
  const plain = text.replace(/[·•|]/g, '-').replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
  return Array.from(plain.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase())
    .map((c) => (GLYPHS[c] ? c : '?'))
    .join('')
}

export const textWidth = (text: string) => Array.from(foldText(text)).length * CELL_W

export function textPath(text: string) {
  let d = ''
  Array.from(foldText(text)).forEach((c, i) => {
    const rows = GLYPHS[c] ?? FALLBACK
    for (let y = 0; y < 5; y += 1) {
      const bits = parseInt(rows[y] as string, 16)
      for (let x = 0; x < 4; x += 1) {
        if (Math.floor(bits / 2 ** (3 - x)) % 2) d += `M${i * CELL_W + x} ${y}h1v1h-1z`
      }
    }
  })
  return d
}

// The seven segments as x, y, width, height.
const SEGMENTS: Record<string, readonly [number, number, number, number]> = {
  a: [1, 0, 7, 2],
  b: [7, 1, 2, 5],
  c: [7, 7, 2, 5],
  d: [1, 11, 7, 2],
  e: [0, 7, 2, 5],
  f: [0, 1, 2, 5],
  g: [2, 6, 5, 1],
}

const LIT = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg']

export function digitPath(digit: number, left = 0) {
  return Array.from(LIT[digit] ?? '')
    .map((s) => {
      const [x, y, w, h] = SEGMENTS[s] as readonly [number, number, number, number]
      return `M${left + x} ${y}h${w}v${h}h${-w}z`
    })
    .join('')
}

/** Minutes and seconds for the clock, which tops out at 99:59. */
export function clockDigits(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.min(99, Math.floor(total / 60))
  const secs = minutes === 99 && total >= 6000 ? 59 : total % 60
  return [Math.floor(minutes / 10), minutes % 10, Math.floor(secs / 10), secs % 10] as const
}

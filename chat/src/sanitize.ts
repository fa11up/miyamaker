import { MAX_MESSAGE_CHARS } from './protocol'

/*
 * Characters removed from chat text (built from code points so no invisible characters live in source):
 * - C0 controls (U+0000-U+001F), DEL and C1 controls (U+007F-U+009F); line breaks/tabs become spaces first
 * - bidi embedding/override/isolate controls (U+202A-U+202E, U+2066-U+2069), ALM (U+061C), LRM/RLM
 * - zero-width and invisible formatters (U+200B-U+200F, U+2060-U+2064, U+FEFF, U+00AD soft hyphen)
 */
const hex = (cp: number) => '\\u' + cp.toString(16).padStart(4, '0')
const cls = (ranges: Array<[number, number]>) => ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('')

const LINE_BREAKS = new RegExp(
  `[${cls([
    [0x09, 0x0d],
    [0x85, 0x85],
    [0x2028, 0x2029],
  ])}]+`,
  'g'
)
const STRIP = new RegExp(
  `[${cls([
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0xad, 0xad],
    [0x61c, 0x61c],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
  ])}]`,
  'g'
)

export type SanitizeResult = { ok: true; text: string } | { ok: false; code: 'empty' | 'length' }

/** Normalizes untrusted chat input to a single line of plain text, or says why it is refused. */
export function sanitizeText(raw: unknown, max = MAX_MESSAGE_CHARS): SanitizeResult {
  if (typeof raw !== 'string') return { ok: false, code: 'empty' }
  const text = raw
    .normalize('NFC')
    .replace(LINE_BREAKS, ' ')
    .replace(STRIP, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (!text) return { ok: false, code: 'empty' }
  // Count code points, not UTF-16 units, so an emoji counts once.
  if ([...text].length > max) return { ok: false, code: 'length' }
  return { ok: true, text }
}

// Shared by the source-scan rule tests (one-app, ux-rules). Not a test file itself.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every source file under `dir`: .ts, .tsx, .js, .jsx (and .css and .html, when `css` is set: pages carry styles too). */
export const walk = (dir: string, css = false): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p, css)
    return (css ? /\.(tsx?|jsx?|css|html)$/ : /\.(tsx?|jsx?)$/).test(p) ? [p] : []
  })

/**
 * The file with its comments blanked (newlines kept, so line numbers still match). Rough on purpose: a `//` only
 * starts a comment at the start of a line or after a space, so `https://` in a string survives.
 */
export function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}()])\/\/[^\n]*/g, (c, lead: string) => lead + ' '.repeat(c.length - lead.length))
}

/** `path:line` for every match of `re` (which must be /g) in the file's code. */
export function hits(path: string, re: RegExp, text = code(path)): string[] {
  return [...text.matchAll(re)].map((m) => `${path}:${text.slice(0, m.index).split('\n').length}`)
}

/** Drops the hits whose file (or file:line) an allowlist names. Entries match a path suffix or a `path:line`. */
export const outside = (found: string[], allow: readonly string[]) =>
  found.filter((h) => !allow.some((a) => h === a || h.split(':')[0]!.endsWith(a)))

/** Top-level pieces of a file: for a stylesheet, the whole file; else each run from one column-0 line to the next. */
function chunkAround(path: string, text: string, index: number): { start: number; end: number } {
  if (/\.(css|html)$/.test(path)) return { start: 0, end: text.length }
  const starts = [...text.matchAll(/^\S/gm)].map((m) => m.index!)
  const start = starts.filter((s) => s <= index).at(-1) ?? 0
  return { start, end: starts.find((s) => s > index) ?? text.length }
}

/** The index of the brace that closes the one at `open`, or the end of the text. */
function closeOf(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return text.length
}

/**
 * The CSS selector of the rule `index` sits in, whitespace folded; '' at the root of a styled block (or of a css``
 * inside an interpolation). `open` is where that rule's `{` is (-1 at the root).
 */
export function enclosingRule(text: string, index: number, from = 0): { selector: string; open: number } {
  let depth = 0
  for (let i = index - 1; i >= from; i--) {
    if (text[i] === '}') depth++
    else if (text[i] === '{') {
      if (depth > 0) {
        depth--
        continue
      }
      if (text[i - 1] === '$') return { selector: '', open: -1 }
      const start = Math.max(text.lastIndexOf(';', i), text.lastIndexOf('}', i), text.lastIndexOf('{', i - 1), text.lastIndexOf('`', i), from - 1)
      return { selector: text.slice(start + 1, i).replace(/\s+/g, ' ').trim(), open: i }
    }
  }
  return { selector: '', open: -1 }
}

/** A name for the rule at `index`: its selector, or at a styled block's root the component's name. */
export function ruleName(path: string, text: string, index: number): string {
  const { start } = chunkAround(path, text, index)
  const { selector } = enclosingRule(text, index, start)
  return selector || (/^(?:export )?(?:const|let) (\w+)/.exec(text.slice(start, start + 200))?.[1] ?? '')
}

/**
 * Every place the content can scroll sideways: overflow-x / overflowX auto or scroll, and the overflow shorthand whose
 * first (x) value is auto or scroll (`overflow: auto` scrolls both ways), in CSS, style objects and `el.style`. Each
 * as `path:line name` (ruleName), so an allowlist can name the rule rather than a line that moves.
 */
export function sidewaysScrollers(path: string, text = code(path)): string[] {
  const re =
    /overflow-x:\s*(auto|scroll)\b|overflowX\s*[:=]\s*['"](auto|scroll)['"]|\boverflow:\s*['"]?(auto|scroll)\b|\.overflow\s*=\s*['"](auto|scroll)\b/g
  return [...text.matchAll(re)].map(
    (m) => `${path}:${text.slice(0, m.index!).split('\n').length} ${ruleName(path, text, m.index!)}`.trimEnd()
  )
}

/** JS that stops a block's motion for reduced motion (a hook, a flag or `$still` prop the window passes, a `.still` class). */
const JS_STILL = /useReducedMotion|reducedMotion|reduceMotion|(?<![-\w$])reduced(?![-\w])|\$reduced|\$still\b|\.still\b/

/**
 * Every `infinite` animation with no reduced-motion stop of its own: `path:line selector`. A loop counts as stopped when
 * it sits inside `@media (prefers-reduced-motion: no-preference)`, or a `@media (prefers-reduced-motion: reduce)` block
 * names its rule's selector (or `*`, or the selector's last part with !important), or, at a styled block's root, that block has such a media block at its root; in
 * script files also when its own top-level block switches on JS_STILL. One reduced-motion rule elsewhere in the file
 * no longer excuses the rest.
 */
export function unstoppedLoops(path: string, text = code(path)): string[] {
  const media = (kind: string) =>
    [...text.matchAll(new RegExp(String.raw`@media[^{]*prefers-reduced-motion\s*:\s*${kind}[^{]*\{`, 'g'))].map((m) => {
      const open = m.index! + m[0].length - 1
      return { at: m.index!, open, close: closeOf(text, open), body: text.slice(open + 1, closeOf(text, open)).replace(/\s+/g, ' ') }
    })
  const calm = media('no-preference')
  const reduce = media('reduce')
  return [...text.matchAll(/\binfinite\b/g)]
    .filter((m) => {
      const i = m.index!
      if (calm.some((b) => b.open < i && i < b.close)) return false
      const chunk = chunkAround(path, text, i)
      const { selector } = enclosingRule(text, i, chunk.start)
      const near = reduce.filter((b) => b.at >= chunk.start && b.at < chunk.end)
      if (!selector) {
        if (near.some((b) => enclosingRule(text, b.at, chunk.start).selector === '')) return false
      } else {
        const parts = selector.split(',').map((s) => s.trim()).filter(Boolean)
        const has = (body: string, sel: string) =>
          new RegExp(`(^|[\\s,{};])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`).test(body)
        // The rule's own selector, `*`, or its last part (`.body` for `&.mode-idle .body`) with !important.
        const names = (b: { body: string }) =>
          /(^|[\s,{}])\*\s*[,{]/.test(b.body) ||
          parts.some((s) => has(b.body, s)) ||
          (/!important/.test(b.body) && parts.some((s) => has(b.body, s.split(/[\s>+~]+/).at(-1)!)))
        if (near.some(names)) return false
      }
      return !(!/\.(css|html)$/.test(path) && JS_STILL.test(text.slice(chunk.start, chunk.end)))
    })
    .map((m) => `${path}:${text.slice(0, m.index!).split('\n').length} ${enclosingRule(text, m.index!, chunkAround(path, text, m.index!).start).selector}`.trimEnd())
}

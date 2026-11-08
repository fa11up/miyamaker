// Shared by the source-scan rule tests (one-app, ux-rules). Not a test file itself.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every source file under `dir`: .ts, .tsx, .js, .jsx (and .css, when `css` is set). */
export const walk = (dir: string, css = false): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p, css)
    return (css ? /\.(tsx?|jsx?|css)$/ : /\.(tsx?|jsx?)$/).test(p) ? [p] : []
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

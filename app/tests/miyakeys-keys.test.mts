// miyakeys keyboard shortcuts (embed/miyakeys/js/app.js keyHandler): undo and redo whatever the case, Cmd+Shift+Z
// redoes, one Escape closes one thing, and a field being typed in keeps its keys. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { isTextEntry } from '../embed/miyakeys/js/ui/textEntry.js'
import { code } from './source-scan.mts'

const at = (selector: string | null, editable = false) => ({
  isContentEditable: editable,
  closest: (s: string) => (selector && s.split(',').some((p) => p.trim().startsWith(selector)) ? {} : null),
})

test('fields being typed in keep their own keys', () => {
  assert.equal(isTextEntry(at('input')), true)
  assert.equal(isTextEntry(at('textarea')), true)
  assert.equal(isTextEntry(at('select')), true)
  assert.equal(isTextEntry(at(null, true)), true)
  assert.equal(isTextEntry(at('[contenteditable]')), true)
  assert.equal(isTextEntry(at(null)), false)
  assert.equal(isTextEntry(null), false)
  assert.equal(isTextEntry({}), false)
})

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []
  })

test('one keydown listener in the embed, so one Escape closes one thing', () => {
  const listeners = files('embed/miyakeys/js').flatMap((p) =>
    (readFileSync(p, 'utf8').match(/addEventListener\(\s*['"]keydown['"]/g) ?? []).map(() => p)
  )
  assert.deepEqual(listeners, [join('embed/miyakeys/js', 'app.js')])
})

test("the bridge's activity listener (keydown among others) only reports activity, never handles keys", async () => {
  // host.js run against a stand-in frame window: its listeners kept with their options, posts to the parent recorded.
  const listeners: { type: string; fn: (ev: unknown) => void; opts: unknown }[] = []
  const posted: unknown[] = []
  const parent = { postMessage: (m: unknown) => posted.push(m) }
  const search = '?host=http%3A%2F%2Flocalhost%3A5173'
  ;(globalThis as { window?: unknown }).window = {
    parent,
    location: { search, href: `http://localhost:5173/embed/miyakeys/${search}` },
    addEventListener: (type: string, fn: (ev: unknown) => void, opts: unknown) => listeners.push({ type, fn, opts }),
    removeEventListener: () => {},
  }
  const { listenToHost } = await import('../embed/miyakeys/js/core/host.js')
  let t = 0
  listenToHost({ onBuild: () => {}, onVisible: () => {}, now: () => (t += 5000) })
  const keydown = listeners.filter((l) => l.type === 'keydown')
  assert.equal(keydown.length, 1, 'the bridge listens to keydown (for activity)')
  // Capture phase and passive: a passive listener cannot cancel the key even by mistake.
  assert.deepEqual(keydown[0]!.opts, { capture: true, passive: true })
  const called: string[] = []
  const ev = (key: string, extra: Record<string, unknown> = {}) => ({
    type: 'keydown',
    key,
    target: {},
    preventDefault: () => called.push(`preventDefault ${key}`),
    stopPropagation: () => called.push(`stopPropagation ${key}`),
    stopImmediatePropagation: () => called.push(`stopImmediatePropagation ${key}`),
    ...extra,
  })
  posted.length = 0 // the ready message
  for (const e of [ev('Escape'), ev('z', { metaKey: true }), ev('Enter'), ev('a'), ev(' ')]) keydown[0]!.fn(e)
  assert.deepEqual(called, [], 'no key is cancelled or kept from app.js')
  assert.deepEqual(posted, Array(5).fill({ type: 'miyakeys:activity', kind: 'key' }), 'each key is reported, kind only')
})
/** app.js's keyHandler, from its declaration to where it is added (app.js imports three.js, so it is read, not run). */
function keyHandler(): string {
  const app = code('embed/miyakeys/js/app.js')
  const start = app.indexOf('const keyHandler')
  const end = app.search(/addEventListener\(\s*['"]keydown['"]\s*,\s*keyHandler\s*\)/)
  assert.ok(start >= 0 && end > start, 'keyHandler is declared, then added as the keydown listener')
  const handler = app.slice(start, end)
  assert.match(handler, /=>\s*\{[\s\S]*\}/, 'the slice is the handler body')
  return handler
}

test('undo and redo compare the key in lower case, fall back to the physical key, and Cmd+Shift+Z redoes', () => {
  const handler = keyHandler()
  // The key is lower-cased once, and no letter is compared against ev.key as typed (Shift or Caps Lock make it 'Z').
  assert.match(handler, /const k = \(?\s*ev\.key\b[^;\n]*\)?\.toLowerCase\(\)/)
  assert.doesNotMatch(handler, /\bev\.key\s*[!=]==?\s*['"][A-Za-z]['"]/)
  assert.doesNotMatch(handler, /['"][A-Za-z]['"]\s*[!=]==?\s*ev\.key\b/)
  // A non-Latin layout (Russian, Greek…): ev.key is that script's letter, so the physical key decides.
  assert.match(handler, /\bisZ = latin \? k === ['"]z['"] : ev\.code === ['"]KeyZ['"]/)
  assert.match(handler, /\bisY = latin \? k === ['"]y['"] : ev\.code === ['"]KeyY['"]/)
  // Plain Cmd+Z undoes; Cmd+Y or Cmd+Shift+Z redoes.
  assert.match(handler, /mod && isZ && !ev\.shiftKey\)[\s\S]*?\bundo\(\)/)
  assert.match(handler, /mod && \(isY \|\| \(isZ && ev\.shiftKey\)\)\)[\s\S]*?\bredo\(\)/)
})

test('one Escape closes one thing: the dialog, else the Export menu, else it leaves the field, else the key editor', () => {
  const handler = keyHandler()
  const esc = /if \(ev\.key === ['"]Escape['"]\) \{/.exec(handler)
  assert.ok(esc, 'an Escape branch')
  // The branch up to its return: one chain of if / else if / else, so exactly one of them runs.
  const branch = handler.slice(esc.index, handler.indexOf('return;', esc.index))
  assert.ok(branch.length > 0)
  assert.match(
    branch,
    /if \(isModalOpen\(\)\) \{[^}]*closeModal\(\);[^}]*\} else if \([^)]*menu\.classList\.contains\(['"]open['"]\)\) \{[^}]*closeExportMenu\([^}]*\} else if \(isTextEntry\(ev\.target\)\) \{[\s\S]*?\.blur\(\);?\s*\} else \{\s*hideKeyEditor\(\);?\s*\}\s*$/
  )
})

// miyakeys keyboard shortcuts (embed/miyakeys/js/app.js keyHandler): undo and redo whatever the case, Cmd+Shift+Z
// redoes, one Escape closes one thing, and a field being typed in keeps its keys. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { isTextEntry } from '../embed/miyakeys/js/ui/textEntry.js'

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

test("the bridge's activity listener (keydown among others) only reports activity, never handles keys", () => {
  const host = readFileSync('embed/miyakeys/js/core/host.js', 'utf8')
  assert.match(host, /const ACTIVITY_EVENTS = \[[^\]]*'keydown'/)
  const onActivity = host.slice(host.indexOf('onActivity'), host.indexOf('ACTIVITY_EVENTS.forEach'))
  assert.doesNotMatch(onActivity, /preventDefault|stopPropagation|stopImmediatePropagation/)
})

test('undo and redo compare the key in lower case, fall back to the physical key, and Cmd+Shift+Z redoes', () => {
  const app = readFileSync('embed/miyakeys/js/app.js', 'utf8')
  const handler = app.slice(app.indexOf('const keyHandler'), app.indexOf("addEventListener('keydown', keyHandler)"))
  assert.match(handler, /\(ev\.key \|\| ''\)\.toLowerCase\(\)/)
  assert.doesNotMatch(handler, /ev\.key === 'z'|ev\.key === 'y'/)
  // A non-Latin layout (Russian, Greek…): ev.key is that script's letter, so the physical key decides.
  assert.match(handler, /latin \? k === 'z' : ev\.code === 'KeyZ'/)
  assert.match(handler, /latin \? k === 'y' : ev\.code === 'KeyY'/)
  assert.match(handler, /isZ && ev\.shiftKey/)
})

test('one Escape closes one thing: the dialog, else the Export menu, else it leaves the field, else the key editor', () => {
  const app = readFileSync('embed/miyakeys/js/app.js', 'utf8')
  const handler = app.slice(app.indexOf('const keyHandler'), app.indexOf("addEventListener('keydown', keyHandler)"))
  assert.match(
    handler,
    /isModalOpen\(\)[\s\S]*closeModal\(\)[\s\S]*menu\.classList\.contains\('open'\)[\s\S]*closeExportMenu\([\s\S]*else if \(isTextEntry\(ev\.target\)\)[\s\S]*\.blur\(\)[\s\S]*else \{\s*hideKeyEditor\(\)/
  )
})

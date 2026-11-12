// Input rules for the music app that a static read can hold: menus close on Escape before it reaches Rec, every
// finger on the on-screen keys holds its own note, and a button shrunk below the touch size grows back on touch.
// Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { code, walk } from './source-scan.mts'

const DIR = 'src/pages/MusicMaker'
const read = (p: string) => readFileSync(p, 'utf8')

/** Top-level functions of a file, by name. Rough on purpose: a function starts at column 0 and runs to the next. */
function topFunctions(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const starts = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)]
  starts.forEach((m, i) => out.set(m[1]!, text.slice(m.index, starts[i + 1]?.index ?? text.length)))
  return out
}

/** A component handles Escape itself or calls a hook from the same file that does. */
function handlesEscape(body: string, fns: Map<string, string>): boolean {
  if (/'Escape'/.test(body)) return true
  for (const m of body.matchAll(/\b(use[A-Z]\w*)\(/g)) {
    if (/'Escape'/.test(fns.get(m[1]!) || '')) return true
  }
  return false
}

export function menusWithoutEscape(files: Record<string, string>): string[] {
  const offenders: string[] = []
  for (const [path, text] of Object.entries(files)) {
    if (!/role="menu"/.test(text)) continue
    const fns = topFunctions(text)
    for (const [name, body] of fns) {
      if (/role="menu"/.test(body) && !handlesEscape(body, fns)) offenders.push(`${path} ${name}`)
    }
  }
  return offenders
}

test('every menu in the music app closes on Escape, so Escape never falls through to Rec', () => {
  const files = Object.fromEntries(walk(DIR).map((p) => [p, code(p)]))
  assert.deepEqual(menusWithoutEscape(files), [])
})

test('the rule catches a menu that only closes on an outside press', () => {
  const bad = `function useCloser(open) {\n  window.addEventListener('pointerdown', down)\n}\nfunction Menu() {\n  useCloser(open)\n  return <div role="menu" />\n}\n`
  assert.deepEqual(menusWithoutEscape({ 'x.jsx': bad }), ['x.jsx Menu'])
  const good = bad.replace("'pointerdown', down)", "'pointerdown', down)\n  if (event.key !== 'Escape') return")
  assert.deepEqual(menusWithoutEscape({ 'x.jsx': good }), [])
})

export function sharedHoldIds(text: string): string[] {
  return [...text.matchAll(/['`](piano:[a-z][^'`]*)['`]/g)].map((m) => m[1]!).filter((id) => !id.includes('${id}'))
}

export function unfilteredMoves(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/addEventListener\('pointermove', (\w+)\)/g)) {
    const name = m[1]!
    const def = text.match(new RegExp(`const ${name} = \\((\\w+)\\) => \\{\\n([^\\n]*)`))
    assert.ok(def, `no handler ${name}`)
    if (!def[2]!.includes(`${def[1]}.pointerId !== id`)) out.push(name)
  }
  return out
}

test('every finger on the piano holds a note of its own', () => {
  const piano = code(`${DIR}/screens/Piano.jsx`)
  assert.match(piano, /const id = event\.pointerId/)
  assert.ok(/playAt\([^)]*hold/.test(piano), 'Piano plays through a per-finger hold id')
  assert.deepEqual(sharedHoldIds(piano), [])
  assert.deepEqual(sharedHoldIds(code(`${DIR}/screens/ChordPanel.jsx`)), [])
  // The old shared id: a second finger replaced the first, and lifting one silenced both.
  assert.deepEqual(sharedHoldIds(`noteOff('piano:key')`), ['piano:key'])
})

test('a finger moving on the piano or chord panel only moves its own gesture', () => {
  for (const file of ['screens/Piano.jsx', 'screens/ChordPanel.jsx']) {
    assert.deepEqual(unfilteredMoves(code(`${DIR}/${file}`)), [], file)
  }
  const old = `addEventListener('pointermove', play)\nconst play = (ev) => {\n  const midi = keyAt(ev.clientX, ev.clientY)\n`
  assert.deepEqual(unfilteredMoves(old), ['play'])
})

type Rule = { selectors: string[]; body: string; coarse: boolean }

/** Every style rule with its selectors, body, and whether it sits in a `(pointer: coarse)` block. */
function cssRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const stack: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      stack.push(text.slice(start, i).trim())
      start = i + 1
    } else if (c === '}') {
      const prelude = stack.pop() ?? ''
      if (!prelude.startsWith('@')) {
        rules.push({
          selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
          body: text.slice(start, i),
          coarse: stack.some((p) => /@media[^{]*\(pointer: coarse\)/.test(p)),
        })
      }
      start = i + 1
    } else if (c === ';' && stack.length && /^@/.test(text.slice(start, i).trim())) {
      start = i + 1
    }
  }
  return rules
}

const px = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`))
  return m ? Number(m[1]) : null
}

export function smallButtons(css: string): string[] {
  const rules = cssRules(css)
  const grown = new Set(
    rules
      .filter((r) => r.coarse && ['min-height', 'height'].some((p) => (px(r.body, p) ?? 0) >= 32))
      .flatMap((r) => r.selectors)
  )
  const out: string[] = []
  for (const rule of rules) {
    if (rule.coarse) continue
    const small = ['min-height', 'height'].some((p) => {
      const v = px(rule.body, p)
      return v != null && v < 32
    })
    if (!small) continue
    for (const sel of rule.selectors) if (/\.btn(?![\w-])/.test(sel) && !grown.has(sel)) out.push(sel)
  }
  return out
}

test('a button set below the touch size grows back to 32px on a touch screen', () => {
  assert.deepEqual(smallButtons(read(`${DIR}/styles/miyamaker.css`)), [])
  const old = `.strum-bar > .btn { min-height: 28px; }\n@media (pointer: coarse) {\n  .strum-bank .btn { min-height: 32px; }\n}\n`
  assert.deepEqual(smallButtons(old), ['.strum-bar > .btn'])
  assert.deepEqual(smallButtons(old.replace('  .strum-bank', '  .strum-bar > .btn,\n  .strum-bank')), [])
})

test('the desktop app shows where publishing works instead of Publish and Mint rows that cannot run there', () => {
  const songMenus = code(`${DIR}/screens/SongMenus.jsx`)
  assert.match(songMenus, /import \{ DESKTOP_PUBLISH_NOTE, isDesktopApp \} from '\.\.\/media\/desktop\.js'/)
  const rows = topFunctions(songMenus).get('ReleaseRows') || ''
  const gate = rows.indexOf('if (isDesktopApp()) return')
  assert.ok(gate > 0, 'ReleaseRows checks for the desktop app')
  assert.match(rows.slice(gate, rows.indexOf('\n', gate)), /\{DESKTOP_PUBLISH_NOTE\}/)
  assert.ok(gate < rows.indexOf("onPublish('"), 'the note comes before any publish row')
  // Every Publish and Mint row lives in ReleaseRows, so the one gate covers SAVE and the phone Menu.
  const strays = walk(DIR)
    .filter((p) => /\.jsx$/.test(p))
    .flatMap((p) => {
      const fns = topFunctions(code(p))
      return [...fns].filter(([name, body]) => name !== 'ReleaseRows' && /onPublish\('(upload|mint)-/.test(body)).map(([name]) => `${p} ${name}`)
    })
  assert.deepEqual(strays, [])
  assert.match(code(`${DIR}/MiyaMusicMaker.jsx`), /<ReleaseRows/)
})

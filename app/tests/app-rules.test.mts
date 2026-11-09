// Owner rules that a static read can hold: each app has its own skin and highlight, and the music app's dialogs
// close on Escape. Run: yarn test
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const read = (p: string) => readFileSync(p, 'utf8')

/** Page id -> the file its loader imports (constants/appLoaders.ts). */
function appFiles() {
  const loaders = read('src/constants/appLoaders.ts')
  const out: Record<string, string> = {}
  for (const m of loaders.matchAll(/^\s+(\w+): \(\) => import\('@\/([^']+)'\)/gm)) {
    const base = join('src', m[2]!)
    const file = [`${base}.tsx`, join(base, 'index.tsx')].find((p) => existsSync(p) && statSync(p).isFile())
    assert.ok(file, `no file for ${m[1]}`)
    out[m[1]!] = file
  }
  return out
}

const pages = read('src/constants/pages.ts')
const ids = [...pages.matchAll(/^\s+id: '([a-z]+)',/gm)].map((m) => m[1]!)
/** Shaped apps paint their own body with no window frame (Mint's handheld, the radio). */
const shaped = new Set(
  [...pages.matchAll(/^\s+id: '([a-z]+)',[\s\S]*?^\s{2}\},/gm)].filter((m) => /shaped: true/.test(m[0])).map((m) => m[1]!)
)

test('every windowed app wears a skin of its own, shared with no other app', () => {
  const files = appFiles()
  assert.deepEqual(Object.keys(files).sort(), [...ids].sort())
  const owner = new Map<string, string>()
  for (const id of ids) {
    if (shaped.has(id)) continue
    const skin = read(files[id]!).match(/<WindowWrapper skin="([a-z]+)"/)?.[1]
    assert.ok(skin, `${id} has no skin`)
    assert.equal(owner.get(skin), undefined, `${id} and ${owner.get(skin)} share the ${skin} skin`)
    owner.set(skin, id)
  }
})

test('every skin has its own title bar, frame and mark, and no two share a highlight colour', () => {
  const bar = read('src/components/TitleBar/index.tsx')
  const frame = read('src/components/WindowWrapper/index.tsx')
  const skins = [...bar.match(/export type TitleSkin =([\s\S]*?)\n\n/)![1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
  assert.ok(skins.includes('music'))
  for (const skin of skins) {
    assert.match(bar, new RegExp(`^\\s+${skin}: '`, 'm'), `${skin} has no mark`)
    // Display keeps the classic grey window face on purpose.
    if (skin !== 'display') assert.ok(frame.includes(`&[data-skin='${skin}'] {`), `${skin} has no frame`)
    assert.ok(bar.includes(`&[data-skin='${skin}']`), `${skin} has no title bar`)
  }
  const highlights = [...frame.matchAll(/^\s+(\w+): \['(#[0-9a-f]{6})'/gm)].map((m) => [m[1]!, m[2]!.toLowerCase()])
  const seen = new Map<string, string>()
  for (const [skin, colour] of highlights) {
    assert.equal(seen.get(colour!), undefined, `${skin} and ${seen.get(colour!)} share ${colour}`)
    seen.set(colour!, skin!)
  }
  assert.ok(highlights.some(([skin]) => skin === 'music'))
})

test('the music app takes its skin inside too: its accent is the music highlight, not the OS pink', () => {
  const frame = read('src/components/WindowWrapper/index.tsx')
  const css = read('src/pages/MusicMaker/styles/miyamaker.css')
  const music = frame.match(/music: \['(#[0-9a-f]{6})'/)![1]
  assert.match(css, new RegExp(`--accent: ${music};`))
  assert.doesNotMatch(css, /--accent: #d97ada/)
})

test('the music app has no dead desktop shell or shadow-root font rules', () => {
  const css = read('src/pages/MusicMaker/styles/miyamaker.css')
  for (const dead of ['.taskbar', '.desk-icon', '.os-info', '.window-slot', '.window-frame', '.window-body', '--taskbar-h', '@font-face', 'bg_pattern', ':root']) {
    assert.ok(!css.includes(dead), dead)
  }
  // Inside a window the browser's width says nothing: layout answers to the app's own container.
  assert.doesNotMatch(css, /@media \((max|min)-width/)
})

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.[jt]sx?$/.test(p) ? [p] : []
  })

test('the music app dialog closes on Escape, keeps focus inside and gives it back', () => {
  const widgets = read('src/pages/MusicMaker/widgets.jsx')
  const dialog = widgets.slice(widgets.indexOf('export function Dialog('))
  assert.match(dialog, /'Escape'/)
  assert.match(dialog, /busy/)
  assert.match(dialog, /'Tab'/)
  assert.match(dialog, /aria-modal="true"/)
  assert.match(dialog, /\.focus\(/)
})

test('every dialog drawn inside the music app handles Escape', () => {
  const offenders = walk('src/pages/MusicMaker')
    .filter((p) => !p.endsWith('widgets.jsx'))
    .filter((p) => /role="dialog"|className="dialog"/.test(read(p)))
    .filter((p) => !/'Escape'/.test(read(p)))
  assert.deepEqual(offenders, [])
})

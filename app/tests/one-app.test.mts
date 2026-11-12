// An app never opens another app: only the desktop, Start menu and taskbar start them. Each app boots on its own. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { SCENES } from '../src/components/AppBoot/scenes.ts'
import { code, hits, walk } from './source-scan.mts'

/** The OS's own parts, and the one hook that hands a Start-menu press to Manager. */
const SHELL =
  /(components\/(TaskBar|RadioTray)\/|pages\/OperatingSystem\/|desktop\/ContextMenu|music\/useOpenApp|miyamints\/useOpenManage|store\/windows\/|src\/(Router|App|GlobalHistory|main)\.tsx)/

const SRC = walk('src')

/** Each app's own route, by the folder its code lives in. A file outside every app owns none. */
const OWN: [RegExp, string][] = [
  [/pages\/Mint\//, 'mint'],
  [/pages\/Launch\//, 'launch'],
  [/pages\/Uploader\//, 'upload'],
  [/pages\/Manage\//, 'manage'],
  [/pages\/Swap\//, 'trade'],
  [/pages\/Auction\//, 'auction'],
  [/pages\/TV\//, 'tv'],
  [/pages\/Radio\//, 'radio'],
  [/pages\/DropMusic\//, 'drop-music'],
  [/pages\/Home\//, 'about'],
  [/desktop\/files\//, 'files'],
  [/desktop\/display\//, 'display'],
]

const APP_PATHS = [...readFileSync('src/constants/pages.ts', 'utf8').matchAll(/^\s+path: '\/([a-z-]+)',/gm)].map(
  (m) => m[1]!
)

test('nothing inside an app can open another window', () => {
  const offenders = SRC.filter((p) => !SHELL.test(p))
    .filter((p) => /useOpenApp|useOpenManage\(\)/.test(code(p)))
    // Manager focusing one of its own collections stays inside itself.
    .filter((p) => !p.endsWith('pages/Manage/index.tsx'))
  assert.deepEqual(offenders, [])
})

test('only the shell dispatches openWindow / setToFront, and there is no event that opens a window', () => {
  const offenders = SRC.filter((p) => !SHELL.test(p)).flatMap((p) => [
    ...hits(p, /dispatch\(\s*(openWindow|setToFront)\b/g),
    ...hits(p, /miyaos:open-window/g),
  ])
  assert.deepEqual(offenders, [])
})

test('no app navigates or links to another app', () => {
  assert.ok(APP_PATHS.includes('mint') && APP_PATHS.includes('trade'), 'the app paths are read from pages.ts')
  const to = APP_PATHS.join('|')
  const route = new RegExp(
    `(navigate\\(\\s*|\\bto=\\{?\\s*|\\bhref=\\{?\\s*)[\`'"]/(${to})(?=[/?#\`'"]|$)`,
    'g'
  )
  const offenders = SRC.filter((p) => !SHELL.test(p)).flatMap((p) => {
    const own = OWN.find(([re]) => re.test(p))?.[1]
    const text = code(p)
    return [...text.matchAll(route)]
      .filter((m) => m[2] !== own)
      .map((m) => `${p}:${text.slice(0, m.index).split('\n').length} -> /${m[2]}`)
  })
  assert.deepEqual(offenders, [])
})

test('the apps that boot each have their own scene, and the others open straight away', () => {
  const pages = readFileSync('src/constants/pages.ts', 'utf8')
  const ids = [...pages.matchAll(/^\s+id: '([a-z]+)',/gm)].map((m) => m[1]!)
  // These boot inside themselves or open straight away.
  const own = ['mint', 'uploader', 'tv', 'dropmusic', 'files', 'display', 'radio', 'manager', 'modkeys']
  assert.deepEqual(ids.filter((id) => !own.includes(id)).sort(), Object.keys(SCENES).sort())
  for (const id of own) assert.equal(SCENES[id], undefined)
  assert.equal(new Set(Object.values(SCENES).map((s) => s.draw)).size, Object.keys(SCENES).length)
  for (const s of Object.values(SCENES)) assert.ok(s.ms >= 1500 && s.ms <= 2800)
})

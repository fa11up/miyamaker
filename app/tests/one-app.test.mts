// An app never opens another app: only the desktop, Start menu and taskbar start them. Each app boots on its own. Run: yarn test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { SCENES } from '../src/components/AppBoot/scenes.ts'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })

/** The OS's own parts, and the one hook that hands a Start-menu press to Manager. */
const SHELL =
  /(components\/(TaskBar|RadioTray)|desktop\/(ContextMenu|useOpenApp)|music\/useOpenApp|miyamints\/useOpenManage)/

test('nothing inside an app can open another window', () => {
  const offenders = walk('src')
    .filter((p) => !SHELL.test(p))
    .filter((p) => /useOpenApp|useOpenManage\(\)/.test(readFileSync(p, 'utf8')))
    // Manager focusing one of its own collections stays inside itself.
    .filter((p) => !p.endsWith('pages/Manage/index.tsx'))
  assert.deepEqual(offenders, [])
})

test('no app navigates to another app', () => {
  const other = /navigate\(\s*[`'"]\/(mint|launch|trade|tv|radio|drop-music|manage|upload|files|auction)\b/
  const offenders = walk('src/pages').filter((p) => {
    const own = p.match(/pages\/([A-Za-z]+)/)?.[1]
    return own !== 'OperatingSystem' && other.test(readFileSync(p, 'utf8')) && own !== 'Mint' && own !== 'Swap'
  })
  assert.deepEqual(offenders, [])
})

test('the apps that boot each have their own scene, and the others open straight away', () => {
  const pages = readFileSync('src/constants/pages.ts', 'utf8')
  const ids = [...pages.matchAll(/^\s+id: '([a-z]+)',/gm)].map((m) => m[1]!)
  // These boot inside themselves or open straight away.
  const own = ['mint', 'uploader', 'tv', 'dropmusic', 'auction', 'files', 'display', 'radio', 'manager']
  assert.deepEqual(ids.filter((id) => !own.includes(id)).sort(), Object.keys(SCENES).sort())
  for (const id of own) assert.equal(SCENES[id], undefined)
  assert.equal(new Set(Object.values(SCENES).map((s) => s.draw)).size, Object.keys(SCENES).length)
  for (const s of Object.values(SCENES)) assert.ok(s.ms >= 1500 && s.ms <= 2800)
})

// The MiyaOS corner shows the desktop program's own version inside the program, read from
// desktop/miyamusicmaker/package.json at build time, so a release bump changes it too. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const pkg = JSON.parse(read('../../desktop/miyamusicmaker/package.json'))
const config = read('../vite.config.ts')
const background = read('../src/pages/OperatingSystem/Background.tsx')

test('the build defines __MMM_VERSION__ from the desktop package.json', () => {
  assert.match(config, /desktop\/miyamusicmaker\/package\.json/)
  assert.match(config, /__MMM_VERSION__: JSON\.stringify\(MMM_VERSION\)/)
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
})

test('the corner shows that version inside the desktop program, not a typed-in one', () => {
  assert.match(background, /isDesktopApp\(\) \? `MiyaMusicMaker \$\{__MMM_VERSION__\}`/)
  assert.doesNotMatch(background, /MiyaMusicMaker \d+\.\d+/)
})

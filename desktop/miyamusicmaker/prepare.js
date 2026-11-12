'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = __dirname
const repo = path.join(root, '..', '..')
const iconSrc = path.join(repo, 'app', 'src', 'assets', 'icon', 'music_maker.png')
const iconCommitted = path.join(root, 'build', 'icon.png')
// The build reads the icon from here. It is ignored by git, so a build never changes the committed icon.
const genDir = path.join(root, 'build', 'generated')
const iconOut = path.join(genDir, 'icon.png')

fs.mkdirSync(genDir, { recursive: true })
if (process.platform === 'darwin' && fs.existsSync(iconSrc)) {
  execFileSync('sips', ['-z', '1024', '1024', iconSrc, '--out', iconOut], { stdio: 'inherit' })
} else if (fs.existsSync(iconCommitted)) {
  fs.copyFileSync(iconCommitted, iconOut)
} else {
  console.error('Missing icon: ' + iconCommitted)
  process.exit(1)
}

const index = path.join(repo, 'app', 'dist', 'index.html')
if (!fs.existsSync(index)) {
  console.error('The web build is missing. From the repo root, run:')
  console.error('  cd app && corepack yarn && VITE_CHAT_URL=https://chat.miyamaker.com corepack yarn build')
  process.exit(1)
}

// Stop a release that packs an old web build. MIYA_ALLOW_STALE_DIST=1 skips this.
let lastSrc = 0
try {
  const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', 'app/src'], { cwd: repo, encoding: 'utf8' })
  lastSrc = Number(out.trim()) || 0
} catch {
  console.warn('WARNING: git is not available, so the age of app/dist was not checked.')
}
const distTime = Math.floor(fs.statSync(index).mtimeMs / 1000)
if (lastSrc && distTime < lastSrc) {
  const bar = '='.repeat(72)
  console.error(bar)
  console.error('app/dist is older than the last commit to app/src.')
  console.error('  app/dist/index.html: ' + new Date(distTime * 1000).toISOString())
  console.error('  last app/src commit: ' + new Date(lastSrc * 1000).toISOString())
  console.error('Rebuild it first:')
  console.error('  cd app && VITE_CHAT_URL=https://chat.miyamaker.com corepack yarn build')
  console.error(bar)
  if (process.env.MIYA_ALLOW_STALE_DIST !== '1') process.exit(1)
  console.error('MIYA_ALLOW_STALE_DIST=1, so the build goes on with it.')
}

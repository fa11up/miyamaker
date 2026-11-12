'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = __dirname
const iconSrc = path.join(root, '..', '..', 'app', 'src', 'assets', 'icon', 'music_maker.png')
const buildDir = path.join(root, 'build')
const iconOut = path.join(buildDir, 'icon.png')

fs.mkdirSync(buildDir, { recursive: true })
if (!fs.existsSync(iconSrc)) {
  console.error('Missing icon: ' + iconSrc)
  process.exit(1)
}
if (process.platform === 'darwin') {
  execFileSync('sips', ['-z', '1024', '1024', iconSrc, '--out', iconOut], { stdio: 'inherit' })
} else if (!fs.existsSync(iconOut)) {
  fs.copyFileSync(iconSrc, iconOut)
}

const index = path.join(root, '..', '..', 'app', 'dist', 'index.html')
if (!fs.existsSync(index)) {
  console.error('The web build is missing. From the repo root, run:')
  console.error('  cd app && corepack yarn && VITE_CHAT_URL=https://chat.miyamaker.com corepack yarn build')
  process.exit(1)
}

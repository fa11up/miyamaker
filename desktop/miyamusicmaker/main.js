'use strict'

const { app, BrowserWindow, dialog, protocol, shell, screen, session } = require('electron')
const fs = require('fs')
const path = require('path')
const { serve } = require('./serve')

const SMOKE = process.env.MIYA_DESKTOP_SMOKE === '1'
const DEV_URL = 'http://localhost:5173/music'
// One fixed origin, so saved songs and kits in localStorage and IndexedDB are there on the next launch.
// 1.0.0 used a new 127.0.0.1 port each launch, and that work cannot be reached from here.
const SCHEME = 'app'
const APP_HOST = 'music'
const START_URL = `${SCHEME}://${APP_HOST}/music`

// Has to run before ready. standard + secure make it a secure context, so the mic, MIDI and worklets work.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
])

function distDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app')
  return path.join(__dirname, '..', '..', 'app', 'dist')
}

function allowMedia(permission) {
  return permission === 'media' || permission === 'microphone' || permission === 'midi' || permission === 'midiSysex'
}

// Same page as the one we opened. URL.origin is "null" for a custom scheme, so compare scheme and host.
function sameApp(url, start) {
  try {
    const next = new URL(url)
    return next.protocol === start.protocol && next.host === start.host
  } catch {
    return false
  }
}

function openExternal(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      shell.openExternal(url)
    }
  } catch {
    /* leave a bad address alone */
  }
}

let mainWindow = null

function watchSmoke(win) {
  const deadline = Date.now() + 45000
  const tick = async () => {
    if (win.isDestroyed()) return
    if (Date.now() > deadline) {
      console.error('SMOKE_FAIL timeout')
      app.exit(1)
      return
    }
    try {
      const state = await win.webContents.executeJavaScript(
        `(() => {
          const boot = document.querySelector('[data-boot]')
          if (boot) { boot.click(); return 'boot' }
          const splash = document.querySelector('[data-testid="app-boot"]')
          if (splash) { splash.click(); return 'splash' }
          const el = document.querySelector('[data-miya-music]')
          const face = el && el.shadowRoot && el.shadowRoot.querySelector('.mmm')
          return face ? 'ready' : 'wait'
        })()`,
        true
      )
      if (state === 'ready') {
        console.log('SMOKE_OK')
        app.exit(0)
        return
      }
    } catch (err) {
      console.error('SMOKE_FAIL', err && err.message ? err.message : err)
      app.exit(1)
      return
    }
    setTimeout(tick, 500)
  }
  win.webContents.once('did-finish-load', () => setTimeout(tick, 300))
  win.webContents.on('did-fail-load', (_event, code, desc) => {
    console.error('SMOKE_FAIL load', code, desc)
    app.exit(1)
  })
}

async function createWindow(startUrl) {
  const area = screen.getPrimaryDisplay().workAreaSize
  const width = Math.max(1100, Math.min(1440, area.width))
  const height = Math.max(720, Math.min(960, area.height))
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 1100,
    minHeight: 720,
    title: 'MiyaMusicMaker',
    backgroundColor: '#24143f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  mainWindow = win
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (sameApp(url, startUrl)) return
    event.preventDefault()
    openExternal(url)
  })
  if (SMOKE) watchSmoke(win)
  await win.loadURL(startUrl.href)
  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    const dev = process.argv.includes('--dev')
    const start = new URL(dev ? DEV_URL : START_URL)
    // Mic and MIDI, only for our own page.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(allowMedia(permission) && sameApp(details && details.requestingUrl, start))
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      return allowMedia(permission) && sameApp(requestingOrigin, start)
    })
    if (!dev) {
      const root = distDir()
      if (!fs.existsSync(path.join(root, 'index.html'))) {
        console.error('Missing web build at ' + root)
        dialog.showErrorBox('MiyaMusicMaker', 'The web build is missing at ' + root + '.')
        app.exit(1)
        return
      }
      protocol.handle(SCHEME, (request) => serve(root, request))
    }
    app.on('window-all-closed', () => app.quit())
    try {
      await createWindow(start)
    } catch (err) {
      if (!dev) throw err
      console.error(err)
      if (SMOKE) {
        app.exit(1)
        return
      }
      dialog.showErrorBox(
        'MiyaMusicMaker',
        'The Vite dev server is not running at http://localhost:5173.\n\nStart it with: cd app && yarn dev\nThen run npm run dev again.'
      )
      app.exit(1)
    }
  }).catch((err) => {
    console.error(err)
    app.exit(1)
  })
}

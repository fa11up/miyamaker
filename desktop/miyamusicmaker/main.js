'use strict'

const { app, BrowserWindow, shell, screen, session } = require('electron')
const fs = require('fs')
const http = require('http')
const path = require('path')

const HOST = '127.0.0.1'
const SMOKE = process.env.MIYA_DESKTOP_SMOKE === '1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
}

function distDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app')
  return path.join(__dirname, '..', '..', 'app', 'dist')
}

function fileFor(root, urlPath) {
  let pathname
  try {
    pathname = decodeURIComponent((urlPath || '/').split('?')[0])
  } catch {
    return null
  }
  const rel = pathname.replace(/^[/\\]+/, '')
  const full = path.resolve(root, rel)
  const base = path.resolve(root)
  if (full !== base && !full.startsWith(base + path.sep)) return null
  return full
}

function sendFile(req, res, filePath) {
  const stat = fs.statSync(filePath)
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  }
  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    const start = match[1] === '' ? 0 : Number(match[1])
    const end = match[2] === '' ? stat.size - 1 : Number(match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(filePath, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath).pipe(res)
}

function startServer(root) {
  const server = http.createServer((req, res) => {
    const target = fileFor(root, req.url || '/')
    if (!target) {
      res.writeHead(400)
      res.end('Bad path')
      return
    }
    let stat = null
    try {
      stat = fs.statSync(target)
    } catch {
      stat = null
    }
    if (stat && stat.isDirectory()) {
      const index = path.join(target, 'index.html')
      if (fs.existsSync(index)) {
        sendFile(req, res, index)
        return
      }
    }
    if (stat && stat.isFile()) {
      sendFile(req, res, target)
      return
    }
    const index = path.join(root, 'index.html')
    if (!path.extname(target) && fs.existsSync(index)) {
      sendFile(req, res, index)
      return
    }
    res.writeHead(404)
    res.end('Not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const addr = server.address()
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 })
    })
  })
}

function allowMedia(permission) {
  return permission === 'media' || permission === 'microphone' || permission === 'midi' || permission === 'midiSysex'
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
    let next
    try {
      next = new URL(url)
    } catch {
      event.preventDefault()
      return
    }
    if (next.origin === startUrl.origin) return
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
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowMedia(permission))
    })
    const dev = process.argv.includes('--dev')
    let server = null
    let start
    if (dev) {
      start = new URL('http://localhost:5173/music')
    } else {
      const root = distDir()
      if (!fs.existsSync(path.join(root, 'index.html'))) {
        console.error('Missing web build at ' + root)
        app.exit(1)
        return
      }
      const started = await startServer(root)
      server = started.server
      start = new URL(`http://${HOST}:${started.port}/music`)
    }
    await createWindow(start)
    const closeServer = () => {
      if (server) server.close()
    }
    app.on('before-quit', closeServer)
    app.on('window-all-closed', () => {
      closeServer()
      app.quit()
    })
  }).catch((err) => {
    console.error(err)
    app.exit(1)
  })
}

'use strict'

// Serves app/dist to the app:// scheme. No Electron in here, so the tests can load it.

const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')

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

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

// The desktop build has no Worker, so /api is always a 404, never the page.
function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

// A file under root for a URL path, or null when the path is bad or leaves root.
function resolveInRoot(root, urlPath) {
  let pathname
  try {
    pathname = decodeURIComponent(String(urlPath || '/').split(/[?#]/)[0])
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  // A backslash is a separator on Windows. Treat it as one everywhere.
  const rel = pathname.replace(/\\/g, '/').replace(/^\/+/, '')
  const base = path.resolve(root)
  const full = path.resolve(base, rel)
  if (full !== base && !full.startsWith(base + path.sep)) return null
  return full
}

// A Range header against a file size. null means no range (send it all),
// 'unsatisfiable' means 416, otherwise the inclusive byte span.
function parseRange(header, size) {
  if (header == null || header === '') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match || (match[1] === '' && match[2] === '')) return 'unsatisfiable'
  if (size <= 0) return 'unsatisfiable'
  let start
  let end
  if (match[1] === '') {
    // bytes=-N is the last N bytes.
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'unsatisfiable'
    if (start >= size || start > end) return 'unsatisfiable'
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

async function statOrNull(filePath) {
  try {
    return await fs.promises.stat(filePath)
  } catch {
    return null
  }
}

function plain(status, text, extra) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra } })
}

function fileBody(filePath, opts) {
  return Readable.toWeb(fs.createReadStream(filePath, opts))
}

async function sendFile(request, filePath) {
  const stat = await statOrNull(filePath)
  if (!stat || !stat.isFile()) return plain(404, 'Not found')
  const size = stat.size
  const head = request.method === 'HEAD'
  const headers = {
    'Content-Type': contentType(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  }
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') return plain(416, '', { 'Content-Range': `bytes */${size}` })
  if (range) {
    return new Response(head ? null : fileBody(filePath, { start: range.start, end: range.end }), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }
  return new Response(head || size === 0 ? null : fileBody(filePath), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  })
}

// One request to app://music/... Never throws: a bad path is 400, a missing file 404, anything else 500.
async function serve(root, request) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method not allowed')
    let pathname
    try {
      pathname = new URL(request.url).pathname
    } catch {
      return plain(400, 'Bad path')
    }
    if (isApiPath(pathname)) return plain(404, 'Not in the desktop app')
    const target = resolveInRoot(root, pathname)
    if (!target) return plain(400, 'Bad path')
    const stat = await statOrNull(target)
    if (stat && stat.isFile()) return await sendFile(request, target)
    if (stat && stat.isDirectory()) {
      const index = path.join(target, 'index.html')
      const indexStat = await statOrNull(index)
      if (indexStat && indexStat.isFile()) return await sendFile(request, index)
    }
    // A route like /music has no extension. Hand it the page and let the router take it.
    if (!path.extname(target)) return await sendFile(request, path.join(root, 'index.html'))
    return plain(404, 'Not found')
  } catch (err) {
    console.error('app:// request failed', err)
    return plain(500, 'Read failed')
  }
}

module.exports = { MIME, contentType, isApiPath, parseRange, resolveInRoot, serve }

import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import macrosPlugin from 'vite-plugin-babel-macros'
import dynamicImport from 'vite-plugin-dynamic-import'
import imagePresets, { widthPreset } from 'vite-plugin-image-presets'
import { verifyMessage } from 'viem'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'
import svgr from 'vite-plugin-svgr'

import { BODY_LIMIT } from './api/_lib/body'
import { handleMarketRequest, MARKET_PREFIX, memoryCache, openSeaReader } from './api/_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './api/_lib/opensea'
import { handlePublicAccessRequest, memoryTapeStore, PUBLIC_ACCESS_PATH, youtubeLookup } from './api/_lib/publicaccess'
import { kickOnAir, kickReader } from './api/_lib/tvkick'
import { handleTvLiveRequest, TV_LIVE_PATH } from './api/_lib/tvlive'
import { gatewayContentType, handleStationRequest, memoryStore, STATION_PATH } from './api/_lib/station'
import { clientKey, createRateLimiter, handleZeroExRequest, PROXY_PREFIX, sameOrigin } from './api/_lib/zeroex'

/** The Worker's POST cap (api/_lib/body.ts) for the dev stand-ins: a 413 (and undefined) when the body says it is too
 * large, otherwise at most BODY_LIMIT bytes of it. */
async function devBody(req: IncomingMessage, res: ServerResponse): Promise<string | undefined> {
  if (req.method !== 'POST') return ''
  if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) {
    res.statusCode = 413
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'That is too large.' }))
    return undefined
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const piece = (typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)).subarray(0, BODY_LIMIT - size)
    chunks.push(piece)
    size += piece.byteLength
    if (size >= BODY_LIMIT) break
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Dev-only stand-in for the Worker's 0x routes (api/worker.ts): same validation and key injection
 * (api/_lib/zeroex.ts). ZEROX_API_KEY is read from the shell or app/.env.local and
 * are never exposed to the client bundle (no VITE_ prefix).
 */
function zeroExDevProxy(env: Record<string, string>): Plugin {
  return {
    name: 'miya-0x-dev-proxy',
    configureServer(server) {
      server.middlewares.use(PROXY_PREFIX, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const host = req.headers.host || 'localhost'
        const response = await handleZeroExRequest(
          { method: req.method || 'GET', url: `http://${host}${PROXY_PREFIX}${req.url || ''}`, headers },
          { ZEROX_API_KEY: process.env.ZEROX_API_KEY || env.ZEROX_API_KEY }
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

/** Dev-only stand-in for the Worker's OpenSea route (api/_lib/opensea.ts). OPENSEA_API_KEY from the shell or app/.env.local. */
function openSeaDevProxy(env: Record<string, string>): Plugin {
  const guards = {
    sameOrigin,
    clientKey,
    readLimiter: createRateLimiter({ capacity: 120, perSecond: 2 }),
    fillLimiter: createRateLimiter({ capacity: 10, perSecond: 0.2 }),
  }
  return {
    name: 'miya-opensea-dev-proxy',
    configureServer(server) {
      server.middlewares.use(OPENSEA_PROXY_PATH, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const body = await devBody(req, res)
        if (body === undefined) return

        const host = req.headers.host || 'localhost'
        const rest = req.url && req.url !== '/' ? req.url.replace(/^\/(?=\?)/, '') : ''
        const response = await handleOpenSeaRequest(
          { method: req.method || 'GET', url: `http://${host}${OPENSEA_PROXY_PATH}${rest}`, headers, body },
          { OPENSEA_API_KEY: process.env.OPENSEA_API_KEY || env.OPENSEA_API_KEY },
          guards
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

/** Dev-only stand-in for the Worker's market route. OPENSEA_API_KEY from the shell or app/.env.local. */
function marketDevProxy(env: Record<string, string>): Plugin {
  const cache = memoryCache()
  const limiter = createRateLimiter({ capacity: 200, perSecond: 5 })
  return {
    name: 'miya-market-dev-proxy',
    configureServer(server) {
      server.middlewares.use(MARKET_PREFIX, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const response = await handleMarketRequest(
          { method: req.method || 'GET', url: `http://${req.headers.host || 'localhost'}${MARKET_PREFIX}${req.url || ''}`, headers },
          {
            openSea: openSeaReader(process.env.OPENSEA_API_KEY || env.OPENSEA_API_KEY, quoteBigInts),
            cache,
            sameOrigin,
            clientKey,
            limiter,
          }
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

/** Dev-only stand-in for the Worker's station route, kept in memory. STATION_ADMINS from the shell. */
function stationDevProxy(): Plugin {
  const store = memoryStore()
  const limiter = createRateLimiter({ capacity: 200, perSecond: 5 })
  return {
    name: 'miya-station-dev-proxy',
    configureServer(server) {
      server.middlewares.use(STATION_PATH, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const body = await devBody(req, res)
        if (body === undefined) return
        const host = req.headers.host || 'localhost'
        const rest = req.url && req.url !== '/' ? req.url : ''
        const response = await handleStationRequest(
          { method: req.method || 'GET', url: `http://${host}${STATION_PATH}${rest}`, headers, body },
          {
            store,
            admins: (process.env.STATION_ADMINS ?? '').split(',').filter(Boolean),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verify: (address, message, signature) => verifyMessage({ address: address as any, message, signature: signature as any }).catch(() => false),
            contentType: gatewayContentType,
            sameOrigin,
            clientKey,
            limiter,
          }
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

/** Dev-only stand-in for the Worker's stream lookup. YOUTUBE_API_KEY from the shell or app/.env.local. */
function tvLiveDevProxy(env: Record<string, string>): Plugin {
  const cache = memoryCache()
  return {
    name: 'miya-tv-live-dev-proxy',
    configureServer(server) {
      server.middlewares.use(TV_LIVE_PATH, async (req, res) => {
        const response = await handleTvLiveRequest(
          { method: req.method || 'GET' },
          {
            key: process.env.YOUTUBE_API_KEY || env.YOUTUBE_API_KEY,
            cache,
            kick: () => kickOnAir({ read: kickReader, cache, now: Date.now() }),
          }
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

/** Dev-only stand-in for the Worker's public access route, kept in memory. STATION_ADMINS from the shell. */
function publicAccessDevProxy(): Plugin {
  const store = memoryTapeStore()
  const limiter = createRateLimiter({ capacity: 200, perSecond: 5 })
  return {
    name: 'miya-public-access-dev-proxy',
    configureServer(server) {
      server.middlewares.use(PUBLIC_ACCESS_PATH, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const body = await devBody(req, res)
        if (body === undefined) return
        const host = req.headers.host || 'localhost'
        const rest = req.url && req.url !== '/' ? req.url : ''
        const response = await handlePublicAccessRequest(
          { method: req.method || 'GET', url: `http://${host}${PUBLIC_ACCESS_PATH}${rest}`, headers, body },
          {
            store,
            admins: (process.env.STATION_ADMINS ?? '').split(',').filter(Boolean),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verify: (address, message, signature) => verifyMessage({ address: address as any, message, signature: signature as any }),
            lookup: youtubeLookup,
            sameOrigin,
            clientKey,
            limiter,
          }
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [
    zeroExDevProxy(loadEnv(mode, __dirname, ['ZEROX_'])),
    openSeaDevProxy(loadEnv(mode, __dirname, ['OPENSEA_'])),
    stationDevProxy(),
    publicAccessDevProxy(),
    tvLiveDevProxy(loadEnv(mode, __dirname, ['YOUTUBE_'])),
    marketDevProxy(loadEnv(mode, __dirname, ['OPENSEA_'])),
    react(),
    dynamicImport(),
    svgr(),
    macrosPlugin(),
    imagePresets({
      pattern: widthPreset({
        loading: 'eager',
        widths: [2],
        formats: {
          webp: { quality: 100 },
        },
      }),
      icon: widthPreset({
        loading: 'eager',
        widths: [16, 60],
        formats: {
          webp: { quality: 50 },
        },
      }),
      thumbnail: widthPreset({
        loading: 'lazy',
        widths: [120, 170],
        formats: {
          webp: { quality: 50 },
        },
      }),
      // Screensaver art: one sharp size (bounced at up to ~240 device px on retina).
      art: widthPreset({
        widths: [480],
        formats: {
          webp: { quality: 82 },
        },
      }),
      banner: widthPreset({
        class: 'banner',
        loading: 'eager',
        widths: [500],
        formats: {
          webp: { quality: 50 },
        },
      }),
      avatar: widthPreset({
        loading: 'lazy',
        widths: [325],
        formats: {
          webp: { quality: 50 },
        },
      }),
    }),
    nodePolyfills({
      // Whether to polyfill specific globals.
      globals: {
        Buffer: true, // can also be 'build', 'dev', or false
        global: true,
        process: true,
      },
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon1.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'miyamaker',
        short_name: 'miyamaker',
        description: 'miyaOS: mint, launch and manage aligned NFT collections.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#6f6894',
        theme_color: '#a9a3c9',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Minimal app-shell cache: code, styles, fonts and icons. Chain data (RPC) stays network-only.
        globPatterns: ['index.html', 'assets/*.css', 'fonts/**/*.{woff,woff2}', 'icons/*.png', 'favicon1.png'],
        // The radio's CJK fonts load when such a title comes on, not with the app.
        globIgnores: ['fonts/fusion-pixel/**'],
        runtimeCaching: [
          // JS chunks are hashed; cache them as they are fetched instead of precaching every wallet SDK chunk.
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'script',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'miyaos-js', expiration: { maxEntries: 120 } },
          },
          // Bundled images under /assets/ (thumbnails, icons) have hashed file names, so cache-first is safe.
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin && request.destination === 'image' && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'miyaos-images', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          // NFT artwork on IPFS / Arweave is content-addressed: once fetched it never changes, so serve it from the
          // cache. CORS responses only (NftImage/ArtViewer load IPFS with crossorigin) so the quota is not eaten by
          // padded opaque responses. Expiry keeps the cache bounded (originals can be several MB each).
          {
            urlPattern: ({ url, request }) =>
              request.destination === 'image' &&
              (/\/ipfs\/[a-z0-9]{46,}/i.test(url.pathname) ||
                /\.ipfs\./i.test(url.hostname) ||
                /(^|\.)(arweave\.net|irys\.xyz)$/i.test(url.hostname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nft-art',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          // IPFS metadata JSON (tokenURI / contractURI): immutable too.
          {
            urlPattern: ({ url, request }) =>
              request.destination === '' &&
              (/\/ipfs\/[a-z0-9]{46,}/i.test(url.pathname) || /\.ipfs\./i.test(url.hostname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nft-metadata',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Mutable metadata on plain https hosts (e.g. koolskull.com/.../metadata/json/<id>): show the cached copy
          // straight away and refresh it in the background.
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              !sameOrigin && request.destination === '' && /\/metadata\/|\.json$/i.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nft-metadata-mutable',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Other NFT artwork hosts we show (MIYAMINI images on koolskull.com): no CORS there, so these are opaque
          // responses; keep the entry count small.
          {
            urlPattern: ({ url, request }) =>
              request.destination === 'image' && /(^|\.)koolskull\.com$/i.test(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nft-art-other',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 7, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/surf(\/|$)/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // No source maps in the deployed bundle: 'hidden' would still copy the .map files into dist/ (and so publish them).
    sourcemap: false,
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: 'abis', replacement: path.resolve(__dirname, 'abis') },
      {
        find: 'typechain',
        replacement: path.resolve(__dirname, './typechain'),
      },
      { find: 'assets', replacement: path.resolve(__dirname, 'src/assets') },
    ],
  },
  optimizeDeps: {
    disabled: 'build',
  },
  server: {
    fs: {
      // constants/contracts.ts bundles ../contracts/deployments/<chainId>.json (miyamints addresses).
      allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(__dirname, '../contracts/deployments')],
    },
  },
}))

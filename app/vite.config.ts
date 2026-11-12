import react from '@vitejs/plugin-react'
import fs from 'fs'
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

import { ALLOWLIST_BODY_LIMIT, ALLOWLIST_PATH, handleAllowlistRequest, memoryAllowlistStore } from './api/_lib/allowlist'
import { BODY_LIMIT } from './api/_lib/body'
import { handleMarketRequest, MARKET_PREFIX, memoryCache, openSeaReader } from './api/_lib/market'
import { handleOpenSeaRequest, OPENSEA_PROXY_PATH, quoteBigInts } from './api/_lib/opensea'
import { handlePublicAccessRequest, memoryTapeStore, PUBLIC_ACCESS_PATH, youtubeLookup } from './api/_lib/publicaccess'
import { handleNftRequest, handleRpcRequest, NFT_PREFIX, RPC_BODY_LIMIT, RPC_PREFIX } from './api/_lib/rpc'
import { handleSampleMediaRequest, SAMPLE_MEDIA_PATH, SAMPLE_MEDIA_RATE } from './api/_lib/samplemedia'
import { kickOnAir, kickReader } from './api/_lib/tvkick'
import { handleVideoAudioRequest, VIDEO_AUDIO_COST, VIDEO_AUDIO_PATH, VIDEO_AUDIO_RATE } from './api/_lib/videoaudio'
import { handleTvLiveRequest, TV_LIVE_PATH } from './api/_lib/tvlive'
import { gatewayContentType, handleStationRequest, memoryStore, STATION_PATH } from './api/_lib/station'
import { clientKey, createRateLimiter, handleZeroExRequest, PROXY_PREFIX, sameOrigin } from './api/_lib/zeroex'

/** The Worker's POST cap (api/_lib/body.ts) for the dev stand-ins: a 413 (and undefined) when the body says it is too
 * large, otherwise at most BODY_LIMIT bytes of it. */
async function devBody(req: IncomingMessage, res: ServerResponse, limit = BODY_LIMIT): Promise<string | undefined> {
  if (req.method !== 'POST') return ''
  if (Number(req.headers['content-length'] ?? 0) > limit) {
    res.statusCode = 413
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'That is too large.' }))
    return undefined
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const piece = (typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)).subarray(0, limit - size)
    chunks.push(piece)
    size += piece.byteLength
    if (size >= limit) break
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The request's headers for the dev stand-ins, with the client address taken from the socket: the limiters key on
 * cf-connecting-ip, then x-real-ip / x-forwarded-for, and any page or script could set those itself.
 */
function devHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  for (const k of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) headers.delete(k)
  headers.set('cf-connecting-ip', req.socket.remoteAddress || 'unknown')
  return headers
}

/**
 * The host the dev stand-ins build their own origin from (for the same-origin check): only a loopback or IP-literal
 * host, so a page on another name pointed at this machine (DNS rebinding) is not taken for this one.
 */
function devHost(req: IncomingMessage): string {
  const host = req.headers.host || ''
  return /^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d{1,5})?$/i.test(host) ? host : 'localhost'
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
        const headers = devHeaders(req)
        const host = devHost(req)
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

/**
 * Dev-only stand-in for the Worker's keyed RPC and NFT index (api/_lib/rpc.ts). RPC_URL_<chainId> and ALCHEMY_API_KEY
 * from the shell or app/.env.local (no VITE_ prefix, never bundled). Unset = the page uses public RPCs, as in production.
 */
function rpcDevProxy(env: Record<string, string>): Plugin {
  const pick = (name: string) => process.env[name] || env[name]
  const guards = { sameOrigin, clientKey, limiter: createRateLimiter({ capacity: 600, perSecond: 20 }) }
  const send = async (res: ServerResponse, response: Response) => {
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(await response.text())
  }
  return {
    name: 'miya-rpc-dev-proxy',
    configureServer(server) {
      server.middlewares.use(RPC_PREFIX, async (req, res) => {
        const body = await devBody(req, res, RPC_BODY_LIMIT)
        if (body === undefined) return
        const response = await handleRpcRequest(
          {
            method: req.method || 'GET',
            url: `http://${devHost(req)}${RPC_PREFIX}${req.url || ''}`,
            headers: devHeaders(req),
            body: req.method === 'POST' ? body : undefined,
          },
          { RPC_URL_1: pick('RPC_URL_1'), RPC_URL_11155111: pick('RPC_URL_11155111'), RPC_URL_4663: pick('RPC_URL_4663') },
          guards
        )
        await send(res, response)
      })
      server.middlewares.use(NFT_PREFIX, async (req, res) => {
        const response = await handleNftRequest(
          { method: req.method || 'GET', url: `http://${devHost(req)}${NFT_PREFIX}${req.url || ''}`, headers: devHeaders(req) },
          { ALCHEMY_API_KEY: pick('ALCHEMY_API_KEY') },
          guards
        )
        await send(res, response)
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
        const headers = devHeaders(req)
        const body = await devBody(req, res)
        if (body === undefined) return

        const host = devHost(req)
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
        const headers = devHeaders(req)
        const response = await handleMarketRequest(
          { method: req.method || 'GET', url: `http://${devHost(req)}${MARKET_PREFIX}${req.url || ''}`, headers },
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
        const headers = devHeaders(req)
        const body = await devBody(req, res)
        if (body === undefined) return
        const host = devHost(req)
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

/** Dev-only stand-in for the Worker's allowlist route: shipped lists from public/allowlists/, pasted ones in memory. */
function allowlistDevProxy(): Plugin {
  const store = memoryAllowlistStore()
  const limiter = createRateLimiter({ capacity: 600, perSecond: 20 })
  return {
    name: 'miya-allowlist-dev-proxy',
    configureServer(server) {
      server.middlewares.use(ALLOWLIST_PATH, async (req, res) => {
        const body = await devBody(req, res, ALLOWLIST_BODY_LIMIT)
        if (body === undefined) return
        const rest = req.url && req.url !== '/' ? req.url : ''
        const response = await handleAllowlistRequest(
          { method: req.method || 'GET', url: `http://${devHost(req)}${ALLOWLIST_PATH}${rest}`, headers: devHeaders(req), body },
          {
            // No file is no list; any other failure throws, as the Worker's does.
            readStatic: async (root) => {
              const file = path.resolve(__dirname, 'public/allowlists', `${root}.json`)
              const text = await fs.promises.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
                if (e.code === 'ENOENT') return undefined
                throw e
              })
              return text === undefined ? undefined : JSON.parse(text)
            },
            store,
            sameOrigin,
            clientKey,
            limiter,
            writeLimiter: limiter,
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

/** Dev-only stand-in for the Worker's sample-media route. Hosts are allowlisted in api/_lib/samplemedia.ts. */
function sampleMediaDevProxy(): Plugin {
  const limiter = createRateLimiter(SAMPLE_MEDIA_RATE)
  return {
    name: 'miya-sample-media-dev-proxy',
    configureServer(server) {
      server.middlewares.use(SAMPLE_MEDIA_PATH, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const host = req.headers.host || 'localhost'
        // Connect leaves a "/" where the mount path was; the handler, like the Worker, answers the exact path only.
        const rest = (req.url || '').replace(/^\/(?=\?|$)/, '')
        const response = await handleSampleMediaRequest(
          { method: req.method || 'GET', url: `http://${host}${SAMPLE_MEDIA_PATH}${rest}`, headers },
          { sameOrigin, clientKey, limiter }
        )
        res.statusCode = response.status
        // Every header, so dev serves the same nosniff / sandbox / attachment answer as the Worker.
        response.headers.forEach((value, key) => res.setHeader(key, value))
        try {
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch {
          res.destroy()
        }
      })
    },
  }
}

/** Dev-only stand-in for the Worker's video-audio route. Page hosts are checked in api/_lib/videoaudio.ts. */
function videoAudioDevProxy(): Plugin {
  const limiter = createRateLimiter(VIDEO_AUDIO_RATE)
  return {
    name: 'miya-video-audio-dev-proxy',
    configureServer(server) {
      server.middlewares.use(VIDEO_AUDIO_PATH, async (req, res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const host = req.headers.host || 'localhost'
        // Connect leaves a "/" where the mount path was; the handler, like the Worker, answers the exact path only.
        const rest = (req.url || '').replace(/^\/(?=\?|$)/, '')
        const response = await handleVideoAudioRequest(
          { method: req.method || 'GET', url: `http://${host}${VIDEO_AUDIO_PATH}${rest}`, headers },
          { sameOrigin, clientKey, limiter, cost: VIDEO_AUDIO_COST }
        )
        res.statusCode = response.status
        // Every header, so dev serves the same nosniff / sandbox / attachment answer as the Worker.
        response.headers.forEach((value, key) => res.setHeader(key, value))
        try {
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch {
          res.destroy()
        }
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
        const headers = devHeaders(req)
        const body = await devBody(req, res)
        if (body === undefined) return
        const host = devHost(req)
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
    rpcDevProxy(loadEnv(mode, __dirname, ['RPC_URL_', 'ALCHEMY_API_KEY'])),
    zeroExDevProxy(loadEnv(mode, __dirname, ['ZEROX_'])),
    openSeaDevProxy(loadEnv(mode, __dirname, ['OPENSEA_'])),
    stationDevProxy(),
    allowlistDevProxy(),
    publicAccessDevProxy(),
    sampleMediaDevProxy(),
    videoAudioDevProxy(),
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
        // /embed/* are pages of their own (the miyakeys window's frame), not the desktop.
        navigateFallbackDenylist: [/^\/api\//, /^\/surf(\/|$)/, /^\/embed\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // No source maps in the deployed bundle: 'hidden' would still copy the .map files into dist/ (and so publish them).
    sourcemap: false,
    rollupOptions: {
      // The desktop, and miyakeys as its own page for its window's frame (src/pages/Miyakeys).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        miyakeys: path.resolve(__dirname, 'embed/miyakeys/index.html'),
      },
    },
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

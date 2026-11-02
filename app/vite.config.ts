import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import macrosPlugin from 'vite-plugin-babel-macros'
import dynamicImport from 'vite-plugin-dynamic-import'
import imagePresets, { widthPreset } from 'vite-plugin-image-presets'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'
import svgr from 'vite-plugin-svgr'

import { handleZeroExRequest, PROXY_PREFIX } from './api/_lib/zeroex'

/**
 * Dev-only stand-in for the Vercel functions in api/0x: same validation and key injection
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

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [
    zeroExDevProxy(loadEnv(mode, __dirname, ['ZEROX_'])),
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
        navigateFallbackDenylist: [/^\/api\//],
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

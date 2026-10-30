import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import macrosPlugin from 'vite-plugin-babel-macros'
import dynamicImport from 'vite-plugin-dynamic-import'
import imagePresets, { widthPreset } from 'vite-plugin-image-presets'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  base: '',
  plugins: [
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
        // Minimal app-shell cache: code, styles, fonts and icons. Artwork and chain data stay network-only.
        globPatterns: ['index.html', 'assets/*.css', 'fonts/**/*.{woff,woff2}', 'icons/*.png', 'favicon1.png'],
        // JS chunks are hashed; cache them as they are fetched instead of precaching every wallet SDK chunk.
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'script',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'miyaos-js', expiration: { maxEntries: 120 } },
          },
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: true,
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
})

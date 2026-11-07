// src/components/ErrorBoundary/chunkError.ts: a chunk that failed to load needs a page reload, in every browser's words. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChunkLoadError } from '../src/components/ErrorBoundary/chunkError.ts'

test("every browser's wording of a failed chunk is recognised, and an ordinary crash is not", () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://miya/x.js',
    'error loading dynamically imported module: https://miya/x.js',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'Unable to preload CSS for /assets/x.css',
  ]) {
    assert.equal(isChunkLoadError(message), true, message)
  }

  assert.equal(isChunkLoadError("Cannot read properties of undefined (reading 'x')"), false)
})

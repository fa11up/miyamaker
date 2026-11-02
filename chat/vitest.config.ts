import { defineConfig } from 'vitest/config'

// Pure-logic tests in plain Node (no workers pool): room.ts / index.ts import cloudflare:workers and are
// exercised by the wrangler dev smoke test instead.
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})

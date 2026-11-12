// Lets node:test load app modules that import siblings the way Vite and wrangler do: `./tokens` (no extension) and `@/x`,
// from src/ and from api/ (the Worker).
// Import it first, then load the module under test with `await import(...)`: static imports resolve before any code.
import * as nodeModule from 'node:module'

const SRC = new URL('../src/', import.meta.url)
const API = new URL('../api/', import.meta.url)
type ResolveContext = { parentURL?: string } & Record<string, unknown>
type Resolve = (specifier: string, context: ResolveContext) => unknown
// registerHooks is Node 22.15+; the repo's @types/node doesn't declare it yet, so it is typed here.
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: { resolve: (specifier: string, context: ResolveContext, next: Resolve) => unknown }) => void
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, SRC).href, context)
    const parent = context.parentURL ?? ''
    const fromSrc = parent.startsWith(SRC.href) || parent.startsWith(API.href)
    if (fromSrc && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return next(`${specifier}.ts`, context)
    }
    return next(specifier, context)
  },
})

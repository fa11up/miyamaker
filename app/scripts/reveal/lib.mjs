// Shared by the reveal scripts (prepare, load, attach, verify, arweave): flags, log lines, the site's admin routes and
// the verifier's check. The draw itself is api/_lib/revealdraw.mjs and the piece hashing api/_lib/revealpiece.mjs, the
// same files the Worker runs.
import { CONFIRMATIONS, drawFor, newPool } from '../../api/_lib/revealdraw.mjs'

/** --name value and bare --flag (true). Unknown flags are refused, so a typo never silently does the default. */
export function parseArgs(argv, known) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`)
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2)
    if (!(name in known))
      throw new Error(
        `Unknown flag --${name}. Known: ${Object.keys(known)
          .map((k) => `--${k}`)
          .join(' ')}`
      )
    if (known[name] === 'flag') out[name] = true
    else if (inline !== undefined) out[name] = inline
    else {
      const v = argv[(i += 1)]
      if (v === undefined) throw new Error(`--${name} needs a value`)
      out[name] = v
    }
  }
  return out
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
export const log = (msg) => {
  for (const line of String(msg).split('\n')) console.log(`${stamp()} | ${line}`)
}

/** Runs `main`, printing a thrown error's message (not a stack) and exiting non-zero. */
export async function run(main) {
  try {
    process.exitCode = (await main()) ?? 0
  } catch (e) {
    log(`error: ${e?.message ?? e}`)
    process.exitCode = 2
  }
}

/** The admin key from the environment. Never printed. */
export function adminKey() {
  const k = process.env.REVEAL_ADMIN_KEY?.trim()
  if (!k || k.length < 32) throw new Error('Set REVEAL_ADMIN_KEY (32+ characters) in the environment.')
  return k
}

/** A site's reveal base, e.g. https://www.miyamaker.com + miyamaker -> https://www.miyamaker.com/reveal/miyamaker */
export const revealBase = (site, slug) => `${site.replace(/\/+$/, '')}/reveal/${slug}`

export const isLocalSite = (site) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(site).hostname)

/**
 * One admin request. Retries network errors, 429 and 5xx (with backoff) `tries` times; any other answer is returned.
 * Throws when the last try still failed.
 */
export async function admin(base, path, { method = 'GET', body, key, tries = 4, contentType, headers = {} } = {}) {
  let last
  for (let t = 0; t < tries; t += 1) {
    if (t) await new Promise((r) => setTimeout(r, 500 * 2 ** t))
    try {
      const res = await fetch(`${base}/admin/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body !== undefined ? { 'content-type': contentType ?? 'application/json' } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(120_000),
      })
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = { error: text.slice(0, 200) }
      }
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${method} ${path}: ${res.status} ${data.error ?? ''}`)
        continue
      }
      return { status: res.status, data }
    } catch (e) {
      last = e
    }
  }
  throw last
}

/** GET a public JSON file (a URL) or read it from disk (a path). */
export async function readJson(where) {
  if (/^https?:\/\//.test(where)) {
    const res = await fetch(where, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`${where}: ${res.status}`)
    return res.json()
  }
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(where, 'utf8'))
}

/** Runs `work(item)` over `items`, `n` at a time. */
export async function pool(items, n, work) {
  let next = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      await work(items[i], i)
    }
  })
  await Promise.all(workers)
}

/**
 * The verifier's check: redoes every draw from chain data and compares it with the published list.
 *   mints      [{ tokenId, block, blockHash }] from the chain (Transfer from 0x0), all of them
 *   headers    Map block number -> { number, hash, parentHash, mixHash } for each mint block + 1 that exists
 *   head       the newest block
 *   published  assignments.json's `assignments`
 * Returns { problems: string[], checked, pending }: pending = minted tokens the chain can already draw but the list
 * does not have yet (the site's cron runs every minute, so a few are normal right after a mint).
 */
export function checkDraws({ supply, mints, headers, head, published }) {
  const problems = []
  const byToken = new Map()
  for (const a of published) {
    if (byToken.has(a.token)) problems.push(`token ${a.token} is listed twice`)
    byToken.set(a.token, a)
  }
  const sorted = [...mints].sort((a, b) => a.tokenId - b.tokenId)
  const pool = newPool(supply)
  let checked = 0
  let pending = 0
  let stop = false // a token that can't be drawn yet: nor can any after it
  for (const [k, m] of sorted.entries()) {
    if (m.tokenId !== k + 1) {
      problems.push(`the chain's mints skip from token ${k} to ${m.tokenId}`)
      break
    }
    const a = byToken.get(m.tokenId)
    const next = headers.get(m.block + 1)
    if (stop || m.block + CONFIRMATIONS > head || !next) {
      stop = true
      if (a) problems.push(`token ${m.tokenId} is listed before the chain can draw it (block ${m.block}, head ${head})`)
      continue
    }
    let d
    try {
      d = drawFor(pool, m, next)
    } catch (e) {
      problems.push(`token ${m.tokenId}: ${e.message}`)
      break
    }
    if (!a) {
      pending += 1
      continue
    }
    if (pending) problems.push(`token ${m.tokenId} is listed after an unlisted token`)
    checked += 1
    const want = {
      piece: d.piece,
      mintBlock: m.block,
      mintBlockHash: m.blockHash,
      seedBlock: d.seedBlock,
      seedBlockHash: d.seedBlockHash,
      seed: d.seed,
    }
    for (const [field, value] of Object.entries(want)) {
      const got = typeof a[field] === 'string' ? a[field].toLowerCase() : a[field]
      if (got !== value) problems.push(`token ${m.tokenId}: ${field} is ${a[field]}, the chain gives ${value}`)
    }
  }
  const minted = new Set(sorted.map((m) => m.tokenId))
  for (const t of byToken.keys()) if (!minted.has(t)) problems.push(`token ${t} is listed but was never minted`)
  return { problems, checked, pending }
}

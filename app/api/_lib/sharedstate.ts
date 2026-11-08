/**
 * A cache every data centre shares, for answers that cost quota to refresh (miyatv's YouTube and Kick lookups). The
 * Cloudflare Cache API is per data centre, so with only that each one refreshes on its own and pays for it; this keeps one
 * copy in D1 (the `DB` binding, table shared_state from migrations/0003_hardening.sql), with a lock (`claim`) so one
 * refresh runs at a time anywhere.
 *
 * It has the same shape as the market cache (MarketCache), so tvlive.ts and tvkick.ts take either. When the table is
 * missing (a deploy before the migration) or D1 fails, it falls back to the cache it was given and tries D1 again after a
 * few minutes, so nothing breaks and the migration takes effect without a redeploy.
 *
 * No value imports, so `node --test` loads it directly (tests/tvlive-shared.test.mts).
 */
import type { MarketCache } from './market'
import type { D1Like } from './station'

export type SharedEntry = { at: number; body: unknown }

/** A MarketCache that can also lock a key for one refresh. */
export type SharedCache = MarketCache & {
  /**
   * Takes the refresh lock on `key` for `holdMs`. False when someone else holds it, or when the entry was saved at or
   * after `staleBefore` (someone just refreshed it). True when there is no shared store to lock.
   */
  claim?: (key: string, now: number, holdMs: number, staleBefore: number) => Promise<boolean>
}

export interface SharedState {
  get(key: string, now: number): Promise<SharedEntry | undefined>
  claim(key: string, now: number, holdMs: number, staleBefore: number): Promise<boolean>
  /** Saves the entry, kept until `expiresAt`, and lets the lock go. */
  put(key: string, value: SharedEntry, expiresAt: number): Promise<void>
}

/** D1 reports a missing table or column this way (SQLite's words). */
export const missingTable = (e: unknown) =>
  /no such (table|column)|has no column/i.test(String((e as Error)?.message ?? e))

export const d1SharedState = (db: D1Like): SharedState => ({
  get: async (key, now) => {
    const r = await db.prepare('SELECT body, at, expires_at FROM shared_state WHERE key = ?').bind(key).first()
    // at = 0 is a row made only to hold the lock.
    if (!r || !Number(r.at) || Number(r.expires_at) < now) return undefined
    try {
      return { at: Number(r.at), body: JSON.parse(String(r.body)) as unknown }
    } catch {
      return undefined
    }
  },
  claim: async (key, now, holdMs, staleBefore) => {
    // The row has to exist before it can be locked.
    await db
      .prepare("INSERT OR IGNORE INTO shared_state (key, body, at, expires_at, lock_until) VALUES (?, 'null', 0, 0, 0)")
      .bind(key)
      .run()
    const r = await db
      .prepare('UPDATE shared_state SET lock_until = ? WHERE key = ? AND lock_until <= ? AND (at < ? OR expires_at < ?)')
      .bind(now + holdMs, key, now, staleBefore, now)
      .run()
    return r.meta.changes > 0
  },
  put: async (key, value, expiresAt) => {
    await db
      .prepare(
        'INSERT INTO shared_state (key, body, at, expires_at, lock_until) VALUES (?, ?, ?, ?, 0) ON CONFLICT (key) DO UPDATE SET body = excluded.body, at = excluded.at, expires_at = excluded.expires_at, lock_until = 0'
      )
      .bind(key, JSON.stringify(value.body), value.at, expiresAt)
      .run()
  },
})

/** Tests and the dev server. */
export function memorySharedState(): SharedState & {
  rows: Map<string, SharedEntry & { expiresAt: number; lockUntil: number }>
} {
  const rows = new Map<string, SharedEntry & { expiresAt: number; lockUntil: number }>()
  return {
    rows,
    get: async (key, now) => {
      const r = rows.get(key)
      return r && r.at && r.expiresAt >= now ? { at: r.at, body: r.body } : undefined
    },
    claim: async (key, now, holdMs, staleBefore) => {
      const r = rows.get(key) ?? { at: 0, body: null, expiresAt: 0, lockUntil: 0 }
      if (r.lockUntil > now || (r.at >= staleBefore && r.expiresAt >= now)) return false
      rows.set(key, { ...r, lockUntil: now + holdMs })
      return true
    },
    put: async (key, value, expiresAt) => {
      rows.set(key, { ...value, expiresAt, lockUntil: 0 })
    },
  }
}

/** How long D1 is left alone after it fails, before it is tried again. */
export const SHARED_RETRY_MS = 5 * 60_000

/**
 * The shared store with `fallback` (the per-data-centre cache) behind it. `clock` is for the lock and expiry times; the
 * callers' own `at` values are kept as they give them.
 */
export function sharedCache(
  shared: SharedState | undefined,
  fallback: MarketCache,
  clock: () => number = Date.now,
  label = 'shared state'
): SharedCache {
  if (!shared) return fallback
  let downUntil = 0
  const down = (e: unknown) => {
    // Says so once per spell, so the logs name the fix without repeating it on every request.
    if (clock() >= downUntil)
      console.warn(
        missingTable(e)
          ? `${label}: shared_state table missing, using the per-data-centre cache (run the D1 migrations)`
          : `${label}: ${(e as Error)?.message ?? e}, using the per-data-centre cache`
      )
    downUntil = clock() + SHARED_RETRY_MS
  }
  const up = () => clock() >= downUntil
  return {
    get: async (key) => {
      if (up()) {
        try {
          return await shared.get(key, clock())
        } catch (e) {
          down(e)
        }
      }
      return fallback.get(key)
    },
    put: async (key, value, ttlSeconds = 15 * 60) => {
      if (up()) {
        try {
          await shared.put(key, value, clock() + ttlSeconds * 1000)
          return
        } catch (e) {
          down(e)
        }
      }
      await fallback.put(key, value, ttlSeconds)
    },
    claim: async (key, now, holdMs, staleBefore) => {
      if (!up()) return true
      try {
        return await shared.claim(key, now, holdMs, staleBefore)
      } catch (e) {
        down(e)
        return true
      }
    },
  }
}

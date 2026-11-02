/**
 * Token bucket per key: `capacity` tokens, refilled continuously at capacity / windowMs.
 * Pure (time is injected) and in-memory. A Durable Object loses it on hibernation/eviction,
 * which only ever makes the limiter more lenient for a moment, never stricter.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    readonly capacity: number,
    readonly windowMs: number,
    private readonly maxKeys = 10_000
  ) {}

  /** Takes one token. `retryAfterMs` is how long until one is available when refused. */
  take(key: string, now: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const prev = this.buckets.get(key)
    let tokens = this.capacity
    if (prev) tokens = Math.min(this.capacity, prev.tokens + (Math.max(0, now - prev.at) * this.capacity) / this.windowMs)
    // Small epsilon absorbs float error so exact refill boundaries count as refilled.
    if (tokens < 1 - 1e-9) {
      // A refused attempt leaves the bucket untouched, so hammering never extends the wait.
      return { ok: false, retryAfterMs: Math.ceil(((1 - tokens) * this.windowMs) / this.capacity) }
    }
    if (!prev && this.buckets.size >= this.maxKeys) this.prune(now)
    this.buckets.set(key, { tokens: tokens - 1, at: now })
    return { ok: true }
  }

  /** Drops buckets that have fully refilled (they behave the same as absent ones). */
  prune(now: number) {
    for (const [key, b] of this.buckets) if (now - b.at >= this.windowMs) this.buckets.delete(key)
    // Still full (sustained abuse from many keys): drop the oldest half.
    if (this.buckets.size >= this.maxKeys) {
      const keys = [...this.buckets.keys()].slice(0, Math.floor(this.buckets.size / 2))
      for (const k of keys) this.buckets.delete(k)
    }
  }

  get size() {
    return this.buckets.size
  }
}

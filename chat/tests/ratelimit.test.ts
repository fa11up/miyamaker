import { describe, expect, it } from 'vitest'

import { RateLimiter } from '../src/ratelimit'

describe('RateLimiter (token bucket)', () => {
  it('allows a burst of `capacity`, then refuses with retryAfter', () => {
    const rl = new RateLimiter(5, 10_000)
    for (let i = 0; i < 5; i++) expect(rl.take('a', 1000)).toEqual({ ok: true })
    const r = rl.take('a', 1000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterMs).toBe(2000) // one token per 2s
  })

  it('refills continuously', () => {
    const rl = new RateLimiter(5, 10_000)
    for (let i = 0; i < 5; i++) rl.take('a', 0)
    expect(rl.take('a', 1999).ok).toBe(false)
    expect(rl.take('a', 2000).ok).toBe(true)
    expect(rl.take('a', 2000).ok).toBe(false)
    expect(rl.take('a', 6000).ok).toBe(true) // 2 tokens accrued
    expect(rl.take('a', 6000).ok).toBe(true)
    expect(rl.take('a', 6000).ok).toBe(false)
    // full after a whole window
    for (let i = 0; i < 5; i++) expect(rl.take('a', 20_000).ok).toBe(true)
  })

  it('keys are independent', () => {
    const rl = new RateLimiter(1, 1000)
    expect(rl.take('a', 0).ok).toBe(true)
    expect(rl.take('a', 0).ok).toBe(false)
    expect(rl.take('b', 0).ok).toBe(true)
  })

  it('refused attempts do not extend the wait', () => {
    const rl = new RateLimiter(1, 1000)
    rl.take('a', 0)
    for (let t = 100; t < 1000; t += 100) expect(rl.take('a', t).ok).toBe(false)
    expect(rl.take('a', 1000).ok).toBe(true)
  })

  it('prunes refilled buckets and bounds memory', () => {
    const rl = new RateLimiter(2, 1000, 100)
    for (let i = 0; i < 100; i++) rl.take(`k${i}`, 0)
    expect(rl.size).toBe(100)
    rl.take('new', 5000) // everything refilled -> pruned
    expect(rl.size).toBe(1)
    for (let i = 0; i < 300; i++) rl.take(`x${i}`, 6000)
    expect(rl.size).toBeLessThanOrEqual(100)
  })
})

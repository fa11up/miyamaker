import { beforeEach, describe, expect, it } from 'vitest'

import { BadgeResolver, INFER, MIYAMINI, readHoldings } from '../src/badges'
import type { Badge, Msg, ServerFrame } from '../src/protocol'
import type { Conn, ConnMeta, KV } from '../src/room-core'
import { CONNECTION_LIMITS, RoomCore, STRIKES, VIEWERS_EVERY_MS } from '../src/room-core'

const A = '0x' + 'a'.repeat(40)
const B = '0x' + 'b'.repeat(40)
const MOD = '0x' + 'c'.repeat(40)

class MemKV implements KV {
  data = new Map<string, unknown>()
  async get<T>(k: string) {
    return structuredClone(this.data.get(k)) as T | undefined
  }
  async put<T>(k: string, v: T) {
    this.data.set(k, structuredClone(v))
  }
  async delete(k: string) {
    return this.data.delete(k)
  }
}

class FakeConn implements Conn {
  frames: ServerFrame[] = []
  meta: ConnMeta
  closed: { code: number; reason: string } | undefined
  constructor(ip = '1.1.1.1') {
    this.meta = { ip, address: null, badges: [], mod: false, exp: 0 }
  }
  send(d: string) {
    this.frames.push(JSON.parse(d))
  }
  getMeta() {
    return this.meta
  }
  setMeta(m: ConnMeta) {
    this.meta = m
  }
  close(code: number, reason: string) {
    this.closed = { code, reason }
  }
  last() {
    return this.frames[this.frames.length - 1]
  }
  of<T extends ServerFrame['t']>(t: T) {
    return this.frames.filter((f) => f.t === t) as Extract<ServerFrame, { t: T }>[]
  }
}

let now = 1_000_000
let conns: FakeConn[]
let storage: MemKV
let ids = 0
/** The pending Durable Object alarm, if any. */
let alarm: number | undefined

function makeRoom(kv = storage) {
  const badges = new BadgeResolver(async (a) => ({ miyamini: a === A, infer: false }), new Set([MOD]), () => now)
  return new RoomCore({
    storage: kv,
    now: () => now,
    connections: () => conns,
    // token == address, "expired" otherwise
    verifyToken: async (t) => (typeof t === 'string' && /^0x[a-f0-9]{40}$/.test(t) ? { address: t, exp: now + 3600_000 } : null),
    badgesFor: (a) => badges.badgesFor(a),
    isMod: (a) => badges.isMod(a),
    newId: () => `m${++ids}`,
    scheduleViewers: (at) => {
      alarm ??= at
    },
  })
}

async function join(room: RoomCore, ip?: string) {
  const c = new FakeConn(ip)
  conns.push(c)
  await room.onOpen(c, 'kick-markets')
  return c
}

const send = (room: RoomCore, c: Conn, frame: unknown) => room.onMessage(c, JSON.stringify(frame))

beforeEach(() => {
  now = 1_000_000
  conns = []
  storage = new MemKV()
  ids = 0
  alarm = undefined
})

/** Lets time pass to the pending alarm and runs it, as the runtime would. */
function fireAlarm(room: RoomCore) {
  if (alarm === undefined) return false
  now = Math.max(now, alarm)
  alarm = undefined
  room.onViewersDue()
  return true
}

describe('RoomCore', () => {
  it('hello with history/viewers; viewers sent on the next tick, not on every join/leave', async () => {
    const room = makeRoom()
    const a = await join(room)
    expect(a.frames[0]).toEqual({ t: 'hello', room: 'kick-markets', slowMode: 0, viewers: 1, history: [] })
    const b = await join(room, '2.2.2.2')
    // The new socket's hello is exact at once; the others hear nothing until the tick.
    expect(b.frames[0]).toMatchObject({ t: 'hello', viewers: 2 })
    expect(a.of('viewers')).toEqual([])
    expect(alarm).toBe(1_000_000 + VIEWERS_EVERY_MS)
    expect(fireAlarm(room)).toBe(true)
    expect(a.last()).toEqual({ t: 'viewers', count: 2 })
    expect(b.last()).toEqual({ t: 'viewers', count: 2 })

    conns = conns.filter((c) => c !== b)
    await room.onClose(b)
    fireAlarm(room)
    expect(a.last()).toEqual({ t: 'viewers', count: 1 })
  })

  it('a burst of joins and leaves is one viewers frame per tick, and none when the count is back where it was', async () => {
    const room = makeRoom()
    const a = await join(room)
    fireAlarm(room)
    expect(a.of('viewers')).toEqual([{ t: 'viewers', count: 1 }])
    for (let i = 0; i < 20; i++) await join(room, `9.9.9.${i}`)
    // One alarm for the whole burst.
    expect(alarm).toBe(now + VIEWERS_EVERY_MS)
    fireAlarm(room)
    expect(a.of('viewers')).toEqual([{ t: 'viewers', count: 1 }, { t: 'viewers', count: 21 }])
    expect(alarm).toBeUndefined()

    const c = await join(room, '8.8.8.8')
    conns = conns.filter((x) => x !== c)
    await room.onClose(c)
    fireAlarm(room)
    expect(a.of('viewers')).toHaveLength(2)
  })

  it('caps sockets per IP and per room', async () => {
    const room = makeRoom()
    for (let i = 0; i < CONNECTION_LIMITS.perIp; i++) {
      expect(room.admit('1.1.1.1')).toEqual({ ok: true })
      await join(room, '1.1.1.1')
    }
    expect(room.admit('1.1.1.1')).toMatchObject({ ok: false })
    expect(room.admit('2.2.2.2')).toEqual({ ok: true })
    // One leaving makes room for one more.
    conns.pop()
    expect(room.admit('1.1.1.1')).toEqual({ ok: true })

    conns = Array.from({ length: CONNECTION_LIMITS.perRoom }, (_, i) => new FakeConn(`10.0.${i >> 8}.${i & 255}`))
    expect(room.admit('3.3.3.3')).toEqual({ ok: false, message: 'room is full' })
  })

  it('closes a socket after too many bad or signed-out frames in a short while', async () => {
    const room = makeRoom()
    const a = await join(room)
    for (let i = 0; i < STRIKES.limit - 1; i++) await room.onMessage(a, i % 2 ? '{junk' : JSON.stringify({ t: 'send', text: 'hi' }))
    expect(a.closed).toBeUndefined()
    // Spread out, they never add up.
    now += STRIKES.windowMs
    for (let i = 0; i < STRIKES.limit - 1; i++) await send(room, a, { t: 'nope' })
    expect(a.closed).toBeUndefined()
    await send(room, a, { t: 'send', text: 'signed out' })
    expect(a.closed).toEqual({ code: 1008, reason: 'too many bad frames' })

    // Rate and slow-mode refusals are not strikes.
    const b = await join(room, '2.2.2.2')
    await send(room, b, { t: 'auth', token: B })
    for (let i = 0; i < 10; i++) await send(room, b, { t: 'send', text: `m${i}` })
    expect(b.of('err').some((e) => e.code === 'rate')).toBe(true)
    expect(b.closed).toBeUndefined()
  })

  it('read-only until auth; messages flow both ways with badges', async () => {
    const room = makeRoom()
    const a = await join(room)
    const b = await join(room, '2.2.2.2')
    await send(room, a, { t: 'send', text: 'hi' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'auth' })

    await send(room, a, { t: 'auth', token: A })
    expect(a.last()).toEqual({ t: 'me', me: { address: A, badges: ['miyamini'], mod: false } })
    await send(room, b, { t: 'auth', token: B })

    await send(room, a, { t: 'send', text: ' gm <b>bold</b> ' })
    const msgA = b.of('msg')[0]!.msg
    expect(msgA).toEqual({ id: 'm1', at: now, from: A, badges: ['miyamini'], text: 'gm <b>bold</b>' })
    await send(room, b, { t: 'send', text: 'gm back' })
    expect(a.of('msg').map((f) => f.msg.text)).toEqual(['gm <b>bold</b>', 'gm back'])
  })

  it('bad auth, junk frames, oversized frames', async () => {
    const room = makeRoom()
    const a = await join(room)
    await send(room, a, { t: 'auth', token: 'nope' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'auth' })
    await room.onMessage(a, '{not json')
    expect(a.last()).toMatchObject({ t: 'err', code: 'bad' })
    await send(room, a, { t: 'wat' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'bad' })
    await room.onMessage(a, JSON.stringify({ t: 'send', text: 'x'.repeat(3000) }))
    expect(a.last()).toMatchObject({ t: 'err', code: 'bad', message: 'frame too large' })
    await room.onMessage(a, new ArrayBuffer(4))
    expect(a.last()).toMatchObject({ t: 'err', code: 'bad' })
  })

  it('length and empty errors', async () => {
    const room = makeRoom()
    const a = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, a, { t: 'send', text: 'x'.repeat(281) })
    expect(a.last()).toMatchObject({ t: 'err', code: 'length' })
    await send(room, a, { t: 'send', text: `${String.fromCodePoint(0x200b)} \n` })
    expect(a.last()).toMatchObject({ t: 'err', code: 'empty' })
  })

  it('session expiry inside the socket drops back to read-only', async () => {
    const room = makeRoom()
    const a = await join(room)
    await send(room, a, { t: 'auth', token: A })
    now += 3600_001
    await send(room, a, { t: 'send', text: 'late' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'auth' })
    expect(a.meta.address).toBeNull()
  })

  it('per-address rate limit: 5 per 10s, with retryAfter', async () => {
    const room = makeRoom()
    const a = await join(room)
    await send(room, a, { t: 'auth', token: A })
    for (let i = 0; i < 5; i++) await send(room, a, { t: 'send', text: `m${i}` })
    await send(room, a, { t: 'send', text: 'too many' })
    expect(a.last()).toEqual({ t: 'err', code: 'rate', message: 'slow down', retryAfter: 2 })
    now += 2000
    await send(room, a, { t: 'send', text: 'ok again' })
    expect(a.last()).toMatchObject({ t: 'msg' })
  })

  it('per-IP rate limit spans addresses on the same IP', async () => {
    const room = makeRoom()
    const addrs = ['1', '2', '3'].map((d) => '0x' + d.repeat(40))
    const cs = []
    for (const addr of addrs) {
      const c = await join(room, '9.9.9.9')
      await send(room, c, { t: 'auth', token: addr })
      cs.push(c)
    }
    for (let i = 0; i < 10; i++) await send(room, cs[i % 3]!, { t: 'send', text: `x${i}` })
    const c = cs[1]!
    await send(room, c, { t: 'send', text: 'eleventh' })
    expect(c.last()).toMatchObject({ t: 'err', code: 'rate' })
  })

  it('keeps only the last 100 messages, persisted across a fresh core (hibernation)', async () => {
    const room = makeRoom()
    const a = await join(room)
    await send(room, a, { t: 'auth', token: A })
    for (let i = 0; i < 105; i++) {
      now += 2001
      await send(room, a, { t: 'send', text: `n${i}` })
    }
    const persisted = (await storage.get<Msg[]>('history'))!
    expect(persisted).toHaveLength(100)
    expect(persisted[0]!.text).toBe('n5')
    const revived = makeRoom()
    conns = []
    const b = await join(revived)
    const hello = b.of('hello')[0]!
    expect(hello.history).toHaveLength(100)
    expect(hello.history[99]!.text).toBe('n104')
  })

  it('mods: badge, delete via frame and /del, non-mods forbidden', async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    expect(m.last()).toEqual({ t: 'me', me: { address: MOD, badges: ['mod'], mod: true } })

    await send(room, a, { t: 'send', text: 'spam' })
    await send(room, a, { t: 'send', text: 'spam2' })
    await send(room, a, { t: 'del', id: 'm1' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'forbidden' })
    await send(room, a, { t: 'send', text: '/slow 30' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'forbidden' })

    await send(room, m, { t: 'del', id: 'm1' })
    expect(a.last()).toEqual({ t: 'del', id: 'm1' })
    await send(room, m, { t: 'send', text: '/del m2' })
    expect(a.last()).toEqual({ t: 'del', id: 'm2' })
    expect(room.state.history).toEqual([])
    expect(await storage.get('history')).toEqual([])
  })

  it('mods: /timeout and /untimeout', async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, m, { t: 'send', text: `/timeout ${A} 60` })
    await send(room, a, { t: 'send', text: 'hello?' })
    expect(a.last()).toEqual({ t: 'err', code: 'timeout', message: 'you are timed out', retryAfter: 60 })
    // persisted
    expect(await storage.get<Record<string, number>>('timeouts')).toEqual({ [A]: now + 60_000 })
    now += 30_000
    await send(room, m, { t: 'send', text: `/untimeout ${A}` })
    await send(room, a, { t: 'send', text: 'free' })
    expect(a.last()).toMatchObject({ t: 'msg' })
    // and timeouts expire on their own
    await send(room, m, { t: 'send', text: `/timeout ${A} 5` })
    now += 5001
    await send(room, a, { t: 'send', text: 'free again' })
    expect(a.last()).toMatchObject({ t: 'msg' })
  })

  it('mods: slow mode broadcast + enforced per address (mods exempt)', async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, m, { t: 'send', text: '/slow 10' })
    expect(a.last()).toEqual({ t: 'slow', seconds: 10 })
    await send(room, a, { t: 'send', text: 'one' })
    now += 3000
    await send(room, a, { t: 'send', text: 'two' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'slow', retryAfter: 7 })
    await send(room, m, { t: 'send', text: 'mod 1' })
    await send(room, m, { t: 'send', text: 'mod 2' })
    expect(m.last()).toMatchObject({ t: 'msg', msg: { text: 'mod 2' } })
    now += 7000
    await send(room, a, { t: 'send', text: 'three' })
    expect(a.last()).toMatchObject({ t: 'msg' })
    // new joiners learn slow mode in hello
    const c = await join(room)
    expect(c.of('hello')[0]!.slowMode).toBe(10)
    await send(room, m, { t: 'send', text: '/slow off' })
    expect(a.last()).toEqual({ t: 'slow', seconds: 0 })
    await send(room, m, { t: 'send', text: '/bogus' })
    expect(m.last()).toMatchObject({ t: 'err', code: 'bad' })
  })
})

describe('RoomCore state transitions', () => {
  it('a failed re-auth signs the socket out rather than leaving it as the old address', async () => {
    const room = makeRoom()
    const m = await join(room)
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, m, { t: 'auth', token: 'nope' })
    expect(m.last()).toMatchObject({ t: 'err', code: 'auth' })
    expect(m.meta).toMatchObject({ address: null, badges: [], mod: false, exp: 0 })
    await send(room, m, { t: 'send', text: 'still me?' })
    expect(m.last()).toMatchObject({ t: 'err', code: 'auth' })
    expect(room.state.history).toEqual([])
  })

  it('a timed-out mod cannot lift their own timeout or moderate until it ends', async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, a, { t: 'send', text: 'spam' })
    await send(room, m, { t: 'send', text: `/timeout ${MOD} 60` })
    await send(room, m, { t: 'send', text: `/untimeout ${MOD}` })
    expect(m.last()).toMatchObject({ t: 'err', code: 'timeout' })
    expect(room.state.timeouts[MOD]).toBe(now + 60_000)
    await send(room, m, { t: 'del', id: 'm1' })
    expect(m.last()).toMatchObject({ t: 'err', code: 'timeout' })
    expect(room.state.history).toHaveLength(1)
    now += 60_001
    await send(room, m, { t: 'send', text: `/untimeout ${MOD}` })
    expect(room.state.timeouts[MOD]).toBeUndefined()
  })

  it('a refusal by the IP limit costs nothing from the address bucket', async () => {
    const room = makeRoom()
    const fill = []
    for (const d of ['1', '2', '3']) {
      const c = await join(room, '9.9.9.9')
      await send(room, c, { t: 'auth', token: '0x' + d.repeat(40) })
      fill.push(c)
    }
    for (let i = 0; i < 10; i++) await send(room, fill[i % 3]!, { t: 'send', text: `x${i}` })
    const a = await join(room, '9.9.9.9')
    await send(room, a, { t: 'auth', token: A })
    for (let i = 0; i < 8; i++) await send(room, a, { t: 'send', text: 'no room' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'rate' })
    now += 1000
    await send(room, a, { t: 'send', text: 'my first' })
    expect(a.last()).toMatchObject({ t: 'msg', msg: { text: 'my first' } })
  })

  it('a refusal by the address limit costs nothing from the IP bucket', async () => {
    const room = makeRoom()
    const a = await join(room, '9.9.9.9')
    const b = await join(room, '9.9.9.9')
    await send(room, a, { t: 'auth', token: A })
    await send(room, b, { t: 'auth', token: B })
    for (let i = 0; i < 20; i++) await send(room, a, { t: 'send', text: `a${i}` })
    expect(room.state.history).toHaveLength(5)
    for (let i = 0; i < 5; i++) await send(room, b, { t: 'send', text: `b${i}` })
    expect(room.state.history).toHaveLength(10)
  })

  it('the slow-mode clock survives hibernation on the socket', async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, m, { t: 'send', text: '/slow 60' })
    await send(room, a, { t: 'send', text: 'one' })
    now += 20_000

    const revived = makeRoom()
    await send(revived, a, { t: 'send', text: 'two' })
    expect(a.last()).toMatchObject({ t: 'err', code: 'slow', retryAfter: 40 })
    now += 40_000
    await send(revived, a, { t: 'send', text: 'three' })
    expect(a.last()).toMatchObject({ t: 'msg', msg: { text: 'three' } })
  })

  it("the clock belongs to the address: signing in as another doesn't inherit it", async () => {
    const room = makeRoom()
    const a = await join(room)
    const m = await join(room)
    await send(room, a, { t: 'auth', token: A })
    await send(room, m, { t: 'auth', token: MOD })
    await send(room, m, { t: 'send', text: '/slow 60' })
    await send(room, a, { t: 'send', text: 'one' })
    const revived = makeRoom()
    await send(revived, a, { t: 'auth', token: B })
    await send(revived, a, { t: 'send', text: 'as b' })
    expect(a.last()).toMatchObject({ t: 'msg', msg: { from: B } })
  })
})

describe('readHoldings', () => {
  it('reads both balances, and a failed read reaches the caller', async () => {
    const balance = (mini: bigint, infer: bigint) => async (token: string) => (token === MIYAMINI ? mini : token === INFER ? infer : 0n)
    expect(await readHoldings(balance(1n, 0n))).toEqual({ miyamini: true, infer: false })
    await expect(
      readHoldings(async (token) => {
        if (token === INFER) throw new Error('rpc down')
        return 1n
      })
    ).rejects.toThrow('rpc down')
  })

  it('a dead RPC gets the short retry, not ten minutes of no badges', async () => {
    let calls = 0
    let dead = true
    const r = new BadgeResolver(
      () => {
        calls++
        return readHoldings(async () => {
          if (dead) throw new Error('rpc down')
          return 1n
        })
      },
      new Set(),
      () => now
    )
    expect(await r.badgesFor(A)).toEqual([])
    now += 60_000 + 1
    dead = false
    expect(await r.badgesFor(A)).toEqual(['miyamini', 'infer'])
    expect(calls).toBe(2)
  })
})

describe('BadgeResolver', () => {
  it('caches per address for 10 minutes and never throws', async () => {
    let calls = 0
    let fail = false
    const r = new BadgeResolver(
      async () => {
        calls++
        if (fail) throw new Error('rpc down')
        return { miyamini: true, infer: true }
      },
      new Set([MOD]),
      () => now
    )
    expect(await r.badgesFor(A.toUpperCase().replace('0X', '0x'))).toEqual(['miyamini', 'infer'] satisfies Badge[])
    expect(await r.badgesFor(A)).toEqual(['miyamini', 'infer'])
    expect(calls).toBe(1)
    now += 10 * 60_000 + 1
    fail = true
    expect(await r.badgesFor(A)).toEqual([])
    expect(await r.badgesFor(MOD)).toEqual(['mod'])
  })
})

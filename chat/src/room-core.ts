import { parseCommand } from './commands'
import type { Badge, ClientFrame, ErrCode, Msg, ServerFrame } from './protocol'
import { HISTORY_LIMIT, MAX_FRAME_BYTES, MSG_ID_RE } from './protocol'
import { RateLimiter } from './ratelimit'
import { sanitizeText } from './sanitize'

/** What we remember about a socket. In the DO this is the hibernation-safe ws attachment. */
export type ConnMeta = { ip: string; address: string | null; badges: Badge[]; mod: boolean; exp: number }

export interface Conn {
  send(data: string): void
  getMeta(): ConnMeta
  setMeta(meta: ConnMeta): void
}

/** Minimal async KV (Durable Object storage satisfies it). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
}

export type RoomDeps = {
  storage: KV
  now(): number
  /** all open sockets in the room */
  connections(): Conn[]
  verifyToken(token: unknown): Promise<{ address: string; exp: number } | null>
  badgesFor(address: string): Promise<Badge[]>
  isMod(address: string): boolean
  newId(): string
}

export const ADDRESS_LIMIT = { capacity: 5, windowMs: 10_000 }
export const IP_LIMIT = { capacity: 10, windowMs: 10_000 }

const K_HISTORY = 'history'
const K_SLOW = 'slow'
const K_TIMEOUTS = 'timeouts'

/**
 * All chat-room behavior, independent of Cloudflare: the Durable Object (room.ts) just wires
 * sockets and storage into this. In-memory state (rate buckets, slow-mode clocks, the loaded
 * history) is rebuilt after hibernation; durable state (history, slow mode, timeouts) is in storage.
 */
export class RoomCore {
  private loaded = false
  private history: Msg[] = []
  private slowMode = 0
  private timeouts: Record<string, number> = {}
  private lastSent = new Map<string, number>()
  private byAddress = new RateLimiter(ADDRESS_LIMIT.capacity, ADDRESS_LIMIT.windowMs)
  private byIp = new RateLimiter(IP_LIMIT.capacity, IP_LIMIT.windowMs)

  constructor(private readonly deps: RoomDeps) {}

  private async load() {
    if (this.loaded) return
    const [history, slow, timeouts] = await Promise.all([
      this.deps.storage.get<Msg[]>(K_HISTORY),
      this.deps.storage.get<number>(K_SLOW),
      this.deps.storage.get<Record<string, number>>(K_TIMEOUTS),
    ])
    // Another call may have loaded while we awaited.
    if (this.loaded) return
    this.history = history || []
    this.slowMode = slow || 0
    this.timeouts = timeouts || {}
    this.loaded = true
  }

  /* ---------- outbound ---------- */

  private send(conn: Conn, frame: ServerFrame) {
    try {
      conn.send(JSON.stringify(frame))
    } catch {
      /* socket already closed */
    }
  }

  private broadcast(frame: ServerFrame, except?: Conn) {
    const data = JSON.stringify(frame)
    for (const c of this.deps.connections()) {
      if (c === except) continue
      try {
        c.send(data)
      } catch {
        /* closed */
      }
    }
  }

  private err(conn: Conn, code: ErrCode, message: string, retryAfterMs?: number) {
    const frame: ServerFrame = { t: 'err', code, message }
    if (retryAfterMs !== undefined) frame.retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000))
    this.send(conn, frame)
  }

  /* ---------- lifecycle ---------- */

  async onOpen(conn: Conn, room: string) {
    await this.load()
    const viewers = this.deps.connections().length
    this.send(conn, { t: 'hello', room, slowMode: this.slowMode, viewers, history: this.history })
    this.broadcast({ t: 'viewers', count: viewers }, conn)
  }

  onClose(closing: Conn) {
    const count = this.deps.connections().filter((c) => c !== closing).length
    this.broadcast({ t: 'viewers', count }, closing)
  }

  /* ---------- inbound ---------- */

  async onMessage(conn: Conn, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return this.err(conn, 'bad', 'text frames only')
    if (new TextEncoder().encode(raw).length > MAX_FRAME_BYTES) return this.err(conn, 'bad', 'frame too large')
    let frame: ClientFrame
    try {
      frame = JSON.parse(raw)
    } catch {
      return this.err(conn, 'bad', 'invalid JSON')
    }
    if (!frame || typeof frame !== 'object') return this.err(conn, 'bad', 'invalid frame')
    await this.load()
    switch (frame.t) {
      case 'auth':
        return this.auth(conn, frame.token)
      case 'send':
        return this.sendText(conn, frame.text)
      case 'del': {
        const meta = this.authed(conn)
        if (!meta) return
        if (!meta.mod) return this.err(conn, 'forbidden', 'mods only')
        if (typeof frame.id !== 'string' || !MSG_ID_RE.test(frame.id)) return this.err(conn, 'bad', 'bad id')
        return this.deleteMessage(frame.id)
      }
      default:
        return this.err(conn, 'bad', 'unknown frame type')
    }
  }

  private async auth(conn: Conn, token: unknown) {
    const session = await this.deps.verifyToken(token)
    if (!session) return this.err(conn, 'auth', 'invalid or expired session, sign in again')
    const badges = await this.deps.badgesFor(session.address)
    const mod = this.deps.isMod(session.address)
    conn.setMeta({ ...conn.getMeta(), address: session.address, badges, mod, exp: session.exp })
    this.send(conn, { t: 'me', me: { address: session.address, badges, mod } })
  }

  /** The socket's session, or null (and an auth error sent) when signed out or expired. */
  private authed(conn: Conn): ConnMeta | null {
    const meta = conn.getMeta()
    if (!meta.address) {
      this.err(conn, 'auth', 'sign in to chat')
      return null
    }
    if (meta.exp <= this.deps.now()) {
      conn.setMeta({ ...meta, address: null, badges: [], mod: false, exp: 0 })
      this.err(conn, 'auth', 'session expired, sign in again')
      return null
    }
    return meta
  }

  private async sendText(conn: Conn, rawText: unknown) {
    const meta = this.authed(conn)
    if (!meta || !meta.address) return
    const address = meta.address
    const now = this.deps.now()

    const clean = sanitizeText(rawText)
    if (!clean.ok)
      return this.err(conn, clean.code, clean.code === 'length' ? 'message too long (max 280)' : 'empty message')

    const command = parseCommand(clean.text)
    if (command) {
      if (!meta.mod) return this.err(conn, 'forbidden', 'commands are for mods')
      return this.runCommand(conn, command)
    }

    const until = this.timeouts[address]
    if (until && until > now) return this.err(conn, 'timeout', 'you are timed out', until - now)

    if (this.slowMode > 0 && !meta.mod) {
      const last = this.lastSent.get(address)
      const wait = last === undefined ? 0 : last + this.slowMode * 1000 - now
      if (wait > 0) return this.err(conn, 'slow', `slow mode: one message every ${this.slowMode}s`, wait)
    }

    const a = this.byAddress.take(address, now)
    if (!a.ok) return this.err(conn, 'rate', 'slow down', a.retryAfterMs)
    const ip = this.byIp.take(meta.ip, now)
    if (!ip.ok) return this.err(conn, 'rate', 'slow down', ip.retryAfterMs)

    this.lastSent.set(address, now)
    if (this.lastSent.size > 10_000) this.lastSent.clear()

    const msg: Msg = { id: this.deps.newId(), at: now, from: address, badges: meta.badges, text: clean.text }
    this.history.push(msg)
    if (this.history.length > HISTORY_LIMIT) this.history = this.history.slice(-HISTORY_LIMIT)
    await this.deps.storage.put(K_HISTORY, this.history)
    this.broadcast({ t: 'msg', msg })
  }

  private async runCommand(conn: Conn, command: NonNullable<ReturnType<typeof parseCommand>>) {
    const now = this.deps.now()
    switch (command.cmd) {
      case 'invalid':
        return this.err(conn, 'bad', command.message)
      case 'del':
        return this.deleteMessage(command.id)
      case 'timeout': {
        this.pruneTimeouts(now)
        this.timeouts[command.address] = now + command.seconds * 1000
        await this.deps.storage.put(K_TIMEOUTS, this.timeouts)
        return
      }
      case 'untimeout': {
        delete this.timeouts[command.address]
        await this.deps.storage.put(K_TIMEOUTS, this.timeouts)
        return
      }
      case 'slow': {
        this.slowMode = command.seconds
        await this.deps.storage.put(K_SLOW, this.slowMode)
        return this.broadcast({ t: 'slow', seconds: this.slowMode })
      }
    }
  }

  private async deleteMessage(id: string) {
    const before = this.history.length
    this.history = this.history.filter((m) => m.id !== id)
    if (this.history.length !== before) await this.deps.storage.put(K_HISTORY, this.history)
    // Broadcast even if unknown here: harmless, and clears it from any client that has it.
    this.broadcast({ t: 'del', id })
  }

  private pruneTimeouts(now: number) {
    for (const [addr, until] of Object.entries(this.timeouts)) if (until <= now) delete this.timeouts[addr]
  }

  /* for tests */
  get state() {
    return { history: this.history, slowMode: this.slowMode, timeouts: this.timeouts }
  }
}

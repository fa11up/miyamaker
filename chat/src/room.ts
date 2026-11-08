import { DurableObject } from 'cloudflare:workers'

import { verifyToken } from './auth'
import { BadgeResolver, viemHoldingReader } from './badges'
import type { Env } from './env'
import { modSet, rpcUrl } from './env'
import type { Conn, ConnMeta } from './room-core'
import { RoomCore } from './room-core'

/**
 * One Durable Object per chat room (idFromName(room)). Uses the WebSocket Hibernation API so idle
 * rooms cost nothing: per-socket session state lives in the socket attachment, room state in storage.
 */
export class ChatRoom extends DurableObject<Env> {
  private core: RoomCore
  private badges: BadgeResolver
  private conns = new WeakMap<WebSocket, Conn>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    this.badges = new BadgeResolver(viemHoldingReader(rpcUrl(env)), modSet(env))
    this.core = new RoomCore({
      storage: ctx.storage,
      now: () => Date.now(),
      connections: () => ctx.getWebSockets().map((ws) => this.conn(ws)),
      verifyToken: (token) => verifyToken(env.SESSION_SECRET, token, Date.now()),
      badgesFor: (address) => this.badges.badgesFor(address),
      isMod: (address) => this.badges.isMod(address),
      newId: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      scheduleViewers: async (at) => {
        if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(at)
      },
    })
  }

  private conn(ws: WebSocket): Conn {
    let c = this.conns.get(ws)
    if (!c) {
      c = {
        send: (data) => ws.send(data),
        getMeta: () => (ws.deserializeAttachment() as ConnMeta | null) ?? { ip: '0.0.0.0', address: null, badges: [], mod: false, exp: 0 },
        setMeta: (meta) => ws.serializeAttachment(meta),
        close: (code, reason) => ws.close(code, reason),
      }
      this.conns.set(ws, c)
    }
    return c
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 })
    const room = request.headers.get('x-miyatv-room') || 'unknown'
    const ip = request.headers.get('x-miyatv-ip') || '0.0.0.0'
    const admitted = this.core.admit(ip)
    if (!admitted.ok) return new Response(admitted.message, { status: 429, headers: { 'Retry-After': '30' } })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    const meta: ConnMeta = { ip, address: null, badges: [], mod: false, exp: 0 }
    server.serializeAttachment(meta)
    await this.core.onOpen(this.conn(server), room)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.core.onMessage(this.conn(ws), message)
  }

  /** The viewers tick (RoomCore.onViewersDue). */
  async alarm() {
    this.core.onViewersDue()
  }

  async webSocketClose(ws: WebSocket, code: number) {
    await this.core.onClose(this.conn(ws))
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.core.onClose(this.conn(ws))
  }
}

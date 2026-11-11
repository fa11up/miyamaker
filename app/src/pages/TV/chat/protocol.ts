/**
 * miyatv chat wire protocol (client side). Mirrors chat/src/protocol.ts in the worker; keep in sync.
 * Pure, no imports: the reducer is unit-tested in tests/miyatv.test.mts.
 */
export type Badge = 'mod' | 'miyamini' | 'infer'

export type ChatMessage = { id: string; at: number; from: string; badges: Badge[]; text: string }

export type Me = { address: string; badges: Badge[]; mod: boolean }

/** What an empty chat says while it isn't open: failure never reads as loading. */
export function chatWaitLine(status: 'off' | 'connecting' | 'open' | 'reconnecting'): string {
  if (status === 'open') return 'No messages yet. Say hi.'
  if (status === 'connecting') return 'Joining chat…'
  if (status === 'reconnecting') return 'Chat dropped. Reconnecting…'
  return 'Chat is offline right now. The stream still works.'
}

/** The words for a failed sign-in. Whatever the wallet library or the chat server said stays out of it. */
export function signInProblem(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return /reject|denied|cancel/i.test(m) ? 'Signature cancelled.' : 'Could not sign you in. Try again.'
}

export type ErrorCode = 'auth' | 'rate' | 'slow' | 'timeout' | 'length' | 'empty' | 'forbidden' | 'bad'

export type ServerFrame =
  | { t: 'hello'; room: string; slowMode: number; viewers: number; history: ChatMessage[] }
  | { t: 'me'; me: Me }
  | { t: 'msg'; msg: ChatMessage }
  | { t: 'del'; id: string }
  | { t: 'slow'; seconds: number }
  | { t: 'viewers'; count: number }
  | { t: 'err'; code: ErrorCode; message: string; retryAfter?: number }

export type ClientFrame = { t: 'auth'; token: string } | { t: 'send'; text: string } | { t: 'del'; id: string }

export const MAX_MESSAGE_LENGTH = 280
export const MAX_KEPT_MESSAGES = 200

export type RoomState = {
  room: string | undefined
  messages: ChatMessage[]
  viewers: number
  slowMode: number
  me: Me | undefined
  error: { code: ErrorCode; message: string; retryAfter?: number; at: number } | undefined
}

export const initialRoomState: RoomState = {
  room: undefined,
  messages: [],
  viewers: 0,
  slowMode: 0,
  me: undefined,
  error: undefined,
}

/**
 * A new socket isn't anyone until it has signed in again, and what went wrong on the old one is over. A refused
 * sign-in stays up long enough to be read: being refused is what closed that socket.
 */
export const freshSocket = (state: RoomState): RoomState => ({
  ...state,
  me: undefined,
  error: state.error?.code === 'auth' ? state.error : undefined,
})

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Badges as the screen can draw them: strings only, each once, a handful at most. Anything else is dropped. */
export function cleanBadges(v: unknown): Badge[] {
  if (!Array.isArray(v)) return []
  const out: Badge[] = []
  for (const b of v) {
    if (typeof b === 'string' && b.length > 0 && b.length <= 32 && !out.includes(b as Badge)) out.push(b as Badge)
    if (out.length >= 8) break
  }
  return out
}

/** A message in the shape the chat draws, or undefined. Only the shape is checked here, never what it says. */
function toMessage(v: unknown): ChatMessage | undefined {
  if (
    !isObj(v) ||
    typeof v.id !== 'string' ||
    typeof v.at !== 'number' ||
    !Number.isFinite(v.at) ||
    typeof v.from !== 'string' ||
    typeof v.text !== 'string' ||
    !Array.isArray(v.badges)
  )
    return undefined
  return { id: v.id, at: v.at, from: v.from, text: v.text, badges: cleanBadges(v.badges) }
}

function toMe(v: unknown): Me | undefined {
  if (!isObj(v) || typeof v.address !== 'string') return undefined
  return { address: v.address, badges: cleanBadges(v.badges), mod: v.mod === true }
}

/** Parse one frame from the server; anything malformed is dropped (undefined). */
export function parseFrame(raw: unknown): ServerFrame | undefined {
  if (typeof raw !== 'string') return undefined
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isObj(v) || typeof v.t !== 'string') return undefined
  switch (v.t) {
    case 'hello':
      return Array.isArray(v.history) && typeof v.room === 'string'
        ? {
            t: 'hello',
            room: v.room,
            slowMode: Number(v.slowMode) || 0,
            viewers: Number(v.viewers) || 0,
            history: v.history.map(toMessage).filter((m): m is ChatMessage => !!m),
          }
        : undefined
    case 'me': {
      const me = toMe(v.me)
      return me ? { t: 'me', me } : undefined
    }
    case 'msg': {
      const msg = toMessage(v.msg)
      return msg ? { t: 'msg', msg } : undefined
    }
    case 'del':
      return typeof v.id === 'string' ? { t: 'del', id: v.id } : undefined
    case 'slow':
      return { t: 'slow', seconds: Math.max(0, Number(v.seconds) || 0) }
    case 'viewers':
      return { t: 'viewers', count: Math.max(0, Number(v.count) || 0) }
    case 'err':
      return typeof v.code === 'string'
        ? {
            t: 'err',
            code: v.code as ErrorCode,
            message: typeof v.message === 'string' ? v.message : 'Something went wrong',
            retryAfter: typeof v.retryAfter === 'number' ? v.retryAfter : undefined,
          }
        : undefined
    default:
      return undefined
  }
}

export function reduceRoom(state: RoomState, frame: ServerFrame, now = Date.now()): RoomState {
  switch (frame.t) {
    case 'hello':
      return {
        ...state,
        room: frame.room,
        slowMode: frame.slowMode,
        viewers: frame.viewers,
        messages: frame.history.slice(-MAX_KEPT_MESSAGES),
      }
    case 'me':
      return { ...state, me: frame.me, error: undefined }
    case 'msg':
      if (state.messages.some((m) => m.id === frame.msg.id)) return state
      return { ...state, messages: [...state.messages, frame.msg].slice(-MAX_KEPT_MESSAGES) }
    case 'del':
      return { ...state, messages: state.messages.filter((m) => m.id !== frame.id) }
    case 'slow':
      return { ...state, slowMode: frame.seconds }
    case 'viewers':
      return { ...state, viewers: frame.count }
    case 'err':
      return { ...state, error: { code: frame.code, message: frame.message, retryAfter: frame.retryAfter, at: now } }
    default:
      return state
  }
}

/**
 * C0/C1 controls (tab/newline/CR are folded to spaces below), zero-width chars, bidi
 * overrides/isolates and the BOM. Built from escapes so no invisible characters live in this file.
 */
// eslint-disable-next-line prefer-regex-literals
const UNSAFE_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g'
)

/** Client-side mirror of the server's sanitizer, so the counter matches what the server accepts. */
export function cleanText(input: string): string {
  return input
    .replace(UNSAFE_CHARS, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
}

export const codePoints = (s: string) => [...s].length

/** Turn an http(s) base URL into the room WebSocket URL. */
export function roomSocketUrl(base: string, room: string): string | undefined {
  try {
    const url = new URL(base)
    if (url.protocol === 'https:') url.protocol = 'wss:'
    else if (url.protocol === 'http:') url.protocol = 'ws:'
    else return undefined
    url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${encodeURIComponent(room)}`
    url.search = ''
    return url.href
  } catch {
    return undefined
  }
}

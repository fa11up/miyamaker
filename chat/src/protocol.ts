/**
 * Wire protocol between the miyatv chat worker and the miyaOS client (app/src/pages/TV).
 * Every WebSocket frame is one JSON object with a `t` discriminator. Keep in sync with the client.
 */

export type Badge = 'mod' | 'miyamini' | 'infer'

export type Msg = {
  id: string
  /** ms since epoch */
  at: number
  /** lowercase 0x address */
  from: string
  badges: Badge[]
  /** plain text, already sanitized. Clients must render it as text, never HTML. */
  text: string
}

export type ErrCode = 'auth' | 'rate' | 'slow' | 'timeout' | 'length' | 'empty' | 'forbidden' | 'bad'

export type ServerFrame =
  | { t: 'hello'; room: string; slowMode: number; viewers: number; history: Msg[] }
  | { t: 'me'; me: { address: string; badges: Badge[]; mod: boolean } }
  | { t: 'msg'; msg: Msg }
  | { t: 'del'; id: string }
  | { t: 'slow'; seconds: number }
  | { t: 'viewers'; count: number }
  | { t: 'err'; code: ErrCode; message: string; retryAfter?: number }

export type ClientFrame = { t: 'auth'; token: string } | { t: 'send'; text: string } | { t: 'del'; id: string }

export const MAX_MESSAGE_CHARS = 280
export const MAX_FRAME_BYTES = 2048
export const HISTORY_LIMIT = 100
export const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const MSG_ID_RE = /^[A-Za-z0-9-]{1,64}$/

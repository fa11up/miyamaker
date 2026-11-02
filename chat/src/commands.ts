import { ADDRESS_RE, MSG_ID_RE } from './protocol'

export const DEFAULT_TIMEOUT_S = 600
export const MAX_TIMEOUT_S = 7 * 24 * 3600
export const MAX_SLOW_S = 300

export type Command =
  | { cmd: 'del'; id: string }
  | { cmd: 'timeout'; address: string; seconds: number }
  | { cmd: 'untimeout'; address: string }
  | { cmd: 'slow'; seconds: number }
  | { cmd: 'invalid'; message: string }

/** Parses a mod slash command. Returns null when the text is not a command (does not start with '/'). */
export function parseCommand(text: string): Command | null {
  if (!text.startsWith('/')) return null
  const [name, ...args] = text.slice(1).trim().split(/\s+/)
  switch ((name || '').toLowerCase()) {
    case 'del':
    case 'delete': {
      const id = args[0]
      if (!id || !MSG_ID_RE.test(id)) return { cmd: 'invalid', message: 'usage: /del <message id>' }
      return { cmd: 'del', id }
    }
    case 'timeout': {
      const address = args[0]
      if (!address || !ADDRESS_RE.test(address)) return { cmd: 'invalid', message: 'usage: /timeout <0xaddress> [seconds]' }
      let seconds = DEFAULT_TIMEOUT_S
      if (args[1] !== undefined) {
        if (!/^\d{1,7}$/.test(args[1])) return { cmd: 'invalid', message: 'timeout seconds must be a whole number' }
        seconds = Math.min(MAX_TIMEOUT_S, Number(args[1]))
      }
      if (seconds <= 0) return { cmd: 'untimeout', address: address.toLowerCase() }
      return { cmd: 'timeout', address: address.toLowerCase(), seconds }
    }
    case 'untimeout': {
      const address = args[0]
      if (!address || !ADDRESS_RE.test(address)) return { cmd: 'invalid', message: 'usage: /untimeout <0xaddress>' }
      return { cmd: 'untimeout', address: address.toLowerCase() }
    }
    case 'slow': {
      const arg = (args[0] || '').toLowerCase()
      if (arg === 'off' || arg === '0') return { cmd: 'slow', seconds: 0 }
      if (!/^\d{1,3}$/.test(arg) || Number(arg) > MAX_SLOW_S)
        return { cmd: 'invalid', message: `usage: /slow <1-${MAX_SLOW_S} seconds | off>` }
      return { cmd: 'slow', seconds: Number(arg) }
    }
    default:
      return { cmd: 'invalid', message: 'unknown command (try /del, /timeout, /untimeout, /slow)' }
  }
}

import { parseAddressSet, parseOrigins } from './auth'

export interface Env {
  ROOMS: DurableObjectNamespace
  /** secret (wrangler secret put SESSION_SECRET): HMAC key for nonces and session tokens, >= 32 random chars */
  SESSION_SECRET: string
  /** comma-separated exact origins allowed for CORS, SIWE domain/uri and WebSocket Origin */
  ALLOWED_ORIGINS: string
  /** comma-separated 0x addresses with mod powers */
  MOD_ADDRESSES: string
  /** Ethereum mainnet JSON-RPC for holder badges and ERC-1271 signature checks */
  RPC_URL: string
}

export const allowedOrigins = (env: Env) => parseOrigins(env.ALLOWED_ORIGINS)
export const modSet = (env: Env) => parseAddressSet(env.MOD_ADDRESSES)

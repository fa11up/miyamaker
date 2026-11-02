import { parseAddressSet, parseOrigins } from './auth'

export interface Env {
  ROOMS: DurableObjectNamespace
  /** secret (wrangler secret put SESSION_SECRET): HMAC key for nonces and session tokens, >= 32 random chars */
  SESSION_SECRET: string
  /** comma-separated exact origins allowed for CORS, SIWE domain/uri and WebSocket Origin */
  ALLOWED_ORIGINS: string
  /** comma-separated 0x addresses with mod powers */
  MOD_ADDRESSES: string
  /** optional secret (wrangler secret put RPC_URL): Ethereum mainnet JSON-RPC for holder badges and ERC-1271
   * signature checks. A keyed URL must be a secret, never a var in wrangler.jsonc. Falls back to a public node. */
  RPC_URL?: string
}

export const PUBLIC_RPC = 'https://ethereum-rpc.publicnode.com'
export const rpcUrl = (env: Env) => env.RPC_URL || PUBLIC_RPC

export const allowedOrigins = (env: Env) => parseOrigins(env.ALLOWED_ORIGINS)
export const modSet = (env: Env) => parseAddressSet(env.MOD_ADDRESSES)

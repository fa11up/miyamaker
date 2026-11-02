import { parseSiweMessage } from 'viem/siwe'

import { base64url, fromBase64url, hmac, randomHex, safeEqual, toHex } from './crypto'
import { ADDRESS_RE } from './protocol'

export const NONCE_TTL_MS = 10 * 60_000
export const TOKEN_TTL_MS = 6 * 60 * 60_000
export const CHAIN_ID = 1
const MAX_MESSAGE_BYTES = 2048
const CLOCK_SKEW_MS = 5 * 60_000

/* ---------- nonce: stateless, HMAC'd, alphanumeric (EIP-4361 needs [a-zA-Z0-9]{8,}) ---------- */

const NONCE_RE = /^([0-9a-f]{24})t([0-9a-f]{1,13})s([0-9a-f]{32})$/

export async function makeNonce(secret: string, now: number): Promise<string> {
  const rand = randomHex(12)
  const issued = now.toString(16)
  const mac = toHex(await hmac(secret, `nonce:${rand}:${issued}`)).slice(0, 32)
  return `${rand}t${issued}s${mac}`
}

/**
 * True when the nonce was minted by us within NONCE_TTL_MS. Stateless, so a nonce can be replayed
 * inside its 10-minute window — harmless, because replaying a valid signed sign-in only yields the
 * same address's session again.
 */
export async function checkNonce(secret: string, nonce: string, now: number): Promise<boolean> {
  const m = NONCE_RE.exec(nonce)
  if (!m) return false
  const [, rand, issuedHex, mac] = m as unknown as [string, string, string, string]
  const issued = parseInt(issuedHex, 16)
  if (!Number.isFinite(issued) || issued > now + CLOCK_SKEW_MS || now - issued > NONCE_TTL_MS) return false
  const expected = toHex(await hmac(secret, `nonce:${rand}:${issuedHex}`)).slice(0, 32)
  return safeEqual(mac, expected)
}

/* ---------- session token: base64url(JSON{a,exp}).base64url(HMAC-SHA256) ---------- */

export type Session = { address: string; exp: number }

export async function signToken(secret: string, address: string, now: number, ttl = TOKEN_TTL_MS): Promise<{ token: string; exp: number }> {
  const exp = now + ttl
  const body = base64url(JSON.stringify({ a: address.toLowerCase(), exp }))
  const sig = base64url(await hmac(secret, `token:${body}`))
  return { token: `${body}.${sig}`, exp }
}

export async function verifyToken(secret: string, token: unknown, now: number): Promise<Session | null> {
  if (typeof token !== 'string' || token.length > 512) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts as [string, string]
  try {
    const expected = base64url(await hmac(secret, `token:${body}`))
    if (!safeEqual(sig, expected)) return null
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as { a?: unknown; exp?: unknown }
    if (typeof data.a !== 'string' || !ADDRESS_RE.test(data.a) || typeof data.exp !== 'number') return null
    if (data.exp <= now) return null
    return { address: data.a.toLowerCase(), exp: data.exp }
  } catch {
    return null
  }
}

/* ---------- SIWE (EIP-4361) ---------- */

export type SignatureVerifier = (args: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>

export type SiweInput = {
  message: unknown
  signature: unknown
  /** the request's Origin header */
  origin: string | null
  allowedOrigins: string[]
  secret: string
  now: number
  verify: SignatureVerifier
}

export type SiweResult = { ok: true; address: string } | { ok: false; status: 400 | 401; error: string }

const fail = (status: 400 | 401, error: string): SiweResult => ({ ok: false, status, error })

/**
 * Checks a signed EIP-4361 message: our domain/uri, chain 1, our unexpired nonce, an expiration
 * time in the future, and a valid signature (the injected verifier handles EOAs and, in production,
 * ERC-1271/6492 smart accounts over RPC).
 */
export async function verifySiweLogin(input: SiweInput): Promise<SiweResult> {
  const { message, signature, origin, allowedOrigins, secret, now } = input
  if (typeof message !== 'string' || typeof signature !== 'string') return fail(400, 'message and signature required')
  if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) return fail(400, 'message too long')
  if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 4096) return fail(400, 'bad signature encoding')
  if (!origin || !allowedOrigins.includes(origin)) return fail(401, 'origin not allowed')

  const parsed = parseSiweMessage(message)
  const { address, domain, uri, chainId, nonce, version, expirationTime, notBefore, issuedAt } = parsed
  if (!address || !ADDRESS_RE.test(address) || !domain || !uri || !nonce || version !== '1' || chainId === undefined)
    return fail(400, 'malformed SIWE message')

  const originHost = new URL(origin).host
  if (domain !== originHost) return fail(401, 'wrong domain')
  let uriOrigin: string
  try {
    uriOrigin = new URL(uri).origin
  } catch {
    return fail(400, 'bad uri')
  }
  if (!allowedOrigins.includes(uriOrigin)) return fail(401, 'wrong uri')
  if (chainId !== CHAIN_ID) return fail(401, 'wrong chain')
  if (!(await checkNonce(secret, nonce, now))) return fail(401, 'bad or expired nonce')
  if (!expirationTime || expirationTime.getTime() <= now) return fail(401, 'message expired')
  if (notBefore && notBefore.getTime() > now + CLOCK_SKEW_MS) return fail(401, 'message not yet valid')
  if (issuedAt && issuedAt.getTime() > now + CLOCK_SKEW_MS) return fail(401, 'issuedAt in the future')

  let valid = false
  try {
    valid = await input.verify({ address, message, signature: signature as `0x${string}` })
  } catch {
    valid = false
  }
  if (!valid) return fail(401, 'bad signature')
  return { ok: true, address: address.toLowerCase() }
}

export function parseOrigins(list: string | undefined): string[] {
  return (list || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function parseAddressSet(list: string | undefined): Set<string> {
  return new Set(
    (list || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => ADDRESS_RE.test(s))
  )
}

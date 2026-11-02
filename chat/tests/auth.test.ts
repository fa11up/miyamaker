import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { describe, expect, it } from 'vitest'

import type { SignatureVerifier } from '../src/auth'
import { base64url } from '../src/crypto'
import { checkNonce,makeNonce, parseAddressSet, parseOrigins, signToken, verifySiweLogin, verifyToken } from '../src/auth'

const SECRET = 'test-secret-0123456789abcdef'
// Well-known test key (anvil #0). Never holds funds.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const ORIGIN = 'http://localhost:5331'
const ALLOWED = ['https://miyamaker.com', ORIGIN]
const NOW = 1_800_000_000_000
const localVerify: SignatureVerifier = (a) => verifyMessage(a)

async function signed(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}, nonceAt = NOW) {
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'localhost:5331',
    uri: ORIGIN,
    version: '1',
    nonce: await makeNonce(SECRET, nonceAt),
    issuedAt: new Date(NOW),
    expirationTime: new Date(NOW + 10 * 60_000),
    statement: 'Sign in to miyatv chat.',
    ...overrides,
  })
  const signature = await account.signMessage({ message })
  return { message, signature }
}

const login = (m: { message: string; signature: string }, origin: string | null = ORIGIN, now = NOW) =>
  verifySiweLogin({ ...m, origin, allowedOrigins: ALLOWED, secret: SECRET, now, verify: localVerify })

describe('nonce', () => {
  it('is alphanumeric and verifies within 10 minutes', async () => {
    const n = await makeNonce(SECRET, NOW)
    expect(n).toMatch(/^[a-zA-Z0-9]{8,}$/)
    expect(await checkNonce(SECRET, n, NOW + 9 * 60_000)).toBe(true)
    expect(await checkNonce(SECRET, n, NOW + 11 * 60_000)).toBe(false)
  })
  it('rejects tampered or foreign nonces', async () => {
    const n = await makeNonce(SECRET, NOW)
    const flipped = n.slice(0, -1) + (n.endsWith('0') ? '1' : '0')
    expect(await checkNonce(SECRET, flipped, NOW)).toBe(false)
    expect(await checkNonce('another-secret-0123456789', n, NOW)).toBe(false)
    expect(await checkNonce(SECRET, 'abcdefgh1234', NOW)).toBe(false)
  })
})

describe('session token', () => {
  it('round-trips and lowercases the address', async () => {
    const { token, exp } = await signToken(SECRET, account.address, NOW)
    expect(exp).toBe(NOW + 6 * 3600_000)
    expect(await verifyToken(SECRET, token, NOW + 1000)).toEqual({ address: account.address.toLowerCase(), exp })
  })
  it('expires', async () => {
    const { token, exp } = await signToken(SECRET, account.address, NOW)
    expect(await verifyToken(SECRET, token, exp)).toBeNull()
  })
  it('rejects tampering, wrong secret and junk', async () => {
    const { token } = await signToken(SECRET, account.address, NOW)
    const [body, sig] = token.split('.') as [string, string]
    const forgedBody = base64url(JSON.stringify({ a: '0x' + '1'.repeat(40), exp: NOW + 1e9 }))
    expect(await verifyToken(SECRET, `${forgedBody}.${sig}`, NOW)).toBeNull()
    expect(await verifyToken(SECRET, `${body}.${sig.slice(0, -2)}AA`, NOW)).toBeNull()
    expect(await verifyToken('other-secret-0123456789abc', token, NOW)).toBeNull()
    expect(await verifyToken(SECRET, 'x', NOW)).toBeNull()
    expect(await verifyToken(SECRET, 123, NOW)).toBeNull()
    expect(await verifyToken(SECRET, '!!.??', NOW)).toBeNull()
  })
})

describe('verifySiweLogin', () => {
  it('accepts a valid signed message', async () => {
    expect(await login(await signed())).toEqual({ ok: true, address: account.address.toLowerCase() })
  })
  it('rejects an origin outside the allowlist, or missing', async () => {
    const m = await signed()
    expect(await login(m, 'https://evil.example')).toMatchObject({ ok: false, status: 401, error: 'origin not allowed' })
    expect(await login(m, null)).toMatchObject({ ok: false, error: 'origin not allowed' })
  })
  it('rejects a wrong domain (phishing site relaying a signature)', async () => {
    expect(await login(await signed({ domain: 'evil.example' }))).toMatchObject({ ok: false, error: 'wrong domain' })
    // domain of a different allowed origin than the request's own
    expect(await login(await signed({ domain: 'miyamaker.com' }))).toMatchObject({ ok: false, error: 'wrong domain' })
  })
  it('rejects a uri outside the allowlist', async () => {
    expect(await login(await signed({ uri: 'https://evil.example/login' }))).toMatchObject({ ok: false, error: 'wrong uri' })
  })
  it('rejects other chains', async () => {
    expect(await login(await signed({ chainId: 11155111 }))).toMatchObject({ ok: false, error: 'wrong chain' })
  })
  it('rejects expired, missing-expiry and stale-nonce messages', async () => {
    expect(await login(await signed({ expirationTime: new Date(NOW - 1) }))).toMatchObject({ error: 'message expired' })
    expect(await login(await signed({ expirationTime: undefined }))).toMatchObject({ error: 'message expired' })
    expect(await login(await signed({}, NOW - 11 * 60_000))).toMatchObject({ error: 'bad or expired nonce' })
  })
  it('rejects a nonce we did not mint', async () => {
    expect(await login(await signed({ nonce: 'abcdefgh12345678' }))).toMatchObject({ error: 'bad or expired nonce' })
  })
  it('rejects a bad signature or a signature by someone else', async () => {
    const m = await signed()
    const other = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    const otherSig = await other.signMessage({ message: m.message })
    expect(await login({ message: m.message, signature: otherSig })).toMatchObject({ ok: false, error: 'bad signature' })
    expect(await login({ message: m.message + ' ', signature: m.signature })).toMatchObject({ ok: false })
    expect(await login({ message: m.message, signature: 'nope' })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects malformed input', async () => {
    expect(await login({ message: 'hello', signature: '0x00' })).toMatchObject({ ok: false, status: 400 })
    // @ts-expect-error runtime check
    expect(await login({ message: 1, signature: '0x00' })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('env parsing', () => {
  it('origins and mod addresses', () => {
    expect(parseOrigins(' https://a.com/, http://localhost:5331 ,,')).toEqual(['https://a.com', 'http://localhost:5331'])
    expect([...parseAddressSet(`${account.address}, junk, `)]).toEqual([account.address.toLowerCase()])
  })
})

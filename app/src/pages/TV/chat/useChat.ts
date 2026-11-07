import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { getAddress } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { useAccount, useSignMessage } from 'wagmi'

import type { ClientFrame, Me, RoomState } from './protocol'
import { freshSocket, initialRoomState, parseFrame, reduceRoom, roomSocketUrl, signInProblem } from './protocol'

/** Base URL of the chat worker (chat/ in the monorepo). Unset = chat offline. */
export const CHAT_URL: string | undefined = import.meta.env.VITE_CHAT_URL?.trim() || undefined

/* ---------- session (Sign-In with Ethereum) ---------- */

export type Session = { token: string; address: string; expiresAt: number; me?: Me }

const storageKey = (address: string) => `miyatv.chat.session.${address.toLowerCase()}`

function loadSession(address: string | undefined): Session | undefined {
  if (!address) return undefined
  try {
    const raw = window.localStorage.getItem(storageKey(address))
    if (!raw) return undefined
    const s = JSON.parse(raw) as Session
    if (typeof s.token !== 'string' || typeof s.expiresAt !== 'number' || s.expiresAt < Date.now() + 60_000)
      return undefined
    if (s.address.toLowerCase() !== address.toLowerCase()) return undefined
    return s
  } catch {
    return undefined
  }
}

function storeSession(s: Session | undefined, address: string) {
  try {
    if (s) window.localStorage.setItem(storageKey(address), JSON.stringify(s))
    else window.localStorage.removeItem(storageKey(address))
  } catch {
    // storage unavailable: the session just lasts for this page view
  }
}

const toMs = (t: number) => (t < 1e12 ? t * 1000 : t)

export function useChatSession(base: string | undefined) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [session, setSession] = useState<Session | undefined>(() => loadSession(address))
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string>()
  // The sign-in under way. Whichever is left behind (another account, a cancel) still finishes, and is ignored.
  const run = useRef(0)

  useEffect(() => {
    run.current += 1
    setSession(loadSession(address))
    setSigningIn(false)
    setError(undefined)
  }, [address])

  const cancelSignIn = useCallback(() => {
    run.current += 1
    setSigningIn(false)
  }, [])

  const signIn = useCallback(async () => {
    if (!base || !address) return
    run.current += 1
    const mine = run.current
    setSigningIn(true)
    setError(undefined)
    try {
      const nonceRes = await fetch(`${base.replace(/\/$/, '')}/auth/nonce`)
      if (!nonceRes.ok) throw new Error('Chat server unavailable')
      const { nonce } = (await nonceRes.json()) as { nonce: string }
      const now = new Date()
      const message = createSiweMessage({
        domain: window.location.host,
        address: getAddress(address),
        statement: 'Sign in to miyaTV chat. This is free and does not grant any permissions.',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce,
        issuedAt: now,
        expirationTime: new Date(now.getTime() + 10 * 60_000),
      })
      const signature = await signMessageAsync({ message })
      const res = await fetch(`${base.replace(/\/$/, '')}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        token?: string
        address?: string
        expiresAt?: number
        error?: string
      }
      if (!res.ok || !body.token || !body.address || !body.expiresAt) throw new Error(body.error || 'Sign-in failed')
      const s: Session = { token: body.token, address: body.address, expiresAt: toMs(body.expiresAt) }
      // Still good for the account that signed, if it comes back. Just not for whoever is connected now.
      storeSession(s, address)
      if (run.current === mine) setSession(s)
    } catch (e) {
      if (run.current === mine) setError(signInProblem(e))
    } finally {
      if (run.current === mine) setSigningIn(false)
    }
  }, [base, address, signMessageAsync])

  const signOut = useCallback(() => {
    if (address) storeSession(undefined, address)
    setSession(undefined)
  }, [address])

  // Checked here too: for one render after an account change, the state still holds the last one's session.
  const mine = session && address && session.address.toLowerCase() === address.toLowerCase() ? session : undefined
  return { address, session: mine, signIn, cancelSignIn, signOut, signingIn, error }
}

/* ---------- room socket ---------- */

export type SocketStatus = 'off' | 'connecting' | 'open' | 'reconnecting'

type Action = { kind: 'frame'; raw: unknown } | { kind: 'reset' } | { kind: 'fresh-socket' } | { kind: 'new-token' }

function reducer(state: RoomState, action: Action): RoomState {
  if (action.kind === 'reset') return initialRoomState
  if (action.kind === 'fresh-socket') return freshSocket(state)
  if (action.kind === 'new-token') return { ...state, me: undefined }
  const frame = parseFrame(action.raw)
  return frame ? reduceRoom(state, frame) : state
}

const PING_MS = 25_000

export function useChatRoom(base: string | undefined, room: string, token: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialRoomState)
  const [status, setStatus] = useState<SocketStatus>(base ? 'connecting' : 'off')
  const socketRef = useRef<WebSocket>()
  const tokenRef = useRef(token)
  tokenRef.current = token
  const url = base ? roomSocketUrl(base, room) : undefined

  useEffect(() => {
    dispatch({ kind: 'reset' })
    if (!url) {
      setStatus('off')
      return undefined
    }

    let closed = false
    let attempt = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      const ws = new WebSocket(url)
      socketRef.current = ws
      ws.onopen = () => {
        attempt = 0
        setStatus('open')
        dispatch({ kind: 'fresh-socket' })
        if (tokenRef.current) ws.send(JSON.stringify({ t: 'auth', token: tokenRef.current } satisfies ClientFrame))
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS)
      }

      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        dispatch({ kind: 'frame', raw: e.data })
      }

      ws.onclose = () => {
        if (ping) clearInterval(ping)
        if (socketRef.current === ws) socketRef.current = undefined
        if (closed) return
        attempt += 1
        setStatus('reconnecting')
        retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempt - 1, 4)))
      }
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      socketRef.current?.close(1000, 'bye')
      socketRef.current = undefined
    }
  }, [url])

  // Sign-in after the socket is already open: authenticate in place. Sign-out: reconnect read-only.
  const prevToken = useRef(token)
  useEffect(() => {
    const ws = socketRef.current
    if (prevToken.current === token) return
    const hadToken = !!prevToken.current
    prevToken.current = token
    // Whoever the room said we were before: the next 'me' says who we are now.
    dispatch({ kind: 'new-token' })
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (token) ws.send(JSON.stringify({ t: 'auth', token } satisfies ClientFrame))
    else if (hadToken) ws.close(4000, 'signed out')
  }, [token])

  const sendFrame = useCallback((frame: ClientFrame) => {
    const ws = socketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(frame))
    return true
  }, [])

  const send = useCallback((text: string) => sendFrame({ t: 'send', text }), [sendFrame])
  const remove = useCallback((id: string) => sendFrame({ t: 'del', id }), [sendFrame])

  return { ...state, me: token ? state.me : undefined, status, send, remove }
}

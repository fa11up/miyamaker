/**
 * Between wagmi's Privy connector and Privy itself. Privy's login and wallets only exist inside React, and only once its
 * package has loaded, which it does the first time someone asks for it. This holds what it last reported, and lets the
 * connector wait for what it needs.
 */
export type EmbeddedWallet = {
  address: string
  getEthereumProvider: () => Promise<Eip1193>
  switchChain: (chainId: number) => Promise<void>
}
export type Eip1193 = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
  on: (event: string, listener: (...args: never[]) => void) => unknown
  removeListener: (event: string, listener: (...args: never[]) => void) => unknown
}
export type PrivyState = {
  ready: boolean
  authenticated: boolean
  wallet?: EmbeddedWallet
  openLogin: () => void
  logout: () => Promise<void>
}
export type PrivyBridge = {
  request: () => void
  wait: <T>(pick: (state: PrivyState) => T | undefined, ms: number) => Promise<T>
  login: () => Promise<void>
  remembered: () => boolean
  remember: (on: boolean) => void
  /** Told each time Privy's state changes. Returns how to stop. */
  watch: (f: (state: PrivyState) => void) => () => void
}

const REMEMBER = 'miya.privy'
/** Longer than anyone takes over an email code. Past this, whatever happened, the wallet dialog has to come back. */
const LOGIN_MS = 5 * 60_000
const listeners = new Set<() => void>()
let state: PrivyState | undefined
let wanted = false
let loginDone: { resolve: () => void; reject: (e: Error) => void } | undefined
let loginTimer: ReturnType<typeof setTimeout> | undefined
let loginFailure: Error | undefined
let broken: Error | undefined
let attempt = 0

const changed = () => [...listeners].forEach((f) => f())

/** The wallet dialog sits above everything, and Privy's window has to be pressed, so the dialog steps aside while it's up. */
const loginShowing = (on: boolean) => document.documentElement.classList.toggle('privy-login', on)

/** Google and X leave the page to log in, so a page load can be someone coming back from one of them. */
export const returningFromLogin = () => typeof window !== 'undefined' && /[?&]privy_oauth_/.test(window.location.search)

/** For the mount: whether Privy has been asked for yet. */
export const privyWanted = () => wanted
/** Goes up each time Privy is started over after failing. */
export const privyAttempt = () => attempt
/** A login that failed with nobody waiting on it: back from Google or X, the page that asked is long gone. */
export const privyLoginFailure = () => loginFailure
export const clearPrivyLoginFailure = () => {
  loginFailure = undefined
  changed()
}
export const onPrivyChange = (f: () => void) => {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}

/** Called by the host each time Privy's state changes. */
export function reportPrivy(next: PrivyState) {
  state = next
  changed()
}
export function reportLogin(error?: Error) {
  loginShowing(false)
  clearTimeout(loginTimer)
  if (error && !loginDone && !/exited_auth_flow/.test(error.message)) {
    loginFailure = error
    changed()
  }
  if (error) loginDone?.reject(error)
  else loginDone?.resolve()
  loginDone = undefined
}
/** Privy failed to load or start: whoever is waiting hears about it, and it can be tried again. */
export function reportBroken(error: Error) {
  broken = error
  reportLogin(error)
  changed()
}

export const privyBridge: PrivyBridge = {
  request() {
    // Asking again after a failure starts Privy over.
    if (broken) {
      broken = undefined
      attempt += 1
      changed()
    }
    if (!wanted) {
      wanted = true
      changed()
    }
  },
  wait(pick, ms) {
    return new Promise((resolve, reject) => {
      const finish = (end: () => void) => {
        clearTimeout(timer)
        off()
        end()
      }
      const check = () => {
        if (broken) {
          const e = broken
          finish(() => reject(e))
          return
        }
        const value = state && pick(state)
        if (value !== undefined) finish(() => resolve(value))
      }
      const timer = setTimeout(() => finish(() => reject(new Error('Login took too long. Try again.'))), ms)
      const off = onPrivyChange(check)
      check()
    })
  },
  login() {
    return new Promise((resolve, reject) => {
      // A second press replaces the first, which must not wait forever for an answer it won't get.
      loginDone?.reject(new Error('exited_auth_flow'))
      loginDone = { resolve, reject }
      loginShowing(true)
      clearTimeout(loginTimer)
      loginTimer = setTimeout(() => reportLogin(new Error('Login took too long. Try again.')), LOGIN_MS)
      state?.openLogin()
    })
  },
  remembered() {
    try {
      return window.localStorage.getItem(REMEMBER) === '1'
    } catch {
      return false
    }
  },
  remember(on) {
    try {
      if (on) window.localStorage.setItem(REMEMBER, '1')
      else window.localStorage.removeItem(REMEMBER)
    } catch {
      // Only means signing in again next time.
    }
  },
  watch(f) {
    return onPrivyChange(() => {
      if (state) f(state)
    })
  },
}

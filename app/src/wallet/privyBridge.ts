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
}

const REMEMBER = 'miya.privy'
const listeners = new Set<() => void>()
let state: PrivyState | undefined
let wanted = false
let loginDone: { resolve: () => void; reject: (e: Error) => void } | undefined
let broken: Error | undefined

const changed = () => [...listeners].forEach((f) => f())

/** The wallet dialog sits above everything, and Privy's window has to be pressed, so the dialog steps aside while it's up. */
const loginShowing = (on: boolean) => document.documentElement.classList.toggle('privy-login', on)

/** Google and X leave the page to log in, so a page load can be someone coming back from one of them. */
export const returningFromLogin = () => typeof window !== 'undefined' && /[?&]privy_oauth_/.test(window.location.search)

/** For the mount: whether Privy has been asked for yet. */
export const privyWanted = () => wanted
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
    broken = undefined
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
      loginDone = { resolve, reject }
      loginShowing(true)
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
}

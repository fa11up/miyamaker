import assert from 'node:assert/strict'
import test from 'node:test'

import { privyConnector } from '../src/wallet/privyConnector.ts'

const ME = '0x28C6c06298d514Db089934071355E5743bf21d60'

function fake({ authenticated = false, cancel = false } = {}) {
  const calls: string[] = []
  const events: [string, unknown][] = []
  const handlers: Record<string, (...a: never[]) => void> = {}
  const watchers = new Set<(s: any) => void>()
  let chain = 1
  const provider = {
    request: async ({ method }: { method: string }) =>
      method === 'eth_accounts' ? [ME.toLowerCase()] : `0x${chain.toString(16)}`,
    on: (e: string, f: (...a: never[]) => void) => {
      handlers[e] = f
    },
    removeListener: (e: string) => {
      delete handlers[e]
    },
  }
  const state = {
    ready: true,
    authenticated,
    wallet: authenticated
      ? {
          address: ME,
          getEthereumProvider: async () => provider,
          switchChain: async (id: number) => {
            chain = id
          },
        }
      : undefined,
    openLogin: () => {},
    logout: async () => {
      calls.push('logout')
    },
  }
  const bridge = {
    request: () => calls.push('request'),
    wait: async (pick: (s: typeof state) => unknown) => {
      const value = pick(state)
      if (value === undefined) throw new Error('never came')
      return value
    },
    login: async () => {
      calls.push('login')
      if (cancel) throw new Error('exited_auth_flow')
      state.authenticated = true
      state.wallet = {
        address: ME,
        getEthereumProvider: async () => provider,
        switchChain: async (id: number) => {
          chain = id
        },
      }
    },
    remembered: () => calls.includes('remember:true'),
    remember: (on: boolean) => calls.push(`remember:${on}`),
    watch: (f: (s: typeof state) => void) => {
      watchers.add(f)
      return () => watchers.delete(f)
    },
  }
  const connector = privyConnector(bridge as never, { emit: (e, d) => events.push([e, d]) }, 1)
  const expire = () => {
    state.authenticated = false
    state.wallet = undefined
    ;[...watchers].forEach((f) => f(state))
  }
  return { connector, calls, events, handlers, expire, watchers }
}

test('connecting logs in first, then returns the embedded wallet', async () => {
  const { connector, calls } = fake()
  const got = await connector.connect()
  assert.deepEqual(got, { accounts: [ME], chainId: 1 })
  assert.ok(calls.indexOf('request') < calls.indexOf('login'))
  assert.equal(calls.filter((c) => c === 'login').length, 1)
  assert.ok(calls.includes('remember:true'))
})

test('asking the chain before logging in answers at once, without opening a login', async () => {
  const { connector, calls } = fake()
  assert.equal(await connector.getChainId(), 1)
  assert.deepEqual(calls, [])
})

test('asking for the wallet while logged out fails at once, instead of waiting on a login', async () => {
  const { connector } = fake()
  await assert.rejects(connector.getProvider(), /Not logged in/)
})

test('a reload finds the wallet of someone still logged in', async () => {
  const { connector, calls } = fake({ authenticated: true })
  assert.ok(await connector.getProvider())
  assert.ok(calls.includes('request'), 'Privy has to load to answer')
})

test('someone already logged in is not asked again', async () => {
  const { connector, calls } = fake({ authenticated: true })
  await connector.connect()
  assert.ok(!calls.includes('login'))
})

test('closing the login window counts as declining, not an error', async () => {
  const { connector, calls } = fake({ cancel: true })
  await assert.rejects(connector.connect(), (e: Error) => e.name === 'UserRejectedRequestError')
  assert.ok(!calls.includes('remember:true'))
})

test('it connects on the chain asked for', async () => {
  const { connector } = fake({ authenticated: true })
  assert.equal((await connector.connect({ chainId: 4663 })).chainId, 4663)
})

test('wagmi hears when the wallet changes chain or account', async () => {
  const { connector, events, handlers } = fake({ authenticated: true })
  await connector.connect()
  handlers.chainChanged!('0xaa36a7' as never)
  handlers.accountsChanged!([ME.toLowerCase()] as never)
  assert.deepEqual(events[0], ['change', { chainId: 11155111 }])
  assert.deepEqual(events[1], ['change', { accounts: [ME] }])
})

test('disconnecting logs out and forgets, so a reload stays logged out', async () => {
  const { connector, calls, handlers } = fake({ authenticated: true })
  await connector.connect()
  await connector.disconnect()
  assert.ok(calls.includes('logout') && calls.at(-2) === 'remember:false')
  assert.equal(handlers.chainChanged, undefined)
})

test('a reload only reconnects someone who logged in here before', async () => {
  const first = fake({ authenticated: true })
  assert.equal(await first.connector.isAuthorized(), false)
  assert.ok(!first.calls.includes('request'), 'collectors should never download Privy')
  await first.connector.connect()
  assert.equal(await first.connector.isAuthorized(), true)
})

test('a session ending on Privy\'s side disconnects wagmi and forgets, instead of failing every call', async () => {
  const { connector, calls, events, handlers, expire, watchers } = fake({ authenticated: true })
  await connector.connect()
  expire()
  assert.deepEqual(events.at(-1), ['disconnect', undefined])
  assert.ok(calls.includes('remember:false'))
  assert.equal(handlers.accountsChanged, undefined)
  assert.equal(watchers.size, 0)
})

test('disconnecting stops watching the session', async () => {
  const { connector, events, expire, watchers } = fake({ authenticated: true })
  await connector.connect()
  await connector.disconnect()
  assert.equal(watchers.size, 0)
  const before = events.length
  expire()
  assert.equal(events.length, before)
})

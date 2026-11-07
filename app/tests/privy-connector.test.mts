import assert from 'node:assert/strict'
import test from 'node:test'

import { privyConnector } from '../src/wallet/privyConnector.ts'

const ME = '0x28C6c06298d514Db089934071355E5743bf21d60'

function fake({ authenticated = false, cancel = false } = {}) {
  const calls: string[] = []
  const events: [string, unknown][] = []
  const handlers: Record<string, (...a: never[]) => void> = {}
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
  }
  const connector = privyConnector(bridge as never, { emit: (e, d) => events.push([e, d]) }, 1)
  return { connector, calls, events, handlers }
}

test('connecting logs in first, then returns the embedded wallet', async () => {
  const { connector, calls } = fake()
  const got = await connector.connect()
  assert.deepEqual(got, { accounts: [ME], chainId: 1 })
  assert.deepEqual(calls, ['request', 'login', 'remember:true'])
})

test('asking the chain before logging in answers at once, without opening a login', async () => {
  const { connector, calls } = fake()
  assert.equal(await connector.getChainId(), 1)
  assert.deepEqual(calls, [])
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

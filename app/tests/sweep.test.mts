// Sweep: src/pages/Swap/nft/sweep.ts. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GONE_MS, goneHashes, isWalletRefusal, markGone, MAX_SWEEP, pickCheapest, runSweep, sumPrices, sweepable, sweepTotals } from '../src/pages/Swap/nft/sweep.ts'

const l = (tokenId: string | undefined, amount: bigint, extra = {}) => ({
  hash: `h${tokenId}`,
  tokenId,
  remaining: 1,
  price: { amount, symbol: 'ETH' },
  ...extra,
})

test('sweepable: ETH only, known single NFTs, no duplicates, cheapest first', () => {
  const got = sweepable([
    l('3', 30n),
    l('1', 10n),
    l('2', 20n, { price: { amount: 5n, symbol: 'WETH' } }), // a token price needs its own approval
    l(undefined, 1n),
    l('4', 2n, { remaining: 0 }),
    l('1', 40n), // same NFT again
  ])
  assert.deepEqual(got.map((x) => x.tokenId), ['1', '3'])
})

test('sweepable: never your own listing, whatever the address case', () => {
  const me = '0xAbC0000000000000000000000000000000000001'
  const got = sweepable([l('1', 1n, { maker: me.toLowerCase() }), l('2', 2n, { maker: '0xdef' })], me)
  assert.deepEqual(got.map((x) => x.tokenId), ['2'])
})

test('pickCheapest never passes the cap', () => {
  const many = Array.from({ length: 20 }, (_, i) => i)
  assert.equal(pickCheapest(many, 50).length, MAX_SWEEP)
  assert.deepEqual(pickCheapest(many, 2), [0, 1])
  assert.deepEqual(pickCheapest(many, -1), [])
  assert.equal(sumPrices([l('1', 5n), l('2', 7n)]), 12n)
})

test('sweepTotals adds the checked plans', () => {
  const t = sweepTotals([
    { total: 100n, lines: [{ label: 'To the seller', amount: 99n }, { label: 'OpenSea fee', amount: 1n }] },
    { total: 50n, lines: [{ label: 'To the seller', amount: 49n }, { label: 'OpenSea fee', amount: 1n }] },
  ])
  assert.equal(t.total, 150n)
  assert.deepEqual(t.lines, [{ label: 'To the seller', amount: 148n }, { label: 'OpenSea fee', amount: 2n }])
})

test('only a refusal in the wallet stops the sweep', () => {
  assert.equal(isWalletRefusal('User rejected the request.'), true)
  assert.equal(isWalletRefusal('MetaMask Tx Signature: User denied transaction signature.'), true)
  assert.equal(isWalletRefusal('execution reverted'), false)
  assert.equal(isWalletRefusal('insufficient funds'), false)
})

test('a listing that failed to buy stays hidden for a while, then returns', () => {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  markGone(store, '0xa', 1000)
  markGone(store, '0xb', 2000)
  assert.deepEqual([...goneHashes(store, 3000)], ['0xa', '0xb'])
  assert.deepEqual([...goneHashes(store, 1000 + GONE_MS)], ['0xb'])
  assert.deepEqual([...goneHashes(store, 2000 + GONE_MS)], [])
  assert.equal(goneHashes(undefined).size, 0)
  data.set('miya-market-gone', 'not json')
  assert.equal(goneHashes(store).size, 0)
})

/** A sweep with a pretend wallet. `script` says what happens to each NFT; the log is every prompt that opened. */
function pretend(script: Record<string, Partial<{ sim: unknown; send: unknown; status: string; lookup: unknown }>> = {}) {
  const prompts: string[] = []
  const states: Record<string, { state: string; hash?: string; note?: string }[]> = {}
  let stopped = false
  const deps = {
    simulate: async (id: string) => {
      if (script[id]?.sim) throw script[id].sim
      return id
    },
    send: async (id: string) => {
      prompts.push(id)
      if (script[id]?.send) throw script[id].send
      return `0x${id}`
    },
    wait: async (hash: string) => {
      const id = hash.slice(2)
      if (script[id]?.lookup) throw script[id].lookup
      return { status: script[id]?.status ?? 'success' }
    },
    isStopped: () => stopped,
    isRefusal: (e: unknown) => isWalletRefusal((e as Error).message),
    simulationFailed: () => ({ state: 'gone' as const }),
    sendFailedNote: () => 'send failed',
    revertedNote: 'reverted',
    unconfirmedNote: 'unconfirmed',
    onState: (id: string, run: { state: string; hash?: string; note?: string }) => {
      states[id] = [...(states[id] ?? []), run]
    },
  }
  const last = (id: string) => states[id]!.at(-1)!
  return { deps, prompts, last, stop: () => (stopped = true) }
}

test('a sweep buys in order, one prompt each', async () => {
  const s = pretend()
  await runSweep(['a', 'b'], s.deps)
  assert.deepEqual(s.prompts, ['a', 'b'])
  assert.deepEqual(s.last('a'), { state: 'bought', hash: '0xa' })
})

test('a sold listing is skipped with no prompt, and the sweep goes on', async () => {
  const s = pretend({ a: { sim: new Error('OrderAlreadyFilled') } })
  await runSweep(['a', 'b'], s.deps)
  assert.deepEqual(s.prompts, ['b'])
  assert.equal(s.last('a').state, 'gone')
  assert.equal(s.last('b').state, 'bought')
})

test('a transaction that fails on the network keeps its hash and costs only that NFT', async () => {
  const s = pretend({ a: { status: 'reverted' } })
  await runSweep(['a', 'b'], s.deps)
  assert.deepEqual(s.last('a'), { state: 'failed', hash: '0xa', note: 'reverted' })
  assert.equal(s.last('b').state, 'bought')
})

test('a receipt that cannot be read is not called failed: it may yet land', async () => {
  const s = pretend({ a: { lookup: new Error('rpc down') } })
  await runSweep(['a'], s.deps)
  assert.deepEqual(s.last('a'), { state: 'unconfirmed', hash: '0xa', note: 'unconfirmed' })
})

test('a refusal in the wallet stops every later prompt', async () => {
  const s = pretend({ a: { send: new Error('User rejected the request.') } })
  await runSweep(['a', 'b', 'c'], s.deps)
  assert.deepEqual(s.prompts, ['a'])
  assert.equal(s.last('b').state, 'stopped')
  assert.equal(s.last('c').state, 'stopped')
})

test('any other send failure costs only that NFT', async () => {
  const s = pretend({ a: { send: new Error('nonce too low') } })
  await runSweep(['a', 'b'], s.deps)
  assert.deepEqual(s.last('a'), { state: 'failed', note: 'send failed' })
  assert.deepEqual(s.prompts, ['a', 'b'])
})

test('once the screen has gone, no new wallet prompt opens', async () => {
  const s = pretend()
  const original = s.deps.send
  s.deps.send = async (id: string) => {
    const hash = await original(id)
    s.stop() // the person pressed Back while this one was out
    return hash
  }
  await runSweep(['a', 'b', 'c'], s.deps)
  assert.deepEqual(s.prompts, ['a'], 'the one already out finishes; nothing new opens')
  assert.equal(s.last('a').state, 'bought')
  assert.equal(s.last('b').state, 'stopped')
})

test('leaving during the check before a prompt stops that prompt too', async () => {
  const s = pretend()
  const original = s.deps.simulate
  s.deps.simulate = async (id: string) => {
    const request = await original(id)
    s.stop()
    return request
  }
  await runSweep(['a', 'b'], s.deps)
  assert.deepEqual(s.prompts, [])
  assert.equal(s.last('a').state, 'stopped')
})

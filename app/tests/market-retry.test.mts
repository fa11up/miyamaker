// api/_lib/market.ts: the smaller listings page is asked for only when OpenSea turns the larger one down. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleMarketRequest, memoryCache } from '../api/_lib/market.ts'

const listings = (fail: Error) => {
  const limits: string[] = []
  const run = handleMarketRequest(
    { method: 'GET', url: 'https://www.miyamaker.com/api/market/listings?slug=milady', headers: new Headers() },
    {
      openSea: async (_p, q) => {
        limits.push(q.limit!)
        if (q.limit === '100') throw fail
        return { listings: [] }
      },
      cache: memoryCache(),
      sameOrigin: () => true,
      clientKey: () => 'ip',
      limiter: () => true,
    }
  )
  return { run, limits }
}

test('a 400 tries the smaller page', async () => {
  const { run, limits } = listings(new Error('OpenSea 400'))
  assert.equal((await run).status, 200)
  assert.deepEqual(limits, ['100', '20'])
})

test('a 429, a 500 or a timeout is not asked again', async () => {
  for (const fail of [new Error('OpenSea 429'), new Error('OpenSea 500'), Object.assign(new Error('timed out'), { name: 'TimeoutError' })]) {
    const { run, limits } = listings(fail)
    assert.notEqual((await run).status, 200, fail.message)
    assert.deepEqual(limits, ['100'], fail.message)
  }
})

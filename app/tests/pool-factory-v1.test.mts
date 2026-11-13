// Trade must not call the v1 MiyaPoolFactory with v2's ABI: src/pages/Swap/nft/pool.ts v2PoolFactory, used by
// usePools.poolFactoryFor. Once DeployMiyaPoolV2 writes the v2 factory into deployments/<chainId>.json, pools come on.
// Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { V1_POOL_FACTORIES, v2PoolFactory } from '../src/pages/Swap/nft/pool.ts'

const mainnet = JSON.parse(readFileSync(new URL('../../contracts/deployments/1.json', import.meta.url), 'utf8'))

test('a v1 factory counts as no factory; any other address passes; none stays none', () => {
  const v1 = V1_POOL_FACTORIES[1]![0]!
  assert.equal(v2PoolFactory(1, v1), undefined)
  assert.equal(v2PoolFactory(1, v1.toLowerCase()), undefined)
  const v2 = '0x00000000000000000000000000000000000000b2'
  assert.equal(v2PoolFactory(1, v2), v2)
  assert.equal(v2PoolFactory(11155111, v1), v1, 'only listed per chain')
  assert.equal(v2PoolFactory(1, undefined), undefined)
})

test('mainnet: the deployments file names either the v1 factory (pools off) or a v2 one that also records v1', () => {
  const named: string = mainnet.miyaPoolFactory
  if (v2PoolFactory(1, named) === undefined) assert.equal(mainnet.miyaPoolFactoryV1, undefined)
  else assert.ok(V1_POOL_FACTORIES[1]!.some((a) => a.toLowerCase() === String(mainnet.miyaPoolFactoryV1).toLowerCase()))
})

test('usePools reads the factory through the v1 guard', () => {
  const src = readFileSync(new URL('../src/pages/Swap/nft/usePools.ts', import.meta.url), 'utf8')
  assert.match(src, /v2PoolFactory\(chainId, miyamintsAddresses\(chainId\)\.miyaPoolFactory\)/)
})

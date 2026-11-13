// A pool page opened from a link shows only a pool this chain's factory made (src/pages/Swap/nft/pool.ts
// factoryMadePool, used by usePools.usePool). Any other contract that answers collection() and kind() could otherwise
// ask for setApprovalForAll over a whole collection. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { factoryMadePool } from '../src/pages/Swap/nft/pool.ts'

const POOL = '0x1111111111111111111111111111111111111111'
const FAKE = '0x2222222222222222222222222222222222222222'

test("the factory's poolOf answer decides: same address yes, another or none no, unanswered unknown", () => {
  assert.equal(factoryMadePool(POOL, POOL), true)
  assert.equal(factoryMadePool(POOL.toUpperCase().replace('0X', '0x'), POOL), true)
  assert.equal(factoryMadePool(POOL, FAKE), false)
  assert.equal(factoryMadePool('0x0000000000000000000000000000000000000000', FAKE), false)
  assert.equal(factoryMadePool(undefined, POOL), undefined)
})

test('usePool hands PoolView a pool only when the factory made it, and PoolView says when it did not', () => {
  const hook = readFileSync(new URL('../src/pages/Swap/nft/usePools.ts', import.meta.url), 'utf8')
  assert.match(hook, /functionName: 'poolOf'/)
  assert.match(hook, /pool: fromFactory \? claimed : undefined/)
  const view = readFileSync(new URL('../src/pages/Swap/nft/PoolView.tsx', import.meta.url), 'utf8')
  assert.match(view, /info\.notFromFactory/)
  assert.match(view, /is not a MiyaPool/)
})

// Editions (ERC-1155) don't get a MiyaPool from the app: they trade on their own price curve
// (contracts/docs/CURVE-EDITIONS.md). src/pages/Swap/nft/pool.ts poolStartFor decides from ERC-165, and CreatePool shows
// the form only for 'pool'. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ERC721_INTERFACE, ERC1155_INTERFACE, poolStartFor } from '../src/pages/Swap/nft/pool.ts'

test('ERC-721 may start a pool; an ERC-1155 edition gets the curve; neither is unsupported; unknown offers nothing', () => {
  assert.equal(poolStartFor(true, false), 'pool')
  assert.equal(poolStartFor(true, undefined), 'pool')
  assert.equal(poolStartFor(false, true), 'curve')
  assert.equal(poolStartFor(undefined, true), 'curve')
  assert.equal(poolStartFor(false, false), 'unsupported')
  assert.equal(poolStartFor(undefined, undefined), undefined)
  assert.equal(poolStartFor(false, undefined), undefined)
  // The same ids the factory's _detectKind asks for.
  const factory = readFileSync(new URL('../../contracts/src/pools/MiyaPoolFactory.sol', import.meta.url), 'utf8')
  assert.match(factory, new RegExp(ERC721_INTERFACE.slice(2), 'i'))
  assert.match(factory, new RegExp(ERC1155_INTERFACE.slice(2), 'i'))
})

test('CreatePool renders the form only for an ERC-721, and says editions trade on a curve', () => {
  const src = readFileSync(new URL('../src/pages/Swap/nft/CreatePool.tsx', import.meta.url), 'utf8')
  assert.match(src, /if \(kind\.start === 'pool'\) return <CreatePoolForm \{\.\.\.props\} \/>/)
  assert.match(src, /data-edition-curve/)
  // Nothing else renders the form.
  assert.equal([...src.matchAll(/<CreatePoolForm/g)].length, 1)
})

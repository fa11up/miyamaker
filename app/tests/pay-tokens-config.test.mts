// The app's mainnet token table (src/miyamints/tokens.ts) is the deploy config's allowlist
// (contracts/script/config/1.json `paymentTokens`, which the deploy script puts on the registry), plus ETH. A token
// added to one and not the other would be offered but refused, or allowed but never offered. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { getAddress, zeroAddress } from 'viem'

import { payTokens } from '../src/miyamints/tokens.ts'

test("the app's mainnet tokens are config/1.json's paymentTokens plus ETH", () => {
  const config = JSON.parse(readFileSync(new URL('../../contracts/script/config/1.json', import.meta.url), 'utf8')) as {
    paymentTokens: string[]
  }
  assert.ok(Array.isArray(config.paymentTokens) && config.paymentTokens.length > 0, 'config/1.json has no paymentTokens')
  const fromConfig = config.paymentTokens.map((a) => getAddress(a)).sort()
  const app = payTokens(1)
    .map((t) => getAddress(t.address))
    .filter((a) => a !== zeroAddress)
    .sort()
  assert.deepEqual(app, fromConfig)
  assert.ok(payTokens(1).some((t) => t.address === zeroAddress), 'ETH is always offered')
})

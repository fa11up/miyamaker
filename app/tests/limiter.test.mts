// api/_lib/zeroex.ts: the per-isolate rate limiter keys IPv6 by /64 and drops the least recently seen key. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clientKey, createRateLimiter, ipBucket } from '../api/_lib/zeroex.ts'

test('IPv4 is kept as it is; IPv6 is keyed by its /64, however it is written', () => {
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9')
  const a = ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
  assert.equal(a, '2001:db8:1:2::/64')
  assert.equal(ipBucket('2001:0DB8:0001:0002::1'), a, 'zero padding and case')
  assert.equal(ipBucket('[2001:db8:1:2::ffff]'), a, 'brackets')
  assert.equal(ipBucket('2001:db8:1:2::1%eth0'), a, 'zone id')
  assert.notEqual(ipBucket('2001:db8:1:3::1'), a, 'the next /64 is someone else')
  assert.equal(ipBucket('::1'), '0:0:0:0::/64')
  assert.equal(ipBucket('2001:db8::'), '2001:db8:0:0::/64')
  assert.equal(ipBucket('::ffff:198.51.100.7'), '198.51.100.7', 'IPv4-mapped counts as the IPv4 address')
  assert.equal(ipBucket('64:ff9b::198.51.100.7'), '64:ff9b:0:0::/64', 'embedded IPv4 tail')
  assert.equal(ipBucket('not:an::ip::x'), 'not:an::ip::x', 'unparseable is kept as it is')
  assert.equal(ipBucket('1:2:3:4:5:6:7:8:9'), '1:2:3:4:5:6:7:8:9')
})

test('one /64 shares one bucket, so rotating addresses inside it gains nothing', () => {
  const limit = createRateLimiter({ capacity: 2, perSecond: 0 })
  const from = (ip: string) => limit(clientKey(new Headers({ 'cf-connecting-ip': ip })), 0)
  assert.equal(from('2001:db8:1:2::1'), true)
  assert.equal(from('2001:db8:1:2::2'), true)
  assert.equal(from('2001:db8:1:2:ffff::3'), false)
  assert.equal(from('2001:db8:9:9::1'), true, 'another network has its own')
})

test('at the key limit the least recently seen key goes, not half of everyone', () => {
  const limit = createRateLimiter({ capacity: 1, perSecond: 0, maxKeys: 3 })
  assert.equal(limit('a', 0), true)
  assert.equal(limit('b', 0), true)
  assert.equal(limit('c', 0), true)
  assert.equal(limit('a', 1), false, 'a is seen again (and still limited), so b is now the oldest')
  assert.equal(limit('d', 2), true, 'b is dropped to make room')
  assert.equal(limit('a', 3), false, 'a kept its spent bucket')
  assert.equal(limit('c', 3), false, 'c kept its spent bucket')
  assert.equal(limit('b', 4), true, 'b was the one forgotten')
})

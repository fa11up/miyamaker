// src/utils/ipfsGateways.ts: IPFS URL rewriting and the gateway race. Run: yarn test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gatewayUrls, ipfsPath, nextGatewayUrl, raceJson } from '../src/utils/ipfsGateways.ts'

const CID = 'bafybeidsnehr3okth4fabhahukedeufwu7wuwicqrnpt7cozcj4dmsnz34'
const GW = ['https://a.example/ipfs/', 'https://b.example/ipfs', 'https://c.example/ipfs/']

test('ipfsPath: every IPFS spelling, nothing else', () => {
  assert.equal(ipfsPath(`ipfs://${CID}/1.jpg`), `${CID}/1.jpg`)
  assert.equal(ipfsPath(`ipfs://ipfs/${CID}/1.jpg`), `${CID}/1.jpg`)
  assert.equal(ipfsPath(`https://ipfs.filebase.io/ipfs/${CID}/1.jpg`), `${CID}/1.jpg`)
  assert.equal(ipfsPath(`https://gateway.pinata.cloud/ipfs/${CID}/x?y=1`), `${CID}/x?y=1`)
  assert.equal(ipfsPath(`https://${CID}.ipfs.dweb.link/1.jpg`), `${CID}/1.jpg`)
  assert.equal(ipfsPath(`https://${CID}.ipfs.w3s.link/`), CID)
  assert.equal(ipfsPath('https://koolskull.com/miyamakermini/metadata/images/1.png'), undefined)
  assert.equal(ipfsPath('data:image/png;base64,AAAA'), undefined)
  assert.equal(ipfsPath('ar://abc'), undefined)
  assert.equal(ipfsPath(''), undefined)
  assert.equal(ipfsPath(undefined), undefined)
  assert.equal(ipfsPath('ipfs://'), undefined)
})

test('gatewayUrls: primary first, slashes normalised, non-IPFS http passes through', () => {
  assert.deepEqual(gatewayUrls(`ipfs://${CID}/1.jpg`, GW), [
    `https://a.example/ipfs/${CID}/1.jpg`,
    `https://b.example/ipfs/${CID}/1.jpg`,
    `https://c.example/ipfs/${CID}/1.jpg`,
  ])
  assert.deepEqual(gatewayUrls('https://x.example/a.png', GW), ['https://x.example/a.png'])
  assert.deepEqual(gatewayUrls('javascript:alert(1)', GW), [])
  assert.deepEqual(gatewayUrls(undefined, GW), [])
})

test('nextGatewayUrl: walks the list, then stops; foreign gateways fall back to the primary', () => {
  const first = `https://a.example/ipfs/${CID}/1.jpg`
  const second = nextGatewayUrl(first, GW)
  assert.equal(second, `https://b.example/ipfs/${CID}/1.jpg`)
  const third = nextGatewayUrl(second!, GW)
  assert.equal(third, `https://c.example/ipfs/${CID}/1.jpg`)
  assert.equal(nextGatewayUrl(third!, GW), undefined)
  assert.equal(nextGatewayUrl(`https://slow.example/ipfs/${CID}/1.jpg`, GW), first)
  assert.equal(nextGatewayUrl('https://x.example/a.png', GW), undefined)
})

type Plan = Record<string, { ms: number; ok?: boolean; body?: unknown; throws?: boolean }>
function fakeFetch(plan: Plan, log: string[]) {
  return (url: string, init?: { signal?: AbortSignal }) =>
    new Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>((resolve, reject) => {
      log.push(`start ${url}`)
      const p = plan[url]!
      const t = setTimeout(() => {
        if (p.throws) reject(new Error(`net ${url}`))
        else resolve({ ok: p.ok !== false, status: p.ok === false ? 500 : 200, json: async () => p.body })
      }, p.ms)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t)
        log.push(`abort ${url}`)
        reject(new Error('aborted'))
      })
    })
}

test('raceJson: fast primary wins alone, no fallback is started', async () => {
  const log: string[] = []
  const v = await raceJson(['a', 'b'], {
    fetchImpl: fakeFetch({ a: { ms: 5, body: 1 }, b: { ms: 1, body: 2 } }, log),
    headStartMs: 50,
  })
  assert.equal(v, 1)
  assert.deepEqual(log, ['start a'])
})

test('raceJson: slow primary gets raced by the next gateway after the head start; loser aborted', async () => {
  const log: string[] = []
  const v = await raceJson(['a', 'b'], {
    fetchImpl: fakeFetch({ a: { ms: 200, body: 1 }, b: { ms: 5, body: 2 } }, log),
    headStartMs: 20,
  })
  assert.equal(v, 2)
  assert.deepEqual(log, ['start a', 'start b', 'abort a'])
})

test('raceJson: a failure starts the next candidate straight away', async () => {
  const log: string[] = []
  const t0 = Date.now()
  const v = await raceJson(['a', 'b', 'c'], {
    fetchImpl: fakeFetch({ a: { ms: 1, ok: false }, b: { ms: 1, throws: true }, c: { ms: 1, body: 'c' } }, log),
    headStartMs: 1000,
  })
  assert.equal(v, 'c')
  assert.ok(Date.now() - t0 < 500, 'did not wait for the head start')
})

test('raceJson: rejects when every candidate fails', async () => {
  const log: string[] = []
  await assert.rejects(
    raceJson(['a', 'b'], {
      fetchImpl: fakeFetch({ a: { ms: 1, ok: false }, b: { ms: 2, throws: true } }, log),
      headStartMs: 1,
    }),
    /net b|HTTP 500/
  )
  await assert.rejects(raceJson([]), /no url/)
})

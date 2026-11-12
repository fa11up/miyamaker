// Drop allowlists: the Merkle tree against the drop's own check (api/_lib/allowlist.ts), the proof route, the page's
// side of it (src/miyamints/allowlistApi.ts), allowlist phases in the Launch window (src/miyamints/launch.ts), where a
// wallet stands on the Mint page (src/pages/Mint/liveMints.ts) and the check before a claim (src/miyamints/precheck.ts).
// The contract side of the same fixture: contracts/test/factories/erc721drop/AllowlistProof.t.sol. Run: yarn test
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from 'viem'

import './ts-paths.mts'
import {
  ALLOWLIST_PATH,
  buildTree,
  clearAllowlistCache,
  handleAllowlistRequest,
  leafHash,
  MAX_PASTED,
  MAX_SAVED_BYTES_PER_DAY,
  MAX_SAVED_PER_CLIENT_PER_DAY,
  memoryAllowlistStore,
  parseAddressList,
  proofFor,
  readDump,
  readStored,
  verifyProof,
} from '../api/_lib/allowlist.ts'

const { fetchProof, saveList } = await import('../src/miyamints/allowlistApi.ts')
const { buildDropArgs, buildPhases, EMPTY_FORM, EMPTY_PHASE, phaseLine, phaseList, validateStep, ZERO_ROOT } =
  await import('../src/miyamints/launch.ts')
const { SNAPSHOTS } = await import('../src/miyamints/snapshots.ts')
const { defaultPhase, listStanding, livePhases } = await import('../src/pages/Mint/liveMints.ts')
const { phaseGate } = await import('../src/miyamints/precheck.ts')

// vm.addr(1..5): the same list, root and proofs as AllowlistProof.t.sol (and @openzeppelin/merkle-tree 1.0.8).
const FIXTURE = [
  '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
  '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
  '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69',
  '0x1efF47bc3a10a45D4B230B5d10E37751FE6AA718',
  '0xe1AB8145F7E55DC933d51a18c793F901A3A0b276',
] as const
const ROOT = '0x6516e9023c69d23b0e7acfe325d6ac80d903995bfa8e6c21cfd69c29641dcb88'
const OUTSIDER = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cE'.toLowerCase()

// ── the tree ─────────────────────────────────────────────────────────────────

test('the leaf is keccak256(bytes.concat(keccak256(abi.encode(minter)))), as the drop computes it', () => {
  const a = FIXTURE[0]
  const inner = keccak256(encodeAbiParameters([{ type: 'address' }], [a]))
  assert.equal(leafHash(a), keccak256(inner))
  assert.equal(leafHash(a.toLowerCase()), leafHash(a), 'case does not matter')
})

test('the tree matches the fixture the contract test and OpenZeppelin agree on', () => {
  const t = buildTree([...FIXTURE])
  assert.equal(t.root, ROOT)
  assert.equal(t.tree.length, 9)
  assert.deepEqual(proofFor(t, FIXTURE[1]), [
    '0x6f5b375129e5d3e90227e2a092e5caff7cbd38b45a32e309f63ad206f53b06b9',
    '0xf36a8b87aafd9478d7d2381b28af812b645a6b4ef1df15781b38e01ef44d0b5c',
    '0x6cf0097f042524f835616809205a097cf0638ac55071e132fca827c763d5b018',
  ])
  for (const a of FIXTURE) assert.ok(verifyProof(ROOT, a, proofFor(t, a)!), a)
  // Same list in any order, any case, with repeats: same root.
  assert.equal(buildTree([...FIXTURE].reverse().map((a) => a.toLowerCase()).concat(FIXTURE[2])).root, ROOT)
})

test('a proof proves only its own address, and only under its own root', () => {
  const t = buildTree([...FIXTURE])
  const p = proofFor(t, FIXTURE[0])!
  assert.equal(verifyProof(ROOT, FIXTURE[1], p), false)
  assert.equal(verifyProof(ROOT, OUTSIDER, p), false)
  assert.equal(verifyProof(`0x${'1'.repeat(64)}`, FIXTURE[0], p), false)
  assert.equal(proofFor(t, OUTSIDER), undefined)
  assert.equal(verifyProof(ROOT, FIXTURE[0], [...p, ROOT]), false)
  assert.equal(verifyProof(ROOT, FIXTURE[0], ['0xnot']), false)
})

test('a one-wallet list: the root is its leaf and the proof is empty (MerkleProofLib accepts that)', () => {
  const t = buildTree([FIXTURE[3]])
  assert.equal(t.root, leafHash(FIXTURE[3]))
  assert.deepEqual(proofFor(t, FIXTURE[3]), [])
  assert.ok(verifyProof(t.root, FIXTURE[3], []))
})

test('every proof of a bigger, odd-sized tree verifies', () => {
  const many = Array.from({ length: 777 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`))
  const t = buildTree(many)
  for (const v of t.values) assert.ok(verifyProof(t.root, v.value[0], proofFor(t, v.value[0])!))
  assert.ok(readDump(JSON.parse(JSON.stringify(t))))
})

test('buildTree refuses an empty list and anything that is not an address', () => {
  assert.throws(() => buildTree([]), /at least one/)
  assert.throws(() => buildTree(['0x1234']), /Not an address/)
  assert.throws(() => buildTree([zeroAddress]), /Not an address/)
})

test('readDump takes an OpenZeppelin dump and refuses malformed ones', () => {
  const { root: _root, ...dump } = buildTree([...FIXTURE])
  assert.ok(readDump(dump))
  assert.equal(readDump({ ...dump, format: 'simple-v1' }), undefined)
  assert.equal(readDump({ ...dump, leafEncoding: ['uint256'] }), undefined)
  assert.equal(readDump({ ...dump, tree: dump.tree.slice(1) }), undefined)
  assert.equal(readDump({ ...dump, values: [{ value: ['0x1'], treeIndex: 8 }, ...dump.values.slice(1)] }), undefined)
  assert.equal(readDump({ ...dump, values: [{ value: [FIXTURE[0]], treeIndex: 0 }, ...dump.values.slice(1)] }), undefined)
  assert.equal(readDump('<html>'), undefined)
})

test('the published holder lists load, match their manifest entry and give proofs that verify', () => {
  for (const s of SNAPSHOTS) {
    const path = new URL(`../public/allowlists/${s.root}.json`, import.meta.url)
    assert.ok(existsSync(path), `public/allowlists/${s.root}.json for ${s.name}`)
    const d = readDump(JSON.parse(readFileSync(path, 'utf8')))
    assert.ok(d, s.name)
    assert.equal(d.tree[0], s.root)
    assert.equal(d.values.length, s.count)
    assert.equal(d.miya?.source?.block, s.block)
    assert.equal(d.miya?.source?.contract.toLowerCase(), s.contract.toLowerCase())
    for (const v of d.values.filter((_, i) => i % 97 === 0)) assert.ok(verifyProof(s.root, v.value[0], proofFor(d, v.value[0])!))
  }
})

// ── pasted lists ─────────────────────────────────────────────────────────────

test('parseAddressList reads lines and CSVs, counts repeats and names what is not an address', () => {
  const csv = `address,amount\n${FIXTURE[0]},1\n${FIXTURE[1].toLowerCase()};2\n${FIXTURE[0]}\n"${FIXTURE[2]}"`
  const r = parseAddressList(csv)
  assert.deepEqual(r.addresses, [FIXTURE[0], FIXTURE[1], FIXTURE[2]])
  assert.equal(r.duplicates, 1)
  assert.deepEqual(r.bad, [])
  const bad = parseAddressList(`${FIXTURE[3]}\nmiya.eth\n0x1234\n${zeroAddress}\n0x7e5F4552091A69125d5DfCb7b8C2659029395Bdf`)
  assert.deepEqual(bad.addresses, [FIXTURE[3]])
  assert.deepEqual(bad.bad, ['miya.eth', '0x1234', zeroAddress, '0x7e5F4552091A69125d5DfCb7b8C2659029395Bdf'])
})

// ── the route ────────────────────────────────────────────────────────────────

const ORIGIN = 'https://www.miyamaker.com'
const sameOrigin = (h: Headers | undefined) => h?.get('origin') === ORIGIN
const { root: _r, ...FIXTURE_DUMP } = buildTree([...FIXTURE])

function deps(over: Partial<Parameters<typeof handleAllowlistRequest>[1]> = {}) {
  return {
    readStatic: async (root: string) => (root === ROOT ? FIXTURE_DUMP : undefined),
    store: memoryAllowlistStore(),
    sameOrigin,
    clientKey: () => 'k',
    limiter: () => true,
    writeLimiter: () => true,
    ...over,
  }
}
const get = (path: string, d = deps()) => handleAllowlistRequest({ method: 'GET', url: `${ORIGIN}${path}` }, d)
const post = (body: unknown, d = deps(), origin = ORIGIN) =>
  handleAllowlistRequest(
    { method: 'POST', url: `${ORIGIN}${ALLOWLIST_PATH}`, headers: new Headers({ origin }), body: JSON.stringify(body) },
    d
  )

test('GET answers listed with a proof, not listed, or 404 naming the root miya has no list for', async () => {
  clearAllowlistCache()
  const yes = await (await get(`${ALLOWLIST_PATH}/${ROOT}?address=${FIXTURE[2].toLowerCase()}`)).json()
  assert.equal(yes.listed, true)
  assert.equal(yes.address, FIXTURE[2])
  assert.ok(verifyProof(ROOT, FIXTURE[2], yes.proof))
  const no = await (await get(`${ALLOWLIST_PATH}/${ROOT}?address=${OUTSIDER}`)).json()
  assert.deepEqual(no, { root: ROOT, address: getAddress(OUTSIDER), listed: false })
  const info = await (await get(`${ALLOWLIST_PATH}/${ROOT}`)).json()
  assert.equal(info.count, 5)
  const missing = await get(`${ALLOWLIST_PATH}/0x${'ab'.repeat(32)}?address=${OUTSIDER}`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).root, `0x${'ab'.repeat(32)}`)
  assert.equal((await get(`${ALLOWLIST_PATH}/${ROOT}?address=0x12`)).status, 400)
  assert.equal((await get(`${ALLOWLIST_PATH}/nope`)).status, 404)
  const limited = await get(`${ALLOWLIST_PATH}/${ROOT}?address=${OUTSIDER}`, deps({ limiter: () => false }))
  assert.equal(limited.status, 429)
})

test('a shipped file whose tree is for another root is not served under that root', async () => {
  clearAllowlistCache()
  const other = `0x${'cd'.repeat(32)}`
  const r = await get(`${ALLOWLIST_PATH}/${other}?address=${FIXTURE[0]}`, deps({ readStatic: async () => FIXTURE_DUMP }))
  assert.equal(r.status, 503)
  assert.equal((await r.json()).root, undefined, 'a broken copy is not "no list"')
})

test('a list that could not be read is 503 without a root (the page shows "couldn\'t check"), never 404', async () => {
  const q = `${ALLOWLIST_PATH}/${ROOT}?address=${FIXTURE[0]}`
  const answer = async (d: ReturnType<typeof deps>) => {
    clearAllowlistCache()
    const r = await get(q, d)
    return { status: r.status, root: (await r.json()).root }
  }
  const down = async () => Promise.reject(new Error('asset store down'))
  assert.deepEqual(await answer(deps({ readStatic: down })), { status: 503, root: undefined })
  assert.deepEqual(await answer(deps({ readStatic: async () => '<html>' })), { status: 503, root: undefined })
  const d1Down = { get: down, put: async () => true, usageSince: async () => ({ lists: 0, bytes: 0 }) }
  assert.deepEqual(await answer(deps({ readStatic: async () => undefined, store: d1Down })), { status: 503, root: undefined })
  const badRow = { ...d1Down, get: async () => ({ not: 'a list' }) }
  assert.deepEqual(await answer(deps({ readStatic: async () => undefined, store: badRow })), { status: 503, root: undefined })
  // A row whose addresses build another root is a broken copy too.
  const otherRow = { ...d1Down, get: async () => [FIXTURE[0].toLowerCase()] }
  assert.deepEqual(await answer(deps({ readStatic: async () => undefined, store: otherRow })), { status: 503, root: undefined })
  const nothing = { ...d1Down, get: async () => undefined }
  assert.deepEqual(await answer(deps({ readStatic: async () => undefined, store: nothing })), { status: 404, root: ROOT })
  clearAllowlistCache()
  assert.equal((await fetchProof(ROOT, FIXTURE[0], async () => get(q, deps({ readStatic: down })))).state, 'unknown')
})

test('answers for a shipped list may be cached (a root is fixed); a missing list and a pasted one are not', async () => {
  clearAllowlistCache()
  const yes = await get(`${ALLOWLIST_PATH}/${ROOT}?address=${FIXTURE[0]}`)
  assert.match(yes.headers.get('cache-control') ?? '', /immutable/)
  assert.match(yes.headers.get('cache-control') ?? '', /s-maxage=/)
  const missing = await get(`${ALLOWLIST_PATH}/0x${'ab'.repeat(32)}?address=${OUTSIDER}`)
  assert.equal(missing.headers.get('cache-control'), 'no-store')
  const d = deps({ readStatic: async () => undefined })
  const saved = await (await post({ addresses: FIXTURE.slice(0, 2) }, d)).json()
  const pasted = await get(`${ALLOWLIST_PATH}/${saved.root}?address=${FIXTURE[0]}`, d)
  assert.equal(pasted.status, 200)
  assert.equal(pasted.headers.get('cache-control'), 'no-store')
})

test('POST saves a pasted list under the root miya works out, once, from this site only', async () => {
  clearAllowlistCache()
  const d = deps({ readStatic: async () => undefined })
  const saved = await (await post({ addresses: [FIXTURE[4], FIXTURE[0], FIXTURE[0]] }, d)).json()
  const expect = buildTree([FIXTURE[0], FIXTURE[4]]).root
  assert.deepEqual(saved, { root: expect, count: 2 })
  const again = await post({ addresses: [FIXTURE[0], FIXTURE[4]] }, d)
  assert.equal(again.status, 200, 'the same list again is fine')
  const proof = await (await get(`${ALLOWLIST_PATH}/${expect}?address=${FIXTURE[4]}`, d)).json()
  assert.ok(verifyProof(expect, FIXTURE[4], proof.proof))

  assert.equal((await post({ addresses: [FIXTURE[0]] }, d, 'https://evil.example')).status, 403)
  assert.equal((await post({ addresses: [] }, d)).status, 400)
  assert.equal((await post({ addresses: ['0x12'] }, d)).status, 400)
  assert.equal((await post({ addresses: [zeroAddress] }, d)).status, 400)
  const many = Array.from({ length: MAX_PASTED + 1 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`)
  assert.equal((await post({ addresses: many }, d)).status, 413)
  assert.equal((await post({ addresses: [FIXTURE[1]] }, deps({ writeLimiter: () => false }))).status, 429)
  const broken = deps({
    store: {
      get: async () => Promise.reject(new Error('no such table: allowlists')),
      put: async () => true,
      usageSince: async () => ({ lists: 0, bytes: 0 }),
    },
  })
  assert.equal((await post({ addresses: [FIXTURE[1]] }, broken)).status, 503)
  const full = deps({ store: { get: async () => undefined, put: async () => true, usageSince: async () => ({ lists: 10_000, bytes: 0 }) } })
  assert.equal((await post({ addresses: [FIXTURE[1]] }, full)).status, 429)
  const heavy = deps({
    store: { get: async () => undefined, put: async () => true, usageSince: async () => ({ lists: 1, bytes: MAX_SAVED_BYTES_PER_DAY }) },
  })
  assert.equal((await post({ addresses: [FIXTURE[1]] }, heavy)).status, 429, 'the day has a byte ceiling too')
})

test('a pasted list is stored as its sorted lowercase addresses only, and one client gets a daily cap', async () => {
  clearAllowlistCache()
  const rows: { root: string; body: unknown; client?: string }[] = []
  const store = memoryAllowlistStore()
  const spy = {
    ...store,
    put: async (root: `0x${string}`, addresses: readonly string[], at: number, client?: string) => {
      rows.push({ root, body: addresses, client })
      return store.put(root, addresses, at, client)
    },
  }
  const d = deps({ readStatic: async () => undefined, store: spy, clientKey: () => '203.0.113.7' })
  const saved = await (await post({ addresses: [FIXTURE[4], FIXTURE[0]] }, d)).json()
  assert.deepEqual(rows[0]!.body, [FIXTURE[0].toLowerCase(), FIXTURE[4].toLowerCase()].sort())
  assert.match(rows[0]!.client ?? '', /^[0-9a-f]{32}$/, 'the client is kept hashed')
  assert.ok(!(rows[0]!.client ?? '').includes('203'), 'no IP stored')
  assert.deepEqual(await store.get(saved.root), [FIXTURE[0].toLowerCase(), FIXTURE[4].toLowerCase()].sort())
  assert.equal(readStored(await store.get(saved.root))?.length, 2)
  // The reply checksums only the wallet asked about.
  const one = await (await get(`${ALLOWLIST_PATH}/${saved.root}?address=${FIXTURE[4].toLowerCase()}`, d)).json()
  assert.equal(one.address, FIXTURE[4])
  assert.ok(verifyProof(saved.root, FIXTURE[4], one.proof))

  let n = 1
  for (; n < MAX_SAVED_PER_CLIENT_PER_DAY; n += 1) {
    assert.equal((await post({ addresses: [`0x${(n + 100).toString(16).padStart(40, '0')}`] }, d)).status, 200)
  }
  const over = await post({ addresses: [`0x${'7'.repeat(40)}`] }, d)
  assert.equal(over.status, 429)
  const elsewhere = deps({ readStatic: async () => undefined, store: spy, clientKey: () => '198.51.100.1' })
  assert.equal((await post({ addresses: [`0x${'7'.repeat(40)}`] }, elsewhere)).status, 200, 'another client still can')
  assert.equal(readStored(['0xb', '0xa']), undefined)
  assert.equal(readStored([FIXTURE[1].toLowerCase(), FIXTURE[0].toLowerCase()].sort().reverse()), undefined, 'out of order')
  assert.equal(readStored([FIXTURE[0]]), undefined, 'checksummed case is not how rows are stored')
})

// ── the page's side ──────────────────────────────────────────────────────────

const fakeFetch = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('fetchProof checks the proof against the root before trusting it', async () => {
  const proof = proofFor(buildTree([...FIXTURE]), FIXTURE[0])!
  assert.deepEqual(await fetchProof(ROOT, FIXTURE[0], fakeFetch(200, { listed: true, proof })), { state: 'listed', proof })
  assert.equal((await fetchProof(ROOT, FIXTURE[1], fakeFetch(200, { listed: true, proof }))).state, 'unknown')
  assert.equal((await fetchProof(ROOT, OUTSIDER, fakeFetch(200, { listed: false }))).state, 'not-listed')
  assert.equal((await fetchProof(ROOT, OUTSIDER, fakeFetch(404, { root: ROOT }))).state, 'no-list')
  assert.equal((await fetchProof(ROOT, OUTSIDER, fakeFetch(404, { error: 'Not found.' }))).state, 'unknown')
  assert.equal((await fetchProof(ROOT, OUTSIDER, fakeFetch(500, {}))).state, 'unknown')
  assert.equal((await fetchProof(ROOT, OUTSIDER, async () => Promise.reject(new Error('offline')))).state, 'unknown')
  assert.equal((await fetchProof(ZERO_ROOT, OUTSIDER, fakeFetch(200, { listed: false }))).state, 'unknown')
})

test('saveList resolves only when miya filed the list under the same root', async () => {
  await saveList([...FIXTURE], ROOT, fakeFetch(200, { root: ROOT, count: 5 }))
  await assert.rejects(saveList([...FIXTURE], ROOT, fakeFetch(200, { root: `0x${'1'.repeat(64)}` })), /different list/)
  await assert.rejects(saveList([...FIXTURE], ROOT, fakeFetch(503, { error: 'Nope.' })), /Nope\. Nothing was created\./)
  await assert.rejects(saveList([...FIXTURE], ROOT, async () => Promise.reject(new Error('x'))), /Couldn't reach miya/)
})

// ── Launch: allowlist phases ─────────────────────────────────────────────────

const ETH_T = { address: zeroAddress, symbol: 'ETH', decimals: 18 } as const
const NOW = 1_800_000_000n
const SNAP = [
  { name: 'Milady holders', chainId: 1, contract: '0x5Af0D9827E0c53E4799BB226655A1de152A425a5', block: 1, blockTime: 1, root: ROOT, count: 5, contracts: 0 },
]
const free = { [zeroAddress]: '0' }

test('a list phase gets its list root; a public phase the zero root', () => {
  const pasted = { ...EMPTY_PHASE, access: 'list' as const, listSource: 'pasted' as const, listText: FIXTURE.join('\n') }
  const snap = { ...EMPTY_PHASE, access: 'list' as const, listSource: 'snapshot' as const, snapshotRoot: ROOT }
  const r = buildPhases(
    [
      { ...pasted, prices: free, maxPerWallet: '1', supplyCap: '333' },
      { ...snap, prices: free, maxPerWallet: '1' },
      { ...EMPTY_PHASE, prices: { [zeroAddress]: '0.01' } },
    ],
    NOW,
    [ETH_T],
    SNAP
  )
  assert.ok(r.ok, !r.ok ? r.error : '')
  assert.equal(r.phases[0]!.merkleRoot, ROOT)
  assert.equal(r.phases[0]!.supplyCap, 333)
  assert.deepEqual(r.phases[0]!.prices, [{ token: zeroAddress, price: 0n }])
  assert.equal(r.phases[1]!.merkleRoot, ROOT)
  assert.equal(r.phases[2]!.merkleRoot, ZERO_ROOT)
})

test('list phases say plainly what is wrong with the list', () => {
  const bad = (p: object) => {
    const r = buildPhases([{ ...EMPTY_PHASE, prices: free, maxPerWallet: '1', access: 'list', ...p }], NOW, [ETH_T], SNAP)
    return r.ok ? '' : r.error
  }
  assert.match(bad({ listSource: 'snapshot', snapshotRoot: '' }), /Pick a holder list/)
  assert.match(bad({ listSource: 'snapshot', snapshotRoot: `0x${'9'.repeat(64)}` }), /Pick a holder list/)
  assert.match(bad({ listSource: 'pasted', listText: '' }), /Paste the wallet addresses/)
  assert.match(bad({ listSource: 'pasted', listText: `${FIXTURE[0]}\nmiya.eth` }), /1 entry is not a wallet address, like "miya\.eth"/)
  const many = Array.from({ length: MAX_PASTED + 1 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`).join('\n')
  assert.match(bad({ listSource: 'pasted', listText: many }), /at most 5,000/)
})

test('phaseLine and phaseList say who is on the list', () => {
  const snap = { ...EMPTY_PHASE, access: 'list' as const, snapshotRoot: ROOT, prices: free, maxPerWallet: '1', supplyCap: '333' }
  assert.equal(
    phaseLine(snap, [ETH_T], SNAP),
    'Milady holders (5 wallets) only: Free, limit 1 per wallet, 333 for sale, starts right away'
  )
  const l = phaseList({ ...EMPTY_PHASE, access: 'list', listSource: 'pasted', listText: FIXTURE.join(',') })
  assert.ok(l.ok && l.root === ROOT && l.count === 5)
})

test("the owner's drop: 10,000 pieces, 333 kept back, two free holder lists of 333 and a 9,001 public sale", () => {
  const listA = { ...EMPTY_PHASE, access: 'list' as const, listSource: 'pasted' as const, listText: FIXTURE.slice(0, 3).join('\n') }
  const listB = { ...EMPTY_PHASE, access: 'list' as const, listSource: 'pasted' as const, listText: FIXTURE.slice(2).join('\n') }
  const f = {
    ...EMPTY_FORM,
    type: 'drop' as const,
    name: 'Miyamaker',
    symbol: 'MIYA',
    imageMode: 'link' as const,
    imageUri: 'ipfs://bafy',
    supply: '10000',
    ownerReserve: '333',
    tokens: [zeroAddress],
    phases: [
      { ...listA, prices: free, maxPerWallet: '1', supplyCap: '333' },
      { ...listB, prices: free, maxPerWallet: '1', supplyCap: '333' },
      { ...EMPTY_PHASE, prices: { [zeroAddress]: '0.01' }, supplyCap: '9001' },
    ],
  }
  const ctx = { now: NOW, chainId: 1, minAlignmentBps: 1000, protocolFeeBps: 100, image: { hasFile: true }, audio: { hasFile: false } }
  assert.deepEqual(validateStep('sale', f, ctx), {})
  const [params] = buildDropArgs(f, { creator: FIXTURE[0], vault: FIXTURE[1], alignmentBps: 1000, image: 'ipfs://bafy' }, NOW, 1)
  assert.equal(params.ownerReserve, 333)
  assert.deepEqual(
    params.phases.map((p) => [p.merkleRoot === ZERO_ROOT ? 'public' : 'list', p.supplyCap, p.maxPerWallet, p.start]),
    [
      ['list', 333, 1, NOW],
      ['list', 333, 1, NOW],
      ['public', 9001, 0, NOW],
    ]
  )
  assert.equal(params.phases[0]!.merkleRoot, buildTree(FIXTURE.slice(0, 3)).root)
  // A wallet on both lists has a proof for each.
  assert.ok(verifyProof(params.phases[0]!.merkleRoot, FIXTURE[2], proofFor(buildTree(FIXTURE.slice(0, 3)), FIXTURE[2])!))
  assert.ok(verifyProof(params.phases[1]!.merkleRoot, FIXTURE[2], proofFor(buildTree(FIXTURE.slice(2)), FIXTURE[2])!))
})

// ── Mint: where a wallet stands ──────────────────────────────────────────────

const PH = (o: object) => ({ start: 0n, end: 0n, maxPerWallet: 1, merkleRoot: ZERO_ROOT, supplyCap: 0, prices: [{ token: zeroAddress, price: 0n }], ...o })

test('livePhases lists every running phase, public and list, with what each can still sell', () => {
  const phases = [
    PH({ merkleRoot: ROOT, supplyCap: 333 }),
    PH({ merkleRoot: ROOT, supplyCap: 2 }),
    PH({ maxPerWallet: 0, prices: [{ token: zeroAddress, price: 10n ** 16n }], supplyCap: 9001 }),
    PH({ start: 500n }),
  ]
  const live = livePhases(phases, 100, [10n, 2n, 0n, 0n])
  assert.deepEqual(
    live.map((p) => [p.phaseId, p.isList, p.left, p.price]),
    [
      [0, true, 323, 0n],
      [1, true, 0, 0n],
      [2, false, 9001, 10n ** 16n],
    ]
  )
})

test('listStanding: connect, checking, not listed, claimed, full, eligible', () => {
  const s = (o: object) => listStanding({ maxPerWallet: 1, account: FIXTURE[0], ...o })
  assert.equal(listStanding({ maxPerWallet: 1 }), 'connect')
  assert.equal(s({}), 'checking')
  assert.equal(s({ proof: { state: 'unknown' } }), 'unknown')
  assert.equal(s({ proof: { state: 'no-list' } }), 'no-list')
  assert.equal(s({ proof: { state: 'not-listed' }, minted: 0 }), 'not-listed')
  assert.equal(s({ proof: { state: 'listed' }, minted: 1, left: 0 }), 'claimed', 'claimed says so even when full')
  assert.equal(s({ proof: { state: 'listed' }, minted: 0, left: 0 }), 'full')
  assert.equal(s({ proof: { state: 'listed' } }), 'checking', 'the count is still being read')
  assert.equal(s({ proof: { state: 'listed' }, minted: 0, left: 5 }), 'eligible')
})

test('defaultPhase opens on a claim the wallet can make, else the public sale', () => {
  const live = livePhases([PH({ merkleRoot: ROOT }), PH({ merkleRoot: ROOT }), PH({ maxPerWallet: 0 })], 100, [0n, 0n, 0n])
  assert.equal(defaultPhase(live, { 0: 'not-listed', 1: 'eligible' }), 1)
  assert.equal(defaultPhase(live, { 0: 'claimed', 1: 'not-listed' }), 2)
  assert.equal(defaultPhase(live.slice(0, 2), { 0: 'claimed', 1: 'not-listed' }), 0)
  assert.equal(defaultPhase([], {}), undefined)
})

test('phaseGate: a claim needs a proof that still proves the paying wallet, and room under its limit', () => {
  const proof = proofFor(buildTree([...FIXTURE]), FIXTURE[0])!
  const phase = { start: 0n, end: 0n, merkleRoot: ROOT, maxPerWallet: 1, supplyCap: 333, prices: [{ token: zeroAddress, price: 0n }] }
  const claim = { account: FIXTURE[0], proof, walletMinted: 0n }
  assert.deepEqual(phaseGate(phase, zeroAddress, 1, 10, 0n, 100n, claim), { ok: true, price: 0n })
  assert.match((phaseGate(phase, zeroAddress, 1, 10, 0n, 100n) as { error: string }).error, /allowlist only/)
  assert.match(
    (phaseGate({ ...phase, merkleRoot: `0x${'1'.repeat(64)}` }, zeroAddress, 1, 10, 0n, 100n, claim) as { error: string }).error,
    /list has changed/
  )
  assert.match((phaseGate(phase, zeroAddress, 1, 10, 0n, 100n, { ...claim, account: FIXTURE[1] }) as { error: string }).error, /list has changed/)
  assert.match((phaseGate(phase, zeroAddress, 1, 10, 0n, 100n, { ...claim, walletMinted: 1n }) as { error: string }).error, /already claimed/)
  assert.match((phaseGate(phase, zeroAddress, 1, 10, 333n, 100n, claim) as { error: string }).error, /does not have that many/)
  assert.match((phaseGate({ ...phase, merkleRoot: ZERO_ROOT }, zeroAddress, 1, 10, 0n, 100n, claim) as { error: string }).error, /no longer for a list/)
})

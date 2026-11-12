// The per-mint reveal's Worker side (api/_lib/reveal.ts): its routes and cron, on the real migration in SQLite
// (node:sqlite, standing in for D1), an in-memory bucket and a made-up chain. Run: yarn test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { RevealBucket, RevealChain, RevealDb, RevealStmt } from '../api/_lib/reveal.ts'
import {
  handleRevealRequest,
  revealSettings,
  rpcChain,
  runRevealCron,
  TRANSFER_TOPIC,
  ZERO_TOPIC,
} from '../api/_lib/reveal.ts'
import { CONFIRMATIONS, replay } from '../api/_lib/revealdraw.mjs'
import { canonicalJson, metadataHash, provenanceHash, sha256Hex, storedFromServed } from '../api/_lib/revealpiece.mjs'

// node:sqlite is not in this repo's @types/node yet, so it is typed here.
type SqliteStmt = {
  all: (...a: unknown[]) => Record<string, unknown>[]
  get: (...a: unknown[]) => Record<string, unknown> | undefined
  run: (...a: unknown[]) => { changes: number | bigint }
}
type Sqlite = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStmt }
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (path: string) => Sqlite }

const MIGRATIONS = ['0004_reveal.sql'].map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'))

/** D1's interface over SQLite: batch() is one transaction, as D1's is. */
function sqliteD1(): RevealDb & { raw: Sqlite } {
  const raw = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS) raw.exec(m)
  type S = RevealStmt & { exec: () => { meta: { changes: number } } }
  const stmt = (sql: string, args: unknown[] = []): S => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    first: async () => raw.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
    exec: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
  })
  return {
    raw,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      raw.exec('BEGIN')
      try {
        const out = (stmts as S[]).map((s) => s.exec())
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
  }
}

function memoryBucket(): RevealBucket & { m: Map<string, Uint8Array> } {
  const m = new Map<string, Uint8Array>()
  return {
    m,
    get: async (key) => {
      const v = m.get(key)
      return v
        ? { body: new Blob([v]).stream(), size: v.byteLength, text: async () => new TextDecoder().decode(v) }
        : null
    },
    head: async (key) => (m.has(key) ? { size: m.get(key)!.byteLength } : null),
    put: async (key, value, opts) => {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer)
      if (opts?.sha256 && (await sha256Hex(bytes)) !== opts.sha256) throw new Error('R2: checksum mismatch')
      m.set(key, bytes)
    },
  }
}

const h = (n: number) => `0x${n.toString(16).padStart(64, 'a')}`
const mix = (n: number) => `0x${(n * 104729).toString(16).padStart(64, 'c')}`
const ADDRESS = '0x00000000000000000000000000000000000d70b5'
const SLUG = 'miyamaker'
const SUPPLY = 20
const DEPLOY = 1000

/** A made-up chain: mints land in given blocks; head moves when told. Knobs make it fail like real RPCs do. */
function fakeChain() {
  const mints: { tokenId: number; block: number }[] = []
  const state = {
    head: DEPLOY + 1,
    dropLog: undefined as number | undefined,
    failLogsWiderThan: Infinity,
    failHeaders: false,
    calls: 0,
    baseURI: `http://localhost:8787/reveal/${SLUG}/`,
    forks: new Map<number, string>(),
  }
  const chain: RevealChain = {
    blockNumber: async () => (state.calls++, state.head),
    mintLogs: async (address, from, to) => {
      state.calls += 1
      if (to - from + 1 > state.failLogsWiderThan) throw new Error('query returned more than 10000 results')
      return mints
        .filter((m) => m.block >= from && m.block <= to && m.tokenId !== state.dropLog)
        .map((m, i) => ({
          address,
          topics: [
            TRANSFER_TOPIC,
            ZERO_TOPIC,
            `0x${'0'.repeat(24)}${'b'.repeat(40)}`,
            `0x${m.tokenId.toString(16).padStart(64, '0')}`,
          ],
          blockNumber: `0x${m.block.toString(16)}`,
          blockHash: h(m.block),
          transactionHash: h(m.block * 1000 + i),
          logIndex: `0x${i.toString(16)}`,
          removed: false,
        }))
    },
    totalSupplyAt: async (_a, block) => (state.calls++, mints.filter((m) => m.block <= block).length),
    headers: async (numbers) => {
      state.calls += 1
      if (state.failHeaders) throw new Error('RPC answered 503')
      return new Map(
        numbers
          .filter((n) => n <= state.head)
          .map((n) => [n, { number: n, hash: h(n), parentHash: state.forks.get(n) ?? h(n - 1), mixHash: mix(n) }])
      )
    },
    maxSupply: async () => SUPPLY,
    baseURI: async () => state.baseURI,
    hasCode: async (_a, block) => block >= DEPLOY,
  }
  const mint = (block: number, count = 1) => {
    for (let i = 0; i < count; i += 1) mints.push({ tokenId: mints.length + 1, block })
    state.head = Math.max(state.head, block)
  }
  return { chain, state, mints, mint }
}

const KEY = 'k'.repeat(40)
const ORIGIN = 'http://localhost:8787'

/** The art: piece n's "JPEG" is FF D8 FF + n; its metadata has a trait and its Piece; its salt is n repeated. */
async function art() {
  const files = new Map<number, { jpg: Uint8Array; json: string; salt: string }>()
  const pieces = []
  for (let n = 1; n <= SUPPLY; n += 1) {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n])
    const json = canonicalJson({
      description: 'D',
      attributes: [
        { trait_type: 'N', value: String(n) },
        { trait_type: 'Piece', value: n },
      ],
    })
    const salt = n.toString(16).padStart(2, '0').repeat(32)
    files.set(n, { jpg, json, salt })
    pieces.push({ n, image: await sha256Hex(jpg), metadata: await metadataHash(salt, json) })
  }
  return { files, pieces, hash: await provenanceHash(pieces) }
}

async function setup({ load = true, attach = true } = {}) {
  const db = sqliteD1()
  const bucket = memoryBucket()
  const fake = fakeChain()
  let now = 1_800_000_000_000
  const deps = { db, bucket, adminKey: KEY, origin: ORIGIN, chain: () => fake.chain, now: () => now }
  // A piece's metadata goes up as JSON { salt, metadata } (the salt never in a header).
  const call = (method: string, path: string, body?: BodyInit, key = KEY, salt?: string) =>
    handleRevealRequest(
      new Request(`${ORIGIN}/reveal/${SLUG}/${path}`, {
        method,
        body: salt === undefined ? body : JSON.stringify({ salt, metadata: body }),
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}) },
      }),
      deps
    )
  const a = await art()
  const logs: string[] = []
  const cron = (extra: Partial<Parameters<typeof runRevealCron>[0]> = {}) =>
    runRevealCron({ db, chain: () => fake.chain, now: () => (now += 60_000), log: (l) => logs.push(l), ...extra })
  if (load) {
    const reg = await call(
      'PUT',
      'admin/collection',
      JSON.stringify({
        chainId: 1,
        supply: SUPPLY,
        provenanceHash: a.hash,
        name: 'Miyamaker',
        description: 'Soon.',
        coverImage: 'ar://cover',
      })
    )
    assert.equal(reg.status, 200)
    assert.equal((await call('PUT', 'admin/provenance', JSON.stringify({ pieces: a.pieces }))).status, 200)
    for (const [n, f] of a.files) {
      assert.equal((await call('PUT', `admin/piece/${n}.jpg`, f.jpg)).status, 200)
      assert.equal((await call('PUT', `admin/piece/${n}.json`, f.json, KEY, f.salt)).status, 200)
    }
  }
  if (load && attach) {
    const at = await call('POST', 'admin/attach', JSON.stringify({ address: ADDRESS, deployBlock: DEPLOY }))
    assert.equal(at.status, 200, await at.clone().text())
  }
  return { db, bucket, fake, call, art: a, cron, logs, deps, clock: { set: (t: number) => (now = t), get: () => now } }
}

const getJson = async (r: Response | Promise<Response>) => (await r).json() as Promise<Record<string, unknown>>
const assignments = (db: RevealDb & { raw: Sqlite }) =>
  db.raw.prepare('SELECT token_id, piece, seed_block, seed FROM reveal_assignments ORDER BY token_id').all()

test('admin: a key is needed, and the wrong one is refused', async () => {
  const { call, deps } = await setup({ load: false })
  assert.equal((await call('GET', 'admin/status', undefined, 'nope')).status, 401)
  assert.equal((await call('GET', 'admin/status', undefined, '')).status, 401)
  const off = await handleRevealRequest(
    new Request(`${ORIGIN}/reveal/${SLUG}/admin/status`, { headers: { authorization: `Bearer ${KEY}` } }),
    {
      ...deps,
      adminKey: 'short',
    }
  )
  assert.equal(off.status, 503)
})

test('load: provenance must hash to the registered hash; files must match it', async () => {
  const { call, art: a, bucket, deps } = await setup({ load: false })
  const reg = {
    chainId: 1,
    supply: SUPPLY,
    provenanceHash: a.hash,
    name: 'Miyamaker',
    description: 'Soon.',
    coverImage: 'ar://cover',
  }
  assert.equal((await call('PUT', 'admin/collection', JSON.stringify(reg))).status, 200)
  // The same slug with another provenance is refused: the hash is fixed once published.
  assert.equal(
    (await call('PUT', 'admin/collection', JSON.stringify({ ...reg, provenanceHash: 'e'.repeat(64) }))).status,
    409
  )
  const tampered = a.pieces.map((p, i) => (i === 3 ? { ...p, image: 'e'.repeat(64) } : p))
  assert.equal((await call('PUT', 'admin/provenance', JSON.stringify({ pieces: tampered }))).status, 400)
  assert.equal((await call('PUT', 'admin/piece/1.jpg', a.files.get(1)!.jpg)).status, 409) // before provenance
  assert.equal((await call('PUT', 'admin/provenance', JSON.stringify({ pieces: a.pieces }))).status, 200)
  assert.equal((await call('PUT', 'admin/provenance', JSON.stringify({ pieces: a.pieces }))).status, 200) // again: fine

  assert.equal((await call('PUT', 'admin/piece/1.jpg', a.files.get(2)!.jpg)).status, 422) // piece 2's bytes as piece 1
  assert.equal((await call('PUT', 'admin/piece/1.json', a.files.get(1)!.jpg, KEY, a.files.get(1)!.salt)).status, 422)
  // Metadata needs its own salt, in the body: none, a header, or another piece's, is refused.
  assert.equal((await call('PUT', 'admin/piece/1.json', a.files.get(1)!.json)).status, 422)
  const inHeader = await handleRevealRequest(
    new Request(`${ORIGIN}/reveal/${SLUG}/admin/piece/1.json`, {
      method: 'PUT',
      body: a.files.get(1)!.json,
      headers: { authorization: `Bearer ${KEY}`, 'x-reveal-salt': a.files.get(1)!.salt },
    }),
    deps
  )
  assert.equal(inHeader.status, 422)
  assert.equal(
    (
      await call(
        'PUT',
        'admin/piece/1.json',
        JSON.stringify({ salt: a.files.get(1)!.salt, metadata: a.files.get(1)!.json, extra: 1 })
      )
    ).status,
    422
  )
  assert.equal((await call('PUT', 'admin/piece/1.json', a.files.get(1)!.json, KEY, a.files.get(2)!.salt)).status, 422)
  assert.equal((await call('PUT', `admin/piece/${SUPPLY + 1}.jpg`, a.files.get(1)!.jpg)).status, 404)
  assert.equal((await call('PUT', 'admin/piece/1.jpg', a.files.get(1)!.jpg)).status, 200)
  const status = await getJson(call('GET', 'admin/status'))
  assert.equal((status.missingImages as number[]).length, SUPPLY - 1)
  assert.equal((status.missingMetadata as number[]).length, SUPPLY)
  assert.deepEqual([...bucket.m.keys()].sort(), [`${SLUG}/piece/1.jpg`, `${SLUG}/provenance.json`])
})

test('attach checks the drop on chain: created in that block, its supply, exactly its baseURI', async () => {
  const { call, fake } = await setup({ attach: false })
  const attach = (deployBlock: number) =>
    call('POST', 'admin/attach', JSON.stringify({ address: ADDRESS, deployBlock }))
  assert.equal((await attach(DEPLOY + 1)).status, 422) // code was there a block earlier
  assert.equal((await attach(DEPLOY - 1)).status, 422) // no code yet
  // Only <origin>/reveal/<slug>/ itself: another host or path ending the same way, or no final slash, is refused.
  for (const uri of [
    'ipfs://somewhere/',
    `https://evil.example/reveal/${SLUG}/`,
    `${ORIGIN}/x/reveal/${SLUG}/`,
    `${ORIGIN}/reveal/${SLUG}`,
    `https://www.miyamaker.com/reveal/${SLUG}/`, // the right link for another origin than this site's
  ]) {
    fake.state.baseURI = uri
    assert.match(String((await getJson(attach(DEPLOY))).error), /baseURI/, uri)
  }
  fake.state.baseURI = `${ORIGIN}/reveal/${SLUG}/`
  assert.equal((await attach(DEPLOY)).status, 200)
})

test('attach is refused while provenance or any piece (image, metadata, salt) is missing', async () => {
  const { call, art: a, db, bucket } = await setup({ load: false })
  const attach = () => call('POST', 'admin/attach', JSON.stringify({ address: ADDRESS, deployBlock: DEPLOY }))
  const reg = {
    chainId: 1,
    supply: SUPPLY,
    provenanceHash: a.hash,
    name: 'Miyamaker',
    description: 'Soon.',
    coverImage: 'ar://cover',
  }
  assert.equal((await call('PUT', 'admin/collection', JSON.stringify(reg))).status, 200)
  assert.match(String((await getJson(attach())).error), /provenance/)
  assert.equal((await call('PUT', 'admin/provenance', JSON.stringify({ pieces: a.pieces }))).status, 200)
  for (const [n, f] of a.files) {
    assert.equal((await call('PUT', `admin/piece/${n}.jpg`, f.jpg)).status, 200)
    if (n !== 7) assert.equal((await call('PUT', `admin/piece/${n}.json`, f.json, KEY, f.salt)).status, 200)
  }
  const one = await attach()
  assert.equal(one.status, 409)
  assert.match(String((await one.json()).error), /1 of 20 pieces/)
  assert.equal((await call('PUT', 'admin/piece/7.json', a.files.get(7)!.json, KEY, a.files.get(7)!.salt)).status, 200)
  // A salt gone, or provenance.json gone from the bucket: still refused.
  db.raw.exec("UPDATE reveal_pieces SET salt = NULL WHERE piece = 3")
  assert.equal((await attach()).status, 409)
  db.raw.exec(`UPDATE reveal_pieces SET salt = '${a.files.get(3)!.salt}' WHERE piece = 3`)
  const prov = bucket.m.get(`${SLUG}/provenance.json`)!
  bucket.m.delete(`${SLUG}/provenance.json`)
  assert.match(String((await getJson(attach())).error), /provenance\.json is not in the bucket/)
  bucket.m.set(`${SLUG}/provenance.json`, prov)
  assert.equal((await attach()).status, 200)
})

test('only Ethereum (chain 1) can be registered', async () => {
  const { call, art: a } = await setup({ load: false })
  const reg = (chainId: number) =>
    call(
      'PUT',
      'admin/collection',
      JSON.stringify({ chainId, supply: SUPPLY, provenanceHash: a.hash, name: 'M', description: 'D', coverImage: 'ar://c' })
    )
  for (const id of [11155111, 4663, 0]) assert.equal((await reg(id)).status, 400)
  assert.equal((await reg(1)).status, 200)
})

test('a token shows the cover until its block is CONFIRMATIONS deep, then its piece; unminted ones never show art', async () => {
  const { fake, call, cron, db, art: a } = await setup()
  fake.mint(1010)
  fake.state.head = 1010 + CONFIRMATIONS - 1
  await cron()
  const cover = await call('GET', '1')
  assert.equal(cover.headers.get('cache-control'), 'public, max-age=60')
  assert.deepEqual(await cover.json(), { name: 'Miyamaker #1', description: 'Soon.', image: 'ar://cover' })
  assert.equal((await call('GET', 'image/1')).status, 404)

  fake.state.head = 1010 + CONFIRMATIONS
  await cron()
  const [row] = assignments(db)
  assert.ok(row)
  const piece = Number(row.piece)
  const res = await call('GET', '1')
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600')
  const meta = await res.json()
  assert.deepEqual(meta, {
    name: 'Miyamaker #1', // the token id, by default
    description: 'D',
    image: `${ORIGIN}/reveal/${SLUG}/image/1`,
    attributes: [
      { trait_type: 'N', value: String(piece) },
      { trait_type: 'Piece', value: piece },
    ],
  })
  // The published salt proves the served metadata is the provenance's piece; undrawn salts are never published.
  const list = await getJson(call('GET', 'assignments.json'))
  const [entry] = list.assignments as { salt: string }[]
  assert.equal(entry!.salt, a.files.get(piece)!.salt)
  assert.equal(await metadataHash(entry!.salt, storedFromServed(meta)), a.pieces[piece - 1]!.metadata)
  const everything = JSON.stringify(list) + JSON.stringify(await getJson(call('GET', 'admin/status')))
  for (const [n, f] of a.files) if (n !== piece) assert.ok(!everything.includes(f.salt), `salt of piece ${n} leaked`)
  const img = await call('GET', 'image/1')
  assert.equal(img.headers.get('content-type'), 'image/jpeg')
  assert.equal(img.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), a.files.get(piece)!.jpg)

  // Every other id: the cover and no image. Out of range, zero-padded or junk: 404.
  for (let id = 2; id <= SUPPLY; id += 1) {
    const m = await getJson(call('GET', String(id)))
    assert.deepEqual(m, { name: `Miyamaker #${id}`, description: 'Soon.', image: 'ar://cover' })
    assert.equal((await call('GET', `image/${id}`)).status, 404)
  }
  for (const bad of [`${SUPPLY + 1}`, '0', '01', '1.json', 'image/01', 'image/x', '1/2']) {
    assert.equal((await call('GET', bad)).status, 404, bad)
  }
  // HEAD answers like GET without a body; preflight is allowed; writes are not.
  const head = await call('HEAD', 'image/1')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal((await call('OPTIONS', '1')).status, 204)
  assert.equal((await call('POST', '1', '{}')).status, 405)
})

test('tokens sharing a block are drawn in id order, exactly as the verifier redoes them', async () => {
  const { fake, cron, db, call } = await setup()
  fake.mint(1003, 3) // a batch mint
  fake.mint(1004)
  fake.mint(1009, 2)
  fake.mint(1050, 4)
  fake.state.head = 1100
  await cron()
  const stored = assignments(db)
  assert.equal(stored.length, 10)
  const headers = new Map(
    Array.from({ length: 1100 }, (_, i) => [
      i + 1,
      { number: i + 1, hash: h(i + 1), parentHash: h(i), mixHash: mix(i + 1) },
    ])
  )
  const expected = replay(
    SUPPLY,
    fake.mints.map((m) => ({ ...m, blockHash: h(m.block) })),
    headers,
    1100
  )
  assert.deepEqual(
    stored.map((r) => ({ t: r.token_id, p: r.piece, b: r.seed_block, s: r.seed })),
    expected.map((d) => ({ t: d.tokenId, p: d.piece, b: d.seedBlock, s: d.seed }))
  )
  assert.equal(stored[0]!.seed, stored[2]!.seed) // same block, same seed

  const list = await getJson(call('GET', 'assignments.json'))
  assert.equal(list.assigned, 10)
  assert.equal(list.address, ADDRESS)
  assert.deepEqual(
    (list.assignments as { token: number; piece: number; mintBlock: number }[]).map((x) => [
      x.token,
      x.piece,
      x.mintBlock,
    ]),
    expected.map((d) => [d.tokenId, d.piece, fake.mints[d.tokenId - 1]!.block])
  )
})

test('the cron is idempotent: running again, or two at once, changes nothing', async () => {
  const { fake, cron, db, logs } = await setup()
  fake.mint(1002, 2)
  fake.mint(1020)
  fake.state.head = 1040
  await cron()
  const once = assignments(db)
  await cron()
  await cron()
  assert.deepEqual(assignments(db), once)

  fake.mint(1045, 3)
  fake.state.head = 1060
  // Two runs at the same moment: one takes the lock, the other steps aside.
  await Promise.all([cron(), cron()])
  assert.equal(assignments(db).length, 6)
  // Even with the lock out of the way, a second run that read stale counters writes nothing.
  db.raw.exec('UPDATE reveal_collections SET lock_until = 0')
  fake.mint(1070)
  fake.state.head = 1080
  await Promise.all([cron(), runRevealCron({ db, chain: () => fake.chain, now: () => 1, log: () => undefined })])
  const after = assignments(db)
  assert.equal(after.length, 7)
  assert.equal(new Set(after.map((r) => r.piece)).size, 7)
  assert.ok(!logs.some((l) => /UNIQUE|constraint/i.test(l)), logs.join('\n'))
})

test('RPC trouble leaves the state as it was, and the next run catches up', async () => {
  const { fake, cron, db, call } = await setup()
  fake.mint(1005, 2)
  fake.mint(1300)
  fake.state.head = 1400

  // A node that drops a log (the last, so the ids still look whole): totalSupply gives it away, nothing is stored.
  fake.state.dropLog = 3
  await cron()
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reveal_mints').get()!.n, 0)
  assert.match(
    String(((await getJson(call('GET', 'admin/status'))).collection as { lastError: string }).lastError),
    /incomplete/
  )
  fake.state.dropLog = undefined

  // Headers failing: the mints are stored, nothing is drawn, no error is turned into a draw.
  fake.state.failHeaders = true
  await cron()
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reveal_mints').get()!.n, 3)
  assert.equal(assignments(db).length, 0)
  fake.state.failHeaders = false

  // Narrow getLogs limits: the span shrinks until the node answers.
  fake.mint(1500, 2)
  fake.state.head = 1600
  fake.state.failLogsWiderThan = 100
  for (let i = 0; i < 6; i += 1) await cron()
  assert.equal(assignments(db).length, 5)
  assert.equal(((await getJson(call('GET', 'admin/status'))).collection as { lastError?: string }).lastError, undefined)
})

test('a reorg under a stored mint stops the draw instead of drawing from the wrong block', async () => {
  const { fake, cron, db, logs } = await setup()
  fake.mint(1010)
  fake.state.head = 1030
  fake.state.forks.set(1011, h(9999)) // block 1011 now follows another 1010
  await cron()
  assert.equal(assignments(db).length, 0)
  assert.ok(logs.some((l) => /does not follow/.test(l)))
})

test('arweave ids: only for drawn pieces, set once; then the metadata points at ar:// and is immutable', async () => {
  const { fake, cron, db, call } = await setup()
  fake.mint(1010)
  fake.state.head = 1020
  await cron()
  const piece = Number(assignments(db)[0]!.piece)
  const other = piece === 1 ? 2 : 1
  const ids = { image: 'i'.repeat(43), metadata: 'm'.repeat(43) }
  assert.equal((await call('POST', 'admin/arweave', JSON.stringify({ piece: other, ...ids }))).status, 409)
  assert.equal(
    (await call('POST', 'admin/arweave', JSON.stringify({ piece, image: 'short', metadata: ids.metadata }))).status,
    400
  )
  assert.equal((await call('POST', 'admin/arweave', JSON.stringify({ piece, ...ids }))).status, 200)
  assert.equal((await call('POST', 'admin/arweave', JSON.stringify({ piece, ...ids }))).status, 200) // the same again
  assert.equal(
    (await call('POST', 'admin/arweave', JSON.stringify({ piece, ...ids, image: 'j'.repeat(43) }))).status,
    409
  )
  const res = await call('GET', '1')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal((await res.json()).image, `ar://${ids.image}`)
  const list = await getJson(call('GET', 'assignments.json'))
  assert.deepEqual((list.assignments as { arImage: string }[])[0]!.arImage, ids.image)
})

test('a drawn piece missing from the bucket is a 503, never another file', async () => {
  const { fake, cron, db, call, bucket } = await setup()
  fake.mint(1010)
  fake.state.head = 1020
  await cron()
  const piece = Number(assignments(db)[0]!.piece)
  bucket.m.delete(`${SLUG}/piece/${piece}.json`)
  bucket.m.delete(`${SLUG}/piece/${piece}.jpg`)
  assert.equal((await call('GET', '1')).status, 503)
  assert.equal((await call('GET', 'image/1')).status, 503)
})

test('the marketplace is asked to refresh each drawn token once; a failure waits without holding up the rest', async () => {
  const { fake, db, bucket, clock } = await setup()
  fake.mint(1010, 3)
  fake.state.head = 1020
  const asked: number[] = []
  let fail = true
  const refresh = async (_c: unknown, id: number) => {
    asked.push(id)
    return !(fail && id === 2)
  }
  const run = () =>
    runRevealCron({ db, bucket, chain: () => fake.chain, refresh, refreshGapMs: 0, now: clock.get, log: () => {} })
  await run()
  assert.deepEqual(asked, [1, 2, 3]) // 2 failed; 3 went ahead anyway
  fail = false
  await run()
  assert.deepEqual(asked, [1, 2, 3]) // 2 waits its turn (2 minutes after one failure)
  clock.set(clock.get() + 2 * 60_000)
  await run()
  await run()
  assert.deepEqual(asked, [1, 2, 3, 2])
  const done = db.raw.prepare('SELECT COUNT(*) AS n FROM reveal_assignments WHERE refreshed_at > 0').get()!
  assert.equal(done.n, 3)
})

test('a refresh is asked only once the token serves its piece; a 429 ends the run without blame', async () => {
  const { fake, db, bucket, clock, logs } = await setup()
  fake.mint(1010, 3)
  fake.state.head = 1020
  await runRevealCron({ db, bucket, chain: () => fake.chain, now: clock.get, log: () => {} })
  const pieceOf = (t: number) =>
    Number(db.raw.prepare('SELECT piece FROM reveal_assignments WHERE token_id = ?').get(t)!.piece)
  const json1 = bucket.m.get(`${SLUG}/piece/${pieceOf(1)}.json`)!
  bucket.m.delete(`${SLUG}/piece/${pieceOf(1)}.json`) // token 1's metadata can't be served
  const asked: number[] = []
  let limited = false
  const refresh = async (_c: unknown, id: number) => {
    asked.push(id)
    return limited ? ('rate-limited' as const) : true
  }
  const run = () =>
    runRevealCron({
      db,
      bucket,
      chain: () => fake.chain,
      refresh,
      refreshGapMs: 0,
      now: clock.get,
      log: (l) => logs.push(l),
    })
  await run()
  assert.deepEqual(asked, [2, 3])
  assert.ok(logs.some((l) => /token 1 waits: its piece is not served yet/.test(l)))
  bucket.m.set(`${SLUG}/piece/${pieceOf(1)}.json`, json1)
  clock.set(clock.get() + 3 * 60_000)
  limited = true
  await run()
  assert.deepEqual(asked, [2, 3, 1])
  const row = db.raw.prepare('SELECT refreshed_at, refresh_tries FROM reveal_assignments WHERE token_id = 1').get()!
  assert.equal(row.refreshed_at, 0) // rate-limited: not done
  assert.equal(row.refresh_tries, 1) // and not counted as a failure (the one try is from the missing file)
  limited = false
  clock.set(clock.get() + 60_000)
  await run()
  assert.deepEqual(asked, [2, 3, 1, 1])
  // Without the bucket nothing can be checked, so nothing is refreshed.
  fake.mint(1030)
  fake.state.head = 1040
  await runRevealCron({ db, chain: () => fake.chain, refresh, refreshGapMs: 0, now: clock.get, log: () => {} })
  assert.deepEqual(asked, [2, 3, 1, 1])
})

test('the cron stores mints but draws nothing while a piece is missing, then draws the same pieces', async () => {
  const twin = await setup()
  twin.fake.mint(1010, 2)
  twin.fake.state.head = 1020
  await twin.cron()
  const expected = assignments(twin.db)
  assert.equal(expected.length, 2)

  const { fake, cron, db, logs } = await setup()
  db.raw.exec('UPDATE reveal_pieces SET image_loaded = 0 WHERE piece = 5')
  fake.mint(1010, 2)
  fake.state.head = 1020
  await cron()
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reveal_mints').get()!.n, 2)
  assert.equal(assignments(db).length, 0)
  assert.ok(logs.some((l) => /not drawing, 1 of 20 pieces/.test(l)))
  db.raw.exec('UPDATE reveal_pieces SET image_loaded = 1 WHERE piece = 5')
  await cron()
  assert.deepEqual(assignments(db), expected)
})

test('sold out and all drawn: the cron reads nothing more from the chain', async () => {
  const { fake, cron, db } = await setup()
  fake.mint(1010, SUPPLY)
  fake.state.head = 1020
  await cron()
  assert.equal(assignments(db).length, SUPPLY)
  const before = fake.state.calls
  await cron()
  await cron()
  assert.equal(fake.state.calls, before)
})

test('getLogs: after narrowing on errors, the span grows back once reads succeed', async () => {
  const { fake, cron, db } = await setup()
  const spans: number[] = []
  const mintLogs = fake.chain.mintLogs
  fake.chain.mintLogs = async (address, from, to) => {
    spans.push(to - from + 1)
    return mintLogs(address, from, to)
  }
  fake.state.head = 9000
  fake.state.failLogsWiderThan = 300
  await cron()
  fake.state.failLogsWiderThan = Infinity
  spans.length = 0
  db.raw.exec('UPDATE reveal_collections SET lock_until = 0')
  await cron()
  assert.ok(spans.length >= 2)
  assert.ok(spans[1]! > spans[0]!, spans.join(','))
})

test('a storage error is a 503 nobody caches, not a crash or a guess', async () => {
  const { deps } = await setup()
  const broken = {
    ...deps,
    db: {
      ...deps.db,
      prepare: () => {
        throw new Error('D1_ERROR: network connection lost')
      },
    },
  }
  for (const path of ['1', 'image/1', 'assignments.json', 'provenance.json']) {
    const res = await handleRevealRequest(new Request(`${ORIGIN}/reveal/${SLUG}/${path}`), broken)
    assert.equal(res.status, 503, path)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.ok(!(await res.text()).includes('D1_ERROR'))
  }
})

test('settings: a dev RPC and an http origin count only with REVEAL_DEV=1 and a local host', () => {
  const anvil = 'http://127.0.0.1:8549'
  assert.equal(revealSettings({ REVEAL_RPC_URL: anvil }).devRpc, undefined)
  assert.equal(revealSettings({ REVEAL_DEV: '1', REVEAL_RPC_URL: 'https://eth.example/rpc' }).devRpc, undefined)
  assert.equal(revealSettings({ REVEAL_DEV: '1', REVEAL_RPC_URL: anvil }).devRpc, `${anvil}/`)
  assert.equal(revealSettings({}).origin, 'https://www.miyamaker.com')
  assert.equal(revealSettings({ REVEAL_ORIGIN: 'https://miyamaker.com' }).origin, 'https://miyamaker.com')
  assert.equal(revealSettings({ REVEAL_ORIGIN: 'http://127.0.0.1:8787' }).origin, undefined)
  assert.equal(revealSettings({ REVEAL_ORIGIN: 'https://x.example/path' }).origin, undefined)
  assert.equal(revealSettings({ REVEAL_ORIGIN: 'nonsense' }).origin, undefined)
  assert.equal(
    revealSettings({ REVEAL_DEV: '1', REVEAL_ORIGIN: 'http://127.0.0.1:8787' }).origin,
    'http://127.0.0.1:8787'
  )
  assert.equal(revealSettings({ REVEAL_DEV: '1', REVEAL_ORIGIN: 'http://evil.example' }).origin, undefined)
})

test('rpcChain checks eth_chainId once before its first answer, and refuses another chain', async () => {
  const methods: string[] = []
  const node = (chain: string) =>
    (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const one = (r: { id: number; method: string }) => {
        methods.push(r.method)
        const result = r.method === 'eth_chainId' ? chain : '0x10'
        return { jsonrpc: '2.0', id: r.id, result }
      }
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)))
    }) as typeof fetch
  const good = rpcChain('https://rpc.example', 1, node('0x1'))
  assert.equal(await good.blockNumber(), 16)
  assert.equal(await good.blockNumber(), 16)
  assert.deepEqual(methods, ['eth_chainId', 'eth_blockNumber', 'eth_blockNumber'])
  const wrong = rpcChain('https://rpc.example', 1, node('0xaa36a7'))
  await assert.rejects(wrong.blockNumber(), /chain 11155111, not 1/)
  await assert.rejects(wrong.mintLogs(ADDRESS, 1, 2), /chain 11155111/)
  assert.ok(!methods.includes('eth_getLogs'))
})

test('names: "#<token id>" by default, "#<piece>" when the collection says so, fixed once a token is drawn', async () => {
  const { fake, cron, db, call, art: a } = await setup()
  const reg = (nameBy: string) =>
    call(
      'PUT',
      'admin/collection',
      JSON.stringify({
        chainId: 1,
        supply: SUPPLY,
        provenanceHash: a.hash,
        name: 'Miyamaker',
        description: 'Soon.',
        coverImage: 'ar://cover',
        nameBy,
      })
    )
  assert.equal((await reg('serial')).status, 400)
  assert.equal((await reg('piece')).status, 200)
  fake.mint(1010)
  fake.state.head = 1020
  await cron()
  const piece = Number(assignments(db)[0]!.piece)
  assert.equal((await getJson(call('GET', '1'))).name, `Miyamaker #${piece}`)
  assert.equal((await getJson(call('GET', '2'))).name, 'Miyamaker #2') // the cover is always the token id
  assert.equal((await reg('token')).status, 409)
  assert.equal((await reg('piece')).status, 200)
  assert.equal((await getJson(call('GET', 'assignments.json'))).nameBy, 'piece')
})

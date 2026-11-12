// The reveal's scripts as collectors and the owner run them (scripts/reveal/{verify,arweave,prepare}.mjs): each is
// started as a child process against local servers standing in for the site, an Ethereum node and an Arweave gateway.
// Irys is a stub loaded in place of @irys/sdk (a module hook), so nothing is ever uploaded. Run: yarn test
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { encodeAbiParameters } from 'viem'

import { replay } from '../api/_lib/revealdraw.mjs'
import { canonicalJson, metadataHash, provenanceHash, servedMetadata, tokenName } from '../api/_lib/revealpiece.mjs'

const SCRIPTS = fileURLToPath(new URL('../scripts/reveal/', import.meta.url))
const TMP = mkdtempSync(join(tmpdir(), 'reveal-scripts-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const h = (n: number) => `0x${n.toString(16).padStart(64, 'a')}`
const mix = (n: number) => `0x${(n * 7919).toString(16).padStart(64, 'c')}`
const ADDRESS = '0x00000000000000000000000000000000000d70b5'
const OTHER = '0x00000000000000000000000000000000000d70b6'
const SLUG = 'miyamaker'
const DEPLOY = 100
const KEY = 'k'.repeat(40) // a test-only admin key

/** Runs a script; resolves with its exit code and output (never rejects on a non-zero exit). */
function runScript(script: string, args: string[], env: Record<string, string> = {}, nodeArgs: string[] = []) {
  return new Promise<{ code: number; out: string }>((done) => {
    execFile(
      process.execPath,
      [...nodeArgs, join(SCRIPTS, script), ...args],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 99) : 0
        done({ code, out: `${stdout}${stderr}` })
      }
    )
  })
}

type Piece = { n: number; jpg: Uint8Array; json: string; salt: string }

/** A small collection: piece n's "JPEG", its stored metadata and salt, and the provenance over them. */
async function collection(supply: number) {
  const pieces: Piece[] = []
  const entries = []
  for (let n = 1; n <= supply; n += 1) {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, ...randomBytes(8)])
    const json = canonicalJson({
      description: 'D é',
      attributes: [
        { trait_type: 'N', value: `v${n}` },
        { trait_type: 'Piece', value: n },
      ],
    })
    const salt = randomBytes(32).toString('hex')
    pieces.push({ n, jpg, json, salt })
    entries.push({ n, image: sha(jpg), metadata: await metadataHash(salt, json) })
  }
  const hash = await provenanceHash(entries)
  return { pieces, provenance: { name: 'Miyamaker', supply, provenanceHash: hash, pieces: entries }, hash }
}

/** The private build prepare.mjs would make, on disk. */
function writeBuild(c: Awaited<ReturnType<typeof collection>>, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(TMP, 'build-'))
  mkdirSync(join(dir, 'piece'))
  for (const p of c.pieces) {
    writeFileSync(join(dir, 'piece', `${p.n}.jpg`), p.jpg)
    writeFileSync(join(dir, 'piece', `${p.n}.json`), p.json)
    writeFileSync(join(dir, 'piece', `${p.n}.salt`), p.salt)
  }
  writeFileSync(join(dir, 'provenance.json'), JSON.stringify({ ...c.provenance, ...extra }))
  return dir
}

type Assignment = {
  token: number
  piece: number
  mintBlock: number
  mintBlockHash: string
  seedBlock: number
  seedBlockHash: string
  seed: string
  salt: string
  arImage?: string
  arMetadata?: string
}

/**
 * One local server for everything: the site (/reveal/<slug>/…), a JSON-RPC node (/rpc), an Arweave gateway (/ar/<id>,
 * /ar/<manifest>/<path>, reading what the Irys stub wrote) and the Irys price endpoint.
 */
async function world(supply: number, mintBlocks: number[], head: number) {
  const c = await collection(supply)
  const mints = mintBlocks.map((block, i) => ({ tokenId: i + 1, block, blockHash: h(block) }))
  const headers = new Map(
    Array.from({ length: head }, (_, i) => [i + 1, { number: i + 1, hash: h(i + 1), parentHash: h(i), mixHash: mix(i + 1) }])
  )
  const draws = replay(supply, mints, headers, head)
  const store = mkdtempSync(join(TMP, 'arweave-'))
  const state = {
    address: ADDRESS as string | null,
    assignments: draws.map((d) => ({
      token: d.tokenId,
      piece: d.piece,
      mintBlock: mints[d.tokenId - 1]!.block,
      mintBlockHash: mints[d.tokenId - 1]!.blockHash,
      seedBlock: d.seedBlock,
      seedBlockHash: d.seedBlockHash,
      seed: d.seed,
      salt: c.pieces[d.piece - 1]!.salt,
    })) as Assignment[],
    /** Token metadata the site serves, by token: overrides for tampering. */
    servedOverride: new Map<number, unknown>(),
    recorded: [] as Record<string, unknown>[],
    tokenUriBase: '',
  }
  const list = () => ({
    slug: SLUG,
    chainId: 1,
    address: state.address,
    deployBlock: DEPLOY,
    supply,
    provenanceHash: c.hash,
    name: 'Miyamaker',
    nameBy: 'token',
    confirmations: 5,
    assigned: state.assignments.length,
    minted: mints.length,
    assignments: state.assignments,
  })
  const readStore = (id: string) => (existsSync(join(store, id)) ? readFileSync(join(store, id)) : undefined)

  const rpc = (r: { id: number; method: string; params: unknown[] }) => {
    const p = r.params as [Record<string, string> & string, string]
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: r.id, result })
    switch (r.method) {
      case 'eth_chainId':
        return ok('0x1')
      case 'eth_blockNumber':
        return ok(`0x${head.toString(16)}`)
      case 'eth_getLogs': {
        const f = p[0]
        const from = Number(f.fromBlock)
        const to = Number(f.toBlock)
        if (String(f.address).toLowerCase() !== ADDRESS) return ok([])
        return ok(
          mints
            .filter((m) => m.block >= from && m.block <= to)
            .map((m, i) => ({
              address: ADDRESS,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                `0x${'0'.repeat(64)}`,
                `0x${'0'.repeat(24)}${'b'.repeat(40)}`,
                `0x${m.tokenId.toString(16).padStart(64, '0')}`,
              ],
              data: '0x',
              blockNumber: `0x${m.block.toString(16)}`,
              blockHash: m.blockHash,
              transactionHash: h(m.block * 1000 + i),
              transactionIndex: '0x0',
              logIndex: `0x${i.toString(16)}`,
              removed: false,
            }))
        )
      }
      case 'eth_call': {
        const data = String(p[0].data)
        if (data.startsWith('0x18160ddd')) return ok(`0x${mints.length.toString(16).padStart(64, '0')}`)
        if (data.startsWith('0xc87b56dd')) {
          const id = Number(BigInt(`0x${data.slice(10)}`))
          return ok(encodeAbiParameters([{ type: 'string' }], [`${state.tokenUriBase}${id}`]))
        }
        return { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } }
      }
      case 'eth_getBlockByNumber': {
        const n = Number(p[0])
        const b = headers.get(n)
        if (!b) return ok(null)
        return ok({
          number: `0x${n.toString(16)}`,
          hash: b.hash,
          parentHash: b.parentHash,
          mixHash: b.mixHash,
          nonce: '0x0000000000000000',
          sha3Uncles: h(1),
          logsBloom: `0x${'0'.repeat(512)}`,
          transactionsRoot: h(2),
          stateRoot: h(3),
          receiptsRoot: h(4),
          miner: ADDRESS,
          difficulty: '0x0',
          totalDifficulty: '0x0',
          extraData: '0x',
          size: '0x100',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          timestamp: `0x${(1_700_000_000 + n * 12).toString(16)}`,
          baseFeePerGas: '0x1',
          transactions: [],
          uncles: [],
        })
      }
      default:
        return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: `no ${r.method}` } }
    }
  }

  let origin = '' // set once the server listens
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const ch of req) chunks.push(ch as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (status: number, data: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type })
      res.end(typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data))
    }
    if (url.pathname === '/rpc') {
      const q = JSON.parse(body)
      return send(200, Array.isArray(q) ? q.map(rpc) : rpc(q))
    }
    if (url.pathname.startsWith('/price/')) return send(200, '1000', 'text/plain')
    if (url.pathname.startsWith('/ar/')) {
      const [id = '', ...path] = url.pathname.slice(4).split('/')
      const data = readStore(id)
      if (!data) return send(404, { error: 'not found' })
      if (!path.length) return send(200, data, 'application/octet-stream')
      const m = JSON.parse(data.toString('utf8')) as { paths: Record<string, { id: string }> }
      const target = m.paths[path.join('/')]
      const file = target && readStore(target.id)
      return file ? send(200, file, 'application/octet-stream') : send(404, { error: 'not found' })
    }
    const prefix = `/reveal/${SLUG}/`
    if (!url.pathname.startsWith(prefix)) return send(404, { error: 'not found' })
    const rest = url.pathname.slice(prefix.length)
    if (rest === 'assignments.json') return send(200, list())
    if (rest === 'provenance.json') return send(200, c.provenance)
    if (rest === 'admin/arweave' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Wrong key.' })
      state.recorded.push(JSON.parse(body))
      return send(200, { ok: true })
    }
    const img = /^image\/(\d+)$/.exec(rest)
    const a = state.assignments.find((x) => x.token === Number(img ? img[1] : rest))
    if (!a) return send(404, { error: 'not found' })
    const p = c.pieces[a.piece - 1]!
    if (img) return send(200, p.jpg, 'image/jpeg')
    if (state.servedOverride.has(a.token)) return send(200, state.servedOverride.get(a.token))
    const image = a.arImage ? `ar://${a.arImage}` : `${origin}${prefix}image/${a.token}`
    return send(200, servedMetadata(p.json, { name: tokenName('Miyamaker', 'token', a.token, a.piece), image }))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  after(() => server.close())
  return { c, state, store, origin, site: `${origin}${'/reveal/'}${SLUG}`, rpcUrl: `${origin}/rpc`, gateway: `${origin}/ar` }
}

/** Puts a file in the fake Arweave store as the stub does, returning its 43-character id. */
function arPut(store: string, data: Uint8Array | string) {
  const id = createHash('sha256').update(data).digest('base64url')
  writeFileSync(join(store, id), data)
  return id
}

/* ---------- verify.mjs ---------- */

const verifyArgs = (w: Awaited<ReturnType<typeof world>>, extra: string[] = []) => [
  '--rpc',
  w.rpcUrl,
  '--site',
  w.site,
  ...extra,
]

test('verify: --address is required; with it and the pinned hash, a true list passes', async () => {
  const w = await world(8, [101, 101, 103, 104, 110], 120)
  const none = await runScript('verify.mjs', verifyArgs(w))
  assert.equal(none.code, 2)
  assert.match(none.out, /--address 0x<the drop> is required/)

  const ok = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS, '--provenance-hash', w.c.hash]))
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /5 draw\(s\) redone and compared/)
  assert.match(ok.out, /OK: every published draw matches the chain$/m)
  assert.doesNotMatch(ok.out, /UNPINNED/)

  // Without the hash from the collection description the result says it is unpinned.
  const loose = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS.toUpperCase().replace('0X', '0x')]))
  assert.equal(loose.code, 0, loose.out)
  assert.match(loose.out, /UNPINNED/)
  assert.match(loose.out, /OK: .*UNPINNED/)

  const wrongHash = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS, '--provenance-hash', 'e'.repeat(64)]))
  assert.equal(wrongHash.code, 1)
})

test('verify: a list for another contract, or draws with no address, fail', async () => {
  const w = await world(8, [101, 102], 120)
  const other = await runScript('verify.mjs', verifyArgs(w, ['--address', OTHER]))
  assert.equal(other.code, 1)
  assert.match(other.out, /the list is for .*not the drop you named/)

  w.state.address = null
  const unattached = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS]))
  assert.equal(unattached.code, 1)
  assert.match(unattached.out, /names no drop address, yet it lists 2 draw/)
})

test('verify --content: the site must serve each piece exactly; a changed trait fails', async () => {
  const w = await world(8, [101, 102, 103], 120)
  const ok = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS, '--content', 'all']))
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /3\/3 token\(s\) from the site serve/)

  const a = w.state.assignments[1]!
  const p = w.c.pieces[a.piece - 1]!
  const served = servedMetadata(p.json, { name: `Miyamaker #${a.token}`, image: `${w.site}/image/${a.token}` })
  w.state.servedOverride.set(a.token, { ...served, attributes: [{ trait_type: 'N', value: 'rare' }, ...served.attributes.slice(1)] })
  const bad = await runScript('verify.mjs', verifyArgs(w, ['--address', ADDRESS, '--content', 'all']))
  assert.equal(bad.code, 1)
  assert.match(bad.out, new RegExp(`token ${a.token}: .* is not piece ${a.piece}'s metadata`))
})

test('verify --base: the Arweave manifest copy and tokenURI on chain are checked too', async () => {
  const w = await world(4, [101, 102, 103, 104], 120)
  const paths: Record<string, { id: string }> = {}
  for (const a of w.state.assignments) {
    const p = w.c.pieces[a.piece - 1]!
    a.arImage = arPut(w.store, p.jpg)
    a.arMetadata = arPut(
      w.store,
      JSON.stringify(servedMetadata(p.json, { name: `Miyamaker #${a.token}`, image: `ar://${a.arImage}` }))
    )
    paths[String(a.token)] = { id: a.arMetadata }
  }
  const manifest = arPut(w.store, JSON.stringify({ manifest: 'arweave/paths', version: '0.1.0', paths }))
  const args = (base: string) => verifyArgs(w, ['--address', ADDRESS, '--base', base, '--gateway', w.gateway])

  const ar = await runScript('verify.mjs', args(`ar://${manifest}/`))
  assert.equal(ar.code, 0, ar.out)
  assert.match(ar.out, new RegExp(`4/4 token\\(s\\) from ar://${manifest}/ serve`))

  w.state.tokenUriBase = `ar://${manifest}/`
  const chain = await runScript('verify.mjs', args('chain'))
  assert.equal(chain.code, 0, chain.out)
  assert.match(chain.out, /4\/4 token\(s\) from tokenURI on chain serve/)

  // A manifest whose token 2 points at token 1's metadata fails.
  const swapped = arPut(
    w.store,
    JSON.stringify({ manifest: 'arweave/paths', version: '0.1.0', paths: { ...paths, '2': paths['1']! } })
  )
  const bad = await runScript('verify.mjs', args(`ar://${swapped}/`))
  assert.equal(bad.code, 1)
  assert.match(bad.out, /token 2: /)
  assert.equal((await runScript('verify.mjs', args('ar://no-slash'))).code, 2)
})

/* ---------- arweave.mjs, with Irys stubbed ---------- */

/** A stand-in @irys/sdk: uploads land in the fake Arweave store (and a log), ids are their sha256 in base64url. */
const STUB = join(TMP, 'irys-stub.mjs')
const HOOKS = join(TMP, 'irys-hooks.mjs')
writeFileSync(
  STUB,
  `import { createHash } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export default class Irys {
  async ready() {}
  async getLoadedBalance() { return 10n ** 18n }
  async getPrice() { return 1n }
  async upload(data, { tags }) {
    const id = createHash('sha256').update(data).digest('base64url')
    writeFileSync(join(process.env.IRYS_STUB_STORE, id), data)
    appendFileSync(process.env.IRYS_STUB_LOG, JSON.stringify({ id, tags, bytes: Buffer.byteLength(data) }) + '\\n')
    return { id }
  }
}
`
)
writeFileSync(
  HOOKS,
  `import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@irys/sdk') return { url: pathToFileURL(${JSON.stringify(STUB)}).href, shortCircuit: true }
    return next(specifier, context)
  },
})
`
)

async function arweaveRun(w: Awaited<ReturnType<typeof world>>, build: string, args: string[] = []) {
  const log = join(build, 'irys-stub.log')
  const res = await runScript(
    'arweave.mjs',
    ['--build', build, '--site', w.origin, '--slug', SLUG, '--gateway', w.gateway, ...args],
    {
      REVEAL_ADMIN_KEY: KEY,
      REVEAL_IRYS_KEY: 'test-only-not-a-key',
      IRYS_NODE: w.origin,
      IRYS_STUB_STORE: w.store,
      IRYS_STUB_LOG: log,
      REVEAL_READ_TRIES: '2',
      REVEAL_READ_WAIT_MS: '10',
    },
    ['--import', HOOKS]
  )
  const uploads = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; bytes: number })
    : []
  return { ...res, uploads }
}

test('arweave: report-only uploads nothing; --execute uploads drawn pieces only, checked, then records them', async () => {
  const w = await world(10, [101, 102, 103], 120)
  const build = writeBuild(w.c)
  const report = await arweaveRun(w, build)
  assert.equal(report.code, 0, report.out)
  assert.match(report.out, /report only: run with --execute/)
  assert.equal(report.uploads.length, 0)

  const run = await arweaveRun(w, build, ['--execute'])
  assert.equal(run.code, 0, run.out)
  assert.equal(run.uploads.length, 6) // image + metadata for each of the 3 drawn pieces
  const drawn = new Set(w.state.assignments.map((a) => a.piece))
  const undrawn = w.c.pieces.filter((p) => !drawn.has(p.n))
  for (const p of undrawn) {
    const id = createHash('sha256').update(p.jpg).digest('base64url')
    assert.ok(!run.uploads.some((u) => u.id === id), `undrawn piece ${p.n} was uploaded`)
  }
  assert.deepEqual(
    w.state.recorded.map((r) => r.piece),
    w.state.assignments.map((a) => a.piece)
  )
  assert.ok(!existsSync(join(build, 'arweave.lock')), 'the lock is released')
})

test('arweave: a run picks up from the journal instead of uploading an image twice', async () => {
  const w = await world(10, [101, 102], 120)
  const build = writeBuild(w.c)
  const first = w.state.assignments[0]!
  const imageId = arPut(w.store, w.c.pieces[first.piece - 1]!.jpg)
  writeFileSync(join(build, 'arweave-journal.jsonl'), `${JSON.stringify({ piece: first.piece, image: imageId, at: 1 })}\n`)
  const run = await arweaveRun(w, build, ['--execute'])
  assert.equal(run.code, 0, run.out)
  assert.equal(run.uploads.length, 3) // piece 1's metadata, then piece 2's image and metadata
  assert.ok(!run.uploads.some((u) => u.id === imageId))
  assert.equal(w.state.recorded[0]!.image, imageId)
})

test('arweave: refuses missing or altered build files, a second run at once, and a draft provenance', async () => {
  const w = await world(10, [101, 102], 120)
  const a = w.state.assignments[1]!

  const missing = writeBuild(w.c)
  rmSync(join(missing, 'piece', `${a.piece}.jpg`))
  const m = await arweaveRun(w, missing, ['--execute'])
  assert.equal(m.code, 2)
  assert.match(m.out, new RegExp(`missing files for drawn piece\\(s\\) ${a.piece}`))
  assert.equal(m.uploads.length, 0)

  const altered = writeBuild(w.c)
  const p = w.c.pieces[a.piece - 1]!
  writeFileSync(join(altered, 'piece', `${a.piece}.json`), p.json.replace('"D é"', '"D e"'))
  const t = await arweaveRun(w, altered, ['--execute'])
  assert.equal(t.code, 2)
  assert.match(t.out, new RegExp(`piece ${a.piece}.json with its salt is not the provenance's`))
  assert.ok(!t.uploads.some((u) => u.bytes > 0 && u.id === createHash('sha256').update(p.jpg).digest('base64url')))

  const locked = writeBuild(w.c)
  writeFileSync(join(locked, 'arweave.lock'), 'another run')
  const l = await arweaveRun(w, locked, ['--execute'])
  assert.equal(l.code, 2)
  assert.match(l.out, /another run is working on this build/)
  assert.ok(existsSync(join(locked, 'arweave.lock')), "someone else's lock is left alone")

  const draft = writeBuild(w.c, { draft: true })
  const d = await arweaveRun(w, draft, ['--provenance', '--execute'])
  assert.equal(d.code, 2)
  assert.match(d.out, /draft .*must never go to Arweave/)
  assert.equal(d.uploads.length, 0)
})

test('arweave --manifest: no calls before sell-out or before the manifest exists; lock calldata only once every path checks out', async () => {
  const w = await world(4, [101, 102, 103], 120)
  const build = writeBuild(w.c)
  const early = await arweaveRun(w, build, ['--manifest'])
  assert.equal(early.code, 1)
  assert.match(early.out, /4 token\(s\) are not drawn and on Arweave yet \(first: 1, 2, 3, 4\)/)
  assert.doesNotMatch(early.out, /lockMetadata|calldata/)

  // Sold out, every piece on Arweave (as the per-piece runs leave it).
  const all = await world(4, [101, 102, 103, 104], 120)
  const b = writeBuild(all.c)
  const up = await arweaveRun(all, b, ['--execute'])
  assert.equal(up.code, 0, up.out)
  for (const r of all.state.recorded) {
    const a = all.state.assignments.find((x) => x.piece === r.piece)!
    a.arImage = String(r.image)
    a.arMetadata = String(r.metadata)
  }
  const report = await arweaveRun(all, b, ['--manifest'])
  assert.equal(report.code, 0, report.out)
  assert.match(report.out, /report only: run with --manifest --execute/)
  assert.doesNotMatch(report.out, /calldata|lockMetadata\(\)/)

  const done = await arweaveRun(all, b, ['--manifest', '--execute'])
  assert.equal(done.code, 0, done.out)
  assert.match(done.out, /all 4 paths of ar:\/\/.*\/ are their token's piece/)
  assert.match(done.out, /lockMetadata\(\)\n.*calldata 0x/)

  // A manifest in the journal whose path 3 is token 1's metadata: checked, refused, no calls printed.
  const journal = join(b, 'arweave-journal.jsonl')
  const paths = Object.fromEntries(all.state.assignments.map((a) => [String(a.token), { id: a.arMetadata! }]))
  const swapped = arPut(all.store, JSON.stringify({ manifest: 'arweave/paths', version: '0.1.0', paths: { ...paths, '3': paths['1']! } }))
  writeFileSync(
    journal,
    readFileSync(journal, 'utf8')
      .split('\n')
      .filter((l) => l && !l.includes('"piece":"manifest"'))
      .concat(JSON.stringify({ piece: 'manifest', manifest: swapped, at: 1 }), '')
      .join('\n')
  )
  const bad = await arweaveRun(all, b, ['--manifest'])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /MISMATCH token 3/)
  assert.doesNotMatch(bad.out, /calldata/)
})

/* ---------- prepare.mjs ---------- */

test('prepare: a rerun keeps every salt and gives the same provenance; a lost salt changes only its piece', async () => {
  const src = mkdtempSync(join(TMP, 'art-'))
  const [a, b, json] = ['images_A', 'images_B', 'json'].map((d) => join(src, d))
  for (const d of [a!, b!, json!]) mkdirSync(d)
  const LAYERS = 'C:\\Users\\juan\\layers'
  for (let n = 1; n <= 3; n += 1) {
    writeFileSync(join(a!, `${n}.jpg`), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n]))
    writeFileSync(
      join(json!, `${n}.json`),
      JSON.stringify({
        name: `Miyamaker #${n}`,
        description: 'x',
        image: `ipfs://x/${n}.png`,
        edition: n,
        attributes: [
          { trait_type: LAYERS, value: 'Background' },
          { trait_type: 'Eyes', value: `E${n}` },
        ],
      })
    )
  }
  const out = join(mkdtempSync(join(TMP, 'out-')), 'build')
  const prepare = () =>
    runScript('prepare.mjs', ['--out', out, '--images-a', a!, '--images-b', b!, '--json', json!, '--count', '3'])
  const readOut = () => ({
    prov: JSON.parse(readFileSync(join(out, 'provenance.json'), 'utf8')),
    salts: readdirSync(join(out, 'piece'))
      .filter((f) => f.endsWith('.salt'))
      .sort()
      .map((f) => readFileSync(join(out, 'piece', f), 'utf8')),
  })

  const one = await prepare()
  assert.equal(one.code, 0, one.out)
  const first = readOut()
  assert.equal(first.prov.draft, true)
  assert.equal(first.salts.length, 3)
  assert.equal(new Set(first.salts).size, 3)
  assert.equal(readFileSync(join(out, 'piece', '2.json'), 'utf8'), canonicalJson({
    description: 'Miyamaker. (Placeholder: the owner supplies the final description before launch.)',
    attributes: [
      { trait_type: 'Eyes', value: 'E2' },
      { trait_type: 'Piece', value: 2 },
    ],
  }))

  assert.equal((await prepare()).code, 0)
  const second = readOut()
  assert.deepEqual(second.salts, first.salts)
  assert.equal(second.prov.provenanceHash, first.prov.provenanceHash)
  assert.deepEqual(second.prov.pieces, first.prov.pieces)

  rmSync(join(out, 'piece', '2.salt'))
  assert.equal((await prepare()).code, 0)
  const third = readOut()
  assert.notEqual(third.salts[1], first.salts[1])
  assert.notEqual(third.prov.provenanceHash, first.prov.provenanceHash)
  assert.deepEqual(third.prov.pieces[0], first.prov.pieces[0])
  assert.deepEqual(third.prov.pieces[2], first.prov.pieces[2])
  assert.equal(third.prov.pieces[1].image, first.prov.pieces[1].image)
  assert.notEqual(third.prov.pieces[1].metadata, first.prov.pieces[1].metadata)
})

#!/usr/bin/env node
// Moves drawn pieces to Arweave, one at a time as they are drawn: the image, then its metadata JSON (image = ar://<id>),
// then the ids go to the site (POST …/admin/arweave), which from then on serves the ar:// image. Only pieces the site's
// public assignments.json lists as drawn are ever uploaded: an unminted piece never reaches Arweave.
// REPORT-ONLY unless started with --execute.
//
//   node scripts/reveal/arweave.mjs --build ~/miyamaker-reveal-build [--site https://www.miyamaker.com] [--slug miyamaker]
//   REVEAL_ADMIN_KEY=… REVEAL_IRYS_KEY=… node scripts/reveal/arweave.mjs --build … --execute
//   … --provenance [--execute]                         at launch: provenance.json itself (it reveals nothing)
//   … --manifest [--rpc <Ethereum RPC>] [--execute]   at sell-out: the folder manifest (paths 1..supply = token ids,
//                                                        and assignments.json with every draw and salt)
//                                                        and the setMetadata + lockMetadata calls for the owner to send
//
// REVEAL_IRYS_KEY is the Ethereum private key of a funded Irys account (environment only, never logged; this never
// funds it). Every upload is written to <build>/arweave-journal.jsonl before anything else happens, so a run that stops
// between an upload and its recording carries on from the journal instead of paying twice.
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createPublicClient, encodeFunctionData, http, parseAbi } from 'viem'

import { metadataHash, servedMetadata, storedFromServed, tokenName } from '../../api/_lib/revealpiece.mjs'
import { admin, adminKey, log, parseArgs, readJson, revealBase, run } from './lib.mjs'

const flags = parseArgs(process.argv.slice(2), {
  build: 'value',
  site: 'value',
  slug: 'value',
  execute: 'flag',
  manifest: 'flag',
  provenance: 'flag',
  rpc: 'value',
  limit: 'value',
})
const EXECUTE = !!flags.execute
const IRYS_NODE = process.env.IRYS_NODE?.trim() || 'https://uploader.irys.xyz'
const DROP_ABI = parseAbi([
  'function unrevealedURI() view returns (string)',
  'function contractURI() view returns (string)',
  'function metadataLocked() view returns (bool)',
  'function setMetadata(string baseURI_, string unrevealedURI_, string contractURI_)',
  'function lockMetadata()',
])

run(async () => {
  if (!flags.build) throw new Error('--build <dir> (the private build from prepare.mjs) is required.')
  const build = resolve(flags.build.replace(/^~/, homedir()))
  const base = revealBase(flags.site ?? 'https://www.miyamaker.com', flags.slug ?? 'miyamaker')
  const provenance = JSON.parse(await readFile(join(build, 'provenance.json'), 'utf8'))
  const list = await readJson(`${base}/assignments.json`)
  if (list.provenanceHash !== provenance.provenanceHash)
    throw new Error('The site serves another provenance than this build.')
  log(`starting ${EXECUTE ? 'IN EXECUTE MODE' : 'in report-only mode'}: ${list.assigned} drawn of ${list.supply}`)

  const journalPath = join(build, 'arweave-journal.jsonl')
  const journal = await readJournal(journalPath)
  if (flags.manifest) return manifest({ list, journal, journalPath, base })
  if (flags.provenance) return publishProvenance(build, journal, journalPath)

  const todo = list.assignments.filter((a) => !a.arImage || !a.arMetadata).slice(0, Number(flags.limit ?? Infinity))
  const bytes = todo.reduce((n, a) => n + fileSize(join(build, 'piece', `${a.piece}.jpg`)) + 2048, 0)
  log(`${todo.length} drawn piece(s) not on Arweave yet, about ${(bytes / 1e6).toFixed(1)} MB`)
  const price = await irysPrice(bytes).catch((e) => `unknown (${e.message})`)
  log(`Irys price for that: ${price}`)
  for (const a of todo.slice(0, 10))
    log(
      `  token ${a.token} -> piece ${a.piece}${
        journal.get(a.piece)?.image ? ' (image already uploaded, per the journal)' : ''
      }`
    )
  if (!EXECUTE || !todo.length) {
    if (!EXECUTE && todo.length) log('report only: run with --execute to upload')
    return 0
  }

  const key = adminKey()
  const irys = await irysClient()
  const balance = BigInt((await irys.getLoadedBalance()).toString())
  const need = BigInt((await irys.getPrice(bytes)).toString())
  if (balance < need)
    throw new Error(
      `The Irys balance (${balance} wei) is under the price (${need} wei). Fund it first; this never does.`
    )

  for (const a of todo) {
    const want = provenance.pieces[a.piece - 1]
    // The site must serve this piece for this token right now: it is drawn, so it may go public.
    const served = await (await fetch(`${base}/${a.token}`)).json()
    const salt = (await readFile(join(build, 'piece', `${a.piece}.salt`), 'utf8')).trim()
    if (a.salt !== salt) throw new Error(`the site publishes another salt for piece ${a.piece}: stopping`)
    if ((await metadataHash(salt, storedFromServed(served))) !== want.metadata)
      throw new Error(`token ${a.token} does not serve piece ${a.piece}: stopping`)

    const j = journal.get(a.piece) ?? {}
    if (!j.image) {
      const img = await readFile(join(build, 'piece', `${a.piece}.jpg`))
      if ((await sha(img)) !== want.image) throw new Error(`piece ${a.piece}.jpg is not the provenance's`)
      const r = await irys.upload(img, { tags: [{ name: 'Content-Type', value: 'image/jpeg' }] })
      j.image = r.id
      await appendFile(journalPath, `${JSON.stringify({ piece: a.piece, image: r.id, at: Date.now() })}\n`)
    }
    if (!j.metadata) {
      const stored = await readFile(join(build, 'piece', `${a.piece}.json`), 'utf8')
      const name = tokenName(list.name, list.nameBy, a.token, a.piece)
      const meta = JSON.stringify(servedMetadata(stored, { name, image: `ar://${j.image}` }))
      const r = await irys.upload(meta, { tags: [{ name: 'Content-Type', value: 'application/json' }] })
      j.metadata = r.id
      await appendFile(journalPath, `${JSON.stringify({ piece: a.piece, metadata: r.id, at: Date.now() })}\n`)
    }
    journal.set(a.piece, j)
    const rec = await admin(base, 'arweave', { method: 'POST', key, body: JSON.stringify({ piece: a.piece, ...j }) })
    if (rec.status !== 200) throw new Error(`recording piece ${a.piece}: ${rec.status} ${rec.data.error}`)
    log(`token ${a.token} piece ${a.piece}: image ar://${j.image}, metadata ar://${j.metadata}`)
  }
  return 0
})

/**
 * At sell-out: an Arweave path manifest naming each token id's metadata, so baseURI ar://<manifest>/ gives tokenURI(id)
 * = ar://<manifest>/<id>. Report-only prints it; --execute uploads it. Either way prints the owner's two calls.
 */
async function manifest({ list, journal, journalPath, base }) {
  const missing = []
  const paths = {}
  for (let t = 1; t <= list.supply; t += 1) {
    const a = list.assignments[t - 1]
    if (!a || a.token !== t || !a.arMetadata) missing.push(t)
    else paths[String(t)] = { id: a.arMetadata }
  }
  if (missing.length) {
    log(`${missing.length} token(s) are not drawn and on Arweave yet (first: ${missing.slice(0, 10).join(', ')}).`)
    log('The manifest is for a sold-out drop: setting baseURI to it now would leave later tokens without metadata.')
    return 1
  }
  // The final assignments.json (draws and salts) goes in the same folder, so the proof outlives the site.
  let listId = journal.get('assignments')?.manifest
  if (!listId && EXECUTE) {
    const irys = await irysClient()
    const r = await irys.upload(JSON.stringify(list), { tags: [{ name: 'Content-Type', value: 'application/json' }] })
    listId = r.id
    await appendFile(journalPath, `${JSON.stringify({ piece: 'assignments', manifest: listId, at: Date.now() })}\n`)
  }
  if (listId) paths['assignments.json'] = { id: listId }
  const body = JSON.stringify({ manifest: 'arweave/paths', version: '0.1.0', paths })
  await writeFile(join(dirname(journalPath), 'manifest.json'), body)
  log(`manifest: ${list.supply} paths, ${body.length} bytes, written to ${join(dirname(journalPath), 'manifest.json')}`)

  let id = journal.get('manifest')?.manifest
  if (!id && EXECUTE) {
    const irys = await irysClient()
    const r = await irys.upload(body, {
      tags: [
        { name: 'Type', value: 'manifest' },
        { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
      ],
    })
    id = r.id
    await appendFile(journalPath, `${JSON.stringify({ piece: 'manifest', manifest: id, at: Date.now() })}\n`)
  }
  const baseURI = `ar://${id ?? '<manifest id>'}/`
  log(id ? `manifest ar://${id}` : 'report only: run with --manifest --execute to upload the manifest')

  let unrevealed = '<current unrevealedURI()>'
  let contract = '<current contractURI()>'
  if (flags.rpc) {
    const client = createPublicClient({ transport: http(flags.rpc) })
    const read = (functionName) => client.readContract({ address: list.address, abi: DROP_ABI, functionName })
    ;[unrevealed, contract] = await Promise.all([read('unrevealedURI'), read('contractURI')])
    if (await read('metadataLocked')) log('NOTE: metadata is already locked on chain.')
  } else log('(add --rpc to fill in the current unrevealedURI and contractURI)')

  log(`The owner sends, to ${list.address} on chain ${list.chainId} (this script sends nothing):`)
  log(`  1. setMetadata("${baseURI}", <unrevealedURI unchanged>, <contractURI unchanged>)`)
  if (id && flags.rpc) {
    log(
      `     calldata ${encodeFunctionData({
        abi: DROP_ABI,
        functionName: 'setMetadata',
        args: [baseURI, unrevealed, contract],
      })}`
    )
  }
  log(`  2. after checking https://arweave.net/${id ?? '<manifest id>'}/1 and a few more resolve: lockMetadata()`)
  log(`     calldata ${encodeFunctionData({ abi: DROP_ABI, functionName: 'lockMetadata' })}`)
  log(`  Or in Manager: Metadata folder link = ${baseURI}, Save folder link, then Lock metadata forever.`)
  log(`  Before 2, run verify.mjs --site ${base} --content all against the site once more.`)
  return 0
}

/** provenance.json to Arweave, so the hash in the collection description points at a file nobody can change. */
async function publishProvenance(build, journal, journalPath) {
  const body = await readFile(join(build, 'provenance.json'))
  const done = journal.get('provenance')?.manifest
  if (done) {
    log(`provenance.json is ar://${done} (per the journal)`)
    return 0
  }
  log(
    `provenance.json: ${body.length} bytes; Irys price ${await irysPrice(body.length).catch(
      (e) => `unknown (${e.message})`
    )}`
  )
  if (!EXECUTE) {
    log('report only: run with --provenance --execute to upload it')
    return 0
  }
  const irys = await irysClient()
  const r = await irys.upload(body, { tags: [{ name: 'Content-Type', value: 'application/json' }] })
  await appendFile(journalPath, `${JSON.stringify({ piece: 'provenance', manifest: r.id, at: Date.now() })}\n`)
  log(`provenance.json is ar://${r.id}: put it in the collection description with the provenance hash`)
  return 0
}

async function readJournal(path) {
  const out = new Map()
  if (!existsSync(path)) return out
  for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
    const e = JSON.parse(line)
    out.set(e.piece, {
      ...out.get(e.piece),
      ...(e.image ? { image: e.image } : {}),
      ...(e.metadata ? { metadata: e.metadata } : {}),
      ...(e.manifest ? { manifest: e.manifest } : {}),
    })
  }
  return out
}

const sha = async (data) => createHash('sha256').update(data).digest('hex')

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** The node's price for `bytes` in wei, read over plain HTTP: nothing is signed or sent. */
async function irysPrice(bytes) {
  if (!bytes) return '0'
  const res = await fetch(`${IRYS_NODE}/price/ethereum/${bytes}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${res.status}`)
  const wei = BigInt((await res.text()).trim())
  return `${wei} wei (${Number(wei) / 1e18} ETH)`
}

/** The Irys uploader, keyed from REVEAL_IRYS_KEY. Loaded only in execute mode. */
async function irysClient() {
  const key = process.env.REVEAL_IRYS_KEY?.trim()
  if (!key) throw new Error('--execute needs REVEAL_IRYS_KEY (the funded Irys account key) in the environment.')
  const { default: Irys } = await import('@irys/sdk')
  const irys = new Irys({ url: IRYS_NODE, token: 'ethereum', key })
  await irys.ready()
  return irys
}

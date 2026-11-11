#!/usr/bin/env node
// Loads a private build (prepare.mjs) into the site's reveal: registers the collection, sends provenance.json, then
// every piece's .jpg and .json that the site does not have yet, in parallel. The Worker keeps a file only when its
// sha256 is the provenance's. Safe to stop and run again: it asks the site what is missing first.
//
//   REVEAL_ADMIN_KEY=… node scripts/reveal/load.mjs --build ~/miyamaker-reveal-build --cover ar://<cover>
//       [--site https://www.miyamaker.com] [--slug miyamaker] [--chain 1] [--name Miyamaker]
//       [--cover-description "…"] [--name-by token|piece] [--concurrency 16] [--register-only]
//
// --name-by: drawn tokens are named "<name> #<token id>" (token, the default) or "#<piece number>" (piece); the piece
// number is always a "Piece" trait. It can change until the first token is drawn. Each piece's salt (<n>.salt) goes
// with its metadata and stays private on the site until that piece is drawn.
//
// A draft build (placeholder description, or --count) only loads into a local site (wrangler dev).
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

import { admin, adminKey, isLocalSite, log, parseArgs, pool, revealBase, run } from './lib.mjs'

const flags = parseArgs(process.argv.slice(2), {
  build: 'value',
  site: 'value',
  slug: 'value',
  chain: 'value',
  name: 'value',
  cover: 'value',
  'cover-description': 'value',
  'name-by': 'value',
  concurrency: 'value',
  'register-only': 'flag',
})

run(async () => {
  if (!flags.build) throw new Error('--build <dir> is required.')
  if (!flags.cover)
    throw new Error('--cover <ar://… | ipfs://… | https://…> is required: the image every token shows until drawn.')
  const key = adminKey()
  const build = resolve(flags.build.replace(/^~/, homedir()))
  const site = flags.site ?? 'https://www.miyamaker.com'
  const slug = flags.slug ?? 'miyamaker'
  const base = revealBase(site, slug)
  const provenanceText = await readFile(join(build, 'provenance.json'), 'utf8')
  const provenance = JSON.parse(provenanceText)
  if (provenance.draft && !isLocalSite(site)) {
    throw new Error(
      'This build is a draft (placeholder description or a partial --count). It only loads into a local site.'
    )
  }

  const reg = await admin(base, 'collection', {
    method: 'PUT',
    key,
    body: JSON.stringify({
      chainId: Number(flags.chain ?? 1),
      supply: provenance.supply,
      provenanceHash: provenance.provenanceHash,
      name: flags.name ?? provenance.name,
      description:
        flags['cover-description'] ??
        `${provenance.name}: revealed once minted. Provenance ${provenance.provenanceHash}`,
      coverImage: flags.cover,
      nameBy: flags['name-by'] ?? 'token',
    }),
  })
  if (reg.status !== 200) throw new Error(`register: ${reg.status} ${reg.data.error}`)
  log(`registered ${slug}: supply ${provenance.supply}, provenance ${provenance.provenanceHash}`)

  const prov = await admin(base, 'provenance', { method: 'PUT', key, body: provenanceText })
  if (prov.status !== 200) throw new Error(`provenance: ${prov.status} ${prov.data.error}`)
  log(`provenance.json loaded (${prov.data.pieces} pieces)`)
  if (flags['register-only']) return 0

  const status = async () => {
    const s = await admin(base, 'status', { key })
    if (s.status !== 200) throw new Error(`status: ${s.status} ${s.data.error}`)
    return s.data
  }
  const before = await status()
  const todo = [
    ...before.missingImages.map((n) => ({ n, ext: 'jpg' })),
    ...before.missingMetadata.map((n) => ({ n, ext: 'json' })),
  ]
  log(`${before.missingImages.length} image(s) and ${before.missingMetadata.length} metadata file(s) to send`)

  const want = new Map(provenance.pieces.map((p) => [p.n, p]))
  let sent = 0
  const failed = []
  await pool(todo, Number(flags.concurrency ?? 16), async ({ n, ext }) => {
    const body = await readFile(join(build, 'piece', `${n}.${ext}`))
    const res = await admin(base, `piece/${n}.${ext}`, {
      method: 'PUT',
      key,
      body,
      contentType: ext === 'jpg' ? 'image/jpeg' : 'application/json',
      headers:
        ext === 'json' ? { 'x-reveal-salt': (await readFile(join(build, 'piece', `${n}.salt`), 'utf8')).trim() } : {},
    }).catch((e) => ({ status: 0, data: { error: e.message } }))
    const expected = ext === 'jpg' ? want.get(n)?.image : want.get(n)?.metadata
    if (res.status !== 200 || res.data.sha256 !== expected) {
      failed.push(`${n}.${ext}: ${res.status} ${res.data.error ?? 'wrong hash'}`)
      return
    }
    sent += 1
    if (sent % 500 === 0) log(`${sent}/${todo.length} sent`)
  })

  const after = await status()
  for (const f of failed.slice(0, 20)) log(`failed ${f}`)
  log(
    `sent ${sent}; still missing: ${after.missingImages.length} image(s), ${after.missingMetadata.length} metadata file(s)`
  )
  return after.missingImages.length || after.missingMetadata.length ? 1 : 0
})

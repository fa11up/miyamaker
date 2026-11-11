#!/usr/bin/env node
// Makes the reveal's private build from the art and its HashLips metadata. Reads only; writes only under --out, which
// must be outside any git checkout (the art never goes in the repo).
//
//   node scripts/reveal/prepare.mjs --out ~/miyamaker-reveal-build [--description-file desc.txt] [--count 50]
//
// Writes <out>/piece/<n>.jpg (the art, cloned/copied), <out>/piece/<n>.json (the cleaned metadata without image,
// canonical: what is hashed), <out>/provenance.json and <out>/provenance-hash.txt. Same input, same output, so it can
// be run again. The provenance hash covers the description: set the real one (--description-file) before launch.
//
// Sources (defaults): ~/Downloads/images_A/1..4999.jpg, ~/Downloads/images_B/5000..10000.jpg, ~/Downloads/json/<n>.json
// for 1..9999 and _metadata.json's edition 0 for piece 10000 (there is no 0.json). Each <n>.json is checked against
// _metadata.json's edition n (all but the description, which is replaced anyway).
import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

import { CONFIRMATIONS, DRAW_RULE } from '../../api/_lib/revealdraw.mjs'
import { canonicalJson, cleanMetadata, isJpeg, provenanceHash } from '../../api/_lib/revealpiece.mjs'
import { log, parseArgs, pool, run } from './lib.mjs'

/** The token description. The owner's words go here (or --description-file) before the launch build. */
const DESCRIPTION = 'Miyamaker. (Placeholder: the owner supplies the final description before launch.)'
const PREFIX = 'Miyamaker'
const SUPPLY = 10_000

const HOME = homedir()
const flags = parseArgs(process.argv.slice(2), {
  out: 'value',
  'images-a': 'value',
  'images-b': 'value',
  json: 'value',
  'description-file': 'value',
  count: 'value',
})

run(async () => {
  if (!flags.out) throw new Error('--out <dir> is required (outside the repo).')
  const out = resolve(flags.out.replace(/^~/, HOME))
  const imagesA = resolve((flags['images-a'] ?? '~/Downloads/images_A').replace(/^~/, HOME))
  const imagesB = resolve((flags['images-b'] ?? '~/Downloads/images_B').replace(/^~/, HOME))
  const jsonDir = resolve((flags.json ?? '~/Downloads/json').replace(/^~/, HOME))
  const count = flags.count ? Number(flags.count) : SUPPLY
  if (!Number.isInteger(count) || count < 1 || count > SUPPLY) throw new Error(`--count must be 1..${SUPPLY}`)

  await mkdir(join(out, 'piece'), { recursive: true })
  if (insideGit(out))
    throw new Error(`${out} is inside a git checkout. Put the build somewhere private, outside any repo.`)

  const description = flags['description-file']
    ? (await readFile(resolve(flags['description-file'].replace(/^~/, HOME)), 'utf8')).trim()
    : DESCRIPTION
  const draft = description === DESCRIPTION || count !== SUPPLY
  if (description === DESCRIPTION)
    log('WARNING: placeholder description. This build is a draft: its provenance hash is not the launch one.')

  const editions = new Map()
  const metaAll = join(jsonDir, '_metadata.json')
  if (existsSync(metaAll)) for (const m of JSON.parse(await readFile(metaAll, 'utf8'))) editions.set(m.edition, m)
  else log(`no ${metaAll}: <n>.json files are not cross-checked`)

  const pieces = new Array(count)
  const ns = Array.from({ length: count }, (_, i) => i + 1)
  let bytes = 0
  await pool(ns, 16, async (n) => {
    const src = imageSource(n, imagesA, imagesB)
    const img = await readFile(src)
    if (!isJpeg(img)) throw new Error(`${src} is not a JPEG`)
    bytes += img.length
    await copyFile(src, join(out, 'piece', `${n}.jpg`), constants.COPYFILE_FICLONE)

    let raw
    if (n === SUPPLY) {
      raw = editions.get(0)
      if (!raw) throw new Error('Piece 10000 comes from _metadata.json edition 0, which is missing.')
    } else {
      raw = JSON.parse(await readFile(join(jsonDir, `${n}.json`), 'utf8'))
      const ed = editions.get(n)
      if (
        editions.size &&
        (!ed || canonicalJson({ ...ed, description: '' }) !== canonicalJson({ ...raw, description: '' }))
      ) {
        throw new Error(`json/${n}.json differs from _metadata.json edition ${n}`)
      }
    }
    const stored = canonicalJson(cleanMetadata(raw, n, { prefix: PREFIX, description }))
    await writeFile(join(out, 'piece', `${n}.json`), stored)
    pieces[n - 1] = { n, image: sha256(img), metadata: sha256(Buffer.from(stored, 'utf8')) }
    if (n % 1000 === 0) log(`${n} pieces`)
  })

  const hash = await provenanceHash(pieces)
  const provenance = {
    name: PREFIX,
    supply: count,
    ...(draft ? { draft: true } : {}),
    provenanceHash: hash,
    confirmations: CONFIRMATIONS,
    rule: DRAW_RULE,
    hashes:
      'image = sha256 of the JPG bytes; metadata = sha256 of the token metadata without its image field, as JSON with ' +
      'keys sorted at every level, no spaces, UTF-8; provenanceHash = sha256 of the lines "n:image:metadata\\n" for ' +
      'n = 1..supply.',
    pieces,
  }
  await writeFile(join(out, 'provenance.json'), `${JSON.stringify(provenance)}\n`)
  await writeFile(join(out, 'provenance-hash.txt'), `${hash}\n`)
  log(`${count} pieces, ${(bytes / 1e9).toFixed(2)} GB of art, in ${out}`)
  log(`provenanceHash ${hash}${draft ? ' (DRAFT)' : ''}`)
  return 0
})

/** Pieces 1..4999 are in images_A, 5000..10000 in images_B; exactly one of them must have it. */
function imageSource(n, a, b) {
  const inA = existsSync(join(a, `${n}.jpg`))
  const inB = existsSync(join(b, `${n}.jpg`))
  if (inA === inB) throw new Error(`${n}.jpg is in ${inA ? 'both image folders' : 'neither image folder'}`)
  return join(inA ? a : b, `${n}.jpg`)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function insideGit(dir) {
  try {
    return (
      execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() === 'true'
    )
  } catch {
    return false
  }
}

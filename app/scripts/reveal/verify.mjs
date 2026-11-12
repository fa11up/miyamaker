#!/usr/bin/env node
// Checks the Miyamaker reveal from the chain: every published draw is redone from the drop's mints and block headers
// with the published rule (api/_lib/revealdraw.mjs) and compared. Exits 1 on any mismatch, 0 when all agree.
// What collectors run; it needs nothing from us but the two public files.
//
//   node scripts/reveal/verify.mjs --rpc https://<an Ethereum RPC> --address 0x<the drop, from its collection page> \
//       --provenance-hash <hex from the collection description> \
//       [--site https://www.miyamaker.com/reveal/miyamaker]   (or --assignments <file> --provenance <file>)
//       [--content 50 | --content all] [--base ar://<manifest>/ | --base chain] [--gateway https://arweave.net]
//
// It checks: the list is for --address (you give it, so a list for another contract can't pass); provenance.json hashes
// to its provenanceHash and to --provenance-hash (without it the result says UNPINNED: the files were only checked
// against each other); the drop's Transfer-from-0x0 logs are tokens 1..totalSupply with no gaps; for each listed token,
// the mint block, block B+1's mixHash (the seed), that B+1 follows B, the drawn piece, and that each drawn piece's salt
// is published. --content also fetches tokens' metadata and images: sha256(salt || metadata without name and image) and
// sha256(image) must be the provenance's, the name "<collection> #<token id or piece>" and the last trait the piece
// number. By default the metadata is the site's; --base reads it from elsewhere instead: an Arweave manifest
// (ar://<id>/ + token id, through --gateway) or `chain` (each token's tokenURI on chain, wherever it points), so the
// permanent copy is checked too (--base without --content checks every listed token). Reading logs from the deploy block
// needs an RPC that allows wide eth_getLogs ranges (it narrows the range on errors) and, for totalSupply at a past
// block, an archive node.
import { createPublicClient, http, parseAbiItem } from 'viem'

import { CONFIRMATIONS } from '../../api/_lib/revealdraw.mjs'
import {
  metadataHash,
  PIECE_TRAIT,
  provenanceHash,
  sha256Hex,
  storedFromServed,
  tokenName,
} from '../../api/_lib/revealpiece.mjs'
import { checkDraws, log, parseArgs, pool, readJson, run } from './lib.mjs'

const flags = parseArgs(process.argv.slice(2), {
  rpc: 'value',
  site: 'value',
  assignments: 'value',
  provenance: 'value',
  'provenance-hash': 'value',
  content: 'value',
  address: 'value',
  base: 'value',
  gateway: 'value',
})
const TOKEN_URI_ABI = [parseAbiItem('function tokenURI(uint256) view returns (string)')]
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const ZERO = '0x0000000000000000000000000000000000000000'

run(async () => {
  if (!flags.rpc) throw new Error('--rpc <Ethereum RPC URL> is required.')
  if (!/^0x[0-9a-fA-F]{40}$/.test(flags.address ?? '')) {
    throw new Error(
      '--address 0x<the drop> is required: the published list is checked against the contract you name, not its own word.'
    )
  }
  const address = flags.address.toLowerCase()
  if (flags['provenance-hash'] !== undefined && !/^[0-9a-fA-F]{64}$/.test(flags['provenance-hash'])) {
    throw new Error('--provenance-hash is 64 hex characters (the sha256 in the collection description).')
  }
  const base = flags.base === undefined ? undefined : metadataBase(flags.base)
  const gatewayUrl = (flags.gateway ?? 'https://arweave.net').replace(/\/+$/, '')
  const site = (flags.site ?? 'https://www.miyamaker.com/reveal/miyamaker').replace(/\/+$/, '')
  const list = await readJson(flags.assignments ?? `${site}/assignments.json`)
  const prov = await readJson(flags.provenance ?? `${site}/provenance.json`)
  const problems = []
  const pinned = flags['provenance-hash'] !== undefined
  if (!Array.isArray(list.assignments)) throw new Error('assignments.json has no assignments list.')

  // 1. Provenance: the file is the hash, and the hash is the one published.
  const hash = await provenanceHash(prov.pieces)
  if (hash !== prov.provenanceHash) problems.push(`provenance.json hashes to ${hash}, it says ${prov.provenanceHash}`)
  if (hash !== list.provenanceHash)
    problems.push(`provenance.json hashes to ${hash}, assignments.json says ${list.provenanceHash}`)
  if (flags['provenance-hash'] && hash !== flags['provenance-hash'].toLowerCase()) {
    problems.push(`provenance.json hashes to ${hash}, not the --provenance-hash you gave`)
  }
  if (prov.pieces.length !== list.supply)
    problems.push(`provenance has ${prov.pieces.length} pieces, supply is ${list.supply}`)
  if (list.confirmations !== CONFIRMATIONS)
    problems.push(`the list says ${list.confirmations} confirmations, the rule is ${CONFIRMATIONS}`)
  log(`provenance ${hash}: ${problems.length ? 'MISMATCH' : 'ok'}`)
  if (!pinned) {
    log('UNPINNED: provenance.json was checked only against the site\'s own files. Pass --provenance-hash <the hash in')
    log('the collection description, published before the mint> to check it is the one promised at launch.')
  }
  const listed = typeof list.address === 'string' ? list.address.toLowerCase() : undefined
  if (listed !== address) {
    problems.push(
      listed
        ? `the list is for ${list.address}, not the drop you named (${flags.address})`
        : `the list names no drop address${list.assignments.length ? `, yet it lists ${list.assignments.length} draw(s)` : ''}`
    )
    return report(problems, pinned)
  }

  // 2. The chain: every mint, the head, and each mint block's next header.
  const client = createPublicClient({
    transport: http(flags.rpc, { batch: { batchSize: 50 }, retryCount: 3, timeout: 30_000 }),
  })
  const chainId = await client.getChainId()
  if (chainId !== list.chainId) throw new Error(`The RPC is chain ${chainId}, the collection is on ${list.chainId}.`)
  const head = Number(await client.getBlockNumber())
  const mints = await allMints(client, address, BigInt(list.deployBlock), BigInt(head))
  const total = Number(
    await client.readContract({
      address,
      abi: [parseAbiItem('function totalSupply() view returns (uint256)')],
      functionName: 'totalSupply',
      blockNumber: BigInt(head),
    })
  )
  if (total !== mints.length) problems.push(`totalSupply is ${total}, but ${mints.length} mint logs were found`)
  log(`${mints.length} mint(s) on chain up to block ${head}`)

  const wanted = [...new Set(mints.map((m) => m.block + 1))].filter((b) => b <= head)
  const headers = new Map()
  await pool(wanted, 8, async (n) => {
    const b = await client.getBlock({ blockNumber: BigInt(n) })
    headers.set(n, { number: Number(b.number), hash: b.hash, parentHash: b.parentHash, mixHash: b.mixHash })
  })

  // 3. Every draw again, in token order.
  const res = checkDraws({ supply: list.supply, mints, headers, head, published: list.assignments })
  problems.push(...res.problems)
  for (const a of list.assignments) {
    if (typeof a.salt !== 'string' || !/^[0-9a-f]{64}$/.test(a.salt))
      problems.push(`token ${a.token}: no salt published`)
  }
  log(`${res.checked} draw(s) redone and compared; ${res.pending} minted token(s) drawable but not listed yet`)
  const notYet = mints.filter((m) => m.block + CONFIRMATIONS > head).length
  if (notYet) log(`${notYet} token(s) are within ${CONFIRMATIONS} blocks of the head: not drawn yet, by the rule`)

  // 4. Optionally, the files themselves: from the site, an Arweave manifest, or wherever tokenURI points.
  const content = flags.content ?? (base ? 'all' : undefined)
  if (content) {
    const n = content === 'all' ? Infinity : Number(content)
    if (!(n > 0)) throw new Error('--content is a number of tokens or "all".')
    const pick = n === Infinity ? list.assignments : list.assignments.slice(-n)
    const where = !base ? 'the site' : base.chain ? 'tokenURI on chain' : base.uri
    const tokenUri = async (t) => {
      if (!base) return `${site}/${t}`
      if (!base.chain) return `${base.uri}${t}`
      return client.readContract({ address, abi: TOKEN_URI_ABI, functionName: 'tokenURI', args: [BigInt(t)] })
    }
    const gateway = (uri) => (uri.startsWith('ar://') ? `${gatewayUrl}/${uri.slice(5)}` : uri)
    const get = async (uri) => {
      const res = await fetch(gateway(uri), { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`${uri} answered ${res.status}`)
      return res
    }
    let ok = 0
    await pool(pick, 8, async (a) => {
      const want = prov.pieces[a.piece - 1]
      try {
        const uri = await tokenUri(a.token)
        const meta = await (await get(uri)).json()
        const metaHash = await metadataHash(a.salt, storedFromServed(meta)).catch(() => undefined)
        if (metaHash !== want.metadata) return problems.push(`token ${a.token}: ${uri} is not piece ${a.piece}'s metadata`)
        if (meta.name !== tokenName(list.name, list.nameBy, a.token, a.piece)) {
          return problems.push(`token ${a.token}: named "${meta.name}"`)
        }
        const last = meta.attributes[meta.attributes.length - 1]
        if (last?.trait_type !== PIECE_TRAIT || last?.value !== a.piece) {
          return problems.push(`token ${a.token}: its last trait is not ${PIECE_TRAIT} ${a.piece}`)
        }
        if (typeof meta.image !== 'string') return problems.push(`token ${a.token}: no image link`)
        if (uri.startsWith('ar://') && !meta.image.startsWith('ar://')) {
          return problems.push(`token ${a.token}: the Arweave metadata's image is ${meta.image}, not on Arweave`)
        }
        if (a.arImage && meta.image.startsWith('ar://') && meta.image !== `ar://${a.arImage}`) {
          return problems.push(`token ${a.token}: image ${meta.image}, the list says ar://${a.arImage}`)
        }
        const img = await get(meta.image)
        const imgHash = await sha256Hex(new Uint8Array(await img.arrayBuffer()))
        if (imgHash !== want.image) return problems.push(`token ${a.token}: image is not piece ${a.piece}'s`)
        ok += 1
      } catch (e) {
        problems.push(`token ${a.token}: ${e.message}`)
      }
    })
    log(`${ok}/${pick.length} token(s) from ${where} serve their piece's exact metadata and image`)
  }
  return report(problems, pinned)
})

function report(problems, pinned) {
  for (const p of problems.slice(0, 50)) log(`MISMATCH ${p}`)
  if (problems.length > 50) log(`… and ${problems.length - 50} more`)
  if (problems.length) log(`FAILED: ${problems.length} problem(s)`)
  else log(`OK: every published draw matches the chain${pinned ? '' : ' (UNPINNED: no --provenance-hash given)'}`)
  return problems.length ? 1 : 0
}

/** --base: an ar:// or https:// folder (ending in /: tokenURI is base + id), or `chain` for tokenURI itself. */
function metadataBase(raw) {
  if (raw === 'chain') return { chain: true }
  if (!/^(ar|https?):\/\/\S+\/$/.test(raw)) {
    throw new Error('--base is ar://<manifest>/ or https://…/ (ending in /, as a baseURI), or `chain`.')
  }
  return { uri: raw }
}

/** Every Transfer from 0x0 of `address` in [from, to], narrowing the range when the RPC refuses a wide one. */
async function allMints(client, address, from, to) {
  const out = []
  let span = 50_000n
  for (let start = from; start <= to; ) {
    const end = start + span - 1n < to ? start + span - 1n : to
    let logs
    try {
      logs = await client.getLogs({
        address,
        event: TRANSFER,
        args: { from: ZERO },
        fromBlock: start,
        toBlock: end,
        strict: true,
      })
    } catch (e) {
      if (span === 1n) throw e
      span = span / 2n || 1n
      continue
    }
    for (const l of logs) {
      if (l.removed) throw new Error(`A removed log came back for block ${l.blockNumber}.`)
      out.push({ tokenId: Number(l.args.tokenId), block: Number(l.blockNumber), blockHash: l.blockHash.toLowerCase() })
    }
    start = end + 1n
  }
  return out.sort((a, b) => a.tokenId - b.tokenId)
}

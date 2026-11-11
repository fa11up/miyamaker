#!/usr/bin/env node
// Checks the Miyamaker reveal from the chain: every published draw is redone from the drop's mints and block headers
// with the published rule (api/_lib/revealdraw.mjs) and compared. Exits 1 on any mismatch, 0 when all agree.
// What collectors run; it needs nothing from us but the two public files.
//
//   node scripts/reveal/verify.mjs --rpc https://<an Ethereum RPC> \
//       [--site https://www.miyamaker.com/reveal/miyamaker]   (or --assignments <file> --provenance <file>)
//       [--provenance-hash <hex from the collection description>] [--content 50 | --content all]
//
// It checks: provenance.json hashes to its provenanceHash (and to --provenance-hash if given); the drop's Transfer-from-0x0
// logs are tokens 1..totalSupply with no gaps; for each listed token, the mint block, block B+1's mixHash (the seed),
// that B+1 follows B, and the drawn piece. --content also fetches tokens' metadata and images and checks their sha256
// against provenance.json. Reading logs from the deploy block needs an RPC that allows wide eth_getLogs ranges (it
// narrows the range on errors) and, for totalSupply at a past block, an archive node.
import { createPublicClient, http, parseAbiItem } from 'viem'

import { CONFIRMATIONS } from '../../api/_lib/revealdraw.mjs'
import { provenanceHash, sha256Hex, storedFromServed } from '../../api/_lib/revealpiece.mjs'
import { checkDraws, log, parseArgs, pool, readJson, run } from './lib.mjs'

const flags = parseArgs(process.argv.slice(2), {
  rpc: 'value',
  site: 'value',
  assignments: 'value',
  provenance: 'value',
  'provenance-hash': 'value',
  content: 'value',
})
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const ZERO = '0x0000000000000000000000000000000000000000'

run(async () => {
  if (!flags.rpc) throw new Error('--rpc <Ethereum RPC URL> is required.')
  const site = (flags.site ?? 'https://www.miyamaker.com/reveal/miyamaker').replace(/\/+$/, '')
  const list = await readJson(flags.assignments ?? `${site}/assignments.json`)
  const prov = await readJson(flags.provenance ?? `${site}/provenance.json`)
  const problems = []

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
  if (!list.address) {
    log('the collection has no drop address yet: nothing on chain to check')
    return problems.length ? report(problems) : 0
  }

  // 2. The chain: every mint, the head, and each mint block's next header.
  const client = createPublicClient({
    transport: http(flags.rpc, { batch: { batchSize: 50 }, retryCount: 3, timeout: 30_000 }),
  })
  const chainId = await client.getChainId()
  if (chainId !== list.chainId) throw new Error(`The RPC is chain ${chainId}, the collection is on ${list.chainId}.`)
  const head = Number(await client.getBlockNumber())
  const mints = await allMints(client, list.address, BigInt(list.deployBlock), BigInt(head))
  const total = Number(
    await client.readContract({
      address: list.address,
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
  log(`${res.checked} draw(s) redone and compared; ${res.pending} minted token(s) drawable but not listed yet`)
  const notYet = mints.filter((m) => m.block + CONFIRMATIONS > head).length
  if (notYet) log(`${notYet} token(s) are within ${CONFIRMATIONS} blocks of the head: not drawn yet, by the rule`)

  // 4. Optionally, the files themselves.
  if (flags.content) {
    const pick = flags.content === 'all' ? list.assignments : list.assignments.slice(-Number(flags.content))
    let ok = 0
    await pool(pick, 8, async (a) => {
      const want = prov.pieces[a.piece - 1]
      const meta = await (await fetch(`${site}/${a.token}`)).json()
      const metaHash = await sha256Hex(storedFromServed(meta))
      if (metaHash !== want.metadata) return problems.push(`token ${a.token}: metadata is not piece ${a.piece}'s`)
      const img = await fetch(gateway(meta.image))
      const imgHash = await sha256Hex(new Uint8Array(await img.arrayBuffer()))
      if (imgHash !== want.image) return problems.push(`token ${a.token}: image is not piece ${a.piece}'s`)
      ok += 1
    })
    log(`${ok}/${pick.length} token(s) serve their piece's exact metadata and image`)
  }
  return report(problems)
})

function report(problems) {
  for (const p of problems.slice(0, 50)) log(`MISMATCH ${p}`)
  if (problems.length > 50) log(`… and ${problems.length - 50} more`)
  log(problems.length ? `FAILED: ${problems.length} problem(s)` : 'OK: every published draw matches the chain')
  return problems.length ? 1 : 0
}

const gateway = (uri) => (uri.startsWith('ar://') ? `https://arweave.net/${uri.slice(5)}` : uri)

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

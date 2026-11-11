// Plans a refresh of a live drop's phases: new holder lists for its free claim phases, without anyone who has already
// claimed, each free cap set to what is left, and the public phase's token prices set from today's market. It READS
// ONLY and SENDS NOTHING: it prints a setPhases call for the owner to check and send themselves.
//
//   node scripts/refresh-phases.mts --drop 0x… [--block finalized|latest|<n>] [--keep-passed-on] [--publish]
//
// WHY CLAIMERS ARE LEFT OFF: setPhases replaces every phase and bumps phasesEpoch. The drop keys every per-wallet count
// and every phase's sold count by that epoch, so after it every wallet's count starts again at 0. A wallet that claimed
// its free piece and is still on the new list could claim again. So the new lists leave out every wallet that ever
// claimed in a list phase of the same collection (any epoch), and, unless --keep-passed-on, every wallet now holding a
// token a claimer held at the old list's block (so a claimer can't hand the token on and claim through a second wallet).
// The PUBLIC phase's per-wallet limit starts again too: a wallet that hit it can buy that many again.
//
// If only the prices need to change, don't use setPhases at all: setPhasePrices(phaseId, prices) changes one phase's
// prices and keeps every count. This script prints that call too.
//
// --publish writes the new lists to public/allowlists/ and src/miyamints/snapshots.ts. Deploy the site with them
// BEFORE sending setPhases: until miya serves a list, nobody on it can get a proof.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { Abi, Address, Hex, PublicClient } from 'viem'
import { decodeEventLog, encodeFunctionData, formatEther, getAddress, parseAbiItem, zeroAddress } from 'viem'

import type { AllowlistFile, AllowlistSource } from '../api/_lib/allowlist.ts'
import { buildTree, readDump } from '../api/_lib/allowlist.ts'
import { contractHolders, publishList, readHolders } from './allowlist-snapshot.mts'
import { APP, args, client, pinBlock, rpcHost, rpcUrl, short } from './lib/chain.mts'
import { ethEquivalents, fmt, IMD, IMDUSD, INFER, roundPrice } from './lib/prices.mts'

const DROP_ABI = JSON.parse(readFileSync(`${APP}../contracts/abi/ERC721DropInstance.json`, 'utf8')) as Abi
const DROP_FACTORY: Address = '0x9E3b21f6e0aE6068E9b7cB3B07579cC4af28EAfd'
const DROP_CREATED = parseAbiItem(
  'event DropCreated(address indexed drop, address indexed creator, address indexed vault, uint16 protocolBps, uint16 alignmentBps)'
)
const OWNER_MINT = (1n << 256n) - 1n
const ZERO_ROOT = `0x${'0'.repeat(64)}`
const LOG_CHUNK = 10_000n

type TokenPrice = { token: Address; price: bigint }
type Phase = { start: bigint; end: bigint; maxPerWallet: number; merkleRoot: Hex; supplyCap: number; prices: TokenPrice[] }

async function logsInChunks(c: PublicClient, address: Address, from: bigint, to: bigint) {
  const out = []
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to
    out.push(...(await c.getLogs({ address, fromBlock: a, toBlock: b })))
  }
  return out
}

/** A list file: this checkout's public/allowlists first, then the live site. */
async function loadList(root: string, site: string): Promise<AllowlistFile | undefined> {
  const local = `${APP}public/allowlists/${root}.json`
  if (existsSync(local)) return readDump(JSON.parse(readFileSync(local, 'utf8')))
  try {
    const r = await fetch(`${site}/allowlists/${root}.json`)
    return r.ok ? readDump(await r.json()) : undefined
  } catch {
    return undefined
  }
}

const read = <T,>(c: PublicClient, address: Address, functionName: string, blockNumber: bigint, args?: unknown[]) =>
  c.readContract({ address, abi: DROP_ABI, functionName, args, blockNumber }) as Promise<T>

async function main() {
  const o = args()
  if (!o.drop) {
    console.error('usage: node scripts/refresh-phases.mts --drop 0x… [--block n] [--keep-passed-on] [--publish]')
    process.exit(2)
  }
  const url = rpcUrl()
  const c = client(url)
  const drop = getAddress(o.drop)
  const site = o.site || 'https://www.miyamaker.com'
  const block = await pinBlock(c, o.block)
  const out: string[] = []
  const say = (s = '') => {
    out.push(s)
    console.log(s)
  }
  say(`Refresh plan for drop ${drop} at block ${block.number} (${new Date(Number(block.timestamp) * 1000).toISOString()}), RPC ${rpcHost(url)}`)
  say('READ ONLY: nothing below has been sent.')

  const [phases, sold, epoch, owner, totalSupply, maxSupply, reserve, ownerMinted, publicRemaining] = await Promise.all([
    read<Phase[]>(c, drop, 'phases', block.number),
    read<bigint[]>(c, drop, 'phasesMinted', block.number),
    read<bigint>(c, drop, 'phasesEpoch', block.number),
    read<Address>(c, drop, 'owner', block.number),
    read<bigint>(c, drop, 'totalSupply', block.number),
    read<number>(c, drop, 'maxSupply', block.number),
    read<number>(c, drop, 'ownerReserve', block.number),
    read<bigint>(c, drop, 'ownerMinted', block.number),
    read<bigint>(c, drop, 'publicRemaining', block.number),
  ])
  say(`owner ${owner}; epoch ${epoch}; minted ${totalSupply}/${maxSupply}; reserve ${reserve} (${ownerMinted} used); phases can still sell ${publicRemaining}`)

  // Every PhasesSet and Minted since the drop was made, in order: each Minted belongs to the phase list before it.
  const created = await c.getLogs({ address: DROP_FACTORY, event: DROP_CREATED, args: { drop }, fromBlock: 26388865n, toBlock: block.number })
  if (!created[0]) throw new Error('DropCreated not found for this drop on the miyamints factory')
  const logs = await logsInChunks(c, drop, created[0].blockNumber as bigint, block.number)
  const lists: Phase[][] = []
  const claims: { root: string; to: Address; tx: Hex; block: bigint; epoch: number }[] = []
  let publicSoldAll = 0n
  for (const log of logs) {
    let ev: { eventName: string; args: Record<string, unknown> }
    try {
      ev = decodeEventLog({ abi: DROP_ABI, data: log.data, topics: log.topics }) as unknown as typeof ev
    } catch {
      continue
    }
    if (ev.eventName === 'PhasesSet') lists.push(ev.args.phases as Phase[])
    if (ev.eventName !== 'Minted') continue
    const phaseId = ev.args.phaseId as bigint
    if (phaseId === OWNER_MINT) continue
    const ph = lists[lists.length - 1]?.[Number(phaseId)]
    if (!ph) continue
    if (ph.merkleRoot === ZERO_ROOT) publicSoldAll += ev.args.quantity as bigint
    else claims.push({ root: ph.merkleRoot.toLowerCase(), to: ev.args.to as Address, tx: log.transactionHash as Hex, block: log.blockNumber as bigint, epoch: lists.length })
  }
  if (BigInt(lists.length) !== epoch) say(`WARNING: saw ${lists.length} PhasesSet events but phasesEpoch is ${epoch}.`)

  // Who claimed: the drop checks the proof against msg.sender (the payer). A transaction sent straight to the drop:
  // that is tx.from. One through a contract (a Safe, a batcher): mint() mints to msg.sender, so `to` if it is on the
  // list; a contract's mintTo to someone else can't be told from the log, and is reported unresolved.
  const files = new Map<string, AllowlistFile | undefined>()
  for (const r of new Set([...claims.map((x) => x.root), ...phases.filter((p) => p.merkleRoot !== ZERO_ROOT).map((p) => p.merkleRoot.toLowerCase())])) {
    files.set(r, await loadList(r, site))
  }
  const onList = (root: string, a: string) => !!files.get(root)?.values.some((v) => v.value[0].toLowerCase() === a.toLowerCase())
  const claimersBySource = new Map<string, Set<string>>()
  let unresolved = 0
  for (const cl of claims) {
    const tx = await c.getTransaction({ hash: cl.tx })
    const direct = tx.to?.toLowerCase() === drop.toLowerCase()
    const payer = direct ? tx.from : onList(cl.root, cl.to) ? cl.to : undefined
    const src = files.get(cl.root)?.miya?.source?.contract?.toLowerCase() ?? cl.root
    if (!payer) {
      unresolved += 1
      continue
    }
    const set = claimersBySource.get(src) ?? new Set<string>()
    set.add(payer.toLowerCase())
    claimersBySource.set(src, set)
  }
  say(`claims in list phases (all epochs): ${claims.length}; claimers found: ${[...claimersBySource.values()].reduce((a, s) => a + s.size, 0)}; unresolved: ${unresolved}`)

  // The new phase list, phase by phase.
  const next: Phase[] = []
  const notes: string[] = []
  const outDir = o.out || `${APP}scripts/out`
  mkdirSync(outDir, { recursive: true })
  for (const [i, ph] of phases.entries()) {
    const soldNow = sold[i] ?? 0n
    const cap = BigInt(ph.supplyCap)
    const left = cap === 0n ? 0n : cap > soldNow ? cap - soldNow : 0n
    if (ph.merkleRoot === ZERO_ROOT) {
      // Public: cap what is left of it, and token prices from today's market against its ETH price.
      const ethPrice = ph.prices.find((p) => p.token === zeroAddress)?.price
      let prices = ph.prices
      if (ethPrice !== undefined && ethPrice > 0n) {
        const e = await ethEquivalents(c, ethPrice, block.number)
        const fresh: Record<string, bigint> = { [IMDUSD.toLowerCase()]: roundPrice(e.imdUSD), [IMD.toLowerCase()]: roundPrice(e.imd), [INFER.toLowerCase()]: roundPrice(e.infer) }
        prices = ph.prices.map((p) => ({ token: p.token, price: fresh[p.token.toLowerCase()] ?? p.price }))
        say(`phase ${i} (public): ${formatEther(ethPrice)} ETH = ${fmt(e.imdUSD)} imdUSD, ${fmt(e.imd)} IMD, ${fmt(e.infer)} INFER at spot (ETH $${e.ethUsd.toFixed(2)})`)
        for (const p of prices) say(`    ${p.token}: ${fmt(ph.prices.find((x) => x.token === p.token)?.price)} -> ${fmt(p.price)}`)
      }
      say(`    sold this epoch ${soldNow}; cap ${cap === 0n ? 'none' : `${cap} -> ${left}`}`)
      next.push({ ...ph, supplyCap: Number(left), prices })
      continue
    }

    // A list phase: a new snapshot of the same collection, without claimers.
    const file = files.get(ph.merkleRoot.toLowerCase())
    const source = file?.miya?.source
    if (!source) {
      say(`phase ${i} (list ${ph.merkleRoot}): no holder snapshot behind this list, so it is kept as it is (cap ${cap} -> ${left}).`)
      notes.push(`Phase ${i}'s list is kept: its wallets that already claimed can claim again after setPhases.`)
      next.push({ ...ph, supplyCap: Number(left) })
      continue
    }
    const contract = source.contract as Address
    const [lo, hi] = source.idsRead.split('-').map((x) => BigInt(x)) as [bigint, bigint]
    say(`phase ${i} (${source.name}): reading holders of ${contract} at block ${block.number}…`)
    const now = await readHolders(c, contract, lo, hi, block.number)
    const claimed = claimersBySource.get(contract.toLowerCase()) ?? new Set<string>()
    const excluded = new Set(claimed)
    let passedOn = 0
    if (!o['keep-passed-on'] && claimed.size) {
      // Tokens the claimers held at the old list's block, and who holds them now.
      const then = await readHolders(c, contract, lo, hi, BigInt(source.block))
      for (const [id, holder] of then.owners) {
        if (!claimed.has(holder)) continue
        const nowHolder = now.owners.get(id)
        if (nowHolder && !excluded.has(nowHolder)) {
          excluded.add(nowHolder)
          passedOn += 1
        }
      }
    }
    const addresses = [...now.holders.keys()].filter((a) => !excluded.has(a)).sort()
    if (!addresses.length) {
      say(`    nobody left on the list: phase ${i} is dropped from the plan`)
      continue
    }
    const contracts = await contractHolders(c, addresses, block.number)
    const tree = buildTree(addresses)
    const newSource: AllowlistSource = {
      ...source,
      block: Number(block.number),
      blockTime: Number(block.timestamp),
      tokens: now.owners.size,
      contracts: contracts.length,
    }
    writeFileSync(`${outDir}/refresh-${drop.slice(0, 8)}-${i}-${block.number}.txt`, `${addresses.map((a) => getAddress(a)).join('\n')}\n`)
    if (o.publish) publishList(tree, newSource)
    say(`    holders now ${now.holders.size}; left off: ${claimed.size} claimers + ${passedOn} holding a claimer's token${o['keep-passed-on'] ? ' (not checked: --keep-passed-on)' : ''}`)
    say(`    new list ${addresses.length} wallets, root ${tree.root}; cap ${cap} - sold ${soldNow} -> ${left}`)
    if (cap === 0n) notes.push(`Phase ${i} had no cap: it still has none, so the free claims are limited only by the public supply.`)
    next.push({ ...ph, merkleRoot: tree.root, supplyCap: Number(left) })
  }

  const listLeft = next.filter((p) => p.merkleRoot !== ZERO_ROOT).reduce((a, p) => a + BigInt(p.supplyCap), 0n)
  const pub = next.find((p) => p.merkleRoot === ZERO_ROOT)
  if (pub && pub.supplyCap && BigInt(pub.supplyCap) + listLeft > publicRemaining) {
    notes.push(`The caps (${pub.supplyCap} public + ${listLeft} free) are more than the ${publicRemaining} pieces phases can still sell: the free spots are not all held back.`)
  }
  const calldata = encodeFunctionData({ abi: DROP_ABI, functionName: 'setPhases', args: [next] })
  say('')
  say('setPhases(...) to send from the owner, to the drop:')
  say(`  to:   ${drop}`)
  say(`  from: ${owner} (only the owner can)`)
  say(`  data: ${calldata}`)
  for (const [i, p] of next.entries()) {
    say(`  phase ${i}: ${p.merkleRoot === ZERO_ROOT ? 'public' : `list ${p.merkleRoot}`}, start ${p.start}, end ${p.end}, ${p.maxPerWallet || 'no'} per wallet, cap ${p.supplyCap || 'none'}, prices ${p.prices.map((x) => `${x.token.slice(0, 8)}=${fmt(x.price)}`).join(' ')}`)
  }
  for (const [i, p] of next.entries()) {
    if (p.merkleRoot !== ZERO_ROOT) continue
    say(`If ONLY the public prices should change (every count kept), send instead: setPhasePrices(${i}, ...)`)
    say(`  data: ${encodeFunctionData({ abi: DROP_ABI, functionName: 'setPhasePrices', args: [BigInt(i), p.prices] })}`)
  }
  say('')
  say('Before sending setPhases, know what it does:')
  say('  - It REPLACES every phase and starts every count again: every wallet can mint its per-wallet limit again in')
  say('    every phase, public included, and each phase\'s sold count goes back to 0 (so the caps above are what is left).')
  say('  - That is why wallets that already claimed are left off the new lists. A claim made after this plan was read')
  say('    (after the block above) is not counted: read again right before sending.')
  say('  - "Holding a claimer\'s token" uses what the claimer held at the OLD list\'s block, not at the moment they')
  say('    claimed; a token bought after that block and passed on is not followed.')
  say(`  - Unresolved claims (${unresolved}): mintTo sent by a contract wallet; that wallet is not left off. Check them by hand.`)
  say('  - Deploy the site with the new public/allowlists files first (--publish), or nobody on a new list can get a proof.')
  for (const n of notes) say(`  - ${n}`)
  writeFileSync(`${outDir}/refresh-${drop.slice(0, 8)}-${block.number}.txt`, `${out.join('\n')}\n`)
}

main().catch((e) => {
  console.error(short(e))
  process.exit(1)
})

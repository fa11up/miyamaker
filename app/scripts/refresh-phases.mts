// Plans a refresh of a live drop's phases: new holder lists for its free claim phases, without anyone who has already
// claimed, each cap set to what is left, and the public phase's token prices set from today's market. It READS ONLY and
// SENDS NOTHING: it prints a setPhases call for the owner to check and send themselves.
//
//   node scripts/refresh-phases.mts --drop 0x… [--block latest|finalized|<n>] [--previous <claimers.json>]
//        [--keep-passed-on] [--check-contracts] [--publish] [--allow-unreadable-list] [--no-previous-record]
//        [--pause-lists | --paused-at <tx hash>]
//
// WHO CLAIMED is read from the drop itself, not from event logs (the keyed RPC's plan allows eth_getLogs over 10
// blocks only): mintedInPhase(phase, wallet) for every wallet on each list phase's list, at the pinned block (default
// 'latest', so the plan is as fresh as it can be; re-read right before sending). The drop counts against the wallet
// that PAID (msg.sender), the same wallet the proof was checked for, so mintTo is covered. A wallet that minted any
// number in a list phase is left off, also when its limit was more than 1 and it used only part of it.
//
// WHY CLAIMERS ARE LEFT OFF: setPhases replaces every phase and bumps phasesEpoch. The drop keys every per-wallet count
// and every phase's sold count by that epoch, so after it every wallet's count starts again at 0. A wallet that claimed
// its free piece and is still on the new list could claim again. So the new lists leave out every wallet that ever
// claimed in a list phase of the same collection (any epoch), and, unless --keep-passed-on, every wallet now holding a
// token a claimer held at the old list's block (so a claimer can't hand the token on and claim through a second wallet).
// The PUBLIC phase's per-wallet limit starts again too: a wallet that hit it can buy that many again.
//
// EARLIER EPOCHS: counts only cover the current phase list. Who was left off before is kept in each list this script
// publishes (miya.refresh and miya.excluded in public/allowlists/<root>.json) and read back from there next time, and
// in scripts/out/refresh-claimers-<drop>-<block>.json (pass it as --previous if the published files are not at hand).
// From the second phase list on, the script stops when neither says who claimed before (--no-previous-record accepts
// that those wallets may be listed again). Every list file must load and match its phase's root, or the script stops
// (--allow-unreadable-list keeps such a phase as it is instead).
//
// CAPS: a capped phase gets what is left of its cap. One whose cap is used up is LEFT OUT of the plan: the drop reads
// supplyCap 0 as "no cap", so it is never sent as 0. Leaving phases out renumbers the ones after them (printed).
//
// THE RACE, AND THE TWO-STEP THAT CLOSES IT: a claim made after the plan's block and before setPhases lands is not
// counted, and that wallet stays on the new list. To close that gap:
//   1. --pause-lists prints a setPhases that keeps every phase but ends the list phases (start 1, end 2), with what
//      is left of each cap. Send it. No list claims can happen after it.
//   2. --paused-at <its tx hash> reads the claims at the block before it landed (plus any claim in its own block before
//      it, from that one block's logs), builds the lists, and plans the setPhases that reopens them.
//
// If only the prices need to change, don't use setPhases at all: setPhasePrices(phaseId, prices) changes one phase's
// prices and keeps every count. This script prints that call too, with the phase's number as it is on chain now.
//
// --publish writes the new lists to public/allowlists/ and adds them to src/miyamints/snapshots.ts under their own
// name ("Milady holders (drop 0x1234ab refresh 1)"), never replacing the collection's general holder list. Deploy the
// site with them BEFORE sending setPhases: until miya serves a list, nobody on it can get a proof.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { Abi, AbiEvent, Address, Hash, Hex, PublicClient } from 'viem'
import { encodeFunctionData, formatEther, getAddress, parseAbiItem, toEventSelector, zeroAddress } from 'viem'

import type { AllowlistDump, AllowlistFile, AllowlistSource } from '../api/_lib/allowlist.ts'
import { buildTree, readDump } from '../api/_lib/allowlist.ts'
import { BURN, contractHolders, publishList, readAllHolders } from './allowlist-snapshot.mts'
import { APP, args, client, pinBlock, rpcHost, rpcUrl, short } from './lib/chain.mts'
import { ethEquivalents, fmt, IMD, IMDUSD, INFER, roundPrice } from './lib/prices.mts'
import type { ClaimersRecord, ListPhase } from './lib/refresh.mts'
import { assertCaps, carriedExclusions, fileFits, nextCap, refreshEntryName } from './lib/refresh.mts'

const DROP_ABI = JSON.parse(readFileSync(`${APP}../contracts/abi/ERC721DropInstance.json`, 'utf8')) as Abi
const ZERO_ROOT = `0x${'0'.repeat(64)}`
const MINTED = parseAbiItem(
  'event Minted(address indexed to, uint256 indexed phaseId, uint256 firstId, uint256 quantity, address token, uint256 paid)'
)
const PHASES_SET = toEventSelector(DROP_ABI.find((x) => x.type === 'event' && x.name === 'PhasesSet') as AbiEvent)

type TokenPrice = { token: Address; price: bigint }
type Phase = { start: bigint; end: bigint; maxPerWallet: number; merkleRoot: Hex; supplyCap: number; prices: TokenPrice[] }
type Planned = { from: number; was: number; phase: Phase }

const isList = (p: Phase) => p.merkleRoot.toLowerCase() !== ZERO_ROOT

/** A list file: this checkout's public/allowlists first, then the live site. Never a guess: why it couldn't load. */
async function loadList(root: string, site: string): Promise<{ file: AllowlistFile } | { why: string }> {
  const local = `${APP}public/allowlists/${root}.json`
  let raw: unknown
  if (existsSync(local)) {
    try {
      raw = JSON.parse(readFileSync(local, 'utf8'))
    } catch (e) {
      return { why: `public/allowlists/${root}.json doesn't read (${short(e)})` }
    }
  } else {
    try {
      const r = await fetch(`${site}/allowlists/${root}.json`)
      if (!r.ok) return { why: `not in public/allowlists, and ${site} answered ${r.status}` }
      if (!(r.headers.get('content-type') || '').includes('json')) return { why: `not in public/allowlists, nor on ${site}` }
      raw = await r.json()
    } catch (e) {
      return { why: `not in public/allowlists, and ${site} couldn't be read (${short(e)})` }
    }
  }
  const file = readDump(raw)
  if (!file) return { why: 'the file is not a list' }
  if (!fileFits(file, root)) return { why: `the file's tree is for root ${file.tree[0]}, not this one` }
  return { file }
}

const read = <T,>(c: PublicClient, address: Address, functionName: string, blockNumber: bigint, args?: unknown[]) =>
  c.readContract({ address, abi: DROP_ABI, functionName, args, blockNumber }) as Promise<T>

async function readDrop(c: PublicClient, drop: Address, block: bigint) {
  const [phases, sold, epoch, owner, totalSupply, maxSupply, reserve, ownerMinted, publicRemaining] = await Promise.all([
    read<Phase[]>(c, drop, 'phases', block),
    read<bigint[]>(c, drop, 'phasesMinted', block),
    read<bigint>(c, drop, 'phasesEpoch', block),
    read<Address>(c, drop, 'owner', block),
    read<bigint>(c, drop, 'totalSupply', block),
    read<number>(c, drop, 'maxSupply', block),
    read<number>(c, drop, 'ownerReserve', block),
    read<bigint>(c, drop, 'ownerMinted', block),
    read<bigint>(c, drop, 'publicRemaining', block),
  ])
  return { phases, sold, epoch, owner, totalSupply, maxSupply, reserve, ownerMinted, publicRemaining }
}

async function main() {
  const o = args()
  if (!o.drop) {
    console.error('usage: node scripts/refresh-phases.mts --drop 0x… [--block n] [--previous file] [--pause-lists | --paused-at 0x…] [--publish]')
    process.exit(2)
  }
  if (o['pause-lists'] && o['paused-at']) throw new Error('--pause-lists is step 1 and --paused-at step 2: pass one.')
  const url = rpcUrl()
  const c = client(url)
  const drop = getAddress(o.drop)
  const site = o.site || 'https://www.miyamaker.com'
  const block = await pinBlock(c, o.block || 'latest')
  const out: string[] = []
  const say = (s = '') => {
    out.push(s)
    console.log(s)
  }
  const outDir = o.out || `${APP}scripts/out`
  mkdirSync(outDir, { recursive: true })
  say(`Refresh plan for drop ${drop} at block ${block.number} (${new Date(Number(block.timestamp) * 1000).toISOString()}), RPC ${rpcHost(url)}`)
  say('READ ONLY: nothing below has been sent.')

  const now = await readDrop(c, drop, block.number)
  say(`owner ${now.owner}; phase list (epoch) ${now.epoch}; minted ${now.totalSupply}/${now.maxSupply}; reserve ${now.reserve} (${now.ownerMinted} used); phases can still sell ${now.publicRemaining}`)
  say(`phasesMinted() = [${now.sold.join(', ')}]`)
  const recheck = `cast call ${drop} "phasesMinted()(uint256[])" --rpc-url "$RPC_URL_1"`

  if (o['pause-lists']) {
    // Step 1: every phase kept, list phases ended, each cap what is left of it.
    const plan: Planned[] = []
    for (const [i, ph] of now.phases.entries()) {
      if (isList(ph)) {
        plan.push({ from: i, was: ph.supplyCap, phase: { ...ph, start: 1n, end: 2n } })
        say(`phase ${i} (list ${ph.merkleRoot.slice(0, 10)}…): ended (start 1, end 2), root and cap kept`)
        continue
      }
      const nc = nextCap(ph.supplyCap, now.sold[i] ?? 0n)
      say(`phase ${i} (public): ${nc.words}`)
      if (nc.keep) plan.push({ from: i, was: ph.supplyCap, phase: { ...ph, supplyCap: nc.cap } })
    }
    assertCaps(plan)
    printSetPhases(say, drop, now.owner, plan)
    say('')
    say('STEP 1 of 2. After it lands, run:')
    say(`  node scripts/refresh-phases.mts --drop ${drop} --paused-at <its tx hash> [--publish]`)
    say('It also starts every count again (every phase, public included), like any setPhases.')
    writeFileSync(`${outDir}/refresh-pause-${drop.slice(0, 8)}-${block.number}.txt`, `${out.join('\n')}\n`)
    return
  }

  // Where the claims are read: this block, or (step 2) the block before the pause landed.
  let claimsBlock = block.number
  let claims = now
  const lateClaims: { phase: number; wallets: string[]; quantity: bigint }[] = []
  if (o['paused-at']) {
    const hash = o['paused-at'] as Hash
    const receipt = await c.getTransactionReceipt({ hash })
    const tx = await c.getTransaction({ hash })
    if (receipt.status !== 'success') throw new Error(`${hash} did not succeed: nothing was paused.`)
    if (tx.to?.toLowerCase() !== drop.toLowerCase()) throw new Error(`${hash} was not sent to the drop.`)
    if (!receipt.logs.some((l) => l.address.toLowerCase() === drop.toLowerCase() && l.topics[0] === PHASES_SET)) {
      throw new Error(`${hash} did not set the drop's phases.`)
    }
    claimsBlock = receipt.blockNumber - 1n
    claims = await readDrop(c, drop, claimsBlock)
    if (now.epoch !== claims.epoch + 1n) {
      throw new Error(`The phases were replaced again after ${hash} (phase list ${claims.epoch} -> ${now.epoch}): run step 1 again.`)
    }
    // Claims in the pause's own block, before it: eth_getLogs over that one block (the keyed plan allows it).
    const minted = await c.getLogs({ address: drop, event: MINTED, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber })
    for (const l of minted) {
      if (l.transactionIndex >= receipt.transactionIndex) continue
      const phase = Number(l.args.phaseId)
      if (!claims.phases[phase] || !isList(claims.phases[phase] as Phase)) continue
      const payer = (await c.getTransaction({ hash: l.transactionHash })).from
      lateClaims.push({ phase, wallets: [payer, l.args.to as string], quantity: l.args.quantity ?? 0n })
    }
    say(`--paused-at ${hash}: landed in block ${receipt.blockNumber}; claims read at block ${claimsBlock} (phase list ${claims.epoch}), ${lateClaims.length} more claim(s) in block ${receipt.blockNumber} before it`)
    say(`phasesMinted() at block ${claimsBlock} = [${claims.sold.join(', ')}]`)
  }

  // Every list file must load and be the list its phase points at.
  const files = new Map<number, AllowlistFile>()
  const unreadable: string[] = []
  for (const [i, ph] of claims.phases.entries()) {
    if (!isList(ph)) continue
    const got = await loadList(ph.merkleRoot.toLowerCase(), site)
    if ('file' in got) files.set(i, got.file)
    else unreadable.push(`phase ${i} (list ${ph.merkleRoot}): ${got.why}`)
  }
  if (unreadable.length) {
    for (const u of unreadable) say(`CAN'T READ ${u}`)
    if (!o['allow-unreadable-list']) {
      throw new Error("A list file couldn't be read, so its claimers can't be: stopped. Fix it, or pass --allow-unreadable-list to keep such a phase as it is.")
    }
  }
  const lists: ListPhase[] = [...files.entries()]
    .filter(([, f]) => f.miya?.source)
    .map(([phase, file]) => ({ phase, root: file.tree[0] as string, source: (file.miya?.source?.contract as string).toLowerCase(), file }))

  // Who was left off before: the published lists' own records, or --previous.
  let previous: ClaimersRecord | undefined
  if (o.previous) previous = JSON.parse(readFileSync(o.previous, 'utf8')) as ClaimersRecord
  const { carried, notes: recordNotes } = carriedExclusions({
    drop,
    epoch: claims.epoch,
    lists,
    previous,
    previousName: o.previous,
    noRecordOk: !!o['no-previous-record'],
  })
  for (const n of recordNotes) say(`note: ${n}`)
  const carriedCount = [...carried.values()].reduce((n, s) => n + s.size, 0)
  if (carriedCount) say(`${carriedCount} wallets left off before are carried over`)

  // Who claimed in this phase list: mintedInPhase for every wallet on each list phase's list.
  const claimersBySource = new Map<string, Set<string>>()
  const addClaimer = (src: string, a: string) => {
    const set = claimersBySource.get(src.toLowerCase()) ?? new Set<string>()
    set.add(a.toLowerCase())
    claimersBySource.set(src.toLowerCase(), set)
  }
  const soldList = new Map<number, bigint>()
  for (const [i, file] of files) {
    const ph = claims.phases[i] as Phase
    const src = file.miya?.source?.contract ?? ph.merkleRoot
    const wallets = file.values.map((v) => v.value[0])
    let found = 0
    for (let k = 0; k < wallets.length; k += 500) {
      const slice = wallets.slice(k, k + 500)
      const res = await c.multicall({
        contracts: slice.map((w) => ({ address: drop, abi: DROP_ABI, functionName: 'mintedInPhase', args: [BigInt(i), w] })),
        allowFailure: false,
        blockNumber: claimsBlock,
        batchSize: 0,
      })
      res.forEach((n, j) => {
        if ((n as bigint) > 0n) {
          addClaimer(src, slice[j] as string)
          found += 1
        }
      })
    }
    let sold = claims.sold[i] ?? 0n
    for (const l of lateClaims.filter((x) => x.phase === i)) {
      for (const w of l.wallets) addClaimer(src, w)
      sold += l.quantity
    }
    soldList.set(i, sold)
    say(`phase ${i} (${file.miya?.source?.name ?? 'pasted list'}): ${found} wallets on the list have claimed (sold ${claims.sold[i] ?? 0n})`)
    if (ph.maxPerWallet > 1) say(`    its limit is ${ph.maxPerWallet} per wallet: a wallet that used only part of it is left off all the same`)
    if (BigInt(found) > (claims.sold[i] ?? 0n)) say(`    WARNING: more claimers than pieces sold in phase ${i}: check the list file is the right one.`)
  }

  // The new phase list, phase by phase (the current phases; in step 2 a list phase takes back what it was before).
  const plan: Planned[] = []
  const notes: string[] = []
  const pending: { tree: AllowlistDump & { root: Hex }; source: AllowlistSource; excluded: string[] }[] = []
  const claimsLists = claims.phases.map((p, i) => ({ p, i })).filter((x) => isList(x.p))
  let k = 0
  const liveFromEpoch = Number(now.epoch) + 1
  for (const [i, cur] of now.phases.entries()) {
    if (!isList(cur)) {
      const soldNow = now.sold[i] ?? 0n
      const nc = nextCap(cur.supplyCap, soldNow)
      if (!nc.keep) {
        say(`phase ${i} (public): ${nc.words}`)
        continue
      }
      // Public: token prices from today's market against its ETH price.
      const ethPrice = cur.prices.find((p) => p.token === zeroAddress)?.price
      let prices = cur.prices
      if (ethPrice !== undefined && ethPrice > 0n) {
        const e = await ethEquivalents(c, ethPrice, block.number)
        const fresh: Record<string, bigint> = { [IMDUSD.toLowerCase()]: roundPrice(e.imdUSD), [IMD.toLowerCase()]: roundPrice(e.imd), [INFER.toLowerCase()]: roundPrice(e.infer) }
        prices = cur.prices.map((p) => ({ token: p.token, price: fresh[p.token.toLowerCase()] ?? p.price }))
        say(`phase ${i} (public): ${formatEther(ethPrice)} ETH = ${fmt(e.imdUSD)} imdUSD, ${fmt(e.imd)} IMD, ${fmt(e.infer)} INFER at spot (ETH $${e.ethUsd.toFixed(2)})`)
        for (const p of prices) say(`    ${p.token}: ${fmt(cur.prices.find((x) => x.token === p.token)?.price)} -> ${fmt(p.price)}`)
        for (const n of e.notes) say(`    ${n}`)
      } else say(`phase ${i} (public)`)
      say(`    sold this phase list ${soldNow}; ${nc.words}`)
      plan.push({ from: i, was: cur.supplyCap, phase: { ...cur, supplyCap: nc.cap, prices } })
      continue
    }

    // A list phase. In step 2 it is the k-th list phase from before the pause, with that phase's times.
    const before = o['paused-at'] ? claimsLists[k] : { p: cur, i }
    k += 1
    if (!before || before.p.merkleRoot.toLowerCase() !== cur.merkleRoot.toLowerCase()) {
      throw new Error(`phase ${i}'s list is not the one it had before the pause: run step 1 again.`)
    }
    const ph = before.p
    const soldNow = soldList.get(before.i) ?? claims.sold[before.i] ?? 0n
    const nc = nextCap(ph.supplyCap, soldNow)
    if (!nc.keep) {
      say(`phase ${i} (list ${ph.merkleRoot.slice(0, 10)}…): ${nc.words}`)
      continue
    }
    const file = files.get(before.i)
    const source = file?.miya?.source
    if (!source) {
      say(`phase ${i} (list ${ph.merkleRoot}): ${file ? 'a pasted list' : 'unreadable (--allow-unreadable-list)'}, so it is kept as it is (${nc.words}).`)
      notes.push(`Phase ${i}'s list is kept: its wallets that already claimed can claim again after setPhases.`)
      plan.push({ from: i, was: ph.supplyCap, phase: { ...ph, supplyCap: nc.cap } })
      continue
    }
    const contract = source.contract as Address
    const src = contract.toLowerCase()
    const oldHi = BigInt(source.idsRead.split('-')[1] ?? '0')
    say(`phase ${i} (${source.name}): reading holders of ${contract} at block ${block.number}…`)
    const held = await readAllHolders(c, contract, block.number, { atLeastTo: oldHi })
    const claimed = new Set([...(claimersBySource.get(src) ?? []), ...(carried.get(src) ?? [])])
    const excluded = new Set(claimed)
    let passedOn = 0
    if (!o['keep-passed-on'] && claimed.size) {
      // Tokens the claimers held at the old list's block, and who holds them now.
      const then = await readAllHolders(c, contract, BigInt(source.block), { atLeastTo: oldHi })
      for (const [id, holder] of then.owners) {
        if (!claimed.has(holder)) continue
        const nowHolder = held.owners.get(id)
        if (nowHolder && !excluded.has(nowHolder)) {
          excluded.add(nowHolder)
          passedOn += 1
        }
      }
    }
    const addresses = [...held.holders.keys()].filter((a) => !excluded.has(a) && !BURN.has(a)).sort()
    if (!addresses.length) {
      say(`    nobody left on the list: phase ${i} is left out of the plan`)
      continue
    }
    // One eth_getCode per wallet is slow for thousands of holders, so it is opt-in: the count is only for the report.
    const contracts = o['check-contracts'] ? await contractHolders(c, addresses, block.number) : []
    const tree = buildTree(addresses)
    const newSource: AllowlistSource = {
      ...source,
      block: Number(block.number),
      blockTime: Number(block.timestamp),
      idsRead: `${held.from}-${held.to}`,
      tokens: held.owners.size,
      contracts: o['check-contracts'] ? contracts.length : source.contracts,
    }
    writeFileSync(`${outDir}/refresh-${drop.slice(0, 8)}-${i}-${block.number}.txt`, `${addresses.map((a) => getAddress(a)).join('\n')}\n`)
    pending.push({ tree, source: newSource, excluded: [...excluded].sort() })
    say(`    holders now ${held.holders.size}; left off: ${claimed.size} who claimed (this list and before) + ${passedOn} holding a claimer's token${o['keep-passed-on'] ? ' (not checked: --keep-passed-on)' : ''}`)
    say(`    new list ${addresses.length} wallets, root ${tree.root}; ${nc.words}`)
    if (ph.supplyCap === 0) notes.push(`Phase ${i} had no cap: it still has none, so the free claims are limited only by the public supply.`)
    plan.push({ from: i, was: ph.supplyCap, phase: { ...ph, merkleRoot: tree.root, supplyCap: nc.cap } })
  }
  assertCaps(plan)

  const listLeft = plan.filter((p) => isList(p.phase)).reduce((a, p) => a + BigInt(p.phase.supplyCap), 0n)
  const pub = plan.find((p) => !isList(p.phase))
  if (pub && pub.phase.supplyCap && BigInt(pub.phase.supplyCap) + listLeft > now.publicRemaining) {
    notes.push(`The caps (${pub.phase.supplyCap} public + ${listLeft} free) are more than the ${now.publicRemaining} pieces phases can still sell: the free spots are not all held back.`)
  }

  // Who was left off is written down BEFORE any list is published, so a published list always has its record.
  const excludedBySource = new Map<string, Set<string>>()
  for (const [src, set] of [...carried, ...claimersBySource]) {
    excludedBySource.set(src, new Set([...(excludedBySource.get(src) ?? []), ...set]))
  }
  for (const p of pending) {
    const src = p.source.contract.toLowerCase()
    excludedBySource.set(src, new Set([...(excludedBySource.get(src) ?? []), ...p.excluded]))
  }
  const claimersFile = `${outDir}/refresh-claimers-${drop.slice(0, 8)}-${block.number}.json`
  const record: ClaimersRecord = {
    drop,
    block: Number(block.number),
    epoch: Number(claims.epoch),
    liveFromEpoch,
    excluded: Object.fromEntries([...excludedBySource].map(([k2, v]) => [k2, [...v].sort()])),
    claimers: Object.fromEntries([...claimersBySource].map(([k2, v]) => [k2, [...v].sort()])),
  }
  writeFileSync(claimersFile, JSON.stringify(record, null, 1))
  if (o.publish) {
    for (const p of pending) {
      publishList(p.tree, p.source, {
        entryName: refreshEntryName(p.source.name, drop, liveFromEpoch),
        miya: { refresh: { drop, liveFromEpoch, block: Number(block.number) }, excluded: p.excluded },
      })
      say(`published public/allowlists/${p.tree.root}.json as "${refreshEntryName(p.source.name, drop, liveFromEpoch)}"`)
    }
  }

  printSetPhases(say, drop, now.owner, plan)
  for (const p of plan) {
    if (isList(p.phase)) continue
    // setPhasePrices is sent INSTEAD of setPhases, so it names the phase as it is on chain now.
    say(`If ONLY the public prices should change (every count kept), send instead: setPhasePrices(${p.from}, ...)`)
    say(`  data: ${encodeFunctionData({ abi: DROP_ABI, functionName: 'setPhasePrices', args: [BigInt(p.from), p.phase.prices] })}`)
  }
  say('')
  say('Before sending setPhases, know what it does:')
  say('  - It REPLACES every phase and starts every count again: every wallet can mint its per-wallet limit again in')
  say('    every phase, public included, and each phase\'s sold count goes back to 0 (so the caps above are what is left).')
  say('  - That is why wallets that already claimed are left off the new lists, also those that used only part of a')
  say('    limit above 1. A claim made after the block above is not counted: right before sending, check')
  say(`    ${recheck}`)
  say(`    still prints [${now.sold.join(', ')}], or run this again. To close that gap for good, use the two steps:`)
  say('    --pause-lists, send it, then --paused-at <its tx hash>.')
  say('  - "Holding a claimer\'s token" uses what the claimer held at the OLD list\'s block, not at the moment they')
  say('    claimed; a token bought after that block and passed on is not followed.')
  say(`  - Who was left off is recorded in the published lists (read back next time) and in ${claimersFile}.`)
  say('  - Deploy the site with the new public/allowlists files first (--publish), or nobody on a new list can get a proof.')
  for (const n of notes) say(`  - ${n}`)
  writeFileSync(`${outDir}/refresh-${drop.slice(0, 8)}-${block.number}.txt`, `${out.join('\n')}\n`)
}

function printSetPhases(say: (s?: string) => void, drop: Address, owner: Address, plan: readonly Planned[]) {
  const phases = plan.map((p) => p.phase)
  say('')
  say('setPhases(...) to send from the owner, to the drop:')
  say(`  to:   ${drop}`)
  say(`  from: ${owner} (only the owner can)`)
  say(`  data: ${encodeFunctionData({ abi: DROP_ABI, functionName: 'setPhases', args: [phases] })}`)
  for (const [i, p] of phases.entries()) {
    say(`  phase ${i}: ${isList(p) ? `list ${p.merkleRoot}` : 'public'}, start ${p.start}, end ${p.end}, ${p.maxPerWallet || 'no'} per wallet, cap ${p.supplyCap || 'none'}, prices ${p.prices.map((x) => `${x.token.slice(0, 8)}=${fmt(x.price)}`).join(' ')}`)
  }
  const moved = plan.map((p, i) => ({ from: p.from, to: i })).filter((m) => m.from !== m.to)
  if (moved.length) {
    say(`  PHASE NUMBERS CHANGE (phases left out): ${moved.map((m) => `${m.from} -> ${m.to}`).join(', ')}. Anything that names a phase by number must use the new one after this.`)
  }
}

main().catch((e) => {
  console.error(short(e))
  process.exit(1)
})

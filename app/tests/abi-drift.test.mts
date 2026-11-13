// The app's hand-written contract ABIs must match the contracts. Run: yarn test
//
// Compares every function, event and error in src/miyamints/abi.ts, src/music/abi.ts, src/pages/Auction/miyamints/abi.ts,
// src/pages/Swap/nft/abi.ts, src/pages/Mint/dropAbi.ts (the live mint), src/pages/Launch/launchAbi.ts and
// src/utils/batchCalls.ts (instanceAddressAbi)
// with the committed ABI snapshots in contracts/abi/*.json (regenerate with contracts/script/export-abis.sh after
// changing a contract's interface; see contracts/DEPLOY.md). A wrong parameter list encodes calldata the contract
// doesn't recognise (or decodes the wrong fields), so a mismatch here means a call that reverts or misreads on chain.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { test } from 'node:test'

// The ABI files import each other through the app's `@/` alias (vite / tsconfig paths); resolve it here.
const SRC = new URL('../src/', import.meta.url)
// registerHooks is Node 22.15+; the repo's @types/node (18) doesn't declare it yet, so it is typed here.
type ResolveContext = Record<string, unknown>
type Resolve = (specifier: string, context: ResolveContext) => unknown
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: { resolve: (specifier: string, context: ResolveContext, next: Resolve) => unknown }) => void
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, SRC).href, context)
    return next(specifier, context)
  },
})

type Param = { type: string; name?: string; indexed?: boolean; components?: readonly Param[] }
type Item = {
  type: string
  name?: string
  inputs?: readonly Param[]
  outputs?: readonly Param[]
  stateMutability?: string
}

const ABI_DIR = new URL('../../contracts/abi/', import.meta.url)
const contracts: Record<string, Item[]> = Object.fromEntries(
  readdirSync(ABI_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(new URL(f, ABI_DIR), 'utf8')) as Item[]])
)

const miyamints = await import('../src/miyamints/abi.ts')
const music = await import('../src/music/abi.ts')
const nft = await import('../src/pages/Swap/nft/abi.ts')
const auction = await import('../src/pages/Auction/miyamints/abi.ts')
const liveMint = await import('../src/pages/Mint/dropAbi.ts')
const launch = await import('../src/pages/Launch/launchAbi.ts')
const batchCalls = await import('../src/utils/batchCalls.ts')

/** Which contract each app ABI talks to. Generic ERC-20/721/1155 reads are checked against our own collections. */
const MAP: [label: string, abi: readonly Item[], contract: string][] = [
  ['miyamints dropFactoryAbi', miyamints.dropFactoryAbi, 'ERC721DropFactory'],
  ['miyamints dropInstanceAbi', miyamints.dropInstanceAbi, 'ERC721DropInstance'],
  ['miyamints auctionFactoryAbi', miyamints.auctionFactoryAbi, 'ERC721AuctionFactory'],
  ['miyamints auctionInstanceAbi', miyamints.auctionInstanceAbi, 'ERC721AuctionInstance'],
  ['miyamints editionsManageAbi', miyamints.editionsManageAbi, 'ERC1155Instance'],
  ['miyamints registryAbi', miyamints.registryAbi, 'MiyaRegistry'],
  ['miyamints vaultAbi', miyamints.vaultAbi, 'UniAlignmentVault'],
  ['auction mmAuctionAbi', auction.mmAuctionAbi, 'ERC721AuctionInstance'],
  ['music erc1155FactoryAbi', music.erc1155FactoryAbi, 'ERC1155Factory'],
  ['music erc1155InstanceAbi', music.erc1155InstanceAbi, 'ERC1155Instance'],
  ['music miyaRegistryAbi', music.miyaRegistryAbi, 'MiyaRegistry'],
  ['nft poolFactoryAbi', nft.poolFactoryAbi, 'MiyaPoolFactory'],
  ['nft poolAbi', nft.poolAbi, 'MiyaPool'],
  ['nft poolVaultAbi', nft.poolVaultAbi, 'UniAlignmentVault'],
  ['nft vaultConfigAbi', nft.vaultConfigAbi, 'UniAlignmentVaultFactory'],
  ['nft erc721Abi', nft.erc721Abi, 'ERC721DropInstance'],
  ['nft erc1155Abi', nft.erc1155Abi, 'ERC1155Instance'],
  ['live mint dropAbi', liveMint.dropAbi, 'ERC721DropInstance'],
  ['launch auctionFirstAbi', launch.auctionFirstAbi, 'ERC721AuctionInstance'],
  ['launch editionIdsAbi', launch.editionIdsAbi, 'ERC1155Instance'],
  ['launch instanceAddressAbi (auctions)', batchCalls.instanceAddressAbi, 'ERC721AuctionFactory'],
  ['launch instanceAddressAbi (editions)', batchCalls.instanceAddressAbi, 'ERC1155Factory'],
]

/** Canonical ABI type, tuples expanded: `(uint64,uint64)[]`. */
const typeOf = (p: Param): string =>
  p.type.startsWith('tuple') ? `(${(p.components ?? []).map(typeOf).join(',')})${p.type.slice(5)}` : p.type
const list = (ps: readonly Param[] = []) => ps.map(typeOf).join(',')
const sig = (i: Item) => `${i.name}(${list(i.inputs)})`
const eventSig = (i: Item) =>
  `${i.name}(${(i.inputs ?? []).map((p) => `${typeOf(p)}${p.indexed ? ' indexed' : ''}`).join(',')})`
const readOnly = (m?: string) => m === 'view' || m === 'pure'

/** Fields named on both sides must agree: same types under a new name usually mean a new meaning (deploy/live read
 *  MiyaPool.commits' 4th field as `snapshot` after the contract made it `queueEnd`), and viem keys structs by name. */
/** Top-level argument names are positional and don't matter (`top = false` skips them); struct fields do. */
function renamed(app: readonly Param[] = [], chain: readonly Param[] = [], at = '', top = true): string[] {
  const out: string[] = []
  app.forEach((p, i) => {
    const c = chain[i]
    if (!c) return
    const where = `${at}${p.name || c.name || `#${i}`}`
    if (top && p.name && c.name && p.name !== c.name) out.push(`${at}${p.name} is ${c.name} on the contract`)
    if (p.components && c.components) out.push(...renamed(p.components, c.components, `${where}.`))
  })
  return out
}

/** Every mismatch between one app ABI and its contract, as readable lines. */
function drift(abi: readonly Item[], contract: Item[]): string[] {
  const out: string[] = []
  const all = Object.values(contracts).flat()
  for (const item of abi) {
    if (item.type === 'function') {
      const want = sig(item)
      const sameName = contract.filter((c) => c.type === 'function' && c.name === item.name)
      const match = sameName.find((c) => sig(c) === want)
      if (!match) {
        out.push(`function ${want}: not on the contract (contract has ${sameName.map(sig).join(' | ') || 'none'})`)
        continue
      }
      if (list(item.outputs) !== list(match.outputs)) {
        out.push(`function ${want}: returns (${list(item.outputs)}), contract returns (${list(match.outputs)})`)
      }
      for (const r of renamed(item.inputs, match.inputs, '', false)) out.push(`function ${want}: input ${r}`)
      for (const r of renamed(item.outputs, match.outputs)) out.push(`function ${want}: output ${r}`)
      const a = item.stateMutability
      const c = match.stateMutability
      // The app may call a payable function without value; anything else must agree.
      const ok = a === c || (readOnly(a) && readOnly(c)) || (a === 'nonpayable' && c === 'payable')
      if (!ok) out.push(`function ${want}: app says ${a}, contract is ${c}`)
    } else if (item.type === 'event') {
      const want = eventSig(item)
      const sameName = contract.filter((c) => c.type === 'event' && c.name === item.name)
      const match = sameName.find((c) => eventSig(c) === want)
      if (!match) {
        out.push(`event ${want}: not on the contract (contract has ${sameName.map(eventSig).join(' | ') || 'none'})`)
      } else {
        for (const r of renamed(item.inputs, match.inputs)) out.push(`event ${want}: field ${r}`)
      }
    } else if (item.type === 'error') {
      // Errors bubble up from the contracts a call reaches (a factory call reverts with registry errors), so any
      // snapshot may declare one.
      const want = sig(item)
      if (!all.some((c) => c.type === 'error' && sig(c) === want)) out.push(`error ${want}: no contract declares it`)
    }
  }
  return out
}

test('every contract the app maps to has a snapshot', () => {
  for (const [label, , contract] of MAP) assert.ok(contracts[contract], `${label}: no contracts/abi/${contract}.json`)
})

for (const [label, abi, contract] of MAP) {
  test(`${label} matches ${contract}`, () => {
    assert.ok(abi.length > 0)
    assert.deepEqual(drift(abi, contracts[contract]!), [], `${label} has drifted from contracts/abi/${contract}.json`)
  })
}

test('the drift check catches a stale parameter list', () => {
  // deploy/live's createDrop had no ownerReserve and its phases had no supplyCap.
  const stale = structuredClone(miyamints.dropFactoryAbi) as unknown as Item[]
  const params = stale.find((i) => i.name === 'createDrop')!.inputs![0] as unknown as { components: Param[] }
  params.components = params.components.filter((c) => c.name !== 'ownerReserve')
  const phases = params.components.find((c) => c.name === 'phases') as unknown as { components: Param[] }
  phases.components = phases.components.filter((c) => c.name !== 'supplyCap')
  const found = drift(stale, contracts.ERC721DropFactory!)
  assert.equal(found.length, 1)
  assert.match(found[0]!, /^function createDrop\(\(string,string,uint32,string,/)
})

test('the drift check catches a missing payment token argument', () => {
  // Before multi-token sales, mint took no token or maxCost and createBid took no amount.
  const stale = structuredClone(auction.mmAuctionAbi) as unknown as Item[]
  const bid = stale.find((i) => i.name === 'createBid')!
  ;(bid as unknown as { inputs: Param[] }).inputs = bid.inputs!.filter((p) => p.name !== 'amount')
  assert.deepEqual(drift(stale, contracts.ERC721AuctionInstance!), [
    'function createBid(uint24,string): not on the contract (contract has createBid(uint24,uint256,string))',
  ])
})

test('the drift check catches a renamed field of the same type', () => {
  // deploy/live's MiyaPool.commits returned `snapshot` where the contract now returns `queueEnd`.
  const stale = structuredClone(nft.poolAbi) as unknown as Item[]
  const commits = stale.find((i) => i.name === 'commits')!
  ;(commits.outputs as Param[])[3] = { ...commits.outputs![3]!, name: 'snapshot' }
  assert.deepEqual(drift(stale, contracts.MiyaPool!), [
    'function commits(uint256): output snapshot is queueEnd on the contract',
  ])
})

test('the drift check catches the v1 pool lookup and create (a mode argument)', () => {
  // MiyaPool v1 had one pool per (collection, mode); v2 has one per collection, created with its pick fees.
  const stale = structuredClone(nft.poolFactoryAbi) as unknown as Item[]
  const poolOf = stale.find((i) => i.name === 'poolOf')!
  ;(poolOf as unknown as { inputs: Param[] }).inputs = [...poolOf.inputs!, { type: 'uint8', name: 'mode' }]
  const create = stale.find((i) => i.name === 'createPool')!
  ;(create as unknown as { inputs: Param[] }).inputs = [create.inputs![0]!, { type: 'uint8', name: 'mode' }]
  assert.deepEqual(drift(stale, contracts.MiyaPoolFactory!), [
    'function poolOf(address,uint8): not on the contract (contract has poolOf(address))',
    'function createPool(address,uint8): not on the contract (contract has createPool(address,uint256,uint256))',
  ])
})

// @ts-check
/**
 * The per-mint reveal's draw: which piece of art each minted token gets. Anyone can redo it from chain data alone,
 * so this file is the whole rule, shared word for word by the Worker's cron (api/_lib/reveal.ts), the collectors'
 * verifier (scripts/reveal/verify.mjs) and `node --test` (tests/reveal-draw.test.mts).
 *
 * The pool starts as [1, 2, ..., supply]. Minted tokens are taken in ascending id order. Token t, minted in block B:
 *   seed  = prevrandao of block B+1 (its header's mixHash), as bytes32
 *   r     = uint256(keccak256(abi.encodePacked(bytes32 seed, uint256 t)))
 *   i     = r mod pool.length; piece = pool[i]; pool[i] = pool[last]; pool.pop()
 * A token is drawn only once block B+1 exists and block B + CONFIRMATIONS is mined.
 *
 * Why B+1: block B's own prevrandao is public before B is built, so a minter could time a mint for a piece they want.
 * B+1's comes from B's proposer's RANDAO reveal, which nobody else knows until B is out. That proposer does know it, so
 * a proposer minting in their own block can choose to include the mint or not: DRAW_RULE says so. Draws are written
 * CONFIRMATIONS (5) blocks deep, not at finality: a deeper reorg would leave a written draw that verify.mjs flags.
 *
 * Only viem's keccak, so the Worker and Node both load this exact file. Plain JS (JSDoc types) like
 * src/pages/MusicMaker/media/allow.js, so `node` runs it without a build.
 */
import { concatHex, keccak256, numberToHex } from 'viem'

export const CONFIRMATIONS = 5

/** The rule in words, published in provenance.json and assignments.json. */
export const DRAW_RULE = [
  'The pool starts as [1, 2, ..., supply] (piece numbers, in order).',
  'Minted token ids are processed in ascending order. For token t minted in block B:',
  'seed = prevrandao of block B+1 (the block header mixHash), as bytes32;',
  'r = uint256(keccak256(abi.encodePacked(bytes32 seed, uint256 t)));',
  'i = r mod pool.length; piece = pool[i]; pool[i] = pool[pool.length - 1]; pool.pop().',
  `A token is assigned only once block B+1 exists and block B+${CONFIRMATIONS} is mined, and is not redrawn after.`,
  `Limits: the proposer of block B knows B+1's prevrandao before B is out (it comes from their own RANDAO reveal), so`,
  'that proposer can choose whether a mint (their own, say) goes in B knowing what it would draw; nobody else can.',
  `Assignments are final to a depth of ${CONFIRMATIONS} blocks: a reorg deeper than that, before Ethereum finalizes,`,
  'could leave a written assignment disagreeing with the chain, which the verifier (scripts/reveal/verify.mjs) reports.',
].join(' ')

const HASH32 = /^0x[0-9a-f]{64}$/

/**
 * A 32-byte hex string (lower-cased), or throws. Seeds and block hashes go through this.
 * @param {unknown} value @param {string} [what]
 */
export function hash32(value, what = 'hash') {
  const s = typeof value === 'string' ? value.toLowerCase() : ''
  if (!HASH32.test(s)) throw new Error(`${what} is not 32 bytes of hex: ${String(value).slice(0, 80)}`)
  return /** @type {`0x${string}`} */ (s)
}

/**
 * r = uint256(keccak256(abi.encodePacked(bytes32 seed, uint256 tokenId))).
 * @param {string} seed
 * @param {number | bigint} tokenId
 */
export function drawNumber(seed, tokenId) {
  const t = BigInt(tokenId)
  if (t < 1n || t >= 2n ** 256n) throw new Error(`Token id out of range: ${t}`)
  return BigInt(keccak256(concatHex([hash32(seed, 'seed'), numberToHex(t, { size: 32 })])))
}

/**
 * @typedef {{ items: number[], at: Int32Array }} Pool
 * `items` is the pool in draw order; `at[piece]` is where that piece is in it (-1 once drawn).
 */

/** [1, 2, ..., supply]. @param {number} supply @returns {Pool} */
export function newPool(supply) {
  if (!Number.isInteger(supply) || supply < 1 || supply > 1_000_000) throw new Error(`Bad supply: ${supply}`)
  const items = Array.from({ length: supply }, (_, i) => i + 1)
  const at = new Int32Array(supply + 1).fill(-1)
  for (let i = 0; i < supply; i += 1) at[i + 1] = i
  return { items, at }
}

/** Removes pool[i], moving the last piece into its place. @param {Pool} pool @param {number} i */
function takeAt(pool, i) {
  const { items, at } = pool
  const piece = /** @type {number} */ (items[i])
  const last = /** @type {number} */ (items.pop())
  if (last !== piece) {
    items[i] = last
    at[last] = i
  }
  at[piece] = -1
  return piece
}

/**
 * Draws token `tokenId`'s piece and takes it out of the pool.
 * @param {Pool} pool @param {string} seed @param {number | bigint} tokenId
 */
export function draw(pool, seed, tokenId) {
  if (!pool.items.length) throw new Error('The pool is empty: more tokens than pieces.')
  const i = Number(drawNumber(seed, tokenId) % BigInt(pool.items.length))
  return takeAt(pool, i)
}

/**
 * Takes out a piece an earlier draw picked, exactly as that draw did: for rebuilding the pool from stored assignments
 * (in token order) without hashing them all again. Throws when the piece is not in the pool, i.e. the stored list is not
 * one the draw could have made.
 * @param {Pool} pool @param {number} piece
 */
export function takePiece(pool, piece) {
  const i = Number.isInteger(piece) && piece >= 1 && piece < pool.at.length ? pool.at[piece] : -1
  if (i === undefined || i < 0) throw new Error(`Piece ${piece} is not in the pool.`)
  return takeAt(pool, i)
}

/**
 * @typedef {{ tokenId: number, block: number, blockHash: string }} Mint
 * @typedef {{ number: number, hash: string, parentHash: string, mixHash: string }} Header
 * @typedef {{ tokenId: number, piece: number, seedBlock: number, seedBlockHash: string, seed: string }} Draw
 */

/**
 * The assignments chain data gives, from scratch: every token in `mints` whose block B has B+1 in `headers` and
 * B + CONFIRMATIONS <= head, in id order, stopping at the first one that can't be drawn yet (later ones depend on it).
 * Mints must be 1, 2, 3, ... with no gaps; block B+1 must name B's hash as its parent. Throws on anything else.
 * @param {number} supply
 * @param {Mint[]} mints
 * @param {Map<number, Header>} headers  block number -> header
 * @param {number} head  the newest block number
 * @returns {Draw[]}
 */
export function replay(supply, mints, headers, head) {
  const pool = newPool(supply)
  const sorted = [...mints].sort((a, b) => a.tokenId - b.tokenId)
  /** @type {Draw[]} */
  const out = []
  for (const [k, m] of sorted.entries()) {
    if (m.tokenId !== k + 1) throw new Error(`Mints skip from ${k} to ${m.tokenId}.`)
    if (m.block + CONFIRMATIONS > head) break
    const h = headers.get(m.block + 1)
    if (!h) break
    out.push(drawFor(pool, m, h))
  }
  return out
}

/**
 * One token's draw from its mint and the header of the block after it, checking the header is that block.
 * @param {Pool} pool @param {Mint} mint @param {Header} next @returns {Draw}
 */
export function drawFor(pool, mint, next) {
  if (next.number !== mint.block + 1) throw new Error(`Header ${next.number} is not block ${mint.block + 1}.`)
  if (hash32(next.parentHash, 'parentHash') !== hash32(mint.blockHash, 'mint block hash')) {
    throw new Error(`Block ${next.number} does not follow the block token ${mint.tokenId} was minted in (a reorg?).`)
  }
  const seed = hash32(next.mixHash, 'mixHash')
  return {
    tokenId: mint.tokenId,
    piece: draw(pool, seed, mint.tokenId),
    seedBlock: next.number,
    seedBlockHash: hash32(next.hash, 'block hash'),
    seed,
  }
}

/**
 * Holder lists the Launch window can use for an allowlist phase, without pasting anything. Each one is the holders of a
 * collection at one block, made by `node scripts/allowlist-snapshot.mts --publish`, which rewrites the list between the
 * markers below and writes public/allowlists/<root>.json (the file the proof route serves). Don't edit it by hand.
 *
 * Pure data, so node:test can load it.
 */
export type Snapshot = {
  /** What the list is, as the Launch window shows it: "Milady holders". */
  name: string
  chainId: number
  /** The collection whose holders were read. */
  contract: string
  /** The block the holders were read at, and its time (unix seconds). */
  block: number
  blockTime: number
  /** The Merkle root a phase is set to. */
  root: string
  /** Unique holders on the list. */
  count: number
  /** Holders that were contracts at the block, kept: a Safe can claim; a pool, vault or escrow can't, so its spots go unused. */
  contracts: number
}

export const SNAPSHOTS: readonly Snapshot[] = /* snapshots:start */[
  {
    "name": "identity.md holders",
    "chainId": 1,
    "contract": "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D",
    "block": 26397157,
    "blockTime": 1794466007,
    "root": "0x4cf1d03afd03ad1eec81b4bdf80d278f4c97325cca4d99c6ee247db42125b635",
    "count": 677,
    "contracts": 2
  },
  {
    "name": "Milady holders",
    "chainId": 1,
    "contract": "0x5Af0D9827E0c53E4799BB226655A1de152A425a5",
    "block": 26397157,
    "blockTime": 1794466007,
    "root": "0x7d3aed4a692f85fb53db65fc780e9019e44648e3a5b957df917cb82b38dbb24e",
    "count": 4507,
    "contracts": 64
  }
]/* snapshots:end */

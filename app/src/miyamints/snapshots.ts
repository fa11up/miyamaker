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
  /** Holders that were contracts at the block (kept: a Safe can claim, a pool or vault can't). */
  contracts: number
}

export const SNAPSHOTS: readonly Snapshot[] = /* snapshots:start */[
  {
    "name": "identity.md holders",
    "chainId": 1,
    "contract": "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D",
    "block": 26394607,
    "blockTime": 1794435287,
    "root": "0xfc037f4889d01f1746a2a76b492483cd3429cff84f615d56d334dabd6f19ff3c",
    "count": 790,
    "contracts": 5
  },
  {
    "name": "Milady holders",
    "chainId": 1,
    "contract": "0x5Af0D9827E0c53E4799BB226655A1de152A425a5",
    "block": 26394607,
    "blockTime": 1794435287,
    "root": "0x5f5cd079082ad84fab434be39d6c9de40c8f53d54494fabff60ddbef1442b1d1",
    "count": 5139,
    "contracts": 89
  }
]/* snapshots:end */

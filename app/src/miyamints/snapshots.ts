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
    "root": "0x27a82c5863b1eab7c401c358f98d48bd48d9ff57509c8df4b911975d8bb6a887",
    "count": 789,
    "contracts": 5
  },
  {
    "name": "Milady holders",
    "chainId": 1,
    "contract": "0x5Af0D9827E0c53E4799BB226655A1de152A425a5",
    "block": 26394607,
    "blockTime": 1794435287,
    "root": "0x05b6877e48cc9c2c63d6b436970fecf3a96fd361f23d8c825e56f6f7575e4a6a",
    "count": 5138,
    "contracts": 89
  }
]/* snapshots:end */

// The launch flow's own reads on a new collection (launchChain.ts). Its own file (no wagmi) so
// tests/abi-drift.test.mts can load it.

/** The auction's first piece is token 1: queued once `nextTokenId` has moved past it. */
export const auctionFirstAbi = [
  { type: 'function', name: 'nextTokenId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
] as const

export const editionIdsAbi = [
  { type: 'function', name: 'getAllEditionIds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256[]' }] },
] as const

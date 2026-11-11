/**
 * What the Auction window reads and sends on an ERC721AuctionInstance (contracts/src/factories/erc721), hand-copied:
 * the bid, settle and claim calls, the rules (bidIncrement, timeBuffer), the lot, the BidPlaced event for the history,
 * and every error those calls can revert with, so the dry run names them.
 */

const view = (name: string, type: string, inputs: { name?: string; type: string }[] = []) =>
  ({ type: 'function', name, stateMutability: 'view', inputs, outputs: [{ type }] }) as const

const auctionTuple = {
  type: 'tuple',
  components: [
    { name: 'tokenId', type: 'uint24' },
    { name: 'tokenURI', type: 'string' },
    { name: 'minBid', type: 'uint256' },
    { name: 'highBidder', type: 'address' },
    { name: 'highBid', type: 'uint256' },
    { name: 'startTime', type: 'uint40' },
    { name: 'endTime', type: 'uint40' },
    { name: 'settled', type: 'bool' },
  ],
} as const

const noArgs = (name: string) => ({ type: 'error', name, inputs: [] }) as const

export const mmAuctionAbi = [
  view('name', 'string'),
  view('owner', 'address'),
  view('nextTokenId', 'uint24'),
  view('bidIncrement', 'uint256'),
  view('timeBuffer', 'uint40'),
  view('protocolFeeBps', 'uint16'),
  view('alignmentBps', 'uint16'),
  view('escrowedWinner', 'address', [{ name: 'tokenId', type: 'uint24' }]),
  /** The one currency of this house's auctions: address(0) = ETH. */
  view('currency', 'address'),
  /** ERC-20 houses: outbid bids credited to a bidder, claimed with claimRefund(to). Always 0 for ETH. */
  view('refundOf', 'uint256', [{ name: 'bidder', type: 'address' }]),
  {
    type: 'function',
    name: 'getAuction',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint24' }],
    outputs: [auctionTuple],
  },
  {
    type: 'function',
    name: 'createBid',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokenId', type: 'uint24' },
      { name: 'amount', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimRefund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settleAuction',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint24' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reclaimUnsold',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint24' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimEscrowedToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint24' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'BidMessage',
    inputs: [
      { name: 'tokenId', type: 'uint24', indexed: true },
      { name: 'bidder', type: 'address', indexed: true },
      { name: 'message', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BidPlaced',
    inputs: [
      { name: 'tokenId', type: 'uint24', indexed: true },
      { name: 'bidder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  noArgs('AuctionDoesNotExist'),
  noArgs('AuctionNotStarted'),
  noArgs('AuctionAlreadySettled'),
  noArgs('AuctionNotEnded'),
  noArgs('AuctionExpired'),
  noArgs('BidBelowMinimum'),
  noArgs('BidTooLow'),
  noArgs('NoBids'),
  noArgs('HasBids'),
  noArgs('Unauthorized'),
  noArgs('SettlementGasTooLow'),
  noArgs('NotEscrowedWinner'),
  noArgs('WrongPayment'),
  noArgs('NothingToRefund'),
  noArgs('ShortTransfer'),
  noArgs('Reentrancy'),
] as const

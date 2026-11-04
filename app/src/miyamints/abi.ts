/**
 * Minimal ABIs for launching and managing collections on the miyamints contracts (contracts/src), hand-copied:
 * ERC721DropFactory / ERC721DropInstance (fixed-price drops), ERC721AuctionFactory / ERC721AuctionInstance
 * (1/1 auctions), MiyaRegistry and UniAlignmentVault reads. ERC1155 editions reuse src/music/abi.ts.
 */
import { erc1155FactoryAbi, erc1155InstanceAbi } from '@/music/abi'

export { erc1155FactoryAbi, erc1155InstanceAbi }

const view = (name: string, type: string, inputs: { name?: string; type: string }[] = []) =>
  ({ type: 'function', name, stateMutability: 'view', inputs, outputs: [{ type }] } as const)

const phaseComponents = [
  { name: 'start', type: 'uint64' },
  { name: 'end', type: 'uint64' },
  { name: 'price', type: 'uint128' },
  { name: 'maxPerWallet', type: 'uint32' },
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'supplyCap', type: 'uint32' },
] as const

const phaseTupleArray = {
  name: 'phases',
  type: 'tuple[]',
  internalType: 'struct ERC721DropInstance.Phase[]',
  components: phaseComponents,
} as const

export const dropFactoryAbi = [
  {
    type: 'function',
    name: 'createDrop',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct ERC721DropInstance.InitParams',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'maxSupply', type: 'uint32' },
          { name: 'ownerReserve', type: 'uint32' },
          { name: 'baseURI', type: 'string' },
          { name: 'unrevealedURI', type: 'string' },
          { name: 'contractURI', type: 'string' },
          { name: 'royaltyReceiver', type: 'address' },
          { name: 'royaltyBps', type: 'uint96' },
          phaseTupleArray,
        ],
      },
      { name: 'vault', type: 'address' },
      { name: 'alignmentBps', type: 'uint16' },
    ],
    outputs: [{ name: 'drop', type: 'address' }],
  },
  view('registry', 'address'),
  {
    type: 'event',
    name: 'DropCreated',
    inputs: [
      { name: 'drop', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'protocolBps', type: 'uint16', indexed: false },
      { name: 'alignmentBps', type: 'uint16', indexed: false },
    ],
  },
  { type: 'error', name: 'InvalidVault', inputs: [] },
  { type: 'error', name: 'InvalidAddress', inputs: [] },
  { type: 'error', name: 'InvalidAlignment', inputs: [] },
  { type: 'error', name: 'NotFactory', inputs: [] },
  { type: 'error', name: 'InvalidParams', inputs: [] },
] as const

export const dropInstanceAbi = [
  view('name', 'string'),
  view('symbol', 'string'),
  view('owner', 'address'),
  view('maxSupply', 'uint32'),
  view('totalSupply', 'uint256'),
  view('baseURI', 'string'),
  view('unrevealedURI', 'string'),
  view('contractURI', 'string'),
  view('metadataLocked', 'bool'),
  view('ownerReserve', 'uint32'),
  view('ownerMinted', 'uint256'),
  view('royaltyLocked', 'bool'),
  view('protocolBps', 'uint16'),
  view('alignmentBps', 'uint16'),
  view('vault', 'address'),
  view('pendingVaultCut', 'uint256'),
  {
    type: 'function',
    name: 'phases',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'tuple[]', components: phaseComponents }],
  },
  {
    type: 'function',
    name: 'setMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'baseURI_', type: 'string' },
      { name: 'unrevealedURI_', type: 'string' },
      { name: 'contractURI_', type: 'string' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'lockMetadata', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'lockRoyalty', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'setPhases',
    stateMutability: 'nonpayable',
    inputs: [{ ...phaseTupleArray, name: 'newPhases' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ownerMint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'quantity', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'claimVaultFees',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [
      { name: 'phaseId', type: 'uint256' },
      { name: 'quantity', type: 'uint256' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  { type: 'error', name: 'InvalidParams', inputs: [] },
  { type: 'error', name: 'PhaseNotActive', inputs: [] },
  { type: 'error', name: 'NotAllowlisted', inputs: [] },
  { type: 'error', name: 'WalletLimit', inputs: [] },
  { type: 'error', name: 'SoldOut', inputs: [] },
  { type: 'error', name: 'PhaseSoldOut', inputs: [] },
  { type: 'error', name: 'ReserveExceeded', inputs: [] },
  { type: 'error', name: 'WrongPayment', inputs: [] },
  { type: 'error', name: 'Locked', inputs: [] },
  { type: 'error', name: 'NothingToWithdraw', inputs: [] },
  { type: 'error', name: 'Unauthorized', inputs: [] },
] as const

export const auctionFactoryAbi = [
  {
    type: 'function',
    name: 'createInstance',
    stateMutability: 'payable',
    inputs: [
      { name: 'salt', type: 'bytes32' },
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct ERC721AuctionFactory.CreateParams',
        components: [
          { name: 'name', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'creator', type: 'address' },
          { name: 'vault', type: 'address' },
          { name: 'alignmentBps', type: 'uint16' },
          { name: 'symbol', type: 'string' },
          { name: 'lines', type: 'uint8' },
          { name: 'baseDuration', type: 'uint40' },
          { name: 'timeBuffer', type: 'uint40' },
          { name: 'bidIncrement', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'instance', type: 'address' }],
  },
  {
    type: 'event',
    name: 'InstanceCreated',
    inputs: [
      { name: 'instance', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'metadataURI', type: 'string', indexed: false },
      { name: 'protocolFeeBps', type: 'uint16', indexed: false },
      { name: 'alignmentBps', type: 'uint16', indexed: false },
    ],
  },
  { type: 'error', name: 'InvalidAddress', inputs: [] },
  { type: 'error', name: 'InvalidName', inputs: [] },
  { type: 'error', name: 'InvalidVault', inputs: [] },
  { type: 'error', name: 'NotCreator', inputs: [] },
  { type: 'error', name: 'InvalidAlignment', inputs: [] },
  { type: 'error', name: 'InvalidLines', inputs: [] },
  { type: 'error', name: 'InvalidDuration', inputs: [] },
  { type: 'error', name: 'InvalidTimeBuffer', inputs: [] },
  { type: 'error', name: 'InvalidBidIncrement', inputs: [] },
  { type: 'error', name: 'InvalidSymbol', inputs: [] },
] as const

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

export const auctionInstanceAbi = [
  view('name', 'string'),
  view('symbol', 'string'),
  view('owner', 'address'),
  view('nextTokenId', 'uint24'),
  view('lines', 'uint8'),
  view('baseDuration', 'uint40'),
  view('bidIncrement', 'uint256'),
  view('protocolFeeBps', 'uint16'),
  view('alignmentBps', 'uint16'),
  view('vault', 'address'),
  {
    type: 'function',
    name: 'getAuction',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint24' }],
    outputs: [auctionTuple],
  },
  {
    type: 'function',
    name: 'queuePiece',
    stateMutability: 'payable',
    inputs: [{ name: '_tokenURI', type: 'string' }],
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
    name: 'claimVaultFees',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'PieceQueued',
    inputs: [
      { name: 'tokenId', type: 'uint24', indexed: true },
      { name: 'line', type: 'uint8', indexed: true },
      { name: 'minBid', type: 'uint256', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
    ],
  },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'DepositRequired', inputs: [] },
  { type: 'error', name: 'URIRequired', inputs: [] },
  { type: 'error', name: 'AuctionNotEnded', inputs: [] },
  { type: 'error', name: 'AuctionAlreadySettled', inputs: [] },
  { type: 'error', name: 'HasBids', inputs: [] },
  { type: 'error', name: 'NoBids', inputs: [] },
  { type: 'error', name: 'NoFeesToClaim', inputs: [] },
] as const

/** Extra ERC1155Instance reads/writes used by Manage (the music ABI covers launch + mint). */
export const editionsManageAbi = [
  view('owner', 'address'),
  view('protocolFeeBps', 'uint16'),
  view('alignmentBps', 'uint16'),
  view('vault', 'address'),
  view('totalProceeds', 'uint256'),
  view('totalWithdrawn', 'uint256'),
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimVaultFees',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'error', name: 'NoFeesToClaim', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  { type: 'error', name: 'AmountMustBePositive', inputs: [] },
] as const

export const registryAbi = [
  view('instanceCount', 'uint256'),
  view('instances', 'address', [{ type: 'uint256' }]),
  view('factoryOf', 'address', [{ type: 'address' }]),
  view('vaultOf', 'address', [{ type: 'address' }]),
  view('isVault', 'bool', [{ type: 'address' }]),
  view('minAlignmentBps', 'uint16'),
  view('protocolFeeBps', 'uint16'),
  view('treasury', 'address'),
  {
    type: 'function',
    name: 'getTarget',
    stateMutability: 'view',
    inputs: [{ name: 'targetId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'active', type: 'bool' },
      { name: 'tokens', type: 'address[]' },
    ],
  },
] as const

export const vaultAbi = [view('alignmentToken', 'address'), view('alignmentTargetId', 'uint256')] as const

export const erc20SymbolAbi = [view('symbol', 'string')] as const

export const ownerAbi = [view('owner', 'address')] as const

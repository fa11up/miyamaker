/**
 * Minimal ABIs for music drops, hand-copied from contracts/src (ERC1155Factory, ERC1155Instance,
 * MiyaRegistry) plus the standard ERC-721/1155 metadata getters for third-party collections.
 */

const createParams = {
  name: 'params',
  type: 'tuple',
  internalType: 'struct ERC1155Factory.CreateParams',
  components: [
    { name: 'name', type: 'string' },
    { name: 'metadataURI', type: 'string' },
    { name: 'creator', type: 'address' },
    { name: 'vault', type: 'address' },
    { name: 'alignmentBps', type: 'uint16' },
    { name: 'styleUri', type: 'string' },
    { name: 'gatingModule', type: 'address' },
    {
      name: 'freeMint',
      type: 'tuple',
      internalType: 'struct FreeMintParams',
      components: [
        { name: 'allocation', type: 'uint256' },
        { name: 'scope', type: 'uint8' },
      ],
    },
  ],
} as const

export const erc1155FactoryAbi = [
  {
    type: 'function',
    name: 'createInstance',
    stateMutability: 'payable',
    inputs: [{ name: 'salt', type: 'bytes32' }, createParams],
    outputs: [{ name: 'instance', type: 'address' }],
  },
  { type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
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
  { type: 'error', name: 'UnapprovedComponent', inputs: [] },
  { type: 'error', name: 'InvalidName', inputs: [] },
  { type: 'error', name: 'InvalidVault', inputs: [] },
  { type: 'error', name: 'NotCreator', inputs: [] },
  { type: 'error', name: 'InvalidAlignment', inputs: [] },
  { type: 'error', name: 'NotFactory', inputs: [] },
] as const

export const miyaRegistryAbi = [
  { type: 'function', name: 'instanceCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'instances',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'factoryOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  { type: 'function', name: 'minAlignmentBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'protocolFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  {
    type: 'function',
    name: 'isVault',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const edition = {
  type: 'tuple',
  internalType: 'struct ERC1155Instance.Edition',
  components: [
    { name: 'id', type: 'uint256' },
    { name: 'pieceTitle', type: 'string' },
    { name: 'basePrice', type: 'uint256' },
    { name: 'supply', type: 'uint256' },
    { name: 'minted', type: 'uint256' },
    { name: 'metadataURI', type: 'string' },
    { name: 'pricingModel', type: 'uint8' },
    { name: 'priceIncreaseRate', type: 'uint256' },
    { name: 'openTime', type: 'uint256' },
  ],
} as const

export const erc1155InstanceAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'creator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'getAllEditionIds',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getEdition',
    stateMutability: 'view',
    inputs: [{ name: 'editionId', type: 'uint256' }],
    outputs: [edition],
  },
  {
    type: 'function',
    name: 'getCurrentPrice',
    stateMutability: 'view',
    inputs: [{ name: 'editionId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'addEdition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pieceTitle', type: 'string' },
      { name: 'basePrice', type: 'uint256' },
      { name: 'supply', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
      { name: 'pricingModel', type: 'uint8' },
      { name: 'priceIncreaseRate', type: 'uint256' },
      { name: 'openTime', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [
      { name: 'editionId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'gatingData', type: 'bytes32' },
      { name: 'message', type: 'string' },
      { name: 'maxCost', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'EditionAdded',
    inputs: [
      { name: 'editionId', type: 'uint256', indexed: true },
      { name: 'pieceTitle', type: 'string', indexed: false },
      { name: 'basePrice', type: 'uint256', indexed: false },
      { name: 'supply', type: 'uint256', indexed: false },
      { name: 'pricingModel', type: 'uint8', indexed: false },
    ],
  },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'InvalidTitle', inputs: [] },
  { type: 'error', name: 'InvalidPrice', inputs: [] },
  { type: 'error', name: 'EditionNotFound', inputs: [] },
  { type: 'error', name: 'EditionNotOpen', inputs: [] },
  { type: 'error', name: 'EditionSoldOut', inputs: [] },
  { type: 'error', name: 'ExceedsSupply', inputs: [] },
  { type: 'error', name: 'ExceedsMaxCost', inputs: [] },
  { type: 'error', name: 'InsufficientPayment', inputs: [] },
  { type: 'error', name: 'GatingCheckFailed', inputs: [] },
  { type: 'error', name: 'UnlimitedMustHaveZeroSupply', inputs: [] },
  { type: 'error', name: 'LimitedMustHavePositiveSupply', inputs: [] },
] as const

/** Standard metadata getters for any ERC-721 / ERC-1155 the listing is pointed at. */
export const tokenMetadataAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'uri',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
] as const

/**
 * Seaport (https://github.com/ProjectOpenSea/seaport) as used for in-app OpenSea fills. No runtime imports, so
 * `node --test` can load it (tests/markets.test.mts).
 *
 * Only the fulfil functions OpenSea's fulfillment_data returns for a single listing or offer are here. Struct
 * component names match Seaport's, which are also the keys of OpenSea's `transaction.input_data`, so the ABI drives
 * the conversion (`seaportArgs` in markets.ts). match* functions are left out on purpose: those fills link out.
 */

/** Seaport 1.6 and 1.5: same address on every chain (deterministic deploys). Anything else is refused. */
export const SEAPORT_ADDRESSES = [
  '0x0000000000000068F116a894984e2DB1123eB395', // 1.6
  '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC', // 1.5
] as const

/** Seaport's ConduitController: conduitKey → the conduit that moves tokens (what gets approved). */
export const CONDUIT_CONTROLLER = '0x00000000F9490004C11Cef243f5400493c00Ad63' as const

/** OpenSea's marketplace fee recipient (a consideration item on every OpenSea order). */
export const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1f0df003000390027140000faa719'

/** Seaport ItemType */
export const ITEM = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3, ERC721_CRITERIA: 4, ERC1155_CRITERIA: 5 } as const

const offerItem = [
  { name: 'itemType', type: 'uint8' },
  { name: 'token', type: 'address' },
  { name: 'identifierOrCriteria', type: 'uint256' },
  { name: 'startAmount', type: 'uint256' },
  { name: 'endAmount', type: 'uint256' },
] as const
const considerationItem = [...offerItem, { name: 'recipient', type: 'address' }] as const
const orderParameters = [
  { name: 'offerer', type: 'address' },
  { name: 'zone', type: 'address' },
  { name: 'offer', type: 'tuple[]', components: offerItem },
  { name: 'consideration', type: 'tuple[]', components: considerationItem },
  { name: 'orderType', type: 'uint8' },
  { name: 'startTime', type: 'uint256' },
  { name: 'endTime', type: 'uint256' },
  { name: 'zoneHash', type: 'bytes32' },
  { name: 'salt', type: 'uint256' },
  { name: 'conduitKey', type: 'bytes32' },
  { name: 'totalOriginalConsiderationItems', type: 'uint256' },
] as const
const order = [
  { name: 'parameters', type: 'tuple', components: orderParameters },
  { name: 'signature', type: 'bytes' },
] as const
const advancedOrder = [
  { name: 'parameters', type: 'tuple', components: orderParameters },
  { name: 'numerator', type: 'uint120' },
  { name: 'denominator', type: 'uint120' },
  { name: 'signature', type: 'bytes' },
  { name: 'extraData', type: 'bytes' },
] as const
const criteriaResolver = [
  { name: 'orderIndex', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'index', type: 'uint256' },
  { name: 'identifier', type: 'uint256' },
  { name: 'criteriaProof', type: 'bytes32[]' },
] as const
const fulfillmentComponent = [
  { name: 'orderIndex', type: 'uint256' },
  { name: 'itemIndex', type: 'uint256' },
] as const
const basicOrderParameters = [
  { name: 'considerationToken', type: 'address' },
  { name: 'considerationIdentifier', type: 'uint256' },
  { name: 'considerationAmount', type: 'uint256' },
  { name: 'offerer', type: 'address' },
  { name: 'zone', type: 'address' },
  { name: 'offerToken', type: 'address' },
  { name: 'offerIdentifier', type: 'uint256' },
  { name: 'offerAmount', type: 'uint256' },
  { name: 'basicOrderType', type: 'uint8' },
  { name: 'startTime', type: 'uint256' },
  { name: 'endTime', type: 'uint256' },
  { name: 'zoneHash', type: 'bytes32' },
  { name: 'salt', type: 'uint256' },
  { name: 'offererConduitKey', type: 'bytes32' },
  { name: 'fulfillerConduitKey', type: 'bytes32' },
  { name: 'totalOriginalAdditionalRecipients', type: 'uint256' },
  {
    name: 'additionalRecipients',
    type: 'tuple[]',
    components: [
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
  },
  { name: 'signature', type: 'bytes' },
] as const
const execution = [
  {
    name: 'item',
    type: 'tuple',
    components: [
      { name: 'itemType', type: 'uint8' },
      { name: 'token', type: 'address' },
      { name: 'identifier', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
  },
  { name: 'offerer', type: 'address' },
  { name: 'conduitKey', type: 'bytes32' },
] as const

const basic = (name: string) =>
  ({
    type: 'function',
    name,
    stateMutability: 'payable',
    inputs: [{ name: 'parameters', type: 'tuple', components: basicOrderParameters }],
    outputs: [{ name: 'fulfilled', type: 'bool' }],
  } as const)

export const seaportAbi = [
  basic('fulfillBasicOrder'),
  basic('fulfillBasicOrder_efficient_6GL6yc'),
  {
    type: 'function',
    name: 'fulfillOrder',
    stateMutability: 'payable',
    inputs: [
      { name: 'order', type: 'tuple', components: order },
      { name: 'fulfillerConduitKey', type: 'bytes32' },
    ],
    outputs: [{ name: 'fulfilled', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'fulfillAdvancedOrder',
    stateMutability: 'payable',
    inputs: [
      { name: 'advancedOrder', type: 'tuple', components: advancedOrder },
      { name: 'criteriaResolvers', type: 'tuple[]', components: criteriaResolver },
      { name: 'fulfillerConduitKey', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'fulfilled', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'fulfillAvailableOrders',
    stateMutability: 'payable',
    inputs: [
      { name: 'orders', type: 'tuple[]', components: order },
      { name: 'offerFulfillments', type: 'tuple[][]', components: fulfillmentComponent },
      { name: 'considerationFulfillments', type: 'tuple[][]', components: fulfillmentComponent },
      { name: 'fulfillerConduitKey', type: 'bytes32' },
      { name: 'maximumFulfilled', type: 'uint256' },
    ],
    outputs: [
      { name: 'availableOrders', type: 'bool[]' },
      { name: 'executions', type: 'tuple[]', components: execution },
    ],
  },
  {
    type: 'function',
    name: 'fulfillAvailableAdvancedOrders',
    stateMutability: 'payable',
    inputs: [
      { name: 'advancedOrders', type: 'tuple[]', components: advancedOrder },
      { name: 'criteriaResolvers', type: 'tuple[]', components: criteriaResolver },
      { name: 'offerFulfillments', type: 'tuple[][]', components: fulfillmentComponent },
      { name: 'considerationFulfillments', type: 'tuple[][]', components: fulfillmentComponent },
      { name: 'fulfillerConduitKey', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'maximumFulfilled', type: 'uint256' },
    ],
    outputs: [
      { name: 'availableOrders', type: 'bool[]' },
      { name: 'executions', type: 'tuple[]', components: execution },
    ],
  },
] as const

export type SeaportFunction = (typeof seaportAbi)[number]['name']

const seaportError = (name: string, ...types: string[]) =>
  ({ type: 'error', name, inputs: types.map((type, i) => ({ name: `arg${i}`, type })) } as const)

/**
 * The errors a fill can hit, so a refusal has a name instead of a bare selector. Kept apart from seaportAbi, which
 * planFill matches OpenSea's function name against: an error must never pass for a fill function. OrderAlreadyFilled was
 * decoded this way from a real second fill on a fork.
 */
export const seaportCallAbi = [
  ...seaportAbi,
  seaportError('OrderAlreadyFilled', 'bytes32'),
  seaportError('OrderIsCancelled', 'bytes32'),
  seaportError('OrderPartiallyFilled', 'bytes32'),
  seaportError('InvalidTime', 'uint256', 'uint256'),
  seaportError('NoSpecifiedOrdersAvailable'),
  seaportError('TokenTransferGenericFailure', 'address', 'address', 'address', 'uint256', 'uint256'),
  seaportError('InvalidSigner'),
  seaportError('InvalidSignature'),
  seaportError('BadSignatureV', 'uint8'),
  seaportError('BadContractSignature'),
  seaportError('InsufficientNativeTokensSupplied'),
  seaportError('InsufficientEtherSupplied'),
] as const

/** OpenSea's input_data keys that differ from Seaport's parameter names. */
export const INPUT_ALIASES: Record<string, string> = { advancedOrders: 'orders' }

export const conduitControllerAbi = [
  {
    type: 'function',
    name: 'getConduit',
    stateMutability: 'view',
    inputs: [{ name: 'conduitKey', type: 'bytes32' }],
    outputs: [
      { name: 'conduit', type: 'address' },
      { name: 'exists', type: 'bool' },
    ],
  },
] as const

/**
 * Seaport's OrderFulfilled event: one per order filled, emitted by Seaport itself. A batch (batch.ts) reads a fill from
 * these and from nothing else. A criteria item appears here with the token id the seller chose (checked on a fork).
 */
export const seaportEventsAbi = [
  {
    type: 'event',
    name: 'OrderFulfilled',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'offerer', type: 'address', indexed: true },
      { name: 'zone', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: false },
      {
        name: 'offer',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifier', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      {
        name: 'consideration',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifier', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
    ],
  },
] as const

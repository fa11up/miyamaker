import { parseAbi } from 'viem'

/** Hand-copied from contracts/src/pools/MiyaPoolFactory.sol (v2: one pool per collection, pick fee set at creation). */
export const poolFactoryAbi = parseAbi([
  'function vault() view returns (address)',
  'function imd() view returns (address)',
  'function infer() view returns (address)',
  'function allPoolsLength() view returns (uint256)',
  'function allPools(uint256) view returns (address)',
  'function poolOf(address collection) view returns (address)',
  'function createPool(address collection, uint256 imdFee, uint256 inferFee) returns (address pool)',
  'function predictPool(address collection, uint8 kind, uint256 imdFee, uint256 inferFee) view returns (address)',
  'event PoolCreated(address indexed collection, address indexed pool, uint8 kind, uint256 imdFee, uint256 inferFee, bool randomEnabled, address creator)',
  'error PoolExists(address pool)',
  'error UnsupportedCollection()',
  // From the pool's constructor, through createPool.
  'error NoVault()',
  'error FeeBelowVaultMinimum(address token, uint256 minimum)',
  'error FeeTokenNotAccepted(address token)',
])

/**
 * Hand-copied from contracts/src/pools/MiyaPool.sol (v2: random and pick redeems on one pool; picks pay a fee in IMD
 * or INFER that goes to the alignment vault), plus the ERC20 reads it inherits.
 */
export const poolAbi = parseAbi([
  'function collection() view returns (address)',
  'function kind() view returns (uint8)',
  'function randomEnabled() view returns (bool)',
  'function vault() view returns (address)',
  'function imd() view returns (address)',
  'function infer() view returns (address)',
  'function imdFee() view returns (uint256)',
  'function inferFee() view returns (uint256)',
  'function picksFree() view returns (bool)',
  'function pickFee(address token, uint256 units) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function heldUnits() view returns (uint256)',
  'function heldIdsCount() view returns (uint256)',
  'function heldIds(uint256 start, uint256 count) view returns (uint256[] ids)',
  'function unitsOf(uint256 id) view returns (uint256)',
  'function pendingUnits() view returns (uint256)',
  'function nextCommitId() view returns (uint256)',
  'function nextRevealId() view returns (uint256)',
  'function commits(uint256 commitId) view returns (address recipient, uint64 targetBlock, uint32 amount, uint32 queueEnd)',
  'function deposit(uint256[] ids, uint256[] amounts, address to)',
  'function redeem(uint256[] ids, uint256[] amounts, address to, address feeToken)',
  'function commitRedeem(uint256 amount, address to) returns (uint256 commitId)',
  'function revealRedeem(uint256 commitId)',
  'function escrowedTo(uint256 id) view returns (address)',
  'function claimEscrowed(uint256 id, address to)',
  'function isLocked(uint256 id) view returns (bool)',
  'function lockedEnd() view returns (uint256)',
  'function queueBounds() view returns (uint256 head, uint256 tail)',
  'function queuePositionOf(uint256 id) view returns (uint256)',
  'event RedeemCommitted(uint256 indexed commitId, address indexed by, address indexed to, uint256 amount, uint256 targetBlock)',
  'event RedeemRearmed(uint256 indexed commitId, uint256 targetBlock)',
  'event RedeemRevealed(uint256 indexed commitId, uint256[] ids)',
  'event RedeemEscrowed(uint256 indexed commitId, address indexed recipient, uint256 id)',
  'event PickFeePaid(address indexed by, address indexed token, uint256 amount)',
  'error NotCollection()',
  'error RandomUnavailable()',
  'error EmptyRequest()',
  'error LengthMismatch()',
  'error NotHeld(uint256 id)',
  'error InsufficientHeld()',
  'error TooEarly()',
  'error UnknownCommit()',
  'error NotNextCommit()',
  'error CommitTooLarge()',
  'error InvalidRecipient()',
  'error NotEscrowed()',
  'error AlreadyHeld(uint256 id)',
  'error RevealGasTooLow()',
  'error TransferNotReceived(uint256 id)',
  'error InsufficientBalance()',
  'error LockedForRandomRedeem(uint256 id)',
  'error NoVault()',
  'error FeeTokenNotOffered(address token)',
  'error FeeNotReceived()',
  'error FeeNotForwarded()',
])

/** The alignment vault's config (contracts/src/vaults/uni/UniAlignmentVault.sol), where its minimums live. */
export const poolVaultAbi = parseAbi(['function config() view returns (address)'])

/** The vault config (UniAlignmentVaultFactory): least amount of each token a contribution can carry. */
export const vaultConfigAbi = parseAbi(['function minContribution(address token) view returns (uint256)'])

/** The collection side: names, metadata, ownership and the transfers that deposit into a pool. */
export const erc721Abi = parseAbi([
  'function name() view returns (string)',
  'function ownerOf(uint256 id) view returns (address)',
  'function tokenURI(uint256 id) view returns (string)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function getApproved(uint256 id) view returns (address)',
  'function approve(address to, uint256 id)',
  'function safeTransferFrom(address from, address to, uint256 id, bytes data)',
])

export const erc1155Abi = parseAbi([
  'function name() view returns (string)',
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] owners, uint256[] ids) view returns (uint256[])',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
])

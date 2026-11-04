import { parseAbi } from 'viem'

/** Hand-copied from contracts/src/pools/MiyaPoolFactory.sol. */
export const poolFactoryAbi = parseAbi([
  'function allPoolsLength() view returns (uint256)',
  'function allPools(uint256) view returns (address)',
  'function poolOf(address collection, uint8 mode) view returns (address)',
  'function createPool(address collection, uint8 mode) returns (address pool)',
  'event PoolCreated(address indexed collection, address indexed pool, uint8 kind, uint8 mode, address creator)',
  'error PoolExists(address pool)',
  'error UnsupportedCollection()',
  'error RandomRequiresERC721()',
])

/** Hand-copied from contracts/src/pools/MiyaPool.sol (plus the ERC20 reads it inherits). */
export const poolAbi = parseAbi([
  'function collection() view returns (address)',
  'function kind() view returns (uint8)',
  'function mode() view returns (uint8)',
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
  'function redeem(uint256[] ids, uint256[] amounts, address to)',
  'function commitRedeem(uint256 amount, address to) returns (uint256 commitId)',
  'function revealRedeem(uint256 commitId)',
  'function escrowedTo(uint256 id) view returns (address)',
  'function claimEscrowed(uint256 id, address to)',
  'event RedeemCommitted(uint256 indexed commitId, address indexed by, address indexed to, uint256 amount, uint256 targetBlock)',
  'event RedeemRearmed(uint256 indexed commitId, uint256 targetBlock)',
  'event RedeemRevealed(uint256 indexed commitId, uint256[] ids)',
  'event RedeemEscrowed(uint256 indexed commitId, address indexed recipient, uint256 id)',
  'error NotCollection()',
  'error WrongMode()',
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
])

/** The collection side: names, metadata, ownership and the transfers that deposit into a pool. */
export const erc721Abi = parseAbi([
  'function name() view returns (string)',
  'function ownerOf(uint256 id) view returns (address)',
  'function tokenURI(uint256 id) view returns (string)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 id, bytes data)',
])

export const erc1155Abi = parseAbi([
  'function name() view returns (string)',
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] owners, uint256[] ids) view returns (uint256[])',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
])

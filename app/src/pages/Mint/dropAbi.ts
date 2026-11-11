// The live mint screen's ERC721DropInstance ABI. Its own file (only viem) so tests/abi-drift.test.mts can load it
// without wagmi or React.
import { parseAbi } from 'viem'

export const dropAbi = parseAbi([
  'function name() view returns (string)',
  'function owner() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint32)',
  'function contractURI() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'struct TokenPrice { address token; uint256 price; }',
  'struct Phase { uint64 start; uint64 end; uint32 maxPerWallet; bytes32 merkleRoot; uint32 supplyCap; TokenPrice[] prices; }',
  'function phases() view returns (Phase[])',
  'function phasesMinted() view returns (uint256[])',
  'function publicRemaining() view returns (uint256)',
  'function mintedInPhase(uint256 phaseId, address minter) view returns (uint256)',
  'function mint(uint256 phaseId, uint256 quantity, bytes32[] proof, address token, uint256 maxCost) payable',
  'function mintTo(address to, uint256 phaseId, uint256 quantity, bytes32[] proof, address token, uint256 maxCost) payable',
  'error PhaseNotActive()',
  'error NotAllowlisted()',
  'error WalletLimit()',
  'error SoldOut()',
  'error PhaseSoldOut()',
  'error WrongPayment()',
  'error ExceedsMaxCost()',
  'error TokenNotPriced()',
  'error TokenNotAccepted(address token)',
  'error TokenNotAllowed(address token)',
  'error ShortTransfer()',
])

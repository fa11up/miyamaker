import { parseAbi } from 'viem'

/** Minimal ERC721M surface used by the Mint window. */
export const erc721mAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function price() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function mintOpen() view returns (bool)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function mint(uint256 _amount) payable',
])

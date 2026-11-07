/**
 * Which of a wallet's NFTs belong in My Files' Scam folder: flagged by the indexer, or on a contract Etherscan says is not
 * verified. Unverified does not prove a scam, so the folder says why each file is there. Unknown is not unverified, but it
 * is not trusted either: those wait in their own folder until Etherscan answers. Both kinds lose their links and only load
 * images from the indexer's copies, as an unknown server sees who loads from it, and lose the words a scam writes for
 * itself: name, description and collection name.
 */
import type { OwnedNft } from './indexer/types'

export type Verified = Record<string, boolean>

export function scamReason(nft: OwnedNft, verified: Verified, trusted: (nft: OwnedNft) => boolean) {
  if (nft.spam) return 'Flagged as spam'
  if (verified[nft.contract.toLowerCase()] === false && !trusted(nft)) return 'Contract is not verified on Etherscan'
  return undefined
}

export const QUARANTINE_WARNING = "Don't follow any link or offer in this file, or sign anything it asks for."

const quarantine = (nft: OwnedNft): OwnedNft => ({
  ...nft,
  name: `#${nft.tokenId}`,
  description: '',
  collectionName: '',
  image: nft.hostedThumb ?? '',
  fullImage: nft.hostedFull ?? nft.hostedThumb ?? '',
  externalUrl: '',
})

export function splitScam(nfts: OwnedNft[], verified: Verified, trusted: (nft: OwnedNft) => boolean) {
  const clean: OwnedNft[] = []
  const scam: OwnedNft[] = []
  const checking: OwnedNft[] = []
  for (const nft of nfts) {
    const reason = scamReason(nft, verified, trusted)
    if (reason) scam.push({ ...quarantine(nft), scamReason: reason })
    else if (!trusted(nft) && verified[nft.contract.toLowerCase()] === undefined) {
      checking.push({ ...quarantine(nft), checking: true })
    } else clean.push(nft)
  }
  return { clean, scam, checking }
}

/** A long token id, like an ENS name's 78 digits, cut down for a file's label. */
export const shortTokenId = (tokenId: string) =>
  tokenId.length > 12 ? `#${tokenId.slice(0, 4)}…${tokenId.slice(-4)}` : `#${tokenId}`

/** The label under a file: its name when it can be trusted and has one, otherwise its id. */
export function fileLabel(nft: OwnedNft): string {
  if (nft.scamReason || nft.checking || !nft.name || nft.name === `#${nft.tokenId}`) return shortTokenId(nft.tokenId)
  return nft.name
}

/** What a file's Type row says. */
export function fileType(nft: OwnedNft): string {
  if (nft.tokenType === 'ERC1155') return nft.balance ? `ERC-1155, you hold ${nft.balance}` : 'ERC-1155 token'
  return nft.tokenType === 'ERC721' ? 'ERC-721 token' : 'NFT'
}

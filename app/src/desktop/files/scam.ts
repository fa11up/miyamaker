/**
 * Which of a wallet's NFTs belong in My Files' Scam folder: flagged by the indexer, or on a contract Etherscan says is not
 * verified. Unverified does not prove a scam, so the folder says why each file is there. Unknown is not unverified. Files
 * there lose their links and only load images from the indexer's copies, as an unknown server sees who loads from it.
 */
import type { OwnedNft } from './indexer/types'

export type Verified = Record<string, boolean>

export function scamReason(nft: OwnedNft, verified: Verified, trusted: (nft: OwnedNft) => boolean) {
  if (nft.spam) return 'Flagged as spam'
  if (verified[nft.contract.toLowerCase()] === false && !trusted(nft)) return 'Contract is not verified on Etherscan'
  return undefined
}

export function splitScam(nfts: OwnedNft[], verified: Verified, trusted: (nft: OwnedNft) => boolean) {
  const clean: OwnedNft[] = []
  const scam: OwnedNft[] = []
  for (const nft of nfts) {
    const reason = scamReason(nft, verified, trusted)
    if (!reason) clean.push(nft)
    else {
      scam.push({
        ...nft,
        scamReason: reason,
        image: nft.hostedThumb ?? '',
        fullImage: nft.hostedFull ?? nft.hostedThumb ?? '',
        externalUrl: '',
      })
    }
  }
  return { clean, scam }
}

import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import type { Artwork } from '@/components/ArtViewer'
import ArtViewer from '@/components/ArtViewer'
import AuctionProduct from '@/pages/Auction/ProductsList/AuctionProduct'
import { useAllTokenIds } from '@/pages/Auction/useAllTokenIds'
import { setCurrentTokenIdsList } from '@/store/auction/actions'
import { useAppDispatch, useAppSelector } from '@/store/hooks'

const ProductsListWrapper = styled.div`
  width: 100%;
  display: flex;
  flex-wrap: wrap;

  overflow-y: auto;
  -ms-overflow-style: none;

  ::-webkit-scrollbar {
    display: none;
  }
`

export default function ProductsList({ auctionContract }: { auctionContract: Address }) {
  const dispatch = useAppDispatch()

  const nftContract = useAppSelector((state) => state.collections.currentNFTContract)

  const { tokenIds, tokenURIs } = useAllTokenIds({
    nft: nftContract,
    address: auctionContract,
  })

  useEffect(() => {
    dispatch(setCurrentTokenIdsList({ tokenIds, tokenURIs }))
  }, [dispatch, tokenIds, tokenURIs])

  // Metadata each card has loaded, so the viewer can step through every lot in list order.
  const [artworks, setArtworks] = useState<Record<number, Artwork>>({})
  const [viewing, setViewing] = useState<number | null>(null)
  const handleArtwork = useCallback((id: number, art: Artwork) => setArtworks((a) => ({ ...a, [id]: art })), [])

  const gallery = tokenIds.filter((id) => artworks[id])
  const items = gallery.map((id) => artworks[id] as Artwork)

  return (
    <ProductsListWrapper>
      {tokenIds.map((tokenId: number, index: number) => (
        <AuctionProduct
          key={index}
          tokenId={tokenId}
          tokenURI={tokenURIs[index] || ''}
          onArtwork={handleArtwork}
          onView={setViewing}
        />
      ))}
      {viewing !== null && items.length > 0 && (
        <ArtViewer items={items} startIndex={Math.max(0, gallery.indexOf(viewing))} onClose={() => setViewing(null)} />
      )}
    </ProductsListWrapper>
  )
}

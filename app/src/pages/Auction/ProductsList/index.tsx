import ChevronLeftIcon from 'assets/chevron-left-icon.svg'
import ChevronRightIcon from 'assets/chevron-right-icon.svg'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { useWindowSize } from 'usehooks-ts'
import type { Address } from 'viem'

import type { Artwork } from '@/components/ArtViewer'
import ArtViewer from '@/components/ArtViewer'
import { NormalButton } from '@/components/Button/NormalButton'
import AuctionProduct from '@/pages/Auction/ProductsList/AuctionProduct'
import { useAllTokenIds } from '@/pages/Auction/useAllTokenIds'
import { setCurrentTokenIdsList } from '@/store/auction/actions'
import { useAppDispatch, useAppSelector } from '@/store/hooks'

/* Desktop: one row of lots sized to fit the panel, paged with arrows when there are more than fit in a row (no
   scroll box). Phones: a two-column grid at natural height; the window body scrolls. */
const LotsPanel = styled.div`
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`

const LotsRow = styled.div<{ $columns: number }>`
  flex: 1 1 auto;
  min-width: 0;
  max-height: 100%;
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns}, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: start;

  @media only screen and (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: none;
  }
`

const Pager = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.65rem;
`

const Icon = styled.img`
  display: block;
  width: 1rem;
  height: 1rem;
`

/** At most this many lots share the row on desktop; the cards shrink to fit, and more than this pages. */
const LOTS_PER_PAGE = 6
/** Fewer lots than this still get this many column widths, so one or two lots do not become giant cards. */
const MIN_COLUMNS = 4

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

  const { width } = useWindowSize()
  const paged = width > 640
  const pages = paged ? Math.max(1, Math.ceil(tokenIds.length / LOTS_PER_PAGE)) : 1
  const [page, setPage] = useState(0)
  const currentPage = Math.min(page, pages - 1)
  const columns = Math.max(MIN_COLUMNS, Math.min(tokenIds.length, LOTS_PER_PAGE))
  const onPage = (index: number) =>
    !paged || (index >= currentPage * LOTS_PER_PAGE && index < (currentPage + 1) * LOTS_PER_PAGE)

  const gallery = tokenIds.filter((id) => artworks[id])
  const items = gallery.map((id) => artworks[id] as Artwork)

  return (
    <LotsPanel>
      {pages > 1 && (
        <Pager>
          <NormalButton
            aria-label="Previous lots"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            <Icon src={ChevronLeftIcon} alt="" />
          </NormalButton>
        </Pager>
      )}
      <LotsRow $columns={columns}>
        {/* Every lot stays mounted (off-page ones hidden) so the viewer can step through all of them. */}
        {tokenIds.map((tokenId: number, index: number) => (
          <AuctionProduct
            key={index}
            hidden={!onPage(index)}
            tokenId={tokenId}
            tokenURI={tokenURIs[index] || ''}
            onArtwork={handleArtwork}
            onView={setViewing}
          />
        ))}
      </LotsRow>
      {pages > 1 && (
        <Pager>
          <NormalButton
            aria-label="Next lots"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(Math.min(pages - 1, currentPage + 1))}
          >
            <Icon src={ChevronRightIcon} alt="" />
          </NormalButton>
          <span>
            {currentPage + 1}/{pages}
          </span>
        </Pager>
      )}
      {viewing !== null && items.length > 0 && (
        <ArtViewer items={items} startIndex={Math.max(0, gallery.indexOf(viewing))} onClose={() => setViewing(null)} />
      )}
    </LotsPanel>
  )
}

import { useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { NormalButton } from '@/components/Button/NormalButton'
import ItemsList from '@/pages/Auction/CollectionsList/ItemsList'
import Pagination from '@/pages/Auction/CollectionsList/Pagination'

const CollectionsListWrapper = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;

  > * + * {
    margin-top: 0.5rem;
  }
`

const HeadersWrapper = styled.div`
  height: 10%;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;

  @media only screen and (max-width: 640px) {
    display: none;
  }
`
const Header = styled.div`
  width: 25%;
  display: flex;
  align-items: center;
  padding: 0.5rem;
  font-size: 1.2rem;
  font-weight: 900;
`

const ItemsListWrapper = styled.div`
  height: 90%;
  display: flex;
  flex-direction: column;

  /* Phones: natural height, so the window body is the one scrolling surface. */
  @media only screen and (max-width: 640px) {
    height: auto;
  }
`

const Headers = [
  { title: 'Name', width: '35%' },
  { title: 'Description', width: '40%' },
  { title: 'Website', width: '25%' },
  // { title: 'Supply', width: '15%' },
]

const ITEM_PER_PAGE = 4

const Message = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 8rem;
  font-weight: bolder;
  text-align: center;
`

export default function CollectionsList({
  nfts,
  isLoading,
  isError,
  onRetry,
  setPageSection,
  auctionContract,
}: {
  nfts: string[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  setPageSection: (section: string) => void
  auctionContract: Address
}) {
  const totalPages = Math.ceil(nfts.length / ITEM_PER_PAGE)
  const [currentCounter, setCurrentCounter] = useState<number>(1)

  if (isError || isLoading || !nfts.length) {
    return (
      <CollectionsListWrapper>
        {isError ? (
          <Message role="alert">
            Couldn&apos;t load auctions.
            <NormalButton type="button" onClick={onRetry}>
              Try again
            </NormalButton>
          </Message>
        ) : (
          <Message role="status">{isLoading ? 'Loading auctions…' : 'No auctions yet.'}</Message>
        )}
      </CollectionsListWrapper>
    )
  }

  return (
    <CollectionsListWrapper>
      <HeadersWrapper>
        {Headers.map(({ title, width }, index: number) => (
          <Header key={index} style={{ width }}>
            {title}
          </Header>
        ))}
      </HeadersWrapper>
      <ItemsListWrapper>
        {nfts.slice(ITEM_PER_PAGE * (currentCounter - 1), ITEM_PER_PAGE * currentCounter).map((nft, index: number) => (
          <ItemsList key={index} nft={nft} setPageSection={setPageSection} auctionContract={auctionContract} />
        ))}
      </ItemsListWrapper>
      {totalPages > 1 && (
        <Pagination totalPages={totalPages} currentPage={currentCounter} setCurrentCounter={setCurrentCounter} />
      )}
    </CollectionsListWrapper>
  )
}

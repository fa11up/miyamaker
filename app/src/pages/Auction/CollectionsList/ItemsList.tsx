import { useRef } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import { collectionStatus } from '@/pages/Auction/bidding'
import { AUCTION_PAGE_SECTION } from '@/pages/Auction/constants'
import { useAllTokenIds } from '@/pages/Auction/useAllTokenIds'
import { useFitText } from '@/pages/Auction/useFitText'
import { useLotAuctions } from '@/pages/Auction/useLots'
import { useNFT } from '@/pages/Auction/useNFT'
import type { Auction } from '@/store/auction/reducer'
import { setCurrentNFT } from '@/store/collections/actions'
import { useAppDispatch } from '@/store/hooks'
import { safeHttpUrl } from '@/utils/resolveUri'

const Items = styled.div`
  height: 25%;
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 0.5rem;
  cursor: pointer;

  :hover {
    background-color: rgba(122, 22, 32, 0.07);
  }

  /* Rows stack on phones and the list scrolls, so each row takes the height its content needs. */
  @media only screen and (max-width: 640px) {
    flex-direction: column;
    flex: none;
    height: auto;
  }
`
const Item = styled.div`
  width: 40%;
  display: flex;
  padding: 0.5rem;
  min-height: 0;
  overflow: hidden;
  font-size: 0.85rem;
  line-height: 1rem;

  @media only screen and (max-width: 640px) {
    width: 100%;
    text-align: justify;
  }
`
/* Fits its row: the text steps down in size (useFitText) rather than scrolling inside the row. */
const DescriptionItem = styled(Item)`
  display: block;
  line-height: 1.25;

  @media only screen and (max-width: 640px) {
    flex: none;
  }
`

const LinkItem = styled.div`
  width: 25%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  overflow-wrap: anywhere;
  min-width: 0;

  /* Pads the link to the phone's smallest tap target. */
  @media only screen and (max-width: 640px) {
    width: 100%;
    align-items: center;

    > a {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
    }
  }
`

const ImageItem = styled.div`
  width: 35%;
  display: flex;
  align-items: center;
  padding: 0.5rem;
  font-weight: bolder;

  > * + * {
    margin-left: 1rem;
  }

  @media only screen and (max-width: 640px) {
    width: 100%;
    flex-direction: column;
    justify-content: center;
    flex: none;
    height: 14rem;

    > * + * {
      margin-top: 0.5rem;
      margin-left: 0;
    }
  }
`
const ImageWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;

  > img {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    margin: 0;
    border: none;
  }
  > img:hover {
    border: none;
  }

  //@media only screen and (max-width: 640px) {
  //  > img {
  //    width: 90%;
  //    height: 80%;
  //  }
  //}
`

const Status = styled.div`
  margin-top: 0.15rem;
  font-size: 0.75rem;
  font-weight: normal;
  color: #5f4030;
`

export default function ItemsList({
  nft,
  setPageSection,
  auctionContract,
}: {
  nft: string
  setPageSection: (section: string) => void
  auctionContract: Address
}) {
  const dispatch = useAppDispatch()

  const { name, symbol, description, image, externalLink, collaborators } = useNFT({ address: nft as Address })
  const { tokenIds } = useAllTokenIds({ nft: nft as Address, address: auctionContract })
  const { auctions } = useLotAuctions({ nft: nft as Address, tokenIds, address: auctionContract })
  const lots = auctions.filter((a): a is Auction => !!a)
  const status = lots.length > 0 && lots.length === tokenIds.length ? collectionStatus(lots, Date.now()) : ''

  // external_link comes from on-chain metadata: only http(s) links are rendered as links.
  const safeLink = safeHttpUrl(externalLink)

  const descriptionRef = useRef<HTMLDivElement>(null)
  useFitText(descriptionRef, description || '')

  const handleClick = () => {
    setPageSection(AUCTION_PAGE_SECTION.PRODUCT_SECTION)
    dispatch(
      setCurrentNFT({
        nft: nft as Address,
        metadata: { name, description, image, external_link: externalLink, collaborators },
      })
    )
  }

  return (
    <Items onClick={handleClick}>
      <ImageItem>
        <ImageWrapper>
          <NftImage
            variant="thumb"
            src={image || undefined}
            alt={name}
            fit="contain"
            aspect="1 / 1"
            style={{ height: '100%', width: 'auto', maxWidth: '100%' }}
            eager
          />
        </ImageWrapper>
        <div>
          {name} ({symbol})
          {status && <Status>{status}</Status>}
        </div>
      </ImageItem>
      <DescriptionItem ref={descriptionRef} title={description}>
        {description}
      </DescriptionItem>
      <LinkItem>
        {/* Only the link itself leaves the site; the rest of the row opens the collection. */}
        {safeLink ? (
          <a href={safeLink} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
            {externalLink.replace('https://', '')}
          </a>
        ) : (
          externalLink
        )}
        <NormalButton type="button">View lots</NormalButton>
      </LinkItem>
    </Items>
  )
}

import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import { Chip } from '@/components/Retro'
import { monthYear } from '@/pages/Auction/bidding'
import ImageWrapper from '@/pages/Auction/ImageWrapper'
import { lotAction } from '@/pages/Auction/lotAction'
import { useAuctionData } from '@/pages/Auction/useAuctionData'
import { useToken } from '@/pages/Auction/useToken'
import { setCurrentToken } from '@/store/collections/actions'
import { useAppDispatch } from '@/store/hooks'
import { getTokenAttribute } from '@/utils/getTokenAttribute'

const ProductWrapper = styled.div<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  /* The lot on show: a second gold rule around its frame and button. */
  ${({ $selected }) => $selected && 'outline: 3px solid #d9b45b; outline-offset: 2px;'}

  &[hidden] {
    display: none;
  }
`

const ImageDetail = styled.div`
  height: 100%;
  width: 100%; /* the image box has no intrinsic width; without this the centred column shrinks it */
  display: flex;
  flex-direction: column;
  align-items: center;

  > * + * {
    margin-top: 0.3rem;
  }
`

const Wrapper = styled.button`
  width: 100%;
  flex: 0 1 auto;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;

  display: flex;
  justify-content: center;
  align-items: center;

  /* The desktop panel has a set height: the picture gives way so every card and its button fit inside it. */
  @media only screen and (min-width: 641px) {
    max-width: 92px;
  }

  :focus-visible {
    outline: 1px dotted #14101f;
    outline-offset: 2px;
  }
`

const Description = styled.div`
  max-width: 100%;
  font-size: 0.75rem;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
`

/* Long names wrap to two lines rather than ending in "…"; the full name is on hover. Room for two is kept on every
   card, so the buttons line up. */
const LotName = styled(Description)`
  min-height: 2.4em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

export default function AuctionProduct({
  nft,
  auctionContract,
  tokenId,
  tokenURI,
  onView,
  selected = false,
  hidden = false,
  locked = false,
}: {
  hidden?: boolean
  selected?: boolean
  /** A bid is out on the lot on show: it stays until that ends. */
  locked?: boolean
  nft: Address
  auctionContract: Address
  tokenId: number
  tokenURI: string
  onView?: (tokenId: number) => void
}) {
  const dispatch = useAppDispatch()

  const { name, description, image, externalURL, attributes } = useToken({ tokenURI, isFetch: true })

  const { endTime, settled } = useAuctionData({ nft, tokenId, address: auctionContract })

  const artist = getTokenAttribute(attributes, 'Artist')

  const handleOpen = () => {
    if (locked) return
    dispatch(
      setCurrentToken({
        tokenId,
        metadata: { name, description, image, external_url: externalURL, attributes },
      })
    )
  }

  return (
    <ProductWrapper hidden={hidden} $selected={selected}>
      <ImageWrapper style={{ padding: '0.5rem', flex: '0 1 auto', minHeight: 0 }}>
        <ImageDetail>
          <Wrapper type="button" title={`View ${name || 'artwork'}`} onClick={() => onView?.(tokenId)}>
            <NftImage variant="thumb" src={image || undefined} alt={name} fit="contain" aspect="1 / 1" />
          </Wrapper>
          <LotName title={name}>{name}</LotName>
          {artist && <Description>{artist}</Description>}
          {endTime > 0 &&
            (lotAction(endTime, settled, Date.now()) === 'Bid' ? (
              <Chip tone="ok">Live</Chip>
            ) : (
              <Chip tone="off">Ended {monthYear(endTime)}</Chip>
            ))}
          {/* <Description> */}
          {/*  Current bid: {product.currentBid} {product.currency} */}
          {/* </Description> */}
        </ImageDetail>
      </ImageWrapper>
      <NormalButton
        onClick={handleOpen}
        disabled={selected || locked}
        aria-current={selected ? 'true' : undefined}
        style={{ width: '100%', marginTop: '0.25rem', flex: 'none' }}
      >
        {selected ? 'Showing' : lotAction(endTime, settled, Date.now())}
      </NormalButton>
    </ProductWrapper>
  )
}

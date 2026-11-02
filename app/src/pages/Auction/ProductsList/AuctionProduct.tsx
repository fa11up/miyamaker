import { useEffect } from 'react'
import styled from 'styled-components/macro'

import type { Artwork } from '@/components/ArtViewer'
import { toArtwork } from '@/components/ArtViewer'
import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import ImageWrapper from '@/pages/Auction/ImageWrapper'
import { useToken } from '@/pages/Auction/useToken'
import { setCurrentToken } from '@/store/collections/actions'
import { useAppDispatch } from '@/store/hooks'
import { getTokenAttribute } from '@/utils/getTokenAttribute'

const ProductWrapper = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

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
    margin-top: 0.5rem;
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

  :focus-visible {
    outline: 1px dotted #14101f;
    outline-offset: 2px;
  }
`

const Description = styled.div`
  max-width: 100%;
  font-size: 0.5rem;
  font-weight: bolder;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default function AuctionProduct({
  tokenId,
  tokenURI,
  onArtwork,
  onView,
  hidden = false,
}: {
  hidden?: boolean
  tokenId: number
  tokenURI: string
  onArtwork?: (tokenId: number, artwork: Artwork) => void
  onView?: (tokenId: number) => void
}) {
  const dispatch = useAppDispatch()

  const { name, description, image, externalURL, attributes } = useToken({ tokenURI, isFetch: true })

  useEffect(() => {
    if (image) onArtwork?.(tokenId, toArtwork({ name, description, image, externalURL, attributes }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, name, description, image, externalURL])

  const handleBid = () => {
    dispatch(
      setCurrentToken({
        tokenId,
        metadata: { name, description, image, external_url: externalURL, attributes },
      })
    )
  }

  return (
    <ProductWrapper hidden={hidden}>
      <ImageWrapper style={{ padding: '0.5rem', flex: '0 1 auto', minHeight: 0 }}>
        <ImageDetail>
          <Wrapper type="button" title={`View ${name || 'artwork'}`} onClick={() => onView?.(tokenId)}>
            <NftImage variant="thumb" src={image || undefined} alt={name} fit="contain" aspect="1 / 1" />
          </Wrapper>
          <Description title={name}>{name}</Description>
          <Description>{getTokenAttribute(attributes, 'Artist')}</Description>
          {/* <Description> */}
          {/*  Current bid: {product.currentBid} {product.currency} */}
          {/* </Description> */}
        </ImageDetail>
      </ImageWrapper>
      <NormalButton onClick={handleBid} style={{ width: '100%', marginTop: '0.25rem', flex: 'none' }}>
        Bid
      </NormalButton>
    </ProductWrapper>
  )
}

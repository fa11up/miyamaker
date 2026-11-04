import { useRef } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import NftImage from '@/components/NftImage'
import { AUCTION_PAGE_SECTION } from '@/pages/Auction/constants'
import { useFitText } from '@/pages/Auction/useFitText'
import { useNFT } from '@/pages/Auction/useNFT'
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
    background-color: rgba(255, 255, 255, 0.2);
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

const LinkItem = styled.a`
  width: 25%;
  display: flex;
  align-items: center;
  padding: 0.5rem;
  text-decoration: none;

  @media only screen and (max-width: 640px) {
    width: 100%;
    justify-content: center;
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

export default function ItemsList({ nft, setPageSection }: { nft: string; setPageSection: (section: string) => void }) {
  const dispatch = useAppDispatch()

  const { name, symbol, description, image, externalLink, collaborators } = useNFT({ address: nft as Address })

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
        </div>
      </ImageItem>
      <DescriptionItem ref={descriptionRef} title={description}>
        {description}
      </DescriptionItem>
      {safeLink ? (
        <LinkItem href={safeLink} target="_blank" rel="noreferrer noopener">
          {externalLink.replace('https://', '')}
        </LinkItem>
      ) : (
        <Item>{externalLink}</Item>
      )}
    </Items>
  )
}

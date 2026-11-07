import ChevronLeftIcon from 'assets/chevron-left-icon.svg'
import ChevronRightIcon from 'assets/chevron-right-icon.svg'
import styled from 'styled-components/macro'

import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import ImageWrapper from '@/pages/Auction/ImageWrapper'

const ImagesListWrapper = styled.div`
  width: 100%;

  @media only screen and (max-width: 640px) {
    width: 60%;
    height: 100%;
  }
`

const ButtonContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 0.75rem;

  > * + * {
    margin-left: 0.5rem;
  }
`

const Icon = styled.img`
  display: flex;
  justify-content: center;
  align-items: center;
  border: none;
  width: 1rem;
  height: 1rem;

  :hover {
    border: none;
  }
`

const Images = styled.button`
  width: 100%;
  height: 90%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;

  :focus-visible {
    outline: 1px dotted #14101f;
    outline-offset: 2px;
  }

  > img {
    border: none;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
  }

  > img:hover {
    border: none;
  }
`

const Counter = styled.div`
  text-align: center;
  font-size: 0.75rem;
`

export default function ImagesList({
  image,
  position,
  total,
  onPrevious,
  onNext,
  locked = false,
  onView,
}: {
  image: string
  position: number
  total: number
  onPrevious: () => void
  onNext: () => void
  /** A bid is out: the lot on show stays until it ends. */
  locked?: boolean
  onView?: () => void
}) {
  return (
    <ImagesListWrapper>
      <ImageWrapper>
        <Images type="button" title="View artwork" onClick={onView}>
          <NftImage variant="full" src={image || undefined} alt="Artwork" fit="contain" eager />
        </Images>
        <Counter>
          Lot {position + 1} of {total}
        </Counter>
      </ImageWrapper>
      {total > 1 && (
        <ButtonContainer>
          <NormalButton aria-label="Previous lot" disabled={locked} onClick={onPrevious}>
            <Icon src={ChevronLeftIcon} alt="" />
          </NormalButton>
          <NormalButton aria-label="Next lot" disabled={locked} onClick={onNext}>
            <Icon src={ChevronRightIcon} alt="" />
          </NormalButton>
        </ButtonContainer>
      )}
    </ImagesListWrapper>
  )
}

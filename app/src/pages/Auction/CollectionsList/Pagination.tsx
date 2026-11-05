import ChevronLeftIcon from 'assets/chevron-left-icon.svg'
import ChevronRightIcon from 'assets/chevron-right-icon.svg'
import styled from 'styled-components/macro'

import { NormalButton } from '@/components/Button/NormalButton'

const PaginateWrapper = styled.div`
  height: 10%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 1rem;
`

const ButtonContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 0.75rem;

  > * + * {
    margin-left: 1rem;
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

const Counter = styled.div`
  text-align: center;
  font-weight: 900;
`

export default function Pagination({
  totalPages,
  currentPage,
  setCurrentCounter,
}: {
  totalPages: number
  currentPage: number
  setCurrentCounter: (counter: number) => void
}) {
  return (
    <PaginateWrapper>
      <Counter>
        {currentPage} of {totalPages}
      </Counter>
      <ButtonContainer>
        <NormalButton
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => setCurrentCounter(Math.max(1, currentPage - 1))}
        >
          <Icon src={ChevronLeftIcon} alt="" />
        </NormalButton>
        <NormalButton
          aria-label="Next page"
          disabled={currentPage >= totalPages}
          onClick={() => setCurrentCounter(Math.min(totalPages, currentPage + 1))}
        >
          <Icon src={ChevronRightIcon} alt="" />
        </NormalButton>
      </ButtonContainer>
    </PaginateWrapper>
  )
}

import NextIcon from 'assets/explorer/icon/next.svg'
import PreviousIcon from 'assets/explorer/icon/previous.svg'
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
  isEndPage,
  currentPage,
  setCurrentCounter,
}: {
  isEndPage: boolean
  currentPage: number
  setCurrentCounter: (counter: number) => void
}) {
  return (
    <PaginateWrapper>
      <ButtonContainer>
        <NormalButton
          style={{ borderRadius: '50%', boxShadow: 'none', padding: '0' }}
          disabled={currentPage === 1}
          onClick={() => setCurrentCounter(currentPage - 1)}
        >
          <Icon src={PreviousIcon} alt="Previous Icon" />
        </NormalButton>
        <Counter>{currentPage}</Counter>
        <NormalButton
          style={{ borderRadius: '50%', boxShadow: 'none', padding: '0' }}
          disabled={isEndPage}
          onClick={() => setCurrentCounter(currentPage + 1)}
        >
          <Icon src={NextIcon} alt="Next Icon" />
        </NormalButton>
      </ButtonContainer>
    </PaginateWrapper>
  )
}

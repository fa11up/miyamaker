import type { CSSProperties, ReactNode } from 'react'
import styled from 'styled-components/macro'

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  /* A gilt frame and a white mat, as the piece would hang. */
  border: 3px solid #c9a24c;
  outline: 1px solid #6b4a12;
  outline-offset: -1px;
  box-shadow: inset 0 0 0 1px #6b4a12, inset 0 2px 6px rgba(42, 20, 16, 0.3);
  background-color: #fffdf6;
  padding: 0.5rem 1.25rem;

  > * + * {
    margin-top: 0.5rem;
  }

  @media only screen and (max-width: 640px) {
    padding: 1rem 1rem 0.5rem 1rem;
  }
`

export default function ImageWrapper({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <Wrapper style={style}>{children}</Wrapper>
}

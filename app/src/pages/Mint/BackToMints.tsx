import styled from 'styled-components/macro'

import { bevel, color, font, space, text } from '@/theme/tokens'

const Back = styled.button`
  border: none;
  border-radius: 0;
  min-height: 32px;
  padding: 0 ${space[3]};
  background: ${color.face};
  color: ${color.ink};
  box-shadow: ${bevel.raised};
  font-family: ${font.ui};
  font-size: ${text.xs};
  letter-spacing: normal;
  cursor: pointer;
  &:hover {
    background: ${color.faceLight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
`

/** "← All mints": back to the Mint home from any collection view. */
export default function BackToMints({ onBack }: { onBack: () => void }) {
  return (
    <Back type="button" onClick={onBack}>
      ← All mints
    </Back>
  )
}

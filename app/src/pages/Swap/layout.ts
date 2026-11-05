import styled from 'styled-components/macro'

import { bevel, color, space, text } from './floor/tokens'

/** Shared Trade layout: the content column and the network toolbar, used by both the Tokens and NFTs tabs. */

export const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]} ${space[4]} 0;
  .narrow & {
    padding: ${space[2]} ${space[3]} 0;
  }
`

export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
`

export const ChainTabs = styled.div`
  flex: 1;
  display: flex;
  gap: 2px;
  min-width: 0;
  button {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 ${space[2]};
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.sm};
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    .narrow & {
      height: 44px;
    }
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.well};
    font-weight: 700;
  }
`

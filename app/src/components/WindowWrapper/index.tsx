import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import { bevel, color } from '@/theme/tokens'

/** Classic raised window frame. Content below the title bar fills the remaining height. */
const WindowFrame = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 3px;
  background-color: ${color.face};
  box-shadow: ${bevel.raised}, 4px 6px 0 rgba(20, 16, 31, 0.25);
  color: ${color.ink};

  > .window-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  > .window-body > * {
    flex: 1 1 auto;
    min-height: 0;
  }

  @media (max-width: 768px) {
    padding: 0;
    box-shadow: none;
  }
`

export default function WindowWrapper({ children }: { children: ReactNode }) {
  const [titleBar, ...rest] = Array.isArray(children) ? children : [children]
  return (
    <WindowFrame className="window-frame">
      {titleBar}
      <div className="window-body">{rest}</div>
    </WindowFrame>
  )
}

import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import type { TitleSkin } from '@/components/TitleBar'
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

  /* The frame around a themed app takes the same material as its header. */
  &[data-skin='miyanet'] {
    background: linear-gradient(180deg, #24135f, #0d0828);
    box-shadow: inset 0 0 0 1px #5b37b8, 4px 6px 0 rgba(20, 16, 31, 0.35);
  }
  &[data-skin='floor'] {
    background: #0a0f13;
    box-shadow: inset 0 0 0 1px #ffb000, 4px 6px 0 rgba(20, 16, 31, 0.45);
  }
  &[data-skin='aqua'] {
    background: linear-gradient(90deg, #bcc8de, #f7faff 50%, #bcc8de);
    box-shadow: inset 0 0 0 1px #7f92b8, 4px 6px 0 rgba(11, 31, 92, 0.3);
  }
  &[data-skin='tv'] {
    background: #14111c;
    box-shadow: inset 0 0 0 1px #4a4658, 4px 6px 0 rgba(20, 16, 31, 0.45);
  }
  &[data-skin='chrome'] {
    background: linear-gradient(135deg, #fff, #a2aac2 40%, #e4e8f4 60%, #7f86a6);
    box-shadow: inset 0 0 0 1px #10101d, 4px 6px 0 rgba(20, 16, 31, 0.35);
  }

  @media (max-width: 768px) {
    padding: 0;
    box-shadow: none;
  }
`

export default function WindowWrapper({ children, skin }: { children: ReactNode; skin?: TitleSkin }) {
  const [titleBar, ...rest] = Array.isArray(children) ? children : [children]
  return (
    <WindowFrame className="window-frame" data-skin={skin}>
      {titleBar}
      <div className="window-body">{rest}</div>
    </WindowFrame>
  )
}

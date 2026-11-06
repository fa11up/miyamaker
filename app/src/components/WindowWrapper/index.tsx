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
  /* Only the frame: an app that paints no background of its own still sits on the window face. */
  &[data-skin] > .window-body {
    background-color: ${color.face};
  }
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
    background: linear-gradient(180deg, #5b2bc4, #2c0f66);
    box-shadow: inset 0 0 0 1px #1a0838, 4px 6px 0 rgba(26, 8, 56, 0.4);
  }

  &[data-skin='mint'] {
    background: linear-gradient(180deg, #ff9fd6, #9a5fe0);
    box-shadow: inset 0 0 0 1px #5a1466, 4px 6px 0 rgba(20, 16, 31, 0.3);
  }
  &[data-skin='launch'] {
    background: linear-gradient(180deg, #17d99a, #06504a);
    box-shadow: inset 0 0 0 1px #06302c, 4px 6px 0 rgba(6, 48, 44, 0.35);
  }
  &[data-skin='auction'] {
    background: linear-gradient(180deg, #6b2a1c, #3b130c);
    box-shadow: inset 0 0 0 1px #d9b45b, 4px 6px 0 rgba(20, 16, 31, 0.35);
  }
  &[data-skin='manager'] {
    background: linear-gradient(180deg, #c3cad5, #6f7886);
    box-shadow: inset 0 0 0 1px #14181f, 4px 6px 0 rgba(20, 24, 31, 0.35);
  }
  &[data-skin='files'] {
    background: linear-gradient(180deg, #2a1230, #120a1c);
    box-shadow: inset 0 0 0 1px #5f7a68, 4px 6px 0 rgba(0, 0, 0, 0.45);
  }
  &[data-skin='upload'] {
    background: linear-gradient(180deg, #1b3fb0, #040c34);
    box-shadow: inset 0 0 0 1px #27b8ff, 4px 6px 0 rgba(4, 12, 52, 0.35);
  }
  &[data-skin='station'] {
    background: linear-gradient(180deg, #ffa928, #ff7a18);
    box-shadow: inset 0 0 0 1px #2a0a5e, 4px 6px 0 rgba(42, 10, 94, 0.3);
  }
  /* Display keeps the window face: the classic grey dialog under a blue bar. */

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

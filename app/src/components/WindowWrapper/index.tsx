import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import type { TitleSkin } from '@/components/TitleBar'
import giltSkin from '@/pages/Auction/skin/gilt.webp'
import malachiteSkin from '@/pages/Launch/skin/malachite.webp'
import goldSkin from '@/pages/TV/skin/gold.webp'
import { bevel, color } from '@/theme/tokens'

/** Selected text in a themed app takes that app's colours: [background, text]. Infinite Upload keeps the site's pink. */
const SELECTION: Partial<Record<TitleSkin, [string, string]>> = {
  miyanet: ['#5b37b8', '#ffffff'],
  floor: ['#ffb000', '#0a0f13'],
  aqua: ['#1e6fd9', '#ffffff'],
  tv: ['#c49a3a', '#2a1a04'],
  mint: ['#9a5fe0', '#ffffff'],
  music: ['#fe9ca1', '#000000'],
  launch: ['#c9b27a', '#12261e'],
  auction: ['#7a1620', '#f4dd9c'],
  manager: ['#4b5563', '#ffffff'],
  files: ['#7dff9a', '#04140a'],
  display: ['#000080', '#ffffff'],
  traits: ['#7A49C4', '#ffffff'],
}
const selectionRules = Object.entries(SELECTION)
  .map(([skin, colours]) => `&[data-skin='${skin}'] ::selection { background: ${colours?.[0]}; color: ${colours?.[1]}; }`)
  .join('\n')

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

  ${selectionRules}

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
  /* Gold trim all the way round the walnut. */
  &[data-skin='tv'] {
    padding: 0 5px 5px;
    background: url(${goldSkin}) 0 0 / 256px 256px;
    box-shadow: inset 0 0 0 1px #2a1a04;
  }
  &[data-skin='tv'] > .window-body {
    background: none;
  }

  &[data-skin='mint'] {
    background: linear-gradient(180deg, #ff9fd6, #9a5fe0);
    box-shadow: inset 0 0 0 1px #5a1466, 4px 6px 0 rgba(20, 16, 31, 0.3);
  }
  /* Sunset frame, angled like the glass inside. */
  &[data-skin='music'] {
    background: repeating-linear-gradient(118deg, rgba(255, 255, 255, 0.18) 0 1px, transparent 1px 3px),
      linear-gradient(162deg, #766eb8 0%, #b380b7 28%, #e78fb1 58%, #fe9ca1 78%, #f9bba6 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 0 0 1px #3d2a6b, 0 10px 18px rgba(42, 24, 72, 0.28);
    color: #000000;
  }
  &[data-skin='music'] > .window-body {
    background: linear-gradient(165deg, #c98eb4, #e78fb1 58%, #f9bba6);
  }
  /* A slab of the stone, with a gold inlay line where it meets the page. */
  &[data-skin='launch'] {
    padding: 0 4px 4px;
    background: linear-gradient(rgba(2, 20, 15, 0.62), rgba(2, 20, 15, 0.62)), url(${malachiteSkin}) 0 0 / 320px 320px;
    box-shadow: inset 0 0 0 1px #c9b27a, 4px 6px 0 rgba(6, 48, 44, 0.35);
  }
  &[data-skin='launch'] > .window-body {
    background: none;
  }
  /* A gilt picture frame, worn where hands have carried it. */
  &[data-skin='auction'] {
    padding: 0 6px 6px;
    background: url(${giltSkin}) 0 0 / 128px 128px;
    box-shadow: inset 0 0 0 1px #4a2f08, 4px 6px 0 rgba(20, 16, 31, 0.35);
  }
  &[data-skin='auction'] > .window-body {
    background: none;
    box-shadow: 0 0 0 1px #4a2f08;
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
  /* MiyaMaker Studio: lilac face under an orchid frame. Dark ink, the face is too light for white. */
  &[data-skin='traits'] {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 42%),
      linear-gradient(180deg, #d9d2ee, #9f98c1);
    box-shadow: inset 0 0 0 1px #4a3478, 4px 6px 0 rgba(74, 52, 120, 0.35);
  }
  &[data-skin='traits'] > .window-body {
    background: #9f98c1;
    color: #1a1230;
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

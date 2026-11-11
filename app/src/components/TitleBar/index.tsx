import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import mahoganySkin from '@/pages/Auction/skin/mahogany.webp'
import launchGoldSkin from '@/pages/Launch/skin/gold.webp'
import malachiteSkin from '@/pages/Launch/skin/malachite.webp'
import mouldingSkin from '@/pages/TV/skin/moulding.webp'
import { bevel, color, font, space, text } from '@/theme/tokens'

const ChromeButton = styled.button`
  display: grid;
  place-items: center;
  width: 20px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: ${color.face};
  color: ${color.dark};
  box-shadow: ${bevel.raised};
  cursor: pointer;

  &:hover {
    background: ${color.faceLight};
  }

  &:active {
    box-shadow: ${bevel.pressed};
    svg {
      transform: translate(1px, 1px);
    }
  }

  &.close {
    margin-left: 2px;
  }

  @media (max-width: 768px) {
    &.hide-mobile {
      display: none;
    }
    width: 36px;
    height: 32px;
    svg {
      transform: scale(1.4);
    }
    &:active svg {
      transform: scale(1.4) translate(1px, 1px);
    }
  }
`

/** Apps with a look of their own carry it into their header. The buttons and dragging behave the same everywhere. */
export type TitleSkin =
  | 'miyanet'
  | 'floor'
  | 'aqua'
  | 'tv'
  | 'mint'
  | 'music'
  | 'launch'
  | 'auction'
  | 'manager'
  | 'files'
  | 'upload'
  | 'display'
  | 'traits'

const MARK: Record<TitleSkin, string> = {
  miyanet: '✦',
  floor: '●',
  aqua: '♪',
  tv: '✦',
  mint: '♥',
  music: '♫',
  launch: '✦',
  auction: '♦',
  manager: '⚙',
  files: '▤',
  upload: '◎',
  display: '▣',
  traits: '✎',
}

const StyledTitleBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: ${space[1]};
  height: 26px;
  padding: 0 3px 0 ${space[2]};
  margin-bottom: 2px;
  background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
  color: ${color.highlight};
  user-select: none;

  /* Windows that are not on top get the muted title bar. */
  .react-draggable:not(.is-focused) & {
    background: linear-gradient(90deg, ${color.titleInactiveFrom}, ${color.titleInactiveTo});
    color: ${color.light};
  }

  @media (max-width: 768px) {
    height: 40px;
    padding-left: ${space[3]};
    margin-bottom: 0;
  }

  .mark {
    flex: none;
    margin-right: 2px;
    font-size: 12px;
    line-height: 1;
  }

  /* miyanet: the night sky, with the logo's chrome lettering. */
  &[data-skin='miyanet'] {
    background: radial-gradient(1px 1px at 18px 6px, #fff 99%, transparent),
      radial-gradient(1px 1px at 60px 18px, #f5c6f6 99%, transparent),
      radial-gradient(1px 1px at 120px 8px, #fff 99%, transparent),
      linear-gradient(90deg, #0d0828, #24135f 45%, #5b37b8);
    background-size: 150px 26px, 150px 26px, 150px 26px, 100% 100%;
    .mark {
      color: #f5c6f6;
      text-shadow: 0 0 5px ${color.accent};
    }
    .title-bar {
      font-family: ${font.display};
      letter-spacing: 0.06em;
      text-shadow: none;
      background: linear-gradient(180deg, #fff 0%, #f5c6f6 45%, ${color.accent} 55%, #fff 75%, #c9b8ff 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    ${ChromeButton} {
      background: linear-gradient(180deg, #fff, #c9b8ff);
      color: #24135f;
      box-shadow: 0 0 0 1px #0d0828, inset 0 0 0 1px rgba(255, 255, 255, 0.6);
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #fff, ${color.accent});
    }
  }

  /* Trade: a lit trading terminal, scanlines and an amber readout. */
  &[data-skin='floor'] {
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.28) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #2a2110, #0a0f13);
    border-bottom: 1px solid #ffb000;
    color: #ffb000;
    .mark {
      color: #35d07f;
      text-shadow: 0 0 6px #35d07f;
    }
    .title-bar {
      font-family: ${font.mono};
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-shadow: 0 0 6px rgba(255, 176, 0, 0.6);
    }
    ${ChromeButton} {
      background: #0a0f13;
      color: #ffb000;
      box-shadow: inset 0 0 0 1px #ffb000;
    }
    ${ChromeButton}:hover {
      background: #ffb000;
      color: #0a0f13;
    }
  }

  /* Drop Music: brushed silver with gel buttons, a Y2K media player. */
  &[data-skin='aqua'] {
    background: linear-gradient(180deg, #f7faff 0%, #d5ddec 48%, #bcc8de 52%, #e8edf7 100%);
    color: #0b1f5c;
    .mark {
      color: #2a6bff;
    }
    .title-bar {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
    }
    ${ChromeButton} {
      border: 1px solid rgba(11, 31, 92, 0.65);
      border-radius: 999px;
      color: #0b1f5c;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.25) 48%, transparent 50%),
        linear-gradient(180deg, #27d3ff 0%, #2a6bff 100%);
      box-shadow: inset 0 -2px 4px rgba(255, 255, 255, 0.55);
    }
    ${ChromeButton}.close {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.25) 48%, transparent 50%),
        linear-gradient(180deg, #ff9df0 0%, #ff4fd8 100%);
    }
  }

  /* miyatv: the set's black plastic, with a red tally light. */
  /* miyatv: a bitmap of gold moulding, beads along its lower edge. It tiles across and keeps its gold when not on top. */
  &[data-skin='tv'],
  .react-draggable:not(.is-focused) &[data-skin='tv'] {
    height: 38px;
    margin: 0 -5px;
    padding: 0 12px 9px 16px;
    background: url(${mouldingSkin}) 0 0 / 256px 38px repeat-x;
    color: #2e1c02;
    .mark {
      color: #6b1408;
      text-shadow: 0 1px 0 rgba(255, 245, 200, 0.7);
    }
    .title-bar {
      font-size: ${text.md};
      letter-spacing: 0.04em;
      text-shadow: 0 1px 0 rgba(255, 245, 200, 0.8);
    }
    ${ChromeButton} {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #2e1c02;
      background: radial-gradient(circle at 36% 28%, #fffbe6 0 8%, #f3d27c 28%, #b98a2c 62%, #5c3d0a 100%);
      box-shadow: 0 0 0 1px #2a1a04, 0 1px 2px rgba(0, 0, 0, 0.5);
    }
    ${ChromeButton}:hover {
      filter: brightness(1.1);
    }
    ${ChromeButton}.close {
      color: #fff2e6;
      background: radial-gradient(circle at 36% 28%, #fff 0 8%, #ff8a8a 26%, #c41e2e 60%, #5c0610 100%);
    }
  }

  /* Mint: pink candy, the paint of its own background. */
  &[data-skin='mint'] {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.1) 46%, transparent 50%),
      linear-gradient(90deg, #ff6fb5, #c04fd8 60%, #7a3fd0);
    color: #fff;
    .mark {
      color: #ffe3f3;
    }
    .title-bar {
      font-family: ${font.display};
      letter-spacing: 0.04em;
      text-shadow: 1px 1px 0 #5a1466;
    }
    ${ChromeButton} {
      border-radius: 4px;
      color: #5a1466;
      background: linear-gradient(180deg, #fff, #ffc2e6);
      box-shadow: 0 0 0 1px #5a1466;
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #fff, #ff9fd6);
    }
  }

  /* MiyaMusicMaker: deep violet bar, white type, coral glass keys. */
  &[data-skin='music'] {
    background:
      linear-gradient(128deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0) 36%),
      linear-gradient(160deg, #6a58a4, #5a4a96 58%, #4a3b86);
    border-bottom: 2px solid #fe9ca1;
    color: #ffffff;
    .mark {
      color: #ffffff;
      text-shadow: 0 0 5px rgba(254, 156, 161, 0.85);
    }
    .title-bar {
      font-family: ${font.display};
      letter-spacing: 0.06em;
      text-shadow: 0 1px 0 #3d2a6b;
    }
    ${ChromeButton} {
      border-radius: 3px;
      color: #000000;
      background:
        linear-gradient(148deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 42%),
        linear-gradient(146deg, #fff6f2, #fe9ca1 55%, #e78fb1);
      box-shadow: inset 0 1px 0 #ffffff, 0 2px 0 rgba(61, 42, 107, 0.35), 0 0 0 1px #3d2a6b;
    }
    ${ChromeButton}:hover {
      background:
        linear-gradient(148deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 42%),
        linear-gradient(146deg, #fff6f2, #ffb3b4 55%, #ee9ab8);
    }
  }

  /* Launch: laurel green and gold, the launchpad's wreath. */
  &[data-skin='launch'] {
    background: linear-gradient(rgba(2, 20, 15, 0.62), rgba(2, 20, 15, 0.62)), url(${malachiteSkin}) 0 0 / 320px 320px;
    border-bottom: 1px solid #c9b27a;
    color: #f4ecd2;
    .mark {
      color: #d6bc80;
    }
    .title-bar {
      letter-spacing: 0.04em;
      text-shadow: 1px 1px 0 #02140f;
    }
    ${ChromeButton} {
      color: #1c2a1e;
      background: #c9b27a url(${launchGoldSkin}) 0 0 / 128px 128px;
      box-shadow: 0 0 0 1px #02140f;
    }
    ${ChromeButton}:hover {
      filter: brightness(1.1);
    }
  }

  /* Auction: a sale room's mahogany and gold. */
  &[data-skin='auction'] {
    background: #3b130c url(${mahoganySkin}) 0 0 / 256px 256px;
    border-bottom: 2px solid #d9b45b;
    color: #f4dd9c;
    .mark {
      color: #d9b45b;
    }
    .title-bar {
      font-family: Georgia, 'Times New Roman', serif;
      letter-spacing: 0.08em;
      text-shadow: 1px 1px 0 #1d0805;
    }
    ${ChromeButton} {
      color: #3b130c;
      background: linear-gradient(180deg, #f4dd9c, #b98f3e);
      box-shadow: 0 0 0 1px #1d0805;
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #fff0c4, #d9b45b);
    }
  }

  /* Manager: a control panel, brushed steel and a status strip. */
  &[data-skin='manager'] {
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #f1f3f7 0%, #c3cad5 46%, #8e97a6 52%, #c9cfd9 100%);
    color: #14181f;
    .mark {
      color: #1f6fff;
      text-shadow: 0 0 5px rgba(31, 111, 255, 0.8);
    }
    .title-bar {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
    }
    ${ChromeButton} {
      width: 18px;
      border-radius: 50%;
      color: #14181f;
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #eef1f6 28%, #aab2bf 56%, #5f6876 100%);
      box-shadow: 0 0 0 1px #14181f;
    }
    ${ChromeButton}:hover {
      filter: brightness(1.08);
    }
    ${ChromeButton}.close {
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #ffc2c2 28%, #ff5252 56%, #b01313 100%);
    }
  }

  /* My Files: a manila folder, the tab of its own icon. */
  &[data-skin='files'] {
    background: repeating-linear-gradient(0deg, rgba(120, 255, 170, 0.06) 0 1px, transparent 1px 3px),
      linear-gradient(90deg, #120a1c, #2a1230 60%, #4c1830);
    color: #cfe8d3;
    .mark {
      color: #ff3d5e;
      text-shadow: 0 0 6px #ff3d5e;
    }
    .title-bar {
      letter-spacing: 0.08em;
      text-shadow: 0 0 5px rgba(160, 255, 190, 0.45);
    }
    ${ChromeButton} {
      color: #cfe8d3;
      background: #1c1226;
      box-shadow: 0 0 0 1px #5f7a68;
    }
    ${ChromeButton}:hover {
      background: #33203f;
    }
  }

  /* Upload: files kept forever, deep space and a cyan glow. */
  &[data-skin='upload'] {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.62) 0%, rgba(255, 255, 255, 0.12) 48%, transparent 52%),
      linear-gradient(90deg, #0a1f6e, #1b3fb0 45%, #7a4fe0 72%, #ff8fd6 90%, #ffe27a);
    color: #fff;
    .mark {
      color: #c8f6ff;
      font-size: 15px;
      text-shadow: 0 0 6px #27b8ff;
    }
    .title-bar {
      letter-spacing: 0.04em;
      text-shadow: 1px 1px 0 #040c34;
    }
    ${ChromeButton} {
      width: 18px;
      border-radius: 50%;
      color: #04123a;
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #c8f6ff 28%, #27b8ff 56%, #0a56b0 100%);
      box-shadow: 0 0 0 1px #04123a;
    }
    ${ChromeButton}:hover {
      filter: brightness(1.08);
    }
    ${ChromeButton}.close {
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #ffe2f5 28%, #ff8fd6 56%, #c81a78 100%);
    }
  }

  /* MiyaMaker Studio: orchid to violet. White needs the black edge because the left end is light. */
  &[data-skin='traits'] {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 46%, rgba(26, 18, 48, 0.18) 100%),
      linear-gradient(90deg, #cd6cd5, #8756cb);
    border-bottom: 2px solid #4a3478;
    color: #fff;
    text-shadow: -1px 0 0 #000, 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
    .mark {
      color: #fff;
    }
    .title-bar {
      letter-spacing: 0.04em;
      text-shadow: -1px 0 0 #000, 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
    }
    ${ChromeButton} {
      color: #fff;
      border-radius: 5px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 46%),
        linear-gradient(180deg, #d9d2ee, #7a49c4);
      box-shadow: inset 0 1px 0 #fff, 0 1px 0 #4a3478, 0 2px 4px rgba(74, 52, 120, 0.45);
      svg {
        filter: drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000) drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000);
      }
    }
    ${ChromeButton}:hover {
      background:
        linear-gradient(180deg, #fff 0%, rgba(255, 255, 255, 0) 50%),
        linear-gradient(180deg, #d9d2ee, #a45dce);
    }
  }

  .react-draggable:not(.is-focused) &[data-skin='traits'] {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0) 46%),
      linear-gradient(90deg, #b7b0d4, #9f98c1);
    color: #1a1230;
    text-shadow: none;
    .mark {
      color: #1a1230;
    }
    .title-bar {
      color: #1a1230;
      text-shadow: none;
    }
  }

  /* Display: the settings blue of every computer of the time. */
  &[data-skin='display'] {
    background: linear-gradient(90deg, #000080, #1084d0);
    color: #fff;
    .mark {
      color: #c9e6ff;
    }
    ${ChromeButton} {
      color: #000;
      background: #c0c0c0;
      box-shadow: inset -1px -1px #000, inset 1px 1px #fff, inset -2px -2px #808080;
    }
    ${ChromeButton}:hover {
      background: #dcdcdc;
    }
  }

  /* Phones: every skin's buttons keep the tap target, the round ones staying round. */
  @media (max-width: 768px) {
    &[data-skin] ${ChromeButton} {
      width: 36px;
      height: 32px;
    }
    &[data-skin='tv'] ${ChromeButton},
    &[data-skin='manager'] ${ChromeButton},
    &[data-skin='upload'] ${ChromeButton} {
      width: 32px;
    }
    &[data-skin='tv'],
    .react-draggable:not(.is-focused) &[data-skin='tv'] {
      height: 46px;
      background-size: 256px 46px;
    }
  }

  /* A themed header dims when its window is not on top, and keeps its colours. */
  .react-draggable:not(.is-focused) &[data-skin] {
    filter: saturate(0.45) brightness(0.8);
  }
  /* Music stays in the sunset. A little darker, still the same violet, not a grey bar. */
  .react-draggable:not(.is-focused) &[data-skin='music'] {
    filter: brightness(0.92);
  }

  @media (prefers-reduced-motion: no-preference) {
    &[data-skin='floor'] .mark {
      animation: titleLed 2s steps(1) infinite;
    }
  }
  @keyframes titleLed {
    50% {
      opacity: 0.35;
    }
  }
`

const TitleContainer = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  font-size: ${text.sm};
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 1px 1px 0 rgba(20, 16, 31, 0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  @media (max-width: 768px) {
    font-size: ${text.md};
    cursor: default;
  }
`

const ButtonContainer = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
`

const Glyph = ({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }) => (
  <svg width="10" height="9" viewBox="0 0 10 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
    {kind === 'min' && <rect x="1" y="7" width="7" height="2" />}
    {kind === 'max' && <path d="M0 0h10v2H0zM0 2h1v7H0zM9 2h1v7H9zM0 8h10v1H0z" />}
    {kind === 'restore' && (
      <path d="M2 0h8v1H2zM2 1h1v1H2zM9 1h1v5H9zM8 5h1v1H8zM0 3h8v1H0zM0 4h1v5H0zM7 4h1v5H7zM0 8h8v1H0zM0 2h0z" />
    )}
    {kind === 'close' && (
      <path d="M1 1h2v1h1v1h2V2h1V1h2v1H8v1H7v1H6v1h1v1h1v1h1v1H7V7H6V6H4v1H3v1H1V7h1V6h1V5h1V4H3V3H2V2H1z" />
    )}
  </svg>
)

export default function TitleBar({
  minimizeBtn,
  fullscreenBtn,
  closeBtn,
  fullscreen,
  onClose,
  onFullscreen,
  onMinimize,
  className = 'title-bar',
  skin,
  children,
}: {
  minimizeBtn?: boolean
  fullscreenBtn?: boolean
  closeBtn?: boolean
  onClose?: (e: any) => void
  onFullscreen?: () => void
  onMinimize?: (e: any) => void
  fullscreen?: boolean
  className?: string
  skin?: TitleSkin
  children?: ReactNode
}) {
  return (
    <StyledTitleBar className="title-bar-root" data-skin={skin}>
      {skin && (
        <span className="mark" aria-hidden>
          {MARK[skin]}
        </span>
      )}
      <TitleContainer className={className}>{children}</TitleContainer>
      <ButtonContainer>
        {minimizeBtn && (
          <ChromeButton aria-label="Minimize" title="Minimize" onClick={onMinimize}>
            <Glyph kind="min" />
          </ChromeButton>
        )}
        {fullscreenBtn && (
          <ChromeButton
            aria-label={fullscreen ? 'Restore' : 'Maximize'}
            title={fullscreen ? 'Restore' : 'Maximize'}
            onClick={onFullscreen}
            className="hide-mobile"
          >
            <Glyph kind={fullscreen ? 'restore' : 'max'} />
          </ChromeButton>
        )}
        {closeBtn && (
          <ChromeButton className="close" aria-label="Close" title="Close" onClick={onClose}>
            <Glyph kind="close" />
          </ChromeButton>
        )}
      </ButtonContainer>
    </StyledTitleBar>
  )
}

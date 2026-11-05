import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

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
    height: 30px;
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
  | 'launch'
  | 'auction'
  | 'manager'
  | 'files'
  | 'upload'
  | 'display'
  | 'station'

const MARK: Record<TitleSkin, string> = {
  miyanet: '✦',
  floor: '●',
  aqua: '♪',
  tv: '●',
  mint: '♥',
  launch: '▲',
  auction: '♦',
  manager: '⚙',
  files: '▤',
  upload: '∞',
  display: '▣',
  station: '★',
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
  &[data-skin='tv'] {
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #33303f, #14111c);
    color: #e8e4f4;
    .mark {
      color: #ff3b3b;
      text-shadow: 0 0 6px #ff3b3b;
    }
    .title-bar {
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    ${ChromeButton} {
      background: linear-gradient(180deg, #4a4658, #24212f);
      color: #e8e4f4;
      box-shadow: 0 0 0 1px #000, inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #5d586e, #2f2b3c);
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

  /* Launch: laurel green and gold, the launchpad's wreath. */
  &[data-skin='launch'] {
    background: linear-gradient(90deg, #0d3b2e, #17694f 65%, #2a8a63);
    border-bottom: 1px solid #e8c766;
    color: #ffe9a8;
    .mark {
      color: #e8c766;
    }
    .title-bar {
      font-family: ${font.display};
      letter-spacing: 0.05em;
      text-shadow: 1px 1px 0 #06201a;
    }
    ${ChromeButton} {
      color: #0d3b2e;
      background: linear-gradient(180deg, #fff3c4, #e8c766);
      box-shadow: 0 0 0 1px #06201a;
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #fff, #f2d98a);
    }
  }

  /* Auction: a sale room's mahogany and gold. */
  &[data-skin='auction'] {
    background: repeating-linear-gradient(92deg, rgba(0, 0, 0, 0.1) 0 2px, transparent 2px 7px),
      linear-gradient(180deg, #6b2a1c, #3b130c);
    border-bottom: 1px solid #d9b45b;
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
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 2px),
      linear-gradient(180deg, #5c6470, #2c323b);
    border-bottom: 2px solid #ff4fd8;
    color: #f2f4f8;
    .mark {
      color: #ff9df0;
    }
    .title-bar {
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-shadow: 1px 1px 0 #101318;
    }
    ${ChromeButton} {
      color: #101318;
      background: linear-gradient(180deg, #e6e9ee, #9aa2ae);
      box-shadow: 0 0 0 1px #101318;
    }
    ${ChromeButton}:hover {
      background: linear-gradient(180deg, #fff, #c0c6d0);
    }
  }

  /* My Files: a manila folder, the tab of its own icon. */
  &[data-skin='files'] {
    background: linear-gradient(180deg, #f7e27a, #d9b93f);
    border-bottom: 1px solid #8a6f12;
    color: #3a2d00;
    .mark {
      color: #6e5500;
    }
    .title-bar {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    ${ChromeButton} {
      color: #3a2d00;
      background: linear-gradient(180deg, #fff8d6, #e9d27a);
      box-shadow: 0 0 0 1px #6e5500;
    }
    ${ChromeButton}:hover {
      background: #fffbe8;
    }
  }

  /* Upload: files kept forever, deep space and a cyan glow. */
  &[data-skin='upload'] {
    background: radial-gradient(1px 1px at 40px 8px, #fff 99%, transparent),
      radial-gradient(1px 1px at 110px 18px, #9be8ff 99%, transparent),
      linear-gradient(90deg, #04102e, #0a3a78 70%, #0f6fa8);
    background-size: 160px 26px, 160px 26px, 100% 100%;
    color: #c9f3ff;
    .mark {
      color: #5fe0ff;
      font-size: 15px;
      text-shadow: 0 0 6px #27d3ff;
    }
    .title-bar {
      letter-spacing: 0.06em;
      text-shadow: 0 0 5px rgba(39, 211, 255, 0.55);
    }
    ${ChromeButton} {
      color: #04102e;
      background: linear-gradient(180deg, #e4faff, #7fdcf5);
      box-shadow: 0 0 0 1px #04102e;
    }
    ${ChromeButton}:hover {
      background: #e4faff;
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

  /* Community station: pinstriped tangerine plastic with gel buttons. */
  &[data-skin='station'] {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(255, 255, 255, 0.12) 48%, transparent 52%),
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.16) 0 1px, transparent 1px 3px),
      linear-gradient(90deg, #ff7a18, #ffa928 70%, #ffd24d);
    color: #2a0a5e;
    .mark {
      color: #c6ff3d;
      text-shadow: 0 0 1px #2a0a5e, 1px 1px 0 #2a0a5e;
    }
    .title-bar {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
    }
    ${ChromeButton} {
      width: 18px;
      border-radius: 50%;
      color: #2a0a5e;
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #e6ff9c 28%, #c6ff3d 56%, #6fbf00 100%);
      box-shadow: 0 0 0 1px #2a0a5e;
    }
    ${ChromeButton}:hover {
      filter: brightness(1.08);
    }
    ${ChromeButton}.close {
      background: radial-gradient(circle at 36% 28%, #fff 0 10%, #ffc2e0 28%, #ff5fae 56%, #c81a78 100%);
    }
  }

  /* A themed header dims when its window is not on top, and keeps its colours. */
  .react-draggable:not(.is-focused) &[data-skin] {
    filter: saturate(0.45) brightness(0.8);
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

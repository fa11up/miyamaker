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
export type TitleSkin = 'miyanet' | 'floor' | 'aqua' | 'tv' | 'chrome'

const MARK: Record<TitleSkin, string> = { miyanet: '✦', floor: '●', aqua: '♪', tv: '●', chrome: '♥' }

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

  /* Community station: the radio's sculpted chrome and its pink orb. */
  &[data-skin='chrome'] {
    background: linear-gradient(180deg, #fff 0%, #cfd4e6 42%, #7f86a6 52%, #d8dcec 100%);
    color: #1c1040;
    .mark {
      color: #c82bd0;
    }
    .title-bar {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
    }
    ${ChromeButton} {
      width: 18px;
      border-radius: 50%;
      color: #1c1040;
      background: radial-gradient(circle at 36% 28%, #fff 0 8%, #e4e8f4 22%, #a2aac2 52%, #565d7c 100%);
      box-shadow: 0 0 0 1px #10101d;
    }
    ${ChromeButton}.close {
      color: #fff;
      background: radial-gradient(circle at 36% 26%, #fff 0 5%, #ff9df0 16%, #c82bd0 42%, #57107f 100%);
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

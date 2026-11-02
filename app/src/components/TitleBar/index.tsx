import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import { bevel, color, space, text } from '@/theme/tokens'

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

const Glyph = ({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }) => (
  <svg width="10" height="9" viewBox="0 0 10 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
    {kind === 'min' && <rect x="1" y="7" width="7" height="2" />}
    {kind === 'max' && (
      <path d="M0 0h10v2H0zM0 2h1v7H0zM9 2h1v7H9zM0 8h10v1H0z" />
    )}
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
  children?: ReactNode
}) {
  return (
    <StyledTitleBar className="title-bar-root">
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

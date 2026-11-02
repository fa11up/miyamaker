import type { ReactNode } from 'react'
import styled from 'styled-components/macro'

import { color, space, text } from '@/theme/tokens'

const IconButton = styled.button<{ hoverState?: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[1]};
  width: 96px;
  padding: ${space[1]} 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: ${color.ink};

  .icon {
    height: 52px;
    width: 60px;
    background-size: contain;
    background-position: bottom center;
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }

  .label {
    padding: 1px ${space[1]};
    font-size: ${text.sm};
    line-height: 1.25;
    text-align: center;
    border: 1px dotted transparent;
  }

  &:hover .label,
  &:focus-visible .label {
    background: ${color.accent};
    color: ${color.highlight};
    border-color: ${color.highlight};
  }

  &:hover .icon,
  &:focus-visible .icon {
    filter: drop-shadow(0 0 0 ${color.accent}) brightness(1.06);
  }

  &:focus-visible {
    outline: none;
  }

  &:active .icon {
    transform: translateY(1px);
  }

  @media (max-width: 768px) {
    width: 100%;
    .icon {
      height: 56px;
      width: 56px;
    }
  }
`

export default function DesktopIcon({
  normalState,
  children,
  onClick,
}: {
  normalState: string | undefined
  children: ReactNode
  onClick: () => void
}) {
  return (
    <IconButton type="button" onClick={onClick}>
      <span className="icon" style={{ backgroundImage: normalState ? `url(${normalState})` : undefined }} />
      <span className="label">{children}</span>
    </IconButton>
  )
}

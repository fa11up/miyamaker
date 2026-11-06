import { css } from 'styled-components/macro'

import { gel } from '@/pages/DropMusic/y2k'
import { font, space, text } from '@/theme/tokens'

import { HighlightButton, LinkButton } from '../Button'
import { DropZone, SmallButton, StepList, Thumb } from '../LaunchKit'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, Skeleton, StatusBox, Well } from './index'

export type Y2kPalette = {
  /** Text inside panels. */
  ink: string
  inkSoft: string
  /** The app's own material, painted on its scrolling layer. */
  material: string
  /** Heading colour and shadow where they sit straight on the material. */
  head: string
  headShadow: string
  /** Panel fill, and the line round it. */
  frost: string
  edge: string
  glow: string
  /** The gel of a primary button, and of the small ones. */
  gelTop: string
  gelBottom: string
  gelInk: string
  smallTop: string
  smallBottom: string
  link: string
}

/**
 * The Y2K layer an app wears over the shared Retro parts: frosted rounded panels, gel buttons, pill fields. Put it on
 * the app's scrolling layer. Each app brings its own palette, so they are related without being the same.
 */
export const y2kSkin = (p: Y2kPalette) => css`
  color: ${p.ink};
  background: ${p.material};

  a {
    color: ${p.link};
  }

  ${Panel}, ${Well} {
    background: ${p.frost};
    border: 1px solid ${p.edge};
    border-radius: 16px;
    box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.9), inset 0 -3px 6px ${p.glow}, 0 3px 0 rgba(0, 0, 0, 0.28);
  }
  ${Well} {
    border-radius: 10px;
  }

  ${DisplayTitle} {
    color: ${p.head};
    text-shadow: 2px 2px 0 ${p.headShadow};
  }
  ${Eyebrow} {
    color: ${p.head} !important;
    text-shadow: 1px 1px 0 ${p.headShadow} !important;
    letter-spacing: 0.14em;
  }
  ${Panel} ${Eyebrow}, ${Panel} ${DisplayTitle} {
    color: ${p.inkSoft} !important;
    text-shadow: none !important;
  }

  ${Chip} {
    border: 1px solid ${p.edge};
    border-radius: 999px;
    background: ${p.frost};
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
    color: ${p.ink};
    &::before {
      border-radius: 50%;
    }
  }

  ${StatusBox} {
    border: 1px solid ${p.edge};
    border-left-width: 5px;
    border-radius: 12px;
    box-shadow: inset 0 1px 0 #fff;
  }

  ${Skeleton} {
    border-radius: 10px;
  }

  ${BigButton} {
    ${gel(p.gelTop, p.gelBottom, p.gelInk)}
    outline: none;
    text-shadow: none;
    font-family: ${font.display};
    &:hover:not(:disabled) {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.25) 48%, transparent 50%),
        linear-gradient(180deg, ${p.gelTop} 0%, ${p.gelBottom} 100%);
      filter: brightness(1.07);
    }
    &:active:not(:disabled) {
      padding-top: 0;
      transform: translateY(1px);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    &:focus-visible {
      outline: 2px solid ${p.ink};
      outline-offset: 2px;
    }
    &:disabled {
      ${gel('#f1eff5', '#c9c5d3', '#5d5870')}
      filter: none;
    }
    &.secondary {
      ${gel(p.smallTop, p.smallBottom, p.gelInk)}
      text-shadow: none;
    }
  }

  ${DropZone} {
    border-radius: 14px;
  }
  ${Thumb} {
    border-radius: 10px;
    overflow: hidden;
  }
  ${StepList} {
    border-radius: 12px;
  }

  ${HighlightButton}, ${LinkButton}, ${SmallButton} {
    ${gel(p.smallTop, p.smallBottom, p.gelInk)}
    padding-left: ${space[3]};
    padding-right: ${space[3]};
    text-shadow: none;
    &:hover:not(:disabled) {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.25) 48%, transparent 50%),
        linear-gradient(180deg, ${p.smallTop} 0%, ${p.smallBottom} 100%);
      filter: brightness(1.05);
    }
    &:active:not(:disabled) {
      padding-top: 0;
      transform: translateY(1px);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    &:disabled {
      ${gel('#f1eff5', '#c9c5d3', '#5d5870')}
    }
  }

  input[type='text'],
  input[type='number'],
  input[type='url'],
  input[type='search'],
  input[type='datetime-local'],
  input:not([type]),
  input[type='file'],
  textarea,
  select {
    border: 1px solid ${p.edge};
    border-radius: 10px;
    background: #fff;
    box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.18);
    color: ${p.ink};
    &:focus-visible {
      outline: 2px solid ${p.link};
      outline-offset: 1px;
    }
  }
  input::file-selector-button {
    ${gel(p.smallTop, p.smallBottom, p.gelInk)}
    margin-right: ${space[2]};
    padding: 2px ${space[2]};
    font-family: ${font.ui};
    font-size: ${text.xs};
    cursor: pointer;
  }
  input[type='checkbox'],
  input[type='radio'] {
    accent-color: ${p.link};
  }
`

/** Fine horizontal lines, the moulded plastic of the time. */
export const pinstripe = (alpha = 0.12) =>
  `repeating-linear-gradient(0deg, rgba(255, 255, 255, ${alpha}) 0 1px, transparent 1px 4px)`

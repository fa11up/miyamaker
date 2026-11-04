import { css } from 'styled-components/macro'

/** Drop Music's own skin: the chrome and aqua of a Y2K media player. The rest of the OS keeps its lilac tokens. */
export const y2k = {
  navy: '#0b1f5c',
  ink: '#10204f',
  aqua: '#27d3ff',
  blue: '#2a6bff',
  lime: '#b6ff3c',
  limeDark: '#5f9e00',
  pink: '#ff4fd8',
  silverLine: '#7f92b8',
  lcd: '#071a10',
  lcdText: '#b6ff3c',
} as const

/** A glossy pill: a bright top half over a saturated body, the look of every Y2K button. */
export const gel = (from: string, to: string, ink: string) => css`
  border: 1px solid rgba(11, 31, 92, 0.65);
  border-radius: 999px;
  color: ${ink};
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.25) 48%, transparent 50%),
    linear-gradient(180deg, ${from} 0%, ${to} 100%);
  box-shadow: inset 0 -2px 4px rgba(255, 255, 255, 0.55), 0 1px 3px rgba(11, 31, 92, 0.45);
`

export const brushedSilver = css`
  background: linear-gradient(180deg, #f7faff 0%, #d5ddec 48%, #bcc8de 52%, #e8edf7 100%);
`

import { css } from 'styled-components/macro'

/**
 * miyaOS design tokens. One place for the window-chrome palette, spacing scale,
 * type scale and bevels so every window looks like it belongs to the same OS.
 */
export const color = {
  face: '#a9a3c9', // window / taskbar face (lilac)
  faceLight: '#c4bfe0',
  well: '#f6f4ff', // sunken content wells, inputs
  highlight: '#ffffff',
  light: '#dcd8f0',
  shadow: '#6f6894',
  dark: '#14101f',
  ink: '#1b1530',
  inkMuted: '#332d4d', // 5.4:1 on face, AA for body text
  accent: '#d97ada', // miya pink
  accentDark: '#a2479f',
  titleFrom: '#d97ada',
  titleTo: '#8f5fd0',
  titleInactiveFrom: '#8c86aa',
  titleInactiveTo: '#b3aecd',
  success: '#1f7a47',
  danger: '#b3261e',
  warning: '#8a5a00',
  link: '#3b1fbf',
} as const

/** 4px spacing scale. */
export const space = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '48px',
} as const

export const font = {
  ui: `'W95FA', 'Hiragino Kaku Gothic Pro W3', Osaka, Meiryo, 'MS PGothic', arial, sans-serif`,
  display: `'Revalia', 'W95FA', sans-serif`,
  /** Long-form reading text inside windows (About page etc.). */
  body: `'Hiragino Kaku Gothic Pro W3', Osaka, Meiryo, 'MS PGothic', arial, sans-serif`,
  mono: `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`,
} as const

/** Type scale (px). W95FA is drawn on a 16px grid, so UI text sits at 16px and steps from there. */
export const text = {
  xs: '12px',
  sm: '16px',
  md: '16px',
  lg: '20px',
  xl: '30px',
  xxl: '40px',
} as const

export const bevel = {
  raised: `inset -1px -1px ${color.dark}, inset 1px 1px ${color.highlight}, inset -2px -2px ${color.shadow}, inset 2px 2px ${color.light}`,
  pressed: `inset 1px 1px ${color.dark}, inset -1px -1px ${color.highlight}, inset 2px 2px ${color.shadow}, inset -2px -2px ${color.light}`,
  sunken: `inset 1px 1px ${color.shadow}, inset -1px -1px ${color.highlight}, inset 2px 2px ${color.dark}, inset -2px -2px ${color.light}`,
  field: `inset 1px 1px ${color.shadow}, inset -1px -1px ${color.highlight}, inset 2px 2px ${color.dark}, inset -2px -2px ${color.light}`,
} as const

export const focusRing = css`
  outline: 1px dotted ${color.dark};
  outline-offset: -5px;
`

export const MOBILE_BREAKPOINT = 768
export const TASKBAR_HEIGHT = { desktop: 34, mobile: 48 } as const

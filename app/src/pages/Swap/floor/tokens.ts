import { css } from 'styled-components/macro'

/**
 * Trade's own look: a dark trading floor (user, 2026-11-05). Same token names as theme/tokens, so every Trade screen
 * takes its colours from here instead of the lilac miyaOS palette. The window frame and title bar stay miyaOS.
 */
export const color = {
  face: '#10161c', // panels
  faceLight: '#18212a',
  well: '#0a0f13', // inputs, wells, the floor behind the panels
  hover: '#1c2731',
  highlight: '#e9f2ec',
  light: '#1f2a34',
  shadow: '#6d8291',
  dark: '#2b3945', // lines
  ink: '#dfe9e2',
  inkMuted: '#9db0a9',
  accent: '#ffb000', // amber: the one thing to press
  accentDark: '#b57d00',
  onAccent: '#0a0f13',
  titleFrom: '#1b2630',
  titleTo: '#1b2630',
  titleInactiveFrom: '#141c23',
  titleInactiveTo: '#141c23',
  success: '#35d07f', // up
  danger: '#ff6b6b', // down
  warning: '#ffb000',
  link: '#6cc7ff',
} as const

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

const mono = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`
export const font = { ui: mono, display: mono, body: mono, mono } as const

export const text = {
  xs: '12px',
  sm: '13px',
  md: '13px',
  lg: '16px',
  xl: '22px',
  xxl: '28px',
} as const

/** Flat 1px lines instead of Win95 bevels; pressed or selected lights up amber. */
export const bevel = {
  raised: `inset 0 0 0 1px ${color.dark}`,
  pressed: `inset 0 0 0 1px ${color.accent}`,
  sunken: `inset 0 0 0 1px ${color.light}`,
  field: `inset 0 0 0 1px ${color.dark}`,
} as const

export const focusRing = css`
  outline: 1px dotted ${color.accent};
  outline-offset: -3px;
`

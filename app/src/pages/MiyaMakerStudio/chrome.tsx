import { css } from 'styled-components/macro'

/**
 * MiyaMaker Studio ramp, sampled from the miyaOS window:
 * lilac face, orchid title on the left, violet title on the right.
 * Light faces take dark ink. Mid orchid and mixed bars take white with a black edge.
 * Plain white is only used where the ground is already dark enough.
 */
export const pink = {
  hot: '#7A49C4',
  deep: '#A45DCE',
  mid: '#CD6CD5',
  soft: '#B7B0D4',
  blush: '#D9D2EE',
  mist: '#9F98C1',
  ink: '#1A1230',
  inkMuted: '#2C2448',
  edge: '#4A3478',
} as const

const outline =
  '-1px 0 0 #000, 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'

/** White lettering with a 1px black edge, for orchid and mixed grounds. */
export const whiteOutline = css`
  color: #fff;
  text-shadow: ${outline};
`

/**
 * Trait arrows. A glass Aero cap over an XP bevel: hard lip, specular bar, and a drop.
 * The chevron sits above the gloss.
 */
export const gelButton = css`
  position: relative;
  display: inline-grid;
  place-items: center;
  padding: 0;
  overflow: hidden;
  border: 1px solid #2a1848;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 42%),
    linear-gradient(180deg, #f7e9ff 0%, ${pink.mid} 38%, ${pink.hot} 62%, #3d2470 100%);
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -2px 0 rgba(26, 18, 48, 0.45),
    0 3px 0 #2a1848,
    0 6px 0 rgba(74, 52, 120, 0.28),
    0 10px 16px rgba(74, 52, 120, 0.5);
  cursor: pointer;
  ${whiteOutline}

  &::before {
    content: '';
    position: absolute;
    z-index: 0;
    left: 3px;
    right: 3px;
    top: 2px;
    height: 46%;
    border-radius: 8px 8px 40% 40%;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.08));
    pointer-events: none;
  }

  svg {
    position: relative;
    z-index: 1;
    display: block;
  }

  &:hover:not(:disabled) {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 44%),
      linear-gradient(180deg, #fff 0%, #e7b6f6 34%, ${pink.deep} 58%, #5b32a4 100%);
  }

  &:active:not(:disabled) {
    transform: translateY(2px);
    background: linear-gradient(180deg, rgba(26, 18, 48, 0.28), rgba(255, 255, 255, 0.16) 46%), linear-gradient(180deg, #3d2470, ${pink.hot});
    box-shadow: inset 0 3px 6px rgba(26, 18, 48, 0.55), 0 1px 0 #2a1848;

    &::before {
      opacity: 0.35;
    }
  }

  &:disabled {
    opacity: 0.42;
    cursor: default;
    transform: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  &:focus-visible {
    outline: 2px solid ${pink.ink};
    outline-offset: 2px;
  }
`

/** Quieter raised face for the other controls, so the trait arrows stay the ones that pop. */
export const raisedButton = css`
  border: none;
  border-radius: 4px;
  background: linear-gradient(180deg, #fff 0%, ${pink.blush} 22%, ${pink.soft} 100%);
  color: ${pink.ink};
  box-shadow:
    inset 1px 1px 0 #fff,
    inset -1px -1px 0 ${pink.deep},
    0 1px 0 ${pink.edge};
  cursor: pointer;

  &:hover:not(:disabled) {
    background: linear-gradient(180deg, #fff 0%, #fff 16%, ${pink.blush} 100%);
  }

  &:active:not(:disabled),
  &[aria-pressed='true'] {
    color: #fff;
    text-shadow: ${outline};
    background: linear-gradient(180deg, ${pink.deep}, ${pink.hot});
    box-shadow: inset 0 2px 4px rgba(26, 18, 48, 0.45);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid ${pink.ink};
    outline-offset: 2px;
  }
`

export function Chevron({ dir }: { dir: 'left' | 'right' }) {
  const points = dir === 'left' ? '8,2 3.5,6 8,10' : '4,2 8.5,6 4,10'
  return (
    <svg viewBox="0 0 12 12" width="18" height="18" aria-hidden focusable="false">
      <polyline points={points} fill="none" stroke="#000" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

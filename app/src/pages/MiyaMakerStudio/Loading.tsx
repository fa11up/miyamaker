import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import styled from 'styled-components/macro'

import { font, space, text } from '@/theme/tokens'

import { pink } from './chrome'

const Veil = styled.div`
  position: absolute;
  z-index: 5;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${space[4]};
  background: ${pink.mist};
`

const Card = styled.div`
  width: min(420px, 100%);
  padding: ${space[5]};
  background: linear-gradient(180deg, #fff 0%, ${pink.blush} 28%, ${pink.soft} 100%);
  box-shadow:
    inset 0 1px 0 #fff,
    0 2px 0 ${pink.edge},
    0 10px 22px rgba(74, 52, 120, 0.35);
  color: ${pink.ink};
  font-family: ${font.ui};
  font-size: ${text.sm};

  h2 {
    margin: 0 0 ${space[2]};
    font-size: ${text.lg};
    font-weight: 400;
  }

  p {
    margin: 0;
    color: ${pink.inkMuted};
  }
`

const Track = styled.div`
  height: 22px;
  margin: ${space[4]} 0 ${space[2]};
  overflow: hidden;
  border-radius: 11px;
  background: ${pink.mist};
  box-shadow: inset 1px 1px 3px rgba(26, 18, 48, 0.35), inset -1px -1px 0 #fff;
`

const Fill = styled.span<{ $unknown: boolean; $pct: number }>`
  display: block;
  height: 100%;
  width: ${(p) => (p.$unknown ? '35%' : `${p.$pct}%`)};
  background: linear-gradient(180deg, #fff 0%, ${pink.mid} 40%, ${pink.hot} 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  ${(p) =>
    p.$unknown
      ? `
    animation: trait-load 1.1s ease-in-out infinite;
    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `
      : ''}

  @keyframes trait-load {
    from {
      transform: translateX(-120%);
    }
    to {
      transform: translateX(320%);
    }
  }
`

const Count = styled.p`
  font-variant-numeric: tabular-nums;
`

export type Gate = { label: string; done: number; total: number }

/** Covers the desk until the character pictures are ready. The title bar stays usable. */
export default function Loading({ label, done, total }: Gate) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const hold = (event: KeyboardEvent | PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <Veil
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="trait-loading-title"
      tabIndex={-1}
      data-testid="trait-loading"
      onKeyDown={hold}
      onKeyUp={hold}
      onPointerDown={hold}
    >
      <Card>
        <h2 id="trait-loading-title">Loading layers</h2>
        <p>{label}</p>
        <Track
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total > 0 ? total : undefined}
          aria-valuenow={total > 0 ? done : undefined}
          aria-valuetext={label}
        >
          <Fill $unknown={total === 0} $pct={pct} />
        </Track>
        <Count>{total > 0 ? `${done} of ${total}` : 'Reading the folders'}</Count>
      </Card>
    </Veil>
  )
}

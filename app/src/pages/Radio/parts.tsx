import WingHeartIcon from 'assets/miya_website_logo_2-removebg-preview.png?preset=icon&resize=true'
import type { ReactNode } from 'react'
import styled, { css } from 'styled-components/macro'

import { font } from '@/theme/tokens'

export const wingHeart = WingHeartIcon[0]

/** Shared building blocks of the miya radio skin. All colours come from the skin's CSS variables. */

const bevelOut = css`
  box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo),
    inset 2px 2px 0 rgba(255, 255, 255, 0.18), inset -2px -2px 0 rgba(0, 0, 0, 0.22);
`
const bevelIn = css`
  box-shadow: inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi),
    inset 2px 2px 0 rgba(0, 0, 0, 0.35);
`

export const PanelFrame = styled.section`
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 4px 4px;
  color: var(--rk-frame-ink);
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, var(--rk-frame), var(--rk-frame-2));
  ${bevelOut};
  &.grow {
    flex: 1 1 auto;
  }
  &.shaded {
    padding-bottom: 2px;
  }
`

const StripBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  margin: 0 -4px 4px;
  padding: 0 3px 0 4px;
  background: linear-gradient(90deg, var(--rk-strip-a), var(--rk-strip-b));
  color: var(--rk-strip-ink);
  font-family: ${font.ui};
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  user-select: none;
  .shaded > & {
    margin-bottom: 2px;
  }
  img {
    width: 16px;
    height: 16px;
    image-rendering: pixelated;
    filter: drop-shadow(0 0 1px var(--rk-strip-rule)) drop-shadow(0 0 2px rgba(0, 0, 0, 0.35));
  }
  .rule {
    flex: 1 1 12px;
    min-width: 8px;
    height: 7px;
    background: repeating-linear-gradient(180deg, var(--rk-strip-rule) 0 1px, transparent 1px 3px);
  }
  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.25);
  }
  .extra {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    letter-spacing: 0.06em;
    text-transform: none;
    opacity: 0.85;
  }
  @media (max-width: 768px) {
    height: 30px;
    font-size: 13px;
  }
`

const StripButton = styled.button`
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 14px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--rk-btn);
  color: var(--rk-btn-ink);
  cursor: pointer;
  ${bevelOut};
  svg {
    width: 8px;
    height: 8px;
  }
  &:active {
    ${bevelIn};
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-strip-ink);
    outline-offset: 1px;
  }
  @media (max-width: 768px) {
    width: 28px;
    height: 24px;
    svg {
      width: 10px;
      height: 10px;
    }
  }
`

const SHADE_PATH = { open: 'M1 6h6v1H1z', shade: 'M1 1h6v1H1zM1 2h1v5H1zM6 2h1v5H6zM1 6h6v1H1z' }

/** A panel's title strip: winged-heart badge, ruled lines, label, then windowshade / hide buttons. */
export function Strip({
  label,
  extra,
  shaded,
  onShade,
  onHide,
  panelId,
}: {
  label: string
  extra?: ReactNode
  shaded: boolean
  onShade: () => void
  onHide?: () => void
  panelId: string
}) {
  return (
    <StripBar onDoubleClick={onShade}>
      <img src={wingHeart?.src} srcSet={wingHeart?.srcset} alt="" />
      <span className="rule" />
      <span className="label">{label}</span>
      {extra && <span className="extra">{extra}</span>}
      <span className="rule" />
      <StripButton
        type="button"
        onClick={onShade}
        aria-expanded={!shaded}
        aria-controls={panelId}
        aria-label={shaded ? `Expand ${label}` : `Windowshade ${label}`}
        title={shaded ? 'Expand (double-click the strip)' : 'Windowshade (double-click the strip)'}
      >
        <svg viewBox="0 0 8 8" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
          <path d={shaded ? SHADE_PATH.shade : SHADE_PATH.open} />
        </svg>
      </StripButton>
      {onHide && (
        <StripButton type="button" onClick={onHide} aria-label={`Hide ${label}`} title={`Hide ${label}`}>
          <svg viewBox="0 0 8 8" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
            <path d="M1 1h1v1H1zM2 2h1v1H2zM3 3h2v2H3zM5 2h1v1H5zM6 1h1v1H6zM2 5h1v1H2zM1 6h1v1H1zM5 5h1v1H5zM6 6h1v1H6z" />
          </svg>
        </StripButton>
      )}
    </StripBar>
  )
}

export const Lcd = styled.div`
  position: relative;
  background: radial-gradient(120% 140% at 30% 0%, var(--rk-lcd-2), var(--rk-lcd) 60%);
  color: var(--rk-lcd-ink);
  ${bevelIn};
  box-shadow: inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi), inset 0 0 0 2px var(--rk-seam);
  /* faint scanlines */
  &::after {
    content: '';
    position: absolute;
    inset: 2px;
    pointer-events: none;
    background: repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px);
  }
`

export const Key = styled.button<{ $on?: boolean; $wide?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: ${({ $wide }) => ($wide ? '44px' : '30px')};
  height: 24px;
  padding: 0 7px;
  border: none;
  border-radius: 0;
  background: linear-gradient(180deg, var(--rk-frame-hi) -60%, var(--rk-btn) 45%, var(--rk-frame-2) 160%);
  color: var(--rk-btn-ink);
  font-family: ${font.ui};
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  ${bevelOut};
  svg {
    width: 11px;
    height: 11px;
  }
  &:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  &:active:not(:disabled),
  &[aria-pressed='true'] {
    ${bevelIn};
    background: linear-gradient(180deg, var(--rk-frame-2), var(--rk-btn));
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-btn-ink);
    outline-offset: -4px;
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  @media (max-width: 768px) {
    height: 34px;
    min-width: ${({ $wide }) => ($wide ? '48px' : '38px')};
  }
`

/** Little indicator lamp used on toggle keys. */
export const Led = styled.i<{ $on?: boolean }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  background: ${({ $on }) => ($on ? 'var(--rk-btn-on)' : 'rgba(0, 0, 0, 0.3)')};
  box-shadow: ${({ $on }) =>
    $on ? '0 0 4px var(--rk-btn-on), inset -1px -1px 0 rgba(0,0,0,0.25)' : 'inset 1px 1px 0 rgba(0,0,0,0.35)'};
`

/** Horizontal slider; set `--p` (0…1) via style for the filled part. `$center` fills out from the middle. */
export const Slider = styled.input.attrs({ type: 'range' })<{ $center?: boolean }>`
  --p: 0;
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 16px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  &::-webkit-slider-runnable-track {
    height: 6px;
    background: ${({ $center }) =>
      $center
        ? `linear-gradient(90deg, var(--rk-fill-b), var(--rk-fill-a) 50%, var(--rk-fill-b))`
        : `linear-gradient(90deg, var(--rk-fill-a), var(--rk-fill-b)) 0 0 / calc(var(--p) * 100%) 100% no-repeat, var(--rk-groove)`};
    box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.5), 0 1px 0 var(--rk-frame-hi);
  }
  &::-moz-range-track {
    height: 6px;
    background: ${({ $center }) =>
      $center
        ? `linear-gradient(90deg, var(--rk-fill-b), var(--rk-fill-a) 50%, var(--rk-fill-b))`
        : `linear-gradient(90deg, var(--rk-fill-a), var(--rk-fill-b)) 0 0 / calc(var(--p) * 100%) 100% no-repeat, var(--rk-groove)`};
    box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.5), 0 1px 0 var(--rk-frame-hi);
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 12px;
    margin-top: -3px;
    border: none;
    background: linear-gradient(90deg, transparent 6px, var(--rk-btn-on) 6px 8px, transparent 8px),
      linear-gradient(180deg, var(--rk-frame-hi), var(--rk-btn) 50%, var(--rk-frame-2));
    box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo), 0 0 0 1px var(--rk-seam);
  }
  &::-moz-range-thumb {
    width: 14px;
    height: 12px;
    border: none;
    border-radius: 0;
    background: linear-gradient(90deg, transparent 6px, var(--rk-btn-on) 6px 8px, transparent 8px),
      linear-gradient(180deg, var(--rk-frame-hi), var(--rk-btn) 50%, var(--rk-frame-2));
    box-shadow: inset 1px 1px 0 var(--rk-frame-hi), inset -1px -1px 0 var(--rk-frame-lo), 0 0 0 1px var(--rk-seam);
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-frame-ink);
    outline-offset: 1px;
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  @media (max-width: 768px) {
    height: 28px;
    &::-webkit-slider-thumb {
      width: 20px;
      height: 18px;
      margin-top: -6px;
    }
    &::-moz-range-thumb {
      width: 20px;
      height: 18px;
    }
  }
`

export const SliderLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: ${font.ui};
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--rk-frame-ink);
  > span {
    flex: 0 0 auto;
  }
`

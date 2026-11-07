import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components/macro'

import { bevel, color, font, space, text } from '@/theme/tokens'

/**
 * The miyanet's early-internet kit: a y2k sub-palette and the portal parts (boxes with title strips, blinking NEW!
 * tags, under-construction tape). Scoped to the miyanet window; everything else in miyaOS keeps the base tokens.
 * Every animation here stops under prefers-reduced-motion.
 */
export const y2k = {
  night: '#0d0828',
  nightMid: '#1f1257',
  headFrom: '#24135f',
  headTo: '#5b37b8',
  paper: color.well,
  paperAlt: '#f4e2ff',
  phosphor: '#9dffb0',
  lcd: '#ff4f8b',
  tape: '#ffd400',
  visited: '#6b1f9f',
  chrome: `linear-gradient(180deg, #ffffff 0%, #f5c6f6 38%, ${color.accent} 52%, #ffffff 62%, #c9b8ff 100%)`,
} as const

/**
 * Width of an element, kept current with a ResizeObserver. (usehooks-ts 2's useElementSize only listens to window
 * resizes, so it misses a miyaOS window being maximized or dragged bigger.)
 */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export const reducedMotion = '@media (prefers-reduced-motion: reduce)'

/** Tiled night sky: three layers of 1px stars plus a few pink ones, no image request. */
export const starfield = css`
  background-color: ${y2k.night};
  background-image: radial-gradient(1px 1px at 12px 18px, #ffffff 99%, transparent),
    radial-gradient(1px 1px at 70px 64px, #ffffffb0 99%, transparent),
    radial-gradient(1.5px 1.5px at 101px 22px, #f5c6f6 99%, transparent),
    radial-gradient(1px 1px at 40px 96px, #c9b8ff 99%, transparent),
    radial-gradient(1px 1px at 150px 120px, #ffffff 99%, transparent),
    radial-gradient(1.5px 1.5px at 170px 40px, #ffffff 99%, transparent),
    linear-gradient(180deg, ${y2k.night} 0%, ${y2k.nightMid} 100%);
  background-size: 120px 120px, 120px 120px, 120px 120px, 120px 120px, 190px 190px, 190px 190px, 100% 100%;
  background-attachment: local;
`

const blinkFrames = keyframes`
  50% { visibility: hidden; }
`

/** The blinking NEW! tag. Static under reduced motion. */
export const NewTag = styled.span`
  display: inline-block;
  padding: 1px 5px;
  font: bold 11px/1.3 Verdana, Tahoma, sans-serif;
  letter-spacing: 0.04em;
  color: #fff;
  background: #e0006b;
  border: 1px solid #fff;
  outline: 1px solid ${color.dark};
  transform: rotate(-4deg);
  animation: ${blinkFrames} 1s steps(1) infinite;
  ${reducedMotion} {
    animation: none;
  }
`

const BoxShell = styled.section`
  background: ${y2k.paper};
  box-shadow: ${bevel.raised};
  padding: 3px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  scroll-margin-top: ${space[2]};
`

const BoxHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  min-height: 30px;
  padding: ${space[1]} ${space[3]};
  background: linear-gradient(90deg, ${y2k.headFrom}, ${y2k.headTo});
  color: #fff;
  h2 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.lg};
    letter-spacing: 0.04em;
    text-shadow: 1px 1px 0 ${color.dark};
  }
  .aside {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: ${space[2]};
  }
`

const BoxBody = styled.div`
  padding: ${space[3]};
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  min-width: 0;
`

/** An old-portal content box: a gradient title strip over a light, beveled body. */
export function PortalBox({
  id,
  title,
  icon,
  aside,
  label,
  children,
  className,
  style,
  art,
}: {
  id?: string
  title: ReactNode
  icon?: ReactNode
  aside?: ReactNode
  label?: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** A site's generative art, in white on nothing, worked into the title strip. */
  art?: string
}) {
  return (
    <BoxShell id={id} aria-label={label} className={className} style={style}>
      <BoxHead
        style={
          art
            ? { background: `url(${art}) right center / 320px, linear-gradient(90deg, ${y2k.headFrom}, ${y2k.headTo})` }
            : undefined
        }
      >
        {icon}
        <h2>{title}</h2>
        {aside && <div className="aside">{aside}</div>}
      </BoxHead>
      <BoxBody>{children}</BoxBody>
    </BoxShell>
  )
}

const tapeSlide = keyframes`
  to { background-position: 28px 0; }
`

/** Yellow-and-black under-construction tape. Use once. */
export const UnderConstruction = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font: bold 11px/1.3 Verdana, Tahoma, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${color.dark};
  background: repeating-linear-gradient(-45deg, ${y2k.tape} 0 10px, ${color.dark} 10px 14px);
  background-size: 28px 100%;
  animation: ${tapeSlide} 1.4s linear infinite;
  span {
    background: ${y2k.tape};
    padding: 0 4px;
  }
  ${reducedMotion} {
    animation: none;
  }
`

/** Old-school table of label/value rows inside a sunken well. */
export const DataTable = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: #fff;
  box-shadow: ${bevel.sunken};
  padding: 2px;
  font-size: ${text.sm};
  th,
  td {
    padding: 5px ${space[2]};
    border-bottom: 1px dotted #cdb8f5;
    vertical-align: baseline;
  }
  tr:last-child th,
  tr:last-child td {
    border-bottom: none;
  }
  th {
    text-align: left;
    font-weight: 400;
    color: ${color.inkMuted};
  }
  td {
    text-align: right;
    font-weight: 700;
    color: ${color.ink};
    font-variant-numeric: tabular-nums;
  }
`

/** Plain reading text for box bodies. */
export const Prose = styled.div`
  font-family: ${font.body};
  font-size: ${text.sm};
  line-height: 1.6;
  color: ${color.ink};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  max-width: 68ch;
  /* the OS sets W95FA on every element; reading text keeps the body face all the way down */
  p,
  strong,
  em,
  b,
  span,
  li {
    font-family: inherit;
  }
  p {
    margin: 0;
  }
  a {
    color: ${color.link};
  }
  a:visited {
    color: ${y2k.visited};
  }
`

/** Win95 push button for secondary actions (the pink one is reserved for the claim). */
export const PushButton = styled.button`
  border: none;
  border-radius: 0;
  min-height: 32px;
  padding: ${space[1]} ${space[3]};
  background: linear-gradient(180deg, #ffd6f7 0%, ${color.accent} 100%);
  color: ${y2k.night};
  font-family: ${font.ui};
  font-size: ${text.sm};
  box-shadow: inset 1px 1px #fff, inset -1px -1px ${color.accentDark}, 0 0 0 1px ${y2k.night};
  cursor: pointer;
  &:hover:not(:disabled) {
    background: linear-gradient(180deg, #fff0fb 0%, #eaa0ea 100%);
  }
  &:active:not(:disabled) {
    box-shadow: inset 1px 1px ${color.accentDark}, inset -1px -1px #fff, 0 0 0 1px ${y2k.night};
  }
  &:disabled {
    background: linear-gradient(180deg, ${y2k.headTo} 0%, ${y2k.headFrom} 100%);
    color: #d6c8ff;
    cursor: not-allowed;
  }
`

/** Row of plain links and push buttons. */
export const LinkRow = styled.div`
  display: flex;
  gap: ${space[3]};
  flex-wrap: wrap;
  align-items: center;
  a {
    color: ${color.link};
  }
`

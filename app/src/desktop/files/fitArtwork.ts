/**
 * How big to show a file's artwork in its popup, from the picture's real shape and the room on the desktop. Tall and square
 * pieces sit beside their details; wide ones sit on top of them. Pure, so `node --test` can load it.
 */
export type Size = { w: number; h: number }
export type ArtFit = { art: Size; layout: 'beside' | 'stacked'; width: number }

/** The title bar and the padding around the content. */
const CHROME_H = 50
const PAD = 24
const GAP = 12
const INFO_W = 250
/** Enough for a stacked popup's details and buttons; more than this scrolls inside them. */
const INFO_H = 210
const TALLEST = 460
const WIDEST = 640
const SMALLEST = 80
const STACKED_MIN_W = 360
/** At this shape or wider, the details read better underneath. */
const WIDE_RATIO = 1.25

const within = (ratio: number, maxW: number, maxH: number): Size => {
  const w = Math.max(SMALLEST, Math.min(maxW, maxH * ratio))
  return { w: Math.round(w), h: Math.round(Math.max(SMALLEST, w / ratio)) }
}

export function fitArtwork(natural: Size | undefined, room: Size): ArtFit {
  // No size yet, or a picture with none of its own such as some SVGs: a square until it is known.
  const ratio = natural && natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 1
  const besideMaxW = room.w - PAD - GAP - INFO_W
  if (ratio < WIDE_RATIO && besideMaxW >= 160) {
    const art = within(ratio, Math.min(WIDEST, besideMaxW), Math.min(TALLEST, room.h - CHROME_H))
    return { art, layout: 'beside', width: art.w + GAP + INFO_W + PAD }
  }
  const art = within(ratio, Math.min(WIDEST, room.w - PAD), Math.min(TALLEST, room.h - CHROME_H - INFO_H))
  return { art, layout: 'stacked', width: Math.min(room.w, Math.max(art.w + PAD, STACKED_MIN_W)) }
}

/** Blocky upscaling flatters small pixel art and ruins a big photo. */
export const isPixelArt = (natural: Size | undefined) => !!natural && Math.max(natural.w, natural.h) <= 256

import type { CrestParams } from './surface'

/**
 * What the desktop wave is doing right now, for anything that wants to play with it (the pet).
 * Written by WaveBackground, read every frame by readers: plain mutable object, no React.
 *
 *  - `status`: 'off' (wave button off), 'webgl' (animated shader), 'still' (shader, one frame:
 *    reduced motion), 'fallback' (no WebGL: static CSS wave drawn from the same crest params)
 *  - `frameTime`: the `t` of the frame on screen. Readers pass it to crestHeight() so they match
 *    the drawn foam line exactly, even when the shader runs below the display rate.
 *  - `bottom`: viewport y (CSS px) of the canvas bottom; crest heights are measured up from it.
 */
export type WaveStatus = 'off' | 'webgl' | 'still' | 'fallback'

export const waveBus: {
  status: WaveStatus
  params: CrestParams | undefined
  frameTime: number
  bottom: number
} = {
  status: 'off',
  params: undefined,
  frameTime: 0,
  bottom: 0,
}

/** True when there is a crest on screen to ride. */
export function waveRideable(): boolean {
  return waveBus.status !== 'off' && !!waveBus.params
}

/** What is playing right now (the radio, miyaTV's picture), so the screensaver doesn't come down over it. */
const playing = new Set<string>()

export function setPlaying(source: string, on: boolean) {
  if (on) playing.add(source)
  else playing.delete(source)
}

export const anythingPlaying = () => playing.size > 0

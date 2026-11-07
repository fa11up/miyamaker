import { createContext, useContext } from 'react'

import type { Layout, Part } from './scene'

/** What the shell's buttons do whichever collection is up: move to another, open the menu, leave. */
export type HandheldNav = {
  /** Next or previous collection. Undefined with only one to move between. */
  swap?: (step: number) => void
  openMenu: () => void
  close: () => void
  minimize: () => void
  /** A mint is out and its screen must stay: nothing leaves it until `hold`'s release is called. */
  held?: boolean
  hold?: () => () => void
}

const nothing = () => {}
export const HandheldContext = createContext<HandheldNav>({ openMenu: nothing, close: nothing, minimize: nothing })
export const useHandheld = () => useContext(HandheldContext)

/** The 3D body behind the view: where its controls are, and what they are doing. */
export type Body3D = {
  ready: boolean
  report: (layout: Layout) => void
  press: (part: Part, down: boolean) => void
  setSwitch: (off: boolean) => void
  setSave: (inward: boolean) => void
  /** Keeps the device square on to the viewer, for the opening. */
  setHold: (hold: boolean) => void
}
export const Body3DContext = createContext<Body3D>({
  ready: false,
  report: nothing,
  press: nothing,
  setSwitch: nothing,
  setSave: nothing,
  setHold: nothing,
})
export const useBody3D = () => useContext(Body3DContext)

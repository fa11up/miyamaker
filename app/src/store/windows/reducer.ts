import { createReducer } from '@reduxjs/toolkit'

import Pages from '@/constants/pages'
import { globalNavigate } from '@/GlobalHistory'

import {
  closeWindow,
  deleteUploadOrder,
  finalizeUploadOrder,
  minimizeWindow,
  openWindow,
  setAlwaysOnTop,
  setToFront,
  toggleFullscreen,
  updateWindowPosition,
  updateWindowSize,
} from './actions'
import { closed, minimized, raised } from './stack'

export type PageKey = Extract<keyof typeof Pages, string>

/** Navigate to a window's path, unless the address bar is already on a sub-path of it (/mint/miyamini for Mint). */
function navigateToPage(path: string) {
  const current = typeof window !== 'undefined' ? window.location.pathname : ''
  if (current === path || current.startsWith(`${path}/`)) return
  globalNavigate(path)
}

export interface UserState {
  active: PageKey[]
  zIndex: PageKey[]
  fullScreen: PageKey[]
  minimized: PageKey[]
  onTop?: PageKey[]
  position: { [key: PageKey]: { x: number; y: number } }
  /** Sizes people dragged a window to; kept after it closes so it reopens the same size. */
  size?: { [key: PageKey]: { width: number; height: number } }
  uploadRequests: Record<string, { requestFrom: string; timestamp: number; label?: string; result?: any; value?: any }>
}

export const initialState: UserState = {
  active: [],
  zIndex: [],
  fullScreen: [],
  minimized: [],
  position: {},
  uploadRequests: {},
}

export default createReducer(initialState, (builder) =>
  builder
    .addCase(openWindow, (state, action) => {
      if (state.active.includes(action.payload.value)) return
      const { value: page, position } = action.payload
      state.position[page] = position
      state.active.push(page)
      state.zIndex.push(page)
      state.minimized = state.minimized.filter((id) => id !== page)
      const { path } = Pages[page]!
      navigateToPage(path)
    })
    .addCase(closeWindow, (state, action) => {
      const { value } = action.payload
      Object.assign(state, closed(state, value))
      delete state.position[value]

      const path = Pages[state.zIndex[state.zIndex.length - 1] || '']?.path
      globalNavigate(path || '/')
    })
    .addCase(finalizeUploadOrder, (state, action) => {
      const { requestFrom, result } = action.payload
      Object.assign(state, closed(state, 'uploader'))
      delete state.position.uploader
      if (state.uploadRequests[requestFrom]) {
        state.uploadRequests[requestFrom]!.result = result
      }

      const path = Pages[requestFrom || '']?.path
      globalNavigate(path || '/')
    })
    .addCase(deleteUploadOrder, (state, action) => {
      const { requestFrom } = action.payload
      delete state.uploadRequests[requestFrom]
    })
    .addCase(updateWindowPosition, (state, action) => {
      const { value: page, position } = action.payload
      if (position && (position.x < 0 || position.y < 0)) return
      state.position[page] = position
    })
    .addCase(updateWindowSize, (state, action) => {
      const { value: page, size } = action.payload
      if (!(size.width > 0 && size.height > 0)) return
      state.size = { ...(state.size ?? {}), [page]: size }
    })
    .addCase(toggleFullscreen, (state, action) => {
      const { value: page } = action.payload
      state.fullScreen = state.fullScreen.includes(page)
        ? state.fullScreen.filter((id) => id !== page)
        : [...state.fullScreen, page]
    })
    .addCase(setAlwaysOnTop, (state, action) => {
      const { value, on } = action.payload
      const others = (state.onTop ?? []).filter((id) => id !== value)
      state.onTop = on ? [...others, value] : others
    })
    .addCase(setToFront, (state, action) => {
      const { value: page } = action.payload
      // A click that closed a window bubbles up to raise it too: it has to stay closed.
      if (!state.active.includes(page)) return
      Object.assign(state, raised(state, page))

      const { path } = Pages[page]!
      navigateToPage(path)
    })
    .addCase(minimizeWindow, (state, action) => {
      const { value: page } = action.payload
      if (!state.active.includes(page) || state.minimized.includes(page)) return
      Object.assign(state, minimized(state, page))

      const path = Pages[state.zIndex[state.zIndex.length - 1] || '']?.path
      globalNavigate(path || '/')
    })
)

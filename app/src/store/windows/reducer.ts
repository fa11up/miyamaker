import { createReducer } from '@reduxjs/toolkit'

import Pages from '@/constants/pages'
import { globalNavigate } from '@/GlobalHistory'

import {
  closeWindow,
  createUploadOrder,
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
      const { path } = Pages[page]!
      navigateToPage(path)
    })
    .addCase(closeWindow, (state, action) => {
      const { value } = action.payload
      state.active = state.active.filter((page) => page !== value)
      state.zIndex = state.zIndex.filter((id) => id !== value)
      state.fullScreen = state.fullScreen.filter((id) => id !== value)
      delete state.position[value]

      const path = Pages[state.zIndex[state.zIndex.length - 1] || '']?.path
      globalNavigate(path || '/')
    })
    .addCase(createUploadOrder, (state, action) => {
      if (state.active.includes('uploader')) return
      const { requestFrom, label, timestamp } = action.payload
      if (state.position[requestFrom]) {
        state.position.uploader = state.position[requestFrom]!
      } else {
        state.position.uploader = { x: 0, y: 0 }
      }

      state.active.push('uploader')
      state.zIndex.push('uploader')
      if (state.fullScreen.includes('requestFrom')) {
        state.fullScreen.push('uploader')
      }

      state.uploadRequests[requestFrom] = { requestFrom, label, timestamp }
      const { path } = Pages.uploader!
      globalNavigate(path)
    })
    .addCase(finalizeUploadOrder, (state, action) => {
      const { requestFrom, result } = action.payload
      state.active = state.active.filter((page) => page !== 'uploader')
      state.zIndex = state.zIndex.filter((id) => id !== 'uploader')
      state.fullScreen = state.fullScreen.filter((id) => id !== 'uploader')
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
      if (state.minimized.includes(page)) {
        state.minimized = state.minimized.filter((id) => id !== page)
      }

      state.zIndex = state.zIndex.filter((id) => id !== page)
      state.zIndex.push(page)

      const { path } = Pages[page]!
      navigateToPage(path)
    })
    .addCase(minimizeWindow, (state, action) => {
      const { value: page } = action.payload
      state.zIndex = state.zIndex.filter((id) => id !== page)
      state.minimized = state.minimized.includes(page)
        ? state.minimized.filter((id) => id !== page)
        : [...state.minimized, page]

      const path = Pages[state.zIndex[state.zIndex.length - 1] || '']?.path
      globalNavigate(path || '/')
    })
)

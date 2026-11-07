import { createAction } from '@reduxjs/toolkit'

import type { PageKey } from './reducer'

export const openWindow = createAction<{ value: PageKey; position: { x: number; y: number } }>('windows/openWindow')
export const closeWindow = createAction<{ value: PageKey }>('windows/closeWindow')
export const updateWindowPosition = createAction<{ value: PageKey; position: { x: number; y: number } }>(
  'windows/updateWindowPosition'
)
export const updateWindowSize = createAction<{ value: PageKey; size: { width: number; height: number } }>(
  'windows/updateWindowSize'
)
export const toggleFullscreen = createAction<{ value: PageKey }>('windows/toggleFullscreen')
export const setToFront = createAction<{ value: PageKey }>('windows/setToFront')
/** Only ever puts the window away. `setToFront` brings it back. */
export const minimizeWindow = createAction<{ value: PageKey }>('windows/minimizeWindow')
export const setAlwaysOnTop = createAction<{ value: PageKey; on: boolean }>('windows/setAlwaysOnTop')
export const finalizeUploadOrder = createAction<{ requestFrom: string; result: string }>('windows/finalizeUploadOrder')
export const deleteUploadOrder = createAction<{ requestFrom: string }>('windows/deleteUploadOrder')

import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query/react'
import { load, save } from 'redux-localstorage-simple'

import Pages from '@/constants/pages'

import experience from './experience/reducer'
import windows from './windows/reducer'
import auction from './auction/reducer'
import collections from './collections/reducer'

const PERSISTED_KEYS: string[] = ['experience', 'windows', 'auction', 'collections']

const saved = load({ states: PERSISTED_KEYS, disableWarnings: import.meta.env.NODE_ENV === 'test' })

// A saved session can still hold a window that no longer exists, and every open window needs its page.
const savedWindows = (saved as { windows?: Record<string, unknown> }).windows
if (savedWindows) {
  for (const key of ['active', 'zIndex', 'fullScreen', 'minimized', 'onTop']) {
    const list = savedWindows[key]
    if (Array.isArray(list)) savedWindows[key] = list.filter((id) => id in Pages)
  }
}

const store = configureStore({
  reducer: {
    experience,
    windows,
    auction,
    collections,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ thunk: true }).concat(save({ states: PERSISTED_KEYS, debounce: 250 })),
  preloadedState: saved,
})

setupListeners(store.dispatch)

export default store

export type AppState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

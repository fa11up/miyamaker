import { useCallback } from 'react'

import Pages from '@/constants/pages'
import { useAppDispatch } from '@/store/hooks'
import { openWindow, setToFront } from '@/store/windows/actions'
import { useWindows } from '@/store/windows/hooks'

/** Opens (or focuses) another miyaOS window from inside a window or the taskbar, centred like the desktop does. */
export function useOpenApp() {
  const dispatch = useAppDispatch()
  const [windows] = useWindows()
  return useCallback(
    (id: string) => {
      if (windows.includes(id)) {
        dispatch(setToFront({ value: id }))
        return
      }

      const page = Pages[id]
      if (!page) return
      const w = window.innerWidth
      const h = window.innerHeight - 34
      dispatch(
        openWindow({
          value: id,
          position: {
            x: Math.max(0, Math.round(w / 2 - page.minSize.width / 2)),
            y: Math.max(0, Math.round(h / 2 - page.minSize.height / 2)),
          },
        })
      )
    },
    [dispatch, windows]
  )
}

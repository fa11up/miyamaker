import { useCallback } from 'react'

import Pages from '@/constants/pages'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { openWindow, setToFront } from '@/store/windows/actions'

/** Open (or focus) a miyaOS window by page id, centred like the desktop icons do it. */
export function useOpenApp() {
  const dispatch = useAppDispatch()
  const active = useAppSelector((state) => state.windows.active)
  return useCallback(
    (id: string) => {
      if (active.includes(id)) {
        dispatch(setToFront({ value: id }))
        return
      }

      const page = Pages[id]
      if (!page) return
      const width = window.innerWidth
      const height = window.innerHeight
      dispatch(
        openWindow({
          value: id,
          position: {
            x: Math.max(0, width / 2 - page.minSize.width / 2),
            y: Math.max(0, (height - 34) / 2 - page.minSize.height / 2),
          },
        })
      )
    },
    [active, dispatch]
  )
}

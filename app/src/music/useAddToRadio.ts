import { useCallback } from 'react'

import { useRadio } from '@/context/RadioProvider'

import type { Track } from './types'
import { useOpenApp } from './useOpenApp'

/** Queues tracks and brings the radio up, so the click visibly lands. Returns how many were new to the queue. */
export function useAddToRadio() {
  const radio = useRadio()
  const openApp = useOpenApp()
  return useCallback(
    (tracks: Track | Track[]) => {
      const list = Array.isArray(tracks) ? tracks : [tracks]
      const added = list.filter((t) => !radio.queue.tracks.some((q) => q.id === t.id)).length
      radio.enqueue(list)
      openApp('radio')
      return added
    },
    [radio, openApp]
  )
}

import { useCallback } from 'react'

import { useRadio } from '@/context/RadioProvider'

import type { Track } from './types'

/** Queues tracks on the radio, which plays on from the taskbar. Returns how many were new to the queue. */
export function useAddToRadio() {
  const radio = useRadio()
  return useCallback(
    (tracks: Track | Track[]) => {
      const list = Array.isArray(tracks) ? tracks : [tracks]
      const added = list.filter((t) => !radio.queue.tracks.some((q) => q.id === t.id)).length
      radio.enqueue(list)
      return added
    },
    [radio]
  )
}

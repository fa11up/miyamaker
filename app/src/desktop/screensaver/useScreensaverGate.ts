import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DESKTOP_EVENTS } from '../prefs'
import { idleRemaining, isTextEntry } from './idle'
import { anythingPlaying } from './playing'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/** Is a wallet prompt / modal on screen? (RainbowKit and @reach/dialog both mark theirs aria-modal) */
function modalOpen() {
  return !!document.querySelector('[aria-modal="true"]')
}

/**
 * Decides when the screensaver runs. Activity anywhere resets the timer; it never starts while a
 * text field is focused, a dialog/wallet prompt is open, a wallet request is pending (wagmi
 * mutations), a transaction is being confirmed (wagmi receipt queries), or the radio or miyaTV is playing.
 */
export function useScreensaverGate({ enabled, delayMinutes }: { enabled: boolean; delayMinutes: number }) {
  const [active, setActive] = useState<false | 'idle' | 'preview'>(false)
  const lastActivity = useRef(Date.now())
  const mutating = useIsMutating()
  const confirming = useIsFetching({ queryKey: ['waitForTransactionReceipt'] })
  const busy = useRef(false)
  busy.current = mutating > 0 || confirming > 0

  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now()
    }

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, bump, { passive: true, capture: true }))
    return () => ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, bump, { capture: true }))
  }, [])

  useEffect(() => {
    if (active) return undefined
    const check = () => {
      if (document.hidden) {
        lastActivity.current = Date.now()
        return
      }

      const blocked =
        busy.current || anythingPlaying() || isTextEntry(document.activeElement as HTMLElement | null) || modalOpen()
      if (blocked) lastActivity.current = Date.now()
      const remaining = idleRemaining({
        now: Date.now(),
        lastActivity: lastActivity.current,
        delayMs: delayMinutes * 60_000,
        enabled,
        blocked,
      })
      if (remaining === 0) setActive('idle')
    }

    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [active, enabled, delayMinutes])

  useEffect(() => {
    const onPreview = () => setActive('preview')
    window.addEventListener(DESKTOP_EVENTS.screensaverPreview, onPreview)
    return () => window.removeEventListener(DESKTOP_EVENTS.screensaverPreview, onPreview)
  }, [])

  const dismiss = useCallback(() => {
    lastActivity.current = Date.now()
    setActive(false)
  }, [])

  return { active, dismiss }
}

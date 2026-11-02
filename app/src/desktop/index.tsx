import { useCallback } from 'react'

import DesktopContextMenu from './ContextMenu'
import MintFeed from './mints/MintFeed'
import DesktopPet from './pet/DesktopPet'
import { getPet } from './pet/registry'
import { useDesktopPrefs } from './prefs'
import Screensaver from './screensaver/Screensaver'
import { useScreensaverGate } from './screensaver/useScreensaverGate'

/**
 * miyaOS desktop extras. Two mount points so the OS shell only gains two lines:
 *  - <DesktopPetLayer/> inside the Foreground, after the icons (above icons, below windows)
 *  - <DesktopOverlays/> at the end of the OS root (toasts, screensaver, context menu)
 */
export function DesktopPetLayer() {
  const prefs = useDesktopPrefs()
  if (!prefs.petEnabled) return null
  const pet = getPet(prefs.petId)
  return <DesktopPet key={pet.id} pet={pet} />
}

export function DesktopOverlays() {
  const prefs = useDesktopPrefs()
  const { active, dismiss } = useScreensaverGate({
    enabled: prefs.screensaverEnabled,
    delayMinutes: prefs.screensaverDelay,
  })
  const onDismiss = useCallback(() => dismiss(), [dismiss])
  return (
    <>
      <MintFeed enabled={prefs.mintFeedEnabled} />
      <DesktopContextMenu />
      {active && <Screensaver onDismiss={onDismiss} />}
    </>
  )
}

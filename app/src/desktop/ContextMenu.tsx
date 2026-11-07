import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { useOpenApp } from '@/music/useOpenApp'
import { bevel, color, MOBILE_BREAKPOINT, space, text } from '@/theme/tokens'

import { DESKTOP_EVENTS, setPrefs, startScreensaverPreview, useDesktopPrefs } from './prefs'
import { getPet, nextVariant } from './pet/registry'

const Menu = styled.div`
  position: fixed;
  z-index: 100700;
  min-width: 200px;
  padding: 3px;
  background: ${color.face};
  box-shadow: ${bevel.raised}, 2px 3px 0 rgba(20, 16, 31, 0.25);
  font-size: ${text.sm};
  button {
    display: block;
    width: 100%;
    padding: ${space[1]} ${space[5]};
    border: none;
    background: transparent;
    color: ${color.ink};
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      background: ${color.titleTo};
      color: ${color.highlight};
      outline: none;
    }
  }
  hr {
    margin: 3px 2px;
    border: none;
    border-top: 1px solid ${color.shadow};
    border-bottom: 1px solid ${color.highlight};
  }
`

/** The desktop is whatever inside the OS isn't a window, the taskbar or a form control. */
function isDesktopTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el || !el.closest) return false
  if (!el.closest('.bwindow')) return false
  if (el.closest('.react-draggable, input, textarea, select, a, [contenteditable="true"]')) return false
  return true
}

/** Right-click on the desktop: pet / screensaver / display shortcuts. */
export default function DesktopContextMenu() {
  const prefs = useDesktopPrefs()
  const openApp = useOpenApp()
  const [pos, setPos] = useState<{ x: number; y: number }>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (!isDesktopTarget(e.target)) return
      const taskbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--taskbar-h')) || 34
      if (e.clientY > window.innerHeight - taskbar) return
      e.preventDefault()
      const w = 220
      const h = 200
      setPos({ x: Math.min(e.clientX, window.innerWidth - w - 4), y: Math.min(e.clientY, window.innerHeight - h - 4) })
    }

    window.addEventListener('contextmenu', onContext)
    return () => window.removeEventListener('contextmenu', onContext)
  }, [])

  useEffect(() => {
    if (!pos) return undefined
    ref.current?.querySelector('button')?.focus()
    const close = (e: Event) => {
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return
      setPos(undefined)
    }

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(undefined)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  if (!pos) return null
  const mobile = window.innerWidth <= MOBILE_BREAKPOINT
  const pet = getPet(prefs.petId)
  const looks = !!pet.variants?.length
  // the pet layer marks the look on screen (a random one when none was chosen)
  const currentLook =
    prefs.petVariant || document.querySelector<HTMLElement>('[data-desktop-pet]')?.dataset.petVariant || undefined
  const run = (fn: () => void) => () => {
    setPos(undefined)
    fn()
  }

  return (
    <Menu ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} data-desktop-menu="">
      {!mobile && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => window.dispatchEvent(new CustomEvent(DESKTOP_EVENTS.arrangeIcons)))}
          >
            Arrange icons
          </button>
          <hr />
        </>
      )}
      <button type="button" role="menuitem" onClick={run(() => setPrefs({ petEnabled: !prefs.petEnabled }))}>
        {prefs.petEnabled ? 'Hide desktop pet' : 'Show desktop pet'}
      </button>
      {prefs.petEnabled && looks && (
        <button
          type="button"
          role="menuitem"
          onClick={run(() => setPrefs({ petVariant: nextVariant(pet, currentLook)?.id || '' }))}
        >
          Next {pet.name} look
        </button>
      )}
      <button type="button" role="menuitem" onClick={run(() => window.setTimeout(startScreensaverPreview, 150))}>
        Start screen saver
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={run(() => openApp('files'))}>
        My Files
      </button>
      <button type="button" role="menuitem" onClick={run(() => openApp('display'))}>
        Properties
      </button>
    </Menu>
  )
}

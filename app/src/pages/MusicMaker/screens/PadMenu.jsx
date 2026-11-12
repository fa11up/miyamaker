import { useEffect, useState } from 'react'
import { model, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { closePadMenu, copyPad, getPadMenu, padClipReady, pastePad, subscribePadMenu } from '../padEdit.js'

export function PadMenu() {
  useModel()
  const [menu, setMenu] = useState(getPadMenu)
  useEffect(() => subscribePadMenu(() => setMenu(getPadMenu())), [])
  useEffect(() => {
    if (!menu) return undefined
    const down = (event) => {
      const path = event.composedPath?.() || []
      if (path.some((node) => node.classList?.contains?.('pad-menu'))) return
      closePadMenu()
    }
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closePadMenu()
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [menu])
  if (!menu) return null
  const pad = model.pads[menu.index]
  const filled = !!pad && pad.source !== 'empty'
  const canPaste = padClipReady()
  const run = (fn) => {
    if (!menu.ready) return
    closePadMenu()
    Promise.resolve(fn()).catch((error) => {
      model.browserNote = error.message || 'Could not paste that pad'
      touch(false)
    })
  }
  return (
    <div className="ctx-menu pad-menu" style={{ left: menu.x, top: menu.y }} role="menu">
      <button type="button" role="menuitem" onClick={() => run(() => copyPad(menu.index))}>
        Copy pad
      </button>
      <button type="button" role="menuitem" disabled={!canPaste} onClick={() => run(() => pastePad(menu.index))}>
        {filled ? 'Paste & replace' : 'Paste'}
      </button>
    </div>
  )
}

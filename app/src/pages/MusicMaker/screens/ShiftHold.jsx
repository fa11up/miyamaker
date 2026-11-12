import { useEffect, useState } from 'react'
import { finger } from './Tracker.jsx'

const SHIFT_LABEL = 'Shift. Hold and drag the tracker to edit. Hold it with a numpad slot, then − or +, to bend that slot. Shift-click the surface button to open its list.'

export function ShiftHold({ className = '', mark = true }) {
  const [on, setOn] = useState(false)
  const release = () => {
    finger.shift = false
    setOn(false)
  }
  useEffect(() => () => { finger.shift = false }, [])
  return (
    <button
      type="button"
      className={`btn shift-hold ${className} ${on ? 'on' : ''}`}
      data-coach={mark ? 'shift' : undefined}
      aria-pressed={on}
      aria-label={SHIFT_LABEL}
      title={SHIFT_LABEL}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already gone */ }
        finger.shift = true
        setOn(true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      SHIFT
    </button>
  )
}

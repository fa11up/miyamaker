import type { RefObject } from 'react'
import { useLayoutEffect, useState } from 'react'

import { DESCRIPTION_SIZES, pickFitSize } from '@/pages/Auction/fitText'

/**
 * Steps the font size of the text in `ref` down until it fits its box, and re-fits whenever the text or the space
 * around it changes. The box should be allowed to shrink (`flex: 0 1 auto; min-height: 0; overflow: hidden`) inside
 * a parent whose height does not depend on the text. Where the box simply grows with its content (phones) the first
 * size always fits. If even the smallest size is too long the text is cut at a whole line with an ellipsis and
 * `overflow` is set, so the caller can offer the full text elsewhere.
 */
export function useFitText(ref: RefObject<HTMLElement>, text: string, sizes: readonly number[] = DESCRIPTION_SIZES) {
  const [fit, setFit] = useState({ size: sizes[0] ?? 15, overflow: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const measure = () => {
      el.style.removeProperty('display')
      el.style.removeProperty('-webkit-box-orient')
      el.style.removeProperty('-webkit-line-clamp')
      const result = pickFitSize(sizes, (size) => {
        el.style.fontSize = `${size}px`
        return el.scrollHeight <= el.clientHeight + 1
      })
      el.style.fontSize = `${result.size}px`
      if (result.overflow) {
        // Still too long at the smallest size: end on a whole line with an ellipsis rather than a half-cut row.
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || result.size * 1.3
        el.style.display = '-webkit-box'
        el.style.setProperty('-webkit-box-orient', 'vertical')
        el.style.setProperty('-webkit-line-clamp', `${Math.max(1, Math.floor(el.clientHeight / lineHeight))}`)
      }

      setFit((prev) => (prev.size === result.size && prev.overflow === result.overflow ? prev : result))
    }

    measure()
    // The pixel font may load after first paint and change every line break.
    let live = true
    document.fonts?.ready.then(() => live && measure()).catch(() => undefined)

    // Watch the parent: its size comes from the window, not from the text, so re-fitting cannot feed back into it.
    const parent = el.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') {
      return () => {
        live = false
      }
    }

    let last = `${parent.clientWidth}x${parent.clientHeight}`
    const ro = new ResizeObserver(() => {
      const now = `${parent.clientWidth}x${parent.clientHeight}`
      if (now === last) return
      last = now
      measure()
    })
    ro.observe(parent)
    return () => {
      live = false
      ro.disconnect()
    }
    // Re-runs when `overflow` flips too: the caller's "read more" link takes room from the box.
  }, [ref, text, sizes, fit.overflow])

  return fit
}

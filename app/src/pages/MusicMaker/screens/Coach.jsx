import { useEffect, useRef, useState } from 'react'
import { COACH } from '../coachTopics.js'
import { model, setScreen, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { ChromeGlyph } from '../widgets.jsx'

/** A picture of a control. It does not press the real one. */
export function CoachChip({ label, kind }) {
  if (kind === 'pad') return <span className="coach-pad" aria-hidden="true">{label}</span>
  if (kind === 'knob') return <span className="coach-knob" aria-hidden="true"><i />{label}</span>
  if (kind === 'num') return <span className="coach-num" aria-hidden="true">{label}</span>
  const rec = kind === 'rec'
  return <span className={`btn free-width coach-chip${rec ? ' rec on' : ''}`} aria-hidden="true">{label}</span>
}

function hostRoot() {
  return document.querySelector('[data-miya-music]')?.shadowRoot?.querySelector('.mmm') || null
}

function visibleCoach(root, pin) {
  if (!root || !pin) return null
  const list = [...root.querySelectorAll(`[data-coach="${pin}"]`)]
  return list.find((el) => el.getClientRects().length > 0) || list[0] || null
}

export function CoachLayer() {
  useModel()
  const topicId = model.coachTopic
  const topic = COACH[topicId]
  const cardRef = useRef(null)
  const [pos, setPos] = useState({ x: 18, y: 44 })
  const [pin, setPin] = useState('')
  const [mark, setMark] = useState(null)
  const drag = useRef(null)

  useEffect(() => {
    setPin('')
    setMark(null)
  }, [topicId])

  useEffect(() => {
    if (!topicId || !COACH[topicId]) return undefined
    const down = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      model.coachTopic = ''
      touch(false)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [topicId])

  useEffect(() => {
    if (!pin || !topic) return undefined
    let frame = 0
    const measure = () => {
      const root = hostRoot()
      const card = cardRef.current
      const target = visibleCoach(root, pin)
      if (!root || !card || !target) {
        setMark(null)
        return
      }
      const rootRect = root.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      const box = {
        left: targetRect.left - rootRect.left,
        top: targetRect.top - rootRect.top,
        width: targetRect.width,
        height: targetRect.height,
      }
      const from = nearest(cardRect, targetRect, rootRect)
      const next = {
        box,
        x1: from.x,
        y1: from.y,
        x2: box.left + box.width / 2,
        y2: box.top + box.height / 2,
      }
      setMark((prev) => (sameMark(prev, next) ? prev : next))
    }
    const loop = () => {
      measure()
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [pin, pos, topic, model.screen])

  if (!topic) return null

  function show(step) {
    if (step.screen && model.screen !== step.screen) setScreen(step.screen)
    setPin(step.target || '')
    if (step.target) {
      requestAnimationFrame(() => {
        visibleCoach(hostRoot(), step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    }
  }

  function onDragDown(event) {
    if (event.button !== 0) return
    if (event.target?.closest?.('button')) return
    const card = cardRef.current
    if (!card) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: pos.x, top: pos.y }
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* the pointer is already gone */ }
  }

  function onDragMove(event) {
    const held = drag.current
    if (!held || held.id !== event.pointerId) return
    const root = hostRoot()
    const card = cardRef.current
    const maxX = Math.max(0, (root?.clientWidth || 0) - (card?.offsetWidth || 0))
    const maxY = Math.max(0, (root?.clientHeight || 0) - (card?.offsetHeight || 0))
    setPos({
      x: Math.max(0, Math.min(maxX, held.left + event.clientX - held.x)),
      y: Math.max(0, Math.min(maxY, held.top + event.clientY - held.y)),
    })
  }

  function onDragUp(event) {
    if (drag.current?.id === event.pointerId) drag.current = null
  }

  return (
    <>
      {mark && (
        <svg className="coach-line" aria-hidden="true">
          <line x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />
        </svg>
      )}
      {mark && (
        <div
          className="coach-ring"
          style={{ left: mark.box.left, top: mark.box.top, width: mark.box.width, height: mark.box.height }}
        />
      )}
      <div
        ref={cardRef}
        className="coach-card"
        role="dialog"
        aria-label={topic.title}
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          className="coach-title"
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragUp}
        >
          <span>{topic.title}</span>
          <button
            type="button"
            className="chrome-btn close"
            aria-label="Close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              model.coachTopic = ''
              touch(false)
            }}
          >
            <ChromeGlyph kind="close" />
          </button>
        </div>
        <ol>
          {topic.steps.map((step) => (
            <li key={step.text}>
              <p>{step.text}</p>
              <div className="coach-row">
                {step.chip && <CoachChip label={step.chip.label} kind={step.chip.kind} />}
                {step.target && (
                  <button type="button" className="btn free-width" onClick={() => show(step)}>
                    Show me
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

function sameMark(prev, next) {
  if (!prev) return false
  return Math.abs(prev.x1 - next.x1) < 0.5
    && Math.abs(prev.y1 - next.y1) < 0.5
    && Math.abs(prev.x2 - next.x2) < 0.5
    && Math.abs(prev.y2 - next.y2) < 0.5
    && Math.abs(prev.box.left - next.box.left) < 0.5
    && Math.abs(prev.box.top - next.box.top) < 0.5
    && Math.abs(prev.box.width - next.box.width) < 0.5
    && Math.abs(prev.box.height - next.box.height) < 0.5
}

function nearest(card, target, root) {
  const cx = card.left + card.width / 2
  const cy = card.top + card.height / 2
  const tx = target.left + target.width / 2
  const ty = target.top + target.height / 2
  const dx = tx - cx
  const dy = ty - cy
  let x = cx
  let y = cy
  if (Math.abs(dx) * card.height > Math.abs(dy) * card.width) {
    x = dx > 0 ? card.right : card.left
    y = cy
  } else {
    x = cx
    y = dy > 0 ? card.bottom : card.top
  }
  return { x: x - root.left, y: y - root.top }
}

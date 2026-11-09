import { useRef } from 'react'
import { launchSongSection } from '../audio/engine.js'
import {
  appendSongPattern,
  ensurePattern,
  hexByte,
  model,
  moveSongCell,
  removeSongCell,
  setSongLoop,
  stepCount,
} from '../model.js'
import { useModel } from '../useModel.js'

export function Arranger() {
  useModel()
  const order = Array.isArray(model.songOrder) ? model.songOrder : []
  const root = useRef(null)
  return (
    <div className="arranger" ref={root}>
      <div className="arranger-tools">
        <button type="button" className="btn" onClick={() => appendSongPattern()}>+ pattern</button>
        <button type="button" data-nav className={`btn ${model.songLoop !== 'section' && model.songLoop !== 'once' ? 'on' : ''}`} onClick={() => setSongLoop('wrap')}>Order</button>
        <button type="button" data-nav className={`btn ${model.songLoop === 'once' ? 'on' : ''}`} onClick={() => setSongLoop('once')}>Once</button>
      </div>
      <div className="arranger-list">
        {order.map((pat, i) => (
          <Cell key={`${i}-${pat}`} index={i} pat={pat & 255} root={root} />
        ))}
        {!order.length && <p className="hint">No sections yet.</p>}
      </div>
    </div>
  )
}

function Cell({ index, pat, root }) {
  const pattern = ensurePattern(pat)
  const len = stepCount(pattern)
  const live = model.playing && model.songPlay && model.songCursor === index && model.launchCursor == null
  const pending = model.launchCursor === index
  const frac = live ? Math.max(0, Math.min(1, ((model.playhead | 0) + 1) / len)) : 0
  const looping = model.songLoop === 'section' && model.songCursor === index
  const drag = useRef(false)

  function onDown(event) {
    if (event.button != null && event.button !== 0) return
    if (event.target.closest('.arrange-side')) return
    const node = event.currentTarget
    const id = event.pointerId
    const y0 = event.clientY
    drag.current = false
    const move = (ev) => {
      if (ev.pointerId !== id) return
      if (Math.abs(ev.clientY - y0) > 6) drag.current = true
    }
    const up = (ev) => {
      if (ev.pointerId !== id) return
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', up)
      if (ev.type === 'pointercancel') return
      if (!drag.current) {
        launchSongSection(index)
        return
      }
      const list = root.current?.querySelectorAll('[data-cell]') || []
      let to = index
      for (const item of list) {
        const box = item.getBoundingClientRect()
        if (ev.clientY >= box.top && ev.clientY <= box.bottom) to = Number(item.dataset.cell)
      }
      moveSongCell(index, to)
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', up)
  }

  return (
    <article className={`arrange-cell ${live ? 'live' : ''} ${pending ? 'pending' : ''}`} data-cell={index} onPointerDown={onDown}>
      <div className="arrange-mark" aria-hidden="true">{hexByte(pat)}</div>
      <div className="arrange-copy">
        <b>{pattern.name || 'untitled'}</b>
        <small>{live ? `${model.playhead | 0}/${len}` : `${len}`}</small>
        <i><span style={{ width: `${frac * 100}%` }} /></i>
      </div>
      <div className="arrange-side">
        <button
          type="button"
          className={`btn ${looping ? 'on' : ''}`}
          aria-label={looping ? 'Looping this section' : 'Loop this section'}
          onClick={() => {
            setSongLoop('section')
            launchSongSection(index)
          }}
        >
          Loop
        </button>
        <button type="button" className="btn" aria-label="Remove section" onClick={() => removeSongCell(index)}>×</button>
      </div>
    </article>
  )
}

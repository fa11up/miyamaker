import { useEffect, useRef, useState } from 'react'
import { launchSongSection } from '../audio/engine.js'
import { AUTO_GROUPS, autoLabel, autoTarget } from '../audio/arrange.js'
import {
  addAutoLane,
  appendSongPattern,
  clearAutoLane,
  duplicateSongCell,
  ensurePattern,
  hexByte,
  model,
  moveSongCell,
  patternOccupied,
  removeAutoPoint,
  removeSongCell,
  setAutoPoint,
  setPatternBpm,
  setPatternLengthAt,
  setPatternName,
  setSongCellPattern,
  setSongLaunch,
  setSongLoop,
  stepCount,
} from '../model.js'
import { useModel } from '../useModel.js'
import { Dialog } from '../widgets.jsx'

export function Arranger() {
  useModel()
  const order = Array.isArray(model.songOrder) ? model.songOrder : []
  const root = useRef(null)
  const [menu, setMenu] = useState(null)
  const [edit, setEdit] = useState(null)
  const launch = model.songLaunch === 'now' || model.songLaunch === 'grid' ? model.songLaunch : 'end'
  const launchLabel = launch === 'now' ? 'Now' : launch === 'grid' ? 'Grid' : 'Wait'

  function openMenu(clientX, clientY, menu, from) {
    const rows = menu.kind === 'play' ? 6 : 28
    const at = placeMenu(clientX, clientY, from || root.current, rows)
    setMenu({ ...at, ...menu })
  }

  function openEdit(index) {
    setMenu(null)
    setEdit(index & 255)
  }

  return (
    <div className="arranger" ref={root}>
      <div className="arrange-head">
        <button
          type="button"
          className="btn"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            openMenu(box.left, box.bottom, { kind: 'add' }, event.currentTarget)
          }}
        >
          + pattern
        </button>
        <button
          type="button"
          className="btn"
          title={launch === 'now' ? 'Play the next part as soon as you tap it' : launch === 'grid' ? 'Switch on this beat and keep the step' : 'Start the next part when this one ends'}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            openMenu(box.left, box.bottom, { kind: 'play' }, event.currentTarget)
          }}
        >
          {launchLabel}
        </button>
      </div>
      <div className="arranger-list">
        {order.map((pat, i) => (
          <Cell
            key={`${i}-${pat}`}
            index={i}
            pat={pat & 255}
            root={root}
            onEdit={openEdit}
            onMenu={(x, y, from) => openMenu(x, y, { kind: 'cell', index: i, pat: pat & 255 }, from)}
          />
        ))}
        {!order.length && <p className="hint">No sections yet.</p>}
      </div>
      {menu && <ArrangeMenu menu={menu} onClose={() => setMenu(null)} onEdit={openEdit} />}
      {edit != null && <PatternEdit key={edit} index={edit} onClose={() => { setMenu(null); setEdit(null) }} />}
    </div>
  )
}

const BANKS = [
  { id: 0, label: 'Bank 0', range: '00–3F' },
  { id: 1, label: 'Bank 1', range: '40–7F' },
  { id: 2, label: 'Bank 2', range: '80–BF' },
  { id: 3, label: 'Bank 3', range: 'C0–FF' },
]

function PatternPick({ start, current = -1, onPick }) {
  const holding = current >= 0 ? current : (start & 255)
  const [bank, setBank] = useState(null)
  if (bank == null) {
    return (
      <div className="pattern-pick">
        {BANKS.map((item) => {
          const from = item.id * 64
          const inside = holding >= from && holding < from + 64
          const used = Array.from({ length: 64 }, (_, local) => patternOccupied(model.patterns[from + local])).some(Boolean)
          return (
            <button key={item.id} type="button" className={`pat-bank ${inside ? 'on' : ''} ${used ? 'used' : ''}`} onClick={() => setBank(item.id)}>
              <span>{item.label}</span>
              <span className="range">{item.range}</span>
              <span className="go" aria-hidden="true">▸</span>
            </button>
          )
        })}
      </div>
    )
  }
  const spec = BANKS[bank]
  const from = bank * 64
  return (
    <div className="pattern-pick">
      <button type="button" className="bank-back" onClick={() => setBank(null)}>‹ {spec.label}</button>
      <div className="pattern-slots" role="group" aria-label={`${spec.label} patterns`}>
        {Array.from({ length: 64 }, (_, local) => {
          const index = from + local
          const pattern = model.patterns[index]
          const name = pattern?.name || ''
          const picked = current === index
          return (
            <button
              key={index}
              type="button"
              className={`${patternOccupied(pattern) ? 'used' : ''} ${picked ? 'on' : ''}`}
              aria-current={picked ? 'true' : undefined}
              onClick={() => onPick(index)}
            >
              <span className="hex">{hexByte(index)}</span>
              <span className="nm">{name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Cell({ index, pat, root, onEdit, onMenu }) {
  const pattern = ensurePattern(pat)
  const len = stepCount(pattern)
  const playing = !!(model.playing && model.songPlay && model.songCursor === index)
  const pending = !!(model.playing && model.launchCursor === index && model.launchCursor !== model.songCursor)
  // Blink only while this part is waiting for the one that is playing to finish.
  const glow = pending && (model.playhead | 0) % 4 === 0 ? 1 : 0
  const step = Math.min(len, (model.playhead | 0) + 1)
  const pct = playing ? (step / len) * 100 : 0
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
      node.removeEventListener('lostpointercapture', up)
      if (ev.type === 'pointercancel' || ev.type === 'lostpointercapture') return
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
    // Without capture a mouse release lands on the cell under it, so the drop never reached this one.
    try { node.setPointerCapture(id) } catch { /* already gone */ }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', up)
    node.addEventListener('lostpointercapture', up)
  }

  return (
    <article
      className={`arrange-cell ${playing ? 'live' : ''} ${pending ? 'pending' : ''}`}
      data-cell={index}
      style={pending ? { '--hit': String(glow) } : undefined}
      onPointerDown={onDown}
      onContextMenu={(event) => {
        if (event.target.closest('.arrange-side') && !event.target.closest('[data-cell-menu]')) return
        event.preventDefault()
        onMenu(event.clientX, event.clientY, event.currentTarget)
      }}
    >
      <div className="arrange-mark" aria-hidden="true">{hexByte(pat)}</div>
      <div className="arrange-copy">
        <b>{pattern.name || 'untitled'}</b>
        <small>{playing ? `${(model.playhead | 0) + 1}/${len}` : `${len}`}</small>
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
        <button
          type="button"
          className="btn icon"
          data-cell-menu
          aria-label="Section menu"
          onClick={(event) => {
            event.stopPropagation()
            const box = event.currentTarget.getBoundingClientRect()
            onMenu(box.left, box.bottom, event.currentTarget)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onMenu(event.clientX, event.clientY, event.currentTarget)
          }}
        >
          <span className="burger" aria-hidden="true" />
        </button>
        <button type="button" className="btn icon" aria-label="Remove section" onClick={() => removeSongCell(index)}>×</button>
      </div>
      <div
        className="arrange-meter"
        role={playing ? 'progressbar' : undefined}
        aria-hidden={playing ? undefined : true}
        aria-label={playing ? 'Loop position' : undefined}
        aria-valuemin={playing ? 1 : undefined}
        aria-valuemax={playing ? len : undefined}
        aria-valuenow={playing ? step : undefined}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </article>
  )
}

function ArrangeMenu({ menu, onClose, onEdit }) {
  const box = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (event) => {
      const path = event.composedPath?.() || []
      if (box.current && path.includes(box.current)) return
      close.current()
    }
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close.current()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    box.current?.querySelector('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  const launch = model.songLaunch === 'now' || model.songLaunch === 'grid' ? model.songLaunch : 'end'
  const play = [
    ['end', 'Wait', 'Start the next part when this one ends'],
    ['now', 'Now', 'Play the next part as soon as you tap it'],
    ['grid', 'Grid', 'Switch on this beat and keep the step'],
  ]
  return (
    <div
      ref={box}
      className="file-menu arrange-menu"
      style={{ left: menu.left, top: menu.top, width: menu.width, maxHeight: menu.maxHeight }}
      role="menu"
    >
      {menu.items?.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.run()
            close.current()
          }}
        >
          {item.label}
        </button>
      ))}
      {menu.kind === 'play' && (
        <>
          {play.map(([id, label, title]) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={launch === id} title={title} onClick={() => { setSongLaunch(id); close.current() }}>
              {launch === id ? '● ' : ''}{label}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitemradio" aria-checked={model.songLoop === 'wrap'} onClick={() => { setSongLoop('wrap'); close.current() }}>
            {model.songLoop === 'wrap' ? '● ' : ''}Order
          </button>
          <button type="button" role="menuitemradio" aria-checked={model.songLoop === 'once'} onClick={() => { setSongLoop('once'); close.current() }}>
            {model.songLoop === 'once' ? '● ' : ''}Once
          </button>
        </>
      )}
      {menu.kind === 'cell' && (
        <>
          <button type="button" role="menuitem" onClick={() => { onEdit?.(menu.pat); close.current() }}>Edit</button>
          <button type="button" role="menuitem" onClick={() => { duplicateSongCell(menu.index); close.current() }}>Duplicate</button>
          <button type="button" role="menuitem" onClick={() => { removeSongCell(menu.index); close.current() }}>Delete</button>
          <hr />
          <div className="menu-label">Pattern</div>
          <PatternPick start={menu.pat} current={menu.pat} onPick={(slot) => { setSongCellPattern(menu.index, slot); close.current() }} />
        </>
      )}
      {menu.kind === 'add' && (
        <PatternPick start={model.pattern || 0} onPick={(slot) => { appendSongPattern(slot); close.current() }} />
      )}
    </div>
  )
}

function PatternEdit({ index, onClose }) {
  const pattern = ensurePattern(index)
  const [laneMenu, setLaneMenu] = useState(null)
  const len = stepCount(pattern)
  const [length, setLength] = useState(String(len))
  const [bpmOn, setBpmOn] = useState(Number.isFinite(pattern.bpm))
  const [bpm, setBpm] = useState(String(Number.isFinite(pattern.bpm) ? pattern.bpm : Math.round(model.bpm)))
  const [group, setGroup] = useState(AUTO_GROUPS[0].id)
  const [param, setParam] = useState(AUTO_GROUPS[0].params[0].id)
  const chosen = AUTO_GROUPS.find((item) => item.id === group) || AUTO_GROUPS[0]
  const lanes = Array.isArray(pattern.auto) ? pattern.auto : []
  const have = lanes.some((lane) => lane.id === param)

  function commitLength() {
    const n = Number(length)
    if (!Number.isInteger(n) || n < 1 || n > 256) {
      setLength(String(stepCount(ensurePattern(index))))
      return
    }
    setPatternLengthAt(index, n)
  }

  function commitBpm() {
    if (!bpmOn) return
    const n = Number(bpm)
    if (!Number.isFinite(n)) {
      setBpm(String(Number.isFinite(pattern.bpm) ? pattern.bpm : Math.round(model.bpm)))
      return
    }
    setPatternBpm(index, n)
    setBpm(String(Math.max(40, Math.min(240, Math.round(n)))))
  }

  return (
    <Dialog title={`Pattern ${hexByte(index)}`} onClose={onClose}>
      <label className="auto-field">
        Name
        <input
          className="field"
          aria-label="Pattern name"
          maxLength={48}
          value={pattern.name || ''}
          onChange={(event) => setPatternName(index, event.target.value)}
          onBlur={() => setPatternName(index, (ensurePattern(index).name || '').trim())}
        />
      </label>
      <label className="auto-field">
        Length
        <input
          className="field num"
          aria-label="Length"
          inputMode="numeric"
          min={1}
          max={256}
          value={length}
          onChange={(event) => setLength(event.target.value)}
          onBlur={commitLength}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitLength()
            }
          }}
        />
      </label>
      <label className="arrange-check">
        <input
          type="checkbox"
          aria-label="Custom tempo"
          checked={bpmOn}
          onChange={(event) => {
            const on = event.target.checked
            setBpmOn(on)
            if (!on) {
              setPatternBpm(index, null)
              return
            }
            const next = Math.max(40, Math.min(240, Math.round(Number(bpm) || model.bpm)))
            setBpm(String(next))
            setPatternBpm(index, next)
          }}
        />
        Custom tempo
      </label>
      <label className="auto-field">
        Tempo
        <input
          className="field num"
          aria-label="Pattern tempo"
          inputMode="numeric"
          min={40}
          max={240}
          disabled={!bpmOn}
          value={bpm}
          onChange={(event) => setBpm(event.target.value)}
          onBlur={commitBpm}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitBpm()
            }
          }}
        />
      </label>
      <p className="hint">This tempo is what this pattern plays.</p>
      <div className="auto-add">
        <label className="auto-field">
          Group
          <select
            className="field"
            aria-label="Automation group"
            value={group}
            onChange={(event) => {
              const id = event.target.value
              setGroup(id)
              const next = AUTO_GROUPS.find((item) => item.id === id)
              setParam(next?.params[0]?.id || '')
            }}
          >
            {AUTO_GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="auto-field">
          Parameter
          <select className="field" aria-label="Automation parameter" value={param} onChange={(event) => setParam(event.target.value)}>
            {chosen.params.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn" disabled={have || lanes.length >= 64} onClick={() => addAutoLane(index, param)}>Add</button>
      </div>
      {lanes.map((lane) => (
        <AutoLane
          key={lane.id}
          index={index}
          lane={lane}
          length={len}
          onMenu={(event, id) => {
            const at = placeMenu(event.clientX, event.clientY, event.currentTarget, 1)
            setLaneMenu({
              ...at,
              items: [{ label: 'Clear automation', run: () => clearAutoLane(index, id) }],
            })
          }}
        />
      ))}
      {laneMenu && <ArrangeMenu menu={laneMenu} onClose={() => setLaneMenu(null)} />}
    </Dialog>
  )
}

function AutoLane({ index, lane, length, onMenu }) {
  const spec = autoTarget(lane.id)
  const [step, setStep] = useState('0')
  const [value, setValue] = useState(spec ? String(spec.min) : '0')
  if (!spec) return null
  return (
    <div
      className="auto-lane"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onMenu(event, lane.id)
      }}
    >
      <div className="auto-lane-head">
        <b>{autoLabel(lane.id)}</b>
        <button type="button" className="btn" onClick={() => clearAutoLane(index, lane.id)}>Clear</button>
      </div>
      <ul className="auto-points">
        {lane.points.map((point) => (
          <li key={point.s}>
            <span>{point.s} · {showValue(spec, point.v)}</span>
            <button type="button" className="btn icon" aria-label={`Remove step ${point.s}`} onClick={() => removeAutoPoint(index, lane.id, point.s)}>×</button>
          </li>
        ))}
      </ul>
      <form
        className="auto-set"
        onSubmit={(event) => {
          event.preventDefault()
          const at = Number(step)
          if (!Number.isInteger(at)) return
          setAutoPoint(index, lane.id, at, Number(value))
        }}
      >
        <label className="auto-field">
          Step
          <input className="field num" aria-label="Step" inputMode="numeric" min={0} max={Math.max(0, length - 1)} value={step} onChange={(event) => setStep(event.target.value)} />
        </label>
        <label className="auto-field">
          Value
          <input className="field num" aria-label="Value" inputMode="decimal" min={spec.min} max={spec.max} step={spec.step} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button type="submit" className="btn">Set</button>
      </form>
    </div>
  )
}

function showValue(spec, value) {
  if (spec.step >= 1) return String(Math.round(value))
  return String(Math.round(value * 100) / 100)
}

function placeMenu(clientX, clientY, node, rows) {
  const width = rows <= 6 ? 188 : 248
  const want = rows * 24 + 12
  let el = node
  let frame = null
  while (el) {
    const style = window.getComputedStyle(el)
    const fixed = (style.transform && style.transform !== 'none')
      || (style.filter && style.filter !== 'none')
      || (style.perspective && style.perspective !== 'none')
      || (typeof style.willChange === 'string' && style.willChange.includes('transform'))
    if (fixed) {
      frame = el
      break
    }
    const root = el.getRootNode?.()
    el = el.parentElement || root?.host || null
  }
  const boundsW = frame ? frame.clientWidth : window.innerWidth
  const boundsH = frame ? frame.clientHeight : window.innerHeight
  const originX = frame ? frame.getBoundingClientRect().left : 0
  const originY = frame ? frame.getBoundingClientRect().top : 0
  const w = Math.min(width, Math.max(140, boundsW - 8))
  const relX = clientX - originX
  const relY = clientY - originY
  const roomBelow = boundsH - relY - 4
  const roomAbove = relY - 4
  let top
  let maxHeight
  if (roomBelow >= Math.min(want, 140) || roomBelow >= roomAbove) {
    top = Math.max(4, Math.min(relY, boundsH - 40))
    maxHeight = Math.max(36, Math.min(want, boundsH - top - 4))
  } else {
    maxHeight = Math.max(36, Math.min(want, roomAbove))
    top = Math.max(4, relY - maxHeight)
  }
  return {
    left: Math.max(4, Math.min(relX, boundsW - w - 4)),
    top,
    width: w,
    maxHeight,
  }
}

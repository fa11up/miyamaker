import { useState } from 'react'
import { currentPattern, hexByte, model, setPattern, setPatternLength, stepCount, touch } from '../model.js'
import { useModel } from '../useModel.js'

export function PatternBar() {
  useModel()
  const pat = currentPattern()
  const [draft, setDraft] = useState(null)
  const [lenDraft, setLenDraft] = useState(null)
  const length = stepCount(pat)
  const shown = draft == null ? hexByte(model.pattern) : draft
  const lenShown = lenDraft == null ? hexSteps(length) : lenDraft
  const commitLength = (text) => {
    const cleaned = String(text || '').replace(/[^0-9a-f]/gi, '').slice(0, 3)
    const n = parseInt(cleaned, 16)
    if (cleaned && Number.isFinite(n) && n >= 1) setPatternLength(n)
    setLenDraft(null)
  }
  const commit = (text) => {
    const cleaned = text.replace(/[^0-9a-f]/gi, '').slice(0, 2)
    if (cleaned.length === 2) setPattern(parseInt(cleaned, 16))
    setDraft(null)
  }
  return (
    <div className="pattern-bar">
      <button type="button" className="btn free-width" onClick={() => setPattern(model.pattern - 1)}>
        Prev
      </button>
      <button type="button" className="btn free-width" onClick={() => setPattern(model.pattern + 1)}>
        Next
      </button>
      <label className="hex-pair">
        <span>Pattern</span>
        <input
          className="field num hex"
          aria-label="Pattern address"
          value={shown}
          spellCheck={false}
          onFocus={() => setDraft(hexByte(model.pattern))}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 2).toUpperCase()
            setDraft(cleaned)
            if (cleaned.length === 2) {
              setPattern(parseInt(cleaned, 16))
              setDraft(null)
            }
          }}
          onBlur={() => commit(shown)}
        />
      </label>
      <select
        className="row-select pattern-pick"
        aria-label="Load pattern"
        value={model.pattern}
        onChange={(e) => setPattern(Number(e.target.value))}
      >
        {Array.from({ length: 256 }, (_, i) => {
          const name = model.patterns[i]?.name
          return (
            <option key={i} value={i}>
              {hexByte(i)}
              {name ? ` ${name}` : ''}
            </option>
          )
        })}
      </select>
      <label className="hex-pair">
        <span>Len</span>
        <input
          className="field num hex len"
          aria-label="Pattern length"
          title="Steps, in hex. 10 is 16 steps. 100 is 256."
          value={lenShown}
          spellCheck={false}
          onFocus={(e) => {
            const node = e.target
            setLenDraft(hexSteps(length))
            requestAnimationFrame(() => node.select())
          }}
          onChange={(e) => setLenDraft(e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 3).toUpperCase())}
          onBlur={(e) => commitLength(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
      <input
        className="field name"
        aria-label="Pattern name"
        placeholder="Name"
        value={pat.name}
        maxLength={24}
        onChange={(e) => {
          pat.name = e.target.value
          touch(true)
        }}
      />
    </div>
  )
}

function hexSteps(n) {
  const v = Math.max(1, Math.min(256, n | 0))
  if (v === 256) return '100'
  return v.toString(16).toUpperCase().padStart(2, '0')
}

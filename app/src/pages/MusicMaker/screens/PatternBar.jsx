import { useState } from 'react'
import { currentPattern, hexByte, model, setPattern, touch } from '../model.js'
import { useModel } from '../useModel.js'

export function PatternBar() {
  useModel()
  const pat = currentPattern()
  const [draft, setDraft] = useState(null)
  const shown = draft == null ? hexByte(model.pattern) : draft
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
      <label className="slider">
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
      <button
        type="button"
        className={`btn free-width ${model.recNatural ? 'on' : ''}`}
        onClick={() => {
          model.recNatural = !model.recNatural
          touch(true)
        }}
      >
        {model.recNatural ? 'Natural' : 'Grid'}
      </button>
    </div>
  )
}

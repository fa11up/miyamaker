import styled from 'styled-components/macro'

import { font, space } from '@/theme/tokens'

import { pink, raisedButton } from './chrome'

import { isEmptyOption, nameError, traitClash, traitPath, type Trait } from './model'

const Column = styled.aside`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${pink.mist};
  color: ${pink.ink};
  box-shadow: inset 1px 1px ${pink.deep}, inset -1px -1px #fff;
  font-family: ${font.ui};
  font-size: 13px;

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: none;
    background: #fff;
    color: ${pink.ink};
    box-shadow: inset 1px 1px ${pink.deep}, inset -1px -1px #fff;
    font: inherit;
    padding: 4px 6px;
  }

  button {
    min-height: 28px;
    padding: 0 8px;
    font: inherit;
    ${raisedButton}
  }

  textarea {
    min-height: 72px;
    resize: vertical;
  }
`

const FileName = styled.p`
  margin: 0;
  word-break: break-all;
  color: ${pink.inkMuted};
`

const Warn = styled.p`
  margin: 0;
  color: #8d1230;
  font-weight: 700;
`

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 4px;
`

export default function Inspector({
  trait,
  traits,
  onChange,
}: {
  trait: Trait | null
  traits: Trait[]
  onChange: (patch: Partial<Trait>) => void
}) {
  if (!trait) {
    return (
      <Column>
        <p>Select a trait to name it, set its rarity weight, and keep notes.</p>
      </Column>
    )
  }
  const problem = nameError(trait.name)
  const clash = !problem && traitClash(traits, trait)
  const empty = isEmptyOption(trait)
  return (
    <Column>
      <label>
        Name
        <input value={trait.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label>
        Rarity weight
        <input
          type="number"
          min={0}
          step={1}
          value={trait.weight}
          title={empty ? 'How often this layer is left out. Higher means it is missing more often.' : 'Higher is more common. This is the # number in the file name.'}
          onChange={(event) => {
            const weight = Number(event.target.value)
            if (Number.isFinite(weight) && weight >= 0) onChange({ weight })
          }}
        />
      </label>
      {empty ? <p>This weight is the chance the layer is left out. Higher means it is missing more often.</p> : null}
      <label>
        Notes
        <textarea value={trait.notes} onChange={(event) => onChange({ notes: event.target.value })} />
      </label>
      <div>
        <div style={{ marginBottom: 4 }}>Custom entries</div>
        {trait.fields.map((field, index) => (
          <FieldRow key={index}>
            <input
              aria-label="Field name"
              value={field.key}
              placeholder="Field"
              onChange={(event) => {
                const fields = trait.fields.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item))
                onChange({ fields })
              }}
            />
            <input
              aria-label="Field value"
              value={field.value}
              placeholder="Value"
              onChange={(event) => {
                const fields = trait.fields.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item))
                onChange({ fields })
              }}
            />
            <button
              type="button"
              onClick={() => onChange({ fields: trait.fields.filter((_, itemIndex) => itemIndex !== index) })}
            >
              Remove
            </button>
          </FieldRow>
        ))}
        <button type="button" onClick={() => onChange({ fields: [...trait.fields, { key: '', value: '' }] })}>
          Add field
        </button>
      </div>
      {problem ? <Warn>{problem}</Warn> : null}
      {clash ? <Warn>Another trait in this folder already uses that name and weight.</Warn> : null}
      {!problem && !clash ? <FileName>{traitPath(trait)}</FileName> : null}
    </Column>
  )
}

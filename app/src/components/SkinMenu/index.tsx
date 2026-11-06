import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

/**
 * A menu that wears its app's skin instead of the browser's dropdown. The app sets the look with CSS variables on any
 * parent: --menu-face and --menu-ink for the button, --menu-sheet for the open list (any background), --menu-edge for the
 * lines, --menu-pick and --menu-pick-ink for the highlighted row.
 */
const Wrap = styled.div`
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
`

const Face = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  height: 30px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--menu-edge, #000);
  border-radius: 4px;
  background: var(--menu-face, #fff);
  color: var(--menu-ink, #000);
  font-size: 14px;
  cursor: pointer;
  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  i {
    font-style: normal;
    font-size: 10px;
  }
  &:focus-visible {
    outline: 2px solid var(--menu-ink, #000);
    outline-offset: 1px;
  }
`

const Sheet = styled.ul`
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 25;
  min-width: 100%;
  max-height: 260px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--menu-edge, #000);
  border-radius: 6px;
  background: var(--menu-sheet, #fff);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.6);
  li {
    padding: 6px 10px;
    border-radius: 3px;
    color: var(--menu-ink, #000);
    font-size: 14px;
    white-space: nowrap;
    cursor: pointer;
  }
  li[aria-selected='true'] {
    font-weight: 700;
  }
  li.active {
    background: var(--menu-pick, #000);
    color: var(--menu-pick-ink, #fff);
  }
`

export type SkinMenuOption = { value: string; label: string }

export default function SkinMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: SkinMenuOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return undefined
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    )
    setOpen(true)
  }

  const pick = (i: number) => {
    const option = options[i]
    if (option) onChange(option.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }

      return
    }

    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setActive((a) => (a + 1) % options.length)
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + options.length) % options.length)
    else if (e.key === 'Enter' || e.key === ' ') pick(active)
    else return
    e.preventDefault()
  }

  return (
    <Wrap ref={root} onKeyDown={onKeyDown}>
      <Face
        type="button"
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{current?.label}</span>
        <i aria-hidden>{open ? '▼' : '▲'}</i>
      </Face>
      {open && (
        <Sheet role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {o.label}
            </li>
          ))}
        </Sheet>
      )}
    </Wrap>
  )
}

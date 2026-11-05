import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import type { RadioApi } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import type { PlaylistSource } from '@/music/types'
import { font } from '@/theme/tokens'

import { Key, Menu, PixelText } from './parts'

const Well = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 1px;
`

const List = styled.ol`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ${font.ui};
  font-size: 11px;
  line-height: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--rk-pl-num) var(--rk-pl);
`

const Row = styled.li<{ $active?: boolean; $selected?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  padding: 0 2px;
  color: ${({ $selected }) => ($selected ? 'var(--rk-pl-sel)' : 'var(--rk-pl-ink)')};
  background: ${({ $selected }) => ($selected ? 'var(--rk-pl-cur-bg)' : 'transparent')};
  font-weight: ${({ $active }) => ($active ? 700 : 400)};
  cursor: pointer;
  user-select: none;
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
    outline-offset: -1px;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    font-variant-numeric: tabular-nums;
  }
`

const Empty = styled.div`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  text-align: center;
  font-family: ${font.ui};
  font-size: 11px;
  line-height: 13px;
  color: var(--rk-pl-ink);
  p {
    margin: 0;
    font-weight: 700;
  }
  button {
    all: unset;
    cursor: pointer;
    text-decoration: underline;
  }
  button:focus-visible {
    outline: 1px dotted currentColor;
  }
`

const Foot = styled.div`
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 4px;
  button {
    height: 12px;
  }
  .time {
    margin-left: auto;
    padding: 2px 3px;
    color: var(--rk-lcd-ink);
  }
`

type MenuId = 'add' | 'rem' | 'misc'

export default function Playlist({
  radio,
  nowIndex,
  nowDuration,
  sources,
  busy,
  checked,
  onLoad,
  onDropMusic,
  onTestTone,
  onInfo,
}: {
  radio: RadioApi
  nowIndex: number
  nowDuration: number
  sources: PlaylistSource[]
  busy: boolean
  /** ADD was pressed and found nothing: say there are no drops yet instead of asking again. */
  checked?: boolean
  onLoad: (id: string) => void
  onDropMusic: () => void
  onTestTone?: () => void
  onInfo: () => void
}) {
  const { queue } = radio
  const [selected, setSelected] = useState<number[]>([])
  const [menu, setMenu] = useState<MenuId>()
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [nowIndex])

  // Selections are by position, so they don't survive the list changing.
  useEffect(() => setSelected([]), [queue.tracks.length])

  const allSelected = queue.tracks.length > 0 && selected.length === queue.tracks.length
  // The playing track knows its real length even when its metadata didn't say.
  const length = (i: number) => (i === nowIndex && nowDuration) || queue.tracks[i]?.duration
  const total = queue.tracks.reduce((s, _, i) => s + (length(i) || 0), 0)
  const picked = selected.reduce((s, i) => s + (length(i) || 0), 0)

  const removeSelected = () => {
    // Highest first, so the earlier positions stay put.
    ;[...selected].sort((a, b) => b - a).forEach((i) => radio.remove(i))
    setMenu(undefined)
  }

  const footKey = (id: MenuId, label: string, width: number, title: string) => (
    <Key
      type="button"
      style={{ width }}
      title={title}
      aria-expanded={menu === id}
      onClick={() => setMenu((m) => (m === id ? undefined : id))}
    >
      <PixelText text={label} />
    </Key>
  )

  return (
    <>
      <Well aria-label="Playlist">
        {queue.tracks.length === 0 ? (
          <Empty>
            <p>No tracks yet</p>
            {checked ? (
              <span>
                No music drops are out yet.{' '}
                <button type="button" onClick={onDropMusic}>
                  Release your own
                </button>
              </span>
            ) : (
              <span>Press ADD to load music drops.</span>
            )}
          </Empty>
        ) : (
          <List ref={listRef}>
            {queue.tracks.map((t, i) => {
              const active = i === nowIndex
              return (
                <Row
                  key={t.id}
                  $active={active}
                  $selected={selected.includes(i)}
                  data-active={active}
                  tabIndex={0}
                  aria-current={active ? 'true' : undefined}
                  onDoubleClick={() => radio.jumpTo(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') radio.jumpTo(i)
                    if (e.key === 'Delete' || e.key === 'Backspace') radio.remove(i)
                  }}
                  onClick={(e) => {
                    // Single tap plays on touch screens (no double-click there).
                    if ((e.nativeEvent as PointerEvent).pointerType === 'touch') {
                      radio.jumpTo(i)
                      return
                    }

                    setSelected((s) => {
                      if (!e.ctrlKey && !e.metaKey) return [i]
                      return s.includes(i) ? s.filter((x) => x !== i) : [...s, i]
                    })
                  }}
                  title={`${t.artist ? `${t.artist} - ` : ''}${t.title} (double-click to play)`}
                >
                  <span className="t">
                    {active ? '▸ ' : `${i + 1}. `}
                    {t.artist ? `${t.artist} - ` : ''}
                    {t.title}
                  </span>
                  <span className="d">{formatDuration(length(i))}</span>
                </Row>
              )
            })}
          </List>
        )}
      </Well>
      <Foot>
        {footKey('add', 'ADD', 24, 'Add tracks')}
        {footKey('rem', 'REM', 24, 'Remove tracks')}
        <Key
          type="button"
          style={{ width: 24 }}
          title={allSelected ? 'Select none' : 'Select all'}
          aria-pressed={allSelected}
          disabled={!queue.tracks.length}
          onClick={() => setSelected(allSelected ? [] : queue.tracks.map((_, i) => i))}
        >
          <PixelText text="SEL" />
        </Key>
        {footKey('misc', 'MISC', 28, 'More')}
        <span className="time" title="Selected length / playlist length">
          <PixelText text={`${formatDuration(picked)}/${formatDuration(total)}`} />
        </span>
        {menu === 'add' && (
          <Menu label="Add tracks" style={{ left: 4, bottom: 17 }} onClose={() => setMenu(undefined)}>
            {sources.map((src) => (
              <button
                type="button"
                key={src.id}
                disabled={busy}
                onClick={() => {
                  onLoad(src.id)
                  setMenu(undefined)
                }}
              >
                {src.label}
              </button>
            ))}
            {onTestTone && (
              <button
                type="button"
                onClick={() => {
                  onTestTone()
                  setMenu(undefined)
                }}
              >
                Test tone (dev)
              </button>
            )}
          </Menu>
        )}
        {menu === 'rem' && (
          <Menu label="Remove tracks" style={{ left: 31, bottom: 17 }} onClose={() => setMenu(undefined)}>
            <button type="button" disabled={!selected.length} onClick={removeSelected}>
              Remove selected
            </button>
            <button
              type="button"
              disabled={!queue.tracks.length}
              onClick={() => {
                radio.clear()
                setMenu(undefined)
              }}
            >
              Clear playlist
            </button>
          </Menu>
        )}
        {menu === 'misc' && (
          <Menu label="More" style={{ left: 85, bottom: 17 }} onClose={() => setMenu(undefined)}>
            <button
              type="button"
              disabled={!radio.current}
              onClick={() => {
                onInfo()
                setMenu(undefined)
              }}
            >
              Track info
            </button>
            <button
              type="button"
              onClick={() => {
                onDropMusic()
                setMenu(undefined)
              }}
            >
              Release your own
            </button>
          </Menu>
        )}
      </Foot>
    </>
  )
}

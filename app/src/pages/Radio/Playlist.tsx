import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components/macro'

import type { RadioApi } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import type { PlaylistSource } from '@/music/types'
import { useStationRemove } from '@/music/useStationRemove'
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
  .phone-radio & button.tune {
    min-height: 30px;
  }
  button.tune {
    margin-top: 2px;
    padding: 2px 6px;
    text-decoration: none;
    color: var(--rk-btn-ink);
    background: linear-gradient(180deg, var(--rk-btn) 0%, var(--rk-btn-2) 100%);
    box-shadow: inset 1px 1px 0 var(--rk-key-hi), inset -1px -1px 0 var(--rk-key-lo), 0 0 0 1px var(--rk-seam);
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
  /* The phone's glass draws this 1.5 times over, so these come out a thumb's size. */
  .phone-radio & {
    height: 34px;
    button {
      height: 30px;
      min-width: 30px;
    }
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
  failed,
  sheet,
  askAdd,
  onAskedAdd,
  onLoad,
  onTuneIn,
  onTestTone,
  onInfo,
}: {
  radio: RadioApi
  nowIndex: number
  nowDuration: number
  sources: PlaylistSource[]
  busy: boolean
  /** The community station answered and has nothing: say so instead of asking again. */
  checked?: boolean
  /** The source that could not be reached, kept up until the retry. */
  failed?: { id: string; label: string }
  /** Where menus open on a phone. */
  sheet?: HTMLElement | null
  /** Eject or the phone's Add music: open the ADD menu. */
  askAdd?: boolean
  onAskedAdd?: () => void
  onLoad: (id: string) => void
  /** Load the community station and start it. */
  onTuneIn: () => void
  onTestTone?: () => void
  onInfo: () => void
}) {
  const { queue } = radio
  const latestQueue = useRef(queue)
  latestQueue.current = queue
  // By track, not place, so a selection means the same tracks when the list changes under it.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selected = queue.tracks.flatMap((t, i) => (selectedIds.includes(t.id) ? [i] : []))
  const [menu, setMenu] = useState<MenuId>()
  const station = useStationRemove()
  const [takingOff, setTakingOff] = useState(false)
  const [takeOffFailed, setTakeOffFailed] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  // Read at press time: a click event's own pointerType is not there on every browser.
  const lastPointer = useRef<string>()

  useEffect(() => {
    if (!askAdd) return
    setMenu('add')
    onAskedAdd?.()
  }, [askAdd, onAskedAdd])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [nowIndex])

  useEffect(() => setTakeOffFailed(false), [selectedIds])

  const allSelected = queue.tracks.length > 0 && selected.length === queue.tracks.length
  // The playing track knows its real length even when its metadata didn't say.
  const length = (i: number) => (i === nowIndex && nowDuration) || queue.tracks[i]?.duration
  const total = queue.tracks.reduce((s, _, i) => s + (length(i) || 0), 0)
  const picked = selected.reduce((s, i) => s + (length(i) || 0), 0)

  const removeSelected = () => {
    // Highest first, so the earlier positions stay put.
    ;[...selected].sort((a, b) => b - a).forEach((i) => radio.remove(i))
    setSelectedIds([])
    setMenu(undefined)
  }

  const offStation = selected.filter((i) => station.canRemove(queue.tracks[i])).sort((a, b) => b - a)
  const takeOff = async () => {
    setTakingOff(true)
    setTakeOffFailed(false)
    try {
      const tracks = offStation.map((i) => queue.tracks[i]!)
      // Each comes off the list as soon as it's off the station, so trying again only asks about the ones left.
      for (const t of tracks) {
        await station.remove(t)
        const at = latestQueue.current.tracks.findIndex((x) => x.id === t.id)
        if (at >= 0) radio.remove(at)
      }

      setSelectedIds([])
      setMenu(undefined)
    } catch {
      setTakeOffFailed(true)
    } finally {
      setTakingOff(false)
    }
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
            {failed ? (
              <>
                <p>Could not reach {failed.label}.</p>
                <button
                  type="button"
                  className="tune"
                  disabled={busy}
                  onClick={() => (failed.id === 'community' ? onTuneIn() : onLoad(failed.id))}
                >
                  Try again
                </button>
              </>
            ) : checked ? (
              <>
                <p>No tracks yet</p>
                <span>
                  Nothing on the station yet.
                </span>
              </>
            ) : (
              <>
                <p>No tracks yet</p>
                <button type="button" className="tune" disabled={busy} onClick={onTuneIn}>
                  Tune in to the community station
                </button>
              </>
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
                  onPointerDown={(e) => {
                    lastPointer.current = e.pointerType
                  }}
                  onClick={(e) => {
                    // Single tap plays on touch screens (no double-click there), and picks it for removing too.
                    if (lastPointer.current === 'touch') {
                      setSelectedIds([t.id])
                      // Tapping what's already on must not start it over.
                      if (!active) radio.jumpTo(i)
                      else if (!radio.playing) radio.play()
                      return
                    }

                    setSelectedIds((s) => {
                      if (!e.ctrlKey && !e.metaKey) return [t.id]
                      return s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]
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
          onClick={() => setSelectedIds(allSelected ? [] : queue.tracks.map((t) => t.id))}
        >
          <PixelText text="SEL" />
        </Key>
        {footKey('misc', 'MISC', 28, 'More')}
        <span className="time" title="Selected length / playlist length">
          <PixelText text={`${formatDuration(picked)}/${formatDuration(total)}`} />
        </span>
        {menu === 'add' && (
          <Menu label="Add tracks" sheet={sheet} style={{ left: 4, bottom: 17 }} onClose={() => setMenu(undefined)}>
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
          <Menu label="Remove tracks" sheet={sheet} style={{ left: 31, bottom: 17 }} onClose={() => setMenu(undefined)}>
            <button type="button" disabled={!selected.length} onClick={removeSelected}>
              Remove selected
            </button>
            {offStation.length > 0 && (
              <button type="button" disabled={takingOff} onClick={takeOff}>
                {takeOffFailed ? 'Failed. Try again?' : takingOff ? 'Check your wallet…' : 'Take off the station'}
              </button>
            )}
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
          <Menu label="More" sheet={sheet} style={{ left: 85, bottom: 17 }} onClose={() => setMenu(undefined)}>
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
          </Menu>
        )}
      </Foot>
      {/* Phones: the tapped track's own buttons, under the heart, since REM and its menu are too small for a thumb. */}
      {sheet &&
        selected.length > 0 &&
        !menu &&
        createPortal(
          <div className="sheet-row">
            <button type="button" onClick={removeSelected}>
              Remove from list
            </button>
            {offStation.length > 0 && (
              <button type="button" disabled={takingOff} onClick={takeOff}>
                {takeOffFailed ? 'Failed. Try again?' : takingOff ? 'Check your wallet…' : 'Take off the station'}
              </button>
            )}
          </div>,
          sheet
        )}
    </>
  )
}

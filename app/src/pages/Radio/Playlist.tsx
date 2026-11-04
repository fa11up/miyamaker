import { useEffect, useRef } from 'react'
import styled from 'styled-components/macro'

import type { RadioApi } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import type { PlaylistSource } from '@/music/types'
import { font } from '@/theme/tokens'

import { Key, Lcd } from './parts'

const Well = styled(Lcd)`
  flex: 1 1 auto;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  padding: 3px;
  background: var(--rk-pl);
`

const List = styled.ol`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ${font.ui};
  font-size: 13px;
  scrollbar-width: thin;
  scrollbar-color: var(--rk-pl-num) var(--rk-pl);
`

const Row = styled.li<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto 22px;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  color: ${({ $active }) => ($active ? 'var(--rk-pl-cur)' : 'var(--rk-pl-ink)')};
  background: ${({ $active }) =>
    $active ? 'linear-gradient(90deg, var(--rk-pl-cur-bg), transparent 140%)' : 'transparent'};
  text-shadow: ${({ $active }) => ($active ? '0 0 6px var(--rk-lcd-glow)' : 'none')};
  cursor: pointer;
  &:hover {
    background: ${({ $active }) =>
      $active ? 'linear-gradient(90deg, var(--rk-pl-cur-bg), transparent 140%)' : 'var(--rk-pl-hover)'};
  }
  &:focus-visible {
    outline: 1px dotted var(--rk-lcd-ink);
    outline-offset: -2px;
  }
  .n {
    color: var(--rk-pl-num);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    color: var(--rk-pl-num);
    font-variant-numeric: tabular-nums;
  }
  button {
    all: unset;
    cursor: pointer;
    text-align: center;
    color: var(--rk-pl-num);
    &:hover,
    &:focus-visible {
      color: var(--rk-lcd-ink);
    }
  }
  @media (max-width: 768px) {
    padding: 8px 4px;
    font-size: 14px;
  }
`

const Empty = styled.div`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  font-family: ${font.ui};
  color: var(--rk-pl-ink);
  p {
    margin: 0;
    font-size: 16px;
    color: var(--rk-pl-cur);
    text-shadow: 0 0 6px var(--rk-lcd-glow);
  }
  small {
    max-width: 30ch;
    font-size: 12px;
    line-height: 1.4;
  }
`

const Footer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  select {
    height: 24px;
    min-width: 0;
    flex: 1 1 140px;
    border: none;
    border-radius: 0;
    padding: 0 4px;
    background: var(--rk-lcd);
    color: var(--rk-lcd-ink);
    font-family: ${font.ui};
    font-size: 12px;
    box-shadow: inset 1px 1px 0 var(--rk-frame-lo), inset -1px -1px 0 var(--rk-frame-hi);
    &:focus-visible {
      outline: 1px dotted var(--rk-frame-ink);
      outline-offset: 1px;
    }
    @media (max-width: 768px) {
      height: 34px;
    }
  }
`

const Status = styled.div<{ $error?: boolean }>`
  min-height: 15px;
  margin-top: 3px;
  font-family: ${font.ui};
  font-size: 11px;
  color: ${({ $error }) => ($error ? '#ff5c7a' : 'var(--rk-frame-ink)')};
  opacity: ${({ $error }) => ($error ? 1 : 0.85)};
`

export function playlistSummary(radio: RadioApi) {
  const total = radio.queue.tracks.reduce((s, t) => s + (t.duration || 0), 0)
  const n = radio.queue.tracks.length
  return n ? `${n} trk · ${formatDuration(total)}` : 'empty'
}

export default function Playlist({
  radio,
  nowIndex,
  sources,
  sourceId,
  setSourceId,
  busy,
  onLoad,
  onDropMusic,
  onTestTone,
  status,
}: {
  radio: RadioApi
  nowIndex: number
  sources: PlaylistSource[]
  sourceId: string
  setSourceId: (id: string) => void
  busy: boolean
  onLoad: () => void
  onDropMusic: () => void
  onTestTone?: () => void
  status?: { text: string; tone?: 'error' }
}) {
  const { queue } = radio
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [nowIndex])

  return (
    <>
      <Well aria-label="Playlist">
        {queue.tracks.length === 0 ? (
          <Empty>
            <p>No tracks yet — drop music to fill the radio</p>
            <small>Music drops minted on-chain show up here. Load them below, or release your own.</small>
          </Empty>
        ) : (
          <List ref={listRef}>
            {queue.tracks.map((t, i) => {
              const active = i === nowIndex
              return (
                <Row
                  key={t.id}
                  $active={active}
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
                    if ((e.nativeEvent as PointerEvent).pointerType === 'touch') radio.jumpTo(i)
                  }}
                  title={`${t.artist ? `${t.artist} - ` : ''}${t.title} (double-click to play)`}
                >
                  <span className="n">{i + 1}.</span>
                  <span className="t">
                    {t.artist ? `${t.artist} - ` : ''}
                    {t.title}
                  </span>
                  <span className="d">{formatDuration(t.duration)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      radio.remove(i)
                    }}
                  >
                    ×
                  </button>
                </Row>
              )
            })}
          </List>
        )}
      </Well>
      <Footer>
        <select aria-label="Playlist source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {sources.map((src) => (
            <option key={src.id} value={src.id}>
              {src.label}
            </option>
          ))}
        </select>
        <Key type="button" onClick={onLoad} disabled={busy} title="Add the chosen source's tracks to the playlist">
          {busy ? 'Loading…' : '+ Add'}
        </Key>
        <Key type="button" onClick={radio.clear} disabled={!queue.tracks.length} title="Clear the playlist">
          Clear
        </Key>
        <Key type="button" onClick={onDropMusic}>
          Drop Music
        </Key>
        {onTestTone && (
          <Key type="button" onClick={onTestTone} title="Dev only: play the synthetic test tone fixture">
            Test tone
          </Key>
        )}
      </Footer>
      <Status $error={status?.tone === 'error'} role="status">
        {status?.text || ' '}
      </Status>
    </>
  )
}

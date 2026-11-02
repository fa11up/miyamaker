import { useEffect, useMemo, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { BigButton } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useRadio, useRadioClock } from '@/context/RadioProvider'
import { formatDuration } from '@/music/audio'
import { MUSIC_CHAINS, musicConfig } from '@/music/config'
import { positionLabel } from '@/music/queue'
import { musicDropsSource, stationSource } from '@/music/sources'
import type { PlaylistSource } from '@/music/types'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { Glyph } from './Glyph'
import Visualizer from './Visualizer'

const pageId = 'radio' as PageKey

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]};
  min-height: 0;
  overflow: hidden;
`

const Deck = styled.div`
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: ${space[1]} ${space[2]};
  padding: ${space[2]};
  background: ${color.dark};
  box-shadow: ${bevel.sunken};
  color: ${color.light};
  font-family: ${font.mono};
`

const Clock = styled.button`
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: ${space[1]};
  font-size: 30px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: ${color.accent};
  text-shadow: 0 0 6px rgba(217, 122, 218, 0.55);
  font-variant-numeric: tabular-nums;
  &:focus-visible {
    outline: 1px dotted ${color.accent};
  }
`

const State = styled.span`
  display: inline-flex;
  width: 12px;
  color: ${color.light};
`

const VizBox = styled.div`
  grid-column: 1;
  height: 56px;
  box-shadow: inset 0 0 0 1px #2c2342;
`

const Info = styled.div`
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  gap: ${space[1]};
`

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const MarqueeBox = styled.div`
  overflow: hidden;
  white-space: nowrap;
  padding: 3px 4px;
  background: #0d0a16;
  box-shadow: inset 0 0 0 1px #2c2342;
  color: #f5c6f6;
  font-size: ${text.xs};
  letter-spacing: 0.06em;
  > span {
    display: inline-block;
    padding-right: 0;
  }
  &.run > span {
    animation: ${scroll} var(--marquee-s, 14s) linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    &.run > span {
      animation: none;
    }
    text-overflow: ellipsis;
  }
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px ${space[2]};
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9d95c4;
  b {
    color: ${color.light};
    font-weight: 400;
  }
`

const Range = styled.input.attrs({ type: 'range' })`
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 16px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  &::-webkit-slider-runnable-track {
    height: 8px;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
  }
  &::-moz-range-track {
    height: 8px;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
  }
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 14px;
    margin-top: -3px;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    border: none;
  }
  &::-moz-range-thumb {
    width: 22px;
    height: 14px;
    border: none;
    border-radius: 0;
    background: ${color.face};
    box-shadow: ${bevel.raised};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]};
`

const Key = styled.button<{ $on?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 34px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 0;
  background: ${({ $on }) => ($on ? color.faceLight : color.face)};
  color: ${({ $on }) => ($on ? color.accentDark : color.ink)};
  box-shadow: ${({ $on }) => ($on ? bevel.pressed : bevel.raised)};
  font-size: ${text.xs};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: ${color.faceLight};
  }
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -4px;
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
  svg {
    width: 12px;
    height: 12px;
  }
`

const Volume = styled.label`
  display: flex;
  align-items: center;
  gap: ${space[1]};
  flex: 1 1 120px;
  min-width: 110px;
  font-size: ${text.xs};
  color: ${color.inkMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
`

const PlaylistBox = styled.div`
  flex: 1 1 auto;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  background: ${color.dark};
  box-shadow: ${bevel.sunken};
  padding: 3px;
`

const List = styled.ol`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ${font.mono};
  font-size: 12px;
`

const Row = styled.li<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto 22px;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  color: ${({ $active }) => ($active ? color.highlight : '#b9b2dc')};
  background: ${({ $active }) => ($active ? '#3b2a5a' : 'transparent')};
  cursor: pointer;
  &:hover {
    background: ${({ $active }) => ($active ? '#3b2a5a' : '#221a35')};
  }
  &:focus-visible {
    outline: 1px dotted ${color.accent};
    outline-offset: -2px;
  }
  .n {
    color: #6f6894;
    text-align: right;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    color: #9d95c4;
    font-variant-numeric: tabular-nums;
  }
  button {
    all: unset;
    cursor: pointer;
    text-align: center;
    color: #6f6894;
    &:hover,
    &:focus-visible {
      color: ${color.accent};
    }
  }
`

const Empty = styled.div`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space[3]};
  padding: ${space[4]};
  text-align: center;
  color: ${color.light};
  p {
    margin: 0;
    font-size: ${text.sm};
    line-height: 1.4;
  }
  small {
    color: #9d95c4;
    font-size: ${text.xs};
  }
`

const Footer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]};
  select {
    height: 28px;
    min-width: 0;
    flex: 1 1 150px;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    font-size: ${text.xs};
    padding: 0 4px;
  }
`

const Status = styled.div<{ tone?: 'error' }>`
  min-height: 16px;
  font-size: ${text.xs};
  color: ${({ tone }) => (tone === 'error' ? color.danger : color.inkMuted)};
`

function Marquee({ value }: { value: string }) {
  const run = value.length > 30
  return (
    <MarqueeBox
      className={run ? 'run' : undefined}
      style={{ ['--marquee-s' as string]: `${Math.max(8, value.length / 4)}s` }}
    >
      <span aria-hidden={run}>{run ? `${value}   ***   ${value}   ***   ` : value}</span>
      {run && <span style={{ position: 'absolute', left: -9999 }}>{value}</span>}
    </MarqueeBox>
  )
}

export default function RadioWindow() {
  const radio = useRadio()
  const clock = useRadioClock()
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const openApp = useOpenApp()
  const { chainId } = useAccount()

  const [remaining, setRemaining] = useState(false)
  const [scrub, setScrub] = useState<number | undefined>()
  const [status, setStatus] = useState<{ text: string; tone?: 'error' }>()
  const [busy, setBusy] = useState(false)

  // Adapters: on-chain music drops per supported chain, plus the curated stations file.
  const sources = useMemo<PlaylistSource[]>(
    () => [...MUSIC_CHAINS.map((c) => musicDropsSource(c.chainId)), stationSource],
    []
  )
  const [sourceId, setSourceId] = useState(`drops:${musicConfig(chainId).chainId}`)

  const { queue, current } = radio
  const duration = clock.duration || current?.duration || 0
  const shown = scrub ?? clock.time
  const timeText = remaining && duration ? `-${formatDuration(Math.max(0, duration - shown))}` : formatDuration(shown)
  const nowIndex = queue.position >= 0 ? (queue.order[queue.position] as number) : -1

  const title = current
    ? `${nowIndex + 1}. ${current.artist ? `${current.artist} - ` : ''}${current.title} (${formatDuration(
        duration || undefined
      )})`
    : 'miya radio *** no track loaded'

  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [nowIndex])

  const loadSource = async () => {
    const source = sources.find((s) => s.id === sourceId) || sources[0]
    if (!source) return
    setBusy(true)
    setStatus({ text: `Loading ${source.label}…` })
    try {
      const tracks = await source.load()
      radio.enqueue(tracks)
      setStatus(
        tracks.length
          ? { text: `Added ${tracks.length} track${tracks.length === 1 ? '' : 's'} from ${source.label}.` }
          : { text: `${source.label}: nothing to add yet.` }
      )
    } catch (e) {
      setStatus({ text: `Could not load ${source.label}.`, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const loadTestTone = () => {
    if (!import.meta.env.DEV) return
    // Served straight from the dev server (never imported, so production builds don't ship the fixture).
    const url = '/src/music/dev-fixtures/test-tone.wav'
    radio.playNow({
      id: 'dev:test-tone',
      title: 'Test tone (synthetic C-E-G-C sine, dev fixture)',
      artist: 'miya radio',
      src: url,
      duration: 2,
      source: 'dev',
    })
  }

  const playingGlyph = radio.loading && radio.playing ? 'wait' : radio.playing ? 'play' : current ? 'pause' : 'stop'

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: pageId }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: pageId }))
        }}
      >
        {Pages.radio?.label}
      </TitleBar>
      <Body>
        <Deck aria-label="Now playing">
          <Clock
            type="button"
            onClick={() => setRemaining((r) => !r)}
            title={
              remaining ? 'Showing time remaining (click for elapsed)' : 'Showing elapsed time (click for remaining)'
            }
            aria-label={`Time ${timeText}`}
          >
            <State aria-hidden="true">
              <Glyph kind={playingGlyph} />
            </State>
            <span>{timeText}</span>
          </Clock>
          <VizBox>
            <Visualizer mode={radio.visualizer} playing={radio.playing} getAnalyser={radio.getAnalyser} />
          </VizBox>
          <Info>
            <Marquee value={title} />
            <Meta>
              <span>
                Track <b>{positionLabel(queue)}</b>
              </span>
              <span>
                Src <b>{current ? current.source : '—'}</b>
              </span>
              <span>
                Viz <b>{radio.visualizer === 'live' ? 'live' : radio.visualizer === 'reduced' ? 'still' : 'off'}</b>
              </span>
            </Meta>
            {radio.error ? (
              <Meta style={{ color: '#ff9db0' }} role="alert">
                {radio.error}
              </Meta>
            ) : (
              <Meta>
                {radio.loading && radio.playing
                  ? 'Buffering…'
                  : current?.token
                  ? `Token #${current.token.tokenId}`
                  : ' '}
              </Meta>
            )}
          </Info>
        </Deck>

        <Range
          aria-label="Seek"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(shown, duration || 1)}
          disabled={!current || !duration}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== undefined) radio.seek(scrub)
            setScrub(undefined)
          }}
          onKeyUp={() => {
            if (scrub !== undefined) radio.seek(scrub)
            setScrub(undefined)
          }}
        />

        <Controls>
          <Key type="button" aria-label="Previous" title="Previous" onClick={radio.prev} disabled={!current}>
            <Glyph kind="prev" />
          </Key>
          <Key
            type="button"
            aria-label={radio.playing ? 'Pause' : 'Play'}
            title={radio.playing ? 'Pause' : 'Play'}
            onClick={radio.toggle}
            disabled={!queue.tracks.length}
          >
            <Glyph kind={radio.playing ? 'pause' : 'play'} />
          </Key>
          <Key type="button" aria-label="Stop" title="Stop" onClick={radio.stop} disabled={!current}>
            <Glyph kind="stop" />
          </Key>
          <Key type="button" aria-label="Next" title="Next" onClick={radio.next} disabled={!current}>
            <Glyph kind="next" />
          </Key>
          <Key
            type="button"
            $on={queue.shuffle}
            aria-pressed={queue.shuffle}
            title="Shuffle"
            onClick={radio.toggleShuffle}
          >
            Shuf
          </Key>
          <Key
            type="button"
            $on={queue.repeat !== 'off'}
            aria-label={`Repeat: ${queue.repeat}`}
            title="Repeat: off / all / one"
            onClick={radio.cycleRepeat}
          >
            Rep{queue.repeat === 'one' ? ' 1' : queue.repeat === 'all' ? ' all' : ''}
          </Key>
          <Volume>
            Vol
            <Range
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={radio.volume}
              onChange={(e) => radio.setVolume(Number(e.target.value))}
            />
          </Volume>
        </Controls>

        <PlaylistBox aria-label="Playlist">
          {queue.tracks.length === 0 ? (
            <Empty>
              <p>No tracks yet — drop music to fill the radio</p>
              <small>Music drops minted on-chain show up here. Load them below, or release your own.</small>
              <BigButton
                type="button"
                style={{ maxWidth: 240, minHeight: 40, fontSize: text.sm }}
                onClick={() => openApp('dropmusic')}
              >
                Drop Music
              </BigButton>
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
        </PlaylistBox>

        <Footer>
          <select aria-label="Playlist source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>
          <Key type="button" onClick={loadSource} disabled={busy}>
            {busy ? 'Loading…' : 'Load'}
          </Key>
          <Key type="button" onClick={radio.clear} disabled={!queue.tracks.length}>
            Clear
          </Key>
          <Key type="button" onClick={() => openApp('dropmusic')}>
            Drop Music
          </Key>
          {import.meta.env.DEV && (
            <Key type="button" onClick={loadTestTone} title="Dev only: play the synthetic test tone fixture">
              Test tone
            </Key>
          )}
        </Footer>
        <Status tone={status?.tone} role="status">
          {status?.text || ' '}
        </Status>
      </Body>
    </WindowWrapper>
  )
}

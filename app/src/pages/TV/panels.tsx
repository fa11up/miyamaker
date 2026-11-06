import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import { useRadio } from '@/context/RadioProvider'
import { fetchStation, toTrack } from '@/music/community'
import { font, space, text } from '@/theme/tokens'

import { airList, parseYouTubeId, STATION_SUBMITTER } from '../../../api/_lib/publicaccess'
import { glow } from './chat/ChatPanel'
import { LAND_PATH } from './earth'
import { fetchTapes, reviewTape, submitTape } from './publicAccess'
import type { Point } from './issMath'
import { bearing, compass, destination, mapSegments, nightSide, viewFan, viewRing } from './issMath'
import { parseVitals, SQUEEK_API } from './squeek'

/* Each channel's own sidebar, in the same dark walnut and cream as its chat. */

const Panel = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]};
  background: ${glow.screen};
  color: ${glow.ink};
  font-size: ${text.sm};
  line-height: 1.35;
  h3 {
    margin: 0;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.md};
    color: ${glow.name};
  }
  p {
    margin: 0;
    color: ${glow.muted};
  }
  a {
    color: ${glow.link};
  }
  button {
    min-height: 30px;
    padding: 0 ${space[2]};
    border: none;
    border-radius: 4px;
    background: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
    box-shadow: 0 2px 0 #6d5c3c;
    color: #2a1a0e;
    font-size: ${text.xs};
    cursor: pointer;
  }
  button:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: 0 1px 0 #6d5c3c;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  input {
    min-width: 0;
    height: 32px;
    padding: 0 ${space[2]};
    border: 1px solid ${glow.line};
    border-radius: 4px;
    background: #120b06;
    color: ${glow.ink};
    font-size: 14px;
  }
`

const Readout = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px ${space[2]};
  dt {
    color: ${glow.muted};
  }
  dd {
    margin: 0;
    font-family: ${font.mono};
    font-size: 13px;
    color: #ffb347;
    text-align: right;
  }
`

const Bar = styled.div`
  height: 10px;
  border-radius: 3px;
  background: #120b06;
  box-shadow: inset 0 1px 3px #000;
  > div {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(180deg, #ffc56b, #cf6a1c);
  }
`

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    padding: 4px 6px;
    border-radius: 4px;
    background: ${glow.panel};
    min-width: 0;
  }
  li.on {
    outline: 1px solid ${glow.name};
  }
  .words {
    flex: 1 1 auto;
    min-width: 0;
  }
  .words b,
  .words span {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .words b {
    font-weight: 400;
  }
  .words span {
    font-size: ${text.xs};
    color: ${glow.muted};
  }
  .row {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }
`

const Row = styled.div`
  display: flex;
  gap: ${space[1]};
  flex-wrap: wrap;
`

const Big = styled.div`
  font-family: ${font.mono};
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  color: #ffb347;
  text-shadow: 0 0 8px rgba(255, 179, 71, 0.5);
`

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/* ---------- Lofi Girl: a focus timer ---------- */

const FOCUS = 25 * 60
const REST = 5 * 60

const Pips = styled.span`
  display: inline-flex;
  gap: 4px;
  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #120b06;
    box-shadow: inset 0 1px 2px #000;
  }
  i.on {
    background: #ffb347;
    box-shadow: 0 0 5px rgba(255, 179, 71, 0.7);
  }
`

const SpreadRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  min-width: 0;
`

export function FocusPanel() {
  const [left, setLeft] = useState(FOCUS)
  const [running, setRunning] = useState(false)
  const [resting, setResting] = useState(false)
  const [done, setDone] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const tick = setInterval(() => {
      setLeft((l) => {
        if (l > 1) return l - 1
        setResting((r) => {
          if (!r) setDone((d) => d + 1)
          setLeft(r ? FOCUS : REST)
          return !r
        })
        return l
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [running])

  const length = resting ? REST : FOCUS
  return (
    <Panel>
      <SpreadRow>
        <h3>{resting ? 'Rest' : 'Focus'}</h3>
        <Pips role="img" aria-label={`${done} sessions done`}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={done % 4 > i || (done > 0 && done % 4 === 0) ? 'on' : undefined} />
          ))}
        </Pips>
      </SpreadRow>
      <SpreadRow>
        <Big role="timer">{mmss(left)}</Big>
        <Row style={{ flexWrap: 'nowrap' }}>
          <button type="button" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Start'}
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(false)
              setResting(false)
              setLeft(FOCUS)
            }}
          >
            Reset
          </button>
        </Row>
      </SpreadRow>
      <Bar
        role="progressbar"
        aria-label="Time through this session"
        aria-valuenow={Math.round((100 * (length - left)) / length)}
      >
        <div style={{ width: `${(100 * (length - left)) / length}%` }} />
      </Bar>
      <p>25 minutes on, 5 off.</p>
    </Panel>
  )
}

/* ---------- Monterey Bay: a spotting log ---------- */

const Tiles = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    min-width: 0;
    text-align: left;
  }
  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  b {
    font-family: ${font.mono};
  }
`

const BIRDS = ['Sandpiper', 'Avocet', 'Snowy plover', 'Oystercatcher', 'Turnstone', 'Someone else']
const SPOTTED_KEY = 'miyatv.spotted'

export function SpottingPanel() {
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(SPOTTED_KEY) || '{}')
    } catch {
      return {}
    }
  })
  const spot = (bird: string) =>
    setCounts((c) => {
      const next = { ...c, [bird]: (c[bird] ?? 0) + 1 }
      try {
        window.localStorage.setItem(SPOTTED_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }

      return next
    })
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <Panel>
      <SpreadRow>
        <h3>Spotting log</h3>
        <Readout as="span" style={{ display: 'block' }}>
          <dd>{total} seen</dd>
        </Readout>
      </SpreadRow>
      <p>Who’s in the aviary? Tap when you see one.</p>
      <Tiles>
        {BIRDS.map((bird) => (
          <button key={bird} type="button" aria-label={`Spotted a ${bird}`} onClick={() => spot(bird)}>
            <span>{bird}</span>
            <b>{counts[bird] ?? 0}</b>
          </button>
        ))}
      </Tiles>
    </Panel>
  )
}

/* ---------- Space Station: where it is right now ---------- */

const Map = styled.svg`
  display: block;
  width: 100%;
  border-radius: 4px;
  background: #0b2a44;
  box-shadow: 0 0 0 1px ${glow.line};
  text {
    font-family: ${font.mono};
    font-size: 8px;
    fill: rgba(243, 231, 207, 0.6);
  }
`

const ISS_API = 'https://api.wheretheiss.at/v1'
type IssPosition = {
  latitude: number
  longitude: number
  altitude: number
  velocity: number
  visibility: string
  footprint: number
  timestamp: number
  solar_lat: number
  solar_lon: number
}

const positionsAt = async (timestamps: number[]) => {
  const res = await fetch(`${ISS_API}/satellites/25544/positions?timestamps=${timestamps.join(',')}`)
  if (!res.ok) throw new Error('No position')
  return (await res.json()) as IssPosition[]
}

const ORBIT_STEP = 180
const toPoint = (p: IssPosition): Point => ({ lat: p.latitude, lon: p.longitude })

export function IssPanel() {
  const iss = useQuery({
    queryKey: ['iss'],
    queryFn: async () => {
      const res = await fetch(`${ISS_API}/satellites/25544`)
      if (!res.ok) throw new Error('No position')
      return (await res.json()) as IssPosition
    },
    refetchInterval: 5000,
  })
  // 45 minutes either side, half an orbit each way. The API takes ten times to a call.
  const orbit = useQuery({
    queryKey: ['iss-orbit'],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000)
      const times = Array.from({ length: 30 }, (_, i) => now + (i - 15) * ORBIT_STEP)
      const parts = await Promise.all([0, 10, 20].map((n) => positionsAt(times.slice(n, n + 10))))
      return parts.flat()
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
  const ahead = useQuery({
    queryKey: ['iss-heading'],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000)
      const [from, to] = await positionsAt([now, now + 60])
      return from && to ? bearing(toPoint(from), toPoint(to)) : undefined
    },
    refetchInterval: 30_000,
    retry: 1,
  })
  const d = iss.data
  const heading = ahead.data
  const over = useQuery({
    queryKey: ['iss-over', d ? Math.round(d.latitude) : 0, d ? Math.round(d.longitude / 5) : 0],
    enabled: !!d,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`${ISS_API}/coordinates/${d!.latitude.toFixed(2)},${d!.longitude.toFixed(2)}`)
      if (!res.ok) throw new Error('No place')
      return ((await res.json()) as { country_code?: string }).country_code
    },
  })

  const here = d && toPoint(d)
  const past = (orbit.data ?? []).filter((p) => !d || p.timestamp <= d.timestamp).map(toPoint)
  const future = (orbit.data ?? []).filter((p) => d && p.timestamp > d.timestamp).map(toPoint)
  const horizon = d ? d.footprint / 2 : 0
  const fan = here && heading !== undefined ? viewFan(here, heading, horizon) : undefined
  // On the map, the arrow follows the line of the orbit, which is what the eye compares it with.
  const nose = here && heading !== undefined ? destination(here, heading, 600) : undefined
  const turn = here && nose ? (Math.atan2(here.lat - nose.lat, nose.lon - here.lon) * 180) / Math.PI : 0

  return (
    <Panel>
      <SpreadRow>
        <h3>Where it is now</h3>
        {heading !== undefined && (
          <Readout as="span" style={{ display: 'block' }}>
            <dd>
              Heading {compass(heading)} · {Math.round(heading)}°
            </dd>
          </Readout>
        )}
      </SpreadRow>
      <Map
        viewBox="-180 -90 360 180"
        role="img"
        aria-label={
          d
            ? `The station is at latitude ${d.latitude.toFixed(0)}, longitude ${d.longitude.toFixed(0)}${
                heading !== undefined ? `, heading ${compass(heading)}` : ''
              }`
            : 'Finding the station'
        }
      >
        <path d={LAND_PATH} fill="#4f7a58" stroke="#274a33" strokeWidth="0.4" />
        {d && <polygon points={nightSide({ lat: d.solar_lat, lon: d.solar_lon })} fill="#01060f" opacity="0.5" />}
        {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={-90}
            y2={90}
            stroke="#f3e7cf"
            strokeOpacity={x === 0 ? 0.35 : 0.14}
            strokeWidth="0.5"
          />
        ))}
        {[-60, -30, 0, 30, 60].map((y) => (
          <line
            key={y}
            x1={-180}
            x2={180}
            y1={y}
            y2={y}
            stroke="#f3e7cf"
            strokeOpacity={y === 0 ? 0.35 : 0.14}
            strokeWidth="0.5"
          />
        ))}
        <text x="-177" y="-62">
          60N
        </text>
        <text x="-177" y="-2">
          EQ
        </text>
        <text x="-177" y="58">
          60S
        </text>
        <text x="-88" y="87">
          90W
        </text>
        <text x="92" y="87">
          90E
        </text>
        {mapSegments(past).map((line) => (
          <polyline key={line} points={line} fill="none" stroke="#ffb347" strokeOpacity="0.55" strokeWidth="1" />
        ))}
        {mapSegments(here ? [here, ...future] : future).map((line) => (
          <polyline key={line} points={line} fill="none" stroke="#fff7e6" strokeWidth="1" strokeDasharray="3 3" />
        ))}
        {here &&
          viewRing(here, horizon).map((line) => (
            <polyline key={line} points={line} fill="none" stroke="#ffb347" strokeWidth="0.8" />
          ))}
        {fan && <polygon points={fan} fill="#ffb347" fillOpacity="0.32" />}
        {d && (
          <g transform={`translate(${d.longitude} ${-d.latitude}) rotate(${turn})`}>
            <path d="M9 0 L-5 -5 L-2 0 L-5 5 Z" fill="#ffb347" stroke="#2a1a0e" strokeWidth="0.8" />
          </g>
        )}
      </Map>
      {iss.isError && !d && <p>Could not find the station just now.</p>}
      {d && (
        <Readout style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
          <dt>Over</dt>
          <dd>{placeName(over.data)}</dd>
          <dt>Outside</dt>
          <dd>{d.visibility === 'daylight' ? 'Sunlight' : 'Shadow'}</dd>
          <dt>Altitude</dt>
          <dd>{d.altitude.toFixed(0)} km</dd>
          <dt>Speed</dt>
          <dd>{Math.round(d.velocity).toLocaleString()} km/h</dd>
        </Readout>
      )}
    </Panel>
  )
}

const placeName = (code?: string) => {
  if (!code) return '…'
  if (code === '??') return 'Open water'
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/* ---------- squeekchain: the hamster's vitals ---------- */

const Wheel = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  > div {
    padding: ${space[1]} ${space[2]};
    border-radius: 4px;
    background: ${glow.panel};
  }
  span {
    display: block;
    font-size: ${text.xs};
    color: ${glow.muted};
  }
  b {
    font-family: ${font.mono};
    font-size: 15px;
    font-weight: 400;
    color: #ffb347;
  }
`

const Lamp = styled.span<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: ${text.xs};
  color: ${glow.muted};
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $on }) => ($on ? '#7be08a' : '#6d5c3c')};
    box-shadow: ${({ $on }) => ($on ? '0 0 6px #7be08a' : 'none')};
  }
`

export function SqueekPanel() {
  const status = useQuery({
    queryKey: ['squeek-status'],
    queryFn: async () => parseVitals(await (await fetch(`${SQUEEK_API}/status`)).json()),
    refetchInterval: 5000,
  })
  const v = status.data
  return (
    <Panel>
      <SpreadRow>
        <h3>Hamster vitals</h3>
        {v && <Lamp $on={v.online}>{v.online ? 'Live from the wheel' : 'Gone quiet'}</Lamp>}
      </SpreadRow>
      {status.isError && !v && <p>Could not reach squeekchain.</p>}
      {v && (
        <>
          <SpreadRow>
            <Big>{v.rpm.toFixed(0)}</Big>
            <p style={{ flex: 1 }}>
              RPM
              <br />
              {v.running ? 'On the wheel' : 'Off the wheel'}
            </p>
          </SpreadRow>
          <Wheel>
            <div>
              <span>Speed</span>
              <b>{v.metresPerMinute.toFixed(1)} m/min</b>
            </div>
            <div>
              <span>This run</span>
              <b>{v.distanceMetres.toFixed(1)} m</b>
            </div>
          </Wheel>
        </>
      )}
    </Panel>
  )
}

/* ---------- miya radio: what's on the station ---------- */

const PageRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  font-size: ${text.xs};
  color: ${glow.muted};
  button {
    min-height: 22px;
  }
`

/** Lists page instead of scrolling, as the panel never scrolls. */
function usePages<T>(items: T[], size: number) {
  const [wanted, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(wanted, pages - 1)
  return {
    shown: items.slice(page * size, (page + 1) * size),
    pager:
      pages > 1 ? (
        <PageRow>
          <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span>
            {page + 1}/{pages}
          </span>
          <button type="button" aria-label="Next page" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </PageRow>
      ) : null,
  }
}

export function RadioPanel() {
  const radio = useRadio()
  const station = useQuery({ queryKey: ['station'], queryFn: fetchStation, refetchInterval: 60_000, retry: 1 })
  const tracks = station.data?.tracks ?? []
  const { shown, pager } = usePages(tracks, 4)
  return (
    <Panel>
      <SpreadRow>
        <h3>On the station</h3>
        {pager}
      </SpreadRow>
      {station.isError && <p>Could not load the station.</p>}
      {station.data && !tracks.length && <p>Nothing here yet.</p>}
      <List>
        {shown.map((t) => {
          const track = toTrack(t)
          return (
            <li key={t.txId} className={radio.current?.id === track.id ? 'on' : undefined}>
              <span className="words">
                <b title={t.title}>{t.title}</b>
                <span title={t.artist}>{t.artist}</span>
              </span>
              <button type="button" aria-label={`Play ${t.title}`} onClick={() => radio.playNow(track)}>
                Play
              </button>
            </li>
          )
        })}
      </List>
    </Panel>
  )
}

/* ---------- public access: the queue, sending in, and the station's review ---------- */

export function PublicPanel({ tapeId, onPick }: { tapeId?: string; onPick: (videoId: string) => void }) {
  const qc = useQueryClient()
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const list = useQuery({ queryKey: ['public-access'], queryFn: fetchTapes, refetchInterval: 60_000, retry: 1 })
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()

  const me = address?.toLowerCase()
  const isAdmin = !!me && !!list.data?.admins.includes(me)
  const tapes = airList(list.data?.tapes)
  const pending = list.data?.pending ?? []
  const sign = (message: string) => signMessageAsync({ message })

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNote(undefined)
    try {
      await work()
      setNote(done)
      qc.invalidateQueries({ queryKey: ['public-access'] })
    } catch (e) {
      const m = (e as { shortMessage?: string })?.shortMessage || (e as Error).message
      setNote(/user rejected|user denied|rejected the request/i.test(m) ? 'You cancelled it in your wallet.' : m)
    } finally {
      setBusy(false)
    }
  }

  const videoId = parseYouTubeId(link)
  const onAir = usePages(tapes, 3)
  const waiting = usePages(pending, 2)
  return (
    <Panel>
      <SpreadRow>
        <h3>On air</h3>
        {onAir.pager}
      </SpreadRow>
      <List>
        {onAir.shown.map((t) => (
          <li key={t.videoId} className={(tapeId ?? tapes[0]?.videoId) === t.videoId ? 'on' : undefined}>
            <span className="words">
              <b title={t.title}>{t.title}</b>
              <span title={t.author}>{t.author}</span>
            </span>
            <span className="row">
              <button type="button" aria-label={`Play ${t.title}`} onClick={() => onPick(t.videoId)}>
                Play
              </button>
              {address && t.submitter !== STATION_SUBMITTER && (isAdmin || t.submitter === me) && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${t.title}`}
                  onClick={() => act(() => reviewTape(t.videoId, 'remove', address, sign), 'Taken off the air.')}
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </List>

      <h3>Send in a tape</h3>
      <SpreadRow>
        <input
          type="url"
          aria-label="YouTube link"
          placeholder="YouTube link"
          style={{ flex: 1 }}
          value={link}
          disabled={busy}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {isConnected && address ? (
          <button
            type="button"
            disabled={!videoId || busy}
            onClick={() =>
              videoId &&
              act(async () => {
                await submitTape(videoId, address, sign)
                setLink('')
              }, 'Sent in. It airs once the station has looked at it.')
            }
          >
            {busy ? 'Working…' : 'Send it in'}
          </button>
        ) : (
          <button type="button" onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        )}
      </SpreadRow>
      {link && !videoId && <p>That doesn’t look like a YouTube video link.</p>}
      {note && <p role="status">{note}</p>}

      {isAdmin && address && (
        <>
          <SpreadRow>
            <h3>Waiting for you ({pending.length})</h3>
            {waiting.pager}
          </SpreadRow>
          <List>
            {waiting.shown.map((t) => (
              <li key={t.videoId}>
                <span className="words">
                  <b title={t.title}>
                    <a href={`https://youtu.be/${t.videoId}`} target="_blank" rel="noopener noreferrer">
                      {t.title}
                    </a>
                  </b>
                  <span title={t.author}>{t.author}</span>
                </span>
                <span className="row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(() => reviewTape(t.videoId, 'approve', address, sign), 'On the air.')}
                  >
                    Air
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(() => reviewTape(t.videoId, 'remove', address, sign), 'Turned down.')}
                  >
                    No
                  </button>
                </span>
              </li>
            ))}
          </List>
        </>
      )}
    </Panel>
  )
}

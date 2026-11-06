import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import { useRadio } from '@/context/RadioProvider'
import { fetchStation, toTrack } from '@/music/community'
import { font, space, text } from '@/theme/tokens'

import { airList, parseYouTubeId, STATION_SUBMITTER } from '../../../api/_lib/publicaccess'
import { glow } from './chat/ChatPanel'
import { fetchTapes, reviewTape, submitTape } from './publicAccess'
import { parseEvents, parseVitals, SQUEEK_API } from './squeek'

/* Each channel's own sidebar, in the same dark walnut and cream as its chat. */

const Panel = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
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

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (!Number.isFinite(s)) return ''
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/* ---------- Lofi Girl: a focus timer ---------- */

const FOCUS = 25 * 60
const REST = 5 * 60

export function FocusPanel({ onRadio }: { onRadio: () => void }) {
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

  return (
    <Panel>
      <h3>{resting ? 'Rest' : 'Focus'}</h3>
      <Big role="timer">{mmss(left)}</Big>
      <Row>
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
      <p>{done ? `${done} session${done === 1 ? '' : 's'} done.` : '25 minutes on, 5 off.'}</p>
      <h3>Want our own music?</h3>
      <p>The community station is on channel 2.</p>
      <Row>
        <button type="button" onClick={onRadio}>
          Go to miya radio
        </button>
      </Row>
    </Panel>
  )
}

/* ---------- Monterey Bay: a spotting log ---------- */

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
      <h3>Spotting log</h3>
      <p>Who’s in the aviary? Tap when you see one. Your own tally, kept on this device.</p>
      <List>
        {BIRDS.map((bird) => (
          <li key={bird}>
            <span className="words">
              <b>{bird}</b>
            </span>
            <span className="row">
              <Readout as="span" style={{ display: 'block' }}>
                <dd>{counts[bird] ?? 0}</dd>
              </Readout>
              <button type="button" aria-label={`Spotted a ${bird}`} onClick={() => spot(bird)}>
                Spotted
              </button>
            </span>
          </li>
        ))}
      </List>
      <p>{total ? `${total} sighting${total === 1 ? '' : 's'} so far.` : 'Nothing logged yet.'}</p>
    </Panel>
  )
}

/* ---------- Space Station: where it is right now ---------- */

const Map = styled.svg`
  display: block;
  width: 100%;
  border-radius: 4px;
  background: #120b06;
`

export function IssPanel() {
  const trail = useRef<[number, number][]>([])
  const iss = useQuery({
    queryKey: ['iss'],
    queryFn: async () => {
      const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544')
      if (!res.ok) throw new Error('No position')
      return (await res.json()) as {
        latitude: number
        longitude: number
        altitude: number
        velocity: number
        visibility: string
      }
    },
    refetchInterval: 5000,
  })
  const d = iss.data
  if (d) {
    const last = trail.current[trail.current.length - 1]
    if (!last || last[0] !== d.longitude) trail.current = [...trail.current.slice(-200), [d.longitude, d.latitude]]
  }

  return (
    <Panel>
      <h3>Where it is now</h3>
      <Map
        viewBox="-180 -90 360 180"
        role="img"
        aria-label={
          d ? `Latitude ${d.latitude.toFixed(0)}, longitude ${d.longitude.toFixed(0)}` : 'Finding the station'
        }
      >
        {[-120, -60, 0, 60, 120].map((x) => (
          <line key={x} x1={x} x2={x} y1={-90} y2={90} stroke={glow.line} strokeWidth="0.6" />
        ))}
        {[-60, -30, 0, 30, 60].map((y) => (
          <line key={y} x1={-180} x2={180} y1={y} y2={y} stroke={glow.line} strokeWidth={y === 0 ? 1.2 : 0.6} />
        ))}
        {trail.current.map(([x, y], i) => (
          <circle key={i} cx={x} cy={-y} r="1.1" fill="#cf6a1c" opacity={0.25 + (0.6 * i) / trail.current.length} />
        ))}
        {d && <circle cx={d.longitude} cy={-d.latitude} r="5" fill="#ffb347" stroke="#fff7e6" strokeWidth="1" />}
      </Map>
      {iss.isError && !d && <p>Could not find the station just now.</p>}
      {d && (
        <Readout>
          <dt>Latitude</dt>
          <dd>{d.latitude.toFixed(2)}°</dd>
          <dt>Longitude</dt>
          <dd>{d.longitude.toFixed(2)}°</dd>
          <dt>Altitude</dt>
          <dd>{d.altitude.toFixed(0)} km</dd>
          <dt>Speed</dt>
          <dd>{Math.round(d.velocity).toLocaleString()} km/h</dd>
          <dt>Outside</dt>
          <dd>{d.visibility === 'daylight' ? 'Sunlight' : 'Earth’s shadow'}</dd>
        </Readout>
      )}
      <p>It goes round every 90 minutes or so. Leave this open and you’ll see its path draw itself.</p>
    </Panel>
  )
}

/* ---------- squeekchain: the hamster's vitals ---------- */

export function SqueekPanel() {
  const status = useQuery({
    queryKey: ['squeek-status'],
    queryFn: async () => parseVitals(await (await fetch(`${SQUEEK_API}/status`)).json()),
    refetchInterval: 5000,
  })
  const events = useQuery({
    queryKey: ['squeek-events'],
    queryFn: async () => parseEvents(await (await fetch(`${SQUEEK_API}/events?limit=8`)).json()),
    refetchInterval: 15_000,
  })
  const v = status.data
  return (
    <Panel>
      <h3>Hamster vitals</h3>
      {status.isError && !v && <p>Could not reach squeekchain.</p>}
      {v && (
        <>
          <Readout>
            <dt>Wheel</dt>
            <dd>{v.running ? 'Running' : 'Stopped'}</dd>
            <dt>Speed</dt>
            <dd>{v.rpm.toFixed(0)} RPM</dd>
            <dt>This run</dt>
            <dd>{v.distanceMetres.toFixed(1)} m</dd>
            <dt>Work done</dt>
            <dd>{v.work}</dd>
            <dt>Block</dt>
            <dd>{v.blockHeight}</dd>
          </Readout>
          <Bar
            role="progressbar"
            aria-label="Progress through this block"
            aria-valuenow={Math.round(v.blockProgress * 100)}
          >
            <div style={{ width: `${v.blockProgress * 100}%` }} />
          </Bar>
          <p>{v.online ? 'Live from the wheel, on testnet.' : 'The wheel has gone quiet.'}</p>
        </>
      )}
      <h3>On the chain</h3>
      <List>
        {(events.data ?? []).map((e) => (
          <li key={e.id}>
            <span className="words">
              <b>{e.words}</b>
              <span>{ago(e.at)}</span>
            </span>
            {e.tx && (
              <a
                href={`https://sepolia.etherscan.io/tx/${e.tx}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on Etherscan"
              >
                ↗
              </a>
            )}
          </li>
        ))}
      </List>
      {events.data && !events.data.length && <p>Nothing has happened yet.</p>}
    </Panel>
  )
}

/* ---------- miya radio: what's on the station ---------- */

export function RadioPanel() {
  const radio = useRadio()
  const station = useQuery({ queryKey: ['station'], queryFn: fetchStation, refetchInterval: 60_000, retry: 1 })
  const tracks = station.data?.tracks ?? []
  return (
    <Panel>
      <h3>Now playing</h3>
      <p>{radio.current ? `${radio.current.title}, ${radio.current.artist}` : 'Nothing yet.'}</p>
      <Row>
        <button type="button" disabled={!radio.current} onClick={radio.toggle}>
          {radio.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" disabled={!radio.current} onClick={radio.next}>
          Next
        </button>
      </Row>
      <h3>On the station</h3>
      {station.isError && <p>Could not load the station.</p>}
      {station.data && !tracks.length && <p>Nothing here yet.</p>}
      <List>
        {tracks.map((t) => {
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
  return (
    <Panel>
      <h3>On air</h3>
      <List>
        {tapes.map((t) => (
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
      <p>Paste a YouTube link. The station looks at it before it airs.</p>
      <input
        type="url"
        aria-label="YouTube link"
        placeholder="https://youtu.be/…"
        value={link}
        disabled={busy}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <Row>
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
      </Row>
      {link && !videoId && <p>That doesn’t look like a YouTube video link.</p>}
      {note && <p role="status">{note}</p>}

      {isAdmin && address && (
        <>
          <h3>Waiting for you ({pending.length})</h3>
          <List>
            {pending.map((t) => (
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

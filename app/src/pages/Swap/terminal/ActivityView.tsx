import { useEffect, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import { explorerUrl } from '@/config/wagmi'

import { shortAddress } from '../board'
import { color, space, text } from '../floor/tokens'
import { formatPrice } from '../nft/markets'
import type { ActivityRow } from './activity'
import { activityTime } from './activity'

/** The ACTIVITY screen (a full table) and the tape along the bottom of the terminal (the latest few, scrolling). */

const AMBER = color.accent

const priceWords = (r: ActivityRow) => {
  if (r.kind === 'mint') return '–'
  try {
    return formatPrice({ amount: BigInt(r.price ?? '0'), decimals: 18, symbol: r.currency ?? 'ETH' })
  } catch {
    return '–'
  }
}

function useNowSeconds() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const Panel = styled.div`
  padding: ${space[3]} ${space[4]};
  .narrow & {
    padding: ${space[2]} ${space[3]};
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${space[2]};
    margin-bottom: ${space[2]};
  }
  h2 {
    margin: 0 ${space[3]} 0 0;
    color: ${AMBER};
    font-size: ${text.sm};
    letter-spacing: 0.14em;
  }
  .filters button {
    padding: 3px 10px;
    border: 1px solid ${color.dark};
    background: #000;
    color: ${color.inkMuted};
    font: inherit;
    font-size: ${text.xs};
    cursor: pointer;
  }
  .filters button[aria-pressed='true'] {
    border-color: ${AMBER};
    color: ${AMBER};
  }
  .note {
    color: ${color.inkMuted};
    font-size: ${text.xs};
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th {
    padding: 4px ${space[2]};
    border-bottom: 1px solid ${color.dark};
    color: ${color.inkMuted};
    font-size: ${text.xs};
    font-weight: 400;
    text-align: left;
  }
  td {
    padding: 6px ${space[2]};
    border-bottom: 1px solid #14181d;
    white-space: nowrap;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover td {
    background: ${color.hover};
  }
  .sale {
    color: ${color.success};
  }
  .mint {
    color: ${AMBER};
  }
  .house {
    color: ${AMBER};
    font-weight: 700;
  }
  .opt {
    .narrow & {
      display: none;
    }
  }
  td.num {
    text-align: right;
  }
  a {
    color: ${color.link};
  }
`

export function ActivityPanel({
  rows,
  loading,
  failed,
  onOpen,
}: {
  rows: ActivityRow[]
  loading: boolean
  failed: string[]
  onOpen: (r: ActivityRow) => void
}) {
  const [only, setOnly] = useState<'all' | 'sale' | 'mint'>('all')
  const now = useNowSeconds()
  const shown = only === 'all' ? rows : rows.filter((r) => r.kind === only)
  return (
    <Panel aria-label="Activity">
      <div className="head">
        <h2>ACTIVITY</h2>
        <span className="filters" role="group" aria-label="Show">
          {(['all', 'sale', 'mint'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)}>
              {k === 'all' ? 'ALL' : k === 'sale' ? 'SALES' : 'MINTS'}
            </button>
          ))}
        </span>
        <span className="note">
          Sales this week across the watchlist; Miyamaker mints as they land. Times in UTC.
          {failed.length ? ` Couldn't read ${failed.join(', ')} right now.` : ''}
        </span>
      </div>
      {loading && !rows.length ? (
        <p className="note">Reading…</p>
      ) : !shown.length ? (
        <p className="note">Nothing yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">TIME</th>
              <th scope="col">TYPE</th>
              <th scope="col">ASSET</th>
              <th scope="col" className="num">
                PRICE
              </th>
              <th scope="col" className="opt">
                FROM → TO
              </th>
              <th scope="col" className="opt">
                TX
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} onClick={() => onOpen(r)} title={`Open ${r.ticker} #${r.tokenId}`}>
                <td>{activityTime(r.at, now)}</td>
                <td className={r.kind}>{r.kind === 'sale' ? 'SALE' : 'MINT'}</td>
                <td>
                  <span className={r.ticker === 'MIYA' ? 'house' : undefined}>{r.ticker}</span> #{r.tokenId}
                </td>
                <td className="num">{priceWords(r)}</td>
                <td className="opt">{r.from && r.to ? `${shortAddress(r.from)} → ${shortAddress(r.to)}` : ''}</td>
                <td className="opt">
                  {r.tx && (
                    <a
                      href={`${explorerUrl(r.chainId)}/tx/${r.tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.tx.slice(0, 8)}…
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

const roll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const TapeBar = styled.footer`
  flex: none;
  display: flex;
  align-items: stretch;
  min-height: 28px;
  overflow: hidden;
  border-top: 1px solid ${color.dark};
  background: #000;
  font-size: ${text.xs};
  .label {
    flex: none;
    display: grid;
    place-items: center;
    padding: 0 ${space[2]};
    background: ${AMBER};
    color: #000;
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .window {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .track {
    display: flex;
    width: max-content;
    height: 100%;
    animation: ${roll} 60s linear infinite;
  }
  &:hover .track,
  &:focus-within .track {
    animation-play-state: paused;
  }
  @media (prefers-reduced-motion: reduce) {
    .track {
      animation: none;
    }
  }
  button {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 ${space[3]};
    border: none;
    border-right: 1px solid #14181d;
    background: none;
    color: ${color.ink};
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  button:hover {
    background: ${color.hover};
  }
  .sale {
    color: ${color.success};
  }
  .mint {
    color: ${AMBER};
  }
  .none {
    padding: 0 ${space[3]};
    align-self: center;
    color: ${color.inkMuted};
  }
`

export function ActivityTape({ rows, onOpen }: { rows: ActivityRow[]; onOpen: (r: ActivityRow) => void }) {
  const now = useNowSeconds()
  const latest = rows.slice(0, 16)
  const cells = (copy: boolean) =>
    latest.map((r) => (
      <button
        key={`${r.key}-${copy}`}
        type="button"
        tabIndex={copy ? -1 : undefined}
        aria-hidden={copy || undefined}
        onClick={() => onOpen(r)}
      >
        <span className={r.kind}>{r.kind === 'sale' ? 'SALE' : 'MINT'}</span>
        <b>
          {r.ticker} #{r.tokenId}
        </b>
        {r.kind === 'sale' && <span>{priceWords(r)}</span>}
        <span style={{ color: color.inkMuted }}>{activityTime(r.at, now)}</span>
      </button>
    ))
  return (
    <TapeBar aria-label="Latest activity">
      <span className="label">TAPE</span>
      <div className="window">
        {latest.length ? (
          <div className="track">
            {cells(false)}
            {cells(true)}
          </div>
        ) : (
          <span className="none">No sales or mints yet.</span>
        )}
      </div>
    </TapeBar>
  )
}

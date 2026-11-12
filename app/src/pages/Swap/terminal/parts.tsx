import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useBlockNumber, useGasPrice } from 'wagmi'

import NftImage from '@/components/NftImage'

import type { PriceStatus } from '../board'
import { changeTone, featuredOn, formatChange, formatUsd, PRICE_STATUS_WORDS } from '../board'
import type { SwapChainId, SwapToken } from '../constants'
import { sameAddress } from '../constants'
import { color, space, text } from '../floor/tokens'
import type { BoardRow } from '../MarketBoard'
import { Change, useCollectionFloor, useEthUsd } from '../MarketBoard'
import type { Command, CommandCollection, CommandToken, Suggestion, TerminalTab } from './command'
import { parseCommand, suggest, TABS, tickerOf } from './command'

/* The terminal's furniture: the status line, the command line, the function keys and the watchlist. */

export const AMBER = color.accent
export const KEY_YELLOW = '#f5c400'

/* ---------- status line ---------- */

const Status = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 ${space[4]};
  min-height: 28px;
  padding: 0 ${space[3]};
  background: #000;
  border-bottom: 1px solid ${color.dark};
  font-size: ${text.xs};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  .brand {
    color: #000;
    background: ${AMBER};
    padding: 2px 8px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .k {
    color: ${AMBER};
    margin-right: 6px;
  }
  .v {
    color: ${color.ink};
  }
  .live {
    color: ${color.success};
  }
  .some,
  .loading {
    color: ${color.warning};
  }
  .off {
    color: ${color.danger};
  }
  .end {
    margin-left: auto;
  }
  .narrow & .opt {
    display: none;
  }
`

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const gwei = (wei: bigint | undefined, failed?: boolean) => {
  if (wei === undefined) return failed ? 'n/a' : '…'
  const g = Number(wei) / 1e9
  return g >= 10 ? g.toFixed(0) : g >= 1 ? g.toFixed(1) : g.toFixed(2)
}

export function StatusLine({
  chainId,
  chainName,
  priceStatus,
  extra,
}: {
  chainId: SwapChainId
  chainName: string
  priceStatus: PriceStatus
  extra?: React.ReactNode
}) {
  const ethUsd = useEthUsd()
  const gas = useGasPrice({ chainId, query: { refetchInterval: 30_000 } })
  const block = useBlockNumber({ chainId, watch: true })
  const now = useClock()
  return (
    <Status role="status" aria-label="Market status">
      <span className="brand">MIYA TERMINAL</span>
      <span>
        <span className="k">NET</span>
        <span className="v">{chainName.toUpperCase()}</span>
      </span>
      <span>
        <span className="k">ETH</span>
        <span className="v">{ethUsd ? formatUsd(ethUsd) : '…'}</span>
      </span>
      <span className="opt">
        <span className="k">GAS</span>
        <span className="v">{gwei(gas.data, gas.isError)} gwei</span>
      </span>
      <span className="opt">
        <span className="k">BLK</span>
        <span className="v">{block.data !== undefined ? block.data.toString() : block.isError ? 'n/a' : '…'}</span>
      </span>
      <span className="opt">
        <span className="k">PX</span>
        <span className={priceStatus} data-price-status={priceStatus}>
          {PRICE_STATUS_WORDS[priceStatus].toUpperCase()}
        </span>
      </span>
      {extra}
      <span className="end v opt" aria-hidden>
        {now.toISOString().slice(11, 19)} UTC
      </span>
    </Status>
  )
}

/* ---------- command line ---------- */

const Cmd = styled.form`
  position: relative;
  display: flex;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]} ${space[3]};
  background: #000;
  .prompt {
    color: ${AMBER};
    font-weight: 700;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 ${space[2]};
    border: 1px solid ${color.dark};
    background: #050505;
    color: #fff;
    font: inherit;
    font-size: ${text.lg};
    letter-spacing: 0.04em;
    text-transform: uppercase;
    caret-color: ${AMBER};
    &::placeholder {
      color: ${color.inkMuted};
      text-transform: none;
      letter-spacing: 0;
      font-size: ${text.sm};
    }
    &:focus {
      outline: none;
      border-color: ${AMBER};
    }
  }
  button.go {
    height: 30px;
    padding: 0 ${space[3]};
    border: none;
    background: ${color.success};
    color: #000;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .narrow & input {
    height: 40px;
  }
  .narrow & button.go {
    height: 40px;
  }
`

const Suggest = styled.ul`
  position: absolute;
  z-index: 20;
  left: calc(${space[3]} + 20px);
  right: ${space[3]};
  top: 100%;
  margin: -${space[1]} 0 0;
  padding: 0;
  list-style: none;
  background: #050505;
  border: 1px solid ${AMBER};
  li {
    display: flex;
    gap: ${space[3]};
    padding: 6px ${space[2]};
    cursor: pointer;
  }
  li[aria-selected='true'] {
    background: ${AMBER};
    color: #000;
  }
  li[aria-selected='true'] .d,
  li[aria-selected='true'] .t {
    color: #000;
  }
  b {
    min-width: 72px;
  }
  .d {
    flex: 1;
    color: ${color.inkMuted};
  }
  .t {
    color: ${AMBER};
    font-size: ${text.xs};
  }
`

export function CommandLine({
  collections,
  tokens,
  disabled,
  onCommand,
  inputRef,
}: {
  collections: readonly CommandCollection[]
  tokens: readonly CommandToken[]
  disabled?: boolean
  onCommand: (c: Command) => void
  inputRef: React.RefObject<HTMLInputElement>
}) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(0)
  const ctx = useMemo(() => ({ collections, tokens }), [collections, tokens])
  const hints = useMemo(() => (open ? suggest(value, ctx) : []), [open, value, ctx])
  useEffect(() => setPick(0), [value])

  const run = (c: Command) => {
    if (c.kind === 'none') return
    onCommand(c)
    setValue('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const take = (s: Suggestion) => {
    // A BUY typed before the suggestion keeps its count.
    const buy = /^\s*(?:buy|sweep)\s+(\d{1,3})?/i.exec(value)
    if (s.kind === 'collection')
      run({ kind: 'collection', collection: s.collection, buy: buy ? Number(buy[1] || 1) : undefined })
    else run({ kind: 'token', token: s.token })
  }

  return (
    <Cmd
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const exact = parseCommand(value, ctx)
        if (exact.kind === 'search' && hints[pick]) take(hints[pick]!)
        else run(exact)
      }}
    >
      <span className="prompt" aria-hidden>
        &gt;
      </span>
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hints.length) {
            e.preventDefault()
            setPick((p) => (p + 1) % hints.length)
          } else if (e.key === 'ArrowUp' && hints.length) {
            e.preventDefault()
            setPick((p) => (p - 1 + hints.length) % hints.length)
          } else if (e.key === 'Escape') {
            setValue('')
            setOpen(false)
          }
        }}
        placeholder="Type MIYA, INFER, BUY 3 MIYA, or paste an address, then Enter"
        role="combobox"
        aria-label="Command: a collection ticker, a token symbol, BUY count ticker, or an address"
        aria-autocomplete="list"
        aria-expanded={hints.length > 0}
        aria-controls="terminal-command-matches"
        aria-activedescendant={hints[pick] ? `terminal-command-match-${pick}` : undefined}
        spellCheck={false}
        autoComplete="off"
      />
      <button className="go" type="submit" disabled={disabled}>
        GO
      </button>
      {hints.length > 0 && (
        <Suggest id="terminal-command-matches" role="listbox" aria-label="Matches">
          {hints.map((h, i) => (
            <li
              key={`${h.kind}-${h.label}-${h.detail}`}
              id={`terminal-command-match-${i}`}
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => {
                e.preventDefault()
                take(h)
              }}
            >
              <b>{h.label}</b>
              <span className="d">{h.detail}</span>
              <span className="t">{h.kind === 'collection' ? 'NFT' : 'TOKEN'}</span>
            </li>
          ))}
        </Suggest>
      )}
    </Cmd>
  )
}

/* ---------- function keys ---------- */

const Keys = styled.nav`
  display: flex;
  gap: 2px;
  padding: 0 ${space[3]} ${space[2]};
  background: #000;
  border-bottom: 1px solid ${color.dark};
  flex-wrap: wrap;
  button {
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    padding: 0;
    border: none;
    background: #111;
    color: ${color.ink};
    font: inherit;
    font-size: ${text.xs};
    cursor: pointer;
    white-space: nowrap;
  }
  button .key {
    display: inline-grid;
    place-items: center;
    padding: 0 6px;
    background: ${KEY_YELLOW};
    color: #000;
    font-weight: 700;
  }
  button .lab {
    padding: 5px 10px;
    letter-spacing: 0.08em;
  }
  button[aria-current='page'] {
    background: ${AMBER};
    color: #000;
    font-weight: 700;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .narrow & {
    padding: 0;
    gap: 0;
    order: 99;
    border-top: 1px solid ${color.dark};
    border-bottom: none;
  }
  .narrow & button {
    flex: 1;
    flex-direction: column;
    align-items: center;
    min-height: 48px;
    justify-content: center;
  }
  .narrow & button .key {
    display: none;
  }
`

export function FunctionKeys({
  tab,
  railOpen,
  busy,
  onTab,
}: {
  tab: TerminalTab
  railOpen: boolean
  /** A trade is in flight: only WATCH (which moves nothing) stays live. */
  busy?: boolean
  onTab: (t: TerminalTab) => void
}) {
  return (
    <Keys aria-label="Terminal functions">
      {TABS.map((t) => (
        <button
          key={t.tab}
          type="button"
          aria-current={(t.tab === 'watch' ? railOpen : t.tab === tab) ? 'page' : undefined}
          disabled={busy && t.tab !== 'watch'}
          onClick={() => onTab(t.tab)}
          title={busy && t.tab !== 'watch' ? 'Finish the trade in progress first' : `${t.label} (${t.key})`}
        >
          <span className="key" aria-hidden>
            {t.key}
          </span>
          <span className="lab">{t.label}</span>
        </button>
      ))}
    </Keys>
  )
}

/* ---------- watchlist (the rail) ---------- */

const List = styled.div`
  display: flex;
  flex-direction: column;
  h3 {
    margin: 0;
    padding: 6px ${space[3]};
    background: #111;
    color: ${AMBER};
    font-size: ${text.xs};
    letter-spacing: 0.14em;
    font-weight: 700;
    border-bottom: 1px solid ${color.dark};
  }
  button {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) auto;
    align-items: center;
    gap: ${space[2]};
    width: 100%;
    padding: 6px ${space[3]};
    border: none;
    border-bottom: 1px solid #14181d;
    background: transparent;
    color: ${color.ink};
    font: inherit;
    font-size: ${text.sm};
    text-align: left;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: ${color.hover};
  }
  button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  button[aria-current='true'] {
    background: #1d1600;
    box-shadow: inset 3px 0 0 ${AMBER};
  }
  .pic {
    width: 26px;
    height: 26px;
    overflow: hidden;
    background: #111;
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .sym {
    display: block;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.04em;
  }
  .house .sym {
    color: ${AMBER};
  }
  .sub {
    display: block;
    color: ${color.inkMuted};
    font-size: ${text.xs};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fig {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .fig small {
    display: block;
    font-size: ${text.xs};
  }
  .badge {
    margin-left: 6px;
    padding: 0 4px;
    background: ${AMBER};
    color: #000;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    vertical-align: 1px;
  }
`

function CollectionLine({
  c,
  active,
  disabled,
  onOpen,
}: {
  c: { slug: string; name: string; address: string }
  active: boolean
  disabled?: boolean
  onOpen: () => void
}) {
  const f = useCollectionFloor(c.slug)
  const house = c.slug === 'miyamaker'
  return (
    <button
      type="button"
      className={house ? 'house' : undefined}
      aria-current={active}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="pic" aria-hidden>
        <NftImage src={f.image} alt="" variant="thumb" />
      </span>
      <span>
        <span className="sym">
          {house ? '★ ' : ''}
          {tickerOf(c)}
          {house && <span className="badge">HOUSE</span>}
        </span>
        <span className="sub">{f.name || c.name}</span>
      </span>
      <span className="fig">
        {f.floorWords}
        <small style={{ color: color.inkMuted }}>floor</small>
      </span>
    </button>
  )
}

export function Watchlist({
  chainId,
  rows,
  activeCollection,
  activeToken,
  busy,
  onCollection,
  onToken,
}: {
  chainId: SwapChainId
  rows: BoardRow[]
  activeCollection?: string
  activeToken?: string
  /** A trade is in flight: opening anything else would move its screen. */
  busy?: boolean
  onCollection: (address: string) => void
  onToken: (t: SwapToken) => void
}) {
  return (
    <List aria-label="Watchlist">
      <h3>NFT · FLOOR</h3>
      {featuredOn(chainId).map((c) => (
        <CollectionLine
          key={c.slug}
          c={c}
          active={sameAddress(c.address, activeCollection)}
          disabled={busy}
          onOpen={() => onCollection(c.address)}
        />
      ))}
      <h3>TOKENS · 24H</h3>
      {rows.map(({ token, quote }) => (
        <button
          key={token.address}
          type="button"
          aria-current={sameAddress(token.address, activeToken)}
          disabled={busy}
          onClick={() => onToken(token)}
          title={`Trade ${token.symbol}`}
        >
          <span className="pic" aria-hidden>
            {token.logoURI ? <img src={token.logoURI} alt="" /> : null}
          </span>
          <span>
            <span className="sym">{token.symbol}</span>
            <span className="sub">{token.name}</span>
          </span>
          <span className="fig">
            {formatUsd(quote?.priceUsd)}
            <small>
              <Change $tone={changeTone(quote?.change24h)}>{formatChange(quote?.change24h)}</Change>
            </small>
          </span>
        </button>
      ))}
    </List>
  )
}

/** Keeps the latest value of a callback for listeners registered once. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

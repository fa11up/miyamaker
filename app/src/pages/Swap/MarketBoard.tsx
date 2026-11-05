import { useQueries, useQuery } from '@tanstack/react-query'
import { Fragment, useMemo } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import NftImage from '@/components/NftImage'

import type { DexPair, TokenQuote } from './board'
import {
  changeTone,
  ethInUsd,
  FEATURED_COLLECTIONS,
  formatChange,
  formatCompactUsd,
  formatUsd,
  quoteFrom,
} from './board'
import type { SwapToken } from './constants'
import { PINNED_TOKENS } from './constants'
import { color, font, space, text } from './floor/tokens'
import { formatPrice } from './nft/markets'
import { useCollectionRow } from './nft/useMarkets'
import { NATIVE } from './tokenList'
import { TokenLogo } from './TokenPicker'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const BOARD_SYMBOLS = ['ETH', 'INFER', 'imdUSD', 'IMD', 'CULT']

/** The tokens the floor quotes, with the address DexScreener prices them under (ETH as WETH). */
const boardTokens = () =>
  BOARD_SYMBOLS.map((s) => PINNED_TOKENS[1].find((t) => t.symbol === s)).filter((t): t is SwapToken => !!t)
const priceAddress = (t: SwapToken) => (t.address.toLowerCase() === NATIVE.toLowerCase() ? WETH : t.address)

export type BoardRow = { token: SwapToken; quote?: TokenQuote }

/** Live quotes for the board. One request per token, shared by the tape and the table, refreshed each minute. */
export function useBoard() {
  const tokens = useMemo(boardTokens, [])
  const results = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ['dex-token', priceAddress(t).toLowerCase()],
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: 1,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/ethereum/${priceAddress(t)}`, { signal })
        if (!res.ok) throw new Error(`DexScreener ${res.status}`)
        return (await res.json()) as DexPair[]
      },
    })),
  })
  const rows: BoardRow[] = tokens.map((token, i) => ({
    token,
    quote: quoteFrom(results[i]?.data, priceAddress(token)),
  }))
  return { rows, loading: results.some((r) => r.isLoading), failed: results.every((r) => r.isError) }
}

/** ETH in dollars, shared with the board's own query. */
export function useEthUsd() {
  const q = useQuery({
    queryKey: ['dex-token', WETH.toLowerCase()],
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/ethereum/${WETH}`, { signal })
      if (!res.ok) throw new Error(`DexScreener ${res.status}`)
      return (await res.json()) as DexPair[]
    },
  })
  return quoteFrom(q.data, WETH)?.priceUsd
}

const Change = styled.span<{ $tone: 'up' | 'down' | 'flat' }>`
  color: ${({ $tone }) => ($tone === 'up' ? color.success : $tone === 'down' ? color.danger : color.inkMuted)};
  font-variant-numeric: tabular-nums;
`

/* ---------- the tape, always on top ---------- */

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`

const TapeBar = styled.div`
  flex: none;
  overflow: hidden;
  border-bottom: 1px solid ${color.dark};
  background: #000;
  .track {
    display: flex;
    width: max-content;
    animation: ${scroll} 45s linear infinite;
  }
  /* Holding still to read or press something. */
  &:hover .track,
  &:focus-within .track {
    animation-play-state: paused;
  }
  button {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: ${space[2]};
    padding: ${space[2]} ${space[3]};
    border: none;
    background: none;
    color: ${color.ink};
    font-size: ${text.xs};
    white-space: nowrap;
    cursor: pointer;
  }
  button::before {
    content: '★';
    color: ${color.accent};
  }
  button:hover {
    background: ${color.hover};
  }
  button:focus-visible {
    outline: 1px dotted ${color.accent};
    outline-offset: -3px;
  }
  b {
    color: ${color.accent};
  }
  @media (prefers-reduced-motion: reduce) {
    overflow-x: auto;
    .track {
      animation: none;
    }
    .copy {
      display: none;
    }
  }
`

export function Tape({ rows, onTrade }: { rows: BoardRow[]; onTrade: (t: SwapToken) => void }) {
  const cells = (copy: boolean) =>
    rows.map(({ token, quote }) => (
      <button
        key={`${token.symbol}-${copy}`}
        type="button"
        className={copy ? 'copy' : undefined}
        tabIndex={copy ? -1 : undefined}
        aria-hidden={copy || undefined}
        title={`Swap for ${token.symbol}`}
        onClick={() => onTrade(token)}
      >
        <b>{token.symbol}</b>
        <span>{formatUsd(quote?.priceUsd)}</span>
        <Change $tone={changeTone(quote?.change24h)}>{formatChange(quote?.change24h)}</Change>
      </button>
    ))
  // Enough copies to fill a wide window, doubled so the loop never shows a gap.
  return (
    <TapeBar role="group" aria-label="Token prices">
      <div className="track">
        {cells(false)}
        {[1, 2, 3].map((n) => (
          <Fragment key={n}>{cells(true)}</Fragment>
        ))}
      </div>
    </TapeBar>
  )
}

/* ---------- the tables ---------- */

const Section = styled.section`
  display: flex;
  flex-direction: column;
  border: 1px solid ${color.dark};
  background: ${color.face};
  /* A lit strip, as on every portal box of the time. */
  h2 {
    margin: 0;
    padding: ${space[2]} ${space[3]};
    border-bottom: 1px solid ${color.accentDark};
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0 1px, transparent 1px 3px),
      linear-gradient(90deg, #4a3408, ${color.face} 70%);
    font-family: ${font.mono};
    font-size: ${text.xs};
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${color.accent};
    text-shadow: 0 0 6px rgba(255, 176, 0, 0.5);
  }
  h2::before {
    content: '★ ';
  }
  .note {
    margin: 0;
    padding: ${space[2]} ${space[3]};
    border-top: 1px solid ${color.light};
    font-size: ${text.xs};
    line-height: 1.4;
    color: ${color.inkMuted};
  }
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${text.sm};
  font-variant-numeric: tabular-nums;
  th {
    padding: ${space[1]} ${space[3]};
    border-bottom: 1px solid ${color.light};
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.inkMuted};
    text-align: right;
    white-space: nowrap;
  }
  td {
    padding: ${space[2]} ${space[3]};
    border-bottom: 1px solid ${color.light};
    text-align: right;
    white-space: nowrap;
  }
  tr:last-child td {
    border-bottom: none;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    width: 100%;
    /* The name takes what is left and gives way first, so a long one never pushes a column out. */
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: ${color.hover};
  }
  tbody tr:hover .go {
    color: ${color.accent};
  }
  .go {
    color: ${color.link};
    white-space: nowrap;
  }
  .name .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .full {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.inkMuted};
  }
  .usd {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .name {
    all: unset;
    box-sizing: border-box;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: ${space[2]};
    font-weight: 700;
    color: ${color.ink};
    cursor: pointer;
  }
  .name:focus-visible {
    outline: 1px dotted ${color.accent};
    outline-offset: 2px;
  }
  .pic {
    width: 28px;
    flex: 0 0 28px;
    overflow: hidden;
  }
  /* The market column narrows first: the less essential figures go, the name and price stay. */
  .slim & .opt {
    display: none;
  }
`

export function TokenTable({
  rows,
  failed,
  onTrade,
}: {
  rows: BoardRow[]
  failed: boolean
  onTrade: (t: SwapToken) => void
}) {
  return (
    <Section aria-label="Tokens">
      <h2>Tokens</h2>
      {failed && <p style={{ margin: 0, padding: space[3], fontSize: text.sm }}>Prices are unavailable right now.</p>}
      <Table>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Price</th>
            <th scope="col">24h</th>
            <th scope="col" className="opt">
              Volume
            </th>
            <th scope="col" className="opt">
              Liquidity
            </th>
            <th scope="col" aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, quote }) => (
            <tr key={token.symbol} onClick={() => onTrade(token)}>
              <td>
                <button
                  type="button"
                  className="name"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTrade(token)
                  }}
                >
                  <TokenLogo token={token} size={22} />
                  <span className="words">
                    {token.symbol}
                    <span className="full">{token.name}</span>
                  </span>
                </button>
              </td>
              <td>{formatUsd(quote?.priceUsd)}</td>
              <td>
                <Change $tone={changeTone(quote?.change24h)}>{formatChange(quote?.change24h)}</Change>
              </td>
              <td className="opt">{formatCompactUsd(quote?.volume24h)}</td>
              <td className="opt">{formatCompactUsd(quote?.liquidityUsd)}</td>
              <td className="go" aria-hidden>
                Swap →
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="note">Press a token to load it into the swap. 24h is the change over the last day.</p>
    </Section>
  )
}

function CollectionRow({
  slug,
  name,
  address,
  onOpen,
}: {
  slug: string
  name: string
  address: string
  onOpen: (address: string) => void
}) {
  const { info, stats, loading } = useCollectionRow(slug)
  const ethUsd = useEthUsd()
  const dash = loading ? '…' : '–'
  return (
    <tr onClick={() => onOpen(address)}>
      <td>
        <button
          type="button"
          className="name"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(address)
          }}
        >
          <span className="pic" aria-hidden>
            <NftImage src={info?.image} alt="" variant="thumb" />
          </span>
          <span className="words">{info?.name || name}</span>
        </button>
      </td>
      <td>
        {stats?.floor ? formatPrice(stats.floor) : loading ? dash : 'None for sale'}
        {stats?.floor?.symbol === 'ETH' && <span className="usd">{ethInUsd(stats.floor.amount, ethUsd)}</span>}
      </td>
      <td className="opt">{stats?.sales7d ?? dash}</td>
      <td className="opt">{stats?.volume7d !== undefined ? `${stats.volume7d.toFixed(1)} ETH` : dash}</td>
      <td className="opt">{stats?.owners?.toLocaleString('en-US') ?? dash}</td>
      <td className="go" aria-hidden>
        Open →
      </td>
    </tr>
  )
}

export function CollectionTable({ onOpen }: { onOpen: (address: string) => void }) {
  return (
    <Section aria-label="Collections">
      <h2>Collections</h2>
      <Table>
        <thead>
          <tr>
            <th scope="col">Collection</th>
            <th scope="col">Floor</th>
            <th scope="col" className="opt">
              Sales 7d
            </th>
            <th scope="col" className="opt">
              Volume 7d
            </th>
            <th scope="col" className="opt">
              Owners
            </th>
            <th scope="col" aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {FEATURED_COLLECTIONS.map((c) => (
            <CollectionRow key={c.slug} slug={c.slug} name={c.name} address={c.address} onOpen={onOpen} />
          ))}
        </tbody>
      </Table>
      <p className="note">Floor is the cheapest one for sale right now. Open a collection to see them and buy.</p>
    </Section>
  )
}

/* ---------- the badge wall ---------- */

const Wall = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  padding-bottom: ${space[3]};
  span {
    box-sizing: border-box;
    width: 88px;
    height: 31px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 4px;
    border: 1px solid #000;
    box-shadow: inset 1px 1px rgba(255, 255, 255, 0.45), inset -1px -1px rgba(0, 0, 0, 0.5);
    font-size: 9px;
    line-height: 1.15;
  }
  b {
    display: block;
    font-size: 11px;
  }
`

/** The 88x31 wall: where the numbers and fills really come from. */
export function BadgeWall() {
  return (
    <Wall aria-label="Where this comes from">
      <span style={{ background: '#000', color: color.success }}>
        swaps by
        <b>0x</b>
      </span>
      <span style={{ background: 'linear-gradient(#2081e2, #0d4f96)', color: '#fff' }}>
        NFTs from
        <b>OpenSea</b>
      </span>
      <span style={{ background: '#1b2630', color: color.accent }}>
        prices by
        <b>DexScreener</b>
      </span>
      <span style={{ background: '#000080', color: '#f5c6f6' }}>
        best viewed in
        <b>miyaOS</b>
      </span>
    </Wall>
  )
}

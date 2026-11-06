import { useQueries, useQuery } from '@tanstack/react-query'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'

import NftImage from '@/components/NftImage'

import type { DexPair, Sort, TokenQuote } from './board'
import {
  changeTone,
  emptyLast,
  ethInUsd,
  featuredOn,
  formatChange,
  formatCompactUsd,
  formatUsd,
  nextSort,
  priceStatus,
  quoteForChain,
  quoteFrom,
  sortRows,
} from './board'
import type { SwapChainId, SwapToken } from './constants'
import { PINNED_TOKENS } from './constants'
import { color, font, space, text } from './floor/tokens'
import { formatPrice, lowerPrice } from './nft/markets'
import { useCollectionRow, useMarketListings } from './nft/useMarkets'
import { NATIVE } from './tokenList'
import { TokenLogo } from './TokenPicker'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const BOARD_SYMBOLS = ['ETH', 'WBTC', 'INFER', 'imdUSD', 'IMD', 'CULT']

/** The tokens the floor quotes, with the address DexScreener prices them under (ETH as WETH). */
const boardTokens = (chainId: SwapChainId) =>
  chainId === 1
    ? BOARD_SYMBOLS.map((s) => PINNED_TOKENS[1].find((t) => t.symbol === s)).filter((t): t is SwapToken => !!t)
    : PINNED_TOKENS[chainId]
const isNative = (t: SwapToken) => t.address.toLowerCase() === NATIVE.toLowerCase()
const priceAddress = (t: SwapToken) => (isNative(t) ? WETH : t.address)
/** ETH is one price everywhere, so it is always read from Ethereum's deepest market. */
const priceChain = (t: SwapToken) => (isNative(t) || t.chainId === 1 ? 'ethereum' : 'robinhood')

/** Every pool DexScreener knows for a token, shared with the board's own query. ETH is read from Ethereum's WETH. */
export function usePairs(token: SwapToken | undefined) {
  return useQuery({
    queryKey: ['dex-token', token ? priceAddress(token).toLowerCase() : ''],
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `https://api.dexscreener.com/token-pairs/v1/${priceChain(token!)}/${priceAddress(token!)}`,
        {
          signal,
        },
      )
      if (!res.ok) throw new Error(`DexScreener ${res.status}`)
      return (await res.json()) as DexPair[]
    },
  })
}

/** One token's dollar price, for "≈ $1,120" beside an amount. Undefined when DexScreener has none. */
export function useTokenUsd(token: SwapToken | undefined) {
  const pairs = usePairs(token)
  return token ? quoteFrom(pairs.data, priceAddress(token))?.priceUsd : undefined
}

export type BoardRow = { token: SwapToken; quote?: TokenQuote }

/** Live quotes for the board. One request per token, shared by the tape and the table, refreshed each minute. */
export function useBoard(chainId: SwapChainId = 1) {
  const tokens = useMemo(() => boardTokens(chainId), [chainId])
  const results = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ['dex-token', priceAddress(t).toLowerCase()],
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: 1,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${priceChain(t)}/${priceAddress(t)}`, {
          signal,
        })
        if (!res.ok) throw new Error(`DexScreener ${res.status}`)
        return (await res.json()) as DexPair[]
      },
    })),
  })
  const rows: BoardRow[] = tokens.map((token, i) => ({
    token,
    quote: quoteForChain(quoteFrom(results[i]?.data, priceAddress(token)), isNative(token), chainId),
  }))
  const loading = results.some((r) => r.isLoading)
  const failed = results.every((r) => r.isError)
  return { rows, loading, failed, status: priceStatus(rows, loading, failed) }
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

export const Change = styled.span<{ $tone: 'up' | 'down' | 'flat' }>`
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
  button:disabled {
    cursor: not-allowed;
  }
  .none {
    display: block;
    padding: ${space[2]} ${space[3]};
    font-size: ${text.xs};
    color: ${color.inkMuted};
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

export function Tape({
  rows,
  loading,
  disabled,
  onTrade,
}: {
  rows: BoardRow[]
  loading?: boolean
  /** A trade is in flight: pressing this would move the page out from under it. */
  disabled?: boolean
  onTrade: (t: SwapToken) => void
}) {
  // A token with no price has nothing to say on the tape.
  const priced = loading ? rows : rows.filter((r) => r.quote)
  if (!priced.length)
    return (
      <TapeBar role="group" aria-label="Token prices">
        <span className="none">No prices right now.</span>
      </TapeBar>
    )
  const cells = (copy: boolean) =>
    priced.map(({ token, quote }) => (
      <button
        key={`${token.symbol}-${copy}`}
        type="button"
        className={copy ? 'copy' : undefined}
        tabIndex={copy ? -1 : undefined}
        aria-hidden={copy || undefined}
        title={`Swap for ${token.symbol}`}
        disabled={disabled}
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

export const Section = styled.section`
  display: flex;
  flex-direction: column;
  border: 1px solid ${color.dark};
  background: ${color.face};
  /* A lit strip, as on every portal box of the time. */
  h2 {
    margin: 0;
    padding: ${space[2]} ${space[3]};
    border-bottom: 1px solid ${color.accentDark};
    background:
      repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0 1px, transparent 1px 3px),
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
  .sort {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .sort:hover,
  .sort[data-on] {
    color: ${color.accent};
  }
  .sort span {
    opacity: 0.45;
    font-size: 9px;
  }
  .narrow & .sort {
    min-height: 36px;
    padding: 8px 0;
  }
  .narrow & .sort span {
    opacity: 0.7;
    font-size: 11px;
  }
  /* The whole row is pressable, so a phone keeps the room for the name. */
  .narrow & td.go,
  .narrow & th:last-child {
    display: none;
  }
  .sort[data-on] span {
    opacity: 1;
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

/** A column header that sorts its table: down, then up, then back to the list's order. */
function SortHead<K extends string>({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string
  column: K
  sort: Sort<K>
  onSort: (next: Sort<K>) => void
  className?: string
}) {
  const dir = sort?.key === column ? sort.dir : undefined
  return (
    <th
      scope="col"
      className={className}
      aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}
    >
      <button
        type="button"
        className="sort"
        data-on={dir ? '' : undefined}
        onClick={() => onSort(nextSort(sort, column))}
      >
        {label}
        <span aria-hidden>{dir === 'desc' ? ' ▼' : dir === 'asc' ? ' ▲' : ' ↕'}</span>
      </button>
    </th>
  )
}

type TokenColumn = 'change' | 'volume' | 'liquidity'
const tokenFigure = ({ quote }: BoardRow, column: TokenColumn) =>
  column === 'change' ? quote?.change24h : column === 'volume' ? quote?.volume24h : quote?.liquidityUsd

export function TokenTable({
  rows,
  failed,
  loading,
  onTrade,
}: {
  rows: BoardRow[]
  failed: boolean
  loading?: boolean
  onTrade: (t: SwapToken) => void
}) {
  const [sort, setSort] = useState<Sort<TokenColumn>>()
  return (
    <Section aria-label="Tokens">
      <h2>Tokens</h2>
      {failed && <p style={{ margin: 0, padding: space[3], fontSize: text.sm }}>Prices are unavailable right now.</p>}
      <Table>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Price</th>
            <SortHead label="24h" column="change" sort={sort} onSort={setSort} />
            <SortHead label="Volume" column="volume" sort={sort} onSort={setSort} className="opt" />
            <SortHead label="Liquidity" column="liquidity" sort={sort} onSort={setSort} className="opt" />
            <th scope="col" aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, sort, tokenFigure).map(({ token, quote }) => (
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
              <td>{quote ? formatUsd(quote.priceUsd) : loading ? '…' : 'No price yet'}</td>
              <td>
                {quote && <Change $tone={changeTone(quote.change24h)}>{formatChange(quote.change24h)}</Change>}
              </td>
              <td className="opt">{quote && formatCompactUsd(quote.volume24h)}</td>
              <td className="opt">{quote && formatCompactUsd(quote.liquidityUsd)}</td>
              <td className="go" aria-hidden>
                Open →
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="note">Press a token for its chart and swap. 24h is the change over the last day.</p>
    </Section>
  )
}

type CollectionColumn = 'floor' | 'sales' | 'volume'
type CollectionFigures = Partial<Record<CollectionColumn, number>> & { nothingForSale?: boolean }

function CollectionRow({
  slug,
  name,
  address,
  onOpen,
  onFigures,
}: {
  slug: string
  name: string
  address: string
  onOpen: (address: string) => void
  /** Each row loads its own numbers, so it tells the table what to sort by. */
  onFigures: (slug: string, figures: CollectionFigures) => void
}) {
  const { info, stats, loading } = useCollectionRow(slug)
  const market = useMarketListings(slug)
  const floor = lowerPrice(stats?.floor, market.floor)
  const floorEth = floor ? Number(floor.amount) / 10 ** floor.decimals : undefined
  const nothingForSale = !loading && !market.loading && !floor
  useEffect(() => {
    onFigures(slug, { floor: floorEth, sales: stats?.sales7d, volume: stats?.volume7d, nothingForSale })
  }, [slug, floorEth, stats?.sales7d, stats?.volume7d, nothingForSale, onFigures])
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
        {floor ? formatPrice(floor) : loading ? dash : 'None for sale'}
        {floor?.symbol === 'ETH' && <span className="usd">{ethInUsd(floor.amount, ethUsd)}</span>}
      </td>
      <td className="opt">{stats?.sales7d ?? dash}</td>
      <td className="opt">{stats?.volume7d !== undefined ? `${stats.volume7d.toFixed(1)} ETH` : dash}</td>
      <td className="go" aria-hidden>
        Open →
      </td>
    </tr>
  )
}

export type { CollectionColumn }

export function CollectionTable({
  chainId,
  onOpen,
  sort,
  onSort,
}: {
  chainId: number
  onOpen: (address: string) => void
  /** Held by the caller, so a chosen order survives opening a collection and coming back. */
  sort: Sort<CollectionColumn>
  onSort: (next: Sort<CollectionColumn>) => void
}) {
  const [figures, setFigures] = useState<Record<string, CollectionFigures>>({})
  const onFigures = useCallback(
    (slug: string, next: CollectionFigures) => setFigures((all) => ({ ...all, [slug]: next })),
    [],
  )
  return (
    <Section aria-label="Collections">
      <h2>Collections</h2>
      <Table>
        <thead>
          <tr>
            <th scope="col">Collection</th>
            <SortHead label="Floor" column="floor" sort={sort} onSort={onSort} />
            <SortHead label="Sales 7d" column="sales" sort={sort} onSort={onSort} className="opt" />
            <SortHead label="Volume 7d" column="volume" sort={sort} onSort={onSort} className="opt" />
            <th scope="col" aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {sortRows(
            emptyLast(featuredOn(chainId), (c) => !!figures[c.slug]?.nothingForSale),
            sort,
            (c, column) => figures[c.slug]?.[column],
          ).map((c) => (
            <CollectionRow
              key={c.slug}
              slug={c.slug}
              name={c.name}
              address={c.address}
              onOpen={onOpen}
              onFigures={onFigures}
            />
          ))}
        </tbody>
      </Table>
      <p className="note">Floor is the cheapest one for sale right now. Open a collection to see them and buy.</p>
    </Section>
  )
}

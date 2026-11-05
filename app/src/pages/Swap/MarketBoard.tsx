import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import styled from 'styled-components/macro'

import NftImage from '@/components/NftImage'

import type { DexPair, TokenQuote } from './board'
import { changeTone, FEATURED_COLLECTIONS, formatChange, formatCompactUsd, formatUsd, quoteFrom } from './board'
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

const Change = styled.span<{ $tone: 'up' | 'down' | 'flat' }>`
  color: ${({ $tone }) => ($tone === 'up' ? color.success : $tone === 'down' ? color.danger : color.inkMuted)};
  font-variant-numeric: tabular-nums;
`

/* ---------- the tape, always on top ---------- */

const TapeBar = styled.div`
  flex: none;
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid ${color.dark};
  background: ${color.well};
  button {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: ${space[2]};
    padding: ${space[2]} ${space[3]};
    border: none;
    border-right: 1px solid ${color.light};
    background: none;
    color: ${color.ink};
    font-size: ${text.xs};
    white-space: nowrap;
    cursor: pointer;
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
`

export function Tape({ rows, onTrade }: { rows: BoardRow[]; onTrade: (t: SwapToken) => void }) {
  return (
    <TapeBar role="group" aria-label="Token prices">
      {rows.map(({ token, quote }) => (
        <button key={token.symbol} type="button" title={`Trade ${token.symbol}`} onClick={() => onTrade(token)}>
          <b>{token.symbol}</b>
          <span>{formatUsd(quote?.priceUsd)}</span>
          <Change $tone={changeTone(quote?.change24h)}>{formatChange(quote?.change24h)}</Change>
        </button>
      ))}
    </TapeBar>
  )
}

/* ---------- the tables ---------- */

const Section = styled.section`
  display: flex;
  flex-direction: column;
  border: 1px solid ${color.dark};
  background: ${color.face};
  h2 {
    margin: 0;
    padding: ${space[2]} ${space[3]};
    border-bottom: 1px solid ${color.dark};
    font-family: ${font.mono};
    font-size: ${text.xs};
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${color.accent};
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
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: ${color.hover};
  }
  .name {
    all: unset;
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
                  {token.symbol}
                </button>
              </td>
              <td>{formatUsd(quote?.priceUsd)}</td>
              <td>
                <Change $tone={changeTone(quote?.change24h)}>{formatChange(quote?.change24h)}</Change>
              </td>
              <td className="opt">{formatCompactUsd(quote?.volume24h)}</td>
              <td className="opt">{formatCompactUsd(quote?.liquidityUsd)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
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
          {info?.name || name}
        </button>
      </td>
      <td>{stats?.floor ? formatPrice(stats.floor) : dash}</td>
      <td className="opt">{stats?.sales7d ?? dash}</td>
      <td className="opt">{stats?.volume7d !== undefined ? `${stats.volume7d.toFixed(1)} ETH` : dash}</td>
      <td className="opt">{stats?.owners?.toLocaleString('en-US') ?? dash}</td>
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
          </tr>
        </thead>
        <tbody>
          {FEATURED_COLLECTIONS.map((c) => (
            <CollectionRow key={c.slug} slug={c.slug} name={c.name} address={c.address} onOpen={onOpen} />
          ))}
        </tbody>
      </Table>
    </Section>
  )
}

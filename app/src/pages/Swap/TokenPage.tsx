import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount } from 'wagmi'

import { explorerUrl } from '@/config/wagmi'
import { ALCHEMY_KEY } from '@/desktop/files/indexer'

import type { DexMarket } from './board'
import {
  buyShare,
  changeTone,
  formatAge,
  formatChange,
  formatCompactUsd,
  formatUsd,
  marketLinks,
  marketsFor,
  shortAddress,
} from './board'
import type { SwapChainId, SwapToken } from './constants'
import { DEFAULT_PAIR, isNative, sameAddress } from './constants'
import { Chip } from './floor/retro'
import { color, space, text } from './floor/tokens'
import { Change, Section, usePairs } from './MarketBoard'
import { Action, LinkButton } from './nft/ui'
import TokenChart from './TokenChart'
import { TokenLogo } from './TokenPicker'
import type { SwapPreset } from './TokenSwap'
import TokenSwap from './TokenSwap'
import { searchTokens } from './tokenList'
import { useCustomToken, useTokenList } from './useTokens'
import { formatAmount, historyNetwork, mergeMoves, transferQuery } from './history'

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  min-height: 100%;
  &.one {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Market = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]} ${space[4]};
`

const Dock = styled.div`
  min-width: 0;
  border-left: 1px solid ${color.dark};
  background: ${color.face};
  .one & {
    border-left: none;
    border-top: 1px solid ${color.dark};
  }
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  .who {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: ${text.lg};
  }
  small {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .addr {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    font-size: ${text.xs};
    font-variant-numeric: tabular-nums;
    color: ${color.inkMuted};
  }
  .addr button {
    padding: 0;
    border: none;
    background: none;
    color: ${color.link};
    font-size: ${text.xs};
    text-decoration: underline;
    cursor: pointer;
  }
  .narrow & .addr button {
    min-height: 44px;
    min-width: 44px;
  }
  .price {
    margin-left: auto;
    text-align: right;
    font-size: ${text.xl};
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
`

const Figures = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 1px;
  margin: 0;
  background: ${color.dark};
  border: 1px solid ${color.dark};
  div {
    padding: ${space[2]};
    background: ${color.well};
  }
  dt {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  /* Three across on a phone: the odd last one takes the empty cell, so no slate block shows. */
  .narrow & div:last-child:nth-child(3n + 2) {
    grid-column: span 2;
  }
`

const Pressure = styled.div`
  display: grid;
  gap: ${space[1]};
  padding: ${space[2]} ${space[3]};
  font-size: ${text.xs};
  .row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 112px;
    align-items: center;
    gap: ${space[2]};
    font-variant-numeric: tabular-nums;
  }
  .row.head {
    display: block;
    text-align: right;
    color: ${color.inkMuted};
  }
  .bar {
    height: 8px;
    background: ${color.danger};
  }
  .bar > span {
    display: block;
    height: 100%;
    background: ${color.success};
  }
`

const Pools = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${text.sm};
  th,
  td {
    padding: ${space[2]} ${space[3]};
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  th {
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.inkMuted};
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  tbody tr {
    border-top: 1px solid ${color.dark};
    cursor: pointer;
  }
  tbody tr:hover,
  tbody tr[aria-selected='true'] {
    background: ${color.hover};
  }
  .slim & .opt {
    display: none;
  }
`

const Links = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  font-size: ${text.sm};
  a {
    color: ${color.link};
    text-transform: capitalize;
  }
  .narrow & a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
`

const Results = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: ${space[2]};
    padding: ${space[2]} ${space[3]};
    border: none;
    border-top: 1px solid ${color.dark};
    background: none;
    color: ${color.ink};
    font-size: ${text.sm};
    text-align: left;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: ${color.hover};
  }
  button:disabled {
    color: ${color.inkMuted};
    cursor: not-allowed;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
  }
  small {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .go {
    color: ${color.link};
    white-space: nowrap;
  }
`

const Quiet = styled.p`
  margin: 0;
  padding: ${space[4]};
  border: 1px solid ${color.dark};
  color: ${color.inkMuted};
  font-size: ${text.sm};
  text-align: center;
`

const History = styled.section`
  padding: 0 ${space[4]} ${space[4]};
  font-size: ${text.xs};
  .narrow & {
    padding: 0 ${space[3]} ${space[3]};
  }
  h3 {
    margin: 0 0 ${space[1]};
    font-size: ${text.xs};
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${color.inkMuted};
  }
  p {
    margin: 0;
    color: ${color.inkMuted};
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: ${space[2]};
    padding: ${space[1]} 0;
    border-top: 1px solid ${color.dark};
    font-variant-numeric: tabular-nums;
  }
  .in {
    color: ${color.success};
  }
  .out {
    color: ${color.danger};
  }
  a {
    color: ${color.link};
    white-space: nowrap;
  }
  .narrow & a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
`

/** What this wallet has done with the token, under the swap. */
function TokenHistory({ chainId, token }: { chainId: SwapChainId; token: SwapToken }) {
  const { address } = useAccount()
  const network = historyNetwork(chainId)
  const q = useQuery({
    queryKey: ['token-history', chainId, token.address.toLowerCase(), address?.toLowerCase()],
    enabled: !!address && !!network && !!ALCHEMY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const native = isNative(token.address)
      const answers = await Promise.all(
        (['fromAddress', 'toAddress'] as const).map(async (side) => {
          const res = await fetch(`https://${network}.g.alchemy.com/v2/${ALCHEMY_KEY}`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(transferQuery(token.address, native, side, address as string)),
          })
          if (!res.ok) throw new Error(`History ${res.status}`)
          return res.json()
        }),
      )
      return mergeMoves(answers, address as string)
    },
  })
  const now = Date.now()
  return (
    <History aria-label={`Your ${token.symbol} history`} data-token-history>
      <h3>Your {token.symbol} history</h3>
      {!address ? (
        <p>Connect a wallet to see it.</p>
      ) : !network || !ALCHEMY_KEY ? (
        <p>Not available on this network yet.</p>
      ) : q.isLoading ? (
        <p>Looking it up…</p>
      ) : q.isError ? (
        <p>Could not load it just now.</p>
      ) : !q.data?.length ? (
        <p>This wallet has not moved any {token.symbol} yet.</p>
      ) : (
        <ol>
          {q.data.map((m) => (
            <li key={m.id}>
              <span className={m.side}>
                {m.side === 'in' ? '+' : '−'}
                {formatAmount(m.amount)} {token.symbol}
              </span>
              <a href={`${explorerUrl(chainId)}/tx/${m.hash}`} target="_blank" rel="noopener noreferrer">
                {formatAge(m.at, now)} ago ↗
              </a>
            </li>
          ))}
        </ol>
      )}
    </History>
  )
}

/** The tokens side of the home page's search: names from the big list, or a pasted address. */
export function TokenResults({
  query,
  tokens,
  pasted,
  loading,
  onOpen,
}: {
  query: string
  tokens: SwapToken[]
  pasted?: SwapToken
  loading: boolean
  onOpen: (token: SwapToken) => void
}) {
  const hits = pasted ? [pasted] : (searchTokens(tokens, query.trim()) as SwapToken[]).slice(0, 12)
  return (
    <Section aria-label="Token results">
      <h2>Tokens</h2>
      {hits.length ? (
        <Results>
          {hits.map((t) => (
            <li key={t.address}>
              <button type="button" disabled={!!t.blocked} title={t.blocked} onClick={() => onOpen(t)}>
                <TokenLogo token={t} size={24} />
                <span className="who">
                  <b>{t.symbol}</b>
                  <small>{t.blocked || t.name}</small>
                </span>
                {t.unverified && <Chip tone="warn">Not verified: check the address</Chip>}
                <span className="go">Open →</span>
              </button>
            </li>
          ))}
        </Results>
      ) : (
        <Quiet style={{ border: 'none' }}>{loading ? 'Searching…' : 'No tokens match that.'}</Quiet>
      )}
    </Section>
  )
}

const WINDOWS = [
  ['m5', '5m'],
  ['h1', '1h'],
  ['h6', '6h'],
  ['h24', '24h'],
] as const

/** The short address, and a way to take the whole of it. */
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <span className="addr" data-token-address>
      <span title={address}>{shortAddress(address)}</span>
      <button
        type="button"
        aria-label={`Copy address ${address}`}
        onClick={() => {
          navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

const venueName = (m: DexMarket) =>
  `${m.dexId ?? 'pool'}${m.labels?.[0] ? ` ${m.labels[0]}` : ''} · ${m.baseToken?.symbol ?? ''}/${m.quoteToken?.symbol ?? ''}`

/** One token's page in Trade: its chart and market beside the swap. */
export default function TokenPage({
  chainId,
  onChain,
  onBusy,
  address,
  preset,
  onBack,
  backLabel,
  onOffline,
}: {
  chainId: SwapChainId
  onChain: (chainId: SwapChainId) => void
  onBusy: (busy: boolean) => void
  /** The token in the path, if any: anything else opens on the chain's default. */
  address?: `0x${string}`
  preset?: SwapPreset
  onBack: () => void
  backLabel: string
  onOffline: (offline: boolean) => void
}) {
  const [rootRef, { width }] = useElementSize()
  const oneColumn = width > 0 && width < 820
  const list = useTokenList(chainId)
  const custom = useCustomToken(chainId, address ?? '', list.tokens)
  const fallback = DEFAULT_PAIR[chainId][1]
  const token =
    (address && list.tokens.find((t) => sameAddress(t.address, address))) ||
    custom.token ||
    (address ? undefined : fallback)
  const [own, setOwn] = useState<SwapPreset>()

  const pairs = usePairs(token)
  const priceAt = token && isNative(token.address) ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' : token?.address
  const markets = useMemo(() => marketsFor(pairs.data as DexMarket[] | undefined, priceAt ?? ''), [pairs.data, priceAt])
  const [pairAddress, setPairAddress] = useState<string>()
  const market = markets.find((m) => m.pairAddress === pairAddress) ?? markets[0]
  useEffect(() => setPairAddress(undefined), [token?.address])

  // The swap follows the token on the page: buy it with ETH, unless something asked for a particular pair.
  const tokenAddress = token?.address
  useEffect(() => {
    if (!token) return
    const asked =
      preset && (sameAddress(preset.buy?.address, token.address) || sameAddress(preset.sell?.address, token.address))
    if (asked) return
    const [eth, other] = DEFAULT_PAIR[chainId]
    setOwn({ key: Date.now(), chainId, sell: eth, buy: isNative(token.address) ? other : token })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress, chainId])
  const swapPreset = preset && (!own || preset.key > own.key) ? preset : own

  const now = Date.now()
  const links = marketLinks(market)
  // ETH's market is read from Ethereum: its price holds on any chain, its pools and volume do not.
  const borrowedMarket = !!token && isNative(token.address) && chainId !== 1
  const dockRef = useRef<HTMLDivElement>(null)

  return (
    <Layout ref={rootRef} className={oneColumn ? 'one' : undefined}>
      <Market data-token-market>
        <LinkButton type="button" onClick={onBack} data-token-back>
          ← {backLabel}
        </LinkButton>

        {!token ? (
          <Quiet>{custom.isLoading ? 'Finding that token…' : 'That is not a token on this network.'}</Quiet>
        ) : (
          <>
            <Head>
              <span className="who">
                <TokenLogo token={token} size={40} />
                <span>
                  <h2>{token.symbol}</h2>
                  <small>{token.name}</small>
                  {!isNative(token.address) && <CopyAddress address={token.address} />}
                </span>
              </span>
              {token.unverified && <Chip tone="warn">Not verified: check the address</Chip>}
              <span className="price" data-token-price>
                {market ? formatUsd(Number(market.priceUsd)) : '–'}
                <small>
                  {market && (
                    <Change $tone={changeTone(market.priceChange?.h24)}>
                      {formatChange(market.priceChange?.h24)} 24h
                    </Change>
                  )}
                </small>
              </span>
            </Head>

            {oneColumn && (
              <Action
                type="button"
                data-token-swap-jump
                onClick={() => {
                  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                  dockRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
                }}
              >
                Swap {token.symbol} ↓
              </Action>
            )}

            {market ? (
              <TokenChart
                chain={market.chainId}
                pool={market.pairAddress}
                token={priceAt}
                symbol={token.symbol}
                livePrice={Number(market.priceUsd)}
              />
            ) : (
              <Quiet>
                {pairs.isLoading
                  ? 'Getting the market…'
                  : `No market data for ${token.symbol} yet. You can still swap it here.`}
              </Quiet>
            )}

            {borrowedMarket && (
              <Quiet>This is ETH&apos;s price on Ethereum. Its pools and volume there are not shown here.</Quiet>
            )}

            {market && !borrowedMarket && (
              <>
                <Figures aria-label="Market figures">
                  <div>
                    <dt>Market cap</dt>
                    <dd>{formatCompactUsd(market.marketCap)}</dd>
                  </div>
                  <div>
                    <dt>Fully diluted</dt>
                    <dd>{formatCompactUsd(market.fdv)}</dd>
                  </div>
                  <div>
                    <dt>Liquidity</dt>
                    <dd>{formatCompactUsd(market.liquidity?.usd)}</dd>
                  </div>
                  <div>
                    <dt>Volume 24h</dt>
                    <dd>{formatCompactUsd(market.volume?.h24)}</dd>
                  </div>
                  <div>
                    <dt>Pool age</dt>
                    <dd>{formatAge(market.pairCreatedAt, now)}</dd>
                  </div>
                </Figures>

                <Section aria-label="Trading">
                  <h2>Buys and sells</h2>
                  <Pressure>
                    <div className="row head">Buys / Sells / Change</div>
                    {WINDOWS.map(([k, label]) => {
                      const t = market.txns?.[k]
                      const share = buyShare(t)
                      return (
                        <div className="row" key={k}>
                          <span>{label}</span>
                          <span className="bar" style={share === undefined ? { background: color.dark } : undefined}>
                            {share !== undefined && <span style={{ width: `${share}%` }} />}
                          </span>
                          <span>
                            {t?.buys ?? 0} / {t?.sells ?? 0}{' '}
                            <Change $tone={changeTone(market.priceChange?.[k])}>
                              {formatChange(market.priceChange?.[k])}
                            </Change>
                          </span>
                        </div>
                      )
                    })}
                  </Pressure>
                </Section>

                {markets.length > 1 && (
                  <Section aria-label="Pools">
                    <h2>Where it trades</h2>
                    <Pools>
                      <thead>
                        <tr>
                          <th scope="col">Pool</th>
                          <th scope="col">Price</th>
                          <th scope="col">24h</th>
                          <th scope="col" className="opt">
                            Volume
                          </th>
                          <th scope="col">Liquidity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {markets.slice(0, 6).map((m) => (
                          <tr
                            key={m.pairAddress}
                            aria-selected={m === market}
                            title="Show this pool on the chart"
                            onClick={() => setPairAddress(m.pairAddress)}
                          >
                            <td>{venueName(m)}</td>
                            <td>{formatUsd(Number(m.priceUsd))}</td>
                            <td>
                              <Change $tone={changeTone(m.priceChange?.h24)}>{formatChange(m.priceChange?.h24)}</Change>
                            </td>
                            <td className="opt">{formatCompactUsd(m.volume?.h24)}</td>
                            <td>{formatCompactUsd(m.liquidity?.usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Pools>
                  </Section>
                )}
              </>
            )}

            <Links>
              {!isNative(token.address) && (
                <a href={`${explorerUrl(chainId)}/token/${token.address}`} target="_blank" rel="noopener noreferrer">
                  Explorer ↗
                </a>
              )}
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                  {l.label} ↗
                </a>
              ))}
            </Links>
          </>
        )}
      </Market>

      <Dock ref={dockRef}>
        <TokenSwap chainId={chainId} onChain={onChain} onBusy={onBusy} preset={swapPreset} onOffline={onOffline} />
        {token && <TokenHistory chainId={chainId} token={token} />}
      </Dock>
    </Layout>
  )
}

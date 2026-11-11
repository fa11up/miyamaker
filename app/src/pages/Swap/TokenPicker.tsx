import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import type { SwapChainId, SwapToken } from './constants'
import { sameAddress } from './constants'
import { feeFree } from './fee'
import { Skeleton } from './floor/retro'
import { bevel, color, font, space, text } from './floor/tokens'
import { searchTokens } from './tokenList'
import { useCustomToken } from './useTokens'

const LogoImg = styled.img<{ size: number }>`
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  min-width: ${({ size }) => size}px;
  max-width: none;
  margin: 0;
  border: 1px solid ${color.dark};
  border-radius: 50%;
  background: ${color.highlight};
  object-fit: cover;
  &:hover {
    border: 1px solid ${color.dark};
  }
`

const Monogram = styled.span<{ size: number; tint: string }>`
  display: inline-grid;
  place-items: center;
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  min-width: ${({ size }) => size}px;
  border-radius: 50%;
  border: 1px solid ${color.dark};
  background: ${({ tint }) => tint};
  box-shadow: inset 2px 2px rgba(255, 255, 255, 0.35), inset -2px -2px rgba(0, 0, 0, 0.3);
  color: ${color.highlight};
  font-family: ${font.ui};
  font-weight: 700;
  font-size: ${({ size }) => Math.max(10, Math.round(size * 0.44))}px;
  line-height: 1;
  letter-spacing: 0;
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.45);
`

/** Token logo; a tinted monogram when there is no logo or it fails to load (nothing is hotlinked for it). */
export function TokenLogo({
  token,
  size = 24,
}: {
  token: Pick<SwapToken, 'logoURI' | 'symbol' | 'tint' | 'mark'>
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [token.logoURI])
  if (!token.logoURI || failed) {
    const mark =
      token.mark ||
      token.symbol
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 2)
        .toUpperCase() ||
      '?'
    return (
      <Monogram size={size} tint={token.tint || color.shadow} aria-hidden>
        {mark}
      </Monogram>
    )
  }

  return <LogoImg size={size} src={token.logoURI} alt="" loading="lazy" onError={() => setFailed(true)} />
}

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(20, 16, 31, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: ${space[4]};
  .narrow & {
    padding: 0;
  }
`

const Dialog = styled.div`
  width: 100%;
  max-width: 440px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: 3px;
  .narrow & {
    max-width: none;
    height: 100%;
  }
`

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  min-height: 32px;
  padding: 0 3px 0 ${space[2]};
  background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
  color: ${color.highlight};
  font-weight: 700;
  button {
    width: 28px;
    height: 24px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.xs};
    cursor: pointer;
    &:active {
      box-shadow: ${bevel.pressed};
    }
  }
  .narrow & {
    min-height: 44px;
    button {
      width: 44px;
      height: 36px;
    }
  }
`

const Search = styled.input`
  margin: ${space[2]};
  height: 40px;
  padding: 0 ${space[2]};
  border: none;
  border-radius: 0;
  background: ${color.well};
  box-shadow: ${bevel.field};
  font-size: ${text.md};
  .narrow & {
    height: 44px;
  }
`

const List = styled.ul`
  list-style: none;
  margin: 0 ${space[2]} ${space[2]};
  padding: 2px;
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
`

const Section = styled.li`
  position: sticky;
  top: -2px;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: ${space[2]};
  padding: ${space[1]} ${space[2]};
  background: ${color.light};
  border-bottom: 1px solid ${color.shadow};
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.inkMuted};
`

const Row = styled.button<{ selected?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${space[3]};
  min-height: 52px;
  padding: ${space[1]} ${space[2]};
  border: none;
  text-align: left;
  cursor: pointer;
  background: ${({ selected }) => (selected ? color.light : 'transparent')};
  color: ${color.ink};
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .sym {
    font-size: ${text.md};
  }
  .name {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reason {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: normal;
  }
  .tag {
    flex: none;
    font-size: ${text.xs};
    padding: 2px ${space[1]};
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    color: ${color.success};
  }
  .check {
    flex: none;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  &:hover:not(:disabled),
  &:focus-visible {
    background: ${color.faceLight};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -3px;
  }
  &:disabled {
    cursor: not-allowed;
    .sym,
    img,
    span[aria-hidden] {
      opacity: 0.5;
    }
  }
`

const Note = styled.div<{ tone?: 'warn' }>`
  margin: 0 ${space[2]} ${space[2]};
  padding: ${space[2]};
  font-size: ${text.sm};
  line-height: 1.35;
  background: ${({ tone }) => (tone === 'warn' ? color.faceLight : color.well)};
  box-shadow: ${bevel.sunken};
  color: ${({ tone }) => (tone === 'warn' ? color.warning : color.inkMuted)};
`

const LIMIT = 150

function TokenRow({
  token,
  selected,
  onSelect,
}: {
  token: SwapToken
  selected: boolean
  onSelect: (t: SwapToken) => void
}) {
  const noFee = token.miya && feeFree(token.address, '')
  return (
    <li>
      <Row
        type="button"
        selected={selected}
        disabled={!!token.blocked}
        aria-current={selected || undefined}
        onClick={() => onSelect(token)}
        data-token={token.symbol}
      >
        <TokenLogo token={token} size={32} />
        <span className="meta">
          <span className="sym">{token.symbol}</span>
          {token.blocked ? <span className="reason">{token.blocked}</span> : <span className="name">{token.name}</span>}
        </span>
        {noFee && <span className="tag">no fee</span>}
        {selected && <span className="check">selected</span>}
      </Row>
    </li>
  )
}

export default function TokenPicker({
  chainId,
  side,
  tokens,
  loading,
  listError,
  selected,
  onSelect,
  onClose,
}: {
  chainId: SwapChainId
  side: 'sell' | 'buy'
  tokens: SwapToken[]
  loading: boolean
  listError: boolean
  selected?: SwapToken
  onSelect: (token: SwapToken) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const custom = useCustomToken(chainId, query, tokens)

  const { miya, rest } = useMemo(() => {
    const found = custom.listed ? [custom.listed] : searchTokens(tokens, query)
    return { miya: found.filter((t) => t.miya), rest: found.filter((t) => !t.miya).slice(0, LIMIT) }
  }, [tokens, query, custom.listed])

  const title = side === 'sell' ? 'Pick a token to pay with' : 'Pick a token to get'

  return (
    <Overlay onClick={onClose}>
      <Dialog role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <Bar>
          <span>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose}>
            X
          </button>
        </Bar>
        <Search
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name, or paste an address"
          aria-label="Search tokens"
          spellCheck={false}
          autoComplete="off"
        />
        {custom.token && (
          <>
            <Note tone="warn" role="alert">
              This token is on no list we trust. Anyone can make a token with any name. Check the address first.
            </Note>
            <List style={{ flex: '0 0 auto', minHeight: 0 }}>
              <TokenRow
                token={{ ...custom.token, name: `${custom.token.name} (not verified)` }}
                selected={false}
                onSelect={onSelect}
              />
            </List>
          </>
        )}
        {custom.isLoading && (
          <Note>
            <Skeleton h="14px" w="60%" />
          </Note>
        )}
        {custom.notAToken && <Note tone="warn">That address is not a token on this network.</Note>}
        {custom.checkFailed && (
          <Note tone="warn" role="alert">
            Couldn&apos;t check that address right now. Try again in a moment.
          </Note>
        )}
        {!custom.token && !custom.isLoading && !custom.notAToken && !custom.checkFailed && (
          <List aria-label="Tokens">
            {miya.length > 0 && (
              <Section aria-hidden>
                <span>miya list</span>
              </Section>
            )}
            {miya.map((t) => (
              <TokenRow
                key={t.address}
                token={t}
                selected={sameAddress(t.address, selected?.address)}
                onSelect={onSelect}
              />
            ))}
            {(rest.length > 0 || loading) && (
              <Section aria-hidden>
                <span>All tokens</span>
                <span>Uniswap list</span>
              </Section>
            )}
            {rest.map((t) => (
              <TokenRow
                key={t.address}
                token={t}
                selected={sameAddress(t.address, selected?.address)}
                onSelect={onSelect}
              />
            ))}
            {loading && (
              <li style={{ padding: space[2] }}>
                <Skeleton h="14px" />
              </li>
            )}
            {!loading && miya.length + rest.length === 0 && (
              <li style={{ padding: space[3], fontSize: text.sm, color: color.inkMuted }}>
                No match. Paste a token address to use any token.
              </li>
            )}
          </List>
        )}
        {listError && <Note>The big token list did not load. Showing the miya list only.</Note>}
      </Dialog>
    </Overlay>
  )
}

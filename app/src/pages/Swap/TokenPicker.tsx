import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { Skeleton } from '@/components/Retro'
import { bevel, color, space, text } from '@/theme/tokens'

import type { SwapChainId, SwapToken } from './constants'
import { sameAddress } from './constants'
import { useCustomToken } from './useTokens'

const LogoImg = styled.img<{ size: number }>`
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  min-width: ${({ size }) => size}px;
  max-width: none;
  margin: 0;
  border: 1px solid ${color.shadow};
  border-radius: 50%;
  background: ${color.highlight};
  object-fit: cover;
  &:hover {
    border: 1px solid ${color.shadow};
  }
`

const Initials = styled.span<{ size: number }>`
  display: inline-grid;
  place-items: center;
  width: ${({ size }) => size}px;
  height: ${({ size }) => size}px;
  min-width: ${({ size }) => size}px;
  border-radius: 50%;
  background: ${color.dark};
  color: ${color.highlight};
  font-size: ${({ size }) => Math.max(9, Math.round(size * 0.42))}px;
  letter-spacing: 0;
`

/** Token logo with initials fallback when there is no logo or it fails to load. */
export function TokenLogo({ token, size = 24 }: { token: Pick<SwapToken, 'logoURI' | 'symbol'>; size?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [token.logoURI])
  if (!token.logoURI || failed) {
    return (
      <Initials size={size} aria-hidden>
        {token.symbol.slice(0, 2).toUpperCase()}
      </Initials>
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
  max-width: 420px;
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
  height: 28px;
  padding: 0 3px 0 ${space[2]};
  background: linear-gradient(90deg, ${color.titleFrom}, ${color.titleTo});
  color: ${color.highlight};
  font-weight: 700;
  button {
    width: 22px;
    height: 20px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    font-size: ${text.xs};
    cursor: pointer;
  }
`

const Search = styled.input`
  margin: ${space[2]};
  height: 36px;
  padding: 0 ${space[2]};
  border: none;
  border-radius: 0;
  background: ${color.well};
  box-shadow: ${bevel.field};
`

const List = styled.ul`
  list-style: none;
  margin: 0 ${space[2]} ${space[2]};
  padding: 2px;
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  background: ${color.well};
  box-shadow: ${bevel.sunken};
`

const Row = styled.button<{ selected?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${space[2]};
  min-height: 44px;
  padding: ${space[1]} ${space[2]};
  border: none;
  text-align: left;
  cursor: pointer;
  background: ${({ selected }) => (selected ? color.accent : 'transparent')};
  color: ${({ selected }) => (selected ? color.highlight : color.ink)};
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-size: ${text.xs};
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &:hover:not(:disabled) {
    background: ${color.titleTo};
    color: ${color.highlight};
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`

const Note = styled.div<{ tone?: 'warn' }>`
  margin: 0 ${space[2]} ${space[2]};
  padding: ${space[2]};
  font-size: ${text.xs};
  line-height: 1.4;
  background: ${({ tone }) => (tone === 'warn' ? '#fff3cd' : color.well)};
  box-shadow: ${bevel.sunken};
  color: ${({ tone }) => (tone === 'warn' ? color.warning : color.inkMuted)};
`

const LIMIT = 150

export default function TokenPicker({
  chainId,
  tokens,
  loading,
  listError,
  selected,
  other,
  onSelect,
  onClose,
}: {
  chainId: SwapChainId
  tokens: SwapToken[]
  loading: boolean
  listError: boolean
  selected?: SwapToken
  other?: SwapToken
  onSelect: (token: SwapToken) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const custom = useCustomToken(chainId, query, tokens)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (custom.listed) return [custom.listed]
    if (!q) return tokens.slice(0, LIMIT)
    return tokens
      .filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .slice(0, LIMIT)
  }, [tokens, query, custom.listed])

  return (
    <Overlay onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <Dialog role="dialog" aria-label="Select a token" onClick={(e) => e.stopPropagation()}>
        <Bar>
          <span>Select a token</span>
          <button type="button" aria-label="Close" onClick={onClose}>
            X
          </button>
        </Bar>
        <Search
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or paste address"
          aria-label="Search tokens"
          spellCheck={false}
        />
        {custom.token && (
          <>
            <Note tone="warn" role="alert">
              Unverified token. It is not on the Uniswap list. Anyone can create a token with any name, so check the
              address before trading.
            </Note>
            <List style={{ flex: '0 0 auto', minHeight: 0 }}>
              <li>
                <Row type="button" onClick={() => onSelect(custom.token!)}>
                  <TokenLogo token={custom.token} />
                  <span className="meta">
                    <span>{custom.token.symbol} (unverified)</span>
                    <span className="name">{custom.token.name}</span>
                  </span>
                </Row>
              </li>
            </List>
          </>
        )}
        {custom.isLoading && (
          <Note>
            <Skeleton h="14px" w="60%" />
          </Note>
        )}
        {custom.notAToken && <Note tone="warn">That address is not an ERC-20 token on this chain.</Note>}
        {!custom.token && !custom.isLoading && !custom.notAToken && (
          <List>
            {filtered.map((t) => (
              <li key={t.address}>
                <Row
                  type="button"
                  selected={sameAddress(t.address, selected?.address)}
                  disabled={sameAddress(t.address, other?.address)}
                  onClick={() => onSelect(t)}
                >
                  <TokenLogo token={t} />
                  <span className="meta">
                    <span>{t.symbol}</span>
                    <span className="name">{t.name}</span>
                  </span>
                </Row>
              </li>
            ))}
            {loading && (
              <li style={{ padding: space[2] }}>
                <Skeleton h="14px" />
              </li>
            )}
            {!loading && filtered.length === 0 && (
              <li style={{ padding: space[3], fontSize: text.xs, color: color.inkMuted }}>
                No tokens match. Paste a token address to use any token.
              </li>
            )}
          </List>
        )}
        {listError && <Note>Token list unavailable; showing pinned tokens only.</Note>}
      </Dialog>
    </Overlay>
  )
}

import type { CSSProperties } from 'react'
import styled from 'styled-components/macro'
import { useEnsName } from 'wagmi'

import { color, space, text } from '@/theme/tokens'
import { safeHttpUrl } from '@/utils/resolveUri'

const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[1]};
  min-width: 0;
  max-width: 100%;
  font-size: ${text.sm};
  color: ${color.ink};

  a {
    color: inherit;
    text-decoration: underline;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

/* A dark badge, because artists' logos are often white on transparent. */
const Logo = styled.img`
  flex: none;
  width: 20px;
  height: 20px;
  padding: 2px;
  background: ${color.dark};
  border: none;
  image-rendering: pixelated;

  :hover {
    border: none;
  }
`

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** "by <artist>" on a collection: its curated credit, or for a registry drop the owner's ENS name or address. */
export default function ArtistTag({
  artist,
  logo,
  url,
  address,
  explorer,
  style,
}: {
  artist?: string
  logo?: string
  url?: string
  address?: `0x${string}`
  explorer?: string
  style?: CSSProperties
}) {
  const ens = useEnsName({ address, chainId: 1, query: { enabled: !artist && !!address, staleTime: 3_600_000 } })
  const name = artist || ens.data || (address ? shortAddress(address) : undefined)
  if (!name) return null

  const link = safeHttpUrl(url) || (address && explorer ? `${explorer}/address/${address}` : undefined)
  return (
    <Tag style={style} onClick={(e) => e.stopPropagation()}>
      {logo && <Logo src={logo} alt="" />}
      <span>by</span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer noopener" title={name}>
          {name}
        </a>
      ) : (
        <strong>{name}</strong>
      )}
    </Tag>
  )
}

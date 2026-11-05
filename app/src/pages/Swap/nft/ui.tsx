import styled from 'styled-components/macro'
import type { Address } from 'viem'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'

import { BigButton, Panel } from '../floor/retro'
import { bevel, color, font, space, text } from '../floor/tokens'
import type { PoolKind } from './pool'
import { useNftMeta } from './usePools'

/** Building blocks shared by the NFTs tab (pool list and pool view), in the Tokens tab's style. */

export const Card = styled(Panel)`
  gap: ${space[2]};
  padding: ${space[3]};
`

export const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  flex-wrap: wrap;
  h2 {
    margin: 0;
    font-size: ${text.lg};
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
`

export const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
`

export const Hint = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
`

export const Prose = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.4;
  color: ${color.ink};
`

export const LinkButton = styled.button`
  align-self: flex-start;
  border: none;
  background: none;
  padding: ${space[1]} 0;
  color: ${color.link};
  text-decoration: underline;
  font-size: ${text.sm};
  cursor: pointer;
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
`

export const PushButton = styled.button`
  min-height: 36px;
  padding: 0 ${space[3]};
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  font-size: ${text.sm};
  cursor: pointer;
  &:hover:not(:disabled) {
    background: ${color.faceLight};
  }
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
  &[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.well};
    font-weight: 700;
  }
  .narrow & {
    min-height: 44px;
  }
`

export const Field = styled.input`
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 ${space[2]};
  border: none;
  border-radius: 0;
  background: ${color.well};
  box-shadow: ${bevel.field};
  color: ${color.ink};
  font-size: ${text.sm};
  &::placeholder {
    color: ${color.shadow};
  }
  .narrow & {
    height: 44px;
  }
`

export const Mono = styled.span`
  font-family: ${font.mono};
  font-size: ${text.xs};
  overflow-wrap: anywhere;
`

export const Stat = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space[3]};
  font-size: ${text.sm};
  color: ${color.inkMuted};
  strong {
    color: ${color.ink};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
`

/** Two-way switch inside a card (Buy / Sell), same look as the network buttons. */
export const Segmented = styled.div`
  display: flex;
  gap: 2px;
  button {
    flex: 1;
    height: 36px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
    font-size: ${text.sm};
    cursor: pointer;
    .narrow & {
      height: 44px;
    }
  }
  button[aria-pressed='true'] {
    box-shadow: ${bevel.pressed};
    background: ${color.well};
    font-weight: 700;
  }
`

/* The primary action stays reachable while the grid scrolls, like the Tokens tab. */
export const ActionDock = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  margin: 0 -${space[4]};
  padding: ${space[2]} ${space[4]};
  background: ${color.face};
  box-shadow: inset 0 1px 0 ${color.dark};
  .narrow & {
    margin: 0 -${space[3]};
    padding: ${space[2]} ${space[3]};
  }
`

export const Action = styled(BigButton)`
  &:disabled {
    color: ${color.inkMuted};
  }
`

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: ${space[2]};
  .narrow & {
    grid-template-columns: repeat(3, 1fr);
  }
`

const TileBox = styled.button`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: none;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  text-align: left;
  cursor: pointer;
  min-width: 0;
  position: relative;
  &:disabled {
    cursor: default;
  }
  &[aria-pressed='true'] {
    background: ${color.accent};
    box-shadow: ${bevel.pressed};
  }
  &[aria-pressed='true']::after {
    content: '✓';
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    background: ${color.accent};
    color: ${color.onAccent};
    font-weight: 700;
    box-shadow: ${bevel.raised};
  }
  .label {
    display: flex;
    justify-content: space-between;
    gap: ${space[1]};
    padding: 0 2px;
    font-size: ${text.xs};
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

/** One NFT: picture, number and (ERC1155) how many. Selectable when `onToggle` is given. */
export function NftTile({
  chainId,
  collection,
  kind,
  id,
  units,
  image,
  name,
  selected,
  onToggle,
}: {
  chainId: SupportedChainId
  collection: Address
  kind: PoolKind
  id: bigint
  units?: bigint
  /** Known already (e.g. from the indexer): skips the tokenURI read. */
  image?: string
  name?: string
  selected?: boolean
  onToggle?: () => void
}) {
  const meta = useNftMeta(chainId, image ? undefined : collection, kind, id)
  const label = `#${id.toString()}`
  const title = name || meta.name || label
  return (
    <TileBox
      type="button"
      aria-pressed={onToggle ? !!selected : undefined}
      disabled={!onToggle}
      onClick={onToggle}
      title={title}
      aria-label={`${title}${units !== undefined && units > 1n ? `, ${units} in the pool` : ''}`}
    >
      <NftImage src={image || meta.image} alt="" variant="thumb" />
      <span className="label">
        <span>{label}</span>
        {units !== undefined && units > 1n && <span>×{units.toString()}</span>}
      </span>
    </TileBox>
  )
}

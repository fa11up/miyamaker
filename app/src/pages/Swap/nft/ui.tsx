import type { ReactNode } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'

import { BigButton, Panel, StatusBox } from '../floor/retro'
import { bevel, color, font, space, text } from '../floor/tokens'
import type { PoolKind } from './pool'
import { useOpenSeaNftImage } from './useMarkets'
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
  .narrow & a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
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
  .narrow & {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
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

const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${space[2]};
  font-size: ${text.sm};
  line-height: 1.3;
  cursor: pointer;
  input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: ${color.accent};
  }
  .narrow & {
    min-height: 44px;
  }
`

/** A plain "yes, I looked" before a risky buy. The button stays off until it is ticked. */
export function ConfirmCheck({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <CheckRow>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </CheckRow>
  )
}

const SwitchHint = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.warning};
`

/** Why the button says Switch, and what to do when the wallet would not. */
export function SwitchNote({ chainName, failed }: { chainName: string; failed: boolean }) {
  return failed ? (
    <StatusBox tone="error" role="alert" data-switch-failed>
      <span>Your wallet did not switch. Open it, choose {chainName}, then come back.</span>
    </StatusBox>
  ) : (
    <SwitchHint data-switch-hint>Your wallet is on another network. Switch to {chainName} to continue.</SwitchHint>
  )
}

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
  // Many collections' metadata hosts refuse browsers, so a token's own link can come back empty. OpenSea has a copy.
  const fallback = useOpenSeaNftImage(
    chainId,
    image || meta.image || meta.loading ? undefined : collection,
    id.toString(),
  )
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
      <NftImage src={image || meta.image || fallback} alt="" variant="thumb" />
      <span className="label">
        <span>{label}</span>
        {units !== undefined && units > 1n && <span>×{units.toString()}</span>}
      </span>
    </TileBox>
  )
}

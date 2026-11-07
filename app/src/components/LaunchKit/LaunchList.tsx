import styled from 'styled-components/macro'

import { Skeleton } from '@/components/Retro'
import { KIND_LABEL, progressLabel } from '@/miyamints/collections'
import type { MyLaunch } from '@/miyamints/useMyLaunches'
import { bevel, color, space, text } from '@/theme/tokens'

import { SmallButton, Thumb } from '.'

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Item = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: ${space[2]};
  align-items: center;
  padding: ${space[1]} ${space[2]};
  min-height: 48px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: ${color.ink};
  font: inherit;
  text-align: left;
  cursor: pointer;
  .name {
    font-size: ${text.sm};
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &:hover,
  &:focus-visible {
    background: ${color.titleTo};
    color: ${color.highlight};
    outline: none;
    .meta {
      color: ${color.light};
    }
  }
  &[aria-current='true'] {
    box-shadow: ${bevel.sunken};
    background: ${color.well};
  }
`

const Empty = styled.div`
  padding: ${space[3]};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  align-items: flex-start;
  font-size: ${text.sm};
  color: ${color.ink};
  p {
    margin: 0;
    line-height: 1.4;
  }
`

const Placeholder = styled.div`
  width: 100%;
  height: 100%;
  background: repeating-linear-gradient(45deg, ${color.shadow} 0 4px, ${color.dark} 4px 8px);
`

export function LaunchRow({ l, onPick, current }: { l: MyLaunch; onPick: (l: MyLaunch) => void; current?: boolean }) {
  const progress = progressLabel(l.kind, l.minted, l.supply)
  return (
    <Item type="button" role="menuitem" aria-current={current ? 'true' : undefined} onClick={() => onPick(l)}>
      <Thumb $size={40}>{l.image ? <img src={l.image} alt="" loading="lazy" /> : <Placeholder />}</Thumb>
      <span style={{ minWidth: 0 }}>
        <div className="name">{l.name}</div>
        <div className="meta">{[l.chainName, KIND_LABEL[l.kind], progress].filter(Boolean).join(' · ')}</div>
      </span>
    </Item>
  )
}

/** The wallet's launches, with loading, error and empty states. Shared by the taskbar menu and Manage. */
export default function LaunchList({
  launches,
  loading,
  error,
  onPick,
  onLaunch,
  onRetry,
  currentKey,
}: {
  launches: MyLaunch[]
  loading: boolean
  error?: Error | null
  onPick: (l: MyLaunch) => void
  /** Only the Start menu has this: an app does not open another app. */
  onLaunch?: () => void
  onRetry?: () => void
  currentKey?: string
}) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], padding: space[2] }} aria-busy="true">
        <Skeleton h="40px" />
        <Skeleton h="40px" />
        <span style={{ fontSize: text.xs, color: color.inkMuted }}>Looking for your launches…</span>
      </div>
    )
  }

  if (error && !launches.length) {
    return (
      <Empty role="alert">
        <p>Could not load your launches. The network may be busy.</p>
        {onRetry && (
          <SmallButton type="button" onClick={onRetry}>
            Try again
          </SmallButton>
        )}
      </Empty>
    )
  }

  if (!launches.length) {
    return (
      <Empty>
        <p>No launches yet. Collections you create with Launch show up here.</p>
        {onLaunch && (
          <SmallButton type="button" onClick={onLaunch} role="menuitem">
            Launch one
          </SmallButton>
        )}
      </Empty>
    )
  }

  return (
    <List role="none">
      {launches.map((l) => (
        <li key={`${l.chainId}:${l.address}`} role="none">
          <LaunchRow l={l} onPick={onPick} current={currentKey === `${l.chainId}:${l.address.toLowerCase()}`} />
        </li>
      ))}
    </List>
  )
}

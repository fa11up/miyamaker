import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'

import { SplitMeter } from '@/components/LaunchKit'
import { Chip, Eyebrow } from '@/components/Retro'
import type { LaunchForm } from '@/miyamints/launch'
import { parseEth, parseWhole } from '@/miyamints/launch'
import { ethLabel } from '@/miyamints/split'
import { bevel, color, font, space, text } from '@/theme/tokens'

export const TYPE_LABEL = { drop: 'Fixed-price drop', auction: 'Auction', editions: 'Editions', '': 'Not picked yet' }

export const PreviewCard = styled.aside<{ $compact?: boolean }>`
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: ${space[3]};
  display: flex;
  flex-direction: ${({ $compact }) => ($compact ? 'row' : 'column')};
  gap: ${space[3]};
  align-items: ${({ $compact }) => ($compact ? 'center' : 'stretch')};
  min-width: 0;
`

const Art = styled.div<{ $compact?: boolean }>`
  background: ${color.dark};
  box-shadow: ${bevel.sunken};
  padding: 3px;
  aspect-ratio: 1 / 1;
  width: ${({ $compact }) => ($compact ? '64px' : '100%')};
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: ${color.light};
  font-size: ${text.xs};
  text-align: center;
  overflow: hidden;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: none;
    margin: 0;
    max-width: none;
    display: block;
  }
`

const Name = styled.div`
  font-family: ${font.display};
  font-size: ${text.lg};
  line-height: 1.15;
  color: ${color.ink};
  overflow-wrap: anywhere;
`

const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px ${space[3]};
  font-size: ${text.sm};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
`

export function priceLine(form: LaunchForm): string {
  if (form.type === 'drop') {
    const p = parseEth(form.phases[0]?.price || '', { allowZero: true })
    return p.ok ? (p.wei === 0n ? 'Free' : `${ethLabel(p.wei)} each`) : '—'
  }

  if (form.type === 'auction') {
    const p = parseEth(form.reserve)
    return p.ok ? `Bids from ${ethLabel(p.wei)}` : '—'
  }

  if (form.type === 'editions') {
    const p = parseEth(form.editionPrice)
    if (!p.ok) return '—'
    const rise = (form.editionRise || '').trim()
    if (!rise || /^0+(?:\.0+)?$/.test(rise)) return `${ethLabel(p.wei)} a copy`
    return `${ethLabel(p.wei)} to start, then +${rise}% a copy`
  }

  return '—'
}

export function supplyLine(form: LaunchForm): string {
  if (form.type === 'drop') {
    const s = parseWhole(form.supply, { min: 1, max: 100_000, label: 'Supply' })
    return s.ok ? `${s.n.toLocaleString('en-US')} ${s.n === 1 ? 'piece' : 'pieces'}` : '—'
  }

  if (form.type === 'auction') return '1 piece'
  if (form.type === 'editions') {
    const s = parseWhole(form.editionSupply, { min: 1, max: 1_000_000, label: 'Supply', blank: 0 })
    return s.ok ? (s.n ? `${s.n.toLocaleString('en-US')} copies` : 'Open edition') : '—'
  }

  return '—'
}

export default function Preview({
  form,
  imageUrl,
  protocolBps,
  alignmentBps,
  vaultName,
  compact,
}: {
  form: LaunchForm
  imageUrl?: string
  protocolBps: number
  alignmentBps?: number
  vaultName?: string
  compact?: boolean
}) {
  const name = form.name.trim() || 'Your collection'
  // A pasted link that does not load says so instead of showing a broken image.
  const [broken, setBroken] = useState<string>()
  useEffect(() => setBroken(undefined), [imageUrl])
  const art =
    imageUrl && broken === imageUrl ? (
      <span>We could not load that link. Check that it opens in a new tab, or upload the file instead.</span>
    ) : imageUrl ? (
      <img src={imageUrl} alt="" onError={() => setBroken(imageUrl)} />
    ) : (
      <span>Your artwork shows here</span>
    )
  if (compact) {
    return (
      <PreviewCard $compact aria-label="Preview">
        <Art $compact>{art}</Art>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>{TYPE_LABEL[form.type]}</Eyebrow>
          <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{name}</div>
          <div style={{ fontSize: text.sm, color: color.inkMuted }}>
            {priceLine(form)} · {supplyLine(form)}
          </div>
        </div>
      </PreviewCard>
    )
  }

  return (
    <PreviewCard aria-label="Preview">
      <Eyebrow>Preview: how collectors see it</Eyebrow>
      <Art>{art}</Art>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
        <Name>{name}</Name>
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          <Chip tone={form.type ? 'ok' : 'off'}>{TYPE_LABEL[form.type]}</Chip>
          {form.symbol && form.type !== 'editions' && <Chip>{form.symbol.toUpperCase().slice(0, 10)}</Chip>}
          {form.type === 'editions' && form.editionKind === 'music' && <Chip>Music</Chip>}
        </div>
      </div>
      <Facts>
        <dt>Price</dt>
        <dd>{priceLine(form)}</dd>
        <dt>Supply</dt>
        <dd>{supplyLine(form)}</dd>
      </Facts>
      {alignmentBps !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
          <Eyebrow>Where the money goes</Eyebrow>
          <SplitMeter protocolBps={protocolBps} alignmentBps={alignmentBps} vaultName={vaultName} compact />
        </div>
      )}
    </PreviewCard>
  )
}

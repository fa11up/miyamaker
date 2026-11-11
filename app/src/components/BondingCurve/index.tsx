/**
 * Pick the ERC-1155 bonding curve for a release. The percent is what the edition stores:
 * blank or 0 is a flat price, anything else rises with each copy sold.
 */
import styled from 'styled-components/macro'

import { Err, Field, Segmented, SmallButton } from '@/components/LaunchKit'
import { ethLabel } from '@/miyamints/split'
import { CURVES, CURVE_WINDOW, curveCaption, curveId, curvePrice, riseBps } from '@/music/bonding'
import { color, space, text } from '@/theme/tokens'

const Box = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
`

const Name = styled.span`
  font-size: ${text.sm};
  color: ${color.ink};
`

const Chart = styled.svg`
  width: 100%;
  height: 88px;
  background: ${color.well};
  box-shadow: inset 1px 1px 0 ${color.shadow};
`

const Stops = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
`

const Note = styled.small`
  color: ${color.inkMuted};
  line-height: 1.4;
`

function pathOf(bps: number, copies: number): string {
  const last = Math.max(1, copies > 1 ? Math.min(copies - 1, CURVE_WINDOW - 1) : 23)
  const steps = 40
  const end = Math.pow(1 + bps / 10_000, last) || 1
  let d = ''
  for (let i = 0; i < steps; i++) {
    const at = Math.round((i * last) / (steps - 1))
    const y = 78 - (Math.pow(1 + bps / 10_000, at) / end) * 66
    const x = 6 + (i / (steps - 1)) * 268
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
}

export default function BondingCurvePick({
  rise,
  onRise,
  priceWei,
  supply,
  disabled,
  error,
}: {
  rise: string
  onRise: (rise: string) => void
  /** Starting price. Missing until the price box parses. */
  priceWei?: bigint
  /** Edition size. 0 or missing means it is not set, or it is open. */
  supply?: bigint
  disabled?: boolean
  error?: string
}) {
  const id = curveId(rise)
  const bps = riseBps(rise)
  const copies = supply && supply > 0n && supply <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(supply) : 0
  const shown = copies > 1 ? Math.min(copies, CURVE_WINDOW) : 24
  const marks = [0, Math.floor((shown - 1) / 2), shown - 1]
  const base = priceWei && priceWei > 0n ? priceWei : undefined
  return (
    <Box>
      <Name>Bonding curve</Name>
      <Segmented role="radiogroup" aria-label="Bonding curve">
        {CURVES.map((curve) => (
          <SmallButton
            key={curve.id}
            type="button"
            role="radio"
            aria-pressed={id === curve.id}
            disabled={disabled}
            onClick={() => onRise(curve.rise)}
          >
            {curve.label}
          </SmallButton>
        ))}
        <SmallButton type="button" role="radio" aria-pressed={id === 'custom'} disabled={disabled} onClick={() => onRise(rise.trim() && id === 'custom' ? rise : '3')}>
          Custom
        </SmallButton>
      </Segmented>
      <Field>
        Rise each copy (%)
        <input
          aria-label="Price rise"
          inputMode="decimal"
          placeholder="0 keeps one price"
          value={rise}
          disabled={disabled}
          onChange={(e) => onRise(e.target.value)}
        />
        {error ? <Err>{error}</Err> : <Note>{curveCaption(rise)}</Note>}
      </Field>
      {bps != null && bps > 0 && (
        <Chart viewBox="0 0 280 88" aria-hidden="true">
          <path d={pathOf(bps, copies)} fill="none" stroke="#fe9ca1" strokeWidth="2" />
        </Chart>
      )}
      {bps != null && bps > 0 && base && (
        <Stops>
          {marks.map((at, i) => (
            <span key={at}>
              {i > 0 ? ' · ' : ''}
              Copy {at + 1}: {ethLabel(curvePrice(base, bps, at))}
            </span>
          ))}
          {copies > CURVE_WINDOW ? ` · keeps rising through copy ${copies}` : ''}
        </Stops>
      )}
      {bps != null && bps > 0 && !base && <Note>Set a starting price to read this curve in ETH.</Note>}
      {bps != null && bps > 0 && !copies && <Note>Set how many copies exist. A rising curve needs a limit. Flat can stay open.</Note>}
    </Box>
  )
}

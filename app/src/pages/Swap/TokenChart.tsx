import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import { formatCompactUsd, formatUsd } from './board'
import type { Candle } from './chart'
import { candleAt, candlesUrl, parseCandles, priceRange, priceTicks, TIMEFRAMES } from './chart'
import { color, font, space, text } from './floor/tokens'

const UP = '#35d07f'
const DOWN = '#ff5a5a'
const GRID = 'rgba(255, 176, 0, 0.12)'
const LABEL = '#9aa3ad'
const AMBER = '#ffb000'
const AXIS = 76
const FOOT = 22
const VOLUME_SHARE = 0.16

const Box = styled.div`
  border: 1px solid ${color.dark};
  background: #05070a;
`

const Top = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[1]} ${space[2]};
  border-bottom: 1px solid ${color.dark};
  font-size: ${text.xs};
  font-variant-numeric: tabular-nums;
  .frames {
    display: flex;
    gap: 2px;
  }
  button {
    min-height: 26px;
    padding: 0 ${space[2]};
    border: 1px solid transparent;
    background: none;
    color: ${color.inkMuted};
    font-size: ${text.xs};
    cursor: pointer;
  }
  button:hover {
    color: ${color.ink};
  }
  button[aria-pressed='true'] {
    border-color: ${color.accent};
    color: ${color.accent};
  }
  .read {
    margin-left: auto;
    color: ${color.inkMuted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .read b {
    font-weight: 400;
    color: ${color.ink};
  }
`

const Area = styled.div`
  position: relative;
  height: 340px;
  .slim & {
    height: 260px;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    touch-action: pan-y;
    cursor: crosshair;
  }
  p {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    padding: ${space[3]};
    color: ${color.inkMuted};
    font-size: ${text.sm};
    text-align: center;
  }
`

function draw(canvas: HTMLCanvasElement, width: number, height: number, candles: Candle[], hover?: number) {
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.font = `11px ${font.mono}`
  ctx.textBaseline = 'middle'
  const plotW = width - AXIS
  const plotH = height - FOOT
  const volumeH = plotH * VOLUME_SHARE
  const priceH = plotH - volumeH
  const { low, high } = priceRange(candles)
  const y = (price: number) => priceH - ((price - low) / (high - low)) * priceH

  for (const tick of priceTicks(low, high)) {
    const at = Math.round(y(tick)) + 0.5
    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(0, at)
    ctx.lineTo(plotW, at)
    ctx.stroke()
    ctx.fillStyle = LABEL
    ctx.textAlign = 'left'
    ctx.fillText(formatUsd(tick), plotW + 6, at)
  }

  const step = plotW / candles.length
  const body = Math.max(1, Math.floor(step * 0.68))
  const topVolume = Math.max(...candles.map((c) => c.volume), 1)
  candles.forEach((c, i) => {
    const x = Math.floor(i * step + step / 2)
    const tint = c.close >= c.open ? UP : DOWN
    ctx.globalAlpha = 0.28
    ctx.fillStyle = tint
    const v = (c.volume / topVolume) * (volumeH - 4)
    ctx.fillRect(x - Math.floor(body / 2), plotH - v, body, v)
    ctx.globalAlpha = 1
    ctx.strokeStyle = tint
    ctx.beginPath()
    ctx.moveTo(x + 0.5, y(c.high))
    ctx.lineTo(x + 0.5, y(c.low))
    ctx.stroke()
    const top = y(Math.max(c.open, c.close))
    ctx.fillRect(x - Math.floor(body / 2), top, body, Math.max(1, y(Math.min(c.open, c.close)) - top))
  })

  // Dates along the foot, far enough apart to read.
  ctx.fillStyle = LABEL
  ctx.textAlign = 'center'
  const every = Math.max(1, Math.ceil(90 / step))
  const longSpan = candles.length > 1 && candles[candles.length - 1]!.at - candles[0]!.at > 2 * 86400
  for (let i = every; i < candles.length; i += every) {
    const when = new Date(candles[i]!.at * 1000)
    const words = longSpan
      ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    ctx.fillText(words, i * step + step / 2, height - FOOT / 2)
  }

  // The last price, in the set's amber.
  const last = candles[candles.length - 1]!
  const lastY = Math.round(y(last.close)) + 0.5
  ctx.strokeStyle = AMBER
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(0, lastY)
  ctx.lineTo(plotW, lastY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = AMBER
  ctx.fillRect(plotW, lastY - 9, AXIS, 18)
  ctx.fillStyle = '#000'
  ctx.textAlign = 'left'
  ctx.fillText(formatUsd(last.close), plotW + 6, lastY)

  if (hover !== undefined) {
    const x = Math.floor(hover * step + step / 2) + 0.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, plotH)
    ctx.stroke()
  }
}

const whenWords = (c: Candle) =>
  new Date(c.at * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** A token's price, drawn here in Trade's own colours from GeckoTerminal's candles. */
export default function TokenChart({
  chain,
  pool,
  token,
  symbol,
}: {
  chain?: string
  pool?: string
  token?: string
  symbol: string
}) {
  const [frame, setFrame] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[1])
  const [hover, setHover] = useState<number>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [areaRef, { width, height }] = useElementSize()
  const url = chain && pool && token ? candlesUrl(chain, pool, token, frame) : undefined
  const q = useQuery({
    queryKey: ['token-candles', url],
    enabled: !!url,
    staleTime: 60_000,
    refetchInterval: 120_000,
    // The free feed allows 10 calls a minute: give it room rather than hammering it.
    retry: 2,
    retryDelay: 15_000,
    queryFn: async ({ signal }) => {
      const res = await fetch(url as string, { signal, headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`Chart data ${res.status}`)
      return parseCandles(await res.json())
    },
  })
  const candles = q.data ?? []
  const count = candles.length

  useEffect(() => setHover(undefined), [url])
  useEffect(() => {
    if (canvas.current && width > 0 && height > 0 && count) draw(canvas.current, width, height, candles, hover)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, width, height, hover])

  const shown = hover !== undefined ? candles[hover] : candles[count - 1]
  return (
    <Box>
      <Top>
        <span className="frames" role="group" aria-label="Candle size">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === frame.id} onClick={() => setFrame(t)}>
              {t.id}
            </button>
          ))}
        </span>
        {shown && (
          <span className="read" data-chart-read>
            {whenWords(shown)} · O <b>{formatUsd(shown.open)}</b> H <b>{formatUsd(shown.high)}</b> L{' '}
            <b>{formatUsd(shown.low)}</b> C <b>{formatUsd(shown.close)}</b> · Vol{' '}
            <b>{formatCompactUsd(shown.volume)}</b>
          </span>
        )}
      </Top>
      <Area ref={areaRef}>
        {count > 0 ? (
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${symbol} price, ${frame.id} candles, last ${formatUsd(candles[count - 1]!.close)}`}
            data-token-chart
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              setHover(candleAt(e.clientX - box.left, box.width - AXIS, count))
            }}
            onPointerLeave={() => setHover(undefined)}
          />
        ) : (
          <p>
            {!url
              ? `No chart for ${symbol} on this network yet.`
              : q.isLoading || q.isFetching
                ? 'Getting the chart…'
                : q.isError
                  ? 'The chart is busy. It will try again in a moment.'
                  : `No trades to chart for ${symbol} yet.`}
          </p>
        )}
      </Area>
    </Box>
  )
}

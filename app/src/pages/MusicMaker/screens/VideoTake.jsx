import { useState } from 'react'
import { commitVideoSample, previewPcm } from '../audio/engine.js'
import { SAMPLE_RATES, formatClock, shapeSample } from '../audio/sampleShape.js'
import { model, touch } from '../model.js'
import { useModel } from '../useModel.js'

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

export function VideoTake({ take, busy, setBusy, onDone }) {
  useModel()
  const seconds = take.seconds || 0
  const asked = take.hint?.startSec
  const start = asked != null && asked < seconds - 0.05 ? asked : 0
  const [name, setName] = useState(take.name || 'video')
  const [inSec, setInSec] = useState(start)
  const [outSec, setOutSec] = useState(Math.min(seconds, start + 16))
  const [rate, setRate] = useState(0)
  const [count, setCount] = useState(seconds > 16 ? 4 : 2)
  const [pad, setPad] = useState(model.selected)
  const span = Math.max(0, outSec - inSec)
  const oneSeconds = Math.min(16, span)
  const need = Math.max(1, Math.ceil(span / 16 - 1e-6))
  const slices = Math.min(16, Math.max(1, Math.min(16, count | 0), need))
  const rateLabel = rate ? `${Math.round(rate / 1000)} kHz` : 'full rate'
  const past = asked != null && asked > seconds + 0.05

  function setIn(value) {
    const n = clamp(value, 0, seconds)
    setInSec(n)
    if (outSec < n) setOutSec(n)
  }
  function setOut(value) {
    const n = clamp(value, 0, seconds)
    setOutSec(n)
    if (inSec > n) setInSec(n)
  }

  async function run(job) {
    setBusy(true)
    try {
      await job()
    } catch (error) {
      model.browserNote = error?.message || 'Could not keep that sample'
      touch(false)
    } finally {
      setBusy(false)
    }
  }

  const opts = { name, inSec, outSec, rate, count, pad }

  return (
    <>
      <p className="hint">
        {past
          ? `The link asks for ${formatClock(asked)}. This read is ${formatClock(seconds)}, the start of the file.`
          : asked != null
            ? `The link starts at ${formatClock(asked)}. Read ${formatClock(seconds)}${take.capped ? '. The host stops at 8 MB.' : '.'}`
            : `Read ${formatClock(seconds)}${take.capped ? '. The host stops at 8 MB.' : '.'}`}
      </p>
      <label className="slider">
        <span>Name</span>
        <input className="field" aria-label="Sample name" value={name} onChange={(e) => setName(e.target.value)} />
        <em />
      </label>
      <label className="slider">
        <span>In</span>
        <input className="field num" aria-label="In point seconds" type="number" min={0} max={seconds} step={0.1} value={Number(inSec.toFixed(2))} onChange={(e) => setIn(e.target.value)} />
        <em>{formatClock(inSec)}</em>
      </label>
      <input aria-label="In point" type="range" min={0} max={seconds || 0} step={0.01} value={inSec} onChange={(e) => setIn(e.target.value)} />
      <label className="slider">
        <span>Out</span>
        <input className="field num" aria-label="Out point seconds" type="number" min={0} max={seconds} step={0.1} value={Number(outSec.toFixed(2))} onChange={(e) => setOut(e.target.value)} />
        <em>{formatClock(outSec)}</em>
      </label>
      <input aria-label="Out point" type="range" min={0} max={seconds || 0} step={0.01} value={outSec} onChange={(e) => setOut(e.target.value)} />
      <label className="slider">
        <span>Rate</span>
        <select className="row-select" aria-label="Downsample" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
          <option value={0}>Full</option>
          {SAMPLE_RATES.map((hz) => (
            <option key={hz} value={hz}>{Math.round(hz / 1000)} kHz</option>
          ))}
        </select>
        <em />
      </label>
      <label className="slider">
        <span>Slices</span>
        <input className="field num" aria-label="Slice count" type="number" min={2} max={16} step={1} value={count} onChange={(e) => setCount(clamp(e.target.value, 2, 16))} />
        <em />
      </label>
      <label className="slider">
        <span>Pad</span>
        <input className="field num" aria-label="Pad number" type="number" min={1} max={64} step={1} value={pad + 1} onChange={(e) => setPad(clamp(e.target.value, 1, 64) - 1)} />
        <em />
      </label>
      <p className="hint">
        {`One pad keeps ${formatClock(oneSeconds)} at ${rateLabel}. ${slices} slices cover ${formatClock(span)}.`}
        {slices > count ? ' The slice count went up so each one can fit.' : ''}
        {span / 16 > 16 ? ' The ends past 16 slices are left off.' : ''}
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={busy || span <= 0} onClick={() => run(() => { const shaped = shapeSample(take.pcm, take.sr, { inSec, outSec, rate }); return previewPcm(shaped.pcm, shaped.sr) })}>Hear</button>
        <button type="button" className="btn" disabled={busy || span <= 0} onClick={() => run(async () => { await commitVideoSample(take, { ...opts, where: 'cache' }); onDone() })}>Cache</button>
        <button type="button" className="btn" disabled={busy || span <= 0} onClick={() => run(async () => { await commitVideoSample(take, { ...opts, where: 'pad' }); onDone() })}>Pad</button>
        <button type="button" className="btn" disabled={busy || span <= 0} onClick={() => run(async () => { await commitVideoSample(take, { ...opts, where: 'slices' }); onDone() })}>Slices</button>
      </div>
    </>
  )
}

import { BANKS, busLabel, model, padKeyLabel } from '../model.js'
import { padGesture } from '../padEdit.js'
import { PadWave, usePadVis } from '../padVis.js'
import { useModel } from '../useModel.js'
import { FxPresets, NumpadGrid, Portamento } from './Fx.jsx'
import { Piano } from './Piano.jsx'

export function PlaySurface() {
  useModel()
  if (model.playSurface === 'off') return null
  if (model.playSurface === 'keys' || model.playSurface === 'chords' || model.playSurface === 'strum') return <Piano />
  if (model.playSurface === 'fx') return <PhoneFx />
  if (model.screen === 'pads') return null
  return <PhonePads />
}

function PhoneFx() {
  if (model.screen === 'fx') return null
  return (
    <div className="perf-surface for-fx">
      <FxPresets />
      <NumpadGrid />
      <Portamento />
    </div>
  )
}

function PhonePads() {
  usePadVis()
  const start = model.bank * 16
  return (
    <div className="perf-surface for-pads">
      <div className="pad-grid perf-pads">
        {Array.from({ length: 16 }, (_, local) => {
          const index = start + local
          const pad = model.pads[index]
          const cls = [
            'pad',
            pad.source === 'empty' ? 'empty' : 'seen',
            model.selected === index || model.selection.includes(index) ? 'selected' : '',
            pad.mute ? 'muted' : '',
            pad.solo ? 'soloed' : '',
          ].filter(Boolean).join(' ')
          return (
            <button key={index} type="button" className={cls} data-pad={index} {...padGesture(index, { play: true })}>
              <PadWave index={index} />
              <span className="key">{padKeyLabel(local)}</span>
              <span className="name">{pad.name}</span>
              <span className="meta">{BANKS[model.bank]}{local + 1} · {model.buses[pad.bus]?.name || busLabel(pad.bus)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}



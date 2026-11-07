import { model } from '../model.js'
import { Dialog } from '../widgets.jsx'

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
]

const PAD = new Set(['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'])
const SEQ = new Set(['y', 'u', 'i', 'o', 'h', 'j', 'k', 'l'])
const NOTE = new Set(['z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm', 'q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u', ',', 'l', '.', ';', 'i', '9', 'o', '0', 'p'])
const OFF = new Set(['a', 'caps'])

function mark(key, mode) {
  if (mode === 'pad') {
    if (PAD.has(key)) return 'pad'
    if (SEQ.has(key)) return 'seq'
    return ''
  }
  if (OFF.has(key)) return 'off'
  if (NOTE.has(key)) return 'note'
  return ''
}

function label(key) {
  if (key === 'caps') return 'Caps'
  if (key === ',') return ','
  if (key === '.') return '.'
  if (key === '/') return '/'
  if (key === ';') return ';'
  if (key === "'") return "'"
  return key.toUpperCase()
}

function Board({ mode }) {
  return (
    <div className="keys-board" aria-hidden="true">
      {ROWS.map((row, index) => (
        <div className="keys-row" key={index}>
          {index === 2 && <b className={mark('caps', mode) || undefined}>{label('caps')}</b>}
          {row.map((key) => {
            const kind = mark(key, mode)
            const Tag = kind ? 'b' : 'span'
            return <Tag key={key} className={kind || undefined}>{label(key)}</Tag>
          })}
        </div>
      ))}
    </div>
  )
}

export function KeysMap({ onClose }) {
  // Escape, focus in and focus back are the Dialog's own (widgets.jsx).

  const oct = model.renoiseOct
  return (
    <Dialog title="Pad and Keys" onClose={onClose}>
      <div className="keys-map">
        <h3>Pad</h3>
        <p>Plays the current bank. The top pad row is 1 2 3 4, then Q W E R, A S D F, and Z X C V.</p>
        <Board mode="pad" />
        <p>Peach keys are pads. Yellow keys are sequence slots, and only on the Pads page: Y U I O and H J K L. [ and ] change the bank.</p>
        <h3>Keys</h3>
        <p>Plays the selected pad as notes. Z is C of octave {oct}. Q and comma are the next C. I is the C above that. A and Caps Lock stop the note.</p>
        <Board mode="keys" />
        <p>Green keys are notes. Pink keys are note off. Numpad / and *, or Ctrl+[ and Ctrl+], shift the octave.</p>
        <h3>Controllers</h3>
        <p>Click MIDI and allow the browser. A Launchpad plays all 64 instruments in Pad mode. In Keys mode that same grid is chromatic, with C3 on the bottom-left pad. MPC and MPD pads start at note 36 and cover all 64. An MPK plays instruments from its pads, and its keys play the selected pad. Keys mode turns every incoming note into the selected pad. The typing keyboard keeps working when a browser has no MIDI.</p>
      </div>
    </Dialog>
  )
}

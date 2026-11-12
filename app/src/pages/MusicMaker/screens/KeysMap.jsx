import { noteName, renoiseNote } from '../keys.js'
import { model } from '../model.js'
import { Dialog } from '../widgets.jsx'

const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
]

const PAD_GRID = [
  ['1', '2', '3', '4'],
  ['q', 'w', 'e', 'r'],
  ['a', 's', 'd', 'f'],
  ['z', 'x', 'c', 'v'],
]

const SEQ_GRID = [
  ['y', 'u', 'i', 'o'],
  ['h', 'j', 'k', 'l'],
]

const PAD = new Set(PAD_GRID.flat())
const SEQ = new Set(SEQ_GRID.flat())
const OFF = new Set(['a', 'caps'])

function label(key) {
  if (key === 'caps') return 'Caps'
  if (key === ',') return ','
  if (key === '.') return '.'
  if (key === '/') return '/'
  if (key === ';') return ';'
  if (key === "'") return "'"
  return key.toUpperCase()
}

function role(key, mode) {
  if (mode === 'pad') {
    if (PAD.has(key)) return 'pad'
    if (SEQ.has(key)) return 'seq'
    return ''
  }
  if (OFF.has(key)) return 'off'
  if (renoiseNote(key, 3) != null) return 'note'
  return ''
}

function GridKeys({ rows, tone, start }) {
  let n = start
  return (
    <div className={`key-grid ${tone}`} role="img" aria-label={tone === 'is-pad' ? 'Pad keys' : 'Sequence keys'}>
      {rows.flat().map((key) => {
        const num = n
        n += 1
        return (
          <span className="key-cell" key={key}>
            <em>{num}</em>
            {label(key)}
          </span>
        )
      })}
    </div>
  )
}

function Board({ mode, octave }) {
  return (
    <div className={`keys-board is-${mode}`} aria-hidden="true">
      {KEY_ROWS.map((row, index) => (
        <div className={`keys-row r${index + 1}`} key={index}>
          {row.map((key) => {
            const kind = role(key, mode)
            const midi = mode === 'keys' ? renoiseNote(key, octave) : null
            const note = midi == null ? '' : noteName(midi - 60)
            return (
              <span key={key} className={`keys-key is-${kind || 'idle'}`}>
                <b>{label(key)}</b>
                {mode === 'keys' && kind === 'off' && <small>off</small>}
                {note && <small>{note}</small>}
              </span>
            )
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
        <p>Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.</p>
        <p>Pad is the drums. Keys is a melody on the selected pad. The pictures below are those keys.</p>
        <h3>Pad</h3>
        <p>This bank is a 4 by 4 grid. Read it left to right, top to bottom. The corner number is the pad.</p>
        <div className="keys-grids">
          <figure>
            <figcaption>Pads 1–16</figcaption>
            <GridKeys rows={PAD_GRID} tone="is-pad" start={1} />
          </figure>
          <figure>
            <figcaption>Slots 1–8</figcaption>
            <GridKeys rows={SEQ_GRID} tone="is-seq" start={1} />
          </figure>
        </div>
        <p>The same keys on the keyboard:</p>
        <Board mode="pad" octave={oct} />
        <ul className="keys-legend">
          <li><i className="is-pad" /> Pad</li>
          <li><i className="is-seq" /> Sequence slot</li>
        </ul>
        <p>[ and ] change the bank.</p>

        <h3>Keys · octave {oct}</h3>
        <p>The note is printed on the key. Z is C of this octave. Q and comma are the next C. I is the C above that.</p>
        <Board mode="keys" octave={oct} />
        <ul className="keys-legend">
          <li><i className="is-note" /> Note</li>
          <li><i className="is-off" /> Note off, A and Caps Lock</li>
        </ul>
        <p>Numpad / and *, or Ctrl+[ and Ctrl+], shift the octave.</p>

        <h3>Controllers</h3>
        <p>Click MIDI and allow the browser. A Launchpad plays all 64 instruments in Pad mode. In Keys mode that same grid is chromatic, with C3 on the bottom-left pad. MPC and MPD pads start at note 36 and cover all 64. An MPK plays instruments from its pads, and its keys play the selected pad. Keys mode turns every incoming note into the selected pad. The typing keyboard keeps working when a browser has no MIDI.</p>
      </div>
    </Dialog>
  )
}

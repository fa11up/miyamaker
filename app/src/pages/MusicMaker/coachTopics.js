/** Beginner steps for the seven ? buttons. A chip is a picture of a real control. */

export const COACH = {
  pads: {
    title: 'Pads',
    steps: [
      { text: 'Tap a pad. It plays. The picture of the wave stays on a pad that has a sound.', chip: { label: 'Kick', kind: 'pad' }, target: 'pad' },
      { text: 'On the keyboard, 1 2 3 4 / Q W E R / A S D F / Z X C V play these sixteen pads.', chip: { label: 'Q', kind: 'btn' } },
      { text: 'Drag a sample from the browser onto a pad.', target: 'pad' },
      { text: 'One-shot plays once, even if you hold the pad. Loop repeats until you let go.', chip: { label: 'Loop', kind: 'btn' } },
    ],
  },
  sample: {
    title: 'Sample',
    screen: 'edit',
    steps: [
      { text: 'This page is the sound on the pad you picked.', chip: { label: 'Sample', kind: 'btn' }, target: 'page-edit', screen: 'edit' },
      { text: 'Drag the wave to set the start and the end. Drag inside a short span to slide it.', target: 'wave', screen: 'edit' },
      { text: 'Pinch, or ctrl-scroll, to zoom. Double-click the wave to fit it.', target: 'wave', screen: 'edit' },
      { text: 'One-shot plays once. Loop repeats from LP until you let go.', chip: { label: 'Loop', kind: 'btn' } },
    ],
  },
  sequence: {
    title: 'Sequence',
    screen: 'seq',
    steps: [
      { text: 'Draw paints a hit on a pad row. The note on the hit is the same note the tracker shows.', chip: { label: 'Draw', kind: 'btn' }, target: 'draw', screen: 'seq' },
      { text: 'Erase clears a hit.', chip: { label: 'Erase', kind: 'btn' }, target: 'erase', screen: 'seq' },
      { text: 'Note, Vel, and Bus FX choose what a drag changes. Bus FX is shared by the whole pad row.', chip: { label: 'Vel', kind: 'btn' }, target: 'vel', screen: 'seq' },
      { text: 'Select a hit. The lower left handle moves it in time. The lower right handle changes how many steps it lasts. The handle on the right moves it to another pad.', chip: { label: 'Select', kind: 'btn' }, target: 'select', screen: 'seq' },
      { text: 'Zoom widens the steps so the handles are easier to hold. Drag a pad name, or the bar numbers, to scroll.', chip: { label: 'Zoom', kind: 'btn' }, target: 'zoom', screen: 'seq' },
    ],
  },
  mixer: {
    title: 'Mixer',
    screen: 'mix',
    steps: [
      { text: 'Sixteen buses. This button shows buses 1–8. The next one shows 9–16.', chip: { label: '1–8', kind: 'btn' }, target: 'mix-page', screen: 'mix' },
      { text: 'Tap a channel. Its five effect slots open under the strips. Tap another channel and those slots change. Empty slots stay off.', target: 'mix-fx', screen: 'mix' },
      { text: 'The EQ follows the channel you tap. The menu in its header can also choose Output. Drag a point to tune it. Right-click a point, or hold SHIFT and tap it, to choose low cut, bell, or high cut, and to make that band duck when it gets loud.', target: 'mix-eq', screen: 'mix' },
      { text: 'The limiter after the master compressor keeps the output from passing 0 dBFS.', chip: { label: 'Limit', kind: 'btn' } },
    ],
  },
  tracker: {
    title: 'Tracker',
    screen: 'track',
    steps: [
      { text: 'Rec on: the marked cell is where edits land, and the pattern can change. Rec off: the pattern does not change, stopped or playing.', chip: { label: 'Rec', kind: 'rec' }, target: 'rec', screen: 'track' },
      { text: 'Space plays and stops.', chip: { label: 'Play', kind: 'btn' }, target: 'play' },
      { text: 'Drag empty grid space. The cursor walks the way your finger points.', target: 'tracker', screen: 'track' },
      { text: 'Hold SHIFT at the lower left and drag with the other thumb to edit the cell.', chip: { label: 'SHIFT', kind: 'btn' }, target: 'shift', screen: 'track' },
      { text: 'Shift+Alt and the arrows mark a block from the cursor. Copy and paste that block. Delete and Shift+arrows change only the columns inside it.', chip: { label: 'NOTE', kind: 'btn' }, target: 'tracker', screen: 'track' },
    ],
  },
  synth: {
    title: 'Synth',
    screen: 'synth',
    steps: [
      { text: 'This page draws a sound for the pad you picked.', chip: { label: 'Synth', kind: 'btn' }, target: 'page-synth', screen: 'synth' },
      { text: 'A preset replaces the whole patch.', chip: { label: 'Preset', kind: 'btn' } },
      { text: 'The knobs are the oscillators, the filter, and the envelope. Drag a knob up or down.', chip: { label: 'Cut', kind: 'knob' } },
    ],
  },
  fx: {
    title: 'FX',
    screen: 'fx',
    steps: [
      { text: 'Hold a numpad key. A short tap selects it. Keys you hold together run in the order you pressed them.', chip: { label: '1', kind: 'num' }, target: 'numpad', screen: 'fx' },
      { text: 'Repeat and Slice follow the project tempo.', chip: { label: 'Repeat', kind: 'btn' } },
      { text: 'Save keeps this setup in the song.', chip: { label: 'SAVE', kind: 'btn' }, target: 'save' },
    ],
  },
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PAD_KEYS, SCREENS, SEQ_KEYS, SHORTCUTS, pianoNote, renoiseNote, typing } from './keys.js'
import {
  addBar,
  commitTrackerNote,
  cyclePlaySurface,
  setPlaySurface,
  cycleScreen,
  deleteSelection,
  doubleUp,
  model,
  save,
  removeBar,
  selectPad,
  setBank,
  setPattern,
  setScreen,
  setSeqBank,
  setSeqSlot,
  touch,
  trackerFields,
  TRACK_VEL,
} from './model.js'
import { enableMidi, getMidiState, holdNumpadFx, importFile, noteOff, noteOn, pushNumpadFx, recordTrackerOff, releaseKeyboardNotes, releaseNumpadFx, syncMasterComp, syncMixer, toggleMetro, togglePlay, toggleRecord } from './audio/engine.js'
import { midiSummary } from './audio/midi.js'
import { undo } from './history.js'
import { songId } from './jobs.js'
import { useModel } from './useModel.js'
import { Dialog, HelpButton } from './widgets.jsx'
import { Pads } from './screens/Pads.jsx'
import { Editor } from './screens/Editor.jsx'
import { Sequencer, copySeqSelection, deleteSeqSelection, pasteSeqSelection } from './screens/Sequencer.jsx'
import { Mixer } from './screens/Mixer.jsx'
import { Tracker, finger, handleTrackerKey } from './screens/Tracker.jsx'
import { PitchWheel } from './screens/ChordPanel.jsx'
import { ShiftHold } from './screens/ShiftHold.jsx'
import { Synth } from './screens/Synth.jsx'
import { Fx } from './screens/Fx.jsx'
import { SampleBrowser } from './screens/Browser.jsx'
import { FileMenu } from './screens/FileMenu.jsx'
import { KeysMap } from './screens/KeysMap.jsx'
import { askPublish, buildPublish, listenForFiles } from './publish.js'
import { NewMenu, ReleaseRows, SaveMenu } from './screens/SongMenus.jsx'
import { CoachLayer } from './screens/Coach.jsx'
import { Manual } from './screens/Manual.jsx'
import { PadMenu } from './screens/PadMenu.jsx'
import { Arranger } from './screens/Arranger.jsx'
import { PlaySurface } from './screens/PlaySurface.jsx'
import { startPorta, stopPorta, portaArmed } from './screens/porta.js'
import { padStep } from './padNav.js'

export function MiyaMusicMaker() {
  useModel()
  useEffect(() => listenForFiles(buildPublish), [])
  useLayoutEffect(() => {
    const node = document.querySelector('[data-miya-music]')?.shadowRoot?.querySelector('.mmm')
    if (!node) return undefined
    const apply = () => {
      // The phone rules are container queries on .mmm, and those see the content box.
      // clientWidth includes this frame's padding, so a window just past 600px was
      // still the phone layout and also grew the right-hand numpad column.
      const wide = contentWidth(node) > 600
      // 940 covers every iPhone, portrait or landscape. A wide tablet keeps two octaves.
      const hand = node.clientWidth <= 940
      let changed = false
      if (!!model.fxWide !== wide) {
        const wasWide = !!model.fxWide
        model.fxWide = wide
        changed = true
        if (!wide && wasWide && model.fxOpen) model.screen = 'fx'
      }
      if (!!model.chordHand !== hand) {
        model.chordHand = hand
        changed = true
      }
      if (wide && model.screen === 'fx') {
        model.fxOpen = true
        model.screen = 'pads'
        changed = true
      }
      if (!wide && model.dockOpen !== false && model.arrangeOpen) {
        model.arrangeOpen = false
        changed = true
      }
      if (changed) touch(false)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return undefined
    const watch = new ResizeObserver(apply)
    watch.observe(node)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    const down = () => {
      enableMidi().catch(() => {})
    }
    window.addEventListener('pointerdown', down, { once: true })
    return () => window.removeEventListener('pointerdown', down)
  }, [])
  useEffect(() => {
    const down = (e) => onKey(e)
    const up = (e) => {
      const low = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (e.code === 'NumpadSubtract') stopPorta(-1)
      if (e.code === 'NumpadAdd') stopPorta(1)
      if (e.key === 'Shift') finger.kbShift = false
      if (e.key === 'Shift') releaseNumpadFx()
      const digit = numpadDigit(e)
      if (digit != null) releaseNumpadFx(digit)
      if (e.key === 'Shift' || low === 'n' || low === 'b') model.hold = null
      noteOff(`key:${e.code}`)
    }
    // A key held while focus leaves never sends its keyup here, so its note would loop forever.
    const blur = () => {
      model.hold = null
      finger.kbShift = false
      stopPorta()
      releaseNumpadFx()
      releaseKeyboardNotes()
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') blur()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    const pads = new Map()
    let raf = 0
    const poll = () => {
      const list = navigator.getGamepads?.() || []
      const now = performance.now()
      const seen = new Set()
      for (const gp of list) {
        if (!gp) continue
        seen.add(gp.index)
        const step = padStep(pads.get(gp.index), gp, now)
        pads.set(gp.index, step.state)
        if (!step.fire || !step.key) continue
        onKey({
          key: step.key,
          ctrlKey: step.ctrl,
          shiftKey: step.ctrl,
          altKey: false,
          metaKey: false,
          repeat: false,
          code: '',
          preventDefault() {},
          stopPropagation() {},
          target: null,
          composedPath() { return [] },
        })
      }
      for (const index of pads.keys()) if (!seen.has(index)) pads.delete(index)
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
    const frame = document.querySelector('[data-miya-music]')?.closest('.react-draggable')
    let watch = null
    if (frame && typeof MutationObserver !== 'undefined') {
      watch = new MutationObserver(() => {
        if (!frame.classList.contains('is-focused')) blur()
      })
      watch.observe(frame, { attributes: true, attributeFilter: ['class'] })
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', hidden)
      watch?.disconnect()
    }
  }, [])

  const bothDocks = model.dockOpen !== false && !!model.arrangeOpen
  return (
    <div
      className={`mmm surface-${model.playSurface || 'pads'} screen-${model.screen} ${model.chordHand ? 'chord-hand' : ''} ${model.k3 ? 'theme-k3' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || f.type.startsWith('video') || /\.(wav|mp3|ogg|flac|aiff|aif|m4a|mp4|webm|mov|m1ya|mod|xm|k1t)$/i.test(f.name))
        dropFiles(files)
      }}
    >
      <div className="mmm-bar">
        <div className="bar-files">
          <FileMenu />
          <NewMenu />
          <SaveMenu />
        </div>
        <BarMenu />
        <Transport />
      </div>
      <div
        className={`mmm-body${model.dockOpen === false && !model.arrangeOpen ? ' dock-shut' : ''}`}
        style={{ '--fx-size': `${Math.max(168, model.fxWidth || 280)}px` }}
      >
        <div className="dock-rail">
          <RailHelp />
          <RailMenu />
          <DockToggles names />
          <div className="rail-slot" />
          {model.playSurface === 'keys' && <PitchWheel className="rail-wheel" />}
          <ShiftHold mark />
        </div>
        <div className="mmm-rest">
        {(model.dockOpen !== false || model.arrangeOpen) && (
          <>
            <div className="dock-pane">
              {model.dockOpen !== false && (
                <div className="dock-slot" style={bothDocks ? { flexGrow: dockSplit() } : undefined}>
                  <SampleBrowser />
                </div>
              )}
              {bothDocks && (
                <div
                  className="dock-rule"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Split between the browser and the arranger"
                  aria-valuemin={15}
                  aria-valuemax={85}
                  aria-valuenow={Math.round(dockSplit() * 100)}
                  tabIndex={0}
                  onPointerDown={splitPair}
                  onKeyDown={nudgePair}
                />
              )}
              {model.arrangeOpen && (
                <div className="dock-slot" style={bothDocks ? { flexGrow: 1 - dockSplit() } : undefined}>
                  <Arranger />
                </div>
              )}
            </div>
            {/* A set width: a pane's width is not dragged. Shut and open it with the dock buttons. */}
            <div className="dock-splitter" aria-hidden="true" />
          </>
        )}
        <div className="mmm-stage">
        <div className="mmm-main">
          {model.screen === 'pads' && <Pads />}
          {model.screen === 'edit' && <Editor />}
          {model.screen === 'seq' && <Sequencer />}
          {model.screen === 'mix' && <Mixer />}
          {model.screen === 'track' && <Tracker />}
          {model.screen === 'synth' && <Synth />}
          {model.screen === 'fx' && !model.fxWide && <Fx />}
          <PlaySurface />
          <PadMenu />
          {model.keysHelp && (
            <KeysMap onClose={() => { model.keysHelp = false; touch(false) }} />
          )}
          {model.help && (
            <Dialog title="QWERTY shortcuts" onClose={() => { model.help = false; touch(false) }}>
              <div className="topic-blurbs">
                <p>Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.</p>
                <p><b>Pads.</b> Drums. Sixteen in this bank, and banks A through D beyond it.</p>
                <p><b>Keys.</b> The selected pad, one note at a time.</p>
                <p><b>Chords.</b> The buttons choose the harmony. The piano plays that chord. The strip plays one note.</p>
                <p><b>Sequence and Tracker.</b> The same pattern. Sequence paints hits. The tracker is the spreadsheet, and the row in the middle is the one you are on.</p>
                <p><b>Arranger.</b> Patterns played in order as a song.</p>
                <p><b>Sample, Synth, Mixer, FX.</b> Trim the wave, draw a sound, balance the buses, and hold an effect while it plays.</p>
                <p>The table is the shortcuts.</p>
              </div>
              <table>
                <tbody>
                  {SHORTCUTS.map(([key, action]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Dialog>
          )}
        </div>
        {model.fxWide && model.fxOpen && (
          <>
            <div className="fx-splitter" onPointerDown={fxDrag} />
            <div className="fx-pane">
              <Fx dock />
            </div>
          </>
        )}
        {model.fxWide && (
          <div className="fx-rail">
            <button
              type="button"
              className={`btn ${model.fxOpen ? 'on' : ''}`}
              aria-label={model.fxOpen ? 'Hide numpad' : 'Show numpad'}
              onClick={toggleFx}
            >
              Numpad
            </button>
          </div>
        )}
        </div>
        </div>
      </div>
      {model.fileWindow === 'manual' && <Manual />}
      <CoachLayer />
    </div>
  )
}

function Transport() {
  const midi = midiSummary(getMidiState())
  const midiLive = getMidiState().inputs.length > 0
  return (
    <>
        <div className="transport-group">
          <button type="button" className={`btn free-width ${model.playing ? 'on' : ''}`} data-coach="play" onClick={() => togglePlay()}>
            {model.playing ? 'Stop' : 'Play'}
          </button>
          <button
            type="button"
            data-coach="rec"
            className={`btn free-width rec ${(model.tracker.edit || model.recording) ? 'on' : ''}`}
            onClick={() => toggleRecord()}
          >
            Rec
          </button>
          <button
            type="button"
            className={`btn free-width quantize ${model.recNatural ? 'on' : ''}`}
            aria-pressed={!!model.recNatural}
            aria-label={model.recNatural ? 'Quantize on' : 'Quantize off'}
            title="Quantize on measures MOVE, how far the note sits from the step. Quantize off does not record movement."
            onClick={() => {
              model.recNatural = !model.recNatural
              touch(true)
            }}
          >
            {model.recNatural ? 'Q On' : 'Q Off'}
          </button>
          <button type="button" className={`btn free-width bar-wide ${model.metro ? 'on' : ''}`} onClick={() => toggleMetro()}>
            Metro
          </button>
          <button
            type="button"
            className="btn free-width bar-wide"
            onClick={() => {
              undo().then((did) => {
                if (!did) return
                syncMasterComp()
                syncMixer(true)
                pushNumpadFx()
              })
            }}
          >
            Undo
          </button>
          <label className="slider bpm">
            <span>BPM</span>
            <input
              className="field num"
              type="number"
              min={40}
              max={240}
              value={model.bpm}
              onChange={(e) => {
                model.bpm = Math.max(40, Math.min(240, Number(e.target.value) || 96))
                touch(true)
              }}
            />
            <em />
          </label>
          <span className="song-name bar-wide" title={model.songName || 'No song'}>{model.songName || 'No song'}</span>
          {model.saveError && (
            <span className="save-error" role="status" title={model.saveError}>
              Not saved
            </span>
          )}
        </div>
        <div className="bank-row">
          {['A', 'B', 'C', 'D'].map((name, i) => (
            <button key={name} type="button" className={`btn free-width ${model.bank === i ? 'on' : ''}`} onClick={() => setBank(i)}>
              {name}
            </button>
          ))}
        </div>
        <SurfaceMenu />
        <BankMenu />
        <button
          type="button"
          className={`btn free-width midi-btn bar-wide ${midiLive ? 'on' : ''}`}
          title={midi.title}
          onClick={() => enableMidi().catch(() => {})}
        >
          {midi.short}
        </button>
        <div className="screen-tabs">
          {SCREENS.map((screen) => {
            const docked = screen.id === 'fx' && model.fxWide
            const on = docked ? !!model.fxOpen : model.screen === screen.id
            return (
            <button
              key={screen.id}
              type="button"
              className={`btn free-width ${on ? 'on' : ''}`}
              data-coach={`page-${screen.id}`}
              onClick={() => {
                if (docked) toggleFx()
                else setScreen(screen.id)
              }}
            >
              {screen.label}
            </button>
            )
          })}
        </div>
        <ScreenMenu />
        <div className="dock-pair">
          <DockToggles />
        </div>
    </>
  )
}

function contentWidth(node) {
  const style = getComputedStyle(node)
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  return node.clientWidth - pad
}

function narrowWindow() {
  const node = document.querySelector('[data-miya-music]')?.shadowRoot?.querySelector('.mmm')
  return !!node && contentWidth(node) <= 600
}

function toggleBrowser() {
  const open = model.dockOpen !== false
  if (open) model.dockOpen = false
  else {
    model.dockOpen = true
    if (narrowWindow()) model.arrangeOpen = false
  }
  touch(true)
}

function toggleFx() {
  if (model.fxOpen) model.fxOpen = false
  else {
    model.fxOpen = true
    if ((model.fxWidth || 0) < 168) model.fxWidth = 280
  }
  touch(true)
}

function toggleArranger() {
  if (model.arrangeOpen) model.arrangeOpen = false
  else {
    model.arrangeOpen = true
    if (narrowWindow()) model.dockOpen = false
  }
  touch(true)
}

const PAGE_HELP = {
  pads: ['Pads', 'pads'],
  edit: ['Sample', 'sample'],
  seq: ['Sequence', 'sequence'],
  mix: ['Mixer', 'mixer'],
  track: ['Tracker', 'tracker'],
  synth: ['Synth', 'synth'],
  fx: ['FX', 'fx'],
}

function RailHelp() {
  const pair = PAGE_HELP[model.screen] || PAGE_HELP.pads
  return <HelpButton title={pair[0]} topic={pair[1]} />
}

function RailMenu() {
  const root = useRef(null)
  const [open, setOpen] = useState(false)
  useMenuCloser(open, root, setOpen)
  const go = (run) => {
    setOpen(false)
    run()
  }
  return (
    <div className="mmm-file rail-file" ref={root}>
      <button
        type="button"
        className={`btn rail-more ${open ? 'on' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More tabs"
        onClick={() => setOpen((value) => !value)}
      >
        Tabs
      </button>
      {open && (
        <div className="file-menu rail-pop" role="menu">
          <button type="button" onClick={() => go(toggleBrowser)}>Browser</button>
          <button type="button" onClick={() => go(toggleArranger)}>Arranger</button>
          <button type="button" onClick={() => go(() => { model.fileWindow = 'manual'; touch(false) })}>Manual</button>
          <button type="button" onClick={() => go(() => { enableMidi().catch(() => {}) })}>MIDI</button>
        </div>
      )}
    </div>
  )
}

function DockToggles({ names = false }) {
  return (
    <>
      <button
        type="button"
        className={`btn ${model.dockOpen !== false ? 'on' : ''}`}
        aria-label={model.dockOpen === false ? 'Show sample browser' : 'Hide sample browser'}
        onClick={toggleBrowser}
      >
        {names ? 'Browser' : (model.dockOpen === false ? '>' : '<')}
      </button>
      <button
        type="button"
        className={`btn ${model.arrangeOpen ? 'on' : ''}`}
        aria-label={model.arrangeOpen ? 'Hide arranger' : 'Show arranger'}
        onClick={toggleArranger}
      >
        {names ? 'Arranger' : '≡'}
      </button>
    </>
  )
}

const SURFACE_CHOICES = [
  ['off', 'Off'],
  ['pads', 'Pads'],
  ['keys', 'Keys'],
  ['chords', 'Chords'],
  ['strum', 'Strum'],
  ['fx', 'FX'],
]

function surfaceLabel() {
  const row = SURFACE_CHOICES.find(([id]) => id === model.playSurface)
  return row ? row[1] : 'Keys'
}

function surfaceOn() {
  return model.playSurface && model.playSurface !== 'off'
}

function SurfaceMenu() {
  const root = useRef(null)
  const [open, setOpen] = useState(false)
  const hold = useRef(0)
  const swallow = useRef(false)
  useMenuCloser(open, root, setOpen)
  useEffect(() => () => window.clearTimeout(hold.current), [])
  const pick = (id) => {
    if (id === 'fx' && model.fxWide) {
      model.fxOpen = true
      if ((model.fxWidth || 0) < 168) model.fxWidth = 280
    }
    setPlaySurface(id)
    setOpen(false)
  }
  const openMenu = () => {
    swallow.current = true
    setOpen(true)
  }
  const shifted = (event) => event.shiftKey || finger.shift || finger.kbShift
  return (
    <div className="mmm-file surface-menu" ref={root}>
      <button
        type="button"
        className={`btn free-width surface-btn ${surfaceOn() ? 'on' : ''}`}
        aria-label="On-screen keys"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Tap to cycle. Hold, right-click, or Shift-click for the list."
        onPointerDown={(event) => {
          if (event.button === 2) {
            event.preventDefault()
            openMenu()
            return
          }
          if (event.button !== 0) return
          if (shifted(event)) {
            event.preventDefault()
            openMenu()
            return
          }
          swallow.current = false
          window.clearTimeout(hold.current)
          hold.current = window.setTimeout(openMenu, 420)
        }}
        onPointerUp={() => window.clearTimeout(hold.current)}
        onPointerCancel={() => window.clearTimeout(hold.current)}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenu()
        }}
        onClick={(event) => {
          window.clearTimeout(hold.current)
          if (swallow.current || shifted(event)) {
            swallow.current = false
            setOpen(true)
            return
          }
          setOpen(false)
          cyclePlaySurface()
        }}
      >
        {surfaceLabel()}
      </button>
      {open && (
        <div className="file-menu" role="menu">
          {SURFACE_CHOICES.filter(([id]) => id !== 'fx' || !model.fxWide).map(([id, name]) => (
            <button key={id} type="button" className={model.playSurface === id ? 'on' : ''} onClick={() => pick(id)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useMenuCloser(open, root, setOpen) {
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      const node = root.current
      if (!node) return
      if (node.contains(event.target)) return
      if (event.composedPath?.().includes(node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [open, root, setOpen])
}

function BarMenu() {
  const root = useRef(null)
  const [open, setOpen] = useState(false)
  useMenuCloser(open, root, setOpen)
  function go(id) {
    setOpen(false)
    if (id === 'save-over') {
      window.dispatchEvent(new Event('mmm-save'))
      return
    }
    model.fileWindow = id
    touch(false)
  }
  return (
    <div className="mmm-file bar-menu" ref={root}>
      <button type="button" className={`btn free-width ${open ? 'on' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        Menu
      </button>
      {open && (
        <div className="file-menu" role="menu">
          <button type="button" onClick={() => go('manual')}>Manual</button>
          <hr />
          <button type="button" onClick={() => go('open')}>Open file…</button>
          <button type="button" onClick={() => go('folder')}>Open folder…</button>
          <button type="button" onClick={() => go('link')}>Load song link…</button>
          <button type="button" onClick={() => go('wallet')}>Wallet…</button>
          <button type="button" onClick={() => go('video')}>Video link…</button>
          <button type="button" onClick={() => go('image')}>Image…</button>
          <hr />
          <button type="button" onClick={() => go('new-blank')}>New blank</button>
          <button type="button" onClick={() => go('new-template')}>New from template</button>
          <button type="button" onClick={() => go('new-duplicate')}>New duplicate</button>
          <button type="button" onClick={() => go('new-folder')}>Folder</button>
          <button type="button" onClick={() => go('new-kit')}>Kit</button>
          <button type="button" onClick={() => go('new-slice')}>Slice</button>
          <hr />
          <button type="button" onClick={() => go('save-over')}>Save</button>
          <button type="button" onClick={() => go('save-as')}>Save as…</button>
          <button type="button" onClick={() => go('save-template')}>Save as template</button>
          <button type="button" onClick={() => go('song')}>Save song…</button>
          <button type="button" onClick={() => go('kit')}>Save kit…</button>
          <hr />
          <ReleaseRows
            busy={false}
            onPublish={(intent) => {
              setOpen(false)
              if (!askPublish(intent)) {
                model.browserNote = 'Arweave and mint run inside miyamaker.com'
                touch(false)
              }
            }}
          />
          <hr className="menu-phone" />
          <button type="button" className="menu-phone" onClick={() => { setOpen(false); undo().then((did) => { if (!did) return; syncMasterComp(); syncMixer(true); pushNumpadFx() }) }}>Undo</button>
          <button type="button" className="menu-phone" onClick={() => { setOpen(false); toggleMetro() }}>Metro</button>
          <button type="button" className="menu-phone" onClick={() => { setOpen(false); enableMidi().catch(() => {}) }}>MIDI</button>
        </div>
      )}
    </div>
  )
}

function BankMenu() {
  const root = useRef(null)
  const [open, setOpen] = useState(false)
  useMenuCloser(open, root, setOpen)
  return (
    <div className="mmm-file bank-one" ref={root}>
      <button type="button" className="btn free-width on" aria-expanded={open} aria-label="Sample bank" onClick={() => setOpen((v) => !v)}>
        {['A', 'B', 'C', 'D'][model.bank] || 'A'}
      </button>
      {open && (
        <div className="file-menu" role="menu">
          {['A', 'B', 'C', 'D'].map((name, i) => (
            <button key={name} type="button" onClick={() => { setOpen(false); setBank(i) }}>{name}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ScreenMenu() {
  const root = useRef(null)
  const [open, setOpen] = useState(false)
  useMenuCloser(open, root, setOpen)
  const current = SCREENS.find((screen) => screen.id === model.screen) || SCREENS[0]
  const barLabel = { seq: 'Seq', track: 'Track' }[current.id] || current.label
  return (
    <div className="mmm-file screen-one" ref={root}>
      <button type="button" className="btn free-width on" aria-expanded={open} aria-label="Screen" title={current.label} onClick={() => setOpen((v) => !v)}>
        {barLabel}
      </button>
      {open && (
        <div className="file-menu" role="menu">
          {SCREENS.map((screen) => (
            <button key={screen.id} type="button" onClick={() => {
              setOpen(false)
              if (screen.id === 'fx' && model.fxWide) toggleFx()
              else setScreen(screen.id)
            }}>{screen.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function dockSplit() {
  const n = Number(model.dockSplit)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0.15, Math.min(0.85, n))
}

function splitPair(event) {
  if (event.button != null && event.button !== 0) return
  event.preventDefault()
  const rule = event.currentTarget
  const pane = rule.parentElement
  if (!pane) return
  const startY = event.clientY
  const origin = dockSplit()
  const room = Math.max(1, pane.clientHeight - (rule.offsetHeight || 6))
  const id = event.pointerId
  const move = (ev) => {
    if (ev.pointerId !== id) return
    const min = Math.min(0.4, 64 / room)
    const next = origin + (ev.clientY - startY) / room
    model.dockSplit = Math.max(min, Math.min(1 - min, next))
    touch(false)
  }
  const end = (ev) => {
    if (ev && ev.pointerId !== id) return
    rule.removeEventListener('pointermove', move)
    rule.removeEventListener('pointerup', end)
    rule.removeEventListener('pointercancel', end)
    save()
  }
  rule.setPointerCapture?.(id)
  rule.addEventListener('pointermove', move)
  rule.addEventListener('pointerup', end)
  rule.addEventListener('pointercancel', end)
}

function nudgePair(event) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  event.stopPropagation()
  const dir = event.key === 'ArrowDown' ? 0.04 : -0.04
  model.dockSplit = Math.max(0.15, Math.min(0.85, dockSplit() + dir))
  touch(false)
  save()
}

function fxDrag(event) {
  if (event.button != null && event.button !== 0) return
  const splitter = event.currentTarget
  const stage = splitter.parentElement
  if (!stage) return
  const start = event.clientX
  const origin = model.fxWidth || 280
  const id = event.pointerId
  const move = (ev) => {
    if (ev.pointerId !== id) return
    const room = stage.clientWidth - 160
    const next = origin - (ev.clientX - start)
    if (next < 56) {
      model.fxOpen = false
      touch(true)
      end(ev)
      return
    }
    model.fxWidth = Math.max(168, Math.min(Math.max(168, room), next))
    touch(false)
  }
  const end = (ev) => {
    if (ev && ev.pointerId !== id) return
    splitter.removeEventListener('pointermove', move)
    splitter.removeEventListener('pointerup', end)
    splitter.removeEventListener('pointercancel', end)
    save()
  }
  splitter.setPointerCapture?.(id)
  splitter.addEventListener('pointermove', move)
  splitter.addEventListener('pointerup', end)
  splitter.addEventListener('pointercancel', end)
}

/**
 * One at a time, aimed at the pads and the song from when they were dropped. A failure says why and the
 * rest still import. A song in the drop opens, and the sounds after it go to the library, not its pads.
 */
async function dropFiles(files) {
  const song = songId()
  const first = model.selected
  for (let i = 0; i < files.length; i++) {
    try {
      await importFile(files[i], Math.min(63, first + i), song)
    } catch (error) {
      model.browserNote = `${files[i].name}: ${error?.message || 'could not open that file'}`
      touch(false)
    }
  }
}

function numpadDigit(e) {
  const code = e.code || ''
  if (e.location !== 3 && !code.startsWith('Numpad')) return null
  if (code === 'NumpadDivide' || code === 'NumpadMultiply' || code === 'NumpadAdd' || code === 'NumpadSubtract' || code === 'NumpadEnter' || code === 'NumpadDecimal') return null
  if (e.key >= '0' && e.key <= '9') return Number(e.key)
  return null
}

function keysMode() {
  return model.keyboard && model.keyMap === 'renoise'
}

function playKey(index, holdId, pitch, extra) {
  const opts = { ...(extra || {}) }
  if (model.screen === 'track') {
    opts.trackerNote = true
    if (opts.lane == null) opts.lane = Math.floor((model.tracker.col || 0) / trackerFields())
  }
  noteOn(index, TRACK_VEL, holdId, pitch, opts)
}

function musicRoot() {
  return document.querySelector('[data-miya-music]')?.shadowRoot || null
}

function navItems() {
  const root = musicRoot()
  if (!root) return []
  return [...root.querySelectorAll('.mmm-main .dial, .mmm-main input[type="range"], .mmm-main select, .mmm-main [data-nav], .dock-pane [data-nav], .dock-pane select, .dock-pane input[type="range"], .fx-pane [data-nav], .fx-pane select, .fx-pane input[type="range"]')]
    .filter((el) => el.offsetParent !== null && !el.disabled)
}

function focusedControl() {
  const el = musicRoot()?.activeElement
  if (!el) return null
  return el
}

function moveNav(dir) {
  const items = navItems()
  if (!items.length) return
  const cur = focusedControl()
  let i = items.indexOf(cur)
  if (i < 0) i = dir > 0 ? 0 : items.length - 1
  else i = (i + dir + items.length) % items.length
  items.forEach((el) => el.classList.remove('nav-hot'))
  items[i].classList.add('nav-hot')
  items[i].focus()
  items[i].scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function editNav(dir, shift) {
  const el = focusedControl()
  if (!el) return
  if (el.classList?.contains('dial')) {
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: dir > 0 ? 'ArrowRight' : 'ArrowLeft',
      shiftKey: !!shift,
      bubbles: true,
      cancelable: true,
    }))
    return
  }
  if (el.matches?.('input[type="range"]')) {
    const min = Number(el.min)
    const max = Number(el.max)
    const step = Number(el.step) > 0 ? Number(el.step) : 1
    const jump = shift ? step * 16 : step
    const next = Math.min(max, Math.max(min, Number(el.value) + dir * jump))
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    proto.set.call(el, String(next))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  if (el.tagName === 'SELECT') {
    const next = el.selectedIndex + dir
    if (next < 0 || next >= el.options.length) return
    el.selectedIndex = next
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

function renoiseLive() {
  return keysMode()
}

function onTrackerNote(e) {
  if (!keysMode()) return false
  if ((model.tracker.col | 0) % trackerFields() !== 0) return false
  const key = e.key
  const low = key.length === 1 ? key.toLowerCase() : key
  if (low === 'a' || key === 'CapsLock') {
    e.preventDefault()
    if (model.tracker.edit && !e.repeat) recordTrackerOff()
    return true
  }
  const note = renoiseNote(key, model.renoiseOct)
  if (note == null) return false
  e.preventDefault()
  // Auto-repeat would restart the held note and write it again on every repeat.
  if (e.repeat) return true
  if (model.tracker.edit) {
    commitTrackerNote({ pad: model.selected, vel: TRACK_VEL, pitch: note - 60, typed: true })
  }
  playKey(model.selected, `key:${e.code}`, note - 60, { noCapture: true })
  return true
}

function onTrackerPad(e) {
  if (keysMode() || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false
  const low = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const local = PAD_KEYS.indexOf(low)
  if (local < 0) return false
  e.preventDefault()
  if (e.repeat) return true
  const index = model.bank * 16 + local
  if (model.tracker.edit) {
    commitTrackerNote({ pad: index, vel: TRACK_VEL, pitch: 0, typed: true })
  }
  selectPad(index)
  playKey(index, `key:${e.code}`, undefined, { noCapture: true })
  return true
}

function shiftRenoiseOct(dir) {
  model.renoiseOct = Math.max(0, Math.min(8, (model.renoiseOct ?? 3) + dir))
  touch(false)
}

function musicUnfocused() {
  const host = document.querySelector('[data-miya-music]')
  if (!host) return false
  const frame = host.closest('.react-draggable')
  if (!frame) return false
  return !frame.classList.contains('is-focused')
}

let qStep = 0
let qAt = 0
let kAt = 0

function onKey(e) {
  if (musicUnfocused()) return
  if (typing(e)) return
  const keySource = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target
  if (keySource?.classList?.contains('piano-splitter')) return
  // Space is the transport toggle on every screen, even when a button is highlighted.
  if ((e.key === ' ' || e.code === 'Space') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    if (!e.repeat) togglePlay()
    return
  }
  if (model.fileWindow || model.keysHelp) return
  if (e.key === 'Shift') finger.kbShift = true
  if (e.key === 'Escape' && model.coachTopic) {
    e.preventDefault()
    model.coachTopic = ''
    touch(false)
    return
  }
  if (e.key === 'Escape' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    toggleRecord()
    return
  }
  const key = e.key
  if (!e.repeat && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'Digit4') {
    const now = performance.now()
    e.preventDefault()
    if (kAt && now - kAt < 450) {
      kAt = 0
      model.k3 = !model.k3
      touch(false)
    } else kAt = now
    return
  }
  if (model.screen === 'mix' && model.compFocus && !e.repeat && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code?.startsWith('Digit')) {
    const now = performance.now()
    if (now - qAt > 2000) qStep = 0
    const want = [49, 52, 56, 56][qStep]
    const got = e.code.charCodeAt(5)
    qAt = now
    if (got === want) {
      qStep += 1
      e.preventDefault()
      if (qStep >= 4) {
        qStep = 0
        model.comp.justice = !model.comp.justice
        touch(true)
        syncMasterComp()
      }
      return
    }
    qStep = got === 49 ? 1 : 0
    if (qStep === 1) {
      e.preventDefault()
      return
    }
  } else if (!e.repeat && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') {
    qStep = 0
  }
  const trackerFocus = model.screen === 'track' && model.tracker.focus
  if ((renoiseLive() || trackerFocus) && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (key === '[' || key === ']')) {
    e.preventDefault()
    shiftRenoiseOct(key === '[' ? -1 : 1)
    return
  }
  if (trackerFocus && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^[0-9]$/.test(key)) {
    e.preventDefault()
    model.tracker.step = key === '0' ? 0 : Number(key)
    touch(true)
    return
  }
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) {
    e.preventDefault()
    if (!e.repeat) cycleScreen(key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1)
    return
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.repeat && (key === 'z' || key === 'Z')) {
    e.preventDefault()
    undo().then((did) => {
      if (!did) return
      syncMasterComp()
      syncMixer(true)
      pushNumpadFx()
    })
    return
  }
  if (model.screen === 'track' && model.tracker.focus) {
    const block = e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && key.startsWith('Arrow')
    const clip = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === 'c' || key === 'C' || key === 'v' || key === 'V')
    if ((block || clip) && handleTrackerKey(e)) {
      e.preventDefault()
      return
    }
  }
  if (model.screen === 'seq' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.repeat && (key === 'c' || key === 'C' || key === 'v' || key === 'V')) {
    const did = key === 'c' || key === 'C' ? copySeqSelection() : pasteSeqSelection()
    if (did) {
      e.preventDefault()
      return
    }
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const digit = numpadDigit(e)
  if (digit != null && e.shiftKey) {
    e.preventDefault()
    if (!e.repeat) holdNumpadFx(digit)
    return
  }
  const trackerFocusNow = model.screen === 'track' && model.tracker.focus
  if (e.repeat && !trackerFocusNow) return
  const low = key.length === 1 ? key.toLowerCase() : key
  const musical = renoiseLive()

  if (trackerFocusNow) {
    if (onTrackerPad(e)) return
    if (onTrackerNote(e)) return
    if (handleTrackerKey(e)) {
      e.preventDefault()
      return
    }
    if (keysMode() && (renoiseNote(key, model.renoiseOct) != null || low === 'a' || key === 'CapsLock')) {
      e.preventDefault()
      return
    }
    if (!keysMode() && PAD_KEYS.includes(low)) {
      e.preventDefault()
      return
    }
  }

  if (key === 'Shift') {
    model.hold = 'edit'
    return
  }
  if (low === 'n' && !musical) {
    model.hold = 'solo'
    e.preventDefault()
    return
  }
  if (low === 'b' && !model.keyboard) {
    model.hold = 'mute'
    e.preventDefault()
    return
  }
  if (key === '0' && !musical && !(model.screen === 'track' && model.tracker.focus)) {
    e.preventDefault()
    toggleRecord()
    return
  }
  if (low === 'm' && !musical) {
    e.preventDefault()
    toggleMetro()
    return
  }
  if ((musical || trackerFocusNow) && (e.code === 'NumpadDivide' || (key === '/' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(-1)
    return
  }
  if ((musical || trackerFocusNow) && (e.code === 'NumpadMultiply' || (key === '*' && e.location === 3))) {
    e.preventDefault()
    shiftRenoiseOct(1)
    return
  }
  if (key === '/') {
    e.preventDefault()
    cyclePlaySurface()
    return
  }
  if (key === 'Tab') {
    e.preventDefault()
    cycleScreen(e.shiftKey ? -1 : 1)
    return
  }
  if (key === '[') {
    e.preventDefault()
    setBank(model.bank - 1)
    return
  }
  if (key === ']') {
    e.preventDefault()
    setBank(model.bank + 1)
    return
  }
  if (key === '{' || key === '}') {
    e.preventDefault()
    const dir = key === '{' ? -1 : 1
    if (model.screen === 'pads') setSeqBank(Math.floor(model.pattern / 8) + dir)
    else setPattern(model.pattern + dir)
    return
  }
  if ((e.code === 'NumpadSubtract' || e.code === 'NumpadAdd') && !e.repeat && portaArmed()) {
    e.preventDefault()
    startPorta(e.code === 'NumpadAdd' ? 1 : -1)
    return
  }
  if (key === '=') {
    e.preventDefault()
    addBar()
    return
  }
  if (key === '-') {
    e.preventDefault()
    removeBar()
    return
  }
  if (key === '_') {
    e.preventDefault()
    doubleUp()
    return
  }
  if (!trackerFocusNow && (key === 'ArrowUp' || key === 'ArrowDown')) {
    e.preventDefault()
    moveNav(key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (!trackerFocusNow && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const dir = key === 'ArrowRight' ? 1 : -1
    const el = focusedControl()
    if (el && navItems().includes(el)) {
      e.preventDefault()
      editNav(dir, e.shiftKey)
      return
    }
    if (!model.keyboard) {
      e.preventDefault()
      setBank(model.bank + dir)
    }
    return
  }
  if ((key === 'Delete' || key === 'Backspace') && !(model.screen === 'track' && model.tracker.focus)) {
    e.preventDefault()
    if (model.screen === 'seq' && deleteSeqSelection()) return
    deleteSelection()
    return
  }

  if (model.keyboard) {
    if (model.keyMap === 'renoise') {
      if (low === 'a' || key === 'CapsLock') {
        e.preventDefault()
        releaseKeyboardNotes()
        return
      }
      const note = renoiseNote(key, model.renoiseOct)
      if (note != null) {
        e.preventDefault()
        playKey(model.selected, `key:${e.code}`, note - 60)
      }
      return
    }
    if (low === 'z') {
      model.octave = Math.max(1, model.octave - 1)
      touch(false)
      e.preventDefault()
      return
    }
    if (low === 'x') {
      model.octave = Math.min(7, model.octave + 1)
      touch(false)
      e.preventDefault()
      return
    }
    const note = pianoNote(key, model.octave)
    if (note != null) {
      e.preventDefault()
      playKey(model.selected, `key:${e.code}`, note - 60)
    }
    return
  }

  const local = PAD_KEYS.indexOf(low)
  if (local >= 0) {
    e.preventDefault()
    const index = model.bank * 16 + local
    if (model.hold) {
      selectPad(index, model.hold)
      return
    }
    selectPad(index)
    playKey(index, `key:${e.code}`)
    return
  }

  if (model.screen === 'pads') {
    const slot = SEQ_KEYS.indexOf(low)
    if (slot >= 0) {
      e.preventDefault()
      setSeqSlot(slot)
    }
  }
}

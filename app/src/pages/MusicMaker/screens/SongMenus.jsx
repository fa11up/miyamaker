import { useEffect, useRef, useState } from 'react'
import { sliceOnto } from '../audio/engine.js'
import {
  blankSong,
  captureSong,
  clearKit,
  downloadSong,
  loadSong,
  replaceSongFile,
  storeSongFile,
} from '../audio/song.js'
import { beginUndo, endUndo } from '../history.js'
import { ensureLibrary, newFolder } from '../media/library.js'
import { idbGet, model, touch } from '../model.js'
import { askPublish } from '../publish.js'
import { useModel } from '../useModel.js'
import { Dialog } from '../widgets.jsx'

function useMenuCloser(open, root, setOpen) {
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      const node = root.current
      if (!node) return
      // The maker sits in an open shadow root. A window listener sees the host
      // as event.target, so a press on a menu item looks outside unless we
      // walk the composed path.
      if (node.contains(event.target)) return
      if (event.composedPath?.().includes(node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [open, root, setOpen])
}

function note(message) {
  model.browserNote = message
  touch(false)
}

function openWindow(id) {
  model.fileWindow = id
  touch(false)
}

function closeWindow() {
  model.fileWindow = ''
  touch(false)
}

export function NewMenu() {
  useModel()
  const root = useRef(null)
  const [menu, setMenu] = useState(false)
  const [songOpen, setSongOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [folderName, setFolderName] = useState('Folder')
  const [dupName, setDupName] = useState('')
  const [sliceCount, setSliceCount] = useState(16)
  const windowId = model.fileWindow || ''
  useMenuCloser(menu, root, setMenu)

  useEffect(() => {
    if (!menu) setSongOpen(false)
  }, [menu])

  function choose(id) {
    setMenu(false)
    setSongOpen(false)
    if (id === 'new-duplicate') setDupName(`${model.songName || 'Song'} copy`)
    openWindow(id)
  }

  async function makeBlank() {
    setBusy(true)
    try {
      await loadSong(blankSong(), '')
      note('Blank song at 184 bpm')
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not start a blank song')
    } finally {
      setBusy(false)
    }
  }

  async function makeFromTemplate(file) {
    setBusy(true)
    try {
      const doc = await idbGet(`song:${file.id}`)
      if (!doc) throw new Error('That template is missing')
      await loadSong(doc, '')
      note(`${doc.name || file.name} started. Save as keeps the template.`)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not start from that template')
    } finally {
      setBusy(false)
    }
  }

  async function makeDuplicate() {
    const name = dupName.trim()
    if (!name) return
    setBusy(true)
    beginUndo()
    try {
      const doc = await captureSong(name)
      const stored = await storeSongFile(doc.name, doc)
      model.songName = stored.doc.name
      model.songFile = stored.id
      model.songPlay = true
      note(`${stored.doc.name}.m1ya is the current song`)
      touch(true)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not duplicate the song')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  async function makeFolder() {
    const id = newFolder(folderName)
    if (!id) {
      note('Name the folder')
      return
    }
    note(`Folder ${folderName.trim()} added`)
    closeWindow()
  }

  async function makeKit() {
    setBusy(true)
    try {
      await clearKit()
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not clear the kit')
    } finally {
      setBusy(false)
    }
  }

  async function makeSlice() {
    const count = Math.max(2, Math.min(64, Math.round(Number(sliceCount) || 0)))
    if (count < 2) {
      note('Slice count is 2 to 64')
      return
    }
    setBusy(true)
    try {
      await sliceOnto(model.selected, count)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not slice that pad')
    } finally {
      setBusy(false)
    }
  }

  const templates = (ensureLibrary().files || []).filter((file) => file.folder === 'templates' && file.ext === 'm1ya')
  const pad = model.pads[model.selected]

  return (
    <div className="mmm-file" ref={root}>
      <button
        type="button"
        className={`btn free-width ${menu ? 'on' : ''}`}
        aria-expanded={menu}
        aria-haspopup="menu"
        onClick={() => setMenu((open) => !open)}
      >
        NEW
      </button>
      {menu && (
        <div className="file-menu" role="menu">
          <div
            className="file-sub"
            onMouseEnter={() => setSongOpen(true)}
            onMouseLeave={() => setSongOpen(false)}
          >
            <button type="button" aria-expanded={songOpen} onClick={() => setSongOpen(true)}>
              Song
            </button>
            {songOpen && (
              <div className="file-menu file-menu-sub" role="menu">
                <button type="button" onClick={() => choose('new-blank')}>New blank</button>
                <button type="button" onClick={() => choose('new-template')}>New from template</button>
                <button type="button" onClick={() => choose('new-duplicate')}>New duplicate</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => choose('new-folder')}>Folder</button>
          <button type="button" onClick={() => choose('new-kit')}>Kit</button>
          <button type="button" onClick={() => choose('new-slice')}>Slice</button>
        </div>
      )}
      {windowId === 'new-blank' && (
        <Dialog title="New blank song" onClose={closeWindow}>
          <p style={{ margin: 0 }}>Replace the current song?</p>
          <p className="hint">A blank song is 184 bpm with the factory kit. The song you are editing is replaced.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={makeBlank}>Replace</button>
            <button type="button" className="btn" onClick={closeWindow}>Cancel</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'new-template' && (
        <Dialog title="New from template" onClose={closeWindow}>
          <p className="hint">Pick a template. Saving later asks for a new song, so the template stays as it is.</p>
          <div className="lib-list">
            {templates.map((file) => (
              <button key={file.id} type="button" className="btn free-width" disabled={busy} onClick={() => makeFromTemplate(file)}>
                {file.name}
              </button>
            ))}
            {!templates.length && <p className="hint">Save a song as a template first.</p>}
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'new-duplicate' && (
        <Dialog title="New duplicate" onClose={closeWindow}>
          <p className="hint">Stores a copy in Songs and keeps editing that copy.</p>
          <input className="field" aria-label="Duplicate name" value={dupName} onChange={(e) => setDupName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy || !dupName.trim()} onClick={makeDuplicate}>Duplicate</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'new-folder' && (
        <Dialog title="New folder" onClose={closeWindow}>
          <input className="field" aria-label="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy || !folderName.trim()} onClick={makeFolder}>Create</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'new-kit' && (
        <Dialog title="New kit" onClose={closeWindow}>
          <p style={{ margin: 0 }}>Replace current kit?</p>
          <p className="hint">Pads become empty. The arrangement stays.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={makeKit}>Replace</button>
            <button type="button" className="btn" onClick={closeWindow}>Cancel</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'new-slice' && (
        <Dialog title="New slice" onClose={closeWindow}>
          <p className="hint">Chops {pad?.name || 'the selected pad'} into equal slices and puts them on the following pads.</p>
          <input
            className="field num"
            aria-label="Slice count"
            type="number"
            min={2}
            max={64}
            value={sliceCount}
            onChange={(e) => setSliceCount(e.target.value)}
          />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={makeSlice}>Slice</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
    </div>
  )
}

export function SaveMenu() {
  useModel()
  const root = useRef(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(() => model.songName || 'Song')
  const windowId = model.fileWindow || ''
  useMenuCloser(menu, root, setMenu)

  function choose(id) {
    setMenu(false)
    setName(model.songName || 'Song')
    openWindow(id)
  }

  function publish(intent) {
    setMenu(false)
    if (!askPublish(intent)) note('Arweave and mint run inside miyamaker.com')
  }

  async function saveOver() {
    setMenu(false)
    if (!model.songFile) {
      setName(model.songName || 'Song')
      openWindow('save-as')
      return
    }
    setBusy(true)
    beginUndo()
    try {
      const doc = await captureSong(model.songName || 'Song')
      const stored = await replaceSongFile(model.songFile, doc.name, doc)
      model.songName = stored.doc.name
      model.songFile = stored.id
      model.songPlay = true
      note(`${stored.doc.name}.m1ya saved`)
      touch(true)
    } catch (error) {
      note(error.message || 'Could not save that song')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  async function saveAs() {
    const next = name.trim()
    if (!next) return
    setBusy(true)
    beginUndo()
    try {
      const doc = await captureSong(next)
      const stored = await storeSongFile(doc.name, doc)
      downloadSong(stored.doc)
      model.songName = stored.doc.name
      model.songFile = stored.id
      model.songOrder = stored.doc.order
      model.songPlay = true
      note(`${stored.doc.name}.m1ya saved in Songs and downloaded`)
      touch(true)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not save that song')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  async function saveTemplate() {
    const next = name.trim()
    if (!next) return
    setBusy(true)
    beginUndo()
    try {
      const doc = await captureSong(next)
      const stored = await storeSongFile(doc.name, doc, { folder: 'templates' })
      note(`${stored.doc.name} saved as a template`)
      touch(true)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not save that template')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  return (
    <div className="mmm-file" ref={root}>
      <button
        type="button"
        className={`btn free-width ${menu ? 'on' : ''}`}
        aria-expanded={menu}
        aria-haspopup="menu"
        onClick={() => setMenu((open) => !open)}
      >
        SAVE
      </button>
      {menu && (
        <div className="file-menu" role="menu">
          <button type="button" disabled={busy} onClick={saveOver}>Save</button>
          <button type="button" onClick={() => choose('save-as')}>Save as…</button>
          <button type="button" onClick={() => choose('save-template')}>Save as template</button>
          <button type="button" disabled={busy} onClick={() => publish('upload-song')}>Save song to Arweave</button>
          <button type="button" disabled={busy} onClick={() => publish('upload-kit')}>Save kit to Arweave</button>
          <button type="button" disabled={busy} onClick={() => publish('upload-bounce')}>Upload bounce</button>
          <button type="button" disabled={busy} onClick={() => publish('mint-song')}>Mint song…</button>
          <button type="button" disabled={busy} onClick={() => publish('mint-kit')}>Mint kit…</button>
        </div>
      )}
      {windowId === 'save-as' && (
        <Dialog title="Save as" onClose={closeWindow}>
          <p className="hint">Stores a new .m1ya in Songs, downloads it, and keeps editing that file.</p>
          <input className="field" aria-label="Song name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy || !name.trim()} onClick={saveAs}>Save</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'save-template' && (
        <Dialog title="Save as template" onClose={closeWindow}>
          <p className="hint">Stores a starting song under Templates. The song you are editing stays the current file.</p>
          <input className="field" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy || !name.trim()} onClick={saveTemplate}>Save template</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
    </div>
  )
}

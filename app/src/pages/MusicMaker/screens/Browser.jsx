import { useEffect, useState } from 'react'
import { decodePreview, importFile, importRemote, sliceOnto } from '../audio/engine.js'
import { sliceCount } from '../audio/slice.js'
import {
  cachedPreview,
  ensureLibrary,
  fileLabel,
  keepPreview,
  loadCached,
  MEDIA_RE,
  newFolder,
  readDirectoryFile,
  removeCached,
  savedDirectories,
} from '../media/library.js'
import {
  deleteFiles,
  duplicateFiles,
  loadKit,
  loadSong,
  openSliceSet,
  sliceSetForFolder,
} from '../audio/song.js'
import { audioBank, idbGet, model, rememberSample, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { Dialog } from '../widgets.jsx'
import { Waveform } from './Waveform.jsx'

export function SampleBrowser() {
  useModel()
  const library = ensureLibrary()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set(['cache', 'imports', 'slices', 'songs', 'templates', 'kits', 'packs']))
  const [pick, setPick] = useState(null)
  const [picked, setPicked] = useState([])
  const [anchor, setAnchor] = useState(null)
  const [menu, setMenu] = useState(null)
  const [confirmKit, setConfirmKit] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dirs, setDirs] = useState([])
  const [linked, setLinked] = useState({})
  const [slices, setSlices] = useState(16)
  const [folderName, setFolderName] = useState('')
  const needle = query.trim().toLowerCase()

  useEffect(() => {
    savedDirectories().then(setDirs).catch(() => {})
  }, [model.dirTick])

  useEffect(() => {
    if (!menu) return undefined
    const down = (event) => {
      const path = event.composedPath?.() || [event.target]
      if (path.some((node) => node.classList?.contains?.('ctx-menu'))) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menu])

  function toggle(id) {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  async function showCache(file) {
    setPick({ kind: 'cache', id: file.id, name: file.name })
    const known = cachedPreview(file.id)
    if (known) {
      setPreview(known)
      return
    }
    const rec = await loadCached(file.id)
    if (!rec?.pcm) {
      setPreview(null)
      return
    }
    const entry = { pcm: rec.pcm, sr: rec.sr || 44100 }
    keepPreview(file.id, entry)
    setPreview(entry)
  }

  async function showHandle(row) {
    setPick({ kind: 'link', name: row.name, handle: row.handle })
    setPreview(null)
    try {
      const file = await readDirectoryFile(row.handle)
      const decoded = await decodePreview(await file.arrayBuffer(), file.name)
      setPreview(decoded)
    } catch (error) {
      model.browserNote = error.message || 'Could not preview that file'
      touch(false)
    }
  }

  async function showNft(link, tokenName) {
    setPick({ kind: 'nft', name: tokenName || link.name, url: link.url })
    setPreview(null)
    model.browserNote = 'The wave appears after it is loaded onto a pad. Video hosts often block a preview fetch.'
    touch(false)
  }

  async function loadPick() {
    try {
      if (!pick) return
      if (pick.kind === 'cache') {
        const rec = await loadCached(pick.id)
        if (!rec?.pcm) return
        await rememberSample(model.selected, { pcm: rec.pcm, sr: rec.sr || 44100, name: pick.name, forceName: true })
        model.browserNote = `${pick.name} on pad ${model.selected + 1}`
        touch(false)
      } else if (pick.kind === 'song') {
        const doc = await idbGet(`song:${pick.id}`)
        if (doc) await loadSong(doc, pick.folder === 'templates' ? '' : pick.id)
      } else if (pick.kind === 'kit') {
        model.browserNote = 'Right-click the kit and choose Load'
        touch(false)
      } else if (pick.kind === 'link') {
        const file = await readDirectoryFile(pick.handle)
        await importFile(file, model.selected)
      } else if (pick.kind === 'nft') {
        await importRemote(pick.url, model.selected, pick.name)
      }
    } catch (error) {
      model.browserNote = error.message || 'Could not load that file'
      touch(false)
    }
  }

  async function slicePick() {
    const count = sliceCount(slices)
    if (!count) {
      model.browserNote = 'Slice count is 2 to 64'
      touch(false)
      return
    }
    try {
      if (pick?.kind === 'cache') {
        const rec = await loadCached(pick.id)
        if (!rec?.pcm) return
        await rememberSample(model.selected, { pcm: rec.pcm, sr: rec.sr || 44100, name: pick.name, forceName: true })
      } else if (pick?.kind === 'link') {
        const file = await readDirectoryFile(pick.handle)
        await importFile(file, model.selected)
      } else if (pick?.kind === 'nft') {
        await importRemote(pick.url, model.selected, pick.name)
      } else if (!audioBank.get(model.selected)?.pcm) {
        model.browserNote = 'Choose a file, or put a sample on the selected pad'
        touch(false)
        return
      }
      await sliceOnto(model.selected, count, pick?.name)
    } catch (error) {
      model.browserNote = error.message || 'Could not slice that file'
      touch(false)
    }
  }

  async function expandDir(dir) {
    if (linked[dir.key]) {
      toggle(dir.key)
      return
    }
    const perm = await dir.handle.queryPermission?.({ mode: 'read' })
    if (perm !== 'granted') {
      const next = await dir.handle.requestPermission?.({ mode: 'read' })
      if (next !== 'granted') {
        model.browserNote = `Allow ${dir.name} to read it again`
        touch(false)
        return
      }
    }
    const rows = await walkHandle(dir.handle, '')
    setLinked((prev) => ({ ...prev, [dir.key]: rows }))
    toggle(dir.key)
  }

  const packs = model.nftPacks || []
  const locked = model.nftLocked || []
  const roots = library.folders.filter((folder) => !folder.parent && folderHits(folder, needle))

  return (
    <aside className="browser-dock">
      <div className="browser-search">
        <input
          className="field"
          placeholder="Search samples"
          value={query}
          aria-label="Search samples"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="browser-tree" role="tree">
        <Row id="cache" open={open} toggle={toggle} label="Cache" depth={0} />
        {open.has('cache') && roots.map((folder) => (
          <Folder
            key={folder.id}
            folder={folder}
            depth={1}
            open={open}
            toggle={toggle}
            needle={needle}
            pick={pick}
            picked={picked}
            onPick={pickFile}
            onMenu={openMenu}
          />
        ))}
        <Row id="packs" open={open} toggle={toggle} label="Wallet packs" depth={0} />
        {open.has('packs') && (
          <>
            {locked.map((pack) => (
              <div key={pack.id} className="browser-row locked" style={{ paddingLeft: 16 }}>
                {pack.name} locked
              </div>
            ))}
            {packs.map((pack) => (
              <div key={pack.id}>
                <Row id={pack.id} open={open} toggle={toggle} label={pack.name} depth={1} />
                {open.has(pack.id) && pack.tokens.map((token) => (
                  <div key={token.id}>
                    <div className="browser-row quiet" style={{ paddingLeft: 28 }}>{token.name}</div>
                    {token.links.map((link) => (
                      <button
                        key={link.url}
                        type="button"
                        className={`browser-row ${pick?.url === link.url ? 'on' : ''}`}
                        style={{ paddingLeft: 40 }}
                        onClick={() => showNft(link, token.name)}
                        onDoubleClick={() => {
                          showNft(link, token.name)
                          importRemote(link.url, model.selected, token.name).catch((error) => {
                            model.browserNote = error.message
                            touch(false)
                          })
                        }}
                      >
                        {link.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        <Row id="linked" open={open} toggle={toggle} label="Linked folders" depth={0} />
        {open.has('linked') && dirs.map((dir) => (
          <div key={dir.key}>
            <button type="button" className="browser-row" style={{ paddingLeft: 16 }} onClick={() => expandDir(dir)}>
              {open.has(dir.key) ? '▾' : '▸'} {dir.name}
            </button>
            {open.has(dir.key) && (linked[dir.key] || []).filter((row) => !needle || row.name.toLowerCase().includes(needle)).map((row) => (
              row.kind === 'dir' ? (
                <div key={row.path} className="browser-row quiet" style={{ paddingLeft: 16 + row.depth * 12 }}>{row.name}</div>
              ) : (
                <button
                  key={row.path}
                  type="button"
                  className={`browser-row ${pick?.handle === row.handle ? 'on' : ''}`}
                  style={{ paddingLeft: 16 + row.depth * 12 }}
                  onClick={() => showHandle(row)}
                  onDoubleClick={() => importFileFromHandle(row)}
                >
                  {row.name}
                </button>
              )
            ))}
          </div>
        ))}
        {open.has('linked') && model.sessionFiles?.length > 0 && (
          <div>
            <div className="browser-row quiet" style={{ paddingLeft: 16 }}>This session</div>
            {sessionTree(model.sessionFiles, needle).map((file) => (
              <button
                key={file.webkitRelativePath || file.name}
                type="button"
                className="browser-row"
                style={{ paddingLeft: 28 }}
                onClick={() => {
                  setPick({ kind: 'link', name: file.name, handle: { getFile: async () => file } })
                }}
                onDoubleClick={() => importFile(file, model.selected)}
              >
                {file.webkitRelativePath || file.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <Waveform pcm={preview?.pcm} sr={preview?.sr} />
      <div className="browser-actions">
        <input
          className="field"
          aria-label="New folder name"
          placeholder="Folder"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
        />
        <button
          type="button"
          className="tree-btn"
          onClick={() => {
            if (newFolder(folderName)) setFolderName('')
          }}
        >
          New
        </button>
        <button type="button" className="tree-btn" onClick={loadPick}>To pad</button>
        <input
          className="field num"
          aria-label="Even slice count"
          type="number"
          min={2}
          max={64}
          value={slices}
          onChange={(e) => setSlices(e.target.value)}
        />
        <button type="button" className="tree-btn" onClick={slicePick}>Slice</button>
        {pick?.kind === 'cache' && (
          <button type="button" className="tree-btn" onClick={() => removeCached(pick.id).then(() => { setPick(null); setPicked([]); setPreview(null) })}>
            Drop
          </button>
        )}
      </div>
      <div className="browser-note">{model.browserNote || 'FILE opens and saves. Even slice splits one file across pads from the selected pad.'}</div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {menu.kit && <button type="button" onClick={() => runMenu('load')}>Load</button>}
          <button type="button" onClick={() => runMenu('duplicate')}>Duplicate</button>
          <button type="button" onClick={() => runMenu('delete')}>Delete</button>
        </div>
      )}
      {confirmKit && (
        <Dialog title="Load kit" onClose={() => setConfirmKit(null)}>
          <p style={{ margin: 0 }}>Replace current kit?</p>
          <div className="dialog-actions">
            <button type="button" className="tree-btn" onClick={confirmKitLoad}>Replace</button>
            <button type="button" className="tree-btn" onClick={() => setConfirmKit(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </aside>
  )

  function pickFile(event, file, folderFiles) {
    if (file.ext === 'm1ya') {
      setPick({ kind: 'song', id: file.id, name: file.name, folder: file.folder })
      setPreview(null)
    } else if (file.ext === 'k1t') {
      setPick({ kind: 'kit', id: file.id, name: file.name })
      setPreview(null)
    } else {
      showCache(file)
    }
    if (event.shiftKey) {
      const ids = folderFiles.map((item) => item.id)
      const from = ids.indexOf(anchor)
      const to = ids.indexOf(file.id)
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to)
        const hi = Math.max(from, to)
        setPicked(ids.slice(lo, hi + 1))
      } else {
        setPicked((cur) => (cur.includes(file.id) ? cur : [...cur, file.id]))
      }
      return
    }
    setAnchor(file.id)
    setPicked([file.id])
    if (file.ext === 'k1t') return
    if (file.ext === 'm1ya' || SONG_RE.test(file.name)) openLibraryFile(file)
  }

  function openMenu(event, file, folderFiles) {
    event.preventDefault()
    event.stopPropagation()
    const ids = picked.includes(file.id) ? picked : [file.id]
    const frame = event.currentTarget.closest('.mmm')
    const rect = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 }
    setPicked(ids)
    setAnchor(file.id)
    if (!picked.includes(file.id)) {
      if (file.ext === 'm1ya') {
        setPick({ kind: 'song', id: file.id, name: file.name, folder: file.folder })
        setPreview(null)
      } else if (file.ext === 'k1t') {
        setPick({ kind: 'kit', id: file.id, name: file.name })
        setPreview(null)
      } else showCache(file)
    }
    setMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      ids,
      kit: file.ext === 'k1t' ? { id: file.id, name: file.name } : null,
    })
  }

  async function runMenu(action) {
    const ids = menu?.ids || []
    const kit = menu?.kit || null
    setMenu(null)
    if (action === 'load') {
      if (kit) setConfirmKit(kit)
      return
    }
    if (!ids.length) return
    try {
      if (action === 'delete') {
        await deleteFiles(ids)
        setPicked([])
        setPick(null)
        setPreview(null)
      } else {
        await duplicateFiles(ids)
      }
    } catch (error) {
      model.browserNote = error.message || 'Could not change those files'
      touch(false)
    }
  }

  async function confirmKitLoad() {
    const kit = confirmKit
    setConfirmKit(null)
    if (!kit) return
    try {
      const doc = await idbGet(`kit:${kit.id}`)
      if (!doc) throw new Error('That kit file is missing')
      await loadKit(doc)
      setKitName(doc.name || kit.name)
    } catch (error) {
      model.browserNote = error.message || 'Could not load that kit'
      touch(false)
    }
  }

}

function folderHits(folder, needle) {
  if (!needle) return true
  const library = ensureLibrary()
  if (folder.name.toLowerCase().includes(needle)) return true
  if (library.files.some((file) => file.folder === folder.id && `${file.name} ${file.ext || ''}`.toLowerCase().includes(needle))) return true
  return library.folders.some((child) => child.parent === folder.id && folderHits(child, needle))
}

function Folder({ folder, depth, open, toggle, needle, pick, picked, onPick, onMenu }) {
  const files = ensureLibrary().files.filter((file) => file.folder === folder.id && (!needle || file.name.toLowerCase().includes(needle) || (file.ext || '').includes(needle)))
  const children = ensureLibrary().folders.filter((item) => item.parent === folder.id)
  return (
    <div>
      <button
        type="button"
        className="browser-row"
        style={{ paddingLeft: depth * 12 }}
        onClick={() => {
          toggle(folder.id)
          const set = sliceSetForFolder(folder.id)
          if (set) openSliceSet(set)
        }}
      >
        {open.has(folder.id) ? '▾' : '▸'} {folder.name}
      </button>
      {open.has(folder.id) && children.map((child) => (
        <Folder
          key={child.id}
          folder={child}
          depth={depth + 1}
          open={open}
          toggle={toggle}
          needle={needle}
          pick={pick}
          picked={picked}
          onPick={onPick}
          onMenu={onMenu}
        />
      ))}
      {open.has(folder.id) && files.map((file) => (
        <button
          key={file.id}
          type="button"
          className={`browser-row ${pick?.id === file.id || picked?.includes(file.id) ? 'on' : ''}`}
          style={{ paddingLeft: (depth + 1) * 12 }}
          onClick={(event) => onPick(event, file, files)}
          onContextMenu={(event) => onMenu(event, file, files)}
          onDoubleClick={() => {
            if (file.ext === 'm1ya' || file.ext === 'k1t' || SONG_RE.test(file.name)) return
            openLibraryFile(file)
          }}
        >
          {fileLabel(file)}
        </button>
      ))}
    </div>
  )
}

const SONG_RE = /\.(m1ya|mod|xm)$/i
const KIT_RE = /\.k1t$/i

async function openLibraryFile(file) {
  try {
    if (file.ext === 'k1t') return
    if (file.ext === 'm1ya' || SONG_RE.test(file.name)) {
      const doc = await idbGet(`song:${file.id}`)
      if (doc) await loadSong(doc, file.folder === 'templates' ? '' : file.id)
      return
    }
    const rec = await loadCached(file.id)
    if (!rec?.pcm) return
    await rememberSample(model.selected, { pcm: rec.pcm, sr: rec.sr || 44100, name: file.name, forceName: true })
  } catch (error) {
    model.browserNote = error.message || 'Could not open that file'
    touch(false)
  }
}

function Row({ id, open, toggle, label, depth }) {
  return (
    <button type="button" className="browser-row root" style={{ paddingLeft: depth * 12 }} onClick={() => toggle(id)}>
      {open.has(id) ? '▾' : '▸'} {label}
    </button>
  )
}

function sessionTree(files, needle) {
  return files.filter((file) => !needle || (file.webkitRelativePath || file.name).toLowerCase().includes(needle))
}

async function walkHandle(dirHandle, prefix, depth = 1) {
  const rows = []
  if (depth > 6 || rows.length > 400) return rows
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      rows.push({ kind: 'dir', name, path, depth })
      rows.push(...await walkHandle(handle, path, depth + 1))
    } else if (MEDIA_RE.test(name) || SONG_RE.test(name) || KIT_RE.test(name)) {
      rows.push({ kind: 'file', name, path, handle, depth })
    }
  }
  return rows
}

function importFileFromHandle(row) {
  readDirectoryFile(row.handle).then((file) => importFile(file, model.selected)).catch((error) => {
    model.browserNote = error.message
    touch(false)
  })
}

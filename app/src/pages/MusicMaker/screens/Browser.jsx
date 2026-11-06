import { useEffect, useState } from 'react'
import { decodePreview, importFile, importRemote, sliceOnto } from '../audio/engine.js'
import { sliceCount } from '../audio/slice.js'
import {
  cachedPreview,
  ensureLibrary,
  keepPreview,
  loadCached,
  MEDIA_RE,
  newFolder,
  readDirectoryFile,
  rememberDirectory,
  removeCached,
  savedDirectories,
} from '../media/library.js'
import { isAddress, loadWalletPacks, requestAccount } from '../media/nft.js'
import { audioBank, model, rememberSample, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { Waveform } from './Waveform.jsx'

export function SampleBrowser() {
  useModel()
  const library = ensureLibrary()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set(['cache', 'imports', 'slices', 'packs']))
  const [pick, setPick] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dirs, setDirs] = useState([])
  const [linked, setLinked] = useState({})
  const [packs, setPacks] = useState([])
  const [locked, setLocked] = useState([])
  const [slices, setSlices] = useState(16)
  const [folderName, setFolderName] = useState('')
  const needle = query.trim().toLowerCase()

  useEffect(() => {
    savedDirectories().then(setDirs).catch(() => {})
  }, [])

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

  async function linkFolder() {
    try {
      if (window.showDirectoryPicker) {
        const handle = await window.showDirectoryPicker({ mode: 'read' })
        await rememberDirectory(handle)
        setDirs(await savedDirectories())
        model.browserNote = `Linked ${handle.name}`
        touch(false)
        return
      }
      document.getElementById('mmm-dir')?.click()
    } catch (error) {
      if (error?.name === 'AbortError') return
      model.browserNote = error.message || 'Could not link that folder'
      touch(false)
    }
  }

  function onDirectoryInput(event) {
    const files = [...event.target.files].filter((file) => MEDIA_RE.test(file.name))
    const tree = { name: 'This session', files }
    setLinked((prev) => ({ ...prev, session: tree }))
    setOpen((prev) => new Set(prev).add('session'))
    event.target.value = ''
    model.browserNote = `${files.length} files from that folder`
    touch(false)
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

  async function refreshWallet(address) {
    const who = (address || model.wallet || '').trim()
    if (!isAddress(who)) {
      model.browserNote = 'Paste a 0x address, or use the wallet button'
      touch(false)
      return
    }
    model.wallet = who
    model.browserNote = 'Reading the wallet'
    touch(true)
    try {
      const result = await loadWalletPacks(who)
      setPacks(result.packs)
      setLocked(result.locked)
      setOpen((prev) => new Set(prev).add('packs'))
      const count = result.packs.reduce((sum, pack) => sum + pack.tokens.length, 0)
      model.browserNote = count ? `${count} tokens with media` : 'No audio or video in this wallet yet'
      touch(false)
    } catch (error) {
      model.browserNote = error.message || 'Could not read that wallet'
      touch(false)
    }
  }

  const folders = library.folders.filter((folder) => !needle || folder.name.toLowerCase().includes(needle) || library.files.some((file) => file.folder === folder.id && file.name.toLowerCase().includes(needle)))

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
        {open.has('cache') && folders.map((folder) => (
          <Folder
            key={folder.id}
            folder={folder}
            depth={1}
            open={open}
            toggle={toggle}
            needle={needle}
            pick={pick}
            onFile={showCache}
          />
        ))}
        <Row id="packs" open={open} toggle={toggle} label="Wallet packs" depth={0} />
        {open.has('packs') && (
          <>
            <form
              className="browser-wallet"
              onSubmit={(e) => {
                e.preventDefault()
                refreshWallet()
              }}
            >
              <input
                className="field"
                placeholder="0x wallet"
                aria-label="Wallet address"
                value={model.wallet}
                onChange={(e) => {
                  model.wallet = e.target.value
                  touch(false)
                }}
              />
              <button type="submit" className="tree-btn">Read</button>
              <button
                type="button"
                className="tree-btn"
                onClick={() => requestAccount().then((account) => {
                  model.wallet = account
                  return refreshWallet(account)
                }).catch((error) => {
                  model.browserNote = error.message
                  touch(false)
                })}
              >
                Wallet
              </button>
            </form>
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
        {open.has('linked') && linked.session && (
          <div>
            <div className="browser-row quiet" style={{ paddingLeft: 16 }}>This session</div>
            {sessionTree(linked.session.files, needle).map((file) => (
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
        <button type="button" className="tree-btn" onClick={linkFolder}>Link</button>
        <input
          id="mmm-dir"
          hidden
          type="file"
          multiple
          ref={(node) => {
            if (node) node.setAttribute('webkitdirectory', '')
          }}
          onChange={onDirectoryInput}
        />
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
        <button type="button" className="tree-btn" onClick={() => document.getElementById('mmm-import')?.click()}>Add</button>
        <input
          id="mmm-import"
          hidden
          type="file"
          accept="audio/*,video/*,.wav,.mp3,.m4a,.ogg,.flac,.aiff,.mp4,.webm,.mov"
          multiple
          onChange={(e) => {
            ;[...e.target.files].forEach((file, i) => importFile(file, Math.min(63, model.selected + i)))
            e.target.value = ''
          }}
        />
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
          <button type="button" className="tree-btn" onClick={() => removeCached(pick.id).then(() => { setPick(null); setPreview(null) })}>
            Drop
          </button>
        )}
      </div>
      <div className="browser-note">{model.browserNote || 'Even slice splits one file across pads from the selected pad.'}</div>
    </aside>
  )
}

function Folder({ folder, depth, open, toggle, needle, pick, onFile }) {
  const files = ensureLibrary().files.filter((file) => file.folder === folder.id && (!needle || file.name.toLowerCase().includes(needle)))
  const children = ensureLibrary().folders.filter((item) => item.parent === folder.id)
  return (
    <div>
      <button type="button" className="browser-row" style={{ paddingLeft: depth * 12 }} onClick={() => toggle(folder.id)}>
        {open.has(folder.id) ? '▾' : '▸'} {folder.name}
      </button>
      {open.has(folder.id) && children.map((child) => (
        <Folder key={child.id} folder={child} depth={depth + 1} open={open} toggle={toggle} needle={needle} pick={pick} onFile={onFile} />
      ))}
      {open.has(folder.id) && files.map((file) => (
        <button
          key={file.id}
          type="button"
          className={`browser-row ${pick?.id === file.id ? 'on' : ''}`}
          style={{ paddingLeft: (depth + 1) * 12 }}
          onClick={() => onFile(file)}
          onDoubleClick={() => {
            onFile(file)
            loadCached(file.id).then((rec) => {
              if (!rec?.pcm) return
              rememberSample(model.selected, { pcm: rec.pcm, sr: rec.sr || 44100, name: file.name, forceName: true })
            })
          }}
        >
          {file.name}
        </button>
      ))}
    </div>
  )
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
    } else if (MEDIA_RE.test(name)) {
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

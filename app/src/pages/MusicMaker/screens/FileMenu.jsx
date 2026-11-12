import { useEffect, useRef, useState } from 'react'
import { cacheRemote, importFile, importRemote, readVideoLink } from '../audio/engine.js'
import { IMAGE_LOADER, importImageFile } from '../audio/imageSpectrum.js'
import {
  captureKit,
  captureSong,
  downloadKit,
  downloadSong,
  importSongUrl,
  loadKitIfCurrent,
  storeKitFile,
  storeSongFile,
  syncProfileSongs,
} from '../audio/song.js'
import { beginUndo, endUndo } from '../history.js'
import { sameSong, songId } from '../jobs.js'
import { DESKTOP_VIDEO_NOTE, isDesktopApp } from '../media/desktop.js'
import { MEDIA_RE, rememberDirectory } from '../media/library.js'
import { importPictureUrl, pictureKitDoc } from '../media/pictures.js'
import { isAddress, kitPictures, loadWalletPacks, plainName, requestAccount, walletSummary } from '../media/nft.js'
import { model, touch } from '../model.js'
import { useModel } from '../useModel.js'
import { Dialog } from '../widgets.jsx'
import { VideoTake } from './VideoTake.jsx'

const ACCEPT = 'audio/*,video/*,.wav,.mp3,.m4a,.ogg,.flac,.aiff,.mp4,.webm,.mov,.m1ya,.mod,.xm,.k1t'
const SONG_RE = /\.(m1ya|mod|xm)$/i
const KIT_RE = /\.k1t$/i
/** Files kept from one Open folder pick. A bigger folder lists the first ones and says so. */
const SESSION_FILES_MAX = 2000

/** The newest wallet read. An older one that answers late is dropped. */
let walletRequest = 0
/** The address being read, or whose packs are shown. */
let walletFor = ''
/** A kit build still reading pictures. A newer read or a newer kit drops it. */
let kitRequest = 0
/** Aborts the picture the kit build is reading now, so Cancel does not wait for a slow host. */
let kitAbort = null

function clearPacks() {
  model.nftPacks = []
  model.nftLocked = []
  model.nftUnknown = []
}

export function FileMenu() {
  useModel()
  const root = useRef(null)
  const [menu, setMenu] = useState(false)
  const [songName, setSongName] = useState(() => model.songName || 'Song')
  const [kitName, setKitName] = useState(() => model.kitName || 'Kit')
  const [ipfs, setIpfs] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoTake, setVideoTake] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imageSet, setImageSet] = useState(() => ({ ...IMAGE_LOADER }))
  const [kitAsk, setKitAsk] = useState(false)
  // A kit build reads pictures for a while. It keeps the Wallet window closable and has its own Cancel.
  const [kitBusy, setKitBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const windowId = model.fileWindow || ''

  useEffect(() => {
    if (!menu) return undefined
    const down = (event) => {
      const node = root.current
      if (!node) return
      if (node.contains(event.target)) return
      if (event.composedPath?.().includes(node)) return
      setMenu(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menu])

  useEffect(() => {
    const down = (event) => {
      if (event.key !== 'Escape') return
      if (model.fileWindow) {
        event.preventDefault()
        event.stopPropagation()
        closeWindow()
        return
      }
      if (!menu) return
      event.preventDefault()
      event.stopPropagation()
      setMenu(false)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [menu])

  function openWindow(id) {
    setMenu(false)
    model.fileWindow = id
    touch(false)
  }

  /** Drops a kit build in flight: its answer is ignored and the picture being read stops. */
  function stopKit() {
    kitRequest += 1
    kitAbort?.abort()
    kitAbort = null
    setKitBusy(false)
  }

  function closeWindow() {
    // Closing the window cancels a kit still being built, so it never replaces the kit later behind the user's back.
    if (kitAbort) {
      stopKit()
      note('Kit cancelled. The kit you were editing is unchanged.')
    }
    setVideoTake(null)
    model.fileWindow = ''
    touch(false)
  }

  function note(message) {
    model.browserNote = message
    touch(false)
  }

  async function onFiles(event) {
    const files = [...event.target.files]
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    const song = songId()
    const first = model.selected
    try {
      for (let i = 0; i < files.length; i++) await importFile(files[i], Math.min(63, first + i), song)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not open that file')
    } finally {
      setBusy(false)
    }
  }

  async function onDirectory(event) {
    const files = [...event.target.files].filter((file) => MEDIA_RE.test(file.name) || SONG_RE.test(file.name) || KIT_RE.test(file.name))
    event.target.value = ''
    model.sessionFiles = files.slice(0, SESSION_FILES_MAX)
    model.dirTick = (model.dirTick || 0) + 1
    note(files.length > SESSION_FILES_MAX
      ? `Showing the first ${SESSION_FILES_MAX} of ${files.length} files from that folder. Open a smaller folder for the rest.`
      : `${files.length} files from that folder`)
    closeWindow()
  }

  async function linkFolder() {
    try {
      if (window.showDirectoryPicker) {
        const handle = await window.showDirectoryPicker({ mode: 'read' })
        await rememberDirectory(handle)
        model.dirTick = (model.dirTick || 0) + 1
        touch(false)
        note(`Linked ${plainName(handle.name) || 'that folder'}`)
        closeWindow()
        return
      }
      document.getElementById('mmm-dir')?.click()
    } catch (error) {
      if (error?.name === 'AbortError') return
      note(error.message || 'Could not link that folder')
    }
  }

  async function saveSong() {
    setBusy(true)
    beginUndo()
    const song = songId()
    try {
      const doc = await captureSong(songName)
      const stored = await storeSongFile(doc.name, doc)
      downloadSong(doc)
      if (!stored.persisted) {
        // The song is in IndexedDB, but the Songs list could not be written, so it is not kept.
        note(`${doc.name}.m1ya not saved: browser storage refused the write. The download started, so keep that file.`)
        return
      }
      if (!sameSong(song)) {
        // Another song was opened meanwhile: the file is saved, the session stays on the newer song.
        note(`${doc.name}.m1ya saved in Songs, download started`)
        closeWindow()
        return
      }
      model.songOrder = doc.order
      model.songName = doc.name
      model.songFile = stored.id
      model.songPlay = true
      note(`${doc.name}.m1ya saved in Songs, download started`)
      touch(true)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not save that song')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  async function saveKit() {
    setBusy(true)
    beginUndo()
    try {
      const doc = await captureKit(kitName)
      const stored = await storeKitFile(doc.name, doc)
      downloadKit(doc)
      if (!stored.persisted) {
        note(`${doc.name}.k1t not saved: browser storage refused the write. The download started, so keep that file.`)
        return
      }
      note(`${doc.name}.k1t saved in Kits, download started`)
      touch(true)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not save that kit')
    } finally {
      endUndo()
      setBusy(false)
    }
  }

  async function loadUri() {
    setBusy(true)
    try {
      await importSongUrl(ipfs)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not load that URI')
    } finally {
      setBusy(false)
    }
  }

  async function refreshWallet(address) {
    const who = (address || model.wallet || '').trim()
    if (!isAddress(who)) {
      note('Paste a 0x address, or use the wallet button')
      return
    }
    model.wallet = who
    const request = ++walletRequest
    stopKit()
    setKitAsk(false)
    if (walletFor !== who.toLowerCase()) clearPacks()
    walletFor = who.toLowerCase()
    note('Reading the wallet')
    setBusy(true)
    try {
      const result = await loadWalletPacks(who)
      if (request !== walletRequest) return
      model.nftPacks = result.packs
      model.nftLocked = result.locked
      model.nftUnknown = result.unknown || []
      model.nftPartial = !!result.partial
      const songs = await syncProfileSongs(who)
      if (request !== walletRequest) return
      note(walletSummary(result, songs))
    } catch (error) {
      if (request === walletRequest) note(error.message || 'Could not read that wallet')
    } finally {
      if (request === walletRequest) setBusy(false)
    }
  }

  async function keepRemote(url, name, toPad) {
    setBusy(true)
    try {
      if (toPad) await importRemote(url, model.selected, name)
      else await cacheRemote(url, name)
    } catch (error) {
      note(error.message || 'Could not read that file')
    } finally {
      setBusy(false)
    }
  }

  async function keepPicture(url, name, toPad) {
    setBusy(true)
    try {
      await importPictureUrl(url, name, { toPad, index: model.selected })
    } catch (error) {
      note(error.message || 'Could not read that picture')
    } finally {
      setBusy(false)
    }
  }

  async function makeKit() {
    const picks = kitPictures(model.nftPacks).picks
    if (!picks.length) {
      note('No png or jpg from a Milady collection in this read')
      return
    }
    kitAbort?.abort()
    const request = ++kitRequest
    const abort = new AbortController()
    kitAbort = abort
    const song = songId()
    setKitAsk(false)
    setKitBusy(true)
    try {
      const built = await pictureKitDoc(picks, {
        alive: () => request === kitRequest,
        signal: abort.signal,
        onEach: (pick, i) => {
          if (request !== kitRequest) return
          note(`Reading ${plainName(pick.name) || 'picture'} (${i + 1}/${picks.length})`)
        },
      })
      if (request !== kitRequest || built.cancelled) return
      if (!built.made) {
        note(built.error || 'None of those pictures could be read')
        return
      }
      const ok = await loadKitIfCurrent(built.doc, song)
      if (request !== kitRequest) return
      if (!ok) {
        note('The song changed. The kit was not replaced.')
        return
      }
      const extra = built.skipped ? ` ${built.skipped} could not be read${built.error ? `: ${built.error}` : ''}.` : ''
      note(`Milady kit loaded, ${built.made} pad${built.made === 1 ? '' : 's'}.${extra}`)
    } catch (error) {
      if (request === kitRequest) note(error.message || 'Could not make that kit')
    } finally {
      if (request === kitRequest) {
        if (kitAbort === abort) kitAbort = null
        setKitBusy(false)
      }
    }
  }

  async function makeVideo() {
    setBusy(true)
    try {
      setVideoTake(await readVideoLink(videoUrl))
    } catch (error) {
      note(error.message || 'Could not read that video')
    } finally {
      setBusy(false)
    }
  }

  function setImage(key, value) {
    const n = Number(value)
    setImageSet((cur) => ({ ...cur, [key]: Number.isFinite(n) ? n : cur[key] }))
  }

  async function makeImage() {
    if (!imageFile) return
    setBusy(true)
    try {
      await importImageFile(imageFile, imageSet)
      closeWindow()
    } catch (error) {
      note(error.message || 'Could not read that image')
    } finally {
      setBusy(false)
    }
  }

  const packs = model.nftPacks || []
  const locked = model.nftLocked || []
  const unknown = model.nftUnknown || []
  const kit = kitPictures(packs)

  return (
    <div className="mmm-file" ref={root}>
      <button
        type="button"
        className={`btn free-width ${menu ? 'on' : ''}`}
        aria-expanded={menu}
        aria-haspopup="menu"
        data-coach="file"
        onClick={() => setMenu((open) => !open)}
      >
        FILE
      </button>
      {menu && (
        <div className="file-menu" role="menu">
          <button type="button" onClick={() => openWindow('manual')}>Manual</button>
          <hr />
          <button type="button" onClick={() => openWindow('open')}>Open file…</button>
          <button type="button" onClick={() => openWindow('folder')}>Open folder…</button>
          <button type="button" onClick={() => openWindow('link')}>Load song link…</button>
          <button type="button" onClick={() => openWindow('wallet')}>Wallet…</button>
          <button type="button" onClick={() => openWindow('video')}>Video link…</button>
          <button type="button" onClick={() => openWindow('image')}>Image…</button>
          <hr />
          <button type="button" onClick={() => openWindow('song')}>Save song…</button>
          <button type="button" onClick={() => openWindow('kit')}>Save kit…</button>
        </div>
      )}
      <input id="mmm-import" hidden type="file" accept={ACCEPT} multiple onChange={onFiles} />
      <input
        id="mmm-dir"
        hidden
        type="file"
        multiple
        onChange={onDirectory}
        ref={(node) => {
          if (node) node.setAttribute('webkitdirectory', '')
        }}
      />
      {windowId === 'open' && (
        <Dialog title="Open file" onClose={closeWindow} busy={busy}>
          <p className="hint">Audio, video, a .m1ya song, or a .k1t kit. Songs and kits open into the project. A sound file lands on the selected pad and in Cache.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => document.getElementById('mmm-import')?.click()}>Choose files</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'folder' && (
        <Dialog title="Open folder" onClose={closeWindow} busy={busy}>
          <p className="hint">Link a folder of samples. The files stay where they are until you load one.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={linkFolder}>Link folder</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'link' && (
        <Dialog title="Load song link" onClose={closeWindow} busy={busy}>
          <p className="hint">An ipfs:// song URI, or an allowed IPFS gateway link.</p>
          <input className="field" aria-label="IPFS song URI" placeholder="ipfs://" value={ipfs} onChange={(e) => setIpfs(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={loadUri}>Load</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'wallet' && (
        <Dialog title="Wallet" onClose={closeWindow} busy={busy}>
          <p className="hint">Read a wallet for audio, video, and pictures on its tokens. A png or a jpg becomes a sample the same way Image does. Nothing is signed and nothing is sent.</p>
          <form
            className="dialog-actions"
            onSubmit={(e) => {
              e.preventDefault()
              refreshWallet()
            }}
          >
            <input
              className="field"
              aria-label="Wallet address"
              placeholder="0x wallet"
              value={model.wallet}
              onChange={(e) => {
                model.wallet = e.target.value
                // A different account: its packs are not the ones on screen, and a read in flight is stale.
                if (walletFor && e.target.value.trim().toLowerCase() !== walletFor) {
                  walletRequest += 1
                  stopKit()
                  walletFor = ''
                  clearPacks()
                  setKitAsk(false)
                  setBusy(false)
                }
                touch(false)
              }}
            />
            <button type="submit" className="btn" disabled={busy || kitBusy}>Read</button>
            <button
              type="button"
              className="btn"
              disabled={busy || kitBusy}
              onClick={() => requestAccount().then((account) => refreshWallet(account)).catch((error) => note(error.message))}
            >
              Wallet
            </button>
          </form>
          {locked.map((pack) => (
            <div key={pack.id} className="hint">{plainName(pack.name)} locked</div>
          ))}
          {unknown.map((pack) => (
            <div key={pack.id} className="hint">{plainName(pack.name)}: could not check this wallet</div>
          ))}
          {kit.total > 0 && (
            <>
              <p className="hint">
                {kit.total > kit.picks.length
                  ? `${kit.total} Milady pictures. A kit uses the first ${kit.picks.length}, about a second each.`
                  : `${kit.total} Milady picture${kit.total === 1 ? '' : 's'} can become a kit, about a second each.`}
                {' '}The kit you are editing is replaced.
              </p>
              {kitBusy && (
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      stopKit()
                      note('Kit cancelled. The kit you were editing is unchanged.')
                    }}
                  >
                    Cancel kit
                  </button>
                </div>
              )}
              {!kitAsk && !kitBusy && (
                <div className="dialog-actions">
                  <button type="button" className="btn" disabled={busy || kitBusy} onClick={() => setKitAsk(true)}>Make a kit</button>
                </div>
              )}
              {kitAsk && !kitBusy && (
                <div className="dialog-actions">
                  <button type="button" className="btn" disabled={busy || kitBusy} onClick={makeKit}>Replace kit</button>
                  <button type="button" className="btn" disabled={busy || kitBusy} onClick={() => setKitAsk(false)}>Cancel</button>
                </div>
              )}
            </>
          )}
          <div className="lib-list">
            {packs.map((pack) => (
              <div key={pack.id}>
                <div className="hint">{plainName(pack.name)}</div>
                {pack.tokens.map((token) => (
                  <div key={token.id}>
                    <div>{plainName(token.name)}</div>
                    {token.links.map((link) => (
                      <div key={link.url} className="dialog-actions">
                        <span className="hint">{plainName(link.name)}</span>
                        <button type="button" className="btn free-width" disabled={busy || kitBusy} onClick={() => (link.kind === 'image' ? keepPicture(link.url, plainName(token.name), false) : keepRemote(link.url, plainName(token.name), false))}>Cache</button>
                        <button type="button" className="btn free-width" disabled={busy || kitBusy} onClick={() => (link.kind === 'image' ? keepPicture(link.url, plainName(token.name), true) : keepRemote(link.url, plainName(token.name), true))}>Pad</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'video' && (
        <Dialog title={videoTake ? 'Video sample' : 'Video link'} onClose={closeWindow} busy={busy}>
          {isDesktopApp() && <p className="hint">{DESKTOP_VIDEO_NOTE}</p>}
          {!videoTake && !isDesktopApp() && (
            <>
              <input
                className="field"
                aria-label="Video link"
                placeholder="https://odysee.com/… or https://youtu.be/…"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
              <div className="dialog-actions">
                <button type="button" className="btn" disabled={busy || !videoUrl.trim()} onClick={makeVideo}>Read</button>
              </div>
            </>
          )}
          {videoTake && (
            <VideoTake take={videoTake} busy={busy} setBusy={setBusy} onDone={closeWindow} />
          )}
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'image' && (
        <Dialog title="Image to sample" onClose={closeWindow} busy={busy}>
          <p className="hint">Each column of the picture becomes a slice of the spectrum. The bottom is low and the top is high. Speed is columns per second. The sample stops at 16 seconds and lands in Cache.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => document.getElementById('mmm-image')?.click()}>Choose image</button>
            <span className="hint">{imageFile ? imageFile.name : 'No image yet'}</span>
          </div>
          <input
            id="mmm-image"
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => {
              setImageFile(e.target.files?.[0] || null)
              e.target.value = ''
            }}
          />
          <div className="image-settings">
            <label>Resolution<input className="field num" aria-label="Resolution" type="number" min={8} max={256} value={imageSet.columns} onChange={(e) => setImage('columns', e.target.value)} /></label>
            <label>Bins<input className="field num" aria-label="Bins" type="number" min={8} max={96} value={imageSet.bins} onChange={(e) => setImage('bins', e.target.value)} /></label>
            <label>Octave<input className="field num" aria-label="Octave" type="number" min={0} max={8} value={imageSet.octave} onChange={(e) => setImage('octave', e.target.value)} /></label>
            <label>Octaves<input className="field num" aria-label="Octaves" type="number" min={1} max={8} value={imageSet.octaves} onChange={(e) => setImage('octaves', e.target.value)} /></label>
            <label>Speed<input className="field num" aria-label="Speed" type="number" min={1} max={64} value={imageSet.speed} onChange={(e) => setImage('speed', e.target.value)} /></label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy || !imageFile} onClick={makeImage}>Generate</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'song' && (
        <Dialog title="Save song" onClose={closeWindow} busy={busy}>
          <p className="hint">Writes a .m1ya into Songs and downloads it. The file keeps the kit, the arrangement, and the samples that are on pads.</p>
          <input className="field" aria-label="Song name" placeholder="Song" value={songName} onChange={(e) => setSongName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={saveSong}>Save .m1ya</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
      {windowId === 'kit' && (
        <Dialog title="Save kit" onClose={closeWindow} busy={busy}>
          <p className="hint">Writes a .k1t of the pads and their samples into Kits, and downloads it.</p>
          <input className="field" aria-label="Kit name" placeholder="Kit" value={kitName} onChange={(e) => setKitName(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={saveKit}>Save .k1t</button>
          </div>
          <p className="hint">{model.browserNote}</p>
        </Dialog>
      )}
    </div>
  )
}

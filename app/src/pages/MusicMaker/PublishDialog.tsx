import { getAccount } from '@wagmi/core'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { type Chain, formatEther } from 'viem'
import { useAccount, useEnsName } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { plainTxError } from '@/miyamints/errors'
import { buildMusicMetadata, type MusicForm, validateAudioFile, validateImageFile } from '@/music/audio'
import { MUSIC_CHAINS } from '@/music/config'
import { storageWords, storedBytes } from '@/music/creatorWords'
import { parseAlignmentPct, parseEdition, parsePriceEth } from '@/music/drop'
import { useMusicChain } from '@/pages/DropMusic/useDropMusic'
import { space, text } from '@/theme/tokens'
import { isUnconfirmed } from '@/utils/batch'
import { FREE_BYTES, fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'
import { useStorageQuote } from '@/utils/useStorageQuote'

import { checkLaunch, type EditionLaunch, type EditionResult, launchEdition } from './launchEdition'
import {
  contentKey,
  defaultArtist,
  describeLaunch,
  discardChoice,
  firstCopyLabel,
  launchCommitted,
  moneyWords,
  pctWords,
  PLACEHOLDER_URIS,
  publishBpm,
  releaseBlocker,
  releaseSalt,
  SaidError,
} from './mintPlan'
import { requestFiles } from './publish.js'
import {
  browserStore,
  bumpReleaseRound,
  clearRelease,
  findReleases,
  knownUpload,
  lastUpload,
  loadRelease,
  rememberLastUpload,
  rememberUpload,
  releaseKey,
  releaseRound,
  type SavedRelease,
  saveRelease,
  watchProgress,
} from './releaseStore'

export type PublishJob = { intent: string; name: string; bpm: number }

const UNCONFIRMED =
  'The network has not confirmed this yet. It may still go through, so check your wallet or wait a minute. Try again waits on the same one and sends nothing new.'

/** Without a saved record a reload would not know what was sent, and could deploy a second collection. */
const SAVE_BLOCKED =
  'This browser would not save the release (a private window, or site data blocked), so nothing was uploaded or sent. Without that record a reload could make a second collection. Allow site data for this site, then try again.'

const OTHER_TAB =
  'This release is already running in another tab or window. Finish it there: nothing is sent from here.'

const Back = styled.div`
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: ${space[3]};
  background: rgba(90, 20, 102, 0.28);
`

const Card = styled.form`
  width: min(420px, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]};
  background: #fff6fb;
  color: #3a1248;
  box-shadow: 2px 2px 0 #5a1466;
  font-size: ${text.sm};
`

const Row = styled.label`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: ${text.xs};
`

const Field = styled.input`
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #5a1466;
  padding: 4px 6px;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  justify-content: flex-end;
`

const Btn = styled.button`
  font: inherit;
  cursor: pointer;
  border: 1px solid #5a1466;
  background: #f4b6d8;
  color: #3a1248;
  padding: 4px 10px;
  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`

const Note = styled.p`
  margin: 0;
  font-size: ${text.xs};
  word-break: break-word;
`

const Banner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  padding: ${space[2]};
  border: 1px dashed #5a1466;
  font-size: ${text.xs};
`

function plainCover(title: string): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const pen = canvas.getContext('2d')
  if (!pen) return Promise.reject(new SaidError('Could not draw a cover'))
  pen.fillStyle = '#f4b6d8'
  pen.fillRect(0, 0, 512, 512)
  pen.fillStyle = '#5a1466'
  pen.fillRect(36, 36, 440, 440)
  pen.fillStyle = '#fff6fb'
  pen.font = 'bold 42px sans-serif'
  const words = (title || 'Song').slice(0, 48).split(/\s+/)
  let line = ''
  let y = 180
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word
    if (pen.measureText(next).width > 360 && line) {
      pen.fillText(line, 64, y)
      y += 52
      line = word
    } else line = next
  })
  if (line) pen.fillText(line, 64, y)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new SaidError('Could not draw a cover'))
      else resolve(new File([blob], 'cover.png', { type: 'image/png' }))
    }, 'image/png')
  })
}

/** fundAndUpload's prompt words, said for this dialog: paying means the wallet goes to Ethereum first. */
function storageStatus(label: string, words: string) {
  if (/^Pay for storage/.test(words)) {
    return `${label}: switch to Ethereum and pay for storage in your wallet (paid once, in ETH on Ethereum). The wallet comes back here after.`
  }
  return `${label}: ${words}`
}

// ---------------------------------------------------------------------------------------------------------------
// Kept past the dialog closing, for this tab: a wallet prompt still open goes on answering into them, and reopening
// the dialog joins the same run instead of starting another.

type Run = { promise: Promise<EditionResult>; status: string; listeners: Set<(words: string) => void> }

/** Releases running in this tab, by release key (account, chain, content). Set before the first upload. */
const runs = new Map<string, Run>()
/** The records those runs (and any adopted from storage) write into, saved on every change. */
const live = new Map<string, SavedRelease>()
/** Uploads still going, by content key, so two dialogs never pay for the same bytes at once. */
const uploading = new Map<string, Promise<string>>()

const keyOf = (r: Pick<SavedRelease, 'account' | 'chainId' | 'content'>) => releaseKey(r.account, r.chainId, r.content)

function say(key: string, words: string) {
  const run = runs.get(key)
  if (!run) return
  run.status = words
  run.listeners.forEach((listen) => listen(words))
}

/** The record under way, saved again every time its progress changes. */
function track(record: SavedRelease): SavedRelease {
  const key = keyOf(record)
  const known = live.get(key)
  if (known) return known
  record.progress = watchProgress(record.progress, () => {
    record.savedAt = Date.now()
    saveRelease(browserStore(), record)
  })
  live.set(key, record)
  return record
}

/** Saves the record now and says whether it really is saved. */
function saveNow(record: SavedRelease) {
  record.savedAt = Date.now()
  return saveRelease(browserStore(), record)
}

function forget(record: SavedRelease) {
  live.delete(keyOf(record))
  clearRelease(browserStore(), record.account, record.chainId, record.content)
}

/** Releases this wallet left under way on this chain: the ones in this tab first, then the saved ones. */
function pendingReleases(account: string, chainId: number): SavedRelease[] {
  const at = releaseKey(account, chainId, '')
  const here = Array.from(live).filter(([key]) => key.startsWith(at)).map(([, r]) => r)
  const saved = findReleases(browserStore(), account, chainId).filter((r) => !live.has(keyOf(r)))
  return [...here, ...saved]
}

/** One run of a release at a time across tabs too, when the browser can say (Web Locks). */
function acrossTabs<T>(key: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return work()
  return locks.request(`miya-music-release:${key}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new SaidError(OTHER_TAB)
    return work()
  }) as Promise<T>
}

async function upload(file: File, kind: string, chain: Chain | undefined, status: (words: string) => void) {
  const tx = await fundAndUpload(
    file,
    [
      { name: 'Content-Type', value: file.type || 'application/octet-stream' },
      { name: 'application-id', value: 'MiyaOS' },
      { name: 'miya-kind', value: kind },
    ],
    undefined,
    getIrysToken(chain?.id || 1),
    chain,
    status
  )
  return `ar://${tx}`
}

/**
 * Stores a file once: an upload of the same bytes already done (kept in storage by content key) or still going is
 * reused, so nothing is paid for twice, even after a close or a reload. `intent` remembers it as that job's last
 * upload, so one that finishes after the dialog closed is shown when it opens again.
 */
async function storeFile(
  file: File,
  kind: string,
  chain: Chain | undefined,
  status: (words: string) => void,
  intent?: string
): Promise<{ key: string; uri: string }> {
  const key = await contentKey(kind, file)
  const known = knownUpload(browserStore(), key)
  if (known) return { key, uri: known }
  let under = uploading.get(key)
  if (!under) {
    under = upload(file, kind, chain, status)
      .then((uri) => {
        rememberUpload(browserStore(), key, uri)
        if (intent) rememberLastUpload(browserStore(), intent, uri)
        return uri
      })
      .finally(() => uploading.delete(key))
    uploading.set(key, under)
  }
  return { key, uri: await under }
}

/** The fields the release was sealed with, as the form shows them. Older records carry only the launch. */
function sealedForm(r: SavedRelease) {
  const { launch } = r
  return {
    artist: r.form?.artist ?? '',
    supply: r.form?.supply ?? (launch.supply ? String(launch.supply) : ''),
    rise: r.form?.rise ?? (launch.rate ? String(Number(launch.rate) / 100) : ''),
    cover: r.form?.cover ?? '',
  }
}

type Files = Awaited<ReturnType<typeof requestFiles>>

// ---------------------------------------------------------------------------------------------------------------

export default function PublishDialog({ job, onClose }: { job: PublishJob; onClose: () => void }) {
  const mint = job.intent.startsWith('mint-')
  const { address, chain } = useAccount()
  const ens = useEnsName({ address, chainId: 1, query: { enabled: mint && !!address, staleTime: 3_600_000 } })
  const music = useMusicChain()
  const [title, setTitle] = useState(job.name || 'Song')
  const [artist, setArtist] = useState('')
  const [price, setPrice] = useState('0.01')
  const [supply, setSupply] = useState('')
  const [rise, setRise] = useState('')
  const [cover, setCover] = useState<File | null>(null)
  const [coverName, setCoverName] = useState('')
  const [mintFirst, setMintFirst] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [releasedAt, setReleasedAt] = useState<string>()
  // The release under way: what has gone to the chain with exactly what it was built from. Saved in the browser on
  // every change, so closing the dialog or the window keeps it, and reopening carries on from it.
  const record = useRef<SavedRelease>()
  // A release picked up from before is fixed as it was saved, until it is finished or dropped.
  const resumed = useRef(false)
  // The bounce and the file, made once: the price is shown from them, and a retry hands the same bytes to the cache.
  const bounced = useRef<Promise<Files>>()
  const [files, setFiles] = useState<{ content?: string; sizes: { key: string; size: number }[] }>()
  const [following, setFollowing] = useState<string>()
  // A release of other content this wallet left under way: shown, never forced on this one.
  const [other, setOther] = useState<SavedRelease>()
  const [committed, setCommitted] = useState(false)
  const [released, setReleased] = useState(false)
  const [, redraw] = useState(0)
  const artistName = artist.trim() || defaultArtist(ens.data, address)
  const pricedNow = parsePriceEth(price)
  const editionNow = parseEdition(supply, rise)
  const { current } = record
  const sealed = committed ? current?.launch : undefined
  const instance = releasedAt || current?.progress.instance
  const store = browserStore()

  const bounce = () => {
    if (!bounced.current) {
      bounced.current = requestFiles(job.intent)
      bounced.current.catch(() => {
        bounced.current = undefined
      })
    }
    return bounced.current
  }

  // Made on opening, so what storing it costs is known before anything is pressed.
  useEffect(() => {
    let gone = false
    bounce()
      .then(async (built) => {
        const parts: { file?: File; kind: string }[] = mint
          ? [
              { file: built.audio, kind: 'bounce' },
              { file: built.pack, kind: built.packKind },
            ]
          : [{ file: job.intent === 'upload-bounce' ? built.audio : built.pack, kind: job.intent === 'upload-bounce' ? 'bounce' : built.packKind }]
        const sizes = await Promise.all(
          parts
            .filter((p): p is { file: File; kind: string } => !!p.file)
            .map(async (p) => ({ key: await contentKey(p.kind, p.file), size: p.file.size }))
        )
        const content = built.pack ? await contentKey(built.packKind, built.pack) : undefined
        if (!gone) setFiles({ content, sizes })
      })
      .catch(() => {
        if (!gone) setFiles({ sizes: [] })
      })
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only what is not on Arweave yet costs anything. The cover is the picked file, or a small drawn one (free).
  const toStore = [
    ...(files?.sizes || []).filter((s) => !knownUpload(store, s.key)).map((s) => s.size),
    ...(mint && cover && !committed ? [cover.size] : []),
  ]
  const quote = useStorageQuote(files && !committed && !released ? storedBytes(toStore, FREE_BYTES) || 1 : undefined)
  const costLine = files
    ? `${storageWords(quote)} Storage is paid in ETH on Ethereum (mainnet), whatever network you release on. Files under about 90 KB are free.`
    : 'Preparing the files to price their storage…'

  // The status of the run this dialog follows, including one started before it was opened.
  useEffect(() => {
    if (!following) return undefined
    const run = runs.get(following)
    if (!run) return undefined
    const listen = (words: string) => {
      setStatus(words)
      redraw((n) => n + 1)
    }
    run.listeners.add(listen)
    if (run.status) setStatus(run.status)
    return () => {
      run.listeners.delete(listen)
    }
  }, [following])

  const adopt = (found: SavedRelease) => {
    const rec = track(found)
    const isSealed = rec.sealed !== false && launchCommitted(rec.progress)
    record.current = rec
    resumed.current = isSealed
    setCommitted(isSealed)
    setOther(undefined)
    const form = sealedForm(rec)
    setTitle(rec.launch.title)
    if (form.artist) setArtist(form.artist)
    setPrice(formatEther(rec.launch.priceWei))
    setSupply(form.supply)
    setRise(form.rise)
    setCoverName(form.cover)
    setMintFirst(rec.launch.mintFirst)
    setLinks(rec.links)
  }

  const errorWords = (e: unknown) => {
    const said = e as { plain?: boolean; message?: string } | undefined
    if (said?.plain && said.message) return said.message
    if (isUnconfirmed(e)) return UNCONFIRMED
    return plainTxError(e)
  }

  const finished = (done: EditionResult) => {
    setReleasedAt(done.instance)
    setReleased(true)
    setStatus(done.minted ? 'Edition is live and the first copy is in this wallet.' : 'Edition is live.')
  }

  /** Waits on a run of this release still going from an earlier opening of the dialog. Nothing new is sent. */
  const join = async (key: string) => {
    const run = runs.get(key)
    if (!run) return
    setBusy(true)
    setFollowing(key)
    setStatus(run.status || 'Still working on this release from before. Nothing new is sent.')
    try {
      finished(await run.promise)
    } catch (e) {
      setError(errorWords(e))
      setStatus('')
    } finally {
      setBusy(false)
      setCommitted(!!record.current && launchCommitted(record.current.progress))
    }
  }

  // Opening, or switching wallets: pick up a release this wallet left under way on this chain. Only one of this
  // same content is taken on; another is shown in a banner to continue or discard.
  useEffect(() => {
    if (!mint || !address || busy || !files) return
    if (record.current && record.current.account.toLowerCase() !== address.toLowerCase()) {
      // Another wallet's release: it stays saved for that wallet. This one starts from its own.
      record.current = undefined
      resumed.current = false
      setCommitted(false)
      setLinks([])
    }
    if (record.current) return

    const pending = pendingReleases(address, music.cfg.chainId)
    const same = files.content && pending.find((r) => r.content === files.content)
    if (same) {
      adopt(same)
      void join(keyOf(same))
      return
    }
    setOther(pending.find((r) => launchCommitted(r.progress) || runs.has(keyOf(r))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, address, music.cfg.chainId, files])

  // A wallet that never answers must not hold the dialog open: after a while it can be closed, and the release waits.
  useEffect(() => {
    setStuck(false)
    if (!busy) return undefined
    const timer = setTimeout(() => setStuck(true), 45_000)
    return () => clearTimeout(timer)
  }, [busy])

  const closable = !busy || stuck

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !closable) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closable, onClose])

  const sent = current?.progress
  const waiting = !!sent && !!(sent.batchId || sent.deployHash || sent.editionHash || sent.mintHash)
  let mintLabel = committed || error ? 'Try again' : 'Mint'
  if (resumed.current) mintLabel = waiting ? 'Check status' : 'Continue'

  const runUpload = async () => {
    setBusy(true)
    setError('')
    setStatus('Preparing the file…')
    try {
      const built = await bounce()
      const file = job.intent === 'upload-bounce' ? built.audio : built.pack
      if (!file) throw new SaidError('Nothing to upload')
      const kind = job.intent === 'upload-bounce' ? 'bounce' : built.packKind
      const label = job.intent === 'upload-bounce' ? 'The bounce' : `The ${built.packKind}`
      setStatus(`Uploading ${label.toLowerCase()} to Arweave…`)
      const { uri } = await storeFile(file, kind, chain, (words) => setStatus(storageStatus(label, words)), job.intent)
      rememberLastUpload(store, job.intent, uri)
      setLinks([uri])
      setStatus('On Arweave, public and permanent.')
    } catch (e) {
      setError(plainTxError(e, 'The upload did not finish. Anything already paid for is kept: try again.'))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  /** Carries on with a release whose record exists, in this tab's run list and under the cross-tab lock. */
  const start = (rec: SavedRelease, seal?: () => Promise<void>) => {
    const key = keyOf(rec)
    const run: Run = { promise: Promise.resolve() as never, status: '', listeners: new Set() }
    runs.set(key, run)
    run.promise = acrossTabs(key, async () => {
      if (rec.sealed === false) {
        if (!seal) throw new SaidError('This release did not finish uploading. Press Mint to finish it: nothing is paid twice.')
        await seal()
      }
      // Paying for storage can take the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
      if (getAccount(wagmiConfig).chainId !== rec.launch.chainId) {
        throw new SaidError(
          `Your wallet is on another network. Switch back to ${music.cfg.name}, then try again. Your uploads are kept.`
        )
      }
      say(key, rec.progress.instance ? 'Confirm the next step in your wallet.' : 'Confirm the edition in your wallet.')
      const done = await launchEdition(rec.launch, rec.progress, {
        onDeployed: (at) => say(key, `Collection is live at ${at}. Confirm the next step in your wallet.`),
        beforeAsk: () => {
          if (!saveNow(rec)) throw new SaidError(SAVE_BLOCKED)
        },
      })
      // Finished: nothing is left to resume.
      forget(rec)
      return done
    }).finally(() => {
      if (runs.get(key) === run) runs.delete(key)
    })
    run.promise.catch(() => undefined)
    setFollowing(key)
    return run.promise
  }

  /**
   * Checks everything that can be checked, then registers the release (before the first upload is paid for), then
   * uploads and sends. If this exact song or kit already has a release running or under way, that one is joined or
   * carried on instead.
   */
  const fresh = async (account: `0x${string}`): Promise<EditionResult | undefined> => {
    const openChain = MUSIC_CHAINS.find((c) => c.factory && c.vault)?.name
    const blocked = releaseBlocker({
      connected: true,
      wrongChain: music.wrongChain || chain?.id !== music.cfg.chainId,
      deployed: !!music.cfg.factory && !!music.cfg.vault,
      chainName: music.cfg.name,
      openChain: openChain !== music.cfg.name ? openChain : undefined,
    })
    if (blocked) throw new SaidError(blocked)
    if (!music.ready || !music.cfg.factory || !music.cfg.vault)
      throw new SaidError('Music drops are not open here yet. Nothing was charged.')
    const minBps = music.minAlignmentBps
    const feeBps = music.protocolFeeBps
    if (!music.rulesKnown || minBps === undefined || feeBps === undefined)
      throw new SaidError('The vault share and fee are still being read from the network. Try again in a moment. Nothing was charged.')
    const { factory, vault } = music.cfg
    const chainId = music.cfg.chainId
    const priced = parsePriceEth(price)
    if (!priced.ok) throw new SaidError(priced.error)
    const edition = parseEdition(supply, rise)
    if (!edition.ok) throw new SaidError(edition.error)
    const alignment = parseAlignmentPct(String(minBps / 100), minBps, feeBps)
    if (!alignment.ok) throw new SaidError(alignment.error)
    if (!artistName) throw new SaidError('Add an artist name.')

    setStatus('Bouncing and packing…')
    const built = await bounce()
    const { audio, pack } = built
    if (!audio || !pack) throw new SaidError('Could not prepare the bounce and the file')
    const audioCheck = validateAudioFile(audio)
    if (!audioCheck.ok) throw new SaidError(audioCheck.error)
    const picture = cover || (await plainCover(title))
    const imageCheck = validateImageFile(picture)
    if (!imageCheck.ok) throw new SaidError(imageCheck.error)

    const form = (uris: { audio: string; image: string; pack: string }): MusicForm => ({
      title,
      artist: artistName,
      image: uris.image,
      audio: uris.audio,
      mime: 'audio/wav',
      duration: built.duration || 1,
      bpm: publishBpm(job.bpm),
      song: built.packKind === 'song' ? uris.pack : undefined,
      kit: built.packKind === 'kit' ? uris.pack : undefined,
      description: built.packKind === 'kit' ? 'A MiyaMusicMaker kit.' : 'A MiyaMusicMaker song.',
    })
    // The same checks the real metadata gets, with stand-in links, before the first upload is paid for.
    const trial = buildMusicMetadata(form(PLACEHOLDER_URIS))
    if (!trial.ok) throw new SaidError(Object.values(trial.errors)[0] || 'Check the mint fields.')
    setStatus('Checking the release with the network…')
    await checkLaunch({ account, chainId, factory, vault, name: title, alignmentBps: alignment.bps })

    // From here to start() nothing waits, so two openings can't both get past the check below.
    const content = await contentKey(built.packKind, pack)
    const key = releaseKey(account, chainId, content)
    if (runs.has(key)) {
      const earlier = live.get(key)
      if (earlier) adopt(earlier)
      await join(key)
      return undefined
    }

    const earlier = live.get(key) ?? loadRelease(store, account, chainId, content)
    if (earlier && launchCommitted(earlier.progress)) {
      adopt(earlier)
      setStatus('This one is already being released. Carrying on with that release instead of starting another.')
      return start(record.current!)
    }

    // A different song or kit replaces one that never reached the chain.
    const now = record.current
    if (now && keyOf(now) !== key && !launchCommitted(now.progress)) forget(now)

    const launch: EditionLaunch = {
      account,
      chainId,
      factory,
      vault,
      name: title,
      title,
      metadataURI: '',
      priceWei: priced.wei,
      supply: edition.supply,
      model: edition.model,
      rate: edition.rate,
      alignmentBps: alignment.bps,
      mintFirst,
    }
    // Uploads done before (this release, or the same bytes any time) are reused, not paid again.
    const rec = track(
      earlier ?? {
        account,
        chainId,
        content,
        intent: job.intent,
        launch,
        links: [],
        uploads: {},
        progress: {},
        savedAt: Date.now(),
      }
    )
    // Same content, nothing on chain: what the fields say now is what gets sealed. The salt comes from the wallet and
    // the content, so a reload or a lost record still makes only the one collection.
    Object.assign(rec, {
      launch,
      intent: job.intent,
      sealed: false,
      form: { artist: artistName, supply, rise, cover: cover ? cover.name : 'a plain cover with the title' },
    })
    rec.progress.salt ??= releaseSalt(factory, account, chainId, content, releaseRound(store, account, chainId, content))
    record.current = rec
    if (!saveNow(rec)) throw new SaidError(SAVE_BLOCKED)

    const seal = async () => {
      const put = async (file: File, kind: string, label: string) => {
        say(key, `Uploading ${label.toLowerCase()}…`)
        const stored = await storeFile(file, kind, chain, (words) => say(key, storageStatus(label, words)))
        rec.uploads = { ...rec.uploads, [stored.key]: stored.uri }
        saveNow(rec)
        return stored.uri
      }
      const audioUri = await put(audio, 'bounce', 'The bounce')
      const imageUri = await put(picture, 'cover', 'The cover')
      const packUri = await put(pack, built.packKind, built.packKind === 'kit' ? 'The kit' : 'The song')
      const meta = buildMusicMetadata(form({ audio: audioUri, image: imageUri, pack: packUri }))
      if (!meta.ok) throw new SaidError(Object.values(meta.errors)[0] || 'Check the mint fields.')
      const metadataFile = new File([JSON.stringify(meta.metadata)], 'metadata.json', { type: 'application/json' })
      const metadataUri = await put(metadataFile, 'metadata', 'The token metadata')
      rec.launch = { ...rec.launch, metadataURI: metadataUri }
      rec.links = [audioUri, packUri, metadataUri]
      rec.sealed = true
      if (!saveNow(rec)) throw new SaidError(SAVE_BLOCKED)
    }

    return start(rec, seal)
  }

  const runMint = async () => {
    setBusy(true)
    setError('')
    try {
      if (!address) throw new SaidError('Connect a wallet first.')
      const now = record.current
      let done: EditionResult | undefined
      if (now && (resumed.current || launchCommitted(now.progress))) {
        // Once something is on the chain the release is fixed: carry on with exactly what was sent.
        if (now.account.toLowerCase() !== address.toLowerCase()) {
          throw new SaidError('This release was started from another wallet. Switch back to it to finish.')
        }
        if (chain?.id !== now.chainId) throw new SaidError(`Switch to ${music.cfg.name} to finish the release.`)
        if (runs.has(keyOf(now))) {
          await join(keyOf(now))
          return
        }
        setLinks(now.links)
        done = await start(now)
      } else {
        setLinks([])
        done = await fresh(address)
      }
      if (done) finished(done)
    } catch (e) {
      setError(errorWords(e))
      setStatus('')
    } finally {
      setBusy(false)
      const rec = record.current
      if (rec) {
        setLinks(rec.links)
        setCommitted(resumed.current || launchCommitted(rec.progress))
      }
    }
  }

  /**
   * Drops a release: freely once nothing sent is still out, or anyway (after a warning) when what was sent was
   * dropped or has had no ending for a long time. A collection already live stays on chain.
   */
  const discard = (target: SavedRelease) => {
    const choice = discardChoice(target.progress, Date.now())
    if (choice === 'no' || runs.has(keyOf(target))) return
    const live_ = target.progress.instance
    const warn = [
      choice === 'anyway'
        ? 'Something sent for this release never had an ending here. If it still goes through, it can still create the collection or edition, or mint the copy, and this window will not know.'
        : '',
      live_
        ? `The collection at ${live_} stays on chain: discarding only forgets this release here. A new release of this makes a new collection.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    // eslint-disable-next-line no-alert
    if (warn && !window.confirm(`${warn} Discard it?`)) return
    if (launchCommitted(target.progress)) {
      bumpReleaseRound(store, target.account, target.chainId, target.content, releaseRound(store, target.account, target.chainId, target.content))
    }
    forget(target)
    if (record.current === target) {
      record.current = undefined
      resumed.current = false
      setCommitted(false)
      setLinks([])
    }
    if (other === target) setOther(undefined)
    setError('')
    setStatus(live_ ? `Dropped here. The collection at ${live_} stays on chain.` : 'Dropped. The next release starts fresh.')
    redraw((n) => n + 1)
  }

  const discardWords = (target: SavedRelease) => {
    const choice = discardChoice(target.progress, Date.now())
    if (choice === 'no') return ''
    return choice === 'anyway' ? 'Discard anyway' : 'Discard this release'
  }

  const kind = job.intent === 'mint-kit' || job.intent === 'upload-kit' ? 'kit' : 'song'
  const alignmentBps = sealed ? sealed.alignmentBps : music.minAlignmentBps
  const rising = sealed ? sealed.rate > 0n : editionNow.ok && editionNow.rate > 0n
  const last = !mint ? lastUpload(store, job.intent) : undefined
  const recordSaved = !!current && !!loadRelease(store, current.account, current.chainId, current.content)
  const blockedRules = mint && !committed && !music.rulesKnown

  return (
    <Back
      role="presentation"
      onMouseDown={() => {
        if (closable) onClose()
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="mmm-publish-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && !(mint && released)) void (mint ? runMint() : runUpload())
        }}
      >
        <strong id="mmm-publish-title">{mint ? (job.intent === 'mint-kit' ? 'Mint kit' : 'Mint song') : 'Publish to Arweave'}</strong>
        {mint && other && !current && (
          <Banner>
            <span>
              This wallet has another release under way, “{other.launch.title}”:{' '}
              {describeLaunch(other.progress, other.launch.mintFirst)}.
            </span>
            <Actions>
              {discardWords(other) && !runs.has(keyOf(other)) && (
                <Btn type="button" disabled={busy} onClick={() => discard(other)}>
                  {discardWords(other)}
                </Btn>
              )}
              <Btn
                type="button"
                disabled={busy}
                onClick={() => {
                  adopt(other)
                  void join(keyOf(other))
                }}
              >
                Continue that release
              </Btn>
            </Actions>
          </Banner>
        )}
        {mint ? (
          <>
            <Row>
              Title
              <Field aria-label="Title" value={title} disabled={committed} onChange={(e) => setTitle(e.target.value)} />
            </Row>
            <Row>
              Artist
              <Field
                aria-label="Artist"
                value={artist}
                placeholder={defaultArtist(ens.data, address) || 'Your name'}
                disabled={committed}
                onChange={(e) => setArtist(e.target.value)}
              />
            </Row>
            <Row>
              Price in ETH
              <Field aria-label="Price" value={price} disabled={committed} onChange={(e) => setPrice(e.target.value)} />
            </Row>
            <Row>
              Supply
              <Field
                aria-label="Supply"
                value={supply}
                placeholder="Blank is an open edition"
                disabled={committed}
                onChange={(e) => setSupply(e.target.value)}
              />
            </Row>
            <Row>
              Price rise each mint, in percent
              <Field
                aria-label="Price rise"
                value={rise}
                placeholder="Blank stays flat. 1 raises 1% each mint."
                disabled={committed}
                onChange={(e) => setRise(e.target.value)}
              />
            </Row>
            {committed ? (
              <Note>Cover: {coverName || 'as uploaded'}</Note>
            ) : (
              <Row>
                Cover
                <Field
                  aria-label="Cover image"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) => {
                    setCover(e.target.files?.[0] || null)
                    setCoverName(e.target.files?.[0]?.name || '')
                  }}
                />
              </Row>
            )}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: text.xs }}>
              <input
                type="checkbox"
                checked={sealed ? sealed.mintFirst : mintFirst}
                disabled={committed}
                onChange={(e) => setMintFirst(e.target.checked)}
              />
              {firstCopyLabel(sealed ? sealed.priceWei : pricedNow.ok ? pricedNow.wei : undefined, rising)}
            </label>
            <Note>
              {music.rulesKnown && alignmentBps !== undefined && music.protocolFeeBps !== undefined
                ? moneyWords(alignmentBps, music.protocolFeeBps)
                : sealed
                  ? `Sales stay in the collection until you withdraw them. On each withdrawal ${pctWords(sealed.alignmentBps)} goes to the community vault, plus the miya fee (still being read). You keep the rest.`
                  : 'Reading the vault share and fee from the network… Mint waits for them.'}
            </Note>
            <Note>
              The bounce plays in miya radio. The {kind} file is stored beside it so it can be opened again. Both are
              public and permanent on Arweave, and the {kind} file holds every sample in it, mic recordings too.
              {music.wrongChain ? ` Switch to ${music.cfg.name} before releasing.` : ''}
            </Note>
            {!committed && !released && <Note>{costLine}</Note>}
          </>
        ) : (
          <>
            <Note>
              <strong>Public and permanent.</strong>{' '}
              {job.intent === 'upload-bounce'
                ? 'Anyone can find and play the bounce, and it can never be deleted.'
                : `Anyone can download this ${kind}, it can never be deleted, and it includes every sample in it, mic recordings too.`}
            </Note>
            {!links.length && <Note>{costLine}</Note>}
            {last && !links.length && (
              <Note>
                Your last upload of this kind finished ({new Date(last.at).toLocaleString()}): {last.uri}
              </Note>
            )}
          </>
        )}
        {mint && current && committed && !released && (
          <Note>
            A release of “{current.launch.title}” is in progress: {describeLaunch(current.progress, current.launch.mintFirst)}.{' '}
            {waiting || current.progress.asking
              ? 'Check status waits on what was sent and sends nothing new.'
              : 'Continue carries on from there.'}
          </Note>
        )}
        {status && <Note>{status}</Note>}
        {busy && stuck && (
          <Note>
            {recordSaved
              ? 'This is taking a while. You can close this window: the release stays saved and resumes when you reopen.'
              : 'This is taking a while. You can close this window: it keeps going in this tab, and reopening shows where it is.'}
          </Note>
        )}
        {error && (
          <Note role="alert" style={{ color: '#8a1030' }}>
            {error}
          </Note>
        )}
        {links.map((uri) => (
          <Note key={uri}>{uri}</Note>
        ))}
        {instance && <Note>Collection: {instance}</Note>}
        {mint && current && committed && !released && !busy && discardChoice(current.progress, Date.now()) === 'anyway' && (
          <Note>
            What was sent has had no ending for a long time, or the wallet replaced it. Discard anyway only if your
            wallet shows it is gone.
          </Note>
        )}
        <Actions>
          {mint && current && committed && !released && !busy && discardWords(current) && (
            <Btn type="button" onClick={() => discard(current)}>
              {discardWords(current)}
            </Btn>
          )}
          <Btn type="button" onClick={onClose} disabled={!closable}>
            Close
          </Btn>
          <Btn type="submit" disabled={busy || (mint && (!title.trim() || released || blockedRules))}>
            {busy ? 'Working…' : mint ? (released ? 'Released' : mintLabel) : 'Upload'}
          </Btn>
        </Actions>
      </Card>
    </Back>
  )
}

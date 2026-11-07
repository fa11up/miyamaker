import { getAccount } from '@wagmi/core'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { type Address, type Chain, formatEther } from 'viem'
import { useAccount, useEnsName } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { buildMusicMetadata, type MusicForm, validateAudioFile, validateImageFile } from '@/music/audio'
import { MUSIC_CHAINS } from '@/music/config'
import { parseAlignmentPct, parseEdition, parsePriceEth } from '@/music/drop'
import { useMusicChain } from '@/pages/DropMusic/useDropMusic'
import { plainTxError } from '@/miyamints/errors'
import { space, text } from '@/theme/tokens'
import { isUnconfirmed } from '@/utils/batch'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

import { checkLaunch, type EditionLaunch, launchEdition } from './launchEdition'
import {
  contentKey,
  defaultArtist,
  describeLaunch,
  firstCopyLabel,
  launchCommitted,
  launchUnsettled,
  PLACEHOLDER_URIS,
  publishBpm,
  releaseBlocker,
} from './mintPlan'
import { requestFiles } from './publish.js'
import {
  browserStore,
  clearRelease,
  findReleases,
  loadRelease,
  releaseKey,
  type SavedRelease,
  saveRelease,
  watchProgress,
} from './releaseStore'

export type PublishJob = { intent: string; name: string; bpm: number }

const UNCONFIRMED =
  'The network has not confirmed this yet. It may still go through, so check your wallet or wait a minute. Try again waits on the same one and sends nothing new.'

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
  word-break: break-all;
`

function plainCover(title: string): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const pen = canvas.getContext('2d')
  if (!pen) return Promise.reject(new Error('Could not draw a cover'))
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
      if (!blob) reject(new Error('Could not draw a cover'))
      else resolve(new File([blob], 'cover.png', { type: 'image/png' }))
    }, 'image/png')
  })
}

async function upload(file: File, kind: string, chain: Chain | undefined) {
  const tx = await fundAndUpload(
    file,
    [
      { name: 'Content-Type', value: file.type || 'application/octet-stream' },
      { name: 'application-id', value: 'MiyaOS' },
      { name: 'miya-kind', value: kind },
    ],
    undefined,
    getIrysToken(chain?.id || 1),
    chain
  )
  return `ar://${tx}`
}

type Prepared =
  | { kind: 'fresh'; content: string; sealed: { launch: Omit<EditionLaunch, 'mintFirst'>; links: string[] } }
  | { kind: 'resume'; found: SavedRelease }

// Releases started in this tab, kept past the dialog closing: a wallet prompt still open goes on answering into
// them, and reopening the dialog joins the same one instead of starting another.
const live = new Map<string, SavedRelease>()
const running = new Map<string, Promise<unknown>>()

/** How long the dialog stays locked on one wallet answer before it can be closed anyway. */
const STUCK_MS = 45_000

const keyOf = (r: Pick<SavedRelease, 'account' | 'chainId' | 'content'>) => releaseKey(r.account, r.chainId, r.content)

/** The record under way, saved again every time its progress changes. */
function track(record: SavedRelease): SavedRelease {
  const key = keyOf(record)
  const known = live.get(key)
  if (known) return known
  const save = () => {
    record.savedAt = Date.now()
    saveRelease(browserStore(), record)
  }

  record.progress = watchProgress(record.progress, save)
  live.set(key, record)
  save()
  return record
}

function forget(record: SavedRelease) {
  live.delete(keyOf(record))
  clearRelease(browserStore(), record.account, record.chainId, record.content)
}

/** A release left under way for this wallet and chain: one still running in this tab first, then the saved ones. */
function pendingRelease(account: string, chainId: number): SavedRelease | undefined {
  const at = releaseKey(account, chainId, '')
  const here = Array.from(live).find(([key]) => key.startsWith(at))?.[1]
  if (here) return here
  const [saved] = findReleases(browserStore(), account, chainId)
  return saved && track(saved)
}

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
  const [mintFirst, setMintFirst] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [instance, setInstance] = useState<Address>()
  // Uploads by their exact bytes, so a failed attempt is retried without paying for anything twice.
  const uploads = useRef(new Map<string, string>())
  // The release under way: what has gone to the chain with exactly what it was built from. It is saved in the
  // browser on every change, so closing the dialog or the window keeps it, and reopening carries on from it.
  const record = useRef<SavedRelease>()
  // A release picked up from before is fixed as it was saved, until it is finished or dropped.
  const resumed = useRef(false)
  // The bounce and the file, made once: a retry hands the same bytes to the upload cache.
  const bounced = useRef<Promise<Awaited<ReturnType<typeof requestFiles>>>>()
  const [committed, setCommitted] = useState(false)
  const [released, setReleased] = useState(false)
  const [, redraw] = useState(0)
  const artistName = artist.trim() || defaultArtist(ens.data, address)
  const pricedNow = parsePriceEth(price)
  const { current } = record
  const sealed = committed ? current?.launch : undefined
  const unsettled = !!current && launchUnsettled(current.progress)

  const adopt = (found: SavedRelease) => {
    record.current = found
    Object.entries(found.uploads || {}).forEach(([key, uri]) => uploads.current.set(key, uri))
    resumed.current = true
    setCommitted(true)
    setTitle(found.launch.title)
    setPrice(formatEther(found.launch.priceWei))
    setMintFirst(found.launch.mintFirst)
    setLinks(found.links)
    setInstance(found.progress.instance)
  }

  /** Waits on a run of this release that is still going from an earlier opening of the dialog. */
  const join = async (found: SavedRelease) => {
    const run = running.get(keyOf(found))
    if (!run) return
    setBusy(true)
    setStatus('Still waiting on the wallet from before. Nothing new is sent.')
    try {
      await run
      setStatus('')
    } catch (e) {
      setError(isUnconfirmed(e) ? UNCONFIRMED : plainTxError(e))
      setStatus('')
    } finally {
      setBusy(false)
      setInstance(found.progress.instance)
      if (!live.has(keyOf(found))) {
        setReleased(true)
        setStatus('Edition is live.')
      }
    }
  }

  // Opening, or switching wallets: pick up a release this wallet left under way on this chain.
  useEffect(() => {
    if (!mint || !address || busy) return
    if (record.current?.account.toLowerCase() === address.toLowerCase()) return
    if (record.current) {
      // Another wallet's release: it stays saved for that wallet. This one starts from its own.
      record.current = undefined
      resumed.current = false
      setCommitted(false)
      setInstance(undefined)
      setLinks([])
    }

    const found = pendingRelease(address, music.cfg.chainId)
    if (!found) return
    adopt(found)
    join(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, address, music.cfg.chainId])

  // A wallet that never answers must not hold the dialog open: after a while it can be closed, and the release waits.
  useEffect(() => {
    setStuck(false)
    if (!busy) return undefined
    const timer = setTimeout(() => setStuck(true), STUCK_MS)
    return () => clearTimeout(timer)
  }, [busy])

  const closable = !busy || stuck
  const sent = current?.progress
  const waiting = !!sent && !!(sent.batchId || sent.deployHash || sent.editionHash || sent.mintHash)
  let mintLabel = committed || error ? 'Try again' : 'Mint'
  if (resumed.current) mintLabel = waiting ? 'Check status' : 'Continue'

  const store = async (file: File, kind: string) => {
    const key = await contentKey(kind, file)
    const known = uploads.current.get(key)
    if (known) return known
    const uri = await upload(file, kind, chain)
    uploads.current.set(key, uri)
    return uri
  }

  const runUpload = async () => {
    setBusy(true)
    setError('')
    setStatus('Preparing the file…')
    try {
      const built = await requestFiles(job.intent)
      const file = job.intent === 'upload-bounce' ? built.audio : built.pack
      if (!file) throw new Error('Nothing to upload')
      const kind = job.intent === 'upload-bounce' ? 'bounce' : built.packKind
      setStatus('Uploading to Arweave. A large file asks the wallet to pay for storage on Ethereum.')
      const uri = await store(file, kind)
      setLinks([uri])
      setStatus('Stored on Arweave.')
    } catch (e) {
      setError((e as Error).message || 'The upload did not finish')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Checks everything that can be checked, bounces, and stores the files. Nothing is paid for until the checks pass.
   * If this exact song or kit already has a release under way, that one is handed back to carry on instead.
   */
  const prepare = async (account: Address): Promise<Prepared> => {
    const openChain = MUSIC_CHAINS.find((c) => c.factory && c.vault)?.name
    const blocked = releaseBlocker({
      connected: true,
      wrongChain: music.wrongChain || chain?.id !== music.cfg.chainId,
      deployed: !!music.cfg.factory && !!music.cfg.vault,
      chainName: music.cfg.name,
      openChain: openChain !== music.cfg.name ? openChain : undefined,
    })
    if (blocked) throw new Error(blocked)
    if (!music.ready || !music.cfg.factory || !music.cfg.vault)
      throw new Error('Music drops are not open here yet. Nothing was charged.')
    const { factory, vault } = music.cfg
    const priced = parsePriceEth(price)
    if (!priced.ok) throw new Error(priced.error)
    const edition = parseEdition(supply, rise)
    if (!edition.ok) throw new Error(edition.error)
    const alignment = parseAlignmentPct(
      String(music.minAlignmentBps / 100),
      music.minAlignmentBps,
      music.protocolFeeBps
    )
    if (!alignment.ok) throw new Error(alignment.error)
    if (!artistName) throw new Error('Add an artist name.')

    setStatus('Bouncing and packing…')
    if (!bounced.current) {
      bounced.current = requestFiles(job.intent)
      bounced.current.catch(() => {
        bounced.current = undefined
      })
    }

    const files = await bounced.current
    if (!files.audio || !files.pack) throw new Error('Could not prepare the bounce and the file')
    // The same song or kit must not go out twice while one release of it is still under way.
    const content = await contentKey(files.packKind, files.pack)
    const key = releaseKey(account, music.cfg.chainId, content)
    const earlier = live.get(key) ?? loadRelease(browserStore(), account, music.cfg.chainId, content)
    if (earlier && earlier !== record.current && launchCommitted(earlier.progress)) {
      return { kind: 'resume', found: track(earlier) }
    }

    const audioCheck = validateAudioFile(files.audio)
    if (!audioCheck.ok) throw new Error(audioCheck.error)
    const picture = cover || (await plainCover(title))
    const imageCheck = validateImageFile(picture)
    if (!imageCheck.ok) throw new Error(imageCheck.error)

    const form = (uris: { audio: string; image: string; pack: string }): MusicForm => ({
      title,
      artist: artistName,
      image: uris.image,
      audio: uris.audio,
      mime: 'audio/wav',
      duration: files.duration || 1,
      bpm: publishBpm(job.bpm),
      song: files.packKind === 'song' ? uris.pack : undefined,
      kit: files.packKind === 'kit' ? uris.pack : undefined,
      description: files.packKind === 'kit' ? 'A MiyaMusicMaker kit.' : 'A MiyaMusicMaker song.',
    })
    // The same checks the real metadata gets, with stand-in links, before the first upload is paid for.
    const trial = buildMusicMetadata(form(PLACEHOLDER_URIS))
    if (!trial.ok) throw new Error(Object.values(trial.errors)[0] || 'Check the mint fields.')
    setStatus('Checking the release with the network…')
    await checkLaunch({ account, chainId: music.cfg.chainId, factory, vault, name: title, alignmentBps: alignment.bps })

    setStatus('Uploading the bounce…')
    const audioUri = await store(files.audio, 'bounce')
    setStatus('Uploading the cover…')
    const imageUri = await store(picture, 'cover')
    setStatus(files.packKind === 'kit' ? 'Uploading the kit…' : 'Uploading the song…')
    const packUri = await store(files.pack, files.packKind)
    const meta = buildMusicMetadata(form({ audio: audioUri, image: imageUri, pack: packUri }))
    if (!meta.ok) throw new Error(Object.values(meta.errors)[0] || 'Check the mint fields.')
    setStatus('Uploading token metadata…')
    const metadataFile = new File([JSON.stringify(meta.metadata)], 'metadata.json', { type: 'application/json' })
    const metadataUri = await store(metadataFile, 'metadata')
    setLinks([audioUri, packUri, metadataUri])

    // Paying for storage can take the wallet to Ethereum and back. If it didn't come back, nothing goes to the wrong place.
    if (getAccount(wagmiConfig).chainId !== music.cfg.chainId) {
      throw new Error(
        `Your wallet is on another network. Switch back to ${music.cfg.name}, then try again. Your uploads are kept.`
      )
    }

    return {
      kind: 'fresh',
      content,
      sealed: {
        links: [audioUri, packUri, metadataUri],
        launch: {
          account,
          chainId: music.cfg.chainId,
          factory,
          vault,
          name: title,
          title,
          metadataURI: metadataUri,
          priceWei: priced.wei,
          supply: edition.supply,
          model: edition.model,
          rate: edition.rate,
          alignmentBps: alignment.bps,
        },
      },
    }
  }

  /** The release to send: the one under way, or a new one sealed from the fields as they are now. */
  const releaseFor = async (account: Address): Promise<SavedRelease> => {
    const now = record.current
    // Once something is on the chain the release is fixed: carry on with exactly what was sent.
    if (now && (resumed.current || launchCommitted(now.progress))) return now
    setLinks([])
    const made = await prepare(account)
    if (made.kind === 'resume') {
      adopt(made.found)
      setStatus('This one is already being released. Carrying on with that release instead of starting another.')
      return made.found
    }

    const launch = { ...made.sealed.launch, mintFirst }
    if (now && keyOf(now) === releaseKey(account, launch.chainId, made.content)) {
      // The same content with nothing still out: what the fields say now replaces what it was sealed with. The
      // progress (and its salt) is kept, so a later send still makes only the one collection.
      Object.assign(now, { launch, links: made.sealed.links, uploads: Object.fromEntries(uploads.current) })
      saveRelease(browserStore(), now)
      return now
    }

    if (now) forget(now)
    const next = track({
      account,
      chainId: launch.chainId,
      content: made.content,
      intent: job.intent,
      launch,
      links: made.sealed.links,
      uploads: Object.fromEntries(uploads.current),
      progress: {},
      savedAt: Date.now(),
    })
    record.current = next
    return next
  }

  const runMint = async () => {
    setBusy(true)
    setError('')
    try {
      if (!address) throw new Error('Connect a wallet first.')
      const release = await releaseFor(address)
      setLinks(release.links)
      const { launch, progress } = release
      if (launch.account.toLowerCase() !== address.toLowerCase()) {
        throw new Error('This release was started from another wallet. Switch back to it to finish.')
      }

      if (chain?.id !== launch.chainId) throw new Error(`Switch to ${music.cfg.name} to finish the release.`)

      setStatus(progress.instance ? 'Confirm the next step in your wallet.' : 'Confirm the edition in your wallet.')
      const key = keyOf(release)
      const run = launchEdition(launch, progress, (deployedAt) => {
        setInstance(deployedAt)
        setStatus(`Collection is live at ${deployedAt}. Confirm the next step in your wallet.`)
      })
      running.set(key, run)
      const launched = await run
        .then((done) => {
          // Finished: nothing is left to resume.
          forget(release)
          return done
        })
        .finally(() => {
          if (running.get(key) === run) running.delete(key)
          setCommitted(resumed.current || launchCommitted(progress))
        })
      setInstance(launched.instance)
      setReleased(true)
      setStatus(
        launched.minted
          ? 'Edition is live and the first copy is in this wallet, so My Files can show it.'
          : 'Edition is live. Mint a copy from Music drops to see it in My Files.'
      )
    } catch (e) {
      setError(isUnconfirmed(e) ? UNCONFIRMED : plainTxError(e))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  /** Drops a release after a clear failure. Only offered once nothing sent is still waiting to be heard from. */
  const discard = () => {
    const now = record.current
    if (!now || launchUnsettled(now.progress)) return
    forget(now)
    record.current = undefined
    resumed.current = false
    setCommitted(false)
    setInstance(undefined)
    setLinks([])
    setError('')
    setStatus('Dropped. The next release starts fresh.')
    redraw((n) => n + 1)
  }

  return (
    <Back
      role="presentation"
      onMouseDown={() => {
        if (closable) onClose()
      }}
    >
      <Card
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && !(mint && released)) void (mint ? runMint() : runUpload())
        }}
      >
        <strong>{mint ? (job.intent === 'mint-kit' ? 'Mint kit' : 'Mint song') : 'Arweave'}</strong>
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
            <Row>
              Cover
              <Field
                aria-label="Cover image"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                disabled={committed}
                onChange={(e) => setCover(e.target.files?.[0] || null)}
              />
            </Row>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: text.xs }}>
              <input
                type="checkbox"
                checked={sealed ? sealed.mintFirst : mintFirst}
                disabled={committed}
                onChange={(e) => setMintFirst(e.target.checked)}
              />
              {firstCopyLabel(sealed ? sealed.priceWei : pricedNow.ok ? pricedNow.wei : undefined)}
            </label>
            <Note>
              The bounce plays in miya radio. The {job.intent === 'mint-kit' ? 'kit' : 'song'} file is stored beside it
              so it can be opened again.
              {music.wrongChain ? ` Switch to ${music.cfg.name} before releasing.` : ''}
            </Note>
          </>
        ) : (
          <Note>Uploading through Irys. Files under about 90 KB are free. Larger ones pay ETH on Ethereum.</Note>
        )}
        {mint && current && committed && !released && (
          <Note>
            A release of “{current.launch.title}” is in progress:{' '}
            {describeLaunch(current.progress, current.launch.mintFirst)}.{' '}
            {unsettled
              ? 'Check status waits on what was sent and sends nothing new.'
              : 'Continue carries on from there.'}
          </Note>
        )}
        {status && <Note>{status}</Note>}
        {busy && stuck && (
          <Note>
            This is taking a while. You can close this window: the release stays saved and resumes when you reopen.
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
        <Actions>
          {mint && current && committed && !released && !busy && !unsettled && (
            <Btn type="button" onClick={discard}>
              Discard this release
            </Btn>
          )}
          <Btn type="button" onClick={onClose} disabled={!closable}>
            Close
          </Btn>
          <Btn type="submit" disabled={busy || (mint && (!title.trim() || released))}>
            {busy ? 'Working…' : mint ? (released ? 'Released' : mintLabel) : 'Upload'}
          </Btn>
        </Actions>
      </Card>
    </Back>
  )
}

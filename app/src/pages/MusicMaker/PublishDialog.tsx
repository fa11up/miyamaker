import { getAccount } from '@wagmi/core'
import { useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address, Chain } from 'viem'
import { useAccount, useEnsName } from 'wagmi'

import { wagmiConfig } from '@/config/wagmi'
import { buildMusicMetadata, type MusicForm, validateAudioFile, validateImageFile } from '@/music/audio'
import { MUSIC_CHAINS } from '@/music/config'
import { parseAlignmentPct, parseEdition, parsePriceEth } from '@/music/drop'
import { describeTxError, useMusicChain } from '@/pages/DropMusic/useDropMusic'
import { space, text } from '@/theme/tokens'
import { isUnconfirmed } from '@/utils/batch'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'

import { checkLaunch, type EditionLaunch, launchEdition } from './launchEdition'
import {
  contentKey,
  defaultArtist,
  firstCopyLabel,
  launchCommitted,
  type LaunchProgress,
  PLACEHOLDER_URIS,
  publishBpm,
  releaseBlocker,
} from './mintPlan'
import { requestFiles } from './publish.js'

export type PublishJob = { intent: string; name: string; bpm: number }

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
  const [instance, setInstance] = useState<Address>()
  // Kept for as long as the dialog is open, so a failed attempt is retried without paying for anything twice:
  // uploads by their exact bytes, and what has gone to the chain with the release it was built for.
  const uploads = useRef(new Map<string, string>())
  const progress = useRef<LaunchProgress>({})
  const sealed = useRef<{ launch: Omit<EditionLaunch, 'mintFirst'>; links: string[] }>()
  // The bounce and the file, made once: a retry hands the same bytes to the upload cache.
  const bounced = useRef<Promise<Awaited<ReturnType<typeof requestFiles>>>>()
  const [committed, setCommitted] = useState(false)
  const [released, setReleased] = useState(false)
  const artistName = artist.trim() || defaultArtist(ens.data, address)
  const pricedNow = parsePriceEth(price)

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

  /** Checks everything that can be checked, bounces, and stores the files. Nothing is paid for until the checks pass. */
  const prepare = async (account: Address): Promise<{ launch: Omit<EditionLaunch, 'mintFirst'>; links: string[] }> => {
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
    }
  }

  const runMint = async () => {
    setBusy(true)
    setError('')
    try {
      if (!address) throw new Error('Connect a wallet first.')
      // Once something is on the chain the release is fixed: carry on with exactly what was sent.
      let release = sealed.current
      if (!release || !launchCommitted(progress.current)) {
        setLinks([])
        release = await prepare(address)
        sealed.current = release
      } else setLinks(release.links)
      if (release.launch.account.toLowerCase() !== address.toLowerCase()) {
        throw new Error('This release was started from another wallet. Switch back to it to finish.')
      }

      if (chain?.id !== release.launch.chainId) throw new Error(`Switch to ${music.cfg.name} to finish the release.`)

      setStatus(
        progress.current.instance ? 'Confirm the next step in your wallet.' : 'Confirm the edition in your wallet.'
      )
      const launched = await launchEdition({ ...release.launch, mintFirst }, progress.current, (deployedAt) => {
        setInstance(deployedAt)
        setStatus(`Collection is live at ${deployedAt}. Confirm the next step in your wallet.`)
      }).finally(() => setCommitted(launchCommitted(progress.current)))
      setInstance(launched.instance)
      setReleased(true)
      setStatus(
        launched.minted
          ? 'Edition is live and the first copy is in this wallet, so My Files can show it.'
          : 'Edition is live. Mint a copy from Music drops to see it in My Files.'
      )
    } catch (e) {
      setError(
        isUnconfirmed(e)
          ? 'The network has not confirmed this yet. It may still go through, so check your wallet or wait a minute. Try again waits on the same one and sends nothing new.'
          : describeTxError(e) || (e as Error).message
      )
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Back
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose()
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
              <input type="checkbox" checked={mintFirst} onChange={(e) => setMintFirst(e.target.checked)} />
              {firstCopyLabel(
                sealed.current && committed ? sealed.current.launch.priceWei : pricedNow.ok ? pricedNow.wei : undefined
              )}
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
        {status && <Note>{status}</Note>}
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
          <Btn type="button" onClick={onClose} disabled={busy}>
            Close
          </Btn>
          <Btn type="submit" disabled={busy || (mint && (!title.trim() || released))}>
            {busy ? 'Working…' : mint ? (released ? 'Released' : committed || error ? 'Try again' : 'Mint') : 'Upload'}
          </Btn>
        </Actions>
      </Card>
    </Back>
  )
}

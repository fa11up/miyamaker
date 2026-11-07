import { useState } from 'react'
import styled from 'styled-components/macro'
import type { Chain } from 'viem'
import { useAccount } from 'wagmi'

import { buildMusicMetadata, validateAudioFile, validateImageFile } from '@/music/audio'
import { parseAlignmentPct, parseEdition, parsePriceEth } from '@/music/drop'
import { describeTxError, useMusicChain } from '@/pages/DropMusic/useDropMusic'
import { fundAndUpload } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'
import { space, text } from '@/theme/tokens'

import { launchEdition } from './launchEdition'
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
  const music = useMusicChain()
  const [title, setTitle] = useState(job.name || 'Song')
  const [artist, setArtist] = useState('')
  const [price, setPrice] = useState('0.01')
  const [supply, setSupply] = useState('')
  const [rise, setRise] = useState('')
  const [cover, setCover] = useState<File | null>(null)
  const [mintFirst, setMintFirst] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

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
      const uri = await upload(file, kind, chain)
      setLinks([uri])
      setStatus('Stored on Arweave.')
    } catch (e) {
      setError((e as Error).message || 'The upload did not finish')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const runMint = async () => {
    setBusy(true)
    setError('')
    setLinks([])
    try {
      if (!address) throw new Error('Connect a wallet first.')
      const priced = parsePriceEth(price)
      if (!priced.ok) throw new Error(priced.error)
      const edition = parseEdition(supply, rise)
      if (!edition.ok) throw new Error(edition.error)
      const alignment = parseAlignmentPct(String(music.minAlignmentBps / 100), music.minAlignmentBps, music.protocolFeeBps)
      if (!alignment.ok) throw new Error(alignment.error)
      setStatus('Bouncing and packing…')
      const built = await requestFiles(job.intent)
      if (!built.audio || !built.pack) throw new Error('Could not prepare the bounce and the file')
      const audioCheck = validateAudioFile(built.audio)
      if (!audioCheck.ok) throw new Error(audioCheck.error)
      const picture = cover || (await plainCover(title))
      const imageCheck = validateImageFile(picture)
      if (!imageCheck.ok) throw new Error(imageCheck.error)
      setStatus('Uploading the bounce…')
      const audioUri = await upload(built.audio, 'bounce', chain)
      setStatus('Uploading the cover…')
      const imageUri = await upload(picture, 'cover', chain)
      setStatus(built.packKind === 'kit' ? 'Uploading the kit…' : 'Uploading the song…')
      const packUri = await upload(built.pack, built.packKind, chain)
      const meta = buildMusicMetadata({
        title,
        artist: artist || 'miya',
        image: imageUri,
        audio: audioUri,
        mime: 'audio/wav',
        duration: built.duration || 1,
        bpm: job.bpm,
        song: built.packKind === 'song' ? packUri : undefined,
        kit: built.packKind === 'kit' ? packUri : undefined,
        description: built.packKind === 'kit' ? 'A MiyaMusicMaker kit.' : 'A MiyaMusicMaker song.',
      })
      if (!meta.ok) throw new Error(Object.values(meta.errors)[0] || 'Check the mint fields.')
      setStatus('Uploading token metadata…')
      const metadataFile = new File([JSON.stringify(meta.metadata)], 'metadata.json', { type: 'application/json' })
      const metadataUri = await upload(metadataFile, 'metadata', chain)
      setLinks([audioUri, packUri, metadataUri])
      if (!music.ready || !music.cfg.factory || !music.cfg.vault) {
        setStatus('Files are on Arweave. Releasing an edition opens when this network has music drops.')
        return
      }
      setStatus('Confirm the edition in your wallet.')
      const launched = await launchEdition({
        account: address,
        chainId: music.cfg.chainId,
        factory: music.cfg.factory,
        vault: music.cfg.vault,
        name: title,
        title,
        metadataURI: metadataUri,
        priceWei: priced.wei,
        supply: edition.supply,
        model: edition.model,
        rate: edition.rate,
        alignmentBps: alignment.bps,
        mintFirst: mintFirst,
      })
      setStatus(
        launched.minted
          ? `Edition is live and the first copy is in this wallet, so My Files can show it. ${launched.instance}`
          : `Edition is live. Mint a copy from Music drops to see it in My Files. ${launched.instance}`
      )
    } catch (e) {
      setError(describeTxError(e) || (e as Error).message)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Back role="presentation" onMouseDown={onClose}>
      <Card
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void (mint ? runMint() : runUpload())
        }}
      >
        <strong>{mint ? (job.intent === 'mint-kit' ? 'Mint kit' : 'Mint song') : 'Arweave'}</strong>
        {mint ? (
          <>
            <Row>
              Title
              <Field aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Row>
            <Row>
              Artist
              <Field aria-label="Artist" value={artist} placeholder="miya" onChange={(e) => setArtist(e.target.value)} />
            </Row>
            <Row>
              Price in ETH
              <Field aria-label="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Row>
            <Row>
              Supply
              <Field aria-label="Supply" value={supply} placeholder="Blank is an open edition" onChange={(e) => setSupply(e.target.value)} />
            </Row>
            <Row>
              Price rise each mint, in percent
              <Field aria-label="Price rise" value={rise} placeholder="Blank stays flat. 1 raises 1% each mint." onChange={(e) => setRise(e.target.value)} />
            </Row>
            <Row>
              Cover
              <Field
                aria-label="Cover image"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => setCover(e.target.files?.[0] || null)}
              />
            </Row>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: text.xs }}>
              <input type="checkbox" checked={mintFirst} onChange={(e) => setMintFirst(e.target.checked)} />
              Mint the first copy to this wallet
            </label>
            <Note>
              The bounce plays in miya radio. The {job.intent === 'mint-kit' ? 'kit' : 'song'} file is stored beside it so it can be opened again.
              {music.wrongChain ? ' Switch to a music network before releasing.' : ''}
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
        <Actions>
          <Btn type="button" onClick={onClose} disabled={busy}>
            Close
          </Btn>
          <Btn type="submit" disabled={busy || (mint && !title.trim())}>
            {busy ? 'Working…' : mint ? 'Mint' : 'Upload'}
          </Btn>
        </Actions>
      </Card>
    </Back>
  )
}

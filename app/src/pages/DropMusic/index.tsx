import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import {
  DropZone as Drop,
  Err,
  Field,
  Row2,
  Segmented as Tabs,
  SmallButton,
  SplitMeter,
  STEP_DOT as DOT,
  StepList as Steps,
  Thumb as Cover,
} from '@/components/LaunchKit'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, StatusBox, Well } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import Pages from '@/constants/pages'
import { useRadio } from '@/context/RadioProvider'
import { useOpenManage } from '@/miyamints/useOpenManage'
import type { FileCheck } from '@/music/audio'
import {
  AUDIO_ACCEPT,
  AUDIO_TYPES,
  buildMusicMetadata,
  formatDuration,
  IMAGE_ACCEPT,
  MAX_AUDIO_BYTES,
  safeUri,
  validateAudioFile,
  validateImageFile,
} from '@/music/audio'
import { parseAlignmentPct, parsePriceEth, parseSupply } from '@/music/drop'
import { readAudioDuration } from '@/music/readDuration'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { color, font, space, text } from '@/theme/tokens'
import { formatBytes } from '@/utils/formatBytes'
import { resolveUri } from '@/utils/resolveUri'

import { STEPS, useDropMusic, useMusicChain } from './useDropMusic'

const pageId = 'dropmusic' as PageKey

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  grid-template-areas: 'head head' 'track edition';
  gap: ${space[3]};
  padding: ${space[3]};
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'track' 'edition';
  }
`

const Head = styled.header`
  grid-area: head;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
  p {
    margin: ${space[1]} 0 0;
    font-size: ${text.sm};
    color: ${color.ink};
    max-width: 60ch;
  }
`

const Json = styled.pre`
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-family: ${font.mono};
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-all;
`

type Form = {
  title: string
  artist: string
  description: string
  genre: string
  bpm: string
  collectionName: string
  price: string
  supply: string
  alignment: string
  audioUri: string
  coverUri: string
  linkFormat: string
}

const EMPTY: Form = {
  title: '',
  artist: '',
  description: '',
  genre: '',
  bpm: '',
  collectionName: '',
  price: '',
  supply: '',
  alignment: '',
  audioUri: '',
  coverUri: '',
  linkFormat: 'mp3',
}

type AudioPick = { file: File; check: FileCheck; duration?: number; url: string; reading?: boolean; error?: string }
type CoverPick = { file: File; check: FileCheck; url: string }

export default function DropMusicWindow() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const radio = useRadio()
  const openApp = useOpenApp()
  const openManage = useOpenManage()
  const { isConnected, chain } = useAccount()
  const { openConnectModal } = useConnectModal()
  const music = useMusicChain()
  const drop = useDropMusic()

  const [form, setForm] = useState<Form>(EMPTY)
  const [mode, setMode] = useState<'upload' | 'links'>('upload')
  const [audio, setAudio] = useState<AudioPick>()
  const [cover, setCover] = useState<CoverPick>()
  const [linkDuration, setLinkDuration] = useState<number>()
  const [linkError, setLinkError] = useState('')
  const [over, setOver] = useState<'audio' | 'cover'>()
  const [touched, setTouched] = useState(false)
  const audioInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    if (!form.alignment && music.minAlignmentBps) {
      setForm((f) => ({ ...f, alignment: String(music.minAlignmentBps / 100) }))
    }
  }, [music.minAlignmentBps])

  useEffect(() => () => cover && URL.revokeObjectURL(cover.url), [cover])

  // Track details changed after the metadata JSON was uploaded: rebuild it on the next attempt.
  useEffect(() => {
    if (drop.uploaded.metadata) drop.invalidate('metadata')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, form.artist, form.description, form.genre, form.bpm, form.linkFormat])

  const pickAudio = async (file: File | undefined) => {
    if (!file) return
    drop.invalidate('audio')
    const check = validateAudioFile(file)
    const url = URL.createObjectURL(file)
    const pick: AudioPick = { file, check, url, reading: check.ok }
    setAudio(pick)
    if (!form.title) setForm((f) => ({ ...f, title: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) }))
    if (!check.ok) return
    try {
      const duration = await readAudioDuration(file)
      setAudio((a) => (a?.file === file ? { ...a, duration, reading: false } : a))
    } catch (e) {
      setAudio((a) => (a?.file === file ? { ...a, reading: false, error: (e as Error).message } : a))
    }
  }

  const pickCover = (file: File | undefined) => {
    if (!file) return
    drop.invalidate('cover')
    setCover({ file, check: validateImageFile(file), url: URL.createObjectURL(file) })
  }

  // Links mode: read the duration from the linked file (only allowed schemes, resolved via the gateway).
  const checkLink = async () => {
    setLinkError('')
    setLinkDuration(undefined)
    const uri = safeUri(form.audioUri)
    if (!uri) {
      setLinkError('Use an ipfs://, ar:// or https:// link.')
      return
    }

    const el = new Audio()
    el.preload = 'metadata'
    el.src = resolveUri(uri)
    await new Promise<void>((done) => {
      const t = setTimeout(() => {
        setLinkError('Timed out reading the link.')
        done()
      }, 15_000)
      el.onloadedmetadata = () => {
        clearTimeout(t)
        if (Number.isFinite(el.duration) && el.duration > 0) setLinkDuration(el.duration)
        else setLinkError('Could not read the track length.')
        done()
      }

      el.onerror = () => {
        clearTimeout(t)
        setLinkError('Could not load that audio link.')
        done()
      }
    })
    el.removeAttribute('src')
  }

  const mime =
    mode === 'upload'
      ? audio?.check.ok
        ? audio.check.mime
        : ''
      : (AUDIO_TYPES[form.linkFormat]?.[0] as string | undefined) || ''
  const duration = mode === 'upload' ? audio?.duration : linkDuration

  const meta = (audioRef: string, coverRef: string) =>
    buildMusicMetadata({
      title: form.title,
      artist: form.artist,
      description: form.description,
      genre: form.genre,
      bpm: form.bpm,
      image: coverRef,
      audio: audioRef,
      mime,
      duration: duration ?? NaN,
    })

  const preview = useMemo(
    () =>
      meta(
        drop.uploaded.audio || (mode === 'links' ? form.audioUri : 'ar://pending-audio-upload'),
        drop.uploaded.cover || (mode === 'links' ? form.coverUri : 'ar://pending-cover-upload')
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, mode, mime, duration, drop.uploaded]
  )

  const price = parsePriceEth(form.price)
  const supply = parseSupply(form.supply)
  const align = parseAlignmentPct(form.alignment, music.minAlignmentBps, music.protocolFeeBps)
  const metaErrors = preview.ok ? {} : preview.errors
  const fileError =
    mode === 'upload'
      ? !audio
        ? 'Add an audio file.'
        : !audio.check.ok
        ? audio.check.error
        : audio.error
        ? audio.error
        : !cover
        ? 'Add cover art.'
        : !cover.check.ok
        ? cover.check.error
        : ''
      : ''
  const valid = preview.ok && price.ok && supply.ok && align.ok && !fileError && !(audio?.reading && mode === 'upload')
  const done = !!drop.launched.editionId
  const collectionName =
    form.collectionName.trim() ||
    [form.artist.trim(), form.title.trim()].filter(Boolean).join(' - ').slice(0, 120) ||
    form.title.trim()

  const submit = () => {
    setTouched(true)
    if (!valid || !price.ok || !supply.ok || !align.ok) return
    drop.run({
      audioFile: mode === 'upload' ? audio?.file : undefined,
      audioUri: mode === 'links' ? safeUri(form.audioUri) : undefined,
      coverFile: mode === 'upload' ? cover?.file : undefined,
      coverUri: mode === 'links' ? safeUri(form.coverUri) : undefined,
      buildMetadata: (a, c) => {
        const r = meta(a, c)
        return r.ok ? r.metadata : null
      },
      collectionName,
      title: form.title.trim(),
      priceWei: price.wei,
      supply: supply.supply,
      model: supply.model,
      alignmentBps: align.bps,
    })
  }

  const previewInRadio = () => {
    if (!audio?.check.ok) return
    radio.playNow({
      id: `local:${audio.file.name}:${audio.file.size}:${audio.file.lastModified}`,
      title: form.title.trim() || audio.file.name,
      artist: form.artist.trim() || undefined,
      src: audio.url,
      artwork: undefined,
      duration: audio.duration,
      source: 'local',
    })
  }

  const playReleased = () => {
    const { instance, editionId } = drop.launched
    if (!instance || !editionId || !drop.uploaded.audio || !chain) return
    radio.playNow({
      id: `onchain:${chain.id}:${instance.toLowerCase()}:${editionId}`,
      title: form.title.trim(),
      artist: form.artist.trim() || undefined,
      src: drop.uploaded.audio,
      artwork: drop.uploaded.cover,
      duration,
      source: 'onchain',
      token: { chainId: chain.id, address: instance, tokenId: editionId.toString() },
    })
  }

  const action = (() => {
    if (!isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (drop.running) return { label: 'Working…', disabled: true, onClick: () => {} }
    if (done) return { label: 'Released', disabled: true, onClick: () => {} }
    if (!music.ready) return { label: 'Upload files only', disabled: !valid, onClick: submit }
    if (drop.launched.instance) return { label: 'Retry: add edition', disabled: !valid, onClick: submit }
    return { label: 'Release music', disabled: !valid, onClick: submit }
  })()

  const [layoutRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 600
  const show = (msg?: string) => (touched ? msg : undefined)
  const explorer = explorerUrl(chain?.id)

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: pageId }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: pageId }))
        }}
      >
        {Pages.dropmusic?.label}
      </TitleBar>
      <Layout ref={layoutRef} className={narrow ? 'narrow' : undefined}>
        <Grid>
          <Head>
            <div>
              <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>
                Music drops · ERC-1155 editions
              </Eyebrow>
              <DisplayTitle>Drop Music</DisplayTitle>
              <p>Release a track as a collectible edition. It plays in miya radio and shows up under Mint → Music.</p>
            </div>
            {music.ready ? (
              <Chip tone="ok">Live on {music.cfg.name}</Chip>
            ) : (
              <Chip tone="warn">{music.wrongChain ? 'Unsupported network' : `Not live on ${music.cfg.name} yet`}</Chip>
            )}
          </Head>

          <Panel style={{ gridArea: 'track' }} aria-label="Track">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space[2] }}>
              <Eyebrow>Track</Eyebrow>
              <Tabs role="group" aria-label="Source of files">
                <SmallButton type="button" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>
                  Upload files
                </SmallButton>
                <SmallButton type="button" aria-pressed={mode === 'links'} onClick={() => setMode('links')}>
                  Use links
                </SmallButton>
              </Tabs>
            </div>

            {mode === 'upload' ? (
              <>
                <Drop
                  $over={over === 'audio'}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOver('audio')
                  }}
                  onDragLeave={() => setOver(undefined)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setOver(undefined)
                    pickAudio(e.dataTransfer.files[0])
                  }}
                >
                  <div className="grow">
                    {audio ? (
                      <>
                        {audio.file.name}
                        <small>
                          {formatBytes(audio.file.size)} ·{' '}
                          {audio.reading ? 'reading length…' : audio.duration ? formatDuration(audio.duration) : '—'}
                        </small>
                      </>
                    ) : (
                      <>
                        Drop audio here
                        <small>mp3, ogg, wav, m4a or flac · up to {MAX_AUDIO_BYTES / 1024 / 1024} MB</small>
                      </>
                    )}
                    <Err>{audio && !audio.check.ok ? audio.check.error : audio?.error}</Err>
                  </div>
                  {audio?.check.ok && audio.duration && (
                    <SmallButton type="button" onClick={previewInRadio} title="Listen before you upload">
                      Preview
                    </SmallButton>
                  )}
                  <SmallButton type="button" onClick={() => audioInput.current?.click()}>
                    {audio ? 'Change' : 'Browse'}
                  </SmallButton>
                  <input
                    ref={audioInput}
                    type="file"
                    accept={AUDIO_ACCEPT}
                    hidden
                    aria-label="Audio file"
                    onChange={(e) => {
                      pickAudio(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </Drop>
                <Drop
                  $over={over === 'cover'}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOver('cover')
                  }}
                  onDragLeave={() => setOver(undefined)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setOver(undefined)
                    pickCover(e.dataTransfer.files[0])
                  }}
                >
                  <Cover>{cover?.check.ok && <img src={cover.url} alt="Cover preview" />}</Cover>
                  <div className="grow">
                    {cover ? cover.file.name : 'Drop cover art here'}
                    <small>{cover ? formatBytes(cover.file.size) : 'Square png, jpg, gif or webp · up to 10 MB'}</small>
                    <Err>{cover && !cover.check.ok ? cover.check.error : undefined}</Err>
                  </div>
                  <SmallButton type="button" onClick={() => coverInput.current?.click()}>
                    {cover ? 'Change' : 'Browse'}
                  </SmallButton>
                  <input
                    ref={coverInput}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    hidden
                    aria-label="Cover art file"
                    onChange={(e) => {
                      pickCover(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </Drop>
              </>
            ) : (
              <>
                <Field>
                  Audio link
                  <input
                    value={form.audioUri}
                    placeholder="ar://… or ipfs://…/track.mp3"
                    onChange={(e) => {
                      drop.invalidate('metadata')
                      setLinkDuration(undefined)
                      set('audioUri')(e)
                    }}
                    onBlur={() => form.audioUri && checkLink()}
                  />
                  <small>
                    {linkDuration ? `Length ${formatDuration(linkDuration)}` : 'The length is read from the link.'}
                  </small>
                  <Err>{linkError}</Err>
                </Field>
                <Row2>
                  <Field>
                    Format
                    <select value={form.linkFormat} onChange={set('linkFormat')}>
                      {Object.keys(AUDIO_TYPES).map((ext) => (
                        <option key={ext} value={ext}>
                          {ext}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field>
                    Cover link
                    <input value={form.coverUri} placeholder="ar://… or ipfs://…" onChange={set('coverUri')} />
                    <Err>{show(metaErrors.image)}</Err>
                  </Field>
                </Row2>
              </>
            )}

            <Row2>
              <Field>
                Title*
                <input value={form.title} maxLength={120} onChange={set('title')} />
                <Err>{show(metaErrors.title)}</Err>
              </Field>
              <Field>
                Artist*
                <input value={form.artist} maxLength={80} onChange={set('artist')} />
                <Err>{show(metaErrors.artist)}</Err>
              </Field>
            </Row2>
            <Row2>
              <Field>
                Genre
                <input value={form.genre} maxLength={40} onChange={set('genre')} placeholder="optional" />
              </Field>
              <Field>
                BPM
                <input
                  value={form.bpm}
                  inputMode="numeric"
                  maxLength={3}
                  onChange={set('bpm')}
                  placeholder="optional"
                />
                <Err>{metaErrors.bpm}</Err>
              </Field>
            </Row2>
            <Field>
              Description
              <textarea value={form.description} maxLength={2000} onChange={set('description')} />
            </Field>
          </Panel>

          <Panel style={{ gridArea: 'edition' }} aria-label="Edition">
            <Eyebrow>Edition</Eyebrow>
            <Field>
              Collection name
              <input
                value={form.collectionName}
                placeholder={collectionName || 'Artist - Title'}
                maxLength={120}
                onChange={set('collectionName')}
              />
            </Field>
            <Row2>
              <Field>
                Price (ETH)*
                <input value={form.price} inputMode="decimal" placeholder="0.01" onChange={set('price')} />
                <Err>{form.price || touched ? (!price.ok ? price.error : undefined) : undefined}</Err>
                {price.ok && <small>{formatEther(price.wei)} ETH per copy</small>}
              </Field>
              <Field>
                Supply
                <input value={form.supply} inputMode="numeric" placeholder="open" onChange={set('supply')} />
                <Err>{!supply.ok ? supply.error : undefined}</Err>
                {supply.ok && <small>{supply.supply ? `${supply.supply} copies` : 'Open edition'}</small>}
              </Field>
            </Row2>
            <Field>
              Alignment share (%)
              <input value={form.alignment} inputMode="decimal" onChange={set('alignment')} />
              <Err>{!align.ok ? align.error : undefined}</Err>
              <small>
                Share of each mint sent to the alignment vault (min {music.minAlignmentBps / 100}%). Protocol fee{' '}
                {music.protocolFeeBps / 100}%. You keep the rest.
              </small>
            </Field>
            <SplitMeter
              protocolBps={music.protocolFeeBps || 100}
              alignmentBps={align.ok ? align.bps : music.minAlignmentBps}
              compact
            />

            <Well>
              <Steps aria-label="Release steps">
                {STEPS.map((s) => (
                  <li key={s.id}>
                    <span className="dot" style={{ background: DOT[drop.steps[s.id]] }} />
                    <span>
                      {s.label}
                      {drop.steps[s.id] === 'skipped' ? ' (using link)' : ''}
                    </span>
                  </li>
                ))}
              </Steps>
            </Well>

            <details>
              <summary style={{ cursor: 'pointer', fontSize: text.xs }}>Token metadata preview</summary>
              <Well style={{ marginTop: space[1] }}>
                <Json>
                  {preview.ok ? JSON.stringify(preview.metadata, null, 2) : 'Fill in the track to preview metadata.'}
                </Json>
              </Well>
            </details>

            <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </BigButton>

            {touched && fileError && (
              <StatusBox tone="error" role="alert">
                <span>{fileError}</span>
              </StatusBox>
            )}
            {!music.ready && (
              <StatusBox tone="info">
                <span>
                  {music.wrongChain
                    ? 'Switch your wallet to Ethereum, Sepolia or Robinhood Chain.'
                    : music.deployed
                    ? `Connect a wallet on ${music.cfg.name} to release.`
                    : `Music editions are not deployed on ${music.cfg.name} yet (set VITE_MUSIC_FACTORY_${music.cfg.chainId} and VITE_MUSIC_VAULT_${music.cfg.chainId}). You can still upload; the links are kept here to launch later.`}
                </span>
              </StatusBox>
            )}
            {music.ready && music.vaultRegistered === false && (
              <StatusBox tone="error">
                <span>The configured alignment vault is not registered in MiyaRegistry, so deploys will revert.</span>
              </StatusBox>
            )}
            {drop.running && (
              <StatusBox tone="info" role="status">
                <img src={LoadingHourglass} alt="" />
                <span>Follow the prompts in your wallet. Uploads are paid through Irys.</span>
              </StatusBox>
            )}
            {drop.error && !drop.running && (
              <StatusBox tone="error" role="alert">
                <span>{drop.error}</span>
              </StatusBox>
            )}
            {(drop.uploaded.audio || drop.uploaded.metadata) && !done && (
              <StatusBox tone="info">
                <span style={{ fontFamily: font.mono, fontSize: 11 }}>
                  {drop.uploaded.audio && (
                    <>
                      audio {drop.uploaded.audio}
                      <br />
                    </>
                  )}
                  {drop.uploaded.cover && (
                    <>
                      cover {drop.uploaded.cover}
                      <br />
                    </>
                  )}
                  {drop.uploaded.metadata && <>metadata {drop.uploaded.metadata}</>}
                </span>
              </StatusBox>
            )}
            {done && drop.launched.instance && (
              <StatusBox tone="ok" role="status">
                <span>
                  Released! Edition #{drop.launched.editionId?.toString()} of{' '}
                  <a href={`${explorer}/address/${drop.launched.instance}`} target="_blank" rel="noreferrer">
                    {drop.launched.instance.slice(0, 6)}…{drop.launched.instance.slice(-4)}
                  </a>
                  .{' '}
                  <SmallButton type="button" onClick={playReleased}>
                    Play in radio
                  </SmallButton>{' '}
                  <SmallButton type="button" onClick={() => openApp('mint')}>
                    Open Mint
                  </SmallButton>{' '}
                  <SmallButton
                    type="button"
                    onClick={() =>
                      chain &&
                      drop.launched.instance &&
                      openManage({ chainId: chain.id, address: drop.launched.instance, kind: 'editions' })
                    }
                  >
                    Open in Manage
                  </SmallButton>{' '}
                  <SmallButton
                    type="button"
                    onClick={() => {
                      drop.reset()
                      setForm({ ...EMPTY, alignment: form.alignment })
                      setAudio(undefined)
                      setCover(undefined)
                      setTouched(false)
                    }}
                  >
                    New drop
                  </SmallButton>
                </span>
              </StatusBox>
            )}
          </Panel>
        </Grid>
      </Layout>
    </WindowWrapper>
  )
}

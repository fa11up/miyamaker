import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import styled, { css, keyframes } from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import { Chip, Skeleton, StatusBox } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useRadio } from '@/context/RadioProvider'
import { AUDIO_ACCEPT, IMAGE_ACCEPT, validateAudioFile, validateImageFile } from '@/music/audio'
import { addTrack, audioSeconds, fetchStation, removeTrack, toTrack } from '@/music/community'
import { useAddToRadio } from '@/music/useAddToRadio'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { font, space, text } from '@/theme/tokens'
import { fundAndUpload } from '@/utils/fundAndUpload'

import { cleanLine } from '../../../api/_lib/station'
import { gel } from '../DropMusic/y2k'

const page = Pages.station

const DIAL = [88, 92, 96, 100, 104, 108]

/** The station's own material: a tangerine iMac-era plastic, frosted panels, lime gel. */
const fm = {
  ink: '#2a0a5e',
  inkSoft: '#5a3f8c',
  tangerine: '#ff7a18',
  sun: '#ffc24d',
  lime: '#c6ff3d',
  limeDark: '#7fcc00',
  hot: '#ff3d9a',
  frost: 'rgba(255, 255, 255, 0.78)',
  lcd: '#1a0838',
} as const

const twinkle = keyframes`
  0%, 100% { transform: scale(0.55) rotate(0deg); opacity: 0.55; }
  50% { transform: scale(1) rotate(20deg); opacity: 1; }
`

const scroll = keyframes`
  to { transform: translateX(-50%); }
`

const sway = keyframes`
  0%, 100% { transform: translateX(-3px); }
  50% { transform: translateX(3px); }
`

const pulse = keyframes`
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
`

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  color: ${fm.ink};
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.14) 0 1px, transparent 1px 4px),
    radial-gradient(420px 260px at 88% -40px, rgba(255, 255, 255, 0.75), transparent 70%),
    linear-gradient(165deg, ${fm.sun} 0%, ${fm.tangerine} 52%, ${fm.hot} 118%);

  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
    }
  }
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  max-width: 760px;
  margin: 0 auto;
  padding: ${space[3]};
`

const frosted = css`
  background: ${fm.frost};
  border: 1px solid ${fm.ink};
  border-radius: 18px;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.95), inset 0 -3px 6px rgba(255, 122, 24, 0.22),
    0 3px 0 rgba(42, 10, 94, 0.35);
`

const Hero = styled.header`
  ${frosted}
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]} ${space[4]};
  min-width: 0;
`

const Sparkle = styled.i`
  position: absolute;
  width: 26px;
  height: 26px;
  background: linear-gradient(135deg, #fff, ${fm.lime} 60%, ${fm.limeDark});
  clip-path: polygon(50% 0, 57% 43%, 100% 50%, 57% 57%, 50% 100%, 43% 57%, 0 50%, 43% 43%);
  animation: ${twinkle} 2.8s ease-in-out infinite;
  pointer-events: none;
`

const Wordmark = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[3]};
`

const Title = styled.h1`
  margin: 0;
  font-family: ${font.display};
  font-weight: 400;
  font-size: ${text.xl};
  line-height: 1.15;
  letter-spacing: 0.02em;
  color: ${fm.ink};
  text-shadow: 2px 2px 0 ${fm.sun};
`

const Lamp = styled.span`
  ${gel('#d9d3e6', '#a79dbd', fm.ink)}
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px ${space[2]};
  font-size: ${text.xs};
  letter-spacing: 0.1em;
  white-space: nowrap;
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7a7190;
  }
  &.live {
    ${gel('#ffc2e0', fm.hot, fm.ink)}
    &::before {
      background: #fff;
      box-shadow: 0 0 6px 2px #fff;
    }
  }
`

const Tuner = styled.div`
  position: relative;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  background: ${fm.lcd};
  box-shadow: inset 0 2px 5px #000, 0 1px 0 #fff;
  &::before {
    content: '';
    position: absolute;
    inset: 0 8px auto;
    height: 9px;
    background: repeating-linear-gradient(90deg, ${fm.lime} 0 1px, transparent 1px 8px);
    opacity: 0.8;
  }
  .marks {
    position: absolute;
    inset: auto 8px 4px;
    display: flex;
    justify-content: space-between;
    font-size: ${text.xs};
    line-height: 1;
    color: ${fm.lime};
  }
  .needle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 62%;
    width: 3px;
    background: ${fm.hot};
    box-shadow: 0 0 6px 1px ${fm.hot};
  }
  .needle.live {
    animation: ${sway} 3.4s ease-in-out infinite;
  }
`

const Ticker = styled.div`
  overflow: hidden;
  white-space: nowrap;
  padding: 3px ${space[2]};
  border-radius: 999px;
  background: ${fm.lcd};
  color: ${fm.lime};
  font-size: ${text.sm};
  .run {
    display: inline-block;
    animation: ${scroll} linear infinite;
  }
  .run span {
    padding-right: 3em;
  }
`

const Deck = styled.section`
  ${frosted}
  padding: ${space[4]};
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  min-width: 0;
`

const DeckTitle = styled.h2`
  margin: 0;
  font-family: ${font.display};
  font-weight: 400;
  font-size: ${text.md};
  letter-spacing: 0.04em;
  color: ${fm.ink};
`

const Lead = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${fm.ink};
`

const Fine = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.5;
  color: ${fm.inkSoft};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${space[3]};
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${text.sm};
  color: ${fm.ink};
  min-width: 0;
  input[type='text'],
  input[type='file'] {
    box-sizing: border-box;
    width: 100%;
    min-height: 38px;
    border: 1px solid ${fm.ink};
    border-radius: 12px;
    padding: 5px ${space[2]};
    background: #fff;
    box-shadow: inset 0 2px 3px rgba(42, 10, 94, 0.25);
    font-size: ${text.sm};
    color: ${fm.ink};
  }
  input:focus-visible {
    outline: 2px solid ${fm.hot};
    outline-offset: 1px;
  }
  input::file-selector-button {
    ${gel('#efffb8', fm.lime, fm.ink)}
    margin-right: ${space[2]};
    padding: 2px ${space[2]};
    font-family: ${font.ui};
    font-size: ${text.xs};
    cursor: pointer;
  }
`

const Rights = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space[2]};
  align-items: start;
  font-size: ${text.sm};
  line-height: 1.45;
  color: ${fm.ink};
  cursor: pointer;
  input {
    margin-top: 3px;
    accent-color: ${fm.hot};
  }
`

const Send = styled.button`
  ${gel('#efffb8', fm.lime, fm.ink)}
  min-height: 52px;
  width: 100%;
  font-family: ${font.display};
  font-size: ${text.lg};
  letter-spacing: 0.04em;
  cursor: pointer;
  &:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:focus-visible {
    outline: 2px solid ${fm.hot};
    outline-offset: 2px;
  }
  &:disabled {
    ${gel('#efedf4', '#c8c3d4', fm.inkSoft)}
    cursor: not-allowed;
  }
`

const Rows = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  li {
    display: grid;
    grid-template-columns: auto 40px minmax(0, 1fr) auto;
    gap: ${space[2]};
    align-items: center;
    padding: ${space[1]} ${space[2]};
    border: 1px solid rgba(42, 10, 94, 0.45);
    border-radius: 12px;
    background: linear-gradient(180deg, #fff, #fff1d9);
  }
  li.on {
    border-color: ${fm.ink};
    background: linear-gradient(180deg, #f6ffd9, ${fm.lime});
  }
  .num {
    min-width: 2.2em;
    padding: 2px 4px;
    border-radius: 5px;
    background: ${fm.lcd};
    color: ${fm.lime};
    font-size: ${text.xs};
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .eq {
    display: inline-flex;
    justify-content: center;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
    width: 100%;
  }
  .eq i {
    width: 3px;
    height: 100%;
    background: ${fm.lime};
    transform-origin: bottom;
    animation: ${pulse} 0.8s ease-in-out infinite;
  }
  .eq i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .eq i:nth-child(3) {
    animation-delay: -0.55s;
  }
  .pic {
    width: 40px;
    border-radius: 8px;
    overflow: hidden;
  }
  .note {
    display: grid;
    place-items: center;
    aspect-ratio: 1 / 1;
    background: linear-gradient(135deg, ${fm.sun}, ${fm.hot});
    color: #fff;
    font-size: ${text.lg};
  }
  .words {
    min-width: 0;
    font-size: ${text.sm};
  }
  .words b,
  .words span {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .words span {
    font-size: ${text.xs};
    color: ${fm.inkSoft};
  }
  .actions {
    display: flex;
    gap: ${space[1]};
  }
`

const Small = styled.button`
  ${gel('#efffb8', fm.lime, fm.ink)}
  min-height: 32px;
  padding: 0 ${space[3]};
  font-family: ${font.ui};
  font-size: ${text.sm};
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:focus-visible {
    outline: 2px solid ${fm.hot};
    outline-offset: 2px;
  }
  &:disabled {
    ${gel('#efedf4', '#c8c3d4', fm.inkSoft)}
    cursor: not-allowed;
  }
  &.danger {
    ${gel('#ffe0ef', '#ff8cc4', fm.ink)}
  }
`

const titleFromFile = (name: string) => cleanLine(name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), 120)

const tags = (file: File, kind: string) => [
  { name: 'Content-Type', value: file.type || 'application/octet-stream' },
  { name: 'application-id', value: 'MiyaOS' },
  { name: 'miya-kind', value: kind },
]

/**
 * Anyone with a wallet can put a song on the radio, no edition needed: the file goes to Arweave (they pay the small
 * storage fee), they sign, and it plays for everyone at once. The station's admins or the uploader can take it off;
 * the file itself is permanent on Arweave.
 */
export default function StationPage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('station')
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const radio = useRadio()
  const addToRadio = useAddToRadio()

  const station = useQuery({ queryKey: ['station'], queryFn: fetchStation, refetchInterval: 60_000, retry: 1 })

  const [audio, setAudio] = useState<File>()
  const [cover, setCover] = useState<File>()
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const [addedNote, setAddedNote] = useState<string>()
  // The file pickers keep their last file until they are remounted.
  const [formKey, setFormKey] = useState(0)

  // Uploaded files survive a failed later step, so trying again does not pay for them twice.
  const [stored, setStored] = useState<{ audio?: [File, string]; cover?: [File, string] }>({})

  const me = address?.toLowerCase()
  const isAdmin = !!me && !!station.data?.admins.includes(me)
  const closedYet = station.error && /opens soon/i.test((station.error as Error).message)

  const pickAudio = (file?: File) => {
    setError(undefined)
    setDone(undefined)
    if (!file) return setAudio(undefined)
    const check = validateAudioFile(file)
    if (!check.ok) {
      setAudio(undefined)
      return setError(check.error)
    }

    setAudio(file)
    if (!title) setTitle(titleFromFile(file.name))
    return undefined
  }

  const pickCover = (file?: File) => {
    setError(undefined)
    if (!file) return setCover(undefined)
    const check = validateImageFile(file)
    if (!check.ok) {
      setCover(undefined)
      return setError(check.error)
    }

    return setCover(file)
  }

  const sign = (message: string) => signMessageAsync({ message })

  const submit = async () => {
    if (!audio || !address) return
    setBusy(true)
    setError(undefined)
    setDone(undefined)
    try {
      const put = async (key: 'audio' | 'cover', file: File, words: string) => {
        const known = stored[key]
        if (known && known[0] === file) return known[1]
        setNote(words)
        const id = await fundAndUpload(file, tags(file, `station-${key}`), undefined, undefined, undefined, setNote)
        setStored((s) => ({ ...s, [key]: [file, id] }))
        return id
      }

      const txId = await put('audio', audio, 'Uploading your track…')
      const artworkId = cover ? await put('cover', cover, 'Uploading your cover…') : undefined
      setNote('Sign to put it on the station. This one costs nothing.')
      const { track } = await addTrack(
        {
          txId,
          artworkId,
          title: cleanLine(title, 120),
          artist: cleanLine(artist, 80),
          duration: await audioSeconds(audio),
          wallet: address,
        },
        sign
      )
      radio.enqueue(toTrack(track))
      setDone(`${track.title} is on the station, and in your radio.`)
      setAudio(undefined)
      setCover(undefined)
      setTitle('')
      setRights(false)
      setStored({})
      setFormKey((k) => k + 1)
      station.refetch()
    } catch (e) {
      const m = (e as { shortMessage?: string })?.shortMessage || (e as Error).message
      setError(/user rejected|user denied|rejected the request/i.test(m) ? 'You cancelled it in your wallet.' : m)
    } finally {
      setBusy(false)
      setNote(undefined)
    }
  }

  const remove = async (txId: string) => {
    if (!address) return
    setRemoving(txId)
    setError(undefined)
    try {
      await removeTrack({ txId, wallet: address }, sign)
      station.refetch()
    } catch (e) {
      const m = (e as { shortMessage?: string })?.shortMessage || (e as Error).message
      setError(/user rejected|user denied|rejected the request/i.test(m) ? 'You cancelled it in your wallet.' : m)
    } finally {
      setRemoving(undefined)
    }
  }

  const tracks = station.data?.tracks ?? []
  const ticker = tracks.map((t) => `${t.title} / ${t.artist}`).join('  ★  ')
  const addAll = () => {
    const added = addToRadio(tracks.map(toTrack))
    setAddedNote(
      added ? `Added ${added} track${added === 1 ? '' : 's'} to your radio.` : 'All of these are already in your radio.'
    )
  }

  const ready = !!audio && !!cleanLine(title, 120) && !!cleanLine(artist, 80) && rights

  return (
    <WindowWrapper skin="station">
      <TitleBar
        skin="station"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'station' }))
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'station' }))
        }}
      >
        {page?.label}
      </TitleBar>
      <Layout>
        <Inner>
          <Hero>
            <Sparkle aria-hidden style={{ top: -7, right: 18 }} />
            <Sparkle aria-hidden style={{ top: 26, right: 52, width: 14, height: 14, animationDelay: '-1.3s' }} />
            <Wordmark>
              <Title>Community station</Title>
              <Lamp className={radio.playing ? 'live' : ''}>{radio.playing ? 'ON AIR' : 'STANDBY'}</Lamp>
            </Wordmark>
            <Tuner aria-hidden>
              <span className={`needle ${radio.playing ? 'live' : ''}`} />
              <span className="marks">
                {DIAL.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </Tuner>
            {ticker && (
              <Ticker aria-hidden>
                <span className="run" style={{ animationDuration: `${Math.max(14, ticker.length / 4)}s` }}>
                  <span>{ticker}</span>
                  <span>{ticker}</span>
                </span>
              </Ticker>
            )}
          </Hero>

          <Deck aria-label="Upload a track">
            <DeckTitle>Send in your track</DeckTitle>
            <Lead>
              Put a song on the radio. It plays for everyone right away, no edition or launch needed. You pay a small
              one-time storage fee on Ethereum, plus gas.
            </Lead>
            {closedYet ? (
              <StatusBox tone="info">
                <span>The community station opens soon.</span>
              </StatusBox>
            ) : (
              <>
                <Grid>
                  <Field>
                    Your track (up to 50 MB)
                    <input
                      key={`audio-${formKey}`}
                      type="file"
                      accept={AUDIO_ACCEPT}
                      disabled={busy}
                      onChange={(e) => pickAudio(e.target.files?.[0])}
                    />
                  </Field>
                  <Field>
                    Cover (optional)
                    <input
                      key={`cover-${formKey}`}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      disabled={busy}
                      onChange={(e) => pickCover(e.target.files?.[0])}
                    />
                  </Field>
                  <Field>
                    Title
                    <input
                      type="text"
                      value={title}
                      maxLength={120}
                      disabled={busy}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </Field>
                  <Field>
                    Artist
                    <input
                      type="text"
                      value={artist}
                      maxLength={80}
                      disabled={busy}
                      onChange={(e) => setArtist(e.target.value)}
                    />
                  </Field>
                </Grid>
                <Rights>
                  <input
                    type="checkbox"
                    checked={rights}
                    disabled={busy}
                    onChange={(e) => setRights(e.target.checked)}
                  />
                  <span>
                    I made this or have the right to share it. The file stays on Arweave for good; a track can be taken
                    off the station, but the file cannot be deleted.
                  </span>
                </Rights>
                {isConnected ? (
                  <Send type="button" disabled={!ready || busy} onClick={submit}>
                    {busy ? 'Working…' : 'Put it on the radio'}
                  </Send>
                ) : (
                  <Send type="button" onClick={() => openConnectModal?.()}>
                    Connect wallet
                  </Send>
                )}
              </>
            )}
            {note && (
              <StatusBox tone="info" role="status">
                <img src={LoadingHourglass} alt="" />
                <span>{note}</span>
              </StatusBox>
            )}
            {done && (
              <StatusBox tone="ok" role="status">
                <span>{done}</span>
              </StatusBox>
            )}
            {error && (
              <StatusBox tone="error" role="alert">
                <span>{error}</span>
              </StatusBox>
            )}
          </Deck>

          <Deck aria-label="On the station">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space[2] }}>
              <DeckTitle>On the station</DeckTitle>
              {isAdmin && <Chip tone="ok">You can remove tracks</Chip>}
              {tracks.length > 0 && (
                <Small type="button" onClick={addAll}>
                  Add all to radio
                </Small>
              )}
            </div>
            {addedNote && <Fine role="status">{addedNote}</Fine>}
            {station.isLoading && <Skeleton h="48px" />}
            {!station.isLoading && !tracks.length && !closedYet && (
              <Fine>{station.error ? 'Could not load the station.' : 'Nothing here yet. Be the first.'}</Fine>
            )}
            <Rows>
              {tracks.map((t, i) => {
                const on = radio.playing && radio.current?.id === toTrack(t).id
                return (
                  <li key={t.txId} className={on ? 'on' : ''}>
                    <span className="num" aria-hidden>
                      {on ? (
                        <span className="eq">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        String(i + 1).padStart(2, '0')
                      )}
                    </span>
                    <span className="pic" aria-hidden>
                      {t.artworkId ? (
                        <NftImage src={`ar://${t.artworkId}`} alt="" variant="thumb" />
                      ) : (
                        <span className="note">♪</span>
                      )}
                    </span>
                    <span className="words">
                      <b title={t.title}>{t.title}</b>
                      <span title={t.artist}>{t.artist}</span>
                    </span>
                    <span className="actions">
                      <Small type="button" aria-label={`Play ${t.title}`} onClick={() => radio.playNow(toTrack(t))}>
                        Play
                      </Small>
                      {(isAdmin || t.uploader === me) && (
                        <Small
                          type="button"
                          className="danger"
                          aria-label={`Remove ${t.title}`}
                          disabled={!!removing}
                          onClick={() => remove(t.txId)}
                        >
                          {removing === t.txId ? 'Sign…' : 'Remove'}
                        </Small>
                      )}
                    </span>
                  </li>
                )
              })}
            </Rows>
          </Deck>
        </Inner>
      </Layout>
    </WindowWrapper>
  )
}

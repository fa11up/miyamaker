import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, Skeleton, StatusBox } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import Pages from '@/constants/pages'
import { useRadio } from '@/context/RadioProvider'
import { AUDIO_ACCEPT, IMAGE_ACCEPT, validateAudioFile, validateImageFile } from '@/music/audio'
import { addTrack, audioSeconds, fetchStation, removeTrack, toTrack } from '@/music/community'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'
import { fundAndUpload } from '@/utils/fundAndUpload'

import { cleanLine } from '../../../api/_lib/station'

const page = Pages.station

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  max-width: 760px;
  margin: 0 auto;
  padding: ${space[3]};
`

const Lead = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.5;
  color: ${color.ink};
`

const Fine = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.5;
  color: ${color.inkMuted};
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
  color: ${color.ink};
  min-width: 0;
  input[type='text'],
  input[type='file'] {
    box-sizing: border-box;
    width: 100%;
    min-height: 36px;
    border: none;
    border-radius: 0;
    padding: ${space[1]} ${space[2]};
    background: ${color.well};
    box-shadow: ${bevel.field};
    font-size: ${text.sm};
    color: ${color.ink};
  }
`

const Rights = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space[2]};
  align-items: start;
  font-size: ${text.sm};
  line-height: 1.45;
  color: ${color.ink};
  cursor: pointer;
  input {
    margin-top: 3px;
    accent-color: ${color.accentDark};
  }
`

const Rows = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  li {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: ${space[2]};
    align-items: center;
    padding: ${space[1]};
    background: ${color.well};
    box-shadow: ${bevel.sunken};
  }
  .pic {
    width: 40px;
  }
  .note {
    display: grid;
    place-items: center;
    aspect-ratio: 1 / 1;
    background: ${color.light};
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
    color: ${color.inkMuted};
  }
  .actions {
    display: flex;
    gap: ${space[1]};
  }
`

const Small = styled.button`
  min-height: 32px;
  padding: 0 ${space[3]};
  border: none;
  border-radius: 0;
  background: ${color.face};
  color: ${color.ink};
  box-shadow: ${bevel.raised};
  font-family: ${font.ui};
  font-size: ${text.sm};
  cursor: pointer;
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
  &.danger {
    color: ${color.danger};
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
  const ready = !!audio && !!cleanLine(title, 120) && !!cleanLine(artist, 80) && rights

  return (
    <WindowWrapper skin="chrome">
      <TitleBar
        skin="chrome"
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
          <div>
            <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>miya radio</Eyebrow>
            <DisplayTitle>Community station</DisplayTitle>
          </div>

          <Panel aria-label="Upload a track">
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
                  <BigButton type="button" disabled={!ready || busy} onClick={submit}>
                    {busy ? 'Working…' : 'Put it on the radio'}
                  </BigButton>
                ) : (
                  <BigButton type="button" onClick={() => openConnectModal?.()}>
                    Connect wallet
                  </BigButton>
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
          </Panel>

          <Panel aria-label="On the station">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space[2] }}>
              <Eyebrow>On the station</Eyebrow>
              {isAdmin && <Chip tone="ok">You can remove tracks</Chip>}
              {tracks.length > 0 && (
                <Small type="button" onClick={() => radio.enqueue(tracks.map(toTrack))}>
                  Add all to radio
                </Small>
              )}
            </div>
            {station.isLoading && <Skeleton h="48px" />}
            {!station.isLoading && !tracks.length && !closedYet && (
              <Fine>{station.error ? 'Could not load the station.' : 'Nothing here yet. Be the first.'}</Fine>
            )}
            <Rows>
              {tracks.map((t) => (
                <li key={t.txId}>
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
              ))}
            </Rows>
          </Panel>
        </Inner>
      </Layout>
    </WindowWrapper>
  )
}

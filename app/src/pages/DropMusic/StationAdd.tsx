import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import { Err, SmallButton } from '@/components/LaunchKit'
import { BigButton, StatusBox, Well } from '@/components/Retro'
import { useRadio } from '@/context/RadioProvider'
import { plainTxError } from '@/miyamints/errors'
import { addTrack, toTrack } from '@/music/community'
import { stationStorageWords, storedBytes } from '@/music/creatorWords'
import { space, text } from '@/theme/tokens'
import { FREE_BYTES } from '@/utils/fundAndUpload'
import { useStorageQuote } from '@/utils/useStorageQuote'

import { cleanLine } from '../../../api/_lib/station'

const Box = styled(Well)`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]};
  font-size: ${text.xs};
  h3 {
    margin: 0;
    font-size: ${text.sm};
  }
  p {
    margin: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: ${space[1]};
    cursor: pointer;
  }
  input {
    margin: 0;
    flex: none;
  }
`

const AR_FILE = /^(?:ar:\/\/|https:\/\/(?:www\.)?arweave\.net\/)([A-Za-z0-9_-]{43,44})(?:[/?#]|$)/
const arId = (uri?: string) => uri?.trim().match(AR_FILE)?.[1]

/**
 * Puts the track on the radio's community station, no edition needed. Uploads go through the release's own
 * store, so releasing later does not pay for the same files again.
 */
export default function StationAdd({
  primary,
  title,
  artist,
  duration,
  audioFile,
  coverFile,
  audioUri,
  coverUri,
  store,
  stored,
  storing,
  doneWords,
  onDone,
  onBusy,
}: {
  /** The step's main action, while editions are not open: the big button, and a word on what it still needs. */
  primary: boolean
  title: string
  artist: string
  duration?: number
  audioFile?: File
  coverFile?: File
  audioUri?: string
  coverUri?: string
  store: (id: 'audio' | 'cover', file: File) => Promise<string>
  /** Files the release already holds: those are not paid for again. */
  stored: { audio?: string; cover?: string }
  /** What the upload in progress is waiting for. */
  storing?: string
  /** Kept by the page, since this goes away with its tab and must not offer the same track again. */
  doneWords?: string
  onDone: (words: string) => void
  /** Told while this is working, when the tab must not change and closing should ask first. */
  onBusy: (busy: boolean) => void
}) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const radio = useRadio()
  const [rights, setRights] = useState(false)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => onBusy(!!note), [note])
  // Gone from the screen: no more wallet prompts. Reset on mount for React's double effects in development.
  const left = useRef(false)
  useEffect(() => {
    left.current = false
    return () => {
      left.current = true
      onBusy(false)
    }
  }, [])

  const name = cleanLine(title, 120)
  const by = cleanLine(artist, 80)
  const linked = arId(audioUri)
  const toStore = [
    ...(audioFile && !linked && !stored.audio ? [audioFile] : []),
    ...(coverFile && !stored.cover ? [coverFile] : []),
  ]
  const storage = useStorageQuote(
    storedBytes(
      toStore.map((f) => f.size),
      FREE_BYTES
    )
  )

  const add = async () => {
    if (!address) return
    setError(undefined)
    try {
      setNote('Storing your track. Check your wallet.')
      const txId = linked || arId(await store('audio', audioFile as File))
      if (!txId) throw new Error('That upload did not land on Arweave. Try again.')
      if (coverFile) setNote('Storing your cover. Check your wallet.')
      const artworkId = coverFile ? arId(await store('cover', coverFile)) : arId(coverUri)
      if (left.current) return
      setNote('Sign to put it on the station. This one costs nothing.')
      const { track } = await addTrack(
        { txId, artworkId, title: name, artist: by, duration, wallet: address },
        (message) => signMessageAsync({ message })
      )
      radio.enqueue(toTrack(track))
      client.invalidateQueries({ queryKey: ['station'] })
      onDone(`${track.title} is on the station, and in your radio.`)
    } catch (e) {
      setError(plainTxError(e))
    } finally {
      setNote(undefined)
    }
  }

  if (doneWords)
    return (
      <StatusBox tone="ok" role="status">
        <span>{doneWords}</span>
      </StatusBox>
    )

  // It stays out of the way until the track is ready and there is a wallet to sign with.
  if (!address) return null
  if ((!audioFile && !linked) || !name || !by) {
    if (!primary) return null
    return (
      <StatusBox tone="info">
        <span>
          {audioUri && !linked
            ? 'The community station only plays files stored on Arweave. Upload the file instead of linking it.'
            : 'Add your track, title and artist to put it on the community station.'}
        </span>
      </StatusBox>
    )
  }

  const button = primary ? (
    <BigButton type="button" disabled={!rights || !!note} onClick={add}>
      {note ? 'Working… check your wallet' : 'Add to community station'}
    </BigButton>
  ) : (
    <SmallButton type="button" disabled={!rights || !!note} onClick={add}>
      {note ? 'Working… check your wallet' : 'Add to community station'}
    </SmallButton>
  )

  return (
    <>
      <Box>
        {!primary && <h3>Put it on the community station</h3>}
        <label>
          <input type="checkbox" checked={rights} disabled={!!note} onChange={(e) => setRights(e.target.checked)} />
          <span>I made this or have the right to share it.</span>
        </label>
        <p role={note ? 'status' : undefined}>{storing || note || stationStorageWords(storage)}</p>
        {coverUri && !arId(coverUri) && <p>Covers must be on Arweave to show on the station.</p>}
        <Err>{error}</Err>
        {!primary && button}
      </Box>
      {primary && button}
    </>
  )
}

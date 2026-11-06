import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import { Err, SmallButton } from '@/components/LaunchKit'
import { BigButton, StatusBox, Well } from '@/components/Retro'
import { useRadio } from '@/context/RadioProvider'
import { addTrack, toTrack } from '@/music/community'
import { space, text } from '@/theme/tokens'

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
}) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const radio = useRadio()
  const [rights, setRights] = useState(false)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()

  const name = cleanLine(title, 120)
  const by = cleanLine(artist, 80)
  const linked = arId(audioUri)

  const add = async () => {
    if (!address) return
    setError(undefined)
    try {
      setNote('Uploading your track…')
      const txId = linked || arId(await store('audio', audioFile as File))
      if (!txId) throw new Error('That upload did not land on Arweave. Try again.')
      if (coverFile) setNote('Uploading your cover…')
      const artworkId = coverFile ? arId(await store('cover', coverFile)) : arId(coverUri)
      setNote('Sign to put it on the station. This one costs nothing.')
      const { track } = await addTrack(
        { txId, artworkId, title: name, artist: by, duration, wallet: address },
        (message) => signMessageAsync({ message })
      )
      radio.enqueue(toTrack(track))
      client.invalidateQueries({ queryKey: ['station'] })
      setDone(`${track.title} is on the station, and in your radio.`)
    } catch (e) {
      const m = (e as { shortMessage?: string })?.shortMessage || (e as Error).message
      setError(/user rejected|user denied|rejected the request/i.test(m) ? 'You cancelled it in your wallet.' : m)
    } finally {
      setNote(undefined)
    }
  }

  if (done)
    return (
      <StatusBox tone="ok" role="status">
        <span>{done}</span>
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
      {note ? 'Working…' : 'Add to community station'}
    </BigButton>
  ) : (
    <SmallButton type="button" disabled={!rights || !!note} onClick={add}>
      {note ? 'Working…' : 'Add to community station'}
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
        <p>{note || 'Small storage fee, free to list. The file stays on Arweave for good.'}</p>
        {error && (
          <div role="alert">
            <Err>{error}</Err>
          </div>
        )}
        {!primary && button}
      </Box>
      {primary && button}
    </>
  )
}

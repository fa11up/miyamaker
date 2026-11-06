import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount, useSignMessage } from 'wagmi'

import { Err, SmallButton } from '@/components/LaunchKit'
import { StatusBox, Well } from '@/components/Retro'
import { useRadio } from '@/context/RadioProvider'
import { addTrack, toTrack } from '@/music/community'
import { space, text } from '@/theme/tokens'

import { cleanLine } from '../../../api/_lib/station'

const Box = styled(Well)`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
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
    align-items: flex-start;
    gap: ${space[1]};
    cursor: pointer;
  }
  input {
    margin: 2px 0 0;
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
  title,
  artist,
  duration,
  audioFile,
  coverFile,
  audioUri,
  coverUri,
  store,
}: {
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
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const radio = useRadio()
  const [rights, setRights] = useState(false)
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()

  const name = cleanLine(title, 120)
  const by = cleanLine(artist, 80)
  const linkOnly = !audioFile && !!audioUri
  const linked = arId(audioUri)
  const hint =
    !audioFile && !audioUri
      ? 'Add your track first.'
      : linkOnly && !linked
      ? 'The station only plays files stored on Arweave. Upload the file instead of linking it.'
      : !name || !by
      ? 'Add a title and artist first.'
      : ''

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

  return (
    <Box>
      <h3>Community station</h3>
      <p>The upload pays a small Arweave storage fee. Listing it is a free signature.</p>
      <label>
        <input type="checkbox" checked={rights} disabled={!!note} onChange={(e) => setRights(e.target.checked)} />
        <span>
          I made this or have the right to share it. The file stays on Arweave for good; a track can be taken off the
          station, but the file cannot be deleted.
        </span>
      </label>
      {hint && <p>{hint}</p>}
      {error && (
        <div role="alert">
          <Err>{error}</Err>
        </div>
      )}
      {note && <p role="status">{note}</p>}
      {address ? (
        <SmallButton type="button" disabled={!!hint || !rights || !!note} onClick={add}>
          {note ? 'Working…' : 'Add to community station'}
        </SmallButton>
      ) : (
        <SmallButton type="button" disabled={!openConnectModal} onClick={() => openConnectModal?.()}>
          Connect wallet to add it
        </SmallButton>
      )}
    </Box>
  )
}

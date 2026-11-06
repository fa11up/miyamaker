import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'

import { fetchStation, removeTrack } from './community'
import type { Track } from './types'

const PREFIX = 'community:'

/** Taking a track off the community station, for the wallet that added it and the station's admins. */
export function useStationRemove() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const station = useQuery({
    queryKey: ['station'],
    queryFn: fetchStation,
    enabled: !!address,
    refetchInterval: 60_000,
    retry: 1,
  })

  const me = address?.toLowerCase()
  const canRemove = (t?: Track) => {
    if (!me || !t?.id.startsWith(PREFIX)) return false
    const row = station.data?.tracks.find((r) => r.txId === t.id.slice(PREFIX.length))
    return !!row && (!!station.data?.admins.includes(me) || row.uploader.toLowerCase() === me)
  }

  const remove = async (t: Track) => {
    if (!address) return
    await removeTrack({ txId: t.id.slice(PREFIX.length), wallet: address }, (message) => signMessageAsync({ message }))
    client.invalidateQueries({ queryKey: ['station'] })
  }

  return { canRemove, remove }
}

import { STATION_PATH, type StationRow } from '../../api/_lib/station'
import { addMessage, removeMessage } from '../../api/_lib/station'
import type { PlaylistSource, Track } from './types'

/** The radio's community station on the Worker (api/_lib/station.ts). */
export type Station = { tracks: StationRow[]; admins: string[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${STATION_PATH}${path}`, init).catch(() => {
    throw new Error('Could not reach the station. Check your connection and try again.')
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `The station answered ${res.status}.`)
  return json
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const fetchStation = () => call<Station>('')

export const toTrack = (r: StationRow): Track => ({
  id: `community:${r.txId}`,
  title: r.title,
  artist: r.artist,
  src: `ar://${r.txId}`,
  artwork: r.artworkId ? `ar://${r.artworkId}` : undefined,
  duration: r.duration,
  source: 'station',
})

export const communitySource: PlaylistSource = {
  id: 'community',
  label: 'Community station',
  load: async () => (await fetchStation()).tracks.map(toTrack),
}

type Sign = (message: string) => Promise<string>

/** Sign and list a track already on Arweave. */
export async function addTrack(
  f: { txId: string; title: string; artist: string; artworkId?: string; duration?: number; wallet: string },
  sign: Sign
) {
  const at = Date.now()
  const signature = await sign(addMessage({ ...f, at }))
  return post<{ track: StationRow }>('/add', { ...f, at, signature })
}

export async function removeTrack(f: { txId: string; wallet: string }, sign: Sign) {
  const at = Date.now()
  const signature = await sign(removeMessage({ ...f, at }))
  return post<{ ok: true }>('/remove', { ...f, at, signature })
}

/** Length of an audio file in seconds, read in the browser; undefined if it cannot tell. */
export const audioSeconds = (file: File) =>
  new Promise<number | undefined>((resolve) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    const done = (v?: number) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }

    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined)
    el.onerror = () => done()
    el.src = url
  })

import { STATIONS } from '@/pages/Radio/stations'

import { safeUri } from './audio'
import { musicConfig } from './config'
import { discoverMusic } from './discovery'
import type { PlaylistSource, Track } from './types'

/** (a) The curated, static playlist in pages/Radio/stations.ts. Entries with unsafe URIs are dropped. */
export const stationSource: PlaylistSource = {
  id: 'stations',
  label: 'Curated stations',
  load: async () =>
    STATIONS.filter((t) => t.id && t.title && safeUri(t.src)).map(
      (t): Track => ({ ...t, artwork: safeUri(t.artwork), source: 'station' })
    ),
}

/** (b) On-chain music drops: any ERC-1155/721 whose metadata has an audio animation_url. */
export function musicDropsSource(chainId: number, extra: string[] = []): PlaylistSource {
  return {
    id: `drops:${chainId}`,
    label: `Music drops · ${musicConfig(chainId).name}`,
    load: async () => (await discoverMusic(chainId, extra)).map((item) => item.track),
  }
}

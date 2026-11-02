/** Where a track came from. Used for labels and to decide what is safe to persist. */
export type TrackSource = 'station' | 'onchain' | 'local' | 'dev'

/**
 * One playable item in miya radio. `src` and `artwork` are raw URIs (ipfs://, ar://, https://, or a
 * blob:/same-origin URL for local previews); they are resolved to HTTP only at playback/render time.
 * Every text field is plain text: it is rendered as React text, never as HTML.
 */
export type Track = {
  /** Stable key, e.g. `onchain:<chainId>:<address>:<tokenId>` or the station entry id. */
  id: string
  title: string
  artist?: string
  src: string
  artwork?: string
  /** Seconds, if known up front (metadata `properties.duration`). */
  duration?: number
  source: TrackSource
  /** On-chain origin, when the track is a token. */
  token?: { chainId: number; address: string; tokenId: string }
}

/** Adapter for anything that can fill the radio's playlist (curated file, on-chain drops, …). */
export interface PlaylistSource {
  id: string
  label: string
  load: () => Promise<Track[]>
}

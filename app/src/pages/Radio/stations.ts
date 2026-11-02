import type { Track } from '@/music/types'

/**
 * miya radio's curated playlist.
 *
 * Intentionally EMPTY. Only add music you own or have explicit permission to stream, hosted on storage
 * you control (ipfs:// or ar:// via the Infinite Upload window, or your own https:// origin with CORS).
 * Do not hotlink third-party mp3s. Until something is added, the radio shows
 * "No tracks yet — drop music to fill the radio" and on-chain music drops fill it instead.
 *
 * Entry shape (copy, uncomment and fill in):
 *
 *   {
 *     id: 'station:artist-slug-track-slug', // unique and stable; prefix with "station:"
 *     title: 'Track title',
 *     artist: 'Artist name',
 *     src: 'ar://<irys-tx-id>',              // or 'ipfs://<cid>/track.mp3' / 'https://…/track.mp3'
 *     artwork: 'ar://<irys-tx-id>',          // optional square cover
 *     duration: 183,                         // optional, seconds
 *     source: 'station',
 *   },
 */
export const STATIONS: Track[] = []

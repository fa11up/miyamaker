/**
 * The plain words Launch, Drop Music and the radio share for storage costs, upload prompts and the station.
 * Pure (no runtime imports), so tests/creator-words.test.mts can load it directly.
 */
import type { StorageQuote } from '../utils/useStorageQuote'
import type { Track } from './types'

/**
 * Bytes to price, from the sizes of the files about to be stored. Each file is stored on its own, so only files over
 * the free size cost anything. All of them free still counts as something chosen, so the quote says "free", not "none".
 */
export function storedBytes(sizes: readonly number[], freeBytes: number): number | undefined {
  if (!sizes.length) return undefined
  return sizes.filter((s) => s > freeBytes).reduce((sum, s) => sum + s, 0) || 1
}

/** The line next to Launch's and Drop Music's main button. Empty when nothing is being stored. */
export function storageWords(quote: StorageQuote): string {
  if (quote.state === 'priced') return `Storing your files: ${quote.words}, paid once on Ethereum, plus network fees.`
  if (quote.state === 'free') return 'Storing your files is free at this size. Network fees still apply.'
  if (quote.state === 'loading') return 'Checking the storage price…'
  if (quote.state === 'failed') return 'Your wallet shows the storage price before you pay.'
  return ''
}

/** The community station's version: listing never costs anything, only storing a new file does. */
export function stationStorageWords(quote: StorageQuote): string {
  const stays = 'The file stays on Arweave for good.'
  if (quote.state === 'priced') return `Storage: ${quote.words}, paid once on Ethereum. Listing is free. ${stays}`
  if (quote.state === 'free') return `Storage is free at this size, and so is listing. ${stays}`
  if (quote.state === 'loading') return 'Checking the storage price…'
  if (quote.state === 'failed') return `Your wallet shows the storage price before you pay. Listing is free. ${stays}`
  return 'Listing is free. Your file is already on Arweave.'
}

/** "What happens next: …" A wallet that batches signs the transactions as one, so more than one reads "up to". */
export function nextStepsWords(p: { uploads: number; paying: boolean; txs: number }): string {
  const before = [
    ...(p.paying ? ['pay for storage'] : []),
    ...(p.uploads > 1 ? ['sign each upload'] : p.uploads === 1 ? ['sign the upload'] : []),
  ]
  const txs = p.txs > 1 ? `up to ${p.txs} transactions` : '1 transaction'
  return `What happens next: ${before.length ? `${before.join(', ')}, then ${txs}` : txs}`
}

/** A failed answer from the station. Its own messages are written for people; anything else is a crash or a proxy. */
export function stationFailWords(status: number, said?: string): string {
  if (said) return said
  if (status >= 500) return 'The station is having trouble. Try again in a minute.'
  return 'The station turned that down. Check the details and try again.'
}

/** The note after a source was added to the playlist, counting only what is new to it. */
export function addedWords(label: string, found: number, fresh: number): string {
  if (!found) return `${label}: nothing to add yet.`
  if (!fresh) return `Everything from ${label} is already in your list.`
  return `Added ${fresh} track${fresh === 1 ? '' : 's'} from ${label}.`
}

/** A refused file, said on the stage it may have been dropped on, far from the tab that holds the error. */
export function refusedWords(kind: 'cover' | 'track', error: string, maxMb: number): string {
  if (/too large/i.test(error)) {
    return kind === 'cover'
      ? `That cover is too big. Use a picture up to ${maxMb} MB.`
      : `That track is too big. Use a file up to ${maxMb} MB.`
  }

  return `That ${kind} did not work. ${error}`
}

/** Track info's "Source" row. */
export function sourceWords(track: Pick<Track, 'id' | 'source' | 'token'>): string {
  if (track.token) return `On-chain, token ${track.token.tokenId}`
  if (track.id.startsWith('community:')) return 'Community station'
  if (track.source === 'station') return 'Curated station'
  if (track.source === 'local') return 'Your file'
  return 'Music drop'
}

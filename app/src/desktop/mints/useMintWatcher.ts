import { useEffect } from 'react'
import type { Address } from 'viem'
import { parseAbiItem } from 'viem'
import { usePublicClient } from 'wagmi'

import { WATCHED_COLLECTIONS } from '../collections'
import type { MintEvent } from './dedupe'
import { createSeenSet, nextRange, toMintEvents, ZERO_ADDRESS } from './dedupe'

export const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
)

const POLL_MS = 15_000
const MAX_BACKOFF_MS = 120_000

/* ---------- mint feed: watcher + demo trigger publish, toasts + confetti subscribe ---------- */

type Listener = (event: MintEvent) => void
const listeners = new Set<Listener>()

export const mintFeed = {
  emit(event: MintEvent) {
    listeners.forEach((l) => l(event))
  },
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// Module-level so a remount (StrictMode, hot reload) never replays a mint.
const seen = createSeenSet(2000)

/**
 * Polls Transfer(from = 0x0) logs for the watched collections on mainnet. Public RPCs often
 * don't support eth_newFilter, so this is plain getLogs over the last few blocks every ~15s, with
 * overlap + dedupe by txHash:logIndex, exponential backoff on errors, and no polling while the tab
 * is hidden. The first poll only primes the cursor (no burst of old mints on page load).
 */
export function useMintWatcher(enabled: boolean, chainId = 1) {
  const client = usePublicClient({ chainId: chainId as 1 })

  useEffect(() => {
    const addresses = WATCHED_COLLECTIONS.filter((c) => c.chainId === chainId).map((c) => c.address as Address)
    if (!enabled || !client || !addresses.length) return undefined

    let cancelled = false
    let timer: number | undefined
    let cursor: bigint | undefined
    let failures = 0
    let primed = false

    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- hoisted function declaration
      if (!cancelled) timer = window.setTimeout(poll, ms)
    }

    async function poll() {
      if (cancelled) return
      if (document.hidden) {
        schedule(POLL_MS)
        return
      }

      try {
        const latest = await client!.getBlockNumber({ cacheTime: 4_000 })
        const range = nextRange(cursor, latest, { maxSpan: 20n, overlap: 2n })
        if (range) {
          const logs = await client!.getLogs({
            address: addresses,
            event: TRANSFER_EVENT,
            args: { from: ZERO_ADDRESS as Address },
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          })
          const events = toMintEvents(logs, chainId, seen)
          if (primed) events.forEach((e) => mintFeed.emit(e))
          cursor = latest
        }

        primed = true
        failures = 0
        schedule(POLL_MS)
      } catch {
        failures += 1
        schedule(Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures))
      }
    }

    const onVisibility = () => {
      if (!document.hidden) schedule(500)
    }

    document.addEventListener('visibilitychange', onVisibility)
    schedule(1500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, client, chainId])
}

/* ---------- dev trigger ---------- */

let demoCounter = 0

/** Fire a fake mint through the same pipeline. `toSelf` makes it look like the connected wallet minted. */
export function fireDemoMint(opts: { to?: string; tokenId?: number | string; self?: boolean } = {}) {
  const watched = WATCHED_COLLECTIONS[0]
  demoCounter += 1
  const tokenId = String(opts.tokenId ?? 1 + Math.floor(Math.random() * 160))
  const txHash = `0xde30${Date.now().toString(16).padStart(60, '0')}`
  mintFeed.emit({
    key: `demo:${txHash}:${demoCounter}`,
    chainId: watched?.chainId ?? 1,
    collection: watched?.address ?? ZERO_ADDRESS,
    tokenId,
    to: opts.to || '0xab12000000000000000000000000000000c0ffcd',
    txHash,
    logIndex: 0,
    blockNumber: 0n,
    demo: true,
    forceSelf: !!opts.self,
  })
}

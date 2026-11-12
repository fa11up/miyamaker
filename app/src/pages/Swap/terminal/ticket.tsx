import { createContext, useContext } from 'react'
import type { Address } from 'viem'

import type { SupportedChainId } from '@/config/wagmi'

import type { OsOrder } from '../nft/markets'

/**
 * The terminal's NFT ticket: BUY, SELL NOW and SWEEP anywhere in Trade open it in the rail, where it stays mounted
 * whatever the main panel shows, and goes straight to the wallet (FillReview / SweepReview with `oneClick`).
 */
export type NftTicket =
  | {
      kind: 'fill'
      side: 'buy' | 'sell'
      order: OsOrder
      chainId: SupportedChainId
      contract: Address
      tokenId: string
      title: string
      flagged?: boolean
      unverified?: boolean
    }
  | {
      kind: 'sweep'
      listings: OsOrder[]
      chainId: SupportedChainId
      contract: Address
      title: string
      unverified?: boolean
    }

export type TicketApi = {
  /** Opens the ticket, or does nothing while a trade is in flight (the caller's button should be off then anyway). */
  open: (t: NftTicket) => void
  /** A trade is in flight: BUY / SELL buttons should be off. */
  busy: boolean
}

export const TicketContext = createContext<TicketApi | undefined>(undefined)

/** The ticket, or undefined outside the terminal (the caller then falls back to its own review). */
export const useTicket = () => useContext(TicketContext)

export const ticketTitle = (t: NftTicket) =>
  t.kind === 'sweep'
    ? `SWEEP · ${t.listings.length} ${t.title}`
    : `${t.side === 'buy' ? 'BUY' : 'SELL'} · ${t.title} #${t.tokenId}`

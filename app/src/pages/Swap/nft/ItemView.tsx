import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { cleanText } from '@/desktop/files/sanitize'

import { isFeatured } from '../board'
import { Chip, Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { color, space } from '../floor/tokens'
import { erc721Abi } from './abi'
import FillReview from './FillReview'
import type { OsOrder } from './markets'
import { formatPrice, itemUrl, venuesFor } from './markets'
import { KIND, MODE_LABEL } from './pool'
import { goneHashes, sessionStore } from './sweep'
import { Action, Card, Chips, Head, Hint, LinkButton, Mono, PushButton } from './ui'
import { useOpenSeaCollection, useOpenSeaItem } from './useMarkets'
import { poolFactoryFor, useNftMeta, usePoolsForCollection } from './usePools'
import { OutLink, VenueList, VenueRow } from './venueUi'

const Layout = styled.div`
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: ${space[3]};
  align-items: start;
  .narrow & {
    grid-template-columns: 112px 1fr;
  }
  .pic {
    max-width: 240px;
    min-width: 0;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: ${space[2]};
    min-width: 0;
  }
`

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * One NFT across venues: its OpenSea listing (buy here) and best offer (accept here when you hold it), whether a
 * MiyaPool holds it (take it for 1 pool token) and links to it on every venue.
 */
export default function ItemView({
  chainId,
  contract,
  tokenId,
  onBack,
  onOpenPool,
  onBusy,
}: {
  chainId: SupportedChainId
  contract: Address
  tokenId: string
  onBack: () => void
  onOpenPool: (pool: Address) => void
  /** Told while a trade is in flight, when the page must not change. */
  onBusy?: (busy: boolean) => void
}) {
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const { address: me } = useAccount()
  const os = useOpenSeaCollection(chainId, contract)
  const item = useOpenSeaItem(chainId, contract, os.slug, tokenId)
  const meta = useNftMeta(chainId, contract, KIND.ERC721, BigInt(tokenId))
  const factory = poolFactoryFor(chainId)
  const pools = usePoolsForCollection(chainId, factory, contract)
  const owner = useReadContract({
    address: contract,
    abi: erc721Abi,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)],
    chainId,
  })
  const [review, setReview] = useState<{ side: 'buy' | 'sell'; order: OsOrder }>()
  const [busy, setBusy] = useState(false)
  useEffect(() => onBusy?.(busy), [busy])
  useEffect(() => () => onBusy?.(false), [])

  const is1155 = item.nft?.standard === 'erc1155'
  const ownerAddress = owner.data as Address | undefined
  const mine = is1155 ? !!me && !!item.nft?.owners.some((o) => same(o, me)) : same(ownerAddress, me)
  const inPool = pools.pools.find((p) => same(p.address, ownerAddress))
  const collectionName = os.info?.name || 'NFT'
  const title = cleanText(item.nft?.name || meta.name, 80) || `${collectionName} #${tokenId}`
  // One that just failed as sold stays off this screen: the shared answer can lag it by a minute.
  const listing = item.listing && !goneHashes(sessionStore()).has(item.listing.hash) ? item.listing : undefined
  const listingIsMine = !!listing && mine
  const unverified = !isFeatured(chainId, contract) && os.info?.verified !== true
  const openSeaHref = itemUrl('opensea', chainId, contract, tokenId)

  return (
    <>
      <LinkButton type="button" onClick={onBack} disabled={busy}>
        ← {collectionName}
      </LinkButton>

      <Card aria-label={title} data-item-view>
        <Layout>
          <div className="pic">
            <NftImage src={item.nft?.image || meta.image} alt={title} fit="contain" />
          </div>
          <div className="meta">
            <Head>
              <h2>{title}</h2>
            </Head>
            <Chips>
              <Chip>{chain.name}</Chip>
              {mine && <Chip tone="ok">You hold it</Chip>}
              {inPool && <Chip tone="ok">In a MiyaPool</Chip>}
              {item.nft?.suspicious && <Chip tone="warn">Flagged by OpenSea</Chip>}
            </Chips>
            <Hint>
              Owner:{' '}
              {mine ? (
                'you'
              ) : inPool ? (
                `the ${MODE_LABEL[inPool.mode]} pool`
              ) : ownerAddress ? (
                <a href={`${explorerUrl(chainId)}/address/${ownerAddress}`} target="_blank" rel="noreferrer">
                  <Mono>{shortAddress(ownerAddress)}</Mono>
                </a>
              ) : (
                '–'
              )}
            </Hint>
            {/* Hidden while its review is open: that review has the one button to press. */}
            {listing && !listingIsMine && !review && (
              <Action
                type="button"
                disabled={busy}
                onClick={() => setReview({ side: 'buy', order: listing })}
                data-item-buy
              >
                Buy for {formatPrice(listing.price)}
              </Action>
            )}
            {mine && item.offer && !review && (
              <Action type="button" disabled={busy} onClick={() => setReview({ side: 'sell', order: item.offer! })}>
                Accept {formatPrice(item.offer.price)} offer
              </Action>
            )}
          </div>
        </Layout>
      </Card>

      {review && (
        <FillReview
          key={`${review.side}-${review.order.hash}`}
          side={review.side}
          order={review.order}
          chainId={chainId}
          contract={contract}
          tokenId={tokenId}
          title={collectionName}
          flagged={!!item.nft?.suspicious}
          unverified={unverified}
          onClose={() => setReview(undefined)}
          onDone={() => {
            item.refetch()
            owner.refetch()
          }}
          onGone={() => item.refetch()}
          onBusy={setBusy}
        />
      )}

      <Card aria-label={`Where #${tokenId} trades`}>
        <Eyebrow>Where #{tokenId} trades</Eyebrow>
        <VenueList>
          {venuesFor(chainId).map((v) => {
            if (v.id === 'miyapool') {
              if (!factory) return <VenueRow key={v.id} venue={v} note={'MiyaPool opens soon.'} />
              if (inPool)
                return (
                  <VenueRow
                    key={v.id}
                    venue={v}
                    note={`It is in the ${MODE_LABEL[inPool.mode]} pool. Take it out for 1 ${inPool.symbol}.`}
                  >
                    <PushButton type="button" disabled={busy} onClick={() => onOpenPool(inPool.address)}>
                      Open the pool
                    </PushButton>
                  </VenueRow>
                )
              if (mine && pools.pools.length)
                return (
                  <VenueRow key={v.id} venue={v} note={`Sell it into a pool for 1 ${pools.pools[0]!.symbol}, no fees.`}>
                    {pools.pools.map((p) => (
                      <PushButton key={p.address} type="button" disabled={busy} onClick={() => onOpenPool(p.address)}>
                        Open {MODE_LABEL[p.mode]} pool
                      </PushButton>
                    ))}
                  </VenueRow>
                )
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  note={pools.pools.length ? 'Not in a pool right now.' : 'No pool for this collection yet.'}
                />
              )
            }

            const href = itemUrl(v.id, chainId, contract, tokenId)
            if (v.id === 'opensea') {
              const facts: { label: string; value: string }[] = []
              if (listing) facts.push({ label: 'Listed', value: formatPrice(listing.price) })
              if (item.offer) facts.push({ label: 'Best offer', value: formatPrice(item.offer.price) })
              return (
                <VenueRow
                  key={v.id}
                  venue={v}
                  facts={facts}
                  note={
                    (item.loading && !item.needsKey && os.slug) || (os.loading && !os.slug && !os.needsKey) ? (
                      <Skeleton h="16px" w="50%" />
                    ) : item.needsKey || os.needsKey ? (
                      'Buying here is offline right now. Try again later, or buy it on OpenSea.'
                    ) : os.missing ? (
                      'Not on OpenSea yet.'
                    ) : (item.error || (os.error && !os.slug)) && !listing && !item.offer ? (
                      // A failed read is not "not listed": say so, and offer to ask again.
                      <span data-item-opensea-failed>
                        Couldn&apos;t check OpenSea.{' '}
                        <LinkButton
                          type="button"
                          onClick={() => {
                            os.refetch()
                            item.refetch()
                          }}
                        >
                          Try again
                        </LinkButton>
                      </span>
                    ) : !listing && !item.offer ? (
                      'Not listed and no offers right now.'
                    ) : undefined
                  }
                >
                  {/* Only listing your own, or a market offline here, takes a trip to OpenSea. */}
                  {href && mine && (
                    <OutLink href={href} target="_blank" rel="noreferrer">
                      List on OpenSea ↗
                    </OutLink>
                  )}
                  {href && !mine && (item.needsKey || os.needsKey) && (
                    <OutLink href={href} target="_blank" rel="noreferrer">
                      Open on OpenSea ↗
                    </OutLink>
                  )}
                </VenueRow>
              )
            }

            return null
          })}
        </VenueList>
        {listingIsMine && <Hint>You listed this one on OpenSea for {formatPrice(listing!.price)}.</Hint>}
        <Hint style={{ color: color.inkMuted }}>
          Buying here uses OpenSea&apos;s order and Seaport contract, the same as buying on OpenSea.
        </Hint>
      </Card>
      <div style={{ height: space[3] }} />
    </>
  )
}

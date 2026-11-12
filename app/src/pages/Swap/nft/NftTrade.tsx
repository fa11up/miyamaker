import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, mainnet } from '@/config/wagmi'
import { groupByCollection } from '@/desktop/files/indexer/parse'
import { useWalletNfts } from '@/desktop/files/useWalletFiles'
import { txWords, useTx } from '@/miyamints/useTx'

import type { Sort } from '../board'
import { isFeaturedSlug, verifiedFirst } from '../board'
import type { SwapChainId, SwapToken } from '../constants'
import { Chip, Eyebrow, Skeleton, StatusBox } from '../floor/retro'
import { bevel, color, space, text } from '../floor/tokens'
import { Body } from '../layout'
import type { CollectionColumn } from '../MarketBoard'
import { CollectionTable, Section } from '../MarketBoard'
import type { CollectionRef } from '../tradePath'
import { poolFactoryAbi } from './abi'
import type { CollectionPlace } from './CollectionView'
import CollectionView from './CollectionView'
import ItemView from './ItemView'
import { OPENSEA_CHAIN } from './markets'
import type { PoolMode } from './pool'
import { filterPools, MODE, MODE_HINT, MODE_LABEL, poolTitle } from './pool'
import House from '../terminal/House'
import PoolView from './PoolView'
import { Card, Field, Head, Hint, LinkButton, Prose, PushButton, SwitchNote } from './ui'
import {
  contractForSlug,
  useCollectionRow,
  useCollectionsVerified,
  useOpenSeaOwned,
  useOpenSeaSearch,
  useOpenSeaCollection,
} from './useMarkets'
import type { Pool } from './usePools'
import { poolFactoryFor, usePools, usePoolsForCollection } from './usePools'

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const Row = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: ${space[1]} ${space[3]};
  padding: ${space[2]} ${space[3]};
  border: none;
  background: ${color.well};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  text-align: left;
  cursor: pointer;
  &:hover {
    background: ${color.hover};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  .pic {
    display: inline-block;
    width: 24px;
    margin-right: ${space[2]};
    vertical-align: middle;
  }
  .name {
    font-size: ${text.md};
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: ${text.sm};
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .meta {
    grid-column: 1 / -1;
    display: flex;
    gap: ${space[2]};
    align-items: center;
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
`

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[4]} ${space[3]};
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  text-align: center;
  align-items: center;
  b {
    font-size: ${text.md};
  }
`

const Soon = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[2]} ${space[3]};
  border: 1px dashed ${color.dark};
  font-size: ${text.sm};
  color: ${color.inkMuted};
`

const CreateRow = styled.div`
  display: flex;
  gap: ${space[2]};
  flex-wrap: wrap;
`

const Footer = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.4;
  color: ${color.inkMuted};
  padding-bottom: ${space[3]};
`

const Picks = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const PickRow = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[1]} ${space[2]};
  min-height: 44px;
  border: none;
  background: ${color.well};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  text-align: left;
  cursor: pointer;
  &:hover {
    background: ${color.hover};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    cursor: progress;
  }
  .pic {
    width: 36px;
  }
  .letter {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    background: ${color.light};
    box-shadow: ${bevel.sunken};
    font-weight: 700;
    text-transform: uppercase;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: ${text.sm};
    font-weight: 700;
  }
  .side {
    font-size: ${text.xs};
    color: ${color.inkMuted};
    white-space: nowrap;
  }
  .warn {
    display: block;
    font-size: ${text.xs};
    font-weight: 400;
    color: ${color.warning};
    white-space: normal;
  }
`

const SectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]};
`

function PoolRow({ chainId, pool, onOpen }: { chainId: number; pool: Pool; onOpen: () => void }) {
  const os = useOpenSeaCollection(chainId, pool.collection)
  return (
    <li>
      <Row type="button" onClick={onOpen} data-pool={pool.address}>
        <span className="name">
          {os.info?.image && (
            <span className="pic" aria-hidden>
              <NftImage src={os.info.image} alt="" variant="thumb" />
            </span>
          )}
          {poolTitle(pool)}
        </span>
        <span className="count">
          {pool.held === undefined ? '– NFTs' : `${pool.held.toLocaleString('en-US')} NFT${pool.held === 1n ? '' : 's'}`}
        </span>
        <span className="meta">
          <Chip tone={pool.mode === MODE.TARGETED ? 'ok' : 'warn'}>{MODE_LABEL[pool.mode]}</Chip>
          <span>{pool.symbol}</span>
        </span>
      </Row>
    </li>
  )
}

function Pick({
  name,
  image,
  side,
  onOpen,
  busy,
  warning,
}: {
  name: string
  image?: string
  side: string
  onOpen: () => void
  busy?: boolean
  /** Said plainly on the row, e.g. that a collection has no OpenSea badge. */
  warning?: string
}) {
  const letter = name.slice(0, 1)
  return (
    <li>
      <PickRow
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={`${name}${warning ? `, ${warning}` : ''}, ${side}. Open`}
        data-pick-unverified={warning ? '' : undefined}
      >
        <span className="pic" aria-hidden>
          {image ? (
            <NftImage src={image} alt="" variant="thumb" missing={<b>{letter}</b>} />
          ) : (
            <span className="letter">{letter}</span>
          )}
        </span>
        <span className="name">
          {name}
          {warning && <span className="warn">{warning}</span>}
        </span>
        <span className="side">{side}</span>
      </PickRow>
    </li>
  )
}

/** One of your collections, under its real name: OpenSea's wallet list gives only a slug. */
function YourCollection({
  group,
  onOpen,
}: {
  group: { slug?: string; name: string; image?: string; count: number }
  onOpen: () => void
}) {
  const { info } = useCollectionRow(group.slug)
  return (
    <Pick
      name={info?.name || group.name}
      image={group.image || info?.image}
      side={`${group.count} held · Open →`}
      onOpen={onOpen}
    />
  )
}

const YOURS_SHOWN = 8

/** The nearest box that scrolls: the pane on a wide window, the whole floor on a slim one. */
function scrollParent(el: HTMLElement | null): HTMLElement | undefined {
  for (let at = el?.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at
  }

  return undefined
}

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Trade's NFTs. The list, on the left of the home page: find a collection (search by name on OpenSea, paste an address, pick one of
 * your NFTs' collections, or a MiyaPool pool), then the collection's Markets (CollectionView), one NFT across
 * markets (ItemView), or one pool (PoolView). Pools come from the MiyaPoolFactory set in env or
 * contracts/deployments; a network without one says so calmly and the other markets still work.
 */
export default function NftTrade({
  query,
  chainId,
  onBusy,
  pool,
  collection,
  visible,
  onOpenPool,
  onOpenCollection,
  onSwapToken,
  section = 'all',
  sweepAsk,
}: {
  /** BUY n from the command line: open the collection's sweep set to n. A new key asks again. */
  sweepAsk?: { key: number; count: number }
  /** The terminal's tabs: NFT shows the collections, POOLS the pools; 'all' is both. */
  section?: 'all' | 'collections' | 'pools'
  /** The home page's search, shared with the tokens. */
  query: string
  /** The floor's one network. */
  chainId: SupportedChainId
  onBusy?: (busy: boolean) => void
  pool?: Address
  collection?: CollectionRef
  /** False while a token's page covers this pane. */
  visible: boolean
  onOpenPool: (pool: Address | undefined) => void
  onOpenCollection: (ref: CollectionRef | undefined) => void
  onSwapToken: (p: { chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }) => void
}) {
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const [opening, setOpening] = useState<string>()
  const [openError, setOpenError] = useState<string>()

  const chain = chains.find((c) => c.id === chainId) || mainnet
  const factory = poolFactoryFor(chainId)
  const list = usePools(chainId, factory)
  const lookup = usePoolsForCollection(chainId, factory, query)
  const search = useOpenSeaSearch(chainId, query)
  const owned = useOpenSeaOwned(chainId, address)
  const walletNfts = useWalletNfts(chainId === mainnet.id && owned.needsKey ? address : undefined)
  const create = useTx(() => {
    lookup.refetch()
    list.refetch()
  })
  // The page open below this one, whose own reviews report here.
  const [pageBusy, setPageBusy] = useState(false)
  const busy = create.busy || pageBusy
  useEffect(() => onBusy?.(busy), [busy])

  // A chosen place survives going back: each page's settings and scroll, and the table's order.
  const [tableSort, setTableSort] = useState<Sort<CollectionColumn>>()
  const places = useRef<Record<string, CollectionPlace>>({})
  // The NFT the viewer's BUY opened: its page opens straight on the buy review.
  const buyNext = useRef<string>()
  const scrolls = useRef<Record<string, number>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const viewKey = collection
    ? `${collection.address}/${collection.tokenId ?? ''}`.toLowerCase()
    : pool
    ? pool.toLowerCase()
    : 'home'
  useLayoutEffect(() => {
    const scroller = visible ? scrollParent(bodyRef.current) : undefined
    if (!scroller) return undefined
    const restore = () => {
      scroller.scrollTop = scrolls.current[viewKey] ?? 0
    }
    restore()
    // Once more after the first paint: a list from the cache may only just have laid out.
    const frame = requestAnimationFrame(restore)
    const save = () => {
      scrolls.current[viewKey] = scroller.scrollTop
    }
    scroller.addEventListener('scroll', save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', save)
    }
  }, [viewKey, visible])

  const [showHidden, setShowHidden] = useState(false)
  const [showAllYours, setShowAllYours] = useState(false)

  const shown = useMemo(() => {
    const found = lookup.pools.filter((p) => !list.pools.some((q) => q.address === p.address))
    return lookup.collection ? [...filterPools(list.pools, query), ...found] : filterPools(list.pools, query)
  }, [list.pools, lookup.pools, lookup.collection, query])

  // Your collections: OpenSea's view of the wallet when the key is set, else the desktop indexer (Ethereum).
  const yours = useMemo(() => {
    if (owned.groups)
      return owned.groups.map((g) => ({
        contract: g.contract,
        slug: g.slug,
        name: g.name,
        image: g.image,
        count: g.ids.length,
        flagged: !!g.flagged,
      }))
    if (!walletNfts.data) return []
    return groupByCollection(walletNfts.data.nfts.filter((n) => n.chainId === chainId)).map((f) => ({
      contract: f.contract,
      slug: undefined,
      flagged: false,
      name: f.name || shortAddress(f.contract),
      image: f.items[0]?.image || undefined,
      count: f.items.length,
    }))
  }, [owned.groups, walletNfts.data, chainId])
  const hiddenCount = yours.filter((g) => g.flagged).length
  const yoursListed = yours.filter((g) => showHidden || !g.flagged)

  // The badge decides the order: the real collection comes before its lookalikes.
  const hitSlugs = useMemo(() => search.hits.slice(0, 12).map((h) => h.slug), [search.hits])
  const looked = useCollectionsVerified(hitSlugs)
  const hitIsVerified = (h: { slug: string; verified?: boolean }) =>
    isFeaturedSlug(chainId, h.slug) ? true : h.verified ?? looked[h.slug]
  const hits = verifiedFirst(search.hits.slice(0, 12), hitIsVerified)

  const openCollection = (contract: string) => onOpenCollection({ chainId, address: contract as Address })
  const openSlug = async (slug: string) => {
    setOpening(slug)
    setOpenError(undefined)
    try {
      const contract = await contractForSlug(slug, chainId)
      if (contract) openCollection(contract)
      else setOpenError(`That collection is not on ${chain.name}.`)
    } catch {
      setOpenError('Could not open that collection. Try pasting its address.')
    } finally {
      setOpening(undefined)
    }
  }

  const wrongChain = isConnected && walletChainId !== chainId
  if (collection && collection.chainId === chainId) {
    // The viewer's BUY is used once: the page it opens reads it on mount, and coming back later asks nothing.
    const itemKey = `${collection.address}/${collection.tokenId}`.toLowerCase()
    const autoBuy = !!collection.tokenId && buyNext.current === itemKey
    if (autoBuy) buyNext.current = undefined
    return (
      <Body ref={bodyRef}>
        {collection.tokenId ? (
          <ItemView
            key={`${collection.address}-${collection.tokenId}`}
            chainId={chainId}
            contract={collection.address}
            tokenId={collection.tokenId}
            onBack={() => onOpenCollection({ chainId, address: collection.address })}
            autoBuy={autoBuy}
            onOpenPool={(p) => onOpenPool(p)}
            onBusy={setPageBusy}
          />
        ) : (
          <CollectionView
            key={collection.address}
            sweepAsk={sweepAsk}
            chainId={chainId}
            address={collection.address}
            onBack={() => onOpenCollection(undefined)}
            onOpenItem={(tokenId, buy) => {
              buyNext.current = buy ? `${collection.address}/${tokenId}`.toLowerCase() : undefined
              onOpenCollection({ chainId, address: collection.address, tokenId })
            }}
            onOpenPool={(p) => onOpenPool(p)}
            onBusy={setPageBusy}
            place={places.current[viewKey]}
            onPlace={(p) => {
              places.current[viewKey] = p
            }}
          />
        )}
      </Body>
    )
  }

  if (pool && factory) {
    return (
      <Body ref={bodyRef}>
        <PoolView
          chainId={chainId}
          address={pool}
          onBack={() => onOpenPool(undefined)}
          onOpenPool={onOpenPool}
          onSwapToken={onSwapToken}
          onBusy={setPageBusy}
          wallet={{
            address,
            isConnected,
            wrongChain,
            switching,
            switchChain,
            switchFailed: !!switchError,
            openConnectModal,
          }}
        />
      </Body>
    )
  }

  const createPool = (mode: PoolMode) =>
    lookup.collection &&
    factory &&
    create.run(`create-${mode}`, {
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'createPool',
      args: [lookup.collection, mode],
      chainId,
    })

  const marketsHere = !!OPENSEA_CHAIN[chainId]
  const nameQuery = query.trim().length >= 2 && !lookup.collection

  return (
    <Body ref={bodyRef}>
      {section !== 'pools' && lookup.collection && (
        <Picks aria-label="Pasted address">
          <Pick
            name={shortAddress(lookup.collection)}
            side="Open →"
            onOpen={() => openCollection(lookup.collection!)}
          />
        </Picks>
      )}

      {section !== 'pools' && nameQuery && marketsHere && (search.loading || hits.length > 0 || search.empty) && (
        <Section aria-label="Collections on OpenSea">
          <h2>Collections</h2>
          <SectionBody>
            {search.loading ? (
              <Skeleton h="44px" />
            ) : search.empty ? (
              <Hint data-search-empty>
                No collections match &quot;{query.trim()}&quot; on {chain.name}. Paste a contract address if you have
                one.
              </Hint>
            ) : (
              <Picks>
                {hits.map((h) => (
                  <Pick
                    key={h.slug}
                    name={h.name}
                    image={h.image}
                    side={opening === h.slug ? 'Opening…' : 'Open →'}
                    busy={!!opening}
                    warning={hitIsVerified(h) === false ? 'Not verified: check the address' : undefined}
                    onOpen={() => openSlug(h.slug)}
                  />
                ))}
              </Picks>
            )}
          </SectionBody>
        </Section>
      )}
      {section !== 'pools' && nameQuery && marketsHere && (search.needsKey || search.failed) && (
        <Hint data-search-failed>Search is not working right now. Paste a contract address instead.</Hint>
      )}
      {openError && (
        <StatusBox tone="error" role="alert">
          <span>{openError}</span>
        </StatusBox>
      )}

      {section !== 'pools' && !query && chainId === 1 && <House onOpen={openCollection} />}
      {section !== 'pools' && !query && <CollectionTable chainId={chainId} onOpen={openCollection} sort={tableSort} onSort={setTableSort} />}

      {section !== 'pools' && !query && yours.length > 0 && (
        <Section aria-label="Your collections">
          <h2>Your NFTs on {chain.name}</h2>
          <SectionBody>
            <Picks>
              {(showAllYours ? yoursListed : yoursListed.slice(0, YOURS_SHOWN)).map((g) => (
                <YourCollection key={g.contract} group={g} onOpen={() => openCollection(g.contract)} />
              ))}
            </Picks>
            {!showAllYours && yoursListed.length > YOURS_SHOWN && (
              <LinkButton type="button" onClick={() => setShowAllYours(true)}>
                Show all ({yoursListed.length})
              </LinkButton>
            )}
            {hiddenCount > 0 && (
              <LinkButton type="button" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Hide flagged' : `Show hidden (${hiddenCount})`}
              </LinkButton>
            )}
          </SectionBody>
        </Section>
      )}

      {section !== 'pools' && !query && (owned.error || walletNfts.isError) && (
        <Hint role="status">Couldn&apos;t load your NFTs on {chain.name}. Try again later.</Hint>
      )}
      {section !== 'pools' && !query && yours.length > 0 && (owned.groups ? owned.partial : !!walletNfts.data?.partial) && (
        <Hint>This wallet has more NFTs than we could list. Paste a collection address to find one.</Hint>
      )}

      {section === 'collections' ? null : !factory ? (
        <Soon role="status" data-pools-not-deployed>
          <Chip tone="warn">Opens soon</Chip>
          <span>NFT pools: sell an NFT for a token and buy one back, with no fees.</span>
        </Soon>
      ) : (
        <>
          <Card aria-label="How NFT pools work">
            <Eyebrow>MiyaPool · 0% fees</Eyebrow>
            <Prose>
              A pool holds NFTs from one collection. Each NFT in it is worth exactly 1 pool token. Sell an NFT to the
              pool and you get 1 token. Pay 1 token and you take an NFT out. No fees.
            </Prose>
          </Card>

          {list.loading ? (
            <List aria-label="Loading pools">
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <Skeleton h="58px" />
                </li>
              ))}
            </List>
          ) : list.error && !list.pools.length ? (
            <StatusBox tone="error" role="alert">
              <span>
                Could not load pools on {chain.name}.{' '}
                <a
                  href="#retry"
                  onClick={(e) => {
                    e.preventDefault()
                    list.refetch()
                  }}
                >
                  Try again
                </a>
              </span>
            </StatusBox>
          ) : shown.length ? (
            <List aria-label={`Pools on ${chain.name}`}>
              {shown.map((p) => (
                <PoolRow key={p.address} chainId={chainId} pool={p} onOpen={() => onOpenPool(p.address)} />
              ))}
            </List>
          ) : !lookup.collection ? (
            <Empty role="status">
              <b>{query ? 'No pool matches that' : `No pools on ${chain.name} yet`}</b>
              <Prose>Paste an NFT collection address above to find its pool or start one.</Prose>
            </Empty>
          ) : null}

          {lookup.collection && lookup.checkFailed && (
            <StatusBox tone="error" role="alert">
              <span>Couldn&apos;t check which pools this collection has. Try again later.</span>
            </StatusBox>
          )}

          {lookup.collection && lookup.freeModes.length > 0 && (
            <Card aria-label="Start a pool">
              <Head>
                <h2>Start a pool for this collection</h2>
              </Head>
              <Prose>Anyone can start one. There is one pool per collection for each way of buying.</Prose>
              <CreateRow>
                {lookup.freeModes.map((m) => (
                  <PushButton
                    key={m}
                    type="button"
                    disabled={create.busy || !isConnected || wrongChain}
                    onClick={() => createPool(m)}
                    title={MODE_HINT[m]}
                  >
                    Start a {MODE_LABEL[m]} pool
                  </PushButton>
                ))}
              </CreateRow>
              <Hint>
                {MODE_LABEL[MODE.TARGETED]}: {MODE_HINT[MODE.TARGETED]} {MODE_LABEL[MODE.RANDOM]}:{' '}
                {MODE_HINT[MODE.RANDOM]} Random pools work only for ERC-721.
              </Hint>
              {!isConnected ? (
                <PushButton type="button" onClick={() => openConnectModal?.()}>
                  Connect wallet
                </PushButton>
              ) : wrongChain ? (
                <>
                  <SwitchNote chainName={chain.name} failed={!!switchError} />
                  <PushButton type="button" onClick={() => switchChain({ chainId })} disabled={switching}>
                    {switching ? 'Switching…' : `Switch to ${chain.name}`}
                  </PushButton>
                </>
              ) : null}
              {create.tx.phase !== 'idle' && (
                <StatusBox tone={create.tx.phase === 'error' ? 'error' : create.tx.phase === 'done' ? 'ok' : 'info'}>
                  {create.busy && <img src={LoadingHourglass} alt="" />}
                  <span>
                    {create.tx.phase === 'done' ? 'Pool started. It is in the list above.' : txWords(create.tx)}
                  </span>
                </StatusBox>
              )}
            </Card>
          )}

          {list.total !== undefined && list.total > list.pools.length && !query && (
            <Hint>
              Showing the newest {list.pools.length} of {list.total} pools. Paste a collection address to find an older
              one.
            </Hint>
          )}
        </>
      )}
      <Footer>
        {factory ? `Pools on ${chain.name}: no fees, no owner, the contracts cannot be changed or paused. ` : ''}
      </Footer>
    </Body>
  )
}

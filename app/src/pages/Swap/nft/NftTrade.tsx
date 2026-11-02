import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import NftImage from '@/components/NftImage'
import { Chip, Eyebrow, Skeleton, StatusBox } from '@/components/Retro'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, mainnet } from '@/config/wagmi'
import { groupByCollection } from '@/desktop/files/indexer/parse'
import { useWalletNfts } from '@/desktop/files/useWalletFiles'
import { txWords, useTx } from '@/miyamints/useTx'
import { bevel, color, space, text } from '@/theme/tokens'

import type { SwapChainId, SwapToken } from '../constants'
import { Body, ChainTabs, Toolbar } from '../layout'
import type { CollectionRef } from '../tradePath'
import { poolFactoryAbi } from './abi'
import CollectionView from './CollectionView'
import ItemView from './ItemView'
import { OPENSEA_CHAIN } from './markets'
import type { PoolMode } from './pool'
import { filterPools, MODE, MODE_HINT, MODE_LABEL, poolTitle } from './pool'
import PoolView from './PoolView'
import { Card, Field, Head, Hint, Prose, PushButton } from './ui'
import type { Pool } from './usePools'
import { contractForSlug, useOpenSeaOwned, useOpenSeaSearch } from './useMarkets'
import { poolFactoryFor, usePools, usePoolsForCollection } from './usePools'

const isPoolChain = (id: number | undefined): id is SupportedChainId => chains.some((c) => c.id === id)

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
    background: ${color.highlight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
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
    background: ${color.highlight};
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
`

function PoolRow({ pool, onOpen }: { pool: Pool; onOpen: () => void }) {
  return (
    <li>
      <Row type="button" onClick={onOpen} data-pool={pool.address}>
        <span className="name">{poolTitle(pool)}</span>
        <span className="count">
          {pool.held.toLocaleString('en-US')} NFT{pool.held === 1n ? '' : 's'}
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
}: {
  name: string
  image?: string
  side: string
  onOpen: () => void
  busy?: boolean
}) {
  return (
    <li>
      <PickRow type="button" onClick={onOpen} disabled={busy} aria-label={`${name}, ${side}. See every market`}>
        <span className="pic">
          <NftImage src={image} alt="" variant="thumb" fallback={name.slice(0, 2)} />
        </span>
        <span className="name">{name}</span>
        <span className="side">{side}</span>
      </PickRow>
    </li>
  )
}

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * The NFTs tab of Trade. The list: find a collection (search by name on OpenSea, paste an address, pick one of
 * your NFTs' collections, or a MiyaPool pool), then the collection's Markets (CollectionView), one NFT across
 * markets (ItemView), or one pool (PoolView). Pools come from the MiyaPoolFactory set in env or
 * contracts/deployments; a network without one says so calmly and the other markets still work.
 */
export default function NftTrade({
  pool,
  collection,
  onOpenPool,
  onOpenCollection,
  onSwapToken,
  onShowTokens,
}: {
  pool?: Address
  collection?: CollectionRef
  onOpenPool: (pool: Address | undefined) => void
  onOpenCollection: (ref: CollectionRef | undefined) => void
  onSwapToken: (p: { chainId: SwapChainId; sell?: SwapToken; buy?: SwapToken }) => void
  onShowTokens: () => void
}) {
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const [chainId, setChainId] = useState<SupportedChainId>(
    collection && isPoolChain(collection.chainId)
      ? collection.chainId
      : isPoolChain(walletChainId)
      ? walletChainId
      : mainnet.id
  )
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string>()
  const [openError, setOpenError] = useState<string>()

  // Follow the wallet onto a supported chain (unless a shared collection link chose one).
  useEffect(() => {
    if (isPoolChain(walletChainId) && walletChainId !== chainId && !collection) setChainId(walletChainId)
  }, [walletChainId])
  useEffect(() => {
    if (collection && isPoolChain(collection.chainId) && collection.chainId !== chainId) setChainId(collection.chainId)
  }, [collection?.chainId])

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

  const shown = useMemo(() => {
    const found = lookup.pools.filter((p) => !list.pools.some((q) => q.address === p.address))
    return lookup.collection ? [...filterPools(list.pools, query), ...found] : filterPools(list.pools, query)
  }, [list.pools, lookup.pools, lookup.collection, query])

  // Your collections: OpenSea's view of the wallet when the key is set, else the desktop indexer (Ethereum).
  const yours = useMemo(() => {
    if (owned.groups) return owned.groups.map((g) => ({ contract: g.contract, name: g.name, image: g.image, count: g.ids.length }))
    if (!walletNfts.data) return []
    return groupByCollection(walletNfts.data.nfts.filter((n) => n.chainId === chainId)).map((f) => ({
      contract: f.contract,
      name: f.name || shortAddress(f.contract),
      image: f.items[0]?.image || undefined,
      count: f.items.length,
    }))
  }, [owned.groups, walletNfts.data, chainId])

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
  const chainPicker = (
    <Toolbar>
      <ChainTabs role="group" aria-label="Network">
        {chains.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === chainId}
            onClick={() => {
              setChainId(c.id)
              if (pool) onOpenPool(undefined)
              if (collection) onOpenCollection(undefined)
            }}
            disabled={create.busy}
          >
            {c.name}
          </button>
        ))}
      </ChainTabs>
    </Toolbar>
  )

  if (collection && collection.chainId === chainId) {
    return (
      <Body>
        {chainPicker}
        {collection.tokenId ? (
          <ItemView
            key={`${collection.address}-${collection.tokenId}`}
            chainId={chainId}
            contract={collection.address}
            tokenId={collection.tokenId}
            onBack={() => onOpenCollection({ chainId, address: collection.address })}
            onOpenPool={(p) => onOpenPool(p)}
          />
        ) : (
          <CollectionView
            key={collection.address}
            chainId={chainId}
            address={collection.address}
            onBack={() => onOpenCollection(undefined)}
            onOpenItem={(tokenId) => onOpenCollection({ chainId, address: collection.address, tokenId })}
            onOpenPool={(p) => onOpenPool(p)}
          />
        )}
      </Body>
    )
  }

  if (pool && factory) {
    return (
      <Body>
        {chainPicker}
        <PoolView
          chainId={chainId}
          address={pool}
          onBack={() => onOpenPool(undefined)}
          onSwapToken={onSwapToken}
          wallet={{ address, isConnected, wrongChain, switching, switchChain, openConnectModal }}
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
    <Body>
      {chainPicker}

      <Field
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={marketsHere ? 'Search collections, or paste an address' : 'Search pools, or paste an address'}
        aria-label="Search collections by name, or paste a collection address"
        spellCheck={false}
      />

      {lookup.collection && (
        <Picks aria-label="Pasted address">
          <Pick
            name={shortAddress(lookup.collection)}
            side="Every market →"
            onOpen={() => openCollection(lookup.collection!)}
          />
        </Picks>
      )}

      {nameQuery && marketsHere && (search.loading || search.hits.length > 0) && (
        <Card aria-label="Collections on OpenSea">
          <Eyebrow>Collections</Eyebrow>
          {search.loading ? (
            <Skeleton h="44px" />
          ) : (
            <Picks>
              {search.hits.map((h) => (
                <Pick
                  key={h.slug}
                  name={h.name}
                  image={h.image}
                  side={opening === h.slug ? 'Opening…' : 'Markets →'}
                  busy={!!opening}
                  onOpen={() => openSlug(h.slug)}
                />
              ))}
            </Picks>
          )}
        </Card>
      )}
      {nameQuery && marketsHere && search.needsKey && (
        <Hint>Search by name needs the OpenSea API key. Paste a collection address instead.</Hint>
      )}
      {openError && (
        <StatusBox tone="error" role="alert">
          <span>{openError}</span>
        </StatusBox>
      )}

      {!query && yours.length > 0 && (
        <Card aria-label="Your collections">
          <Eyebrow>Your NFTs on {chain.name}</Eyebrow>
          <Picks>
            {yours.slice(0, 8).map((g) => (
              <Pick
                key={g.contract}
                name={g.name}
                image={g.image}
                side={`${g.count} held · Markets →`}
                onOpen={() => openCollection(g.contract)}
              />
            ))}
          </Picks>
        </Card>
      )}

      {!factory ? (
        <Empty role="status" data-pools-not-deployed>
          <b>NFT pools are not on {chain.name} yet</b>
          <Prose>
            Pools let you sell an NFT for a token and buy one back, with no fees. They open here when the pool contract
            goes live on {chain.name}.
            {marketsHere ? ' You can still see OpenSea, Blur and Magic Eden prices: search or paste an address above.' : ''}
          </Prose>
          <PushButton type="button" onClick={onShowTokens}>
            Swap tokens instead
          </PushButton>
        </Empty>
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
                <PoolRow key={p.address} pool={p} onOpen={() => onOpenPool(p.address)} />
              ))}
            </List>
          ) : !lookup.collection ? (
            <Empty role="status">
              <b>{query ? 'No pool matches that' : `No pools on ${chain.name} yet`}</b>
              <Prose>Paste an NFT collection address above to find its pool or start one.</Prose>
            </Empty>
          ) : null}

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
                <PushButton type="button" onClick={() => switchChain({ chainId })} disabled={switching}>
                  {switching ? 'Switching…' : `Switch to ${chain.name}`}
                </PushButton>
              ) : null}
              {create.tx.phase !== 'idle' && (
                <StatusBox tone={create.tx.phase === 'error' ? 'error' : create.tx.phase === 'done' ? 'ok' : 'info'}>
                  {create.busy && <img src={LoadingHourglass} alt="" />}
                  <span>{create.tx.phase === 'done' ? 'Pool started. It is in the list above.' : txWords(create.tx)}</span>
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
        {marketsHere
          ? 'Other markets: OpenSea, Blur and Magic Eden. Open any collection to compare them.'
          : `OpenSea, Blur and Magic Eden do not trade on ${chain.name}.`}
      </Footer>
    </Body>
  )
}

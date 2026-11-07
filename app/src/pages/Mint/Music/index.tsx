import { useQuery } from '@tanstack/react-query'
import PlaceholderImage from 'assets/explorer/sample/collections.jpeg'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Hash } from 'viem'
import { formatEther, isAddress, zeroHash } from 'viem'
import { useAccount, useWriteContract } from 'wagmi'

import { TX_REVERTED_WORDS, TX_CANCELLED_WORDS, TX_UNCONFIRMED_WORDS } from '@/miyamints/txOutcome'
import { useTxOutcome } from '@/miyamints/useTxOutcome'
import { ConnectedButton } from '@/components/Button'
import { Skeleton, StatusBox } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { useRadio } from '@/context/RadioProvider'
import { erc1155InstanceAbi } from '@/music/abi'
import { formatDuration } from '@/music/audio'
import { LISTED_MUSIC_CHAINS, musicConfig } from '@/music/config'
import type { MusicItem } from '@/music/discovery'
import { discoverMusic } from '@/music/discovery'
import { addKnownCollection, onKnownCollectionsChange } from '@/music/known'
import { useAddToRadio } from '@/music/useAddToRadio'
import { PAINTED } from '@/pages/Mint/handheld/Carousel'
import Device, { Lcd } from '@/pages/Mint/handheld/Device'
import { useHandheld } from '@/pages/Mint/handheld/nav'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import { space, text } from '@/theme/tokens'
import { resolveUri } from '@/utils/resolveUri'

const List = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[2]};
  overflow-y: auto;
  background:
    linear-gradient(rgba(14, 8, 34, 0.55), rgba(14, 8, 34, 0.55)),
    ${PAINTED};
  color: #f1eeff;
  font-size: ${text.sm};
  a {
    color: #9fe8ff;
  }
  p {
    margin: 0;
    line-height: 1.35;
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]};
  select,
  input {
    height: 36px;
    border: none;
    border-radius: 2px;
    padding: 0 6px;
    font-size: 16px;
    min-width: 0;
  }
  input {
    flex: 1 1 100%;
    font-family: inherit;
  }
`

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space[2]};
`

const Card = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  min-width: 0;
  padding: 4px;
  border-radius: 4px;
  background: #2a2638;
`

const Art = styled.div`
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: #000;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border: none;
    margin: 0;
    max-width: none;
  }
  img:hover {
    border: none;
  }
`

const PlayOver = styled.button`
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 0;
  z-index: 1;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 15%, #ff9d93 0%, #e4120b 60%, #a50503 100%);
  color: #fff;
  box-shadow: 0 0 0 2px #3a0504, 0 0 0 4px #c4cad2, 0 2px 4px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    width: 18px;
    height: 18px;
  }
  &:active {
    transform: translateY(2px);
  }
  &:focus-visible {
    outline: 2px dashed #fff35c;
    outline-offset: 5px;
  }
`

const Title = styled.div`
  font-size: ${text.sm};
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Sub = styled.div`
  font-size: ${text.xs};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Actions = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${space[1]};
  button {
    min-width: 0;
    font-size: ${text.xs};
  }
`

const Small = styled.button`
  min-height: 34px;
  padding: 0 ${space[1]};
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: ${text.xs};
  color: #14101f;
  background: radial-gradient(ellipse at 50% 10%, #fff, #b9c2cd 80%);
  box-shadow: 0 0 0 1px #14101f;
  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`

const PlayGlyph = () => (
  <svg viewBox="0 0 10 10" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M2 1h1v8H2zM3 2h1v6H3zM4 2h1v6H4zM5 3h1v4H5zM6 3h1v4H6zM7 4h1v2H7z" />
  </svg>
)

function Cover({ uri, alt }: { uri?: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  const src = uri && !failed ? resolveUri(uri) : PlaceholderImage
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      style={failed || !uri ? { opacity: 0.6 } : undefined}
    />
  )
}

function MintEdition({ item }: { item: MusicItem }) {
  const write = useWriteContract()
  const { outcome } = useTxOutcome(item.chainId, write.data as Hash | undefined)
  const nav = useHandheld()
  const ed = item.edition
  const busy = write.isPending || outcome === 'waiting'
  const holding = busy || outcome === 'unknown'
  useEffect(() => (holding ? nav.hold?.() : undefined), [holding])
  // Wakes up when the edition opens, so its button doesn't stay on "Not open yet".
  const [now, setNow] = useState(() => Date.now())
  const opensAt = Number(ed?.openTime ?? 0n) * 1000
  useEffect(() => {
    if (opensAt <= now) return undefined
    const t = setTimeout(() => setNow(Date.now()), Math.min(opensAt - now, 60 * 60_000))
    return () => clearTimeout(t)
  }, [opensAt, now])
  if (!ed) return null
  const soldOut = ed.supply > 0n && ed.minted >= ed.supply
  const notOpen = opensAt > now
  const minted = outcome === 'success'
  // Sent, but its receipt couldn't be read: it may still land, so the same mint isn't offered again.
  const unconfirmed = outcome === 'unknown'
  const err = describeError(write.error)
  return (
    <>
      <ConnectedButton
        withChain={[item.chainId]}
        disabled={busy || minted || (!unconfirmed && (soldOut || notOpen))}
        style={{ width: '100%', minWidth: 0 }}
        onClick={() =>
          unconfirmed ? write.reset() :
          write.writeContract({
            address: item.collection,
            abi: erc1155InstanceAbi,
            chainId: item.chainId as never,
            functionName: 'mint',
            // amount 1, open gating, no message, maxCost = the quoted price (reverts if the price moved up)
            args: [item.tokenId, 1n, zeroHash, '', ed.price],
            value: ed.price,
          })
        }
      >
        {busy
          ? 'Minting…'
          : minted
          ? 'Minted!'
          : unconfirmed
          ? 'Start over'
          : soldOut
          ? 'Sold out'
          : notOpen
          ? 'Not open yet'
          : `Mint · ${formatEther(ed.price)} ETH`}
      </ConnectedButton>
      {outcome === 'cancelled' && (
        <StatusBox tone="info" role="status" style={{ fontSize: text.xs }}>
          <span>{TX_CANCELLED_WORDS}</span>
        </StatusBox>
      )}
      {(outcome === 'reverted' || unconfirmed || (write.error && !err.cancelled)) && (
        <StatusBox tone="error" role="alert" style={{ fontSize: text.xs }}>
          <span>
            {outcome === 'reverted' ? TX_REVERTED_WORDS : unconfirmed ? TX_UNCONFIRMED_WORDS : err.message}
          </span>
        </StatusBox>
      )}
    </>
  )
}

/** Mint → Music: on-chain music drops with a play button that hands the track to miya radio. */
export default function MusicDrops() {
  const nav = useHandheld()
  const list = useRef<HTMLDivElement>(null)
  const radio = useRadio()
  const addToRadio = useAddToRadio()
  const { chainId: walletChain } = useAccount()
  const [chainId, setChainId] = useState(musicConfig(walletChain).chainId)
  const [address, setAddress] = useState('')
  const [addError, setAddError] = useState('')
  const [version, setVersion] = useState(0)
  const cfg = musicConfig(chainId)

  useEffect(() => onKnownCollectionsChange(() => setVersion((v) => v + 1)), [])

  const query = useQuery({
    queryKey: ['music-drops', chainId, version],
    queryFn: () => discoverMusic(chainId),
    staleTime: 60_000,
  })
  const items = query.data || []

  const add = () => {
    const a = address.trim()
    if (!isAddress(a)) {
      setAddError('Paste a contract address (0x…).')
      return
    }

    setAddError('')
    addKnownCollection(chainId, a)
    setAddress('')
  }

  const first = items[0]
  const action = first
    ? { label: `Play ${first.music.title}`, onClick: () => radio.playNow(first.track) }
    : { label: 'No songs yet', disabled: true, onClick: () => {} }

  return (
    <Device
      title="Music drops"
      lamp={{ color: cfg.factory ? '#3dff7a' : '#ffc400', label: cfg.factory ? 'Music drops' : 'Opens soon', }}
      screen={
        <List ref={list} className="scroll">
          {addError && (
            <StatusBox tone="error" role="alert">
              <span>{addError}</span>
            </StatusBox>
          )}

          {query.isLoading ? (
            <Cards>
              {Array.from({ length: 2 }, (_, i) => (
                <Card key={i}>
                  <Skeleton style={{ aspectRatio: '1 / 1' }} h="auto" />
                  <Skeleton h="16px" />
                </Card>
              ))}
            </Cards>
          ) : items.length === 0 ? (
            <p>
              {cfg.factory
                ? `No music drops on ${cfg.name} yet. Be the first to release one.`
                : 'No music drops yet. Songs you can collect will show up here when music releases open.'}
            </p>
          ) : (
            <Cards>
              {items.map((item) => (
                <Card key={item.key} aria-label={item.music.title}>
                  <Art>
                    <Cover uri={item.music.image} alt={`${item.music.title} cover`} />
                    <PlayOver
                      type="button"
                      aria-label={`Play ${item.music.title} in miya radio`}
                      title="Play in miya radio"
                      onClick={() => radio.playNow(item.track)}
                    >
                      <PlayGlyph />
                    </PlayOver>
                  </Art>
                  <div>
                    <Title title={item.music.title}>{item.music.title}</Title>
                    <Sub>{item.music.artist || item.collectionName || 'Unknown artist'}</Sub>
                    <Sub>
                      {formatDuration(item.music.duration)}
                      {item.music.genre ? ` · ${item.music.genre}` : ''}
                      {item.edition
                        ? ` · ${item.edition.minted}${item.edition.supply ? `/${item.edition.supply}` : ''}`
                        : ''}
                    </Sub>
                  </div>
                  <Actions>
                    <Small type="button" onClick={() => radio.playNow(item.track)}>
                      Play
                    </Small>
                    <Small type="button" onClick={() => addToRadio(item.track)}>
                      Add to radio
                    </Small>
                  </Actions>
                  <MintEdition item={item} />
                  <Sub>
                    <a href={`${explorerUrl(item.chainId)}/address/${item.collection}`} target="_blank" rel="noreferrer">
                      {item.collectionName || `${item.collection.slice(0, 6)}…${item.collection.slice(-4)}`}
                    </a>{' '}
                    #{item.tokenId.toString()}
                  </Sub>
                </Card>
              ))}
            </Cards>
          )}

          <Toolbar aria-label="Find music">
            <select aria-label="Network" value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
              {LISTED_MUSIC_CHAINS.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
            </select>
            <Small type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? 'Scanning…' : 'Refresh'}
            </Small>
            <input
              aria-label="Collection address"
              placeholder="Add any ERC-721/1155 with audio (0x…)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Small type="button" onClick={add}>
              Add
            </Small>
          </Toolbar>
        </List>
      }
      lcd={
        <Lcd>
          <div>
            <span>Music drops</span>
            <span>{items.length} SONGS</span>
          </div>
          <div>
            <span>{cfg.name}</span>
          </div>
          <div>
            <span>Ⓐ {action.label}</span>
          </div>
        </Lcd>
      }
      a={action}
      b={{ label: 'Menu', disabled: nav.held, onClick: nav.openMenu }}
      start={action}
      dpad={{
        up: () => list.current?.scrollBy({ top: -120, behavior: 'smooth' }),
        down: () => list.current?.scrollBy({ top: 120, behavior: 'smooth' }),
      }}
    />
  )
}

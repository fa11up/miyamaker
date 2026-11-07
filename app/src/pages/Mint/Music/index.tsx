import { useQuery } from '@tanstack/react-query'
import PlaceholderImage from 'assets/explorer/sample/collections.jpeg'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import type { Hash } from 'viem'
import { formatEther, isAddress, zeroHash } from 'viem'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { ConnectedButton } from '@/components/Button'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, Skeleton, StatusBox, Well } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { useRadio } from '@/context/RadioProvider'
import { erc1155InstanceAbi } from '@/music/abi'
import { formatDuration } from '@/music/audio'
import { LISTED_MUSIC_CHAINS, musicConfig } from '@/music/config'
import type { MusicItem } from '@/music/discovery'
import { discoverMusic } from '@/music/discovery'
import { addKnownCollection, onKnownCollectionsChange } from '@/music/known'
import { useAddToRadio } from '@/music/useAddToRadio'
import { useOpenApp } from '@/music/useOpenApp'
import { queueRemoteOpen } from '@/pages/MusicMaker/remoteOpen.js'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import { bevel, color, space, text } from '@/theme/tokens'
import { resolveUri } from '@/utils/resolveUri'

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[4]};
  max-width: 980px;
  margin: 0 auto;
  .narrow & {
    padding: ${space[3]};
  }
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Toolbar = styled(Panel)`
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  padding: ${space[2]} ${space[3]};
  gap: ${space[2]};
  select,
  input {
    height: 30px;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    padding: 0 6px;
    font-size: ${text.sm};
    min-width: 0;
  }
  input {
    flex: 1 1 220px;
    font-family: inherit;
  }
`

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: ${space[3]};
`

const Card = styled(Panel)`
  padding: ${space[2]};
  gap: ${space[2]};
`

const Art = styled(Well)`
  position: relative;
  aspect-ratio: 1 / 1;
  padding: 3px;
  overflow: hidden;
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
  right: 8px;
  bottom: 8px;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 0;
  background: ${color.accent};
  color: ${color.ink};
  box-shadow: inset -2px -2px ${color.accentDark}, inset 2px 2px #f5c6f6, 2px 2px 0 ${color.dark};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    width: 18px;
    height: 18px;
  }
  &:active {
    box-shadow: inset 2px 2px ${color.accentDark}, inset -2px -2px #f5c6f6;
  }
  &:focus-visible {
    outline: 2px dotted ${color.highlight};
    outline-offset: -6px;
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
  color: ${color.inkMuted};
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
  border: none;
  border-radius: 0;
  min-height: 28px;
  padding: 0 ${space[2]};
  background: ${color.face};
  box-shadow: ${bevel.raised};
  font-size: ${text.xs};
  cursor: pointer;
  &:hover:not(:disabled) {
    background: ${color.faceLight};
  }
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
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
  const receipt = useWaitForTransactionReceipt({
    hash: write.data as Hash | undefined,
    chainId: item.chainId as never,
    query: { enabled: !!write.data },
  })
  const ed = item.edition
  if (!ed) return null
  const soldOut = ed.supply > 0n && ed.minted >= ed.supply
  const notOpen = ed.openTime > 0n && ed.openTime * 1000n > BigInt(Date.now())
  const busy = write.isPending || (!!write.data && receipt.isLoading)
  const err = describeError(write.error || receipt.error)
  return (
    <>
      <ConnectedButton
        withChain={[item.chainId]}
        disabled={soldOut || notOpen || busy || receipt.isSuccess}
        style={{ width: '100%', minWidth: 0 }}
        onClick={() =>
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
        {soldOut
          ? 'Sold out'
          : notOpen
          ? 'Not open yet'
          : busy
          ? 'Minting…'
          : receipt.isSuccess
          ? 'Minted!'
          : `Mint · ${formatEther(ed.price)} ETH`}
      </ConnectedButton>
      {(write.error || receipt.error) && !err.cancelled && (
        <StatusBox tone="error" role="alert" style={{ fontSize: text.xs }}>
          <span>{err.message}</span>
        </StatusBox>
      )}
    </>
  )
}

/** Mint → Music: on-chain music drops with a play button that hands the track to miya radio. */
export default function MusicDrops({ onBack }: { onBack: () => void }) {
  const radio = useRadio()
  const addToRadio = useAddToRadio()
  const openApp = useOpenApp()
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

  const openMaker = (uri: string | undefined, kind: 'song' | 'kit', name: string) => {
    const href = uri ? resolveUri(uri) : ''
    if (!href) return
    queueRemoteOpen({ href, kind, name })
    openApp('music')
  }

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

  const [ref, { width }] = useElementSize()
  const narrow = width > 0 && width <= 620

  return (
    <Layout ref={ref} className={narrow ? 'narrow' : undefined}>
      <Wrap>
        <Head>
          <div>
            <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>Mint · Music</Eyebrow>
            <DisplayTitle>Music drops</DisplayTitle>
          </div>
          <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
            <Small type="button" onClick={onBack}>
              ← All mints
            </Small>
            <Small type="button" onClick={() => openApp('radio')}>
              Open miya radio
            </Small>
            <Small type="button" onClick={() => openApp('dropmusic')}>
              Drop Music
            </Small>
          </div>
        </Head>

        <Toolbar aria-label="Find music">
          <select aria-label="Network" value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
            {LISTED_MUSIC_CHAINS.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </select>
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
          <Small type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? 'Scanning…' : 'Refresh'}
          </Small>
          {!cfg.factory && <Chip tone="warn">Opens soon</Chip>}
        </Toolbar>
        {addError && (
          <StatusBox tone="error" role="alert">
            <span>{addError}</span>
          </StatusBox>
        )}

        {query.isLoading ? (
          <Cards>
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i}>
                <Skeleton style={{ aspectRatio: '1 / 1' }} h="auto" />
                <Skeleton h="16px" />
              </Card>
            ))}
          </Cards>
        ) : items.length === 0 ? (
          <Panel>
            <p style={{ margin: 0 }}>
              {cfg.factory
                ? `No music drops on ${cfg.name} yet. Be the first to release one.`
                : 'No music drops yet. Songs you can collect will show up here when music releases open.'}
            </p>
            <BigButton
              type="button"
              style={{ maxWidth: 280, minHeight: 40, fontSize: text.sm }}
              onClick={() => openApp('dropmusic')}
            >
              I make music: release a song
            </BigButton>
          </Panel>
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
                      ? ` · ${item.edition.minted}${item.edition.supply ? `/${item.edition.supply}` : ''} minted`
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
                  {item.music.song && (
                    <Small
                      type="button"
                      onClick={() => openMaker(item.music.song, 'song', item.music.title)}
                    >
                      Open song
                    </Small>
                  )}
                  {item.music.kit && (
                    <Small
                      type="button"
                      title="Replaces the current kit"
                      onClick={() => openMaker(item.music.kit, 'kit', item.music.title)}
                    >
                      Load kit
                    </Small>
                  )}
                </Actions>
                <MintEdition item={item} />
                <Sub>
                  <a
                    href={`${explorerUrl(item.chainId)}/address/${item.collection}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: color.link }}
                  >
                    {item.collectionName || `${item.collection.slice(0, 6)}…${item.collection.slice(-4)}`}
                  </a>{' '}
                  #{item.tokenId.toString()}
                </Sub>
              </Card>
            ))}
          </Cards>
        )}
      </Wrap>
    </Layout>
  )
}

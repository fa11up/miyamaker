import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address, Hash } from 'viem'
import { formatEther } from 'viem'
import { useAccount, useBalance, useEnsName, usePublicClient } from 'wagmi'

import ArtViewer from '@/components/ArtViewer'
import { NormalButton } from '@/components/Button/NormalButton'
import { Skeleton } from '@/components/Retro'
import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import { shortAddress } from '@/desktop/mints/dedupe'
import { useWaitForTransaction } from '@/hooks/useWaitForTransaction'
import {
  BID_REVERTED,
  BID_UNCONFIRMED,
  bidErrorWords,
  bidStanding,
  checkBid,
  lotFacts,
  lotPhase,
  minimumBid,
} from '@/pages/Auction/bidding'
import BidContainer from '@/pages/Auction/ProductDetail/BidContainer'
import ImagesList from '@/pages/Auction/ProductDetail/ImagesList'
import { useAuctionData } from '@/pages/Auction/useAuctionData'
import { useFitText } from '@/pages/Auction/useFitText'
import { useLotGallery } from '@/pages/Auction/useLots'
import { usePlaceBid } from '@/pages/Auction/usePlaceBid'
import { useToken } from '@/pages/Auction/useToken'
import { setCurrentToken } from '@/store/collections/actions'
import { NO_LOT } from '@/store/collections/reducer'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { color } from '@/theme/tokens'

const DetailColumn = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 0.5rem;
`

const BackRow = styled.div`
  flex: none;
`

const ProductDetailWrapper = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 1.5rem;

  @media only screen and (max-width: 640px) {
    flex-direction: column;
    gap: 0.75rem;
  }
`

const ImagesListWrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: transparent;
  flex: 0 0 33.3333%;
  min-width: 0;

  @media only screen and (max-width: 640px) {
    flex-basis: auto;
  }
`

/* A gallery placard: title, artist and collection, then the description, then the facts and the bid. The
   description takes whatever height is left and its text steps down in size (useFitText) so it always fits. */
const Placard = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 0.6rem;
  overflow-wrap: anywhere;
`

const Heading = styled.div`
  flex: none;
  line-height: 1.25;
`

const Title = styled.div`
  font-size: 1.1rem;
  font-weight: bolder;
`

const Byline = styled.div`
  font-size: 0.85rem;
  margin-top: 0.15rem;

  > b {
    text-transform: uppercase;
  }
`

const Collection = styled.div`
  font-size: 0.75rem;
  color: #5f4030;
  margin-top: 0.15rem;
`

const Description = styled.p`
  flex: 0 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  line-height: 1.3;
  white-space: pre-line;
`

const ReadMore = styled.button`
  flex: none;
  align-self: flex-start;
  margin-top: -0.35rem;
  padding: 0;
  border: none;
  background: transparent;
  color: #7a1620;
  font-size: 0.75rem;
  text-decoration: underline;
  cursor: pointer;

  :focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: 2px;
  }
`

const BidArea = styled.div`
  flex: none;
`

const Facts = styled.dl`
  flex: none;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.25rem;
  margin: 0;
  padding-top: 0.6rem;
  border-top: 1px solid #c9a862;
  box-shadow: inset 0 1px 0 #fffaf0;
  font-size: 0.8rem;
  line-height: 1.2;

  > dt {
    color: #5f4030;
  }

  > dd {
    margin: 0;
    min-width: 0;
  }
`

const Updated = styled.span`
  margin-left: 0.5rem;
  color: #5f4030;
  font-size: 0.75rem;
`

export default function ProductDetail({
  setErrorMessage,
  auctionContract,
  onBack,
}: {
  setErrorMessage: (value: string) => void
  auctionContract: Address
  onBack: () => void
}) {
  const dispatch = useAppDispatch()
  // Account
  const { address: account, chain, isConnected } = useAccount()
  const { data: wallet } = useBalance({
    address: account,
    chainId: AUCTION_CHAIN_ID,
    query: { enabled: !!account, refetchInterval: 30_000 },
  })
  const balance = wallet?.value
  const client = usePublicClient({ chainId: AUCTION_CHAIN_ID })

  const nft = useAppSelector((state) => state.collections.currentNFT)
  const currentAuctionToken = useAppSelector((state) => state.collections.currentToken)
  const chosenTokenId = useAppSelector((state) => state.collections.currentTokenId)
  const nftContract = useAppSelector((state) => state.collections.currentNFTContract)
  const tokenIds = useAppSelector((state) => state.auction.currentTokenIds)
  const tokenURIs = useAppSelector((state) => state.auction.currentTokenURIs)
  // Until a lot is chosen the panel shows the first one, so its art, its bid data and any bid all name the same token.
  const tokenId = chosenTokenId === NO_LOT ? tokenIds[0] : chosenTokenId

  const [busy, setBusy] = useState<'wallet' | 'mining'>()
  const [txHash, setTxHash] = useState('')
  const [bidAmount, setBidAmount] = useState('')
  const [viewing, setViewing] = useState(false)
  const [confirmedLot, setConfirmedLot] = useState<string>()
  // The countdown, the "updated" age and the moment bidding closes all run off this.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Get contract data
  const { status, currentBid, minPrice, startTime, endTime, settled, bidIncrement, bidder, updatedAt, refetch } =
    useAuctionData({
      nft: nftContract,
      tokenId,
      address: auctionContract,
      live: true,
    })
  const { placeBid } = usePlaceBid({ address: auctionContract, bidAmount })
  const { name, description, image, attributes } = useToken({ tokenURI: tokenURIs[0] || '', isFetch: !!tokenId })
  const gallery = useLotGallery({ nft: nftContract, tokenIds, tokenURIs, address: auctionContract })

  const phase = lotPhase({ status, startTime, endTime, settled }, now)
  const facts = lotFacts({ phase, bidder, currentBid, minPrice })
  const minimum = minimumBid({ currentBid, minPrice, bidIncrement })
  const check = checkBid(bidAmount, minimum, balance)
  const canSend = isConnected && chain?.id === AUCTION_CHAIN_ID

  // Being overtaken is only news to someone this window has seen in the lead.
  const lotKey = `${nftContract}:${tokenId}:${account}`
  const ledLots = useRef(new Set<string>())
  if (phase === 'live' && account && bidder.toLowerCase() === account.toLowerCase()) ledLots.current.add(lotKey)
  const standing = phase === 'live' ? bidStanding(bidder, account, ledLots.current.has(lotKey)) : 'none'
  let standingNote: { good: boolean; words: string } | undefined
  if (standing === 'leading') {
    standingNote = { good: true, words: `You're the highest bidder at ${formatEther(currentBid)} ETH.` }
  } else if (standing === 'outbid') {
    standingNote = { good: false, words: "You've been outbid. Your ETH came back to your wallet." }
  } else if (confirmedLot === lotKey) {
    standingNote = { good: true, words: 'Your bid went through.' }
  }

  // The arrows step through the lots in list order and wrap round. Metadata is cached, shared with the lot cards.
  const lotIndex = Math.max(0, tokenIds.indexOf(tokenId as number))
  const lotCount = tokenIds.length
  const previousIndex = (lotIndex - 1 + lotCount) % lotCount
  const nextIndex = (lotIndex + 1) % lotCount
  const previousLot = useToken({ tokenURI: tokenURIs[previousIndex] || '', isFetch: lotCount > 1 })
  const nextLot = useToken({ tokenURI: tokenURIs[nextIndex] || '', isFetch: lotCount > 1 })
  const openLot = (index: number, lot: typeof nextLot) => {
    const id = tokenIds[index]
    if (id === undefined || !lot.image) return
    dispatch(
      setCurrentToken({
        tokenId: id,
        metadata: {
          name: lot.name,
          description: lot.description,
          image: lot.image,
          external_url: lot.externalURL,
          attributes: lot.attributes,
        },
      })
    )
  }

  // A bid typed for one piece must not carry over to the next.
  useEffect(() => {
    setBidAmount('')
  }, [tokenId])

  const highestBidderENS = useEnsName({
    address: bidder as Address,
    chainId: 1,
    query: { enabled: !facts.bidderValue },
  })

  const bidSettled = () => {
    setBusy(undefined)
    setTxHash('')
    refetch()
  }

  useWaitForTransaction({
    hash: (txHash as Address) || '0x',
    enabled: !!txHash,
    onSuccess: (receipt) => {
      bidSettled()
      if (receipt.status === 'reverted') {
        setErrorMessage(BID_REVERTED)
        return
      }
      setBidAmount('')
      setConfirmedLot(lotKey)
    },
    // wagmi turns a reverted receipt into an error, so a failure here may be a real answer or only a failed wait.
    onError: async (error) => {
      console.error('Waiting for bid failed', error)
      const receipt = await client?.getTransactionReceipt({ hash: txHash as Hash }).catch(() => undefined)
      bidSettled()
      setErrorMessage(receipt?.status === 'reverted' ? BID_REVERTED : BID_UNCONFIRMED)
    },
    // A sped-up bid is still the same bid, and its own receipt arrives through this wait. A cancelled one is over.
    onReplaced: (reason) => {
      if (reason !== 'cancelled') return
      bidSettled()
      setErrorMessage('You cancelled in your wallet. No bid was placed.')
    },
  })

  // The input is controlled by bidAmount, so the value sent is always exactly what is shown. '' is allowed (clearing
  // the field); edits that are not a decimal number are rejected and leave the field unchanged.
  const handleCheckBidAmount = (value: string) => {
    const re = /(^[0-9]+\.?[0-9]*$)|(^\.[0-9]*$)/
    if (value !== '' && !re.test(value)) return
    setBidAmount(value)
  }

  const handleBid = async () => {
    if (!canSend || !check.valid || busy || phase !== 'live' || tokenId === undefined) return
    setBusy('wallet')
    try {
      const result = await placeBid(nftContract, tokenId)
      setTxHash(result.hash)
      setBusy('mining')
    } catch (e) {
      console.error('Bid failed', e)
      setBusy(undefined)
      setErrorMessage(bidErrorWords(e))
      refetch()
    }
  }

  useEffect(() => {
    refetch()
  }, [currentAuctionToken, refetch])

  // useEffect(() => {
  //   if (endTime * 1000 < new Date().getTime()) {
  //     setErrorMessage(ERROR_MESSAGES.AUCTION_ENDED)
  //     setErrorName('MiyaAuction Notice')
  //   }
  // }, [endTime, setErrorMessage, setErrorName])
  //
  // if (endTime * 1000 < new Date().getTime()) {
  //   return <ProductDetailWrapper />
  // }

  const tokenName = currentAuctionToken.name || name
  const tokenDescription = currentAuctionToken.description || description
  const tokenAttributes = currentAuctionToken.attributes.length > 0 ? currentAuctionToken.attributes : attributes
  const artist = tokenAttributes.find((item) => item.trait_type === 'Artist')?.value
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const descriptionFit = useFitText(
    descriptionRef,
    tokenDescription,
    undefined,
    `${phase}:${!!standingNote}:${check.valid}:${balance !== undefined}`
  )
  const dimensions = tokenAttributes.find((item) => item.trait_type === 'Dimensions')?.value
  const known = phase !== 'loading' && phase !== 'failed' && phase !== 'missing'

  return (
    <DetailColumn>
      <BackRow>
        <NormalButton type="button" onClick={onBack}>
          ← Collections
        </NormalButton>
      </BackRow>
      <ProductDetailWrapper>
        <ImagesListWrapper>
          <ImagesList
            image={currentAuctionToken.image || image}
            position={lotIndex}
            total={lotCount}
            onPrevious={() => openLot(previousIndex, previousLot)}
            onNext={() => openLot(nextIndex, nextLot)}
            onView={() => setViewing(true)}
          />
          {viewing && gallery.items.length > 0 && (
            <ArtViewer
              skin="auction"
              onClose={() => setViewing(false)}
              items={gallery.items}
              startIndex={Math.max(0, gallery.ids.indexOf(tokenId as number))}
            />
          )}
        </ImagesListWrapper>
        <Placard>
          <Heading>
            <Title>{tokenName}</Title>
            {artist && (
              <Byline>
                by <b>{artist}</b>
              </Byline>
            )}
            {nft.name && <Collection>{nft.name}</Collection>}
          </Heading>
          {tokenDescription && (
            <Description ref={descriptionRef} style={{ fontSize: descriptionFit.size }}>
              {tokenDescription}
            </Description>
          )}
          {descriptionFit.overflow && (
            <ReadMore type="button" onClick={() => setViewing(true)}>
              Read the full description
            </ReadMore>
          )}
          <Facts>
            {dimensions && (
              <>
                <dt>Dimensions</dt>
                <dd>{dimensions}</dd>
              </>
            )}
            {known ? (
              <>
                <dt>{facts.bidLabel}</dt>
                <dd>
                  {facts.bidValue}
                  {phase === 'live' && updatedAt > 0 && (
                    <Updated>Updated {Math.max(0, Math.floor((now - updatedAt) / 1000))}s ago</Updated>
                  )}
                </dd>
                <dt>{facts.bidderLabel}</dt>
                <dd title={facts.bidderValue ? undefined : bidder}>
                  {facts.bidderValue || highestBidderENS?.data || shortAddress(bidder)}
                </dd>
              </>
            ) : (
              phase === 'loading' && (
                <>
                  <dt>
                    <Skeleton h="0.9em" w="5rem" />
                  </dt>
                  <dd>
                    <Skeleton h="0.9em" w="7rem" />
                  </dd>
                  <dt>
                    <Skeleton h="0.9em" w="5rem" />
                  </dt>
                  <dd>
                    <Skeleton h="0.9em" w="7rem" />
                  </dd>
                </>
              )
            )}
          </Facts>
          <BidArea>
            <BidContainer
              phase={phase}
              startTime={startTime}
              endTime={endTime}
              now={now}
              bidAmount={bidAmount}
              onBidAmount={handleCheckBidAmount}
              onBid={handleBid}
              onRetry={() => refetch()}
              minimum={minimum}
              check={check}
              busy={busy}
              canSend={canSend}
              balance={balance}
              standing={standingNote}
            />
          </BidArea>
        </Placard>
      </ProductDetailWrapper>
    </DetailColumn>
  )
}

import { get } from 'lodash'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import { useAccount, useEnsName } from 'wagmi'

import ArtViewer, { toArtwork } from '@/components/ArtViewer'
import type { BalanceData } from '@/context/AccountProvider'
import { shortAddress } from '@/desktop/mints/dedupe'
import { useWaitForTransaction } from '@/hooks/useWaitForTransaction'
import BidContainer from '@/pages/Auction/ProductDetail/BidContainer'
import ImagesList from '@/pages/Auction/ProductDetail/ImagesList'
import { useAuctionData } from '@/pages/Auction/useAuctionData'
import { useFitText } from '@/pages/Auction/useFitText'
import { usePlaceBid } from '@/pages/Auction/usePlaceBid'
import { useToken } from '@/pages/Auction/useToken'
import { setCurrentToken } from '@/store/collections/actions'
import { NO_LOT } from '@/store/collections/reducer'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { color } from '@/theme/tokens'
import { getTokenAttribute } from '@/utils/getTokenAttribute'

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

export default function ProductDetail({
  setErrorMessage,
  setErrorName,
  balance,
  auctionContract,
}: {
  setErrorMessage: (value: string) => void
  setErrorName: (value: string) => void
  balance: BalanceData | undefined
  auctionContract: Address
}) {
  const dispatch = useAppDispatch()
  // Account
  const { isConnected } = useAccount()

  const nft = useAppSelector((state) => state.collections.currentNFT)
  const currentAuctionToken = useAppSelector((state) => state.collections.currentToken)
  const chosenTokenId = useAppSelector((state) => state.collections.currentTokenId)
  const nftContract = useAppSelector((state) => state.collections.currentNFTContract)
  const tokenIds = useAppSelector((state) => state.auction.currentTokenIds)
  const tokenURIs = useAppSelector((state) => state.auction.currentTokenURIs)
  // Until a lot is chosen the panel shows the first one, so its art, its bid data and any bid all name the same token.
  const tokenId = chosenTokenId === NO_LOT ? tokenIds[0] : chosenTokenId

  const [transacting, setTransacting] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [bidAmount, setBidAmount] = useState('')
  const [viewing, setViewing] = useState(false)

  // Get contract data
  const { currentBid, endTime, bidder, refetch } = useAuctionData({
    nft: nftContract,
    tokenId: tokenId ?? 1,
    address: auctionContract,
  })
  const { placeBid, isValidBid } = usePlaceBid({ address: auctionContract, bidAmount })
  const { name, description, image, attributes } = useToken({ tokenURI: tokenURIs[0] || '', isFetch: !!tokenId })

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
  })

  useWaitForTransaction({
    hash: (txHash as Address) || '0x',
    enabled: !!txHash,
    onSuccess: () => {
      setTransacting(false)
      setTxHash('')
      refetch()
    },
    onReplaced: () => {
      setTransacting(false)
      setTxHash('')
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
    if (!isConnected || !isValidBid || tokenId === undefined) return
    setTransacting(true)
    try {
      const result = await placeBid(nftContract, tokenId)
      setTxHash(result.hash)
    } catch (e) {
      setTransacting(false)
      // warn message
      setErrorMessage(get(e, 'shortMessage') || '')
      setErrorName(get(e, 'name') || '')
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
  const descriptionFit = useFitText(descriptionRef, tokenDescription)
  const dimensions = tokenAttributes.find((item) => item.trait_type === 'Dimensions')?.value

  return (
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
        {viewing && (
          <ArtViewer
            skin="auction"
            onClose={() => setViewing(false)}
            items={[
              toArtwork(
                {
                  name: currentAuctionToken.name || name,
                  description: currentAuctionToken.description || description,
                  image: currentAuctionToken.image || image,
                  external_url: currentAuctionToken.external_url,
                  attributes: currentAuctionToken.attributes.length > 0 ? currentAuctionToken.attributes : attributes,
                },
                [['Final bid', currentBid ? `${formatUnits(currentBid, 18)} ETH` : undefined]]
              ),
            ]}
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
          <dt>Final bid</dt>
          <dd>
            {formatUnits(currentBid, 18)} {getTokenAttribute(tokenAttributes, 'Currency')}
          </dd>
          <dt>Highest bidder</dt>
          <dd title={bidder}>{highestBidderENS?.data || shortAddress(bidder)}</dd>
        </Facts>
        <BidArea>
          <BidContainer
            bidAmount={bidAmount}
            bidDisabled={!isValidBid}
            handleCheckBidAmount={handleCheckBidAmount}
            handleBid={handleBid}
            isConnected={isConnected}
            transacting={transacting}
            balance={balance}
            currentAuctionToken={currentAuctionToken}
            attributes={attributes}
            endTime={endTime}
          />
        </BidArea>
      </Placard>
    </ProductDetailWrapper>
  )
}

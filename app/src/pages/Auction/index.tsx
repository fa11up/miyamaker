import WarningIcon from 'assets/icon/warning.png'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { mainnet } from 'viem/chains'
import { useAccount as useWagmiAccount } from 'wagmi'

import { NormalButton } from '@/components/Button/NormalButton'
import { ErrorButtonWrapper, ErrorContent, ErrorMessage, ErrorWindow, ErrorWrapper } from '@/components/Errors'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { AUCTION_CONTRACT } from '@/constants/contracts'
import Pages from '@/constants/pages'
import { useAccount } from '@/context/AccountProvider'
import CollectionsList from '@/pages/Auction/CollectionsList'
import { AUCTION_PAGE_SECTION, ERROR_MESSAGES } from '@/pages/Auction/constants'
import ExplorerWrapper from '@/pages/Auction/ExplorerWrapper'
import ProductDetail from '@/pages/Auction/ProductDetail'
import ProductsList from '@/pages/Auction/ProductsList'
import { useNFTsList } from '@/pages/Auction/useNFTsList'
import { setNFTsList } from '@/store/collections/actions'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'

/* Desktop: the window is a fixed size and the two panels share it. Phones: the panels take their natural height and
   the window body is the one scrolling surface (no scroll boxes inside it). */
const Body = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 1rem;
  height: 100%;
  min-height: 0;

  > fieldset {
    min-height: 0;
  }

  @media only screen and (max-width: 640px) {
    overflow-y: auto;

    > fieldset {
      flex: none !important;
      height: auto !important;
    }
  }
`

const page = Pages.auction
const pageId = page?.id as PageKey

export default function AuctionPage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('auction')
  // Window mgmt
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: pageId }))
  const minimize = () => dispatch(minimizeWindow({ value: pageId }))

  const { balance } = useAccount()

  const [errorMessage, setErrorMessage] = useState('')
  const [errorName, setErrorName] = useState('MiyaAuction Error')
  const [pageSection, setPageSection] = useState(AUCTION_PAGE_SECTION.COLLECTIONS_SECTION)

  // On phones the body scrolls; picking a lot further down brings its detail (at the top) back into view.
  const bodyRef = useRef<HTMLDivElement>(null)
  const currentToken = useAppSelector((state) => state.collections.currentToken)
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }, [currentToken, pageSection])

  // Network
  const { chain } = useWagmiAccount()
  const auctionContract = AUCTION_CONTRACT[chain?.id || mainnet.id] || AUCTION_CONTRACT[mainnet.id]!

  // Get contract data
  const { nftsList } = useNFTsList({
    address: auctionContract as Address,
  })

  const handleCloseErrorPopup = () => {
    setErrorName('MiyaAuction Error')
    setErrorMessage('')

    if (errorMessage === ERROR_MESSAGES.AUCTION_ENDED) {
      setPageSection(AUCTION_PAGE_SECTION.COLLECTIONS_SECTION)
    }
  }

  const renderSection = () => {
    switch (pageSection) {
      case AUCTION_PAGE_SECTION.COLLECTIONS_SECTION:
        return (
          <ExplorerWrapper style={{ height: '100%' }} title={'Collections'}>
            <CollectionsList nfts={nftsList} setPageSection={setPageSection} />
          </ExplorerWrapper>
        )
      case AUCTION_PAGE_SECTION.PRODUCT_SECTION:
        return (
          <>
            <ExplorerWrapper style={{ flex: '3 1 0' }} title={'Collections > Detail'} setPageSection={setPageSection}>
              <ProductDetail
                balance={balance}
                setErrorMessage={setErrorMessage}
                setErrorName={setErrorName}
                auctionContract={auctionContract as Address}
              />
            </ExplorerWrapper>
            <ExplorerWrapper style={{ flex: '2 1 0' }} title={'Lots'}>
              <ProductsList auctionContract={auctionContract as Address} />
            </ExplorerWrapper>
          </>
        )
      default:
        return <></>
    }
  }

  useEffect(() => {
    dispatch(setNFTsList({ nfts: nftsList as Address[] }))
  }, [dispatch, nftsList])

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          close()
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          minimize()
        }}
      >
        {page?.label}
      </TitleBar>
      <Body ref={bodyRef}>
        {renderSection()}
        {errorMessage && (
          <ErrorWrapper>
            <ErrorWindow errorLabel={errorName} handleClose={handleCloseErrorPopup}>
              <ErrorContent>
                <ErrorMessage>
                  <img src={WarningIcon} alt="Error icon" />
                  <div>{errorMessage}</div>
                </ErrorMessage>
                <ErrorButtonWrapper>
                  <NormalButton style={{ width: '30%' }} onClick={handleCloseErrorPopup}>
                    OK
                  </NormalButton>
                </ErrorButtonWrapper>
              </ErrorContent>
            </ErrorWindow>
          </ErrorWrapper>
        )}
      </Body>
    </WindowWrapper>
  )
}

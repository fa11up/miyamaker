import WarningIcon from 'assets/icon/warning.png'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import { NormalButton } from '@/components/Button/NormalButton'
import { ErrorButtonWrapper, ErrorContent, ErrorMessage, ErrorWindow, ErrorWrapper } from '@/components/Errors'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { AUCTION_CHAIN_ID, AUCTION_CONTRACT } from '@/constants/contracts'
import Pages from '@/constants/pages'
import CollectionsList from '@/pages/Auction/CollectionsList'
import { AUCTION_PAGE_SECTION } from '@/pages/Auction/constants'
import ExplorerWrapper from '@/pages/Auction/ExplorerWrapper'
import MmLotDetail from '@/pages/Auction/miyamints/MmLotDetail'
import MmLotsList from '@/pages/Auction/miyamints/MmLotsList'
import type { MmLotRef } from '@/pages/Auction/miyamints/useMmAuctions'
import { useMmAuctions } from '@/pages/Auction/miyamints/useMmAuctions'
import ProductDetail from '@/pages/Auction/ProductDetail'
import ProductsList from '@/pages/Auction/ProductsList'
import damaskSkin from '@/pages/Auction/skin/damask.webp'
import { paddleButton } from '@/pages/Auction/skin/paddle'
import paperSkin from '@/pages/Auction/skin/paper.webp'
import { useNFTsList } from '@/pages/Auction/useNFTsList'
import { setNFTsList } from '@/store/collections/actions'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'

/* Desktop: the window is a fixed size and the two panels share it. Phones: the panels take their natural height and
   the window body is the one scrolling surface (no scroll boxes inside it). */
const Body = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 1rem;
  height: 100%;
  min-height: 0;
  /* The sale room's wallpaper. */
  background: #3f0a12 url(${damaskSkin}) 0 0 / 360px 360px;

  > fieldset {
    min-height: 0;
  }

  @media only screen and (max-width: 640px) {
    overflow-y: auto;
    scrollbar-color: #c9a24c #3f0a12;

    > fieldset {
      flex: none !important;
      height: auto !important;
    }
  }
`

/* A slip from the sale catalogue: the auction's own paper, type and paddle button. */
const Popup = styled(ErrorWrapper)`
  z-index: 10;
  top: 50%;
  left: 50%;
  width: min(420px, 92%);
  height: auto;
  transform: translate(-50%, -50%);

  .window-body > div:last-child {
    background: #f6eeda url(${paperSkin}) 0 0 / 256px 256px;
    color: #2a1410;
  }

  .window-body * {
    font-family: Georgia, 'Times New Roman', serif;
  }

  && ${NormalButton} {
    ${paddleButton}
    min-height: 32px;
  }
`

const page = Pages.auction
const pageId = page?.id as PageKey

/** An artist's lot from the miyamints auction houses: its own page, beside the legacy collections and lots. */
const ARTIST_LOT_SECTION = 'Artist auction'

export default function AuctionPage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('auction')
  // Window mgmt
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: pageId }))
  const minimize = () => dispatch(minimizeWindow({ value: pageId }))

  const [errorMessage, setErrorMessage] = useState('')
  const [pageSection, setSection] = useState(AUCTION_PAGE_SECTION.COLLECTIONS_SECTION)
  // A bid's ending is reported on the lot's page, so that page stays until it comes.
  const [bidBusy, setBidBusy] = useState(false)
  const setPageSection = (section: string) => {
    if (!bidBusy) setSection(section)
  }

  // On phones the body scrolls; picking a lot further down brings its detail (at the top) back into view.
  const bodyRef = useRef<HTMLDivElement>(null)
  const currentToken = useAppSelector((state) => state.collections.currentToken)
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }, [currentToken, pageSection])

  // Whatever network the wallet is on: the catalogue reads the same, and the bid button offers the switch.
  const auctionContract = AUCTION_CONTRACT[AUCTION_CHAIN_ID]!

  // Get contract data
  const { nftsList, isLoading, isError, refetch } = useNFTsList({
    address: auctionContract as Address,
  })

  // Artists' 1/1 auctions from Launch, on every chain the miyamints contracts are deployed on (none: nothing shows).
  const mm = useMmAuctions()
  const [mmChosen, setMmChosen] = useState<MmLotRef>()
  const mmLot = (mmChosen && mm.lots.find((item) => item.key === mmChosen.key)) || mmChosen
  const openMmLot = (item: MmLotRef) => {
    if (bidBusy) return
    setMmChosen(item)
    setSection(ARTIST_LOT_SECTION)
  }

  const handleCloseErrorPopup = () => setErrorMessage('')

  const renderSection = () => {
    switch (pageSection) {
      case AUCTION_PAGE_SECTION.COLLECTIONS_SECTION:
        return (
          <>
            <ExplorerWrapper style={mm.deployed ? { flex: '2 1 0' } : { height: '100%' }} title={'Collections'}>
              <CollectionsList
                nfts={nftsList}
                isLoading={isLoading}
                isError={isError}
                onRetry={() => refetch()}
                setPageSection={setPageSection}
                auctionContract={auctionContract as Address}
                compact={mm.deployed}
              />
            </ExplorerWrapper>
            {mm.deployed && (
              <ExplorerWrapper style={{ flex: '3 1 0' }} title={'Artist auctions'}>
                <MmLotsList
                  lots={mm.lots}
                  loading={mm.loading}
                  error={mm.error}
                  failed={mm.failed}
                  onRetry={() => mm.refetch()}
                  onOpen={openMmLot}
                />
              </ExplorerWrapper>
            )}
          </>
        )
      case ARTIST_LOT_SECTION:
        if (!mmLot) return <></>
        return (
          <ExplorerWrapper
            style={{ height: '100%' }}
            title={`Collections > ${ARTIST_LOT_SECTION}`}
            setPageSection={setPageSection}
          >
            <MmLotDetail
              key={mmLot.key}
              item={mmLot}
              onBack={() => setPageSection(AUCTION_PAGE_SECTION.COLLECTIONS_SECTION)}
              onBusy={setBidBusy}
              onChanged={() => mm.refetch()}
              setErrorMessage={setErrorMessage}
            />
          </ExplorerWrapper>
        )
      case AUCTION_PAGE_SECTION.PRODUCT_SECTION:
        return (
          <>
            <ExplorerWrapper style={{ flex: '3 1 0' }} title={'Collections > Detail'} setPageSection={setPageSection}>
              <ProductDetail
                setErrorMessage={setErrorMessage}
                auctionContract={auctionContract as Address}
                onBack={() => setPageSection(AUCTION_PAGE_SECTION.COLLECTIONS_SECTION)}
                onBusy={setBidBusy}
              />
            </ExplorerWrapper>
            <ExplorerWrapper style={{ flex: '2 1 0' }} title={'Lots'}>
              <ProductsList auctionContract={auctionContract as Address} locked={bidBusy} />
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
    <WindowWrapper skin="auction">
      <TitleBar
        skin="auction"
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
          <Popup
            role="alertdialog"
            aria-label="Auction"
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCloseErrorPopup()
            }}
          >
            <ErrorWindow skin="auction" errorLabel="Auction" handleClose={handleCloseErrorPopup}>
              <ErrorContent>
                <ErrorMessage style={{ height: 'auto' }}>
                  <img src={WarningIcon} alt="" />
                  <div>{errorMessage}</div>
                </ErrorMessage>
                <ErrorButtonWrapper>
                  <NormalButton autoFocus style={{ width: '30%' }} onClick={handleCloseErrorPopup}>
                    OK
                  </NormalButton>
                </ErrorButtonWrapper>
              </ErrorContent>
            </ErrorWindow>
          </Popup>
        )}
      </Body>
    </WindowWrapper>
  )
}

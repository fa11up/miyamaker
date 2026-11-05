import BackgroundImage from 'assets/explorer/background/background.png'
import WarningIcon from 'assets/icon/warning.png'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { NormalButton } from '@/components/Button/NormalButton'
import { ErrorButtonWrapper, ErrorContent, ErrorMessage, ErrorWindow, ErrorWrapper } from '@/components/Errors'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { INDEXER_ENABLED } from '@/constants/indexer'
import Pages from '@/constants/pages'
import { useOpenApp } from '@/desktop/useOpenApp'
import CollectionInfo from '@/pages/Mint/Collection'
import Collections from '@/pages/Mint/Collections'
import { EXPLORER_PAGE_SECTION, MUSIC_SLUG } from '@/pages/Mint/constants'
import MintHome from '@/pages/Mint/Home'
import LiveMintView from '@/pages/Mint/LiveMint'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { mintPath, slugFromPath } from '@/pages/Mint/liveMints'
import MiyaminiMint from '@/pages/Mint/Miyamini'
import MusicDrops from '@/pages/Mint/Music'
import NFTDetail from '@/pages/Mint/NFT'
import type { Collection } from '@/pages/Mint/types/collection'
import { useLiveMints } from '@/pages/Mint/useLiveMints'
import type { TokenMetadata } from '@/store/collections/reducer'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'

const page = Pages.mint
const pageId = page?.id as PageKey

const Background = styled.div`
  height: 100%;
  width: 100%;

  position: relative;
  overflow: hidden;

  :before {
    content: ' ';
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    opacity: 0.6;
    background-image: url(${BackgroundImage});
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: cover;
  }

  /* The legacy collection browser uses the display face everywhere; the MIYAMINI view uses the type scale. */
  &.legacy * {
    font-family: 'Revalia', sans-serif;
    letter-spacing: 1px;
  }
`
const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 1rem;
  height: 100%;
`

export type Token = {
  metadata: TokenMetadata
  tokenId: string
  collectionAddress: string
}

export default function MintPage() {
  const [fullscreen, toggleFullscreen] = useFullscreen('mint')
  // Window mgmt
  const dispatch = useAppDispatch()
  const close = () => dispatch(closeWindow({ value: pageId }))
  const minimize = () => dispatch(minimizeWindow({ value: pageId }))

  const { isConnected } = useAccount()

  const [errorMessage, setErrorMessage] = useState<string>('')
  const [errorName, setErrorName] = useState<string>('Mint Error')
  // Section + deep links: /mint is the home (all live mints), /mint/miyamini, /mint/music, /mint/<slug> open a view.
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const { cards } = useLiveMints()
  const sectionForSlug = (slug: string | undefined) =>
    !slug
      ? EXPLORER_PAGE_SECTION.HOME_SECTION
      : slug === 'miyamini'
      ? EXPLORER_PAGE_SECTION.MIYAMINI_SECTION
      : slug === MUSIC_SLUG
      ? EXPLORER_PAGE_SECTION.MUSIC_SECTION
      : EXPLORER_PAGE_SECTION.LIVE_SECTION
  const initialSlug = useRef(slugFromPath(location.pathname))
  const [liveSlug, setLiveSlug] = useState<string | undefined>(initialSlug.current)
  const [pageSection, setPageSection] = useState<string>(sectionForSlug(initialSlug.current))

  /** Switch view and record it in the address bar (so it can be shared and Back works). */
  const go = (section: string, slug?: string) => {
    setPageSection(section)
    setLiveSlug(slug)
    const path = mintPath(slug)
    if (location.pathname !== path) navigate(path)
  }

  // Back/forward (and links into a sub-path) drive the view. A plain push to /mint is the OS re-focusing the window,
  // which must not throw away the collection being viewed, so only POP navigations return home.
  useEffect(() => {
    const slug = slugFromPath(location.pathname)
    if (!location.pathname.startsWith('/mint')) return
    if (!slug && navigationType !== 'POP') return
    setLiveSlug(slug)
    setPageSection(sectionForSlug(slug))
  }, [location.pathname, navigationType])

  const goHome = () => go(EXPLORER_PAGE_SECTION.HOME_SECTION)
  const openCard = (card: LiveMintCard) => {
    if (!card.clickable) return
    if (card.view === 'miyamini') go(EXPLORER_PAGE_SECTION.MIYAMINI_SECTION, 'miyamini')
    else go(EXPLORER_PAGE_SECTION.LIVE_SECTION, card.slug)
  }

  const openApp = useOpenApp()
  const liveCard = cards.find((c) => c.slug === liveSlug && c.clickable)
  const [selectedCollection, setSelectedCollection] = useState<Collection>({
    name: '',
    metadataUri: '',
    address: '',
    createdAt: '',
    symbol: '',
    totalSupply: 0,
  })
  const [selectedToken, setSelectedToken] = useState<Token>({
    metadata: {
      name: '',
      description: '',
      image: '',
      external_url: '',
      attributes: [],
    },
    tokenId: '',
    collectionAddress: '',
  })

  const handleCloseErrorPopup = () => {
    setErrorName('Mint Error')
    setErrorMessage('')
  }

  // Sections built on the type scale (not the legacy all-Revalia browser).
  const modernSection = [
    EXPLORER_PAGE_SECTION.HOME_SECTION,
    EXPLORER_PAGE_SECTION.MIYAMINI_SECTION,
    EXPLORER_PAGE_SECTION.MUSIC_SECTION,
    EXPLORER_PAGE_SECTION.LIVE_SECTION,
  ].includes(pageSection)

  const renderSection = () => {
    switch (pageSection) {
      case EXPLORER_PAGE_SECTION.HOME_SECTION:
        return (
          <MintHome
            onOpen={openCard}
            onMusic={() => go(EXPLORER_PAGE_SECTION.MUSIC_SECTION, MUSIC_SLUG)}
            onLaunch={() => openApp('launch')}
            onBrowseLegacy={
              INDEXER_ENABLED ? () => setPageSection(EXPLORER_PAGE_SECTION.COLLECTIONS_SECTION) : undefined
            }
          />
        )
      case EXPLORER_PAGE_SECTION.MIYAMINI_SECTION:
        return <MiyaminiMint onBack={goHome} />
      case EXPLORER_PAGE_SECTION.LIVE_SECTION:
        // Unknown or not-yet-loaded slug: show the home (the card list) rather than an empty window.
        return liveCard ? (
          <LiveMintView key={liveCard.key} card={liveCard} onBack={goHome} />
        ) : (
          <MintHome
            onOpen={openCard}
            onMusic={() => go(EXPLORER_PAGE_SECTION.MUSIC_SECTION, MUSIC_SLUG)}
            onLaunch={() => openApp('launch')}
          />
        )
      case EXPLORER_PAGE_SECTION.MUSIC_SECTION:
        return <MusicDrops onBack={goHome} />
      case EXPLORER_PAGE_SECTION.COLLECTIONS_SECTION:
        return (
          <Collections
            isConnected={isConnected}
            setPageSection={setPageSection}
            closeWindow={goHome}
            setSelectedCollection={setSelectedCollection}
          />
        )
      case EXPLORER_PAGE_SECTION.COLLECTION_SECTION:
        return (
          <CollectionInfo
            setErrorMessage={setErrorMessage}
            setErrorName={setErrorName}
            isConnected={isConnected}
            setPageSection={setPageSection}
            selectedCollection={selectedCollection}
            setSelectedToken={setSelectedToken}
          />
        )
      case EXPLORER_PAGE_SECTION.NFT_SECTION:
        return <NFTDetail selectedToken={selectedToken} setPageSection={setPageSection} />
      default:
        return <></>
    }
  }

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
      <Background className={modernSection ? 'miyamini' : 'legacy'}>
        <Container style={modernSection ? { padding: 0 } : undefined}>
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
        </Container>
      </Background>
    </WindowWrapper>
  )
}

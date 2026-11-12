import BackgroundImage from 'assets/explorer/background/background.png'
import WarningIcon from 'assets/icon/warning.png'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useAccount } from 'wagmi'

import { NormalButton } from '@/components/Button/NormalButton'
import { ErrorButtonWrapper, ErrorContent, ErrorMessage, ErrorWindow, ErrorWrapper } from '@/components/Errors'
import { INDEXER_ENABLED } from '@/constants/indexer'
import Pages from '@/constants/pages'
import CollectionInfo from '@/pages/Mint/Collection'
import Collections from '@/pages/Mint/Collections'
import { EXPLORER_PAGE_SECTION, FRENPET_SLUG, GAMES_SLUG, MUSIC_SLUG } from '@/pages/Mint/constants'
import Boot from '@/pages/Mint/handheld/Boot'
import FrenPet from '@/pages/Mint/handheld/FrenPet'
import GameSelect from '@/pages/Mint/handheld/GameSelect'
import Device, { Lcd } from '@/pages/Mint/handheld/Device'
import type { HandheldNav } from '@/pages/Mint/handheld/nav'
import { HandheldContext } from '@/pages/Mint/handheld/nav'
import Stage from '@/pages/Mint/handheld/Stage'
import { wrapIndex } from '@/pages/Mint/handheld/status'
import MainMenu from '@/pages/Mint/Home'
import LiveMintView from '@/pages/Mint/LiveMint'
import type { LiveMintCard, MintShelf } from '@/pages/Mint/liveMints'
import { mintPath, shelfOf, slugFromPath } from '@/pages/Mint/liveMints'
import MiyaminiMint from '@/pages/Mint/Miyamini'
import MusicDrops from '@/pages/Mint/Music'
import NFTDetail from '@/pages/Mint/NFT'
import type { Collection } from '@/pages/Mint/types/collection'
import { useLiveMints } from '@/pages/Mint/useLiveMints'
import type { TokenMetadata } from '@/store/collections/reducer'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import type { PageKey } from '@/store/windows/reducer'

const page = Pages.mint
const pageId = page?.id as PageKey

/** The legacy collection browser, on the handheld's screen: it keeps the display face it was built around. */
const Legacy = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem;
  overflow-y: auto;
  background: url(${BackgroundImage}) 50% 0 / cover;
  color: #14101f;
  * {
    font-family: 'Revalia', sans-serif;
    letter-spacing: 1px;
  }
`

export type Token = {
  metadata: TokenMetadata
  tokenId: string
  collectionAddress: string
}

export default function MintPage() {
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
      : slug === GAMES_SLUG
      ? EXPLORER_PAGE_SECTION.GAMES_SECTION
      : slug === FRENPET_SLUG
      ? EXPLORER_PAGE_SECTION.FRENPET_SECTION
      : slug === MUSIC_SLUG
      ? EXPLORER_PAGE_SECTION.MUSIC_SECTION
      : EXPLORER_PAGE_SECTION.LIVE_SECTION
  // Powering on with no deep link lands on the game select.
  const initialSlug = useRef(slugFromPath(location.pathname) ?? GAMES_SLUG)
  const [booted, setBooted] = useState(false)
  const [liveSlug, setLiveSlug] = useState<string | undefined>(initialSlug.current)
  const [pageSection, setPageSection] = useState<string>(sectionForSlug(initialSlug.current))

  useEffect(() => {
    if (location.pathname === mintPath()) navigate(mintPath(GAMES_SLUG), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Switch view and record it in the address bar (so it can be shared and Back works). */
  const go = (section: string, slug?: string) => {
    setPageSection(section)
    setLiveSlug(slug)
    const path = mintPath(slug)
    if (location.pathname !== path) navigate(path)
  }

  // A mint in flight holds its screen, whose outcome would go with it. Coming back would offer it again.
  const [holds, setHolds] = useState(0)
  const held = holds > 0
  const hold = useCallback(() => {
    setHolds((n) => n + 1)
    return () => setHolds((n) => n - 1)
  }, [])

  // Back/forward (and links into a sub-path) drive the view. A plain push to /mint is the OS re-focusing the window,
  // which must not throw away the collection being viewed, so only POP navigations return home. During a mint it
  // takes effect when that ends.
  const syncedPath = useRef<string>()
  useEffect(() => {
    const here = `${navigationType} ${location.pathname}`
    if (held || syncedPath.current === here) return
    syncedPath.current = here
    const slug = slugFromPath(location.pathname)
    if (!location.pathname.startsWith('/mint')) return
    if (!slug && navigationType !== 'POP') return
    setLiveSlug(slug)
    setPageSection(sectionForSlug(slug))
  }, [location.pathname, navigationType, held])

  // The open shelf (Miyamaker or Community). A collection's Menu button returns to its own shelf.
  const [shelf, setShelf] = useState<MintShelf>()
  const goHome = () => go(EXPLORER_PAGE_SECTION.HOME_SECTION)
  const openCard = (card: LiveMintCard) => {
    if (!card.clickable) return
    setShelf(shelfOf(card))
    if (card.view === 'miyamini') go(EXPLORER_PAGE_SECTION.MIYAMINI_SECTION, 'miyamini')
    else go(EXPLORER_PAGE_SECTION.LIVE_SECTION, card.slug)
  }

  const liveCard = cards.find((c) => c.slug === liveSlug && c.clickable)
  // A deep link straight into a collection opens its shelf too, so Menu and the D-pad stay on that shelf.
  useEffect(() => {
    if (liveCard) setShelf(shelfOf(liveCard))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCard?.key])
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

  const toMenu = () => goHome()
  const toGames = () => {
    setShelf(undefined)
    go(EXPLORER_PAGE_SECTION.GAMES_SECTION, GAMES_SLUG)
  }

  // What the D-pad moves between: everything on the open shelf that opens, then the music. Stepping never crosses from
  // a miyamaker drop into a community one.
  const openable = cards.filter((c) => c.clickable && (!shelf || shelfOf(c) === shelf))
  const toMusic = () => go(EXPLORER_PAGE_SECTION.MUSIC_SECTION, MUSIC_SLUG)
  const carts: { slug: string; open: () => void }[] = [
    ...openable.map((c) => ({ slug: c.view === 'miyamini' ? 'miyamini' : c.slug, open: () => openCard(c) })),
    { slug: MUSIC_SLUG, open: toMusic },
  ]
  const inNow = Math.max(
    0,
    carts.findIndex((c) => c.slug === liveSlug)
  )
  const nav: HandheldNav = {
    swap:
      booted && !held && carts.length > 1 ? (step) => carts[wrapIndex(carts.length, inNow, step)]?.open() : undefined,
    openMenu: booted && !held && pageSection !== EXPLORER_PAGE_SECTION.GAMES_SECTION ? toMenu : () => {},
    close,
    minimize,
    held,
    hold,
  }

  const menu = (
    <MainMenu
      shelf={shelf}
      onShelf={setShelf}
      onOpen={openCard}
      onMusic={toMusic}
      onBrowseLegacy={INDEXER_ENABLED ? () => setPageSection(EXPLORER_PAGE_SECTION.COLLECTIONS_SECTION) : undefined}
      onBack={toGames}
    />
  )
  const cartFor = (card: LiveMintCard | undefined) => {
    if (!card) return menu
    return card.view === 'miyamini' ? <MiyaminiMint /> : <LiveMintView key={card.key} card={card} />
  }

  const legacy = (body: JSX.Element) => (
    <Device
      title="Older collections"
      lamp={{ color: '#79808a', label: 'Older collections' }}
      screen={
        <Legacy className="scroll">
          {body}
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
        </Legacy>
      }
      lcd={
        <Lcd>
          <div>
            <span>Older collections</span>
          </div>
          <div>
            <span>Scroll the screen to browse.</span>
          </div>
        </Lcd>
      }
      a={{ label: 'Open', disabled: true, onClick: () => {} }}
      b={{ label: 'Menu', onClick: toMenu }}
    />
  )

  const renderSection = () => {
    switch (pageSection) {
      case EXPLORER_PAGE_SECTION.GAMES_SECTION:
        return <GameSelect onMint={goHome} onFrenPet={() => go(EXPLORER_PAGE_SECTION.FRENPET_SECTION, FRENPET_SLUG)} />
      case EXPLORER_PAGE_SECTION.FRENPET_SECTION:
        return <FrenPet onBack={toGames} />
      case EXPLORER_PAGE_SECTION.HOME_SECTION:
        return menu
      case EXPLORER_PAGE_SECTION.MIYAMINI_SECTION:
        return <MiyaminiMint />
      case EXPLORER_PAGE_SECTION.LIVE_SECTION:
        // Unknown or not-yet-loaded slug: show the menu rather than an empty screen.
        return cartFor(liveCard)
      case EXPLORER_PAGE_SECTION.MUSIC_SECTION:
        return <MusicDrops />
      case EXPLORER_PAGE_SECTION.COLLECTIONS_SECTION:
        return legacy(
          <Collections
            isConnected={isConnected}
            setPageSection={setPageSection}
            closeWindow={goHome}
            setSelectedCollection={setSelectedCollection}
          />
        )
      case EXPLORER_PAGE_SECTION.COLLECTION_SECTION:
        return legacy(
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
        return legacy(<NFTDetail selectedToken={selectedToken} setPageSection={setPageSection} />)
      default:
        return <></>
    }
  }

  const finishBoot = () => setBooted(true)

  return (
    <HandheldContext.Provider value={nav}>
      <Stage>
      {booted ? (
        renderSection()
      ) : (
        <Device
          title="Starting"
          poweringOn
          lamp={{ color: '#3dff7a', label: 'Power on' }}
          screen={<Boot onDone={finishBoot} />}
          lcd={
            <Lcd>
              <div>
                <span>miyamaker</span>
              </div>
              <div>
                <span>Starting…</span>
              </div>
              <div>
                <span>Ⓐ Skip intro</span>
              </div>
            </Lcd>
          }
          a={{ label: 'Skip intro', onClick: finishBoot }}
          start={{ label: 'Skip intro', onClick: finishBoot }}
          select={{ label: 'Skip intro', onClick: finishBoot }}
          b={{ label: 'Skip', onClick: finishBoot }}
        />
      )}
      </Stage>
    </HandheldContext.Provider>
  )
}

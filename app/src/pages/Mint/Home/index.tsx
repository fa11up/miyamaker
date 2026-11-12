import NftImage from '@/components/NftImage'
import { Chip } from '@/components/Retro'
import Carousel, { Glyph } from '@/pages/Mint/handheld/Carousel'
import { statusLamp } from '@/pages/Mint/handheld/status'
import type { LiveMintCard, LiveMintStatus, MintShelf } from '@/pages/Mint/liveMints'
import { cardPrice, COMMUNITY_WORDS, shelfOf } from '@/pages/Mint/liveMints'
import { useContractImage, useLiveMints } from '@/pages/Mint/useLiveMints'

/**
 * Mint's start menu. With no shelf: two shelves, MIYAMAKER (the curated drops, made by miyamaker) and COMMUNITY
 * (anything launched through Launch), then the music drops. On a shelf: its collections as cards; soon ones show but do
 * not open, and every community card says it is not made by miyamaker.
 */

const STATUS_LABEL: Record<LiveMintStatus, string> = {
  open: 'Mint open',
  closed: 'Mint closed',
  soldout: 'Sold out',
  soon: 'Coming soon',
  unknown: 'Checking…',
}
const STATUS_TONE: Record<LiveMintStatus, 'ok' | 'warn' | 'off'> = {
  open: 'ok',
  closed: 'warn',
  soldout: 'off',
  soon: 'off',
  unknown: 'off',
}

/** `loading` false with an unknown status means the chain could not be read, so say so instead of "Checking…". */
export function StatusChip({ status, loading = true }: { status: LiveMintStatus; loading?: boolean }) {
  if (status === 'unknown' && !loading) return <Chip tone="warn">Can&apos;t reach chain</Chip>
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
}

/** Cover: curated image, else the contract's metadata image, else the dithered placeholder. */
function Cover({ card }: { card: LiveMintCard }) {
  const fromContract = useContractImage(card.image ? undefined : card.contractURI)
  return <NftImage src={card.image || fromContract.data || undefined} alt={card.name} eager />
}

export default function MainMenu({
  shelf,
  onShelf,
  onOpen,
  onMusic,
  onBrowseLegacy,
  onBack,
}: {
  /** Which shelf is open; undefined shows the shelves. */
  shelf?: MintShelf
  onShelf: (shelf: MintShelf | undefined) => void
  onOpen: (card: LiveMintCard) => void
  onMusic: () => void
  onBrowseLegacy?: () => void
  /** Back to the game select. */
  onBack?: () => void
}) {
  const { cards, isLoading } = useLiveMints()
  const official = cards.filter((c) => shelfOf(c) === 'official')
  const community = cards.filter((c) => shelfOf(c) === 'community')
  const count = (list: LiveMintCard[]) => {
    const open = list.filter((c) => c.status === 'open').length
    return `${list.length} ${list.length === 1 ? 'collection' : 'collections'}${open ? ` · ${open} open` : ''}`
  }

  if (shelf) {
    const list = shelf === 'official' ? official : community
    return (
      <Carousel
        key={shelf}
        title={shelf === 'official' ? 'Miyamaker mints' : 'Community mints'}
        lampLabel={shelf === 'official' ? 'Miyamaker mints' : 'Community mints'}
        ariaLabel={shelf === 'official' ? 'Miyamaker mints' : `Community mints, ${COMMUNITY_WORDS}`}
        back={{ label: 'Shelves', onClick: () => onShelf(undefined) }}
        items={
          list.length
            ? list.map((c) => {
                const lamp = statusLamp(c.status, isLoading && c.status !== 'soon')
                const state = c.status === 'soon' ? 'Coming soon' : `${lamp.label} · ${cardPrice(c)}`
                return {
                  key: c.key,
                  name: c.name,
                  line: shelf === 'community' ? `Community · not by miyamaker · ${state}` : state,
                  action: c.clickable ? `Open ${c.name}` : 'Coming soon',
                  open: c.clickable ? () => onOpen(c) : undefined,
                  pic: c.status === 'soon' ? <Glyph>?</Glyph> : <Cover card={c} />,
                }
              })
            : [
                {
                  key: 'empty',
                  name: isLoading ? 'Loading…' : 'Nothing yet',
                  line: isLoading ? 'Reading the chain' : 'No community mints are live',
                  action: 'Back to shelves',
                  open: () => onShelf(undefined),
                  pic: <Glyph>…</Glyph>,
                },
              ]
        }
      />
    )
  }

  return (
    <Carousel
      title="Mint"
      lampLabel="Mint"
      ariaLabel="Main menu"
      back={{ label: 'Games', disabled: !onBack, onClick: () => onBack?.() }}
      items={[
        {
          key: 'shelf-official',
          name: 'Miyamaker',
          line: `Official drops · ${count(official)}`,
          action: 'Open Miyamaker mints',
          open: () => onShelf('official'),
          pic: official[0]?.image ? (
            <Cover card={official[0]} />
          ) : (
            <Glyph $bg="linear-gradient(160deg, #ff6fbf, #7a2fd0)">♥</Glyph>
          ),
        },
        {
          key: 'shelf-community',
          name: 'Community',
          line: `Not made by miyamaker · ${count(community)}`,
          action: 'Open Community mints',
          open: () => onShelf('community'),
          pic: <Glyph $bg="linear-gradient(160deg, #5d6175, #1b1d2a)">✦</Glyph>,
        },
        {
          key: 'music',
          name: 'Music drops',
          line: 'Songs you can collect',
          action: 'Open Music drops',
          open: onMusic,
          pic: <Glyph $bg="linear-gradient(160deg, #18a9b8, #2c1458)">♪</Glyph>,
        },
        ...(onBrowseLegacy
          ? [
              {
                key: 'older',
                name: 'Older',
                line: 'Mints from before miyamints',
                action: 'Open older collections',
                open: onBrowseLegacy,
                pic: <Glyph>⌛</Glyph>,
              },
            ]
          : []),
      ]}
    />
  )
}

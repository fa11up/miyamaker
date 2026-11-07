import NftImage from '@/components/NftImage'
import { Chip } from '@/components/Retro'
import Carousel, { Glyph } from '@/pages/Mint/handheld/Carousel'
import { statusLamp } from '@/pages/Mint/handheld/status'
import type { LiveMintCard, LiveMintStatus } from '@/pages/Mint/liveMints'
import { formatEthShort } from '@/pages/Mint/liveMints'
import { useContractImage, useLiveMints } from '@/pages/Mint/useLiveMints'

/** Mint's start menu: every collection, and the music drops, as cards. Soon ones show but do not open. */

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
  onOpen,
  onMusic,
  onBrowseLegacy,
  onBack,
}: {
  onOpen: (card: LiveMintCard) => void
  onMusic: () => void
  onBrowseLegacy?: () => void
  /** Back to the game select. */
  onBack?: () => void
}) {
  const { cards, isLoading } = useLiveMints()
  return (
    <Carousel
      title="Mint"
      lampLabel="Mint"
      ariaLabel="Main menu"
      back={{ label: 'Games', disabled: !onBack, onClick: () => onBack?.() }}
      items={[
        ...cards.map((c) => {
          const lamp = statusLamp(c.status, isLoading && c.status !== 'soon')
          return {
            key: c.key,
            name: c.name,
            line: c.status === 'soon' ? 'Coming soon' : `${lamp.label} · ${formatEthShort(c.price)}`,
            action: c.clickable ? `Open ${c.name}` : 'Coming soon',
            open: c.clickable ? () => onOpen(c) : undefined,
            pic: c.status === 'soon' ? <Glyph>?</Glyph> : <Cover card={c} />,
          }
        }),
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

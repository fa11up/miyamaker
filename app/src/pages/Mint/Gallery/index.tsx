import { useState } from 'react'

import Carousel, { Glyph } from '@/pages/Mint/handheld/Carousel'
import Gallery from '@/pages/Mint/handheld/Gallery'
import { Cover } from '@/pages/Mint/Home'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { COMMUNITY_WORDS, shelfOf } from '@/pages/Mint/liveMints'
import PieceArt from '@/pages/Mint/PieceArt'
import { useLiveMints } from '@/pages/Mint/useLiveMints'

const pieces = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'piece' : 'pieces'}`

/**
 * The start menu's Gallery: pick a collection, then browse every piece minted in it, with nothing to buy on the way.
 * Miyamaker's own collections come first; community ones say they are not made by miyamaker.
 */
export default function GalleryShelf({ onBack }: { onBack: () => void }) {
  const { cards, isLoading } = useLiveMints()
  const [picked, setPicked] = useState<string>()
  const minted = cards.filter((c) => c.clickable && (c.minted ?? 0) > 0)
  const list = [
    ...minted.filter((c) => shelfOf(c) === 'official'),
    ...minted.filter((c) => shelfOf(c) === 'community'),
  ]
  const card = list.find((c) => c.key === picked)

  if (card) {
    return (
      <Gallery
        name={card.name}
        ids={Array.from({ length: card.minted ?? 0 }, (_, i) => i + 1)}
        art={(id) => <PieceArt card={card} id={id} />}
        empty="Nothing minted yet."
        onBack={() => setPicked(undefined)}
      />
    )
  }

  const line = (c: LiveMintCard) =>
    shelfOf(c) === 'community' ? `${COMMUNITY_WORDS} · ${pieces(c.minted ?? 0)}` : pieces(c.minted ?? 0)

  return (
    <Carousel
      title="Gallery"
      lampLabel="Gallery"
      ariaLabel="Gallery: pick a collection to browse"
      back={{ label: 'Menu', onClick: onBack }}
      items={
        list.length
          ? list.map((c) => ({
              key: c.key,
              name: c.name,
              line: line(c),
              action: `Browse ${c.name}`,
              open: () => setPicked(c.key),
              pic: <Cover card={c} />,
            }))
          : [
              {
                key: 'empty',
                name: isLoading ? 'Loading…' : 'Nothing yet',
                line: isLoading ? 'Reading the chain' : 'Nothing has been minted yet',
                action: 'Back to the menu',
                open: onBack,
                pic: <Glyph>…</Glyph>,
              },
            ]
      }
    />
  )
}

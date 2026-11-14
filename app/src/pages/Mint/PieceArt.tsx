import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import NftImage from '@/components/NftImage'
import type { SupportedChainId } from '@/config/wagmi'
import type { LiveMintCard } from '@/pages/Mint/liveMints'
import { TokenImage } from '@/pages/Mint/Miyamini'
import { dropAbi } from '@/pages/Mint/useLiveMints'
import { useMetadata } from '@/utils/nftMetadata'

/** One minted piece of a drop: its tokenURI, then the image its metadata names. */
function DropPiece({ card, id }: { card: LiveMintCard; id: number }) {
  const uri = useReadContract({
    address: card.address as Address,
    abi: dropAbi,
    chainId: card.chainId as SupportedChainId,
    functionName: 'tokenURI',
    args: [BigInt(id)],
    query: { staleTime: 60 * 60_000 },
  })
  const meta = useMetadata<{ name?: string; image?: string }>(typeof uri.data === 'string' ? uri.data : undefined)
  return <NftImage src={meta.data?.image || undefined} alt={meta.data?.name || `#${id}`} />
}

/** The art of piece `id` of a collection, for the galleries. MIYAMINI's metadata host needs its own path. */
export default function PieceArt({ card, id }: { card: LiveMintCard; id: number }) {
  return card.view === 'miyamini' ? <TokenImage id={id} alt={`#${id}`} /> : <DropPiece card={card} id={id} />
}

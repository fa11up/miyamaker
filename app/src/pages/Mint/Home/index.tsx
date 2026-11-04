import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'

import NftImage from '@/components/NftImage'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, ProgressMeter, Skeleton, Well } from '@/components/Retro'
import type { LiveMintCard, LiveMintStatus } from '@/pages/Mint/liveMints'
import { formatEthShort } from '@/pages/Mint/liveMints'
import { useContractImage, useLiveMints } from '@/pages/Mint/useLiveMints'
import { bevel, color, font, space, text } from '@/theme/tokens'

/**
 * Mint window home: every live miyamaker mint as a card, MIYAMINI featured on top. Clicking a card opens its mint
 * view; "coming soon" cards are shown but not clickable.
 */

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[4]};
  padding: ${space[4]};
  max-width: 980px;
  margin: 0 auto;
  .narrow & {
    gap: ${space[3]};
    padding: ${space[3]};
  }
`

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const Lead = styled.p`
  margin: ${space[1]} 0 0;
  align-self: flex-start;
  max-width: 60ch;
  padding: ${space[1]} ${space[2]};
  font-size: ${text.sm};
  line-height: 1.4;
  color: ${color.highlight};
  background: rgba(20, 16, 31, 0.55);
`

/** Win9x tab strip: Collections | Music drops. */
const Tabs = styled.div`
  display: flex;
  gap: 2px;
  align-items: flex-end;
  border-bottom: 2px solid ${color.highlight};
  margin-bottom: -${space[2]};
`

const Tab = styled.button<{ $active?: boolean }>`
  border: none;
  border-radius: 0;
  min-height: ${({ $active }) => ($active ? '40px' : '36px')};
  padding: 0 ${space[4]};
  font-family: ${font.ui};
  font-size: ${text.sm};
  color: ${color.ink};
  background: ${({ $active }) => ($active ? color.face : color.faceLight)};
  box-shadow: inset 1px 1px ${color.highlight}, inset -1px 0 ${color.dark}, inset -2px 0 ${color.shadow};
  cursor: pointer;
  font-weight: ${({ $active }) => ($active ? 700 : 400)};
  &:hover:not([aria-selected='true']) {
    background: ${color.light};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
`

const SectionTitle = styled.h2`
  margin: 0;
  font-family: ${font.ui};
  font-weight: 700;
  font-size: ${text.xs};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${color.highlight};
  text-shadow: 1px 1px 0 ${color.dark};
`

// ── featured (MIYAMINI) ─────────────────────────────────────────────────────

const Feature = styled(Panel)`
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
  grid-template-areas: 'art intro' 'art body';
  grid-template-rows: auto 1fr;
  column-gap: ${space[4]};
  row-gap: ${space[3]};
  align-items: stretch;
  .narrow & {
    grid-template-columns: 120px minmax(0, 1fr);
    grid-template-areas: 'art intro' 'body body';
    grid-template-rows: auto auto;
    gap: ${space[3]};
    padding: ${space[3]};
  }
`

const FeatureIntro = styled.div`
  grid-area: intro;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
`

const Frame = styled(Well)`
  grid-area: art;
  padding: 3px;
  align-self: start;
`

const FeatureBody = styled.div`
  grid-area: body;
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  min-width: 0;
`

const Name = styled.h3`
  margin: 0;
  font-family: ${font.display};
  font-weight: 400;
  font-size: ${text.lg};
  line-height: 1.15;
  color: ${color.ink};
  overflow-wrap: anywhere;
`

const Blurb = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.4;
  color: ${color.inkMuted};
`

const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${space[1]} ${space[3]};
  font-size: ${text.sm};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    text-align: right;
    color: ${color.ink};
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`

// ── grid cards ──────────────────────────────────────────────────────────────

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: ${space[3]};
`

const CardButton = styled.button`
  all: unset;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: ${space[2]};
  .narrow & {
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: start;
  }
  padding: ${space[2]};
  background: ${color.face};
  box-shadow: ${bevel.raised};
  cursor: pointer;
  min-width: 0;
  &:hover:not(:disabled) {
    background: ${color.faceLight};
  }
  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
  &:disabled {
    cursor: default;
  }
`

const CardName = styled.div`
  font-size: ${text.md};
  font-weight: 700;
  color: ${color.ink};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CardRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${space[2]};
  font-size: ${text.xs};
  color: ${color.inkMuted};
  strong {
    color: ${color.ink};
    font-size: ${text.sm};
    font-variant-numeric: tabular-nums;
  }
`

const Soon = styled.div`
  position: relative;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${color.light};
  background-image: linear-gradient(
      45deg,
      ${color.faceLight} 25%,
      transparent 25%,
      transparent 75%,
      ${color.faceLight} 75%
    ),
    linear-gradient(45deg, ${color.faceLight} 25%, transparent 25%, transparent 75%, ${color.faceLight} 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
  span {
    font-family: ${font.display};
    font-size: ${text.lg};
    color: ${color.highlight};
    text-shadow: 2px 2px 0 ${color.dark};
    transform: rotate(-6deg);
    .narrow & {
      font-size: ${text.sm};
    }
  }
`

const CardInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
`

const Footer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  align-items: center;
  justify-content: space-between;
  font-size: ${text.xs};
  color: ${color.highlight};
  text-shadow: 1px 1px 0 ${color.dark};
`

const SmallButton = styled.button`
  border: none;
  border-radius: 0;
  min-height: 32px;
  padding: 0 ${space[3]};
  background: ${color.face};
  color: ${color.ink};
  box-shadow: ${bevel.raised};
  font-family: ${font.ui};
  font-size: ${text.xs};
  text-shadow: none;
  cursor: pointer;
  &:hover {
    background: ${color.faceLight};
  }
  &:active {
    box-shadow: ${bevel.pressed};
  }
`

// ── bits ────────────────────────────────────────────────────────────────────

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

export function StatusChip({ status }: { status: LiveMintStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
}

/** Cover: curated image, else the contract's metadata image, else the dithered placeholder. */
function Cover({ card, eager }: { card: LiveMintCard; eager?: boolean }) {
  const fromContract = useContractImage(card.image ? undefined : card.contractURI)
  return <NftImage src={card.image || fromContract.data || undefined} alt={card.name} eager={eager} variant="thumb" />
}

const supplyLabel = (c: LiveMintCard) =>
  c.minted !== undefined && c.supply !== undefined
    ? `${c.minted.toLocaleString()} / ${c.supply.toLocaleString()}`
    : c.minted !== undefined
    ? `${c.minted.toLocaleString()} minted`
    : '–'

function MintCard({
  card,
  onOpen,
  loading,
}: {
  card: LiveMintCard
  onOpen: (c: LiveMintCard) => void
  loading: boolean
}) {
  const soon = card.status === 'soon'
  return (
    <CardButton
      type="button"
      disabled={!card.clickable}
      onClick={() => onOpen(card)}
      aria-label={soon ? `${card.name}, coming soon` : `Open ${card.name}`}
    >
      <Well style={{ padding: 3 }}>
        {soon ? (
          <Soon>
            <span>Soon</span>
          </Soon>
        ) : (
          <Cover card={card} />
        )}
      </Well>
      <CardInfo>
        <CardName title={card.name}>{card.name}</CardName>
        <CardRow>
          <span>{card.chainName}</span>
          <StatusChip status={card.status} />
        </CardRow>
        {soon ? (
          <Blurb style={{ fontSize: text.xs }}>{card.blurb || 'Mint opens soon.'}</Blurb>
        ) : (
          <>
            <CardRow>
              <span>Price</span>
              {loading ? <Skeleton w="72px" h="16px" /> : <strong>{formatEthShort(card.price)}</strong>}
            </CardRow>
            <CardRow>
              <span>Minted</span>
              {loading ? <Skeleton w="72px" h="16px" /> : <strong>{supplyLabel(card)}</strong>}
            </CardRow>
            {card.progress !== undefined && (
              <ProgressMeter value={card.minted || 0} max={card.supply || 1} label={`${card.name} minted`} />
            )}
          </>
        )}
      </CardInfo>
    </CardButton>
  )
}

/** Last grid card: where your own drop would go. Opens the Launch window. */
function LaunchCard({ onLaunch }: { onLaunch: () => void }) {
  return (
    <CardButton type="button" onClick={onLaunch} aria-label="Launch your own collection">
      <Well style={{ padding: 3 }}>
        <Soon>
          <span style={{ fontSize: text.xxl }}>+</span>
        </Soon>
      </Well>
      <CardInfo>
        <CardName>Your drop here</CardName>
        <Blurb style={{ fontSize: text.xs }}>Launch a collection with miyamints and it is listed on this page.</Blurb>
        <CardRow>
          <span>Opens Launch</span>
          <strong>→</strong>
        </CardRow>
      </CardInfo>
    </CardButton>
  )
}

function Featured({
  card,
  onOpen,
  loading,
}: {
  card: LiveMintCard
  onOpen: (c: LiveMintCard) => void
  loading: boolean
}) {
  const remaining =
    card.left ?? (card.supply !== undefined && card.minted !== undefined ? card.supply - card.minted : undefined)
  return (
    <Feature aria-label={`Featured: ${card.name}`}>
      <Frame>
        <Cover card={card} eager />
      </Frame>
      <FeatureIntro>
        <Chips>
          <StatusChip status={card.status} />
          <Chip>{card.chainName}</Chip>
        </Chips>
        <div>
          <Name>{card.name}</Name>
          {card.artist && <Blurb>by {card.artist}</Blurb>}
        </div>
        {card.blurb && <Blurb>{card.blurb}</Blurb>}
      </FeatureIntro>
      <FeatureBody>
        <Facts>
          <dt>Price</dt>
          <dd>
            {loading ? <Skeleton w="96px" h="18px" style={{ marginLeft: 'auto' }} /> : formatEthShort(card.price)}
          </dd>
          <dt>Minted</dt>
          <dd>{loading ? <Skeleton w="96px" h="18px" style={{ marginLeft: 'auto' }} /> : supplyLabel(card)}</dd>
        </Facts>
        {card.progress !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            <ProgressMeter value={card.minted || 0} max={card.supply || 1} label={`${card.name} minted`} />
            {remaining !== undefined && <Blurb style={{ fontSize: text.xs }}>{remaining.toLocaleString()} left</Blurb>}
          </div>
        )}
        <BigButton type="button" onClick={() => onOpen(card)} style={{ marginTop: 'auto' }}>
          {card.status === 'open' ? 'Mint now' : 'View collection'}
        </BigButton>
      </FeatureBody>
    </Feature>
  )
}

export default function MintHome({
  onOpen,
  onMusic,
  onLaunch,
  onBrowseLegacy,
}: {
  onOpen: (card: LiveMintCard) => void
  onMusic: () => void
  onLaunch?: () => void
  onBrowseLegacy?: () => void
}) {
  const { cards, isLoading } = useLiveMints()
  const [ref, { width }] = useElementSize()
  const narrow = width > 0 && width <= 620

  const [featured, ...rest] = cards

  return (
    <Layout ref={ref} className={narrow ? 'narrow' : undefined}>
      <Wrap>
        <Head>
          <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>miyamaker · Mint</Eyebrow>
          <DisplayTitle>Live mints</DisplayTitle>
          <Lead>Pick a collection to mint. Prices and counts are live from the chain.</Lead>
        </Head>

        <Tabs role="tablist" aria-label="Mint sections">
          <Tab type="button" role="tab" aria-selected $active>
            Collections
          </Tab>
          <Tab type="button" role="tab" aria-selected={false} onClick={onMusic}>
            ♪ Music drops
          </Tab>
        </Tabs>

        {featured && <Featured card={featured} onOpen={onOpen} loading={isLoading} />}

        <SectionTitle>More from the miyamaker group</SectionTitle>
        <Grid>
          {rest.map((c) => (
            <MintCard key={c.key} card={c} onOpen={onOpen} loading={isLoading && c.status !== 'soon'} />
          ))}
          {onLaunch && <LaunchCard onLaunch={onLaunch} />}
        </Grid>

        {onBrowseLegacy && (
          <Footer>
            <SmallButton type="button" onClick={onBrowseLegacy}>
              Older collections
            </SmallButton>
          </Footer>
        )}
      </Wrap>
    </Layout>
  )
}

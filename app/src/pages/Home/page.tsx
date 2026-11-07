import latheArt from 'assets/imd/lathe.webp'
import networkArt from 'assets/imd/network.webp'
import rosetteArt from 'assets/imd/rosette.webp'
import Miya from 'assets/miya.png?preset=avatar&resize=true'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import styled, { keyframes } from 'styled-components/macro'

import License from '@/components/License'
import { explorerUrl } from '@/config/wagmi'
import { IMDUSD_TREASURY, IMDUSD_V1, INFER, INFER_SUPPLY, LINKS, MIYA, MIYANET_CHAIN_ID } from '@/constants/miyanet'
import { BUILD_PATH } from '@/pages/Build/starters'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { BadgeWall, HitCounter } from './Badges'
import Claim from './Claim'
import SwarmSearch from './SwarmSearch'
import Ticker from './Ticker'
import { useRedemptionState } from './useMiyanet'
import { LaunchYourOwn, NowMinting } from './WayIn'
import Webring from './Webring'
import {
  LinkRow,
  NewTag,
  PortalBox,
  Prose,
  PushButton,
  reducedMotion,
  starfield,
  UnderConstruction,
  useWidth,
  y2k,
} from './y2k'

const SECTIONS = {
  search: 'miyanet-search',
  mint: 'miyanet-mint',
  launch: 'miyanet-launch',
  claim: 'miyanet-claim',
  infer: 'miyanet-infer',
  imdusd: 'miyanet-imdusd',
  map: 'miyanet-map',
  heritage: 'miyanet-heritage',
  ring: 'miyanet-webring',
} as const

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-color: ${y2k.headTo} ${y2k.night};
  ${starfield}
  color: ${color.ink};
`

const twinkle = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.7); }
`

const Masthead = styled.header`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[6]} ${space[4]} ${space[4]};
  text-align: center;
  scroll-margin-top: 0;
  .narrow & {
    padding: ${space[5]} ${space[3]} ${space[3]};
  }
`

const Logo = styled.h1`
  position: relative;
  margin: 0;
  font-family: ${font.display};
  font-weight: 400;
  font-size: 64px;
  line-height: 1;
  letter-spacing: 0.04em;
  background: ${y2k.chrome};
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(3px 3px 0 ${color.accentDark}) drop-shadow(1px 1px 0 ${color.dark});
  .narrow & {
    font-size: 44px;
  }
`

const Sparkle = styled.span`
  position: absolute;
  font-family: ${font.ui};
  font-size: 22px;
  color: #fff;
  -webkit-text-fill-color: #fff;
  text-shadow: 0 0 6px ${color.accent};
  animation: ${twinkle} 1.8s ease-in-out infinite;
  &.a {
    left: -26px;
    top: -6px;
  }
  &.b {
    right: -22px;
    bottom: -4px;
    font-size: 16px;
    animation-delay: 0.9s;
  }
  ${reducedMotion} {
    animation: none;
  }
`

const Tagline = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.5;
  color: #fff;
  max-width: 52ch;
  em {
    font-style: normal;
    color: #f5c6f6;
  }
`

/** The way in for someone who came for NFTs, not the swarm. Same width as the search box below it. */
const Start = styled.div`
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[3]};
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: ${space[3]};
  /* imdUSD's guilloché rosette, from its site, over the portal's title strip. */
  background: url(${rosetteArt}) right -70px center / 300px no-repeat,
    linear-gradient(90deg, ${y2k.headFrom}, ${y2k.headTo});
  color: ${color.highlight};
  box-shadow: inset 1px 1px #a98bf0, inset -1px -1px ${y2k.night}, 0 0 0 1px ${y2k.night};
  text-align: left;
  font-size: ${text.sm};
  line-height: 1.45;
  b {
    display: block;
    margin-bottom: 2px;
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.lg};
    text-shadow: 1px 1px 0 ${color.dark};
  }
  .actions {
    display: flex;
    gap: ${space[2]};
  }
  .actions button {
    min-height: 40px;
    white-space: nowrap;
  }
  .actions button.primary {
    background: ${color.accent};
  }
  .actions button.primary:hover:not(:disabled) {
    background: #e48fe5;
  }
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    .actions button {
      flex: 1 1 0;
    }
  }
`

const Portal = styled.div`
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  align-items: start;
  gap: ${space[4]};
  padding: ${space[4]};
  max-width: 1320px;
  margin: 0 auto;
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    gap: ${space[3]};
    padding: ${space[3]};
  }
`

const Sidebar = styled.aside`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  position: sticky;
  top: ${space[3]};
  .narrow & {
    position: static;
  }
  .wide-only {
    .narrow & {
      display: none;
    }
  }
`

const NavList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  li {
    display: flex;
    align-items: center;
    gap: ${space[2]};
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 2px 0;
    border: none;
    background: none;
    font-family: ${font.ui};
    font-size: ${text.sm};
    color: ${color.link};
    text-align: left;
    cursor: pointer;
    &::before {
      content: '»';
      color: ${color.accentDark};
    }
    .label {
      text-decoration: underline;
    }
    &:hover {
      color: ${color.accentDark};
    }
  }
  small {
    display: block;
    font-size: ${text.xs};
    color: ${color.inkMuted};
    text-decoration: none;
  }
  .narrow & {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0 ${space[3]};
    button {
      min-height: 44px;
    }
    small {
      display: none;
    }
  }
`

const Main = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'mint' 'launch' 'claim' 'infer' 'imdusd' 'map' 'heritage' 'ring';
  gap: ${space[4]};
  align-items: start;
  min-width: 0;
  .wide & {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'mint launch'
      'claim infer'
      'claim imdusd'
      'heritage ring'
      'map map';
  }
  .narrow & {
    gap: ${space[3]};
  }
`

const Address = styled.a`
  font-family: ${font.mono};
  font-size: ${text.xs};
  color: ${color.link};
  word-break: break-all;
`

const ContractWell = styled.div`
  padding: ${space[2]} ${space[3]};
  background: #fff;
  box-shadow: ${bevel.sunken};
  display: flex;
  flex-direction: column;
  gap: 2px;
  span {
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
`

const Upgrade = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[3]};
  border: 2px dashed ${y2k.headTo};
  background: ${y2k.paperAlt};
`

const Flow = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: ${space[2]};
  .wide & {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  li {
    display: flex;
    flex-direction: column;
    gap: ${space[1]};
    padding: ${space[3]};
    background: #fff;
    box-shadow: ${bevel.sunken};
  }
  strong {
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.lg};
    color: ${color.accentDark};
  }
  span {
    font-family: ${font.body};
    font-size: ${text.sm};
    line-height: 1.5;
    color: ${color.ink};
  }
`

const Homepage = styled.div`
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: ${space[4]};
  align-items: start;
  font-family: Georgia, 'Times New Roman', serif;
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
  }
  figure {
    margin: 0;
    padding: 4px;
    background: #fff;
    box-shadow: ${bevel.sunken};
    text-align: center;
    width: 104px;
  }
  figure img {
    display: block;
    width: 96px;
    height: 96px;
    margin: 0;
    border: none;
    image-rendering: pixelated;
  }
  figcaption {
    font-size: ${text.xs};
    font-style: italic;
    color: ${color.inkMuted};
  }
  ${Prose} {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 17px;
  }
`

const Footer = styled.footer`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[4]} ${space[4]} ${space[2]};
  text-align: center;
  color: #fff;
  font-size: ${text.xs};
  .narrow-only {
    display: none;
    .narrow & {
      display: flex;
    }
  }
  a {
    color: #c9d4ff;
  }
`

const ext = { target: '_blank', rel: 'noreferrer noopener' } as const

function TokenLink({ address }: { address: string }) {
  return (
    <Address {...ext} href={`${explorerUrl(MIYANET_CHAIN_ID)}/token/${address}`}>
      {address}
    </Address>
  )
}

function Contract({ label, address }: { label: string; address: string }) {
  return (
    <ContractWell>
      <span>{label}</span>
      <TokenLink address={address} />
    </ContractWell>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [layoutRef, width] = useWidth<HTMLDivElement>()
  const narrow = width > 0 && width <= 620
  const wide = width >= 1100
  const { miyaSupply } = useRedemptionState()

  const jump = (id: string) => {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  const nav: { id?: string; label: string; note: string; tag?: ReactNode; onClick?: () => void }[] = [
    { id: SECTIONS.mint, label: 'Now minting', note: 'collect an NFT' },
    { id: SECTIONS.launch, label: 'Launch', note: 'sell your art' },
    { id: SECTIONS.search, label: 'Search', note: 'ask the swarm' },
    { id: SECTIONS.claim, label: 'The Claim', note: 'MIYA, MXXN to INFER', tag: <NewTag>NEW!</NewTag> },
    { id: SECTIONS.infer, label: 'INFER', note: 'the token' },
    { id: SECTIONS.imdusd, label: 'imdUSD', note: 'the dollar' },
    { id: SECTIONS.map, label: 'How it fits', note: 'the big picture' },
    { id: SECTIONS.ring, label: 'Webring', note: 'more miya sites' },
    { label: 'Build', note: 'with the swarm', onClick: () => navigate(BUILD_PATH) },
  ]

  return (
    <Layout ref={layoutRef} className={narrow ? 'narrow' : (wide && 'wide') || undefined}>
      <Masthead id={SECTIONS.search}>
        <Logo>
          <Sparkle className="a" aria-hidden>
            ✦
          </Sparkle>
          miyanet
          <Sparkle className="b" aria-hidden>
            ✧
          </Sparkle>
        </Logo>
        <Tagline>
          Your start page for the <em>miyanet</em> on Ethereum. Ask the swarm, a crowd of AI helpers, to build things.
        </Tagline>
        <Start>
          <div>
            <b>Make and collect NFTs</b>
            An NFT is a piece of art or music you own, recorded on Ethereum. Collect one in Mint, or sell your own with Launch.
          </div>
        </Start>
        <SwarmSearch />
      </Masthead>

      <Ticker />

      <Portal>
        <Sidebar>
          <PortalBox title="links" label="miyanet links">
            <nav aria-label="miyanet sections">
              <NavList>
                {nav.map((item) => (
                  <li key={item.label}>
                    <button type="button" onClick={item.onClick || (() => item.id && jump(item.id))}>
                      <span>
                        <span className="label">{item.label}</span>
                        <small>{item.note}</small>
                      </span>
                    </button>
                    {item.tag}
                  </li>
                ))}
              </NavList>
            </nav>
          </PortalBox>
          <div className="wide-only">
            <PortalBox title="counter" label="MIYA counter">
              <HitCounter miyaSupply={miyaSupply} />
            </PortalBox>
          </div>
        </Sidebar>

        <Main>
          <div style={{ gridArea: 'mint', minWidth: 0 }}>
            <NowMinting id={SECTIONS.mint} />
          </div>
          <div style={{ gridArea: 'launch', minWidth: 0 }}>
            <LaunchYourOwn id={SECTIONS.launch} />
          </div>
          <Claim id={SECTIONS.claim} style={{ gridArea: 'claim' }} />

          <PortalBox id={SECTIONS.infer}
          art={networkArt} title="INFER" label="INFER" style={{ gridArea: 'infer' }}>
            <Prose>
              <p>
                INFER is the main token of miyamaker and of imdUSD. There will only ever be{' '}
                {INFER_SUPPLY.toLocaleString('en-US')} INFER.
              </p>
              <p>imdUSD holders earn it, season by season. A set share is kept for MIYA holders.</p>
            </Prose>
            <Contract label="INFER contract" address={INFER} />
            <LinkRow>
              <a {...ext} href={LINKS.tokenomics}>
                Tokenomics
              </a>
              <a {...ext} href={LINKS.infer}>
                Stake
              </a>
            </LinkRow>
          </PortalBox>

          <PortalBox id={SECTIONS.imdusd}
          art={latheArt} title="imdUSD" label="imdUSD" style={{ gridArea: 'imdusd' }}>
            <Prose>
              <p>
                <strong>imdUSD is a dollar, not an investment.</strong> It is the steady part of the miyanet. miyamaker
                sends its 1% fee to the imdUSD Treasury. Swapping into or out of imdUSD in Trade has no miyamaker fee.
              </p>
              <p>
                <strong>Hold imdUSD, earn INFER.</strong> Each day you hold imdUSD earns season points. When a season
                ends, your points turn into INFER you can claim.
              </p>
            </Prose>
            <Upgrade>
              <div>
                <UnderConstruction>
                  <span>under construction</span>
                </UnderConstruction>
              </div>
              <Prose>
                <p>
                  <strong>imdUSD v2 is on the way.</strong> It adds more kinds of collateral, a savings version of
                  imdUSD, and a path to Robinhood Chain. The token live today is <em>imdUSD v1</em>. When v2 launches,
                  v1 moves across. Follow{' '}
                  <a {...ext} href={LINKS.imdusd}>
                    imdusd.com
                  </a>{' '}
                  for dates. Nothing here is a promise of price or yield.
                </p>
              </Prose>
            </Upgrade>
            <Contract label="imdUSD v1 contract" address={IMDUSD_V1} />
            <LinkRow>
              <a {...ext} href={LINKS.docs}>
                Docs
              </a>
              <a {...ext} href={LINKS.whitepaper}>
                Whitepaper
              </a>
            </LinkRow>
          </PortalBox>

          <PortalBox
            id={SECTIONS.map}
            title="How it fits together"
            label="How the miyanet fits together"
            style={{ gridArea: 'map' }}
          >
            <Flow>
              <li>
                <strong>Make</strong>
                <span>Launch drops, editions and auctions. Each sale sends 1% to the imdUSD Treasury.</span>
              </li>
              <li>
                <strong>Align</strong>
                <span>Every collection sends at least 10% of its sales to its own alignment vault.</span>
              </li>
              <li>
                <strong>Hold</strong>
                <span>imdUSD earns season points. Points become INFER.</span>
              </li>
              <li>
                <strong>Trade</strong>
                <span>Swap INFER and imdUSD in Trade, or trade NFTs through zero-fee pools.</span>
              </li>
            </Flow>
            <Prose style={{ fontSize: text.xs }}>
              <p>
                imdUSD Treasury{' '}
                <Address {...ext} href={`${explorerUrl(MIYANET_CHAIN_ID)}/address/${IMDUSD_TREASURY}`}>
                  {`${IMDUSD_TREASURY.slice(0, 6)}…${IMDUSD_TREASURY.slice(-4)}`}
                </Address>
              </p>
            </Prose>
          </PortalBox>

          <PortalBox
            id={SECTIONS.heritage}
            title="Where miya came from"
            label="Where miya came from"
            style={{ gridArea: 'heritage' }}
          >
            <Homepage>
              <figure>
                <img src={Miya[0]?.src} alt="Miya" />
                <figcaption>miya, est. 2023</figcaption>
              </figure>
              <Prose>
                <p>
                  Miya began as $MIYA, the Black Hearted Cyber Angel Baby Token: an experiment in network spirituality
                  that only let holders of approved NFT collections trade it. It was forked from the Radbro
                  Webring&apos;s BroCoin. Made by{' '}
                  <a {...ext} href="https://twitter.com/yadfarms">
                    b
                  </a>{' '}
                  with art by{' '}
                  <a {...ext} href="https://twitter.com/Cambodius">
                    Cambodius
                  </a>
                  , with undying love for the{' '}
                  <a {...ext} href="https://remilia.org/">
                    Remilia Collective
                  </a>{' '}
                  and{' '}
                  <a {...ext} href="https://radbro.xyz/">
                    Radbro Webring
                  </a>
                  .
                </p>
                <p>
                  MIYA now retires into INFER: every MIYA redeemed is burned. MIYA contract <TokenLink address={MIYA} />
                </p>
                <p style={{ fontSize: text.xs, color: color.inkMuted }}>
                  No affiliation with Remilia Corporation or Radbro Webring. Do not risk more than you are willing to
                  lose.
                </p>
              </Prose>
            </Homepage>
          </PortalBox>

          <Webring id={SECTIONS.ring} style={{ gridArea: 'ring' }} />
        </Main>
      </Portal>

      <Footer>
        <BadgeWall />
        <div className="narrow-only">
          <PortalBox title="counter" label="MIYA counter">
            <HitCounter miyaSupply={miyaSupply} />
          </PortalBox>
        </div>
        <span>best viewed in miyaOS at 800x600. made with love on the miyanet.</span>
      </Footer>
      <License />
    </Layout>
  )
}

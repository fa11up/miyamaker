import { useConnectModal } from '@rainbow-me/rainbowkit'
import Miya from 'assets/miya.png?preset=avatar&resize=true'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { formatUnits, parseUnits } from 'viem'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import License from '@/components/License'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, Skeleton, StatRow, StatusBox, Well } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import {
  IMDUSD_TREASURY,
  IMDUSD_V1,
  INFER,
  INFER_SUPPLY,
  LEGACY_REDEEMER,
  LINKS,
  MIYA,
  MIYA_IMMEDIATE_LIMIT,
  MIYANET_CHAIN_ID,
} from '@/constants/miyanet'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import { color, font, space, text } from '@/theme/tokens'

import SwarmSearch from './SwarmSearch'
import { useMiyanetTx, useRedemptionState, useWalletPosition } from './useMiyanet'

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${color.faceLight};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'head head'
    'search search'
    'infer redeem'
    'imdusd redeem'
    'map map'
    'heritage heritage';
  gap: ${space[4]};
  padding: ${space[4]};
  max-width: 980px;
  margin: 0 auto;

  .narrow & {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'search' 'infer' 'redeem' 'imdusd' 'map' 'heritage';
    gap: ${space[3]};
    padding: ${space[3]};
  }
`

const Head = styled.header`
  grid-area: head;
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
`

const Lede = styled.p`
  margin: 0;
  font-family: ${font.body};
  font-size: ${text.sm};
  line-height: 1.6;
  color: ${color.ink};
  max-width: 60ch;
`

const Body = styled.div`
  font-family: ${font.body};
  font-size: ${text.sm};
  line-height: 1.6;
  color: ${color.ink};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  p {
    margin: 0;
  }
  a {
    color: ${color.link};
  }
  ul {
    margin: 0;
    padding-left: ${space[5]};
  }
`

const H2 = styled.h2`
  margin: 0;
  font-family: ${font.display};
  font-size: ${text.lg};
  color: ${color.ink};
`

const Muted = styled.p`
  margin: 0;
  font-size: ${text.xs};
  color: ${color.inkMuted};
  line-height: 1.5;
  a {
    color: ${color.link};
  }
`

const Address = styled.a`
  font-family: ${font.mono};
  font-size: ${text.xs};
  color: ${color.link};
  word-break: break-all;
`

const Row = styled.div`
  display: flex;
  gap: ${space[2]};
  flex-wrap: wrap;
  align-items: center;
`

const AmountField = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  height: 40px;
  input {
    min-width: 0;
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: inset 1px 1px ${color.shadow}, inset -1px -1px ${color.highlight}, inset 2px 2px ${color.dark};
    padding: 0 ${space[3]};
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
  }
  button {
    border: none;
    padding: 0 ${space[3]};
    background: ${color.face};
    box-shadow: inset -1px -1px ${color.dark}, inset 1px 1px ${color.highlight};
    cursor: pointer;
  }
`

const SmallButton = styled.button`
  border: none;
  padding: ${space[1]} ${space[3]};
  background: ${color.face};
  color: ${color.ink};
  box-shadow: inset -1px -1px ${color.dark}, inset 1px 1px ${color.highlight}, inset -2px -2px ${color.shadow};
  cursor: pointer;
  &:disabled {
    color: ${color.shadow};
    cursor: not-allowed;
  }
`

const Flow = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${space[2]};
  .narrow & {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  li {
    display: flex;
    flex-direction: column;
    gap: ${space[1]};
    padding: ${space[3]};
  }
  strong {
    font-family: ${font.display};
  }
  span {
    font-family: ${font.body};
    font-size: ${text.xs};
    line-height: 1.5;
    color: ${color.inkMuted};
  }
`

const Heritage = styled(Panel)`
  grid-area: heritage;
  flex-direction: row;
  align-items: flex-start;
  gap: ${space[4]};
  img {
    width: 96px;
    height: 96px;
    flex: 0 0 auto;
    border: none;
    margin: 0;
  }
  .narrow & {
    flex-direction: column;
  }
`

const num = (value: bigint | undefined, decimals = 18, digits = 2) =>
  value === undefined
    ? '–'
    : Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: digits })

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function TokenLink({ address }: { address: string }) {
  return (
    <Address href={`${explorerUrl(MIYANET_CHAIN_ID)}/token/${address}`} target="_blank" rel="noreferrer noopener">
      {address}
    </Address>
  )
}

function RedeemPanel() {
  const state = useRedemptionState()
  const wallet = useWalletPosition()
  const tx = useMiyanetTx(() => {
    wallet.refetch()
    state.refetch()
  })
  const { openConnectModal } = useConnectModal()
  const [input, setInput] = useState('')

  useEffect(() => {
    if (wallet.miya !== undefined && input === '') setInput(formatUnits(wallet.miya, 18))
  }, [wallet.miya])

  useEffect(() => {
    if (tx.isConfirmed && tx.lastAction === 'redeem') setInput('')
  }, [tx.isConfirmed])

  let amount: bigint | undefined
  try {
    amount = input.trim() ? parseUnits(input.trim(), 18) : undefined
  } catch {
    amount = undefined
  }

  const out = amount !== undefined && state.rate !== undefined ? (amount * state.rate) / 10n ** 18n : undefined
  const tooMuch = amount !== undefined && wallet.miya !== undefined && amount > wallet.miya
  const closed = state.closesAt !== undefined && Date.now() / 1000 >= state.closesAt
  const busy = tx.isAwaitingWallet || tx.isConfirming
  const err = describeError(tx.error)
  const txUrl = tx.hash ? `${explorerUrl(MIYANET_CHAIN_ID)}/tx/${tx.hash}` : undefined
  const needsApproval = amount !== undefined && wallet.allowance !== undefined && wallet.allowance < amount

  const action = (() => {
    const idle = () => {}

    if (state.isError) return { label: 'Unavailable', disabled: true, onClick: idle }
    if (closed) return { label: 'Redemption closed', disabled: true, onClick: idle }
    if (!tx.isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (tx.wrongChain)
      return {
        label: tx.isSwitching ? 'Switching…' : 'Switch to Ethereum',
        disabled: tx.isSwitching,
        onClick: tx.switchToMainnet,
      }
    if (tx.isAwaitingWallet) return { label: 'Confirm in wallet…', disabled: true, onClick: idle }
    if (tx.isConfirming) return { label: 'Confirming…', disabled: true, onClick: idle }
    if (wallet.miya === 0n) return { label: 'No MIYA in this wallet', disabled: true, onClick: idle }
    if (amount === undefined || amount === 0n) return { label: 'Enter an amount', disabled: true, onClick: idle }
    if (tooMuch) return { label: 'More than your MIYA', disabled: true, onClick: idle }
    if (needsApproval)
      return { label: 'Step 1 of 2: approve MIYA', disabled: false, onClick: () => tx.approve(amount!) }
    return { label: 'Burn MIYA for INFER', disabled: false, onClick: () => tx.redeem(amount!) }
  })()

  const vestingLeft = wallet.vesting ? wallet.vesting.total - wallet.vesting.claimed : 0n
  const closesOn = state.closesAt
    ? new Date(state.closesAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : undefined

  return (
    <Panel style={{ gridArea: 'redeem' }} aria-label="Redeem MIYA for INFER">
      <Row style={{ justifyContent: 'space-between' }}>
        <H2>The claim</H2>
        {state.isLoading ? (
          <Chip tone="off">Reading chain</Chip>
        ) : state.isError ? (
          <Chip tone="warn">RPC unavailable</Chip>
        ) : closed ? (
          <Chip tone="off">Closed</Chip>
        ) : (
          <Chip tone="ok">Open</Chip>
        )}
      </Row>
      <Body>
        <p>
          MIYA holders burn MIYA for INFER at a fixed rate. The first {MIYA_IMMEDIATE_LIMIT.toLocaleString('en-US')}{' '}
          MIYA per wallet pays out at once; anything above that vests over one 13-week season.
        </p>
      </Body>

      <Well style={{ padding: `${space[2]} ${space[3]}`, display: 'flex', flexDirection: 'column', gap: space[1] }}>
        <StatRow>
          <span>Rate</span>
          {state.isLoading ? <Skeleton w="120px" h="18px" /> : <strong>{num(state.rate, 18, 4)} INFER / MIYA</strong>}
        </StatRow>
        <StatRow>
          <span>INFER left for MIYA</span>
          {state.isLoading ? <Skeleton w="120px" h="18px" /> : <strong>{num(state.inferLeft, 18, 0)}</strong>}
        </StatRow>
        <StatRow>
          <span>Window closes</span>
          <strong>{closesOn || '–'}</strong>
        </StatRow>
      </Well>

      {tx.isConnected && (
        <Well style={{ padding: `${space[2]} ${space[3]}`, display: 'flex', flexDirection: 'column', gap: space[1] }}>
          <StatRow>
            <span>Your MIYA</span>
            <strong>{num(wallet.miya)}</strong>
          </StatRow>
          <StatRow>
            <span>Your INFER</span>
            <strong>{num(wallet.infer)}</strong>
          </StatRow>
          <StatRow>
            <span>Your imdUSD v1</span>
            <strong>{num(wallet.imdusd)}</strong>
          </StatRow>
        </Well>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
        <Eyebrow as="label" htmlFor="miya-amount">
          MIYA to burn
        </Eyebrow>
        <AmountField>
          <input
            id="miya-amount"
            inputMode="decimal"
            placeholder="0.0"
            value={input}
            disabled={busy || !tx.isConnected}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <button
            type="button"
            disabled={busy || wallet.miya === undefined}
            onClick={() => wallet.miya !== undefined && setInput(formatUnits(wallet.miya, 18))}
          >
            Max
          </button>
        </AmountField>
        <StatRow>
          <span>You receive</span>
          <strong>{num(out)} INFER</strong>
        </StatRow>
        {tx.isConnected && amount === wallet.miya && wallet.redeemLater !== undefined && wallet.redeemLater > 0n && (
          <Muted>
            {num(wallet.redeemNow)} now, {num(wallet.redeemLater)} vesting over 13 weeks.
          </Muted>
        )}
      </div>

      <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </BigButton>

      {vestingLeft > 0n && (
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>
            Vesting: {num(vestingLeft)} INFER left, {num(wallet.claimable)} ready.
          </Muted>
          <SmallButton type="button" disabled={busy || tx.wrongChain || !wallet.claimable} onClick={() => tx.claim()}>
            Collect
          </SmallButton>
        </Row>
      )}

      {busy && (
        <StatusBox tone="info" role="status">
          <img src={LoadingHourglass} alt="" />
          <span>
            {tx.isAwaitingWallet ? 'Confirm the transaction in your wallet.' : 'Waiting for confirmation. '}
            {txUrl && (
              <a href={txUrl} target="_blank" rel="noreferrer noopener">
                View on Etherscan
              </a>
            )}
          </span>
        </StatusBox>
      )}
      {tx.isConfirmed && (
        <StatusBox tone="ok" role="status">
          <span>
            {tx.lastAction === 'approve'
              ? 'Approved. Now burn your MIYA for INFER.'
              : tx.lastAction === 'claim'
              ? 'Collected your vested INFER.'
              : 'Done. Your INFER is in your wallet.'}{' '}
            <a href={txUrl} target="_blank" rel="noreferrer noopener">
              View transaction
            </a>
          </span>
        </StatusBox>
      )}
      {(tx.reverted || (tx.error && !busy)) && (
        <StatusBox tone={err.cancelled ? 'info' : 'error'} role="alert">
          <span>{tx.reverted ? 'The transaction reverted.' : err.message}</span>
        </StatusBox>
      )}

      <Muted>
        Burning is permanent. Approval is for the exact amount only. Redeemer contract{' '}
        <Address
          href={`${explorerUrl(MIYANET_CHAIN_ID)}/address/${LEGACY_REDEEMER}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {short(LEGACY_REDEEMER)}
        </Address>
        . Season points and MXXN claims live on the{' '}
        <a href={LINKS.claim} target="_blank" rel="noreferrer noopener">
          official claim page
        </a>
        .
      </Muted>
    </Panel>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [layoutRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 620

  return (
    <Layout ref={layoutRef} className={narrow ? 'narrow' : undefined}>
      <Grid>
        <Head>
          <Eyebrow style={{ color: color.accentDark }}>miyanet · Ethereum</Eyebrow>
          <DisplayTitle>miyanet explorer</DisplayTitle>
          <Lede>
            One token runs through everything on miyamaker. INFER is the token of the miyanet: MIYA holders claim it,
            imdUSD holders earn it, and it trades right here in miya swaps.
          </Lede>
        </Head>

        <SwarmSearch />

        <Panel style={{ gridArea: 'infer' }} aria-label="INFER">
          <H2>INFER</H2>
          <Body>
            <p>
              INFER is the protocol token of imdUSD and the main token of the miyamaker ecosystem. It has a fixed supply
              of {INFER_SUPPLY.toLocaleString('en-US')}, shared out to imdUSD holders season by season, with a set
              portion reserved for MIYA holders.
            </p>
          </Body>
          <Well style={{ padding: `${space[2]} ${space[3]}` }}>
            <Eyebrow>INFER contract</Eyebrow>
            <TokenLink address={INFER} />
          </Well>
          <Row>
            <SmallButton type="button" onClick={() => navigate('/swap')}>
              Swap for INFER
            </SmallButton>
            <a href={LINKS.tokenomics} target="_blank" rel="noreferrer noopener">
              Tokenomics
            </a>
            <a href={LINKS.infer} target="_blank" rel="noreferrer noopener">
              Stake
            </a>
          </Row>
        </Panel>

        <RedeemPanel />

        <Panel style={{ gridArea: 'imdusd' }} aria-label="imdUSD">
          <H2>imdUSD</H2>
          <Body>
            <p>
              imdUSD is a dollar, not an investment. It is the stable side of the miyanet: miyamaker sends its 1%
              protocol fee to the imdUSD Treasury, and swaps into or out of imdUSD carry no miya swaps fee.
            </p>
            <p>
              <strong>Hold imdUSD, earn INFER.</strong> Every day you hold imdUSD earns season points, and points become
              INFER claims when the season ends.
            </p>
            <p>
              <strong>The upgrade.</strong> imdUSD v2 is on the way: more kinds of collateral, a savings version of
              imdUSD, and a path to Robinhood Chain. The token live today is <em>imdUSD v1</em>; when v2 launches, v1
              moves across. Follow{' '}
              <a href={LINKS.imdusd} target="_blank" rel="noreferrer noopener">
                imdusd.com
              </a>{' '}
              for dates. Nothing here is a promise of price or yield.
            </p>
          </Body>
          <Well style={{ padding: `${space[2]} ${space[3]}` }}>
            <Eyebrow>imdUSD v1 contract</Eyebrow>
            <TokenLink address={IMDUSD_V1} />
          </Well>
          <Row>
            <a href={LINKS.docs} target="_blank" rel="noreferrer noopener">
              Docs
            </a>
            <a href={LINKS.whitepaper} target="_blank" rel="noreferrer noopener">
              Whitepaper
            </a>
          </Row>
        </Panel>

        <Panel style={{ gridArea: 'map' }} aria-label="How the miyanet fits together">
          <H2>How it fits together</H2>
          <Flow>
            <Well as="li">
              <strong>Make</strong>
              <span>Launch drops, editions and auctions. Each sale sends 1% to the imdUSD Treasury.</span>
            </Well>
            <Well as="li">
              <strong>Align</strong>
              <span>Every collection sends at least 10% of its sales to its own alignment vault.</span>
            </Well>
            <Well as="li">
              <strong>Hold</strong>
              <span>imdUSD earns season points. Points become INFER.</span>
            </Well>
            <Well as="li">
              <strong>Trade</strong>
              <span>Swap INFER and imdUSD in miya swaps. NFT pools are coming.</span>
            </Well>
          </Flow>
          <Muted>
            Treasury{' '}
            <Address
              href={`${explorerUrl(MIYANET_CHAIN_ID)}/address/${IMDUSD_TREASURY}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {short(IMDUSD_TREASURY)}
            </Address>
          </Muted>
        </Panel>

        <Heritage aria-label="Where miya came from">
          <img src={Miya[0]?.src} alt="Miya" />
          <Body>
            <H2>Where miya came from</H2>
            <p>
              Miya began as $MIYA, the Black Hearted Cyber Angel Baby Token: an experiment in network spirituality that
              only let holders of approved NFT collections trade it, forked from the Radbro Webring&apos;s BroCoin. Made
              by{' '}
              <a href="https://twitter.com/yadfarms" target="_blank" rel="noreferrer noopener">
                b
              </a>{' '}
              with art by{' '}
              <a href="https://twitter.com/Cambodius" target="_blank" rel="noreferrer noopener">
                Cambodius
              </a>
              , with undying love for the{' '}
              <a href="https://remilia.org/" target="_blank" rel="noreferrer noopener">
                Remilia Collective
              </a>{' '}
              and{' '}
              <a href="https://radbro.xyz/" target="_blank" rel="noreferrer noopener">
                Radbro Webring
              </a>
              .
            </p>
            <p>
              MIYA now retires into INFER: every MIYA redeemed is burned. MIYA contract <TokenLink address={MIYA} />
            </p>
            <Muted>
              No affiliation with Remilia Corporation or Radbro Webring. Do not risk more than you are willing to lose.
            </Muted>
          </Body>
        </Heritage>
      </Grid>
      <License />
    </Layout>
  )
}

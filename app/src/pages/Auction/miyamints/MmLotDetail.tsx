import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { useAccount, useBalance } from 'wagmi'

import ArtViewer, { toArtwork } from '@/components/ArtViewer'
import { ConnectedButton } from '@/components/Button'
import { NormalButton } from '@/components/Button/NormalButton'
import NftImage from '@/components/NftImage'
import { explorerUrl } from '@/config/wagmi'
import { shortAddress } from '@/desktop/mints/dedupe'
import { plainTxError, TX_CHECK_WORDS } from '@/miyamints/errors'
import { approveWords, isEth } from '@/miyamints/tokens'
import { usePay, useTokenInfo, useWalletToken } from '@/miyamints/usePay'
import { useTx } from '@/miyamints/useTx'
import { bidEnding, bidStanding, checkBid } from '@/pages/Auction/bidding'
import ImageWrapper from '@/pages/Auction/ImageWrapper'
import BidContainer, { StuckBid } from '@/pages/Auction/ProductDetail/BidContainer'
import { useToken } from '@/pages/Auction/useToken'

import { mmAuctionAbi } from './abi'
import {
  antiSnipeWords,
  BID_MESSAGE_WORDS,
  canCloseUnsold,
  cleanBidMessage,
  MAX_BID_MESSAGE,
  hasBids,
  minimumNextBid,
  mmFacts,
  mmPhase,
  refundWords,
  settleWords,
  unitAmount,
  UNSOLD_CLOSE_GRACE_S,
  unsoldWords,
} from './rules'
import type { MmUnit } from './rules'
import type { MmLotRef } from './useMmAuctions'
import { lotKeyOf, useBidHistory, useMmLot, useRefund } from './useMmAuctions'

const Column = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 0.5rem;
`

const Detail = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 1.5rem;

  @media only screen and (max-width: 640px) {
    flex-direction: column;
    gap: 0.75rem;
  }
`

const ArtColumn = styled.div`
  flex: 0 0 33.3333%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;

  @media only screen and (max-width: 640px) {
    flex-basis: auto;
  }
`

const ArtButton = styled.button`
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;

  :focus-visible {
    outline: 1px dotted #14101f;
    outline-offset: 2px;
  }
`

const Placard = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  gap: 0.6rem;
  overflow-wrap: anywhere;
`

const Title = styled.div`
  font-size: 1.1rem;
  font-weight: bolder;
  line-height: 1.25;
`

const Byline = styled.div`
  font-size: 0.75rem;
  color: #5f4030;
  margin-top: 0.15rem;
`

const Description = styled.p`
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.3;
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const MessageField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  input {
    min-height: 32px;
    padding: 0 0.5rem;
    border: none;
    border-radius: 0;
    box-shadow: inset 0 0 0 1px #a8843a, inset 0 1px 3px rgba(42, 20, 16, 0.25);
    background-color: #fffdf6;
    font: inherit;
  }
  input:disabled {
    background-color: #efe4c8;
  }
  small {
    opacity: 0.8;
  }
`

const BidNote = styled.span`
  display: block;
  font-style: italic;
  overflow-wrap: anywhere;
`

const Facts = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.25rem;
  margin: 0;
  padding-top: 0.6rem;
  border-top: 1px solid #c9a862;
  box-shadow: inset 0 1px 0 #fffaf0;
  font-size: 0.8rem;
  line-height: 1.2;

  > dt {
    color: #5f4030;
  }

  > dd {
    margin: 0;
    min-width: 0;
  }
`

const Updated = styled.span`
  margin-left: 0.5rem;
  color: #5f4030;
  font-size: 0.75rem;
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.8rem;
  line-height: 1.3;

  > p {
    margin: 0;
  }

  > strong {
    font-size: 0.9rem;
  }
`

const History = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;

  th {
    text-align: left;
    font-weight: normal;
    color: #5f4030;
    border-bottom: 1px solid #c9a862;
  }

  td,
  th {
    padding: 0.15rem 0.25rem;
  }

  td:nth-child(2),
  th:nth-child(2) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

const HISTORY_ROWS = 6

function whenWords(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * What an ended lot can come to, and the one action it takes: settle (anyone, with bids), close unsold (the artist
 * now, anyone after the grace period), or claim a piece held for its winner. Each is a dry run, then the wallet, then
 * a wait with a time limit, and an unknown ending keeps its hash and offers only "Start over".
 */
function EndedPanel({
  item,
  lot,
  escrowedTo,
  account,
  now,
  onChanged,
  onStuck,
  unit,
}: {
  unit: MmUnit
  item: MmLotRef
  lot: MmLotRef['lot']
  escrowedTo: Address | undefined
  account: Address | undefined
  now: number
  onChanged: () => void
  onStuck: (stuck: boolean) => void
}) {
  const { house } = item
  const act = useTx(() => onChanged())
  const phase = mmPhase(lot, now)
  const me = account?.toLowerCase()
  const isOwner = !!me && house.owner.toLowerCase() === me
  const won = !!me && lot.highBidder.toLowerCase() === me
  const held = !!me && !!escrowedTo && escrowedTo.toLowerCase() === me
  const unconfirmed = act.unconfirmed
  useEffect(() => onStuck(unconfirmed || act.busy), [unconfirmed, act.busy])

  const run = (id: string, functionName: string, args: readonly unknown[]) =>
    act.run(id, { address: house.address, abi: mmAuctionAbi, functionName, args, chainId: house.chainId })

  const txLink = act.tx.hash ? `${explorerUrl(house.chainId)}/tx/${act.tx.hash}` : undefined
  if (unconfirmed) return <StuckBid words={act.tx.message || ''} href={txLink} onStartOver={act.reset} />

  let summary: string
  let words: string | undefined
  let action: { id: string; label: string; go: () => void } | undefined
  if (phase === 'sold') {
    summary = `Sold for ${unitAmount(lot.highBid, unit)}${won ? ' to you' : ''}.`
    if (held) {
      words = "Your wallet couldn't take the piece when this was settled, so the contract is holding it for you."
      action = {
        id: 'claim',
        label: 'Claim your piece',
        go: () => run('claim', 'claimEscrowedToken', [lot.tokenId, account]),
      }
    }
  } else if (phase === 'unsold') {
    summary = "This piece didn't sell."
    words = `No one bid. The artist's ${unitAmount(lot.minBid, unit)} deposit went to the miya treasury.`
  } else if (hasBids(lot)) {
    summary = won ? `You won with ${unitAmount(lot.highBid, unit)}.` : `Won for ${unitAmount(lot.highBid, unit)}.`
    words = settleWords(lot, house.protocolFeeBps, house.alignmentBps, unit)
    action = {
      id: 'settle',
      label: won ? 'Settle and get the piece' : 'Settle auction',
      go: () => run('settle', 'settleAuction', [lot.tokenId]),
    }
  } else {
    summary = 'This auction ended with no bids.'
    words = unsoldWords(lot, isOwner, unit)
    if (canCloseUnsold(lot, { isOwner, nowMs: now })) {
      action = { id: 'close', label: 'Close unsold', go: () => run('close', 'reclaimUnsold', [lot.tokenId]) }
    } else {
      words += ` The artist can close it now. Anyone can after ${whenWords(lot.endTime + UNSOLD_CLOSE_GRACE_S)}.`
    }
  }

  const label =
    act.tx.phase === 'wallet'
      ? 'Confirm in your wallet…'
      : act.tx.phase === 'pending'
        ? `Waiting for ${house.chainName}…`
        : action?.label
  const failed =
    act.tx.phase === 'error'
      ? act.tx.stage === 'check'
        ? plainTxError(act.tx.error, TX_CHECK_WORDS)
        : act.tx.message || plainTxError(act.tx.error)
      : undefined

  return (
    <Panel>
      <strong>{summary}</strong>
      {words && <p>{words}</p>}
      {act.tx.phase === 'done' && <p role="status">Done. It may take a few seconds to show here.</p>}
      {failed && <p role="alert">{failed}</p>}
      {action && act.tx.phase !== 'done' && (
        <div>
          <ConnectedButton withChain={[house.chainId]} disabled={act.busy} onClick={action.go}>
            {label}
          </ConnectedButton>
        </div>
      )}
    </Panel>
  )
}

export default function MmLotDetail({
  item,
  onBack,
  onBusy,
  onChanged,
  setErrorMessage,
}: {
  item: MmLotRef
  onBack: () => void
  /** Told while something is out on this lot: the window stays on it until its ending is known. */
  onBusy?: (busy: boolean) => void
  /** The lot changed on chain (a bid or settle landed): the list reads again. */
  onChanged: () => void
  setErrorMessage: (value: string) => void
}) {
  const { house } = item
  const tokenId = item.lot.tokenId
  const { address: account, chain, isConnected } = useAccount()
  // Every bid, deposit and refund in this house is in its one currency.
  const eth = isEth(house.currency)
  const tokenInfo = useTokenInfo(house.chainId, [house.currency])[house.currency.toLowerCase()]
  const unit: MmUnit | undefined = tokenInfo ? { symbol: tokenInfo.symbol, decimals: tokenInfo.decimals, eth } : undefined
  const words = unit ?? { symbol: '…', decimals: 18, eth }
  const { data: wallet } = useBalance({
    address: account,
    chainId: house.chainId as never,
    query: { enabled: !!account && eth, refetchInterval: 30_000 },
  })
  const tokenWallet = useWalletToken(house.chainId, eth ? undefined : house.currency, house.address)
  const balance = eth ? wallet?.value : tokenWallet.balance
  const read = useMmLot(house, tokenId, account)
  // The list's answer stands until this lot's own read comes in.
  const lot = read.lot || item.lot
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const { name, description, image, externalURL, attributes } = useToken({ tokenURI: lot.tokenURI, isFetch: true })
  const title = name || `${house.name} #${tokenId}`
  const [viewing, setViewing] = useState(false)

  const phase = mmPhase(lot, now)
  const facts = mmFacts(lot, phase, words)
  const minimum = minimumNextBid(lot, house.bidIncrement)
  const [bidAmount, setBidAmount] = useState('')
  const [bidMessage, setBidMessage] = useState('')
  const check = unit
    ? checkBid(bidAmount, minimum, balance, unit)
    : { valid: false, label: 'Reading the token…' }
  const canSend = isConnected && chain?.id === house.chainId

  const bid = usePay()
  // The approval landing is not the bid landing: only the bid's own ending (or a failed approval) is reported.
  const ending =
    bid.tx.id === 'bid' || (bid.tx.id === 'bid:approve' && bid.tx.phase === 'error')
      ? bidEnding(bid.tx, house.chainName, words.symbol)
      : undefined
  const busy = bid.tx.phase === 'wallet' ? 'wallet' : bid.tx.phase === 'pending' ? 'mining' : undefined
  const stuck = ending?.kind === 'unconfirmed'
  const [actionBusy, setActionBusy] = useState(false)
  useEffect(() => onBusy?.(!!busy || stuck || actionBusy), [busy, stuck, actionBusy])
  useEffect(() => () => onBusy?.(false), [])

  const lotKey = `${lotKeyOf(house.chainId, house.address, tokenId)}:${account}`
  const led = useRef(new Set<string>())
  const [confirmed, setConfirmed] = useState<string>()
  if (phase === 'live' && account && lot.highBidder.toLowerCase() === account.toLowerCase()) led.current.add(lotKey)
  const standing = phase === 'live' ? bidStanding(lot.highBidder, account, led.current.has(lotKey)) : 'none'
  const standingNote =
    standing === 'leading'
      ? { good: true, words: `You're the highest bidder at ${unitAmount(lot.highBid, words)}.` }
      : standing === 'outbid'
        ? {
            good: false,
            words: eth
              ? "You've been outbid. Your ETH went back to your wallet."
              : `You've been outbid. Your ${words.symbol} is kept for you: claim it back below.`,
          }
        : confirmed === lotKey
          ? { good: true, words: 'Your bid went through.' }
          : undefined

  const changed = () => {
    read.refetch()
    onChanged()
  }

  // A known ending is reported once and the bid re-arms. An unconfirmed one stays, hash and all, until Start over.
  useEffect(() => {
    if (!ending || ending.kind === 'unconfirmed') return
    if (bid.tx.phase === 'error') console.error('Bid failed', bid.tx.error)
    if (ending.kind === 'placed') {
      setBidAmount('')
      setBidMessage('')
      setConfirmed(lotKey)
    } else {
      setErrorMessage(ending.words)
    }
    changed()
    bid.reset()
  }, [bid.tx.phase])

  const handleBid = () => {
    if (!canSend || !check.valid || busy || stuck || phase !== 'live' || check.value === undefined) return
    const amount = check.value
    bid.pay('bid', {
      chainId: house.chainId,
      token: house.currency,
      spender: house.address,
      amount,
      call: {
        address: house.address,
        abi: mmAuctionAbi,
        functionName: 'createBid',
        // ETH: msg.value must equal the amount. An ERC-20: the amount is pulled, msg.value is 0.
        args: [tokenId, amount, cleanBidMessage(bidMessage)],
        value: eth ? amount : 0n,
        chainId: house.chainId,
      },
    })
  }

  const refund = useRefund(house, account, lot.highBid.toString())
  const claim = useTx(() => {
    refund.refetch()
    tokenWallet.refetch()
  })

  const history = useBidHistory(house, tokenId, lot.highBid)
  const rows = history.rows?.slice(0, HISTORY_ROWS)
  const me = account?.toLowerCase()
  const locked = !!busy || stuck || actionBusy

  return (
    <Column>
      <div>
        <NormalButton type="button" disabled={locked} onClick={onBack}>
          ← Collections
        </NormalButton>
      </div>
      <Detail>
        <ArtColumn>
          <ImageWrapper>
            <ArtButton type="button" title={`View ${title}`} onClick={() => image && setViewing(true)}>
              <NftImage src={image || undefined} alt={title} fit="contain" aspect="1 / 1" />
            </ArtButton>
          </ImageWrapper>
          {viewing && image && (
            <ArtViewer
              skin="auction"
              onClose={() => setViewing(false)}
              items={[toArtwork({ name: title, description, image, external_url: externalURL, attributes })]}
              startIndex={0}
            />
          )}
        </ArtColumn>
        <Placard>
          <div>
            <Title>{title}</Title>
            <Byline>
              {house.name} · by {shortAddress(house.owner)} · {house.chainName}
            </Byline>
          </div>
          {description && <Description title={description}>{description}</Description>}
          <Facts>
            <dt>{facts.bidLabel}</dt>
            <dd>
              {facts.bidValue}
              {phase === 'live' && read.updatedAt > 0 && (
                <Updated>Updated {Math.max(0, Math.floor((now - read.updatedAt) / 1000))}s ago</Updated>
              )}
            </dd>
            <dt>{facts.bidderLabel}</dt>
            <dd title={facts.bidderValue ? undefined : lot.highBidder}>
              {facts.bidderValue || (lot.highBidder.toLowerCase() === me ? 'You' : shortAddress(lot.highBidder))}
            </dd>
            {hasBids(lot) && (
              <>
                <dt>Starting price</dt>
                <dd>{unitAmount(lot.minBid, words)} (the artist&apos;s deposit)</dd>
              </>
            )}
            {phase === 'live' && (
              <>
                <dt>Next bid</dt>
                <dd>{unitAmount(minimum, words)} or more</dd>
                <dt>Ends</dt>
                <dd>{whenWords(lot.endTime)}</dd>
              </>
            )}
            {(phase === 'ended' || phase === 'sold' || phase === 'unsold') && lot.endTime > 0 && (
              <>
                <dt>Ended</dt>
                <dd>{whenWords(lot.endTime)}</dd>
              </>
            )}
          </Facts>
          {!eth && refund.amount !== undefined && refund.amount > 0n && unit && (
            <Panel role="status">
              <strong>Refund waiting: {unitAmount(refund.amount, unit)}</strong>
              <p>
                You were outbid in this auction house. Your {unit.symbol} is held for you until you claim it
                {canSend ? '.' : `. Switch your wallet to ${house.chainName} to claim it.`}
              </p>
              {claim.tx.phase === 'error' && <p role="alert">{plainTxError(claim.tx.error, TX_CHECK_WORDS)}</p>}
              {claim.unconfirmed ? (
                <StuckBid
                  words={claim.tx.message || ''}
                  href={claim.tx.hash ? `${explorerUrl(house.chainId)}/tx/${claim.tx.hash}` : undefined}
                  onStartOver={claim.reset}
                />
              ) : (
                <div>
                  <NormalButton
                    type="button"
                    disabled={claim.busy || !canSend}
                    title={canSend ? undefined : `Switch your wallet to ${house.chainName} to claim`}
                    onClick={() =>
                      account &&
                      claim.run('refund', {
                        address: house.address,
                        abi: mmAuctionAbi,
                        functionName: 'claimRefund',
                        args: [account],
                        chainId: house.chainId,
                      })
                    }
                  >
                    {claim.busy ? 'Claiming…' : `Claim ${unitAmount(refund.amount, unit)}`}
                  </NormalButton>
                </div>
              )}
            </Panel>
          )}
          <BidContainer
            unit={words}
            payNote={
              !eth && tokenInfo && check.value !== undefined
                ? approveWords(check.value, tokenInfo, 'this auction house')
                : undefined
            }
            phase={phase === 'queued' ? 'upcoming' : phase === 'live' ? 'live' : 'ended'}
            startTime={lot.startTime}
            endTime={lot.endTime}
            now={now}
            bidAmount={bidAmount}
            onBidAmount={(value) => {
              if (value !== '' && !/(^[0-9]+\.?[0-9]*$)|(^\.[0-9]*$)/.test(value)) return
              setBidAmount(value)
            }}
            onBid={handleBid}
            onRetry={() => read.refetch()}
            minimum={minimum}
            check={check}
            busy={busy}
            stuck={
              stuck
                ? {
                    words: ending?.words || '',
                    href: bid.tx.hash ? `${explorerUrl(house.chainId)}/tx/${bid.tx.hash}` : undefined,
                    onStartOver: bid.reset,
                  }
                : undefined
            }
            canSend={canSend}
            balance={balance}
            standing={standingNote}
            chainId={house.chainId}
            chainName={house.chainName}
            upcoming="Up next. Bidding opens when the piece before it in this auction house closes."
            ended={
              <EndedPanel
                item={item}
                lot={lot}
                escrowedTo={read.escrowedTo}
                account={account}
                now={now}
                onChanged={changed}
                onStuck={setActionBusy}
                unit={words}
              />
            }
            notes={[antiSnipeWords(house.timeBuffer), refundWords(words)]}
          />
          {phase === 'live' && canSend && !stuck && (
            <MessageField>
              <span>Message with your bid</span>
              <input
                type="text"
                value={bidMessage}
                maxLength={MAX_BID_MESSAGE}
                disabled={locked}
                placeholder="Say something (optional)"
                aria-describedby="mm-bid-message-note"
                onChange={(e) => setBidMessage(e.target.value)}
              />
              <small id="mm-bid-message-note">{BID_MESSAGE_WORDS}</small>
            </MessageField>
          )}
          {(hasBids(lot) || (rows && rows.length > 0)) && (
            <div>
              {history.failed ? (
                <Byline>Bid history isn&apos;t available right now.</Byline>
              ) : history.loading ? (
                <Byline role="status">Loading bids…</Byline>
              ) : rows && rows.length > 0 ? (
                <History>
                  <thead>
                    <tr>
                      <th>Bidder</th>
                      <th>Bid</th>
                      <th aria-label="Transaction" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.hash}>
                        <td title={row.bidder}>
                          {row.bidder.toLowerCase() === me ? 'You' : shortAddress(row.bidder)}
                          {row.message && <BidNote>{row.message}</BidNote>}
                        </td>
                        <td>{unitAmount(row.amount, words)}</td>
                        <td>
                          <a href={`${explorerUrl(house.chainId)}/tx/${row.hash}`} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </History>
              ) : null}
            </div>
          )}
        </Placard>
      </Detail>
    </Column>
  )
}

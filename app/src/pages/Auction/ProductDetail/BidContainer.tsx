import { formatEther } from 'viem'
import styled from 'styled-components/macro'

import { ConnectedButton } from '@/components/Button'
import { NormalButton } from '@/components/Button/NormalButton'
import { AUCTION_CHAIN_ID } from '@/constants/contracts'
import type { LotPhase } from '@/pages/Auction/bidding'
import { balanceWords, monthYear, timeLeftWords } from '@/pages/Auction/bidding'

const BidWrapper = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0.75rem;

  @media only screen and (max-width: 640px) {
    flex-direction: column;
  }
`

const InputWrapper = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
`

const ActionWrapper = styled.div`
  flex: none;
  display: flex;
  white-space: nowrap;

  > button {
    width: 100%;
    padding: 0.5rem 0.7rem;
    font-size: 0.75rem;
  }
`

const TextInput = styled.input.attrs({ type: 'text' })`
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  border: none;
  box-shadow: inset 0 0 0 1px #a8843a, inset 0 1px 3px rgba(42, 20, 16, 0.25);
  background-color: #fffdf6;
  box-sizing: border-box;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  border-radius: 0;
  line-height: 2;

  &:disabled,
  &:read-only {
    background-color: #efe4c8;
  }

  &:focus {
    outline: 2px solid #7a1620;
    outline-offset: 1px;
  }

  @media only screen and (max-width: 640px) {
    min-height: 44px;
    /* iOS zooms the page into any field under 16px. */
    font-size: 16px;
  }
`

const Unit = styled.div`
  flex: none;
  padding: 0 0.75rem;
  box-shadow: inset 0 0 0 1px #a8843a, inset 0 1px 3px rgba(42, 20, 16, 0.25);
  background-color: #efe4c8;
  display: flex;
  justify-content: center;
  align-items: center;
`

const InfoRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0 0.75rem;
  margin-bottom: 0.25rem;
  font-size: 0.75rem;
`

const TimeLeft = styled.span`
  font-weight: bolder;
`

const Note = styled.p`
  margin: 0.3rem 0 0;
  font-size: 0.75rem;
  line-height: 1.3;
`

const Message = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  font-weight: bolder;
  text-align: center;
`

const Standing = styled.p<{ $good: boolean }>`
  margin: 0 0 0.4rem;
  padding: 0.3rem 0.5rem;
  border-left: 3px solid ${({ $good }) => ($good ? '#3d6b2c' : '#7a1620')};
  background: rgba(255, 253, 246, 0.7);
  font-size: 0.8rem;
  font-weight: bolder;
`

export default function BidContainer({
  phase,
  startTime,
  endTime,
  now,
  bidAmount,
  onBidAmount,
  onBid,
  onRetry,
  minimum,
  check,
  busy,
  canSend,
  balance,
  standing,
}: {
  phase: LotPhase
  startTime: number
  endTime: number
  now: number
  bidAmount: string
  onBidAmount: (value: string) => void
  onBid: () => void
  onRetry: () => void
  minimum: bigint
  check: { valid: boolean; value?: bigint; label: string }
  busy: 'wallet' | 'mining' | undefined
  /** The wallet is connected and on the auction's chain, so the button places a bid rather than connecting or switching. */
  canSend: boolean
  balance: bigint | undefined
  standing?: { good: boolean; words: string }
}) {
  if (phase === 'loading') return <Message role="status">Checking this lot…</Message>
  if (phase === 'failed') {
    return (
      <Message role="alert">
        Couldn&apos;t read this lot from Ethereum.
        <NormalButton type="button" onClick={onRetry}>
          Try again
        </NormalButton>
      </Message>
    )
  }
  if (phase === 'missing') return <Message>This lot isn&apos;t up for auction.</Message>
  if (phase === 'upcoming') {
    return <Message>Bidding opens {new Date(startTime * 1000).toLocaleString()}.</Message>
  }

  if (phase === 'ended') return <Message>This auction ended {monthYear(endTime)}.</Message>

  const buttonWords = busy === 'wallet' ? 'Confirm in your wallet…' : busy === 'mining' ? 'Waiting for Ethereum…' : check.label

  return (
    <>
      {standing && (
        <Standing role="status" $good={standing.good}>
          {standing.words}
        </Standing>
      )}
      <InfoRow>
        <TimeLeft>{timeLeftWords(endTime * 1000 - now)}</TimeLeft>
        {balance !== undefined && <span>Your balance: {balanceWords(balance)}</span>}
      </InfoRow>
      <BidWrapper>
        <InputWrapper>
          <TextInput
            value={bidAmount}
            inputMode="decimal"
            aria-label="Your bid in ETH"
            disabled={!!busy}
            onChange={(event) => onBidAmount(event.target.value)}
            placeholder={`${formatEther(minimum)} or more`}
          />
          <Unit>ETH</Unit>
        </InputWrapper>
        <ActionWrapper>
          <ConnectedButton withChain={[AUCTION_CHAIN_ID]} disabled={canSend && (!!busy || !check.valid)} onClick={onBid}>
            {buttonWords}
          </ConnectedButton>
        </ActionWrapper>
      </BidWrapper>
      {check.valid && check.value !== undefined && (
        <Note>You send {formatEther(check.value)} ETH now on Ethereum, plus gas.</Note>
      )}
      <Note>If someone outbids you, your ETH comes back automatically.</Note>
    </>
  )
}

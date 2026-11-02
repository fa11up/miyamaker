import { useConnectModal } from '@rainbow-me/rainbowkit'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { formatUnits, parseUnits } from 'viem'

import WarningIcon from '@/assets/icon/warning.png'
import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Chip, Skeleton, StatusBox } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import { LEGACY_REDEEMER, LINKS, MIYA_IMMEDIATE_LIMIT, MIYANET_CHAIN_ID } from '@/constants/miyanet'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import { bevel, color, font, space, text } from '@/theme/tokens'

import { useMiyanetTx, useRedemptionState, useWalletPosition } from './useMiyanet'
import { DataTable, NewTag, PortalBox, PushButton, y2k } from './y2k'

const num = (value: bigint | undefined, decimals = 18, digits = 2) =>
  value === undefined
    ? '–'
    : Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: digits })

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

const Lead = styled.p`
  margin: 0;
  font-family: ${font.display};
  font-size: ${text.lg};
  color: ${color.ink};
`

const Text = styled.p`
  margin: 0;
  font-family: ${font.body};
  font-size: ${text.sm};
  line-height: 1.6;
  color: ${color.ink};
  max-width: 64ch;
`

const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space[1]};
  li {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    padding: ${space[1]} ${space[2]};
    min-height: 36px;
    font-size: ${text.sm};
    line-height: 1.2;
    color: ${color.inkMuted};
    background: ${y2k.paperAlt};
    box-shadow: ${bevel.sunken};
  }
  li b {
    display: grid;
    place-items: center;
    flex: 0 0 22px;
    height: 22px;
    font-family: ${font.ui};
    color: #fff;
    background: ${color.shadow};
  }
  li[aria-current='step'] {
    color: ${color.ink};
    background: #fff;
    outline: 2px solid ${color.accent};
    outline-offset: -2px;
  }
  li[aria-current='step'] b {
    background: ${color.accentDark};
  }
  li.done b {
    background: ${color.success};
  }
`

const Label = styled.label`
  font-size: ${text.sm};
  font-weight: 700;
  color: ${color.ink};
`

const AmountField = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  height: 44px;
  input {
    min-width: 0;
    border: none;
    border-radius: 0;
    background: #fff;
    box-shadow: ${bevel.field};
    padding: 0 ${space[3]};
    font-size: ${text.lg};
    font-variant-numeric: tabular-nums;
  }
  button {
    min-width: 56px;
  }
`

const Warning = styled.p`
  display: flex;
  align-items: flex-start;
  gap: ${space[2]};
  margin: 0;
  padding: ${space[2]} ${space[3]};
  background: #fff6c2;
  box-shadow: ${bevel.sunken};
  font-size: ${text.sm};
  line-height: 1.45;
  color: ${color.ink};
  img {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    margin: 0;
    border: none;
  }
`

const Fine = styled.p`
  margin: 0;
  font-size: ${text.xs};
  line-height: 1.5;
  color: ${color.inkMuted};
  a {
    color: ${color.link};
  }
`

const Address = styled.a`
  font-family: ${font.mono};
  font-size: ${text.xs};
  color: ${color.link};
`

const Row = styled.div`
  display: flex;
  gap: ${space[2]};
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
`

/** MIYA -> INFER through the LegacyRedeemer: approve (exact amount), burn, and collect what vests. */
export default function Claim({ id, style }: { id?: string; style?: CSSProperties }) {
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
    if (needsApproval) return { label: 'Approve MIYA', disabled: false, onClick: () => tx.approve(amount as bigint) }
    return { label: 'Burn MIYA for INFER', disabled: false, onClick: () => tx.redeem(amount as bigint) }
  })()

  // Which of the three steps the person is on: connect, approve, burn.
  let step = 3
  if (!tx.isConnected || tx.wrongChain) step = 1
  else if (needsApproval || (tx.isAwaitingWallet && tx.lastAction === 'approve')) step = 2

  const vestingLeft = wallet.vesting ? wallet.vesting.total - wallet.vesting.claimed : 0n
  const closesOn = state.closesAt
    ? new Date(state.closesAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : undefined

  let status = <Chip tone="ok">Open</Chip>
  if (state.isLoading) status = <Chip tone="off">Reading chain</Chip>
  else if (state.isError) status = <Chip tone="warn">RPC unavailable</Chip>
  else if (closed) status = <Chip tone="off">Closed</Chip>

  let doneMessage = 'Done. Your INFER is in your wallet.'
  if (tx.lastAction === 'approve') doneMessage = 'Approved. Now burn your MIYA for INFER.'
  else if (tx.lastAction === 'claim') doneMessage = 'Collected your vested INFER.'

  return (
    <PortalBox
      id={id}
      style={style}
      label="Redeem MIYA for INFER"
      title="The claim"
      aside={
        <>
          {!closed && <NewTag>NEW!</NewTag>}
          {status}
        </>
      }
    >
      <Lead>Burn MIYA. Get INFER.</Lead>
      <Text>
        Burning destroys your MIYA for good. In return you get INFER at a fixed rate. Up to{' '}
        {MIYA_IMMEDIATE_LIMIT.toLocaleString('en-US')} MIYA per wallet pays out right away. Anything above that pays out
        bit by bit over one 13-week season.
      </Text>

      <Steps aria-label="Steps">
        {['Connect', 'Approve', 'Burn'].map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? 'step' : undefined} className={step > i + 1 ? 'done' : undefined}>
            <b>{step > i + 1 ? '✓' : i + 1}</b>
            {s}
          </li>
        ))}
      </Steps>

      <DataTable>
        <tbody>
          <tr>
            <th scope="row">Rate</th>
            <td>{state.isLoading ? <Skeleton w="120px" h="18px" /> : `${num(state.rate, 18, 4)} INFER per MIYA`}</td>
          </tr>
          <tr>
            <th scope="row">INFER left for MIYA</th>
            <td>{state.isLoading ? <Skeleton w="120px" h="18px" /> : num(state.inferLeft, 18, 0)}</td>
          </tr>
          <tr>
            <th scope="row">Window closes</th>
            <td>{closesOn || '–'}</td>
          </tr>
          {tx.isConnected && (
            <>
              <tr>
                <th scope="row">Your MIYA</th>
                <td>{num(wallet.miya)}</td>
              </tr>
              <tr>
                <th scope="row">Your INFER</th>
                <td>{num(wallet.infer)}</td>
              </tr>
              <tr>
                <th scope="row">Your imdUSD v1</th>
                <td>{num(wallet.imdusd)}</td>
              </tr>
            </>
          )}
        </tbody>
      </DataTable>

      <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
        <Label htmlFor="miya-amount">MIYA to burn</Label>
        <AmountField>
          <input
            id="miya-amount"
            inputMode="decimal"
            placeholder="0.0"
            value={input}
            disabled={busy || !tx.isConnected}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <PushButton
            type="button"
            disabled={busy || wallet.miya === undefined}
            onClick={() => wallet.miya !== undefined && setInput(formatUnits(wallet.miya, 18))}
          >
            Max
          </PushButton>
        </AmountField>
        <Row>
          <Text as="span">You get</Text>
          <strong style={{ fontSize: text.lg, fontVariantNumeric: 'tabular-nums' }}>{num(out)} INFER</strong>
        </Row>
        {tx.isConnected && amount === wallet.miya && wallet.redeemLater !== undefined && wallet.redeemLater > 0n && (
          <Fine>
            {num(wallet.redeemNow)} now, {num(wallet.redeemLater)} paid out over 13 weeks.
          </Fine>
        )}
      </div>

      <Warning>
        <img src={WarningIcon} alt="" />
        <span>
          <strong>Burning is permanent.</strong> You cannot undo it. Approve only lets the claim use the exact amount
          you typed.
        </span>
      </Warning>

      <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </BigButton>

      {vestingLeft > 0n && (
        <Row>
          <Fine>
            Paying out: {num(vestingLeft)} INFER left, {num(wallet.claimable)} ready now.
          </Fine>
          <PushButton type="button" disabled={busy || tx.wrongChain || !wallet.claimable} onClick={() => tx.claim()}>
            Collect
          </PushButton>
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
            {doneMessage}{' '}
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

      <Fine>
        Claim contract{' '}
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
      </Fine>
    </PortalBox>
  )
}

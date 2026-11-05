import { useConnectModal } from '@rainbow-me/rainbowkit'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { formatUnits, parseUnits } from 'viem'

import WarningIcon from '@/assets/icon/warning.png'
import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { BigButton, Chip, Skeleton, StatusBox } from '@/components/Retro'
import { explorerUrl } from '@/config/wagmi'
import type { Legacy } from '@/constants/miyanet'
import {
  LEGACY_REDEEMER,
  LINKS,
  MIYA_IMMEDIATE_LIMIT,
  MIYANET_CHAIN_ID,
  MXXN_IMMEDIATE_INFER,
} from '@/constants/miyanet'
import { describeError } from '@/pages/Mint/Miyamini/useMiyamini'
import { bevel, color, font, space, text } from '@/theme/tokens'

import PixelFire from './PixelFire'
import type { Moon } from './useMiyanet'
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

const Tabs = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space[1]};
  button {
    min-height: 40px;
    border: none;
    border-radius: 0;
    font-family: ${font.ui};
    font-size: ${text.sm};
    color: ${color.ink};
    background: ${y2k.paperAlt};
    box-shadow: ${bevel.raised};
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #fff;
    box-shadow: ${bevel.pressed};
    outline: 2px solid ${color.accent};
    outline-offset: -2px;
    font-weight: 700;
  }
  button:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
`

/** "about 20 hours" from a block distance (12 s blocks). */
const inBlocks = (blocks: bigint) => {
  const mins = Number(blocks) / 5
  if (mins < 90) return `about ${Math.max(1, Math.round(mins))} minutes`
  const hours = mins / 60
  if (hours < 48) return `about ${Math.round(hours)} hours`
  return `about ${Math.round(hours / 24)} days`
}

/** MXXN only moves inside its full-moon window: say whether it is open and when that changes. */
function moonLine(moon: Moon | undefined) {
  if (!moon) return '–'
  if (moon.open) return `Full moon now. Closes in ${inBlocks(moon.end - moon.block)} (block ${moon.end})`
  if (moon.behind) return 'The moon clock is behind. Move it on to set the next full moon.'
  return `Next full moon in ${inBlocks(moon.start - moon.block)} (block ${moon.start})`
}

/** Shown in place of the burn form once a wallet has burned its last MIYA or MXXN. */
const Burned = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[3]} ${space[4]};
  background: ${y2k.night};
  box-shadow: ${bevel.sunken};
  color: #fff;
  > div {
    display: flex;
    flex-direction: column;
    gap: ${space[1]};
    font-size: ${text.sm};
    line-height: 1.5;
  }
  b {
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.xl};
    color: ${y2k.tape};
    text-shadow: 2px 2px 0 #e0006b;
  }
  small {
    color: #c9d4ff;
  }
`

const Row = styled.div`
  display: flex;
  gap: ${space[2]};
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
`

/** MIYA or MXXN -> INFER through the LegacyRedeemer: approve (exact amount), burn, and collect what vests. */
export default function Claim({ id, style }: { id?: string; style?: CSSProperties }) {
  const [which, setWhich] = useState<Legacy>('miya')
  const symbol = which === 'miya' ? 'MIYA' : 'MXXN'
  const state = useRedemptionState(which)
  const wallet = useWalletPosition(which)
  const tx = useMiyanetTx(which, () => {
    wallet.refetch()
    state.refetch()
  })
  const { openConnectModal } = useConnectModal()
  const [input, setInput] = useState('')

  useEffect(() => {
    if (wallet.legacy !== undefined && input === '') setInput(formatUnits(wallet.legacy, 18))
  }, [wallet.legacy])

  const pick = (next: Legacy) => {
    if (next === which || tx.isAwaitingWallet || tx.isConfirming) return
    setWhich(next)
    setInput('')
    tx.reset()
  }

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
  const tooMuch = amount !== undefined && wallet.legacy !== undefined && amount > wallet.legacy
  const closed = state.closesAt !== undefined && Date.now() / 1000 >= state.closesAt
  const busy = tx.isAwaitingWallet || tx.isConfirming
  const err = describeError(tx.error)
  const txUrl = tx.hash ? `${explorerUrl(MIYANET_CHAIN_ID)}/tx/${tx.hash}` : undefined
  const needsApproval = amount !== undefined && wallet.allowance !== undefined && wallet.allowance < amount

  const action = (() => {
    const idle = () => {}

    if (state.isError) return { label: 'Unavailable', disabled: true, onClick: idle }
    if (closed) return { label: 'Redemption closed', disabled: true, onClick: idle }
    const moonShut = which === 'mxxn' && state.moon && !state.moon.open
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
    if (moonShut && state.moon?.behind)
      return { label: 'Move the moon clock on', disabled: false, onClick: () => tx.advanceClock() }
    if (wallet.legacy === 0n) return { label: `No ${symbol} in this wallet`, disabled: true, onClick: idle }
    if (amount === undefined || amount === 0n) return { label: 'Enter an amount', disabled: true, onClick: idle }
    if (tooMuch) return { label: `More than your ${symbol}`, disabled: true, onClick: idle }
    // Approving moves nothing, so it works any time; the burn waits for the full moon.
    if (needsApproval)
      return { label: `Approve ${symbol}`, disabled: false, onClick: () => tx.approve(amount as bigint) }
    if (moonShut) return { label: 'Opens at the next full moon', disabled: true, onClick: idle }
    return { label: `Burn ${symbol} for INFER`, disabled: false, onClick: () => tx.redeem(amount as bigint) }
  })()

  // Which of the three steps the person is on: connect, approve, burn.
  let step = 3
  if (!tx.isConnected || tx.wrongChain) step = 1
  else if (needsApproval || (tx.isAwaitingWallet && tx.lastAction === 'approve')) step = 2

  const vestingLeft = wallet.vesting ? wallet.vesting.total - wallet.vesting.claimed : 0n
  // Burned some before and none left: the fire, not a form that can only say "No MIYA in this wallet".
  const burnedAll =
    tx.isConnected && !tx.wrongChain && wallet.legacy === 0n && (wallet.burnedFor ?? 0n) > 0n && !tx.isConfirming
  const closesOn = state.closesAt
    ? new Date(state.closesAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : undefined

  let status = <Chip tone="ok">Open</Chip>
  if (which === 'mxxn' && state.moon && !state.moon.open) status = <Chip tone="off">Full moon only</Chip>
  if (state.isLoading) status = <Chip tone="off">Reading chain</Chip>
  else if (state.isError) status = <Chip tone="warn">RPC unavailable</Chip>
  else if (closed) status = <Chip tone="off">Closed</Chip>

  let doneMessage = 'Done. Your INFER is in your wallet.'
  if (tx.lastAction === 'approve')
    doneMessage =
      which === 'mxxn' && !state.moon?.open
        ? 'Approved. Come back at the full moon to burn your MXXN.'
        : `Approved. Now burn your ${symbol} for INFER.`
  else if (tx.lastAction === 'claim') doneMessage = 'Collected your vested INFER.'
  else if (tx.lastAction === 'advanceClock') doneMessage = 'The moon clock moved on.'

  return (
    <PortalBox
      id={id}
      style={style}
      label="Redeem MIYA or MXXN for INFER"
      title="The claim"
      aside={
        <>
          {!closed && <NewTag>NEW!</NewTag>}
          {status}
        </>
      }
    >
      <Tabs role="group" aria-label="Token to burn">
        {(['miya', 'mxxn'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={which === t} onClick={() => pick(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </Tabs>
      <Lead>Burn {symbol}. Get INFER.</Lead>
      {which === 'miya' ? (
        <Text>
          Burning destroys your MIYA for good. In return you get INFER at a fixed rate. Up to{' '}
          {MIYA_IMMEDIATE_LIMIT.toLocaleString('en-US')} MIYA per wallet pays out right away. Anything above that pays
          out bit by bit over one 13-week season.
        </Text>
      ) : (
        <Text>
          Burning destroys your MXXN for good. In return you get INFER at a fixed rate. MXXN only moves during its full
          moon, so the burn works only then; you can approve any time. Up to{' '}
          {MXXN_IMMEDIATE_INFER.toLocaleString('en-US')} INFER per wallet pays out right away. Anything above that pays
          out bit by bit over one 13-week season.
        </Text>
      )}

      {!burnedAll && (
        <Steps aria-label="Steps">
          {['Connect', 'Approve', 'Burn'].map((s, i) => (
            <li
              key={s}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={step > i + 1 ? 'done' : undefined}
            >
              <b>{step > i + 1 ? '✓' : i + 1}</b>
              {s}
            </li>
          ))}
        </Steps>
      )}

      <DataTable>
        <tbody>
          <tr>
            <th scope="row">Rate</th>
            <td>
              {state.isLoading ? <Skeleton w="120px" h="18px" /> : `${num(state.rate, 18, 4)} INFER per ${symbol}`}
            </td>
          </tr>
          <tr>
            <th scope="row">INFER left for {symbol}</th>
            <td>{state.isLoading ? <Skeleton w="120px" h="18px" /> : num(state.inferLeft, 18, 0)}</td>
          </tr>
          {which === 'mxxn' && (
            <tr>
              <th scope="row">Full moon</th>
              <td>{moonLine(state.moon)}</td>
            </tr>
          )}
          <tr>
            <th scope="row">Window closes</th>
            <td>{closesOn || '–'}</td>
          </tr>
          {tx.isConnected && (
            <>
              <tr>
                <th scope="row">Your {symbol}</th>
                <td>{num(wallet.legacy)}</td>
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

      {burnedAll ? (
        <Burned role="status">
          <PixelFire />
          <div>
            <b>{symbol} burned.</b>
            <span>
              It is gone for good, and the INFER is yours: {num(wallet.burnedFor, 18, 0)} INFER paid to this wallet at
              once{vestingLeft > 0n ? ', and more paying out below' : ''}.
            </span>
            <small>Holding {which === 'miya' ? 'MXXN' : 'MIYA'} too? Switch above to burn it.</small>
          </div>
        </Burned>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <Label htmlFor="legacy-amount">{symbol} to burn</Label>
            <AmountField>
              <input
                id="legacy-amount"
                inputMode="decimal"
                placeholder="0.0"
                value={input}
                disabled={busy || !tx.isConnected}
                onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
              />
              <PushButton
                type="button"
                disabled={busy || wallet.legacy === undefined}
                onClick={() => wallet.legacy !== undefined && setInput(formatUnits(wallet.legacy, 18))}
              >
                Max
              </PushButton>
            </AmountField>
            <Row>
              <Text as="span">You get</Text>
              <strong style={{ fontSize: text.lg, fontVariantNumeric: 'tabular-nums' }}>{num(out)} INFER</strong>
            </Row>
            {tx.isConnected &&
              amount === wallet.legacy &&
              wallet.redeemLater !== undefined &&
              wallet.redeemLater > 0n && (
                <Fine>
                  {num(wallet.redeemNow)} now, {num(wallet.redeemLater)} paid out over 13 weeks.
                </Fine>
              )}
          </div>

          <Warning>
            <img src={WarningIcon} alt="" />
            <span>
              <strong>Burning is permanent.</strong> You cannot undo it. Approve only lets the claim use the exact
              amount you typed.
            </span>
          </Warning>

          <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </BigButton>
        </>
      )}

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
        . Season points live on the{' '}
        <a href={LINKS.claim} target="_blank" rel="noreferrer noopener">
          official claim page
        </a>
        .
      </Fine>
    </PortalBox>
  )
}

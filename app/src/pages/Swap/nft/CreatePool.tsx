import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'

import { StatusBox } from '../floor/retro'
import { space, text } from '../floor/tokens'
import { poolFactoryAbi } from './abi'
import type { FeeSymbol } from './pool'
import { checkFee, parseTokenAmount, randomOn, tokenAmountText } from './pool'
import { Field, Hint, Prose, PushButton, SwitchNote } from './ui'
import { useFeeRules } from './usePools'

const FeeRow = styled.label`
  display: grid;
  grid-template-columns: 9em 120px auto;
  align-items: center;
  gap: ${space[2]};
  font-size: ${text.sm};
  .narrow & {
    grid-template-columns: 1fr 120px;
  }
`

export type CreateWallet = {
  isConnected: boolean
  wrongChain: boolean
  switching: boolean
  switchChain: (args: { chainId: SupportedChainId }) => void
  switchFailed: boolean
  openConnectModal?: () => void
}

/**
 * Start a collection's one pool (MiyaPoolFactory.createPool). The person sets the pick fee per NFT in IMD and/or
 * INFER (0 = not offered), fixed forever and the same for everyone, so the form says that before the wallet opens.
 * Each fee must be 0 or at least the vault's least contribution in that token, read on chain; on a chain whose
 * factory has no vault, both are 0.
 */
export function CreatePool({
  chainId,
  factory,
  collection,
  wallet,
  onCreated,
  onBusy,
  doneWords = 'Pool started.',
}: {
  chainId: SupportedChainId
  factory: Address
  collection: Address
  wallet: CreateWallet
  onCreated: () => void
  onBusy?: (busy: boolean) => void
  doneWords?: string
}) {
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const { isConnected, wrongChain, switching, switchChain, switchFailed, openConnectModal } = wallet
  const rules = useFeeRules(chainId, factory)
  const [imdText, setImdText] = useState('')
  const [inferText, setInferText] = useState('')
  useEffect(() => {
    if (!rules.noVault) return
    setImdText('')
    setInferText('')
  }, [rules.noVault])
  const create = useTx(() => onCreated())
  useEffect(() => onBusy?.(create.busy), [create.busy])
  useEffect(() => () => onBusy?.(false), [])

  const imd = parseTokenAmount(imdText)
  const infer = parseTokenAmount(inferText)
  const check = (amount: bigint | undefined, min: bigint | undefined, symbol: FeeSymbol) =>
    amount === undefined ? undefined : checkFee(amount, min, symbol)
  const imdCheck = check(imd.amount, rules.imdMin, 'IMD')
  const inferCheck = check(infer.amount, rules.inferMin, 'INFER')
  const imdError = imd.error ?? (imdCheck && !imdCheck.ok ? imdCheck.error : undefined)
  const inferError = infer.error ?? (inferCheck && !inferCheck.ok ? inferCheck.error : undefined)
  const free = imd.amount === 0n && infer.amount === 0n
  // No vault read yet means no way to know whether fees are allowed at all.
  const ready =
    rules.vault !== undefined &&
    imd.amount !== undefined &&
    infer.amount !== undefined &&
    !imdError &&
    !inferError &&
    (free || !rules.noVault)

  const minWords = (min: bigint | undefined, symbol: FeeSymbol) =>
    min === undefined
      ? rules.loading
        ? 'checking the least amount…'
        : "couldn't read the least amount"
      : `at least ${tokenAmountText(min)} ${symbol}, or 0`

  const start = () =>
    ready &&
    create.run('create', {
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'createPool',
      args: [collection, imd.amount!, infer.amount!],
      chainId,
    })

  const feeSummary = free
    ? 'Picks will be free: 1 pool token per NFT, the same as random.'
    : `Picks will cost 1 pool token plus ${[
        imd.amount ? `${tokenAmountText(imd.amount)} IMD` : '',
        infer.amount ? `${tokenAmountText(infer.amount)} INFER` : '',
      ]
        .filter(Boolean)
        .join(' or ')} per NFT.`

  return (
    <>
      <Prose>
        A pool lets anyone swap one of these NFTs for 1 pool token and back. There is one pool per collection, and
        anyone can start it. Taking an NFT out:
      </Prose>
      <Hint>
        <b>Random:</b> always 1 token per NFT, no fee, and a future block picks which one.{' '}
        {randomOn(chainId) ? 'ERC-721 collections only.' : `Not on ${chain.name}: pools there have pick only.`}
        <br />
        <b>Pick:</b> choose the NFT, for 1 token plus the pick fee you set here, paid in IMD or INFER (the picker
        chooses among the ones you offer). The fee goes to the INFER/IMD alignment vault as the picker&apos;s own
        contribution, so they earn a share of its fees. Leave both at 0 and picks are free.
      </Hint>
      {rules.noVault ? (
        <Hint role="status">
          {chain.name} has no alignment vault yet, so pools here have no pick fee: picks cost 1 token, the same as
          random.
        </Hint>
      ) : (
        <>
          <FeeRow htmlFor="create-pool-imd">
            <span>Pick fee in IMD</span>
            <Field
              id="create-pool-imd"
              value={imdText}
              onChange={(e) => setImdText(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-describedby="create-pool-imd-hint"
              disabled={create.busy}
            />
            <span id="create-pool-imd-hint">per NFT: {minWords(rules.imdMin, 'IMD')}</span>
          </FeeRow>
          {imdError && <Hint role="alert">{imdError}</Hint>}
          <FeeRow htmlFor="create-pool-infer">
            <span>Pick fee in INFER</span>
            <Field
              id="create-pool-infer"
              value={inferText}
              onChange={(e) => setInferText(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-describedby="create-pool-infer-hint"
              disabled={create.busy}
            />
            <span id="create-pool-infer-hint">per NFT: {minWords(rules.inferMin, 'INFER')}</span>
          </FeeRow>
          {inferError && <Hint role="alert">{inferError}</Hint>}
          {!imdError && !inferError && (
            <Hint>{feeSummary} Whoever starts the pool sets this for everyone, and it can never be changed.</Hint>
          )}
        </>
      )}
      {rules.failed && !rules.loading && (
        <Hint>
          Couldn&apos;t read this network&apos;s vault rules.{' '}
          <PushButton type="button" onClick={() => rules.refetch()}>
            Check again
          </PushButton>
        </Hint>
      )}
      {!isConnected ? (
        <PushButton type="button" onClick={() => openConnectModal?.()}>
          Connect to start a pool
        </PushButton>
      ) : wrongChain ? (
        <>
          <SwitchNote chainName={chain.name} failed={switchFailed} />
          <PushButton type="button" onClick={() => switchChain({ chainId })} disabled={switching}>
            {switching ? 'Switching…' : `Switch to ${chain.name}`}
          </PushButton>
        </>
      ) : (
        <>
          {create.unconfirmed ? (
            // It may still land: a second create would only fail (one pool per collection), so check instead.
            <PushButton
              type="button"
              data-create-pool
              onClick={() => {
                create.reset()
                onCreated()
              }}
            >
              Check whether the pool started
            </PushButton>
          ) : (
            <PushButton type="button" data-create-pool disabled={create.busy || !ready} onClick={start}>
              {free ? 'Start the pool with free picks' : 'Start the pool with this pick fee'}
            </PushButton>
          )}
          <Hint>One transaction on {chain.name}. You pay only the network fee.</Hint>
        </>
      )}
      {create.tx.phase !== 'idle' && (
        <StatusBox tone={create.tx.phase === 'error' ? 'error' : create.tx.phase === 'done' ? 'ok' : 'info'}>
          {create.busy && <img src={LoadingHourglass} alt="" />}
          <span>{create.tx.phase === 'done' ? doneWords : txWords(create.tx)}</span>
        </StatusBox>
      )}
    </>
  )
}

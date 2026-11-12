import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { zeroAddress } from 'viem'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, mainnet } from '@/config/wagmi'
import { txWords, useTx } from '@/miyamints/useTx'

import { StatusBox } from '../floor/retro'
import { space, text } from '../floor/tokens'
import { poolFactoryAbi } from './abi'
import {
  DEFAULT_PREMIUM_BPS,
  MAX_PREMIUM_BPS,
  parsePremium,
  POOL_UNIT,
  premiumPerUnitOf,
  premiumText,
  randomOn,
  unitsText,
} from './pool'
import { Field, Hint, Prose, PushButton, SwitchNote } from './ui'
import { useFactoryVault } from './usePools'

const PremiumRow = styled.label`
  display: grid;
  grid-template-columns: auto 96px auto;
  align-items: center;
  gap: ${space[2]};
  font-size: ${text.sm};
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
 * Start a collection's one pool (MiyaPoolFactory.createPool). The person sets the pick premium, which is fixed forever
 * and applies to everyone, so the form says that before the wallet opens. On a chain whose factory has no vault, the
 * premium must be 0.
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
  const vault = useFactoryVault(chainId, factory)
  const noVault = vault.vault !== undefined && vault.vault.toLowerCase() === zeroAddress
  const max = noVault ? 0 : MAX_PREMIUM_BPS
  const [typed, setTyped] = useState(premiumText(DEFAULT_PREMIUM_BPS).replace('%', ''))
  useEffect(() => {
    if (noVault) setTyped('0')
  }, [noVault])
  const parsed = parsePremium(typed, max)
  const create = useTx(() => onCreated())
  useEffect(() => onBusy?.(create.busy), [create.busy])
  useEffect(() => () => onBusy?.(false), [])

  const pickCost = parsed.bps === undefined ? undefined : POOL_UNIT + premiumPerUnitOf(parsed.bps)
  const start = () =>
    parsed.bps !== undefined &&
    create.run('create', {
      address: factory,
      abi: poolFactoryAbi,
      functionName: 'createPool',
      args: [collection, parsed.bps],
      chainId,
    })

  return (
    <>
      <Prose>
        A pool lets anyone swap one of these NFTs for 1 pool token and back. There is one pool per collection, and
        anyone can start it. Taking an NFT out:
      </Prose>
      <Hint>
        <b>Random:</b> 1 token per NFT, and a future block picks which one.{' '}
        {randomOn(chainId) ? 'ERC-721 collections only.' : `Not on ${chain.name}: pools there have pick only.`}
        <br />
        <b>Pick:</b> choose the NFT, for 1 token plus the premium you set here. The premium goes to the INFER/IMD
        alignment vault.
      </Hint>
      <PremiumRow htmlFor="create-pool-premium">
        <span>Pick premium</span>
        <Field
          id="create-pool-premium"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="decimal"
          aria-describedby="create-pool-premium-hint"
          disabled={create.busy || noVault}
        />
        <span>% of a token (0 to {premiumText(max)})</span>
      </PremiumRow>
      <Hint id="create-pool-premium-hint" role={parsed.error ? 'alert' : undefined}>
        {parsed.error ??
          (noVault
            ? `${chain.name} has no alignment vault yet, so pools here have no premium: pick costs 1 token too.`
            : `Pick will cost ${unitsText(pickCost)} tokens per NFT. Whoever starts the pool sets this for everyone, and it can never be changed.`)}
      </Hint>
      {vault.failed && (
        <Hint>
          Couldn&apos;t check this network&apos;s vault.{' '}
          <PushButton type="button" onClick={() => vault.refetch()}>
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
          <PushButton
            type="button"
            data-create-pool
            disabled={create.busy || parsed.bps === undefined || vault.vault === undefined}
            onClick={start}
          >
            {parsed.bps === undefined ? 'Start the pool' : `Start the pool with a ${premiumText(parsed.bps)} premium`}
          </PushButton>
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

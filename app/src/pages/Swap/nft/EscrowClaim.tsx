import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import { useReadContract } from 'wagmi'

import { Eyebrow } from '@/components/Retro'
import type { SupportedChainId } from '@/config/wagmi'
import type { useTx } from '@/miyamints/useTx'

import { poolAbi } from './abi'
import { Card, Field, Hint, LinkButton, PushButton } from './ui'

/**
 * Claim an NFT the pool holds because the collection refused to send it at reveal (MiyaPool.claimEscrowed). This looks
 * up by id: finding these from logs needs a wider eth_getLogs range than our RPC plans allow.
 */
export function EscrowClaim({
  pool,
  chainId,
  me,
  busy,
  disabled,
  tx,
}: {
  pool: Address
  chainId: SupportedChainId
  me: Address | undefined
  busy: boolean
  disabled: boolean
  tx: ReturnType<typeof useTx>
}) {
  const [open, setOpen] = useState(false)
  const [idText, setIdText] = useState('')
  const [to, setTo] = useState('')
  const id = /^\d{1,78}$/.test(idText) ? BigInt(idText) : undefined
  const holder = useReadContract({
    address: pool,
    abi: poolAbi,
    functionName: 'escrowedTo',
    args: id === undefined ? undefined : [id],
    chainId,
    query: { enabled: open && id !== undefined },
  })
  const held = !!me && holder.data?.toLowerCase() === me.toLowerCase()
  const claimed = tx.tx.phase === 'done' && tx.tx.id === `claim-${idText}`

  useEffect(() => {
    if (claimed) holder.refetch()
  }, [claimed])

  if (!open) {
    return (
      <div>
        <LinkButton type="button" onClick={() => setOpen(true)}>
          An NFT from a draw didn&apos;t arrive?
        </LinkButton>
      </div>
    )
  }

  const destination = to.trim() || me
  return (
    <Card aria-label="Claim a held NFT">
      <Eyebrow>Claim a held NFT</Eyebrow>
      <Hint>
        If a collection refuses a transfer, the pool holds that NFT for you. Enter its ID to check. The draw&apos;s
        reveal transaction shows the ID in a RedeemEscrowed event.
      </Hint>
      <Field
        aria-label="NFT ID"
        value={idText}
        inputMode="numeric"
        placeholder="NFT ID"
        onChange={(e) => setIdText(e.target.value.trim())}
      />
      {id !== undefined && holder.isSuccess && !held && (
        <Hint>{claimed ? 'Claimed.' : 'This NFT is not being held for this wallet.'}</Hint>
      )}
      {held && (
        <>
          <Field
            aria-label="Send to"
            value={to}
            placeholder={`Send to (blank: ${me})`}
            spellCheck={false}
            onChange={(e) => setTo(e.target.value)}
          />
          <Hint>If the collection refused this wallet, send it to a different one.</Hint>
          <div>
            <PushButton
              type="button"
              disabled={busy || disabled || !destination || !isAddress(destination)}
              onClick={() =>
                id !== undefined &&
                destination &&
                isAddress(destination) &&
                tx.run(`claim-${idText}`, {
                  address: pool,
                  abi: poolAbi,
                  functionName: 'claimEscrowed',
                  args: [id, destination],
                  chainId,
                })
              }
            >
              Claim #{idText}
            </PushButton>
          </div>
        </>
      )}
    </Card>
  )
}

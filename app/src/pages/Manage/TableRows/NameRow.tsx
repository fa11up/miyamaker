import { useState } from 'react'
import type { Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { z } from 'zod'

import { ChainButton } from '@/components/Button'
import { useWaitForTransaction } from '@/hooks/useWaitForTransaction'

import { useName } from '../useName'
import TableInput from './TableInput'

export default function NameRow({
  collection,
  active,
  onActive,
}: {
  collection: Address
  active: boolean
  onActive: (input: string) => void
}) {
  const { realName, setRealName, refetch } = useName({ address: collection })
  const [transacting, setTransacting] = useState(false)
  const [txHash, setTxHash] = useState('')

  useWaitForTransaction({
    hash: (txHash as Address) || '0x',
    enabled: !!txHash,
    onSuccess: () => {
      setTransacting(false)
      setTxHash('')
      refetch()
    },
    // A revert or an unreadable receipt: stop showing "Updating...", or the row is stuck.
    onError: () => {
      setTransacting(false)
      setTxHash('')
    },
    onReplaced: (reason) => {
      // A sped-up copy is the same change: onSuccess comes with its receipt, and refetches.
      if (reason === 'repriced') return
      setTransacting(false)
      setTxHash('')
    },
  })

  const [input, setInput] = useState('')

  const openInput = () => {
    setInput(realName)
    onActive('realName')
  }

  const handleInput = (input: string) => {
    const validate = z.string()
    try {
      validate.parse(input)
      setInput(input)
    } catch (e) {
      //
    }
  }

  const handleUpdate = () => {
    setTransacting(true)
    try {
      const result = setRealName(input) // @TODO
    } catch (e) {
      setTransacting(false)
      // warn message
    }
  }

  return (
    <tr>
      <td>Name</td>
      {active ? (
        <td onClick={() => openInput()}>
          <TableInput value={input} onChange={(e) => handleInput(e.target.value)} />
        </td>
      ) : (
        <td onClick={() => openInput()}>{realName}</td>
      )}
      <td style={{ padding: 0 }}>
        <ChainButton
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          disabled={true}
          onClick={() => (active ? handleUpdate() : openInput())}
          withChain={[mainnet.id, sepolia.id]}
        >
          Locked
        </ChainButton>
      </td>
    </tr>
  )
}

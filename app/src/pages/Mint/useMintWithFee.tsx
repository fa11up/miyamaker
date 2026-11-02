import type { Address } from 'viem'

import { useContractWrite } from '@/hooks/useContractWrite'

/** `value` is the total payment in wei (price * amount), computed in bigint so no float rounding reaches the tx. */
export function useMintWithFee({ address, value }: { address: Address; value: bigint }) {
  const { writeAsync } = useContractWrite({
    address,
    functionName: 'mint',
    abi: [
      {
        inputs: [
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
        ],
        name: 'mint',
        outputs: [],
        stateMutability: 'payable',
        type: 'function',
      },
    ],
    value,
  })

  const mint = async (amount: number) => writeAsync({ args: [amount] })

  return { mint }
}

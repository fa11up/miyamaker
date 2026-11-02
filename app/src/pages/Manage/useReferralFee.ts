import { type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useContractWrite } from '@/hooks/useContractWrite'

export function useReferralFee({ address }: { address?: Address }) {
  const { data: referralFee, refetch } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'referralFee',
    abi: [
      {
        inputs: [],
        name: 'referralFee',
        outputs: [{ internalType: 'uint16', name: '', type: 'uint16' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  const { writeAsync } = useContractWrite({
    address,
    functionName: 'setReferralFee',
    abi: [
      {
        inputs: [{ internalType: 'uint16', name: '_price', type: 'uint16' }],
        name: 'setReferralFee',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
  })

  const setReferralFee = async (input: bigint) => writeAsync({ args: [input] })

  return { referralFee: BigInt(referralFee ?? 0), setReferralFee, refetch }
}

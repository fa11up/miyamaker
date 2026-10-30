/* eslint-disable @typescript-eslint/naming-convention */
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useContractWrite } from '@/hooks/useContractWrite'

export function useContractUri({ address }: { address?: Address }) {
  const { data: contractUri } = useReadContract({
    address,
    query: { enabled: !!address },
    functionName: 'contractURI',
    abi: [
      {
        inputs: [],
        name: 'contractURI',
        outputs: [{ internalType: 'string', name: '', type: 'string' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
  })

  const { writeAsync } = useContractWrite({
    address,
    functionName: 'setContractURI',
    abi: [
      {
        inputs: [{ internalType: 'string', name: 'contractURI_', type: 'string' }],
        name: 'setContractURI',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
  })

  const setContractUri = async (input: string) => writeAsync({ args: [input] })

  type ContractMetadata = {
    name: string
    description: string
    image: string
    external_link: string
    collaborators: Address[]
  }
  if (contractUri) {
    const { name, description, image, external_link, collaborators } = JSON.parse(
      (contractUri as string).split('data:application/json;utf8,')[1] as string
    ) as ContractMetadata

    return { name, description, image, external_link, collaborators, setContractUri }
  }

  return { name: '', description: '', image: '', external_link: '', collaborators: [], setContractUri }
}

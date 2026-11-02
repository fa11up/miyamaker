/* eslint-disable @typescript-eslint/naming-convention */
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { useContractWrite } from '@/hooks/useContractWrite'
import { parseJsonDataUri, resolveMetadataUri } from '@/utils/resolveUri'

type ContractMetadata = {
  name: string
  description: string
  image: string
  external_link: string
  collaborators: Address[]
}

export function useContractUri({ address }: { address?: Address }) {
  const { data: contractUri, isFetched: uriFetched } = useReadContract({
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

  // contractURI may be an inline data: URI (utf8 / percent-encoded / base64) or an ipfs:// or http(s) link.
  // Never throw during render: malformed or unreachable metadata just shows empty fields.
  const uri = typeof contractUri === 'string' ? contractUri : ''
  const inline = uri.trim().toLowerCase().startsWith('data:')
  const remoteUrl = inline ? '' : resolveMetadataUri(uri)
  const { data: remote, isFetched: remoteFetched } = useQuery({
    queryKey: ['contractUri', remoteUrl],
    enabled: !!remoteUrl,
    queryFn: async () => {
      const response = await fetch(remoteUrl)
      if (!response.ok) throw new Error(`contractURI fetch failed: ${response.status}`)
      return (await response.json()) as Partial<ContractMetadata>
    },
  })

  // `remote` stays undefined when there is no fetchable URL (the query is disabled).
  const metadata = inline ? parseJsonDataUri<Partial<ContractMetadata>>(uri) : remote
  const meta = metadata && typeof metadata === 'object' ? metadata : {}

  return {
    name: typeof meta.name === 'string' ? meta.name : '',
    description: typeof meta.description === 'string' ? meta.description : '',
    image: typeof meta.image === 'string' ? meta.image : '',
    external_link: typeof meta.external_link === 'string' ? meta.external_link : '',
    collaborators: Array.isArray(meta.collaborators) ? meta.collaborators : [],
    /** The whole parsed document, so an update can keep fields this form doesn't edit. */
    raw: meta as Record<string, unknown>,
    /** True once the current contractURI has been read (and fetched, if remote), even if it was empty or broken. */
    loaded: uriFetched && (!remoteUrl || remoteFetched),
    setContractUri,
  }
}

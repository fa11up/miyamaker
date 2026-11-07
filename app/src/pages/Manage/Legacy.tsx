/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable no-nested-ternary */
import { createContext, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { useAccount, useReadContract } from 'wagmi'

import { ConnectedButton, HighlightButton } from '@/components/Button'
import FormInput from '@/components/FormInput'
import Tabs from '@/components/Tabs'
import Pages from '@/constants/pages'
import { useWaitForTransaction } from '@/hooks/useWaitForTransaction'

import AllocationRow from './TableRows/AllocationRow'
import BaseUriRow from './TableRows/BaseUriRow'
import MaxSupplyRow from './TableRows/MaxSupplyRow'
import NameRow from './TableRows/NameRow'
import PriceRow from './TableRows/PriceRow'
import ReferralRow from './TableRows/ReferralRow'
import { useAlignedNft } from './useAlignedNft'
import { useBaseUri } from './useBaseUri'
import { useContractUri } from './useContractUri'
import { useMintOpen } from './useMintOpen'
import { useSymbol } from './useSymbol'

const ManageContext = createContext<{ collection: Address | undefined; errors: Record<string, unknown> }>({
  collection: undefined,
  errors: {},
})

const page = Pages.manager

const SunkenPanel = styled.div`
  width: 100%;
  box-sizing: border-box;
  border: 2px groove transparent;
  border-image: svg-load('./icon/sunken-panel-border.svg') 2;
  overflow: auto;
  background-color: #fff;

  table {
    border-collapse: collapse;
    position: relative;
    text-align: left;
    white-space: nowrap;
    background-color: #fff;
  }

  table > thead > tr > * {
    position: sticky;
    top: 0;
    height: 20px;
    box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #dfdfdf;
    background: #9991c7;
    font-weight: 900;
    box-sizing: border-box;
    font-weight: normal;
    padding: 0 6px;
  }

  table.interactive > tbody > tr {
    cursor: pointer;
  }

  table > tbody > tr.highlighted {
    color: #fff;
    background-color: #000080;
  }

  table > tbody > tr > * {
    padding: 0 6px;
    height: 21px;
  }
`

/**
 * Manage for legacy MiyaMints v1 (ERC721M) collections: the original Metadata / Properties / Actions tabs.
 * The window chrome, picker and miyamints collections live in ./index.tsx.
 */
export default function LegacyManage({ collection, onChange }: { collection: Address; onChange: () => void }) {
  const [contextState] = useState({ collection: collection as Address | undefined, errors: {} })
  const [tab, setTab] = useState('metadata')

  // Account
  const { isConnected, address } = useAccount()

  const { alignedNft, isLoading: alignedLoading } = useAlignedNft({ address: collection })
  const symbol = useSymbol({ address: collection })
  const { uriLocked, lockUri, refetch: refetchUriLocked } = useBaseUri({ address: collection })
  const { mintOpen, openMint, refetch: refetchMintOpen } = useMintOpen({ address: collection })

  const is721m = useMemo(() => {
    // check if it's a collection from factory
    return !!alignedNft
  }, [alignedNft])

  const { data: owner, refetch: refetchOwner, isLoading: ownerLoading } = useReadContract({
    functionName: 'owner',
    address: collection,
    abi: [
      {
        inputs: [],
        name: 'owner',
        outputs: [{ internalType: 'address', name: 'result', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    query: { enabled: !!(collection && is721m) },
  })

  const isOwner = useMemo(() => {
    refetchOwner()
    return owner === address
  }, [address, owner, refetchOwner])

  const metadata = useContractUri({
    address: collection,
  })

  const [openInput, setOpenInput] = useState('')

  const PropertyTab = useMemo(() => {
    if (!collection) return <></>
    return (
      <div>
        <SunkenPanel>
          <table className="interactive" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Property</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <NameRow
                collection={collection}
                active={openInput === 'realName'}
                onActive={() => setOpenInput('realName')}
              />
              <tr>
                <td>Symbol</td>
                <td>{symbol}</td>
                <td style={{ padding: 0 }}>
                  <ConnectedButton
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                    disabled={true}
                    onClick={() => null}
                  >
                    Locked
                  </ConnectedButton>
                </td>
              </tr>
              <tr>
                <td>Parent</td>
                <td>{alignedNft}</td>
                <td style={{ padding: 0 }}>
                  <ConnectedButton
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                    disabled={true}
                    onClick={() => null}
                  >
                    Locked
                  </ConnectedButton>
                </td>
              </tr>
              <BaseUriRow
                collection={collection}
                active={openInput === 'baseUri'}
                onActive={() => setOpenInput('baseUri')}
              />
              <MaxSupplyRow
                collection={collection}
                active={openInput === 'maxSupply'}
                onActive={() => setOpenInput('maxSupply')}
              />
              <AllocationRow
                collection={collection}
                active={openInput === 'allocation'}
                onActive={() => setOpenInput('allocation')}
              />
              <PriceRow collection={collection} active={openInput === 'price'} onActive={() => setOpenInput('price')} />
              <ReferralRow
                collection={collection}
                active={openInput === 'referral'}
                onActive={() => setOpenInput('referral')}
              />
            </tbody>
          </table>
        </SunkenPanel>
      </div>
    )
  }, [alignedNft, collection, openInput, symbol])

  const [transacting, setTransacting] = useState('')
  const [txHash, setTxHash] = useState('')

  useWaitForTransaction({
    hash: (txHash as Address) || '0x',
    enabled: !!txHash,
    onSuccess: () => {
      if (transacting === 'lockUri') {
        refetchUriLocked()
      }

      if (transacting === 'openMint') {
        refetchMintOpen()
      }

      if (transacting === 'metadata') {
        // Saved: the form follows the chain again, instead of holding on to edits no longer pending.
        setFormDirty(false)
        metadata.refetch()
      }

      setTransacting('')
      setTxHash('')
    },
    // A revert or an unreadable receipt: stop showing "Updating...", or the row is stuck.
    onError: () => {
      setTransacting('')
      setTxHash('')
    },
    onReplaced: (reason) => {
      // A sped-up copy is the same change: onSuccess comes with its receipt, and refetches.
      if (reason === 'repriced') return
      setTransacting('')
      setTxHash('')
    },
  })

  const handleLockUri = async () => {
    if (uriLocked) return
    setTransacting('lockUri')
    try {
      const res = await lockUri()
      setTxHash(res.hash)
    } catch (e) {
      setTransacting('')
    }
  }

  const handleOpenMint = async () => {
    if (mintOpen) return
    setTransacting('openMint')
    try {
      const res = await openMint()
      setTxHash(res.hash)
    } catch (e) {
      setTransacting('')
    }
  }

  const ActionTab = useMemo(() => {
    if (!collection) return <></>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <b>Warning: The following actions are permanent!</b>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label>Lock Base URI</label>
          <ConnectedButton
            style={{
              width: 'fit-content',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            disabled={!!transacting || uriLocked}
            onClick={() => handleLockUri()}
            withChain={[mainnet.id, sepolia.id]}
          >
            {transacting === 'lockUri' ? 'Updating...' : uriLocked ? 'Locked' : 'Lock'}
          </ConnectedButton>
          <small>Locks the current images to the nfts permanently.</small>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label>Open mint</label>
          <ConnectedButton
            style={{
              width: 'fit-content',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            disabled={!!transacting || mintOpen}
            onClick={() => handleOpenMint()}
            withChain={[mainnet.id, sepolia.id]}
          >
            {transacting === 'openMint' ? 'Updating...' : mintOpen ? 'Already open' : 'Open'}
          </ConnectedButton>
          <small>Starts minting phase.</small>
        </div>
      </div>
    )
  }, [collection, mintOpen, transacting, uriLocked])

  const [form, setForm] = useState<{
    name: string
    description: string
    image: string
    external_link: string
    collaborators: Address[]
  }>({
    name: metadata.name,
    description: metadata.description,
    image: metadata.image,
    external_link: metadata.external_link,
    collaborators: metadata.collaborators,
  })

  // The form starts empty while contractURI loads. Fill it once loaded (and again when the collection changes), but
  // never over the user's edits; Update stays disabled until then so empty fields can't overwrite real metadata.
  const [formDirty, setFormDirty] = useState(false)
  useEffect(() => setFormDirty(false), [collection])
  useEffect(() => {
    if (!metadata.loaded || formDirty) return
    setForm({
      name: metadata.name,
      description: metadata.description,
      image: metadata.image,
      external_link: metadata.external_link,
      collaborators: metadata.collaborators,
    })
  }, [metadata.loaded, metadata.name, metadata.description, metadata.image, metadata.external_link, collection])

  const handleInputName = (input: string) => {
    setFormDirty(true)
    setForm((prev) => ({ ...prev, name: input }))
  }

  const handleInputDescription = (input: string) => {
    setFormDirty(true)
    setForm((prev) => ({ ...prev, description: input }))
  }

  const handleInputImage = (input: string) => {
    setFormDirty(true)
    setForm((prev) => ({ ...prev, image: input }))
  }

  const handleInputExternalLink = (input: string) => {
    setFormDirty(true)
    setForm((prev) => ({ ...prev, external_link: input }))
  }

  const handleUpdateMetadata = async () => {
    setTransacting('metadata')
    try {
      const contractURI = `data:application/json;utf8,${encodeURIComponent(
        JSON.stringify({ ...metadata.raw, ...form })
      )}`

      const result = await metadata.setContractUri(contractURI)
      setTxHash(result.hash)
    } catch (e) {
      setTransacting('')
    }
  }

  const MetadataTab = useMemo(() => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '240px' }}>
        <FormInput
          label="Name"
          inputKey="name"
          value={form.name}
          onChange={(e) => handleInputName(e.target.value)}
          error={undefined}
        />

        <FormInput
          label="Description"
          inputKey="description"
          value={form.description}
          onChange={(e) => handleInputDescription(e.target.value)}
          error={undefined}
        />

        <FormInput
          label="Image"
          inputKey="image"
          value={form.image}
          onChange={(e) => handleInputImage(e.target.value)}
          error={undefined}
        />

        <FormInput
          label="External Link"
          inputKey="externalLink"
          value={form.external_link}
          onChange={(e) => handleInputExternalLink(e.target.value)}
          error={undefined}
        />

        <ConnectedButton
          style={{
            width: 'fit-content',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          disabled={!!transacting || !metadata.loaded}
          onClick={() => handleUpdateMetadata()}
          withChain={[mainnet.id, sepolia.id]}
        >
          {transacting === 'metadata' ? 'Updating...' : 'Update'}
        </ConnectedButton>
      </div>
    )
  }, [form.description, form.external_link, form.image, form.name, transacting, metadata.loaded])

  const connectHint = !isConnected && <p>Connect your wallet to manage a collection you own.</p>

  // Not a verdict until the chain has answered.
  if (alignedLoading || ownerLoading) return <div style={{ padding: '8px' }}>Loading…</div>

  if (!(isOwner && is721m)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}>
        <b>Nothing to manage at this address.</b>
        <p style={{ margin: 0 }}>It may be the wrong address or the wrong network, or this wallet may not own it.</p>
        {connectHint}
        <div>
          <HighlightButton onClick={onChange}>Pick another collection</HighlightButton>
        </div>
      </div>
    )
  }

  return (
    <ManageContext.Provider value={contextState}>
      <div style={{ display: 'flex', flex: '1 0 auto' }}>
        <Tabs
          active={tab}
          fillHeight
          fillWidth
          tabs={[
            { title: 'Metadata', id: 'metadata', children: MetadataTab },
            { title: 'Properties', id: 'properties', children: PropertyTab },
            { title: 'Actions', id: 'advanced', children: ActionTab },
          ]}
          onChange={(t) => setTab(t)}
        />
      </div>
    </ManageContext.Provider>
  )
}

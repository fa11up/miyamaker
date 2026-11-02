import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components/macro'
import type { Address } from 'viem'
import { getAddress, isAddress, zeroAddress } from 'viem'
import { useAccount, useReadContracts, useSwitchChain } from 'wagmi'

import { Err, Field, SmallButton } from '@/components/LaunchKit'
import LaunchList from '@/components/LaunchKit/LaunchList'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, StatusBox } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import type { SupportedChainId } from '@/config/wagmi'
import { chains, explorerUrl, mainnet } from '@/config/wagmi'
import { miyamintsAddresses } from '@/constants/contracts'
import Pages from '@/constants/pages'
import { ownerAbi, registryAbi } from '@/miyamints/abi'
import type { LaunchKind } from '@/miyamints/collections'
import { keyOf, KIND_LABEL, kindFromFactory } from '@/miyamints/collections'
import { rememberLaunch } from '@/miyamints/local'
import { useMyLaunches } from '@/miyamints/useMyLaunches'
import { setManageTarget, useManageTarget, useOpenManage } from '@/miyamints/useOpenManage'
import { useOpenApp } from '@/music/useOpenApp'
import { updateManagedCollection } from '@/store/experience/actions'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { color, space, text } from '@/theme/tokens'

import LegacyManage from './Legacy'
import MiyamintsManage from './MiyamintsManage'

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]};
  max-width: 920px;
  margin: 0 auto;
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const nameAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

export default function ManagePage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('manager')
  const [params, setParams] = useSearchParams()
  const { address: wallet, isConnected, chainId: walletChainId } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChain } = useSwitchChain()
  const openApp = useOpenApp()
  const openManage = useOpenManage()
  const target = useManageTarget()
  const stored = useAppSelector((state) => state.experience.managedCollection)
  const mine = useMyLaunches()

  // Deep link: ?collection=0x… (legacy behaviour).
  useEffect(() => {
    const p = params.get('collection')
    if (p && isAddress(p)) dispatch(updateManagedCollection({ value: getAddress(p) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const collection = target?.address || (stored && isAddress(stored) ? (getAddress(stored) as Address) : undefined)
  const supportedWallet = chains.some((c) => c.id === walletChainId)
  const chainId = (target?.chainId || (supportedWallet ? walletChainId : undefined) || mainnet.id) as SupportedChainId
  const chain = chains.find((c) => c.id === chainId) || mainnet
  const a = miyamintsAddresses(chainId)

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: a.registry, abi: registryAbi, functionName: 'factoryOf', args: [collection || zeroAddress], chainId },
      { address: collection, abi: ownerAbi, functionName: 'owner', chainId },
      { address: collection, abi: nameAbi, functionName: 'name', chainId },
    ],
    query: { enabled: !!collection },
  })
  const factory = reads.data?.[0]?.result as string | undefined
  const owner = reads.data?.[1]?.result as string | undefined
  const name = reads.data?.[2]?.result as string | undefined

  const detected: LaunchKind | undefined = (() => {
    if (target && target.kind !== 'unknown') return target.kind
    if (!reads.data) return undefined
    const k = kindFromFactory(factory && factory !== zeroAddress ? factory : undefined, a)
    return k === 'unknown' ? 'legacy' : k
  })()
  const isOwner = !!owner && !!wallet && owner.toLowerCase() === wallet.toLowerCase()
  const onWrongChain = isConnected && walletChainId !== chainId

  useEffect(() => {
    if (collection && detected === 'legacy' && isOwner) rememberLaunch(chainId, collection, 'legacy')
  }, [collection, detected, isOwner, chainId])

  // Keep the session target in sync with what was detected (so the Start menu highlights it).
  useEffect(() => {
    if (collection && detected && (!target || target.address !== collection)) {
      setManageTarget({ chainId, address: collection, kind: detected })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, detected])

  const clear = () => {
    setManageTarget(undefined)
    dispatch(updateManagedCollection({ value: undefined }))
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('collection')
      return next
    })
  }

  const close = () => {
    dispatch(closeWindow({ value: 'manager' }))
  }

  const [paste, setPaste] = useState('')
  const pasteOk = isAddress(paste.trim())

  const explorer = explorerUrl(chainId)
  const current = mine.launches.find((l) => collection && keyOf(l) === keyOf({ chainId, address: collection }))

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          close()
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'manager' }))
        }}
      >
        {Pages.manager?.label}
      </TitleBar>
      <Layout data-manage>
        <Inner>
          {!collection ? (
            <>
              <Head>
                <div>
                  <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>Manage</Eyebrow>
                  <DisplayTitle>Pick a collection</DisplayTitle>
                </div>
              </Head>
              <Panel aria-label="My launches">
                <Eyebrow>My launches</Eyebrow>
                {isConnected ? (
                  <div role="menu" aria-label="My launches">
                    <LaunchList
                      launches={mine.launches}
                      loading={mine.loading}
                      error={mine.error}
                      onRetry={() => mine.refetch()}
                      onPick={(l) => openManage({ chainId: l.chainId, address: l.address, kind: l.kind })}
                      onLaunch={() => openApp('launch')}
                    />
                  </div>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: text.sm }}>
                      Connect a wallet to see the collections you launched.
                    </p>
                    <div>
                      <BigButton
                        type="button"
                        style={{ width: 'auto', padding: `0 ${space[5]}` }}
                        onClick={() => openConnectModal?.()}
                      >
                        Connect wallet
                      </BigButton>
                    </div>
                  </>
                )}
              </Panel>
              <details>
                <summary style={{ cursor: 'pointer', fontSize: text.sm }}>Manage a collection by its address</summary>
                <Panel style={{ marginTop: space[2] }}>
                  <Field>
                    Collection address on {chain.name}
                    <input
                      value={paste}
                      placeholder="0x…"
                      spellCheck={false}
                      onChange={(e) => setPaste(e.target.value)}
                    />
                    <Err>
                      {paste && !pasteOk ? 'That is not an address (0x followed by 40 characters).' : undefined}
                    </Err>
                    <small>Works for collections from Launch and for older MiyaMints v1 collections.</small>
                  </Field>
                  <div>
                    <SmallButton
                      type="button"
                      disabled={!pasteOk}
                      onClick={() => openManage({ chainId, address: getAddress(paste.trim()), kind: 'unknown' })}
                    >
                      Open
                    </SmallButton>
                  </div>
                </Panel>
              </details>
            </>
          ) : (
            <>
              <Head>
                <div style={{ minWidth: 0 }}>
                  <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>
                    Manage · {chain.name}
                  </Eyebrow>
                  <DisplayTitle>
                    {name || current?.name || `${collection.slice(0, 6)}…${collection.slice(-4)}`}
                  </DisplayTitle>
                </div>
                <div style={{ display: 'flex', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
                  {detected && <Chip tone={isOwner ? 'ok' : 'off'}>{KIND_LABEL[detected]}</Chip>}
                  <SmallButton type="button" onClick={clear}>
                    Change collection
                  </SmallButton>
                </div>
              </Head>
              <div>
                <SmallButton
                  as="a"
                  href={`${explorer}/address/${collection}`}
                  target="_blank"
                  rel="noreferrer"
                  title={collection}
                  style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                >
                  Contract {collection.slice(0, 6)}…{collection.slice(-4)} on {chain.name} ↗
                </SmallButton>
              </div>
              {!isConnected && (
                <StatusBox tone="info">
                  <span>
                    Connect the wallet that owns this collection to make changes.{' '}
                    <SmallButton type="button" onClick={() => openConnectModal?.()}>
                      Connect wallet
                    </SmallButton>
                  </span>
                </StatusBox>
              )}
              {onWrongChain && (
                <StatusBox tone="info">
                  <span>
                    This collection is on {chain.name}. Your wallet is on another network.{' '}
                    <SmallButton type="button" onClick={() => switchChain({ chainId })}>
                      Switch to {chain.name}
                    </SmallButton>
                  </span>
                </StatusBox>
              )}
              {isConnected && owner && !isOwner && detected !== 'legacy' && (
                <StatusBox tone="info">
                  <span>This wallet does not own this collection, so you can look but not change things.</span>
                </StatusBox>
              )}
              <Panel style={{ padding: space[2] }}>
                {!detected ? (
                  <span style={{ fontSize: text.sm }}>Loading…</span>
                ) : detected === 'legacy' ? (
                  <LegacyManage key={collection} collection={collection} onChange={clear} />
                ) : (
                  <MiyamintsManage
                    key={`${chainId}:${collection}`}
                    chainId={chainId}
                    address={collection}
                    kind={detected as 'drop' | 'auction' | 'editions'}
                    isOwner={isOwner && !onWrongChain}
                  />
                )}
              </Panel>
            </>
          )}
        </Inner>
      </Layout>
    </WindowWrapper>
  )
}

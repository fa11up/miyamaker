import { useConnectModal } from '@rainbow-me/rainbowkit'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { formatEther } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { CloseGuardBox, DropZone, SmallButton, SplitMeter, TxSteps, useCloseGuard } from '@/components/LaunchKit'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, StatusBox, Well } from '@/components/Retro'
import { y2kSkin } from '@/components/Retro/y2k'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import Pages from '@/constants/pages'
import type { LaunchForm, LaunchType, StepKey } from '@/miyamints/launch'
import {
  AUCTION_TIME_BUFFER_SECONDS,
  draftHasData,
  EMPTY_FORM,
  parseAlignmentPct,
  parseEth,
  parseRoyaltyPct,
  parseVault,
  phaseLine,
  STEP_ORDER,
  txPlan,
  validateStep,
  whenWords,
} from '@/miyamints/launch'
import { pctLabel } from '@/miyamints/split'
import { useLaunchChain, useRegistryRules, useVaultInfo } from '@/miyamints/useMiyamints'
import { validateAudioFile, validateImageFile } from '@/music/audio'
import { nextStepsWords, storageWords, storedBytes } from '@/music/creatorWords'
import { readAudioDuration } from '@/music/readDuration'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { color, font, space, text } from '@/theme/tokens'
import { FREE_BYTES } from '@/utils/fundAndUpload'
import { resolveUri } from '@/utils/resolveUri'
import { useStorageQuote } from '@/utils/useStorageQuote'

import goldSkin from './skin/gold.webp'
import malachiteSkin from './skin/malachite.webp'
import Preview, { PreviewCard, priceLine, supplyLine, TYPE_LABEL } from './Preview'
import type { Pick } from './Steps'
import { AlignStep, ArtStep, PhaseBox, SaleStep, TypeCard, TypeStep, VaultCard } from './Steps'
import { useLaunch } from './useLaunch'

const LAUNCH_TYPES: LaunchType[] = ['drop', 'auction', 'editions']

const STEP_LABEL: Record<StepKey, string> = {
  type: 'Type',
  art: 'Artwork',
  sale: 'Price & supply',
  align: 'Vault share',
  review: 'Review',
}

/** Launch's own material: polished malachite, ivory panels and brushed champagne gold. */
const Layout = styled.div`
  height: 100%;
  /* Always there: a scrollbar coming and going with the step's height would nudge the page sideways. */
  overflow-y: scroll;
  overflow-x: hidden;
  /* Long steps: a field scrolled to must not end up under the sticky footer. */
  scroll-padding-bottom: 96px;
  ${y2kSkin({
    ink: '#12261e',
    inkSoft: '#4a5f53',
    material: `linear-gradient(rgba(3, 26, 20, 0.34), rgba(3, 26, 20, 0.34)), url(${malachiteSkin}) 0 0 / 1024px 1024px`,
    head: '#f4ecd2',
    headShadow: '#02140f',
    frost: '#fbf8ee',
    edge: '#b39a5e',
    glow: 'rgba(179, 154, 94, 0.08)',
    gelTop: '#f0e0b2',
    gelBottom: '#c9b27a',
    gelInk: '#1c2a1e',
    smallTop: '#fdfbf3',
    smallBottom: '#ece5cf',
    link: '#0b5d45',
  })}
  /* Square up the Y2K layer's pills and take the gloss off: stone and metal, not plastic. */
  && ${Panel}, && ${Well}, && ${StatusBox} {
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(2, 20, 15, 0.35);
  }
  && ${BigButton}, && ${SmallButton} {
    border-radius: 3px;
    filter: none;
  }
  && ${BigButton} {
    font-family: ${font.ui};
    font-size: ${text.sm};
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  && ${BigButton}:not(:disabled):not(.secondary) {
    border: 1px solid #6e5a2a;
    background: #c9b27a url(${goldSkin}) 0 0 / 256px 256px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 3px rgba(2, 20, 15, 0.5);
    color: #1c2a1e;
    &:hover {
      filter: brightness(1.06);
    }
  }
  && ${BigButton}.secondary:not(:disabled), && ${SmallButton}:not(:disabled) {
    border: 1px solid #b39a5e;
    background: #fdfbf3;
    box-shadow: 0 1px 2px rgba(2, 20, 15, 0.25);
    color: #12261e;
    &:hover {
      background: #f7f1dd;
    }
  }
  && ${SmallButton}[aria-pressed='true']:not(:disabled) {
    border-color: #6e5a2a;
    background: #c9b27a url(${goldSkin}) 0 0 / 256px 256px;
    font-weight: 700;
  }
  && ${BigButton}:disabled, && ${SmallButton}:disabled {
    border: 1px solid #cfc6a8;
    background: #ece7d6;
    box-shadow: none;
    color: #6f6d5c;
  }
  && input[type='text'],
  && input[type='number'],
  && input[type='url'],
  && input[type='datetime-local'],
  && input:not([type]),
  && input[type='file'],
  && textarea,
  && select {
    border-radius: 3px;
    box-shadow: inset 0 1px 2px rgba(2, 20, 15, 0.15);
  }
  && input[aria-invalid='true'],
  && textarea[aria-invalid='true'] {
    box-shadow: inset 0 0 0 2px ${color.danger};
  }
  && ${StatusBox} {
    background: #fbf8ee;
  }
  && ${DropZone} {
    border: 1px dashed #8d7338;
    border-radius: 4px;
    outline: none;
    background: #f7f1dd;
    box-shadow: none;
  }
  ${PreviewCard}, ${TypeCard}, ${VaultCard}, ${PhaseBox} {
    border: 1px solid #b39a5e;
    border-radius: 4px;
    background: #fdfbf3;
    box-shadow: 0 1px 2px rgba(2, 20, 15, 0.2);
    color: #12261e;
  }
  ${TypeCard}:hover:not(:disabled), ${VaultCard}:hover:not(:disabled) {
    background: #f7f1dd;
  }
  ${TypeCard}[aria-pressed='true'], ${VaultCard}[aria-pressed='true'], ${TypeCard}[aria-checked='true'],
  ${VaultCard}[aria-checked='true'] {
    border-color: #8d7338;
    background: #f5ebcb;
    box-shadow: inset 0 0 0 1px #8d7338;
  }
  && ${TypeCard}[aria-pressed='true'], && ${VaultCard}[aria-pressed='true'], && ${TypeCard}[aria-checked='true'],
  && ${VaultCard}[aria-checked='true'] {
    outline: none;
  }
  && ${TypeCard}:focus-visible, && ${VaultCard}:focus-visible {
    outline: 2px solid #8d7338;
    outline-offset: 1px;
  }
  && ${CloseGuardBox} {
    border: 1px solid #b39a5e;
    border-radius: 4px;
    background: #fbf8ee;
    color: #12261e;
  }
  && ${CloseGuardBox} .keep:not(:disabled) {
    border-color: #6e5a2a;
    background: #c9b27a url(${goldSkin}) 0 0 / 256px 256px;
    font-weight: 700;
  }
  ${PreviewCard} ${Eyebrow}, ${PreviewCard} ${DisplayTitle} {
    color: #4a5f53 !important;
    text-shadow: none !important;
  }
  /* The page's title, stamped in gold foil. */
  header ${DisplayTitle} {
    background: linear-gradient(180deg, #fff6d8 0%, #e6cf95 45%, #b4985a 55%, #f0e0b2 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: none;
    filter: drop-shadow(0 1px 0 #02140f);
  }
`

const Inner = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]};
  max-width: 1100px;
  margin: 0 auto;
  /* Fills the window, so the footer meets its bottom edge on a short step. */
  box-sizing: border-box;
  min-height: 100%;
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Rail = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  li button {
    width: 100%;
    min-height: 36px;
    border: 1px solid #b39a5e;
    border-radius: 3px;
    background: rgba(3, 28, 22, 0.86);
    color: #f4ecd2;
    font: inherit;
    font-size: ${text.xs};
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 ${space[2]};
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
  }
  li button:disabled {
    color: #93a79b;
    cursor: default;
  }
  li button:disabled .n {
    background: #3f5a4d;
    color: #93a79b;
  }
  li button[aria-current='step'] {
    border-color: #6e5a2a;
    background: #c9b27a url(${goldSkin}) 0 0 / 256px 256px;
    color: #1c2a1e;
    font-weight: 700;
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    border-radius: 50%;
    background: #c9b27a;
    color: #12261e;
    font-variant-numeric: tabular-nums;
  }
  [aria-current='step'] .n {
    background: #12261e;
    color: #f4ecd2;
  }
  .narrow & .label {
    display: none;
  }
  .narrow & li button {
    justify-content: center;
  }
`

const Body = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: ${space[3]};
  align-items: start;
  .narrow & {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Foot = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 1;
  margin: auto -${space[3]} -${space[3]};
  padding: ${space[2]} ${space[3]} ${space[3]};
  border-top: 1px solid #b39a5e;
  background: #031c16;
  display: flex;
  gap: ${space[2]};
  align-items: center;
  justify-content: space-between;
  button.back {
    min-height: 52px;
    padding: 0 ${space[4]};
    font-size: ${text.sm};
  }
  .primary {
    flex: 0 1 320px;
    /* Stays on the right when the first step has no Back. */
    margin-left: auto;
  }
  .narrow & .primary {
    flex: 1 1 auto;
  }
`

const Summary = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: minmax(110px, auto) minmax(0, 1fr);
  gap: ${space[1]} ${space[3]};
  font-size: ${text.sm};
  dt {
    color: ${color.inkMuted};
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: ${font.mono};
    font-size: ${text.xs};
  }
`

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

export default function LaunchPage() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen('launch')
  const { address, isConnected, chainId: walletChainId } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChain } = useSwitchChain()

  const net = useLaunchChain()
  const rules = useRegistryRules(net.chainId, net.addresses.registry)
  const launch = useLaunch()

  // /launch?type=drop|auction|editions (miyanet's "Launch your own") opens with that kind picked.
  const location = useLocation()
  const askedType = new URLSearchParams(location.search).get('type')
  const [form, setForm] = useState<LaunchForm>(() =>
    LAUNCH_TYPES.includes(askedType as LaunchType) ? { ...EMPTY_FORM, type: askedType as LaunchType } : EMPTY_FORM
  )
  useEffect(() => {
    // Already open: a new pick only replaces the kind while nothing has been typed yet.
    if (LAUNCH_TYPES.includes(askedType as LaunchType) && !form.name.trim())
      setForm((f) => ({ ...f, type: askedType as LaunchType }))
  }, [askedType])
  const [stepIdx, setStepIdx] = useState(0)
  const [shown, setShown] = useState<Partial<Record<StepKey, boolean>>>({})
  const [image, setImage] = useState<Pick>()
  const [audio, setAudio] = useState<Pick>()
  const scrollBox = useRef<HTMLDivElement | null>(null)
  // Counts refused presses of Next, so the same error scrolls back into view each time.
  const [refused, setRefused] = useState(0)

  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (k === 'imageUri' || k === 'imageMode') launch.invalidate('image')
    if (k === 'audioUri' || k === 'audioMode') {
      launch.invalidate('audio')
      setForm((f) => ({ ...f, audioMime: '' }))
    }
  }

  // Default the alignment share to the registry minimum once it is known.
  useEffect(() => {
    if (rules.loaded) {
      setForm((f) => {
        const a = parseAlignmentPct(f.alignmentPct, rules.minAlignmentBps, rules.protocolFeeBps)
        return a.ok ? f : { ...f, alignmentPct: String(rules.minAlignmentBps / 100) }
      })
    }
  }, [rules.loaded, rules.minAlignmentBps, rules.protocolFeeBps])

  useEffect(() => () => image && URL.revokeObjectURL(image.url), [image])
  useEffect(() => () => audio && URL.revokeObjectURL(audio.url), [audio])

  const pickImage = (file?: File) => {
    if (!file) return
    launch.invalidate('image')
    setImage({ file, check: validateImageFile(file), url: URL.createObjectURL(file) })
  }

  const pickAudio = async (file?: File) => {
    if (!file) return
    launch.invalidate('audio')
    const check = validateAudioFile(file)
    const pick: Pick = { file, check, url: URL.createObjectURL(file) }
    setAudio(pick)
    if (!form.name) set('name', file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 64))
    if (check.ok) {
      const duration = await readAudioDuration(file).catch(() => undefined)
      setAudio((a) => (a?.file === file ? { ...a, duration } : a))
    }
  }

  const vaultAddr =
    form.vaultChoice === 'default'
      ? net.addresses.defaultVault
      : (() => {
          const v = parseVault(form.customVault)
          return v.ok ? v.vault : undefined
        })()
  const defaultVault = useVaultInfo(net.chainId, net.addresses.registry, net.addresses.defaultVault)
  const chosenVault = useVaultInfo(net.chainId, net.addresses.registry, vaultAddr)
  const vaultName = chosenVault.symbol

  const now = BigInt(Math.floor(Date.now() / 1000))
  const ctx = {
    now,
    minAlignmentBps: rules.minAlignmentBps,
    protocolFeeBps: rules.protocolFeeBps,
    image: {
      hasFile: !!image,
      fileError: image && !image.check.ok ? image.check.error : undefined,
    },
    audio: {
      hasFile: !!audio,
      fileError: audio && !audio.check.ok ? audio.check.error : undefined,
    },
  }
  const step = STEP_ORDER[stepIdx] as StepKey
  const errorsFor = (s: StepKey) => {
    const e = validateStep(s, form, ctx)
    if (s === 'align' && form.vaultChoice === 'custom' && !e.customVault && chosenVault.registered === false) {
      e.customVault = 'That address is not a vault registered with miya on this network.'
    }

    return e
  }

  const stepErrors = errorsFor(step)
  const stepOk = Object.keys(stepErrors).length === 0
  const firstBlocked = STEP_ORDER.findIndex((s) => s !== 'review' && Object.keys(errorsFor(s)).length > 0)
  const shownErrors = shown[step] ? stepErrors : {}

  const align = parseAlignmentPct(form.alignmentPct, rules.minAlignmentBps, rules.protocolFeeBps)
  const alignmentBps = align.ok ? align.bps : rules.minAlignmentBps
  const imageUrl = form.imageMode === 'upload' ? (image?.check.ok ? image.url : undefined) : resolveUri(form.imageUri)

  const ready = net.deployed && isConnected && !net.wrongChain && walletChainId === net.chainId
  const resolvedBase = address && vaultAddr ? { creator: address, vault: vaultAddr, alignmentBps } : undefined

  // Dry-run the create call when arriving at Review (and when inputs change there).
  const reviewKey = JSON.stringify({ form, vaultAddr, alignmentBps, address, chain: net.chainId })
  useEffect(() => {
    if (step === 'review' && ready && resolvedBase && firstBlocked === -1 && !launch.instance) {
      launch.simulate(
        form,
        { ...resolvedBase, image: form.imageMode === 'link' ? form.imageUri.trim() : undefined },
        net.addresses,
        net.chainId
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ready, reviewKey])

  const goNext = () => {
    setShown((s) => ({ ...s, [step]: true }))
    if (!stepOk) {
      setRefused((n) => n + 1)
      return
    }

    setStepIdx((i) => Math.min(i + 1, STEP_ORDER.length - 1))
  }

  // Every step starts at its top.
  useEffect(() => {
    scrollBox.current?.scrollTo({ top: 0 })
  }, [stepIdx])

  useEffect(() => {
    if (refused) scrollBox.current?.querySelector('.err')?.scrollIntoView({ block: 'center' })
  }, [refused])

  const goTo = (i: number) => {
    if (launch.running) return
    if (i <= stepIdx || firstBlocked === -1 || i <= firstBlocked) setStepIdx(i)
  }

  const create = () => {
    if (!resolvedBase || !form.type) return
    launch.run({
      form,
      resolved: resolvedBase,
      image:
        form.imageMode === 'link' ? { uri: form.imageUri.trim() } : { file: image?.check.ok ? image.file : undefined },
      audio:
        form.type === 'editions' && form.editionKind === 'music'
          ? form.audioMode === 'link'
            ? { uri: form.audioUri.trim(), mime: form.audioMime || undefined }
            : { file: audio?.check.ok ? audio.file : undefined, mime: audio?.check.ok ? audio.check.mime : undefined }
          : undefined,
      addresses: net.addresses,
      chainId: net.chainId,
    })
  }

  const startOver = () => {
    launch.reset()
    setForm({ ...EMPTY_FORM, alignmentPct: form.alignmentPct })
    setImage(undefined)
    setAudio(undefined)
    setShown({})
    setStepIdx(0)
  }

  const explorer = explorerUrl(net.chainId)
  const [layoutRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 640
  const setLayout = (el: HTMLDivElement | null) => {
    scrollBox.current = el
    layoutRef(el)
  }

  // What the wallet will be asked for: only files not stored yet cost anything.
  const needsAudio = form.type === 'editions' && form.editionKind === 'music'
  const toStore = [
    ...(form.imageMode === 'upload' && image?.check.ok && !launch.uploaded.image ? [image.file] : []),
    ...(needsAudio && form.audioMode === 'upload' && audio?.check.ok && !launch.uploaded.audio ? [audio.file] : []),
  ]
  const storage = useStorageQuote(
    storedBytes(
      toStore.map((f) => f.size),
      FREE_BYTES
    )
  )
  const reserve = form.type === 'auction' ? parseEth(form.reserve) : undefined
  const deposit = reserve?.ok ? `${formatEther(reserve.wei)} ETH` : ''
  const hasDraft = !launch.result && draftHasData(form, !!image || !!audio)
  const guard = useCloseGuard({
    draft: hasDraft,
    running: launch.running,
    close: () => dispatch(closeWindow({ value: 'launch' })),
  })

  const primary = (() => {
    if (step !== 'review') return { label: `Next: ${STEP_LABEL[STEP_ORDER[stepIdx + 1] as StepKey]}`, onClick: goNext }
    if (!net.deployed) return { label: 'Opens soon', disabled: true }
    if (!isConnected) return { label: 'Connect wallet', onClick: () => openConnectModal?.() }
    if (walletChainId !== net.chainId) {
      return { label: `Switch to ${net.chain.name}`, onClick: () => switchChain({ chainId: net.chainId }) }
    }

    if (firstBlocked !== -1)
      return { label: `Fix: ${STEP_LABEL[STEP_ORDER[firstBlocked] as StepKey]}`, onClick: () => goTo(firstBlocked) }
    if (launch.running) return { label: 'Working… check your wallet', disabled: true }
    if (launch.instance && !launch.result) {
      return { label: deposit ? `Finish: pay ${deposit} and start` : 'Retry the last step', onClick: create }
    }

    if (form.type === 'auction')
      return { label: `Create auction and pay ${deposit}`, onClick: create, disabled: launch.check.state === 'error' }
    if (form.type === 'editions')
      return { label: 'Create edition', onClick: create, disabled: launch.check.state === 'error' }
    return { label: 'Create collection', onClick: create, disabled: launch.check.state === 'error' }
  })()

  const plan = form.type ? txPlan(form.type) : []
  const pipeline = [
    {
      id: 'image',
      label: form.imageMode === 'link' ? 'Artwork (your link)' : 'Upload artwork to Arweave',
      state: launch.steps.image,
    },
    ...(needsAudio
      ? [
          {
            id: 'audio',
            label: form.audioMode === 'link' ? 'Track (your link)' : 'Upload the track to Arweave',
            state: launch.steps.audio,
          },
        ]
      : []),
    ...plan.map((p) => ({
      id: p.id,
      label: p.label,
      state: launch.steps[p.id],
      link: launch.hashes[p.id] ? `${explorer}/tx/${launch.hashes[p.id]}` : undefined,
    })),
  ]

  const vaultLabel = defaultVault.symbol
    ? `${defaultVault.targetName ? `${defaultVault.targetName} vault` : 'Default vault'} (buys ${
        defaultVault.symbol
      }), recommended`
    : 'Default vault, recommended'

  // Before launch the note under the header says so.
  const statusChip = net.deployed && <Chip tone="ok">Live on {net.chain.name}</Chip>

  const success = launch.result
  const royalty = parseRoyaltyPct(form.royaltyPct)

  return (
    <WindowWrapper skin="launch">
      <TitleBar
        skin="launch"
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          guard.ask()
        }}
        fullscreen={fullscreen}
        fullscreenBtn
        onFullscreen={() => toggleFullscreen()}
        minimizeBtn
        onMinimize={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(minimizeWindow({ value: 'launch' }))
        }}
      >
        {Pages.launch?.label}
      </TitleBar>
      <Layout ref={setLayout} className={narrow ? 'narrow' : undefined} data-launch>
        {guard.dialog}
        <Inner>
          <Head>
            <div>
              <Eyebrow style={{ color: color.highlight, textShadow: `1px 1px 0 ${color.dark}` }}>miyamints</Eyebrow>
              <DisplayTitle>{success ? "It's live!" : 'Launch a collection'}</DisplayTitle>
            </div>
            {statusChip}
          </Head>

          {!net.deployed && !success && (
            <StatusBox tone="info" role="status">
              <span>Launching opens soon. Try every step; you cannot publish yet.</span>
            </StatusBox>
          )}
          {net.wrongChain && (
            <StatusBox tone="error" role="alert">
              <span style={{ flex: 1 }}>Your wallet is on a network miya does not support.</span>
              <SmallButton type="button" onClick={() => switchChain({ chainId: net.chainId })}>
                Switch to {net.chain.name}
              </SmallButton>
            </StatusBox>
          )}

          {success ? (
            <Body>
              <Panel aria-label="Launched">
                <StatusBox tone="ok" role="status">
                  <span>
                    {form.name.trim()} is on {net.chain.name} at{' '}
                    <a href={`${explorer}/address/${success.instance}`} target="_blank" rel="noreferrer">
                      {short(success.instance)}
                    </a>
                    .{' '}
                    {success.type === 'auction'
                      ? 'Bidding is open now.'
                      : success.type === 'editions'
                      ? 'Copies can be bought as soon as the sale opens.'
                      : 'Pieces can be minted as soon as the first phase starts.'}
                  </span>
                </StatusBox>
                <TxSteps steps={pipeline} label="What happened" />
                <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
                  <SmallButton
                    as="a"
                    href={`${explorer}/address/${success.instance}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                  >
                    View on Etherscan ↗
                  </SmallButton>
                  <SmallButton type="button" onClick={startOver}>
                    Launch another
                  </SmallButton>
                </div>
                <small style={{ color: color.inkMuted, fontSize: text.xs }}>
                  It is also in My launches: press Start on the taskbar.
                </small>
              </Panel>
              <Preview
                form={form}
                imageUrl={imageUrl}
                protocolBps={rules.protocolFeeBps}
                alignmentBps={alignmentBps}
                vaultName={vaultName}
                compact={narrow}
              />
            </Body>
          ) : (
            <>
              <nav aria-label="Launch steps">
                <Rail>
                  {STEP_ORDER.map((s, i) => (
                    <li key={s}>
                      <button
                        type="button"
                        aria-current={i === stepIdx ? 'step' : undefined}
                        aria-label={`Step ${i + 1} of 5: ${STEP_LABEL[s]}`}
                        disabled={i > stepIdx && !(firstBlocked === -1 || i <= firstBlocked)}
                        onClick={() => goTo(i)}
                      >
                        <span className="n">{i + 1}</span>
                        <span className="label">{STEP_LABEL[s]}</span>
                      </button>
                    </li>
                  ))}
                </Rail>
              </nav>

              <Body>
                {narrow && stepIdx > 0 && (
                  <Preview
                    form={form}
                    imageUrl={imageUrl}
                    protocolBps={rules.protocolFeeBps}
                    alignmentBps={alignmentBps}
                    vaultName={vaultName}
                    compact
                  />
                )}
                <Panel aria-label={STEP_LABEL[step]}>
                  <Eyebrow>
                    Step {stepIdx + 1} of 5 · {STEP_LABEL[step]}
                  </Eyebrow>
                  {step === 'type' && <TypeStep form={form} set={set} errors={shownErrors} />}
                  {step === 'art' && (
                    <ArtStep
                      form={form}
                      set={set}
                      errors={shownErrors}
                      image={image}
                      audio={audio}
                      onImage={pickImage}
                      onAudio={pickAudio}
                      requiredDone={
                        !stepErrors.name &&
                        !stepErrors.symbol &&
                        !stepErrors.image &&
                        !stepErrors.audio &&
                        !stepErrors.artist
                      }
                    />
                  )}
                  {step === 'sale' && <SaleStep form={form} set={set} errors={shownErrors} />}
                  {step === 'align' && (
                    <AlignStep
                      form={form}
                      set={set}
                      errors={shownErrors}
                      minAlignmentBps={rules.minAlignmentBps}
                      protocolFeeBps={rules.protocolFeeBps}
                      defaultVault={{
                        label: vaultLabel,
                        symbol: defaultVault.symbol,
                        detail: net.addresses.defaultVault
                          ? defaultVault.symbol
                            ? `Your share buys ${defaultVault.symbol} and adds it to the ${defaultVault.symbol} pool.`
                            : 'The vault miya set up for this network.'
                          : 'The community vault opens with launch.',
                      }}
                      customVault={{
                        status:
                          vaultAddr && form.vaultChoice === 'custom' ? (
                            chosenVault.loading ? (
                              <small>Checking the vault…</small>
                            ) : chosenVault.registered ? (
                              <small>Registered vault{chosenVault.symbol ? `: buys ${chosenVault.symbol}` : ''}.</small>
                            ) : null
                          ) : null,
                      }}
                    />
                  )}
                  {step === 'review' && (
                    <>
                      <Summary>
                        <dt>Kind</dt>
                        <dd>
                          {TYPE_LABEL[form.type]}
                          {needsAudio ? ' (music)' : ''}
                        </dd>
                        <dt>Name</dt>
                        <dd>
                          {form.name.trim()}
                          {form.type !== 'editions' && form.symbol ? ` (${form.symbol.trim().toUpperCase()})` : ''}
                        </dd>
                        <dt>Price</dt>
                        <dd>{priceLine(form)}</dd>
                        <dt>Supply</dt>
                        <dd>{supplyLine(form)}</dd>
                        {form.type === 'drop' && (
                          <>
                            {form.phases.map((p, i) => (
                              // eslint-disable-next-line react/no-array-index-key
                              <Fragment key={i}>
                                <dt>{form.phases.length > 1 ? `Phase ${i + 1}` : 'Sale'}</dt>
                                <dd>{phaseLine(p)}</dd>
                              </Fragment>
                            ))}
                            <dt>Kept back</dt>
                            <dd>{form.ownerReserve.trim() || 'None'}</dd>
                            <dt>Resale royalty</dt>
                            <dd>{royalty.ok ? pctLabel(royalty.bps) : '—'}</dd>
                          </>
                        )}
                        {form.type === 'auction' && (
                          <>
                            <dt>Bid step</dt>
                            <dd>{form.bidStep.trim()} ETH</dd>
                            <dt>Length</dt>
                            <dd>
                              {form.durationHours} hours, late bids add {AUCTION_TIME_BUFFER_SECONDS / 60} minutes
                            </dd>
                            <dt>You pay now</dt>
                            <dd>
                              <b>{deposit} deposit.</b> You get it back when the piece sells. If nobody bids, miya keeps
                              it and the piece is not minted.
                            </dd>
                          </>
                        )}
                        {form.type === 'editions' && (
                          <>
                            <dt>Sale opens</dt>
                            <dd>{form.editionStart ? whenWords(form.editionStart) : 'Right away'}</dd>
                          </>
                        )}
                        <dt>Network</dt>
                        <dd>{net.chain.name}</dd>
                        <dt>Vault</dt>
                        <dd>
                          {vaultName ? `Buys ${vaultName}` : 'Community vault'}{' '}
                          <span className="mono">{short(vaultAddr)}</span>
                        </dd>
                      </Summary>
                      <Well style={{ padding: space[3] }}>
                        <SplitMeter
                          protocolBps={rules.protocolFeeBps}
                          alignmentBps={alignmentBps}
                          vaultName={vaultName}
                        />
                      </Well>
                      <div>
                        <Eyebrow style={{ marginBottom: space[2] }}>
                          {nextStepsWords({
                            uploads: toStore.length,
                            paying: toStore.some((f) => f.size > FREE_BYTES),
                            txs: plan.length,
                          })}
                        </Eyebrow>
                        <Well style={{ padding: space[2] }}>
                          <TxSteps steps={pipeline} label="Launch progress" />
                        </Well>
                        {storage.state !== 'none' && (
                          <small style={{ display: 'block', marginTop: space[1], fontSize: text.xs }}>
                            {storageWords(storage)}
                          </small>
                        )}
                      </div>
                      {ready && launch.check.state === 'checking' && (
                        <StatusBox tone="info" role="status">
                          <img src={LoadingHourglass} alt="" />
                          <span>Checking everything with the contract first…</span>
                        </StatusBox>
                      )}
                      {ready && launch.check.state === 'ok' && !launch.running && !launch.error && (
                        <StatusBox tone="ok" role="status">
                          <span>Checked: the contract accepts these settings.</span>
                        </StatusBox>
                      )}
                      {ready && launch.check.state === 'error' && (
                        <StatusBox tone="error" role="alert">
                          <span>{launch.check.message}</span>
                        </StatusBox>
                      )}
                      {launch.running && (
                        <StatusBox tone="info" role="status">
                          <img src={LoadingHourglass} alt="" />
                          <span>
                            {launch.note || 'Confirm in your wallet, then wait for the network.'} Keep this window open.
                          </span>
                        </StatusBox>
                      )}
                      {launch.error && !launch.running && (
                        <StatusBox tone="error" role="alert">
                          <span>
                            {launch.error}
                            {launch.instance ? ' Your collection exists; press Retry to finish the last step.' : ''}
                          </span>
                        </StatusBox>
                      )}
                    </>
                  )}
                </Panel>
                {!narrow && (
                  <Preview
                    form={form}
                    imageUrl={imageUrl}
                    protocolBps={rules.protocolFeeBps}
                    alignmentBps={undefined}
                    vaultName={vaultName}
                  />
                )}
              </Body>

              <Foot>
                {stepIdx > 0 && (
                  <BigButton
                    type="button"
                    className="secondary back"
                    style={{ width: 'auto' }}
                    disabled={launch.running}
                    onClick={() => setStepIdx((i) => i - 1)}
                  >
                    Back
                  </BigButton>
                )}
                <BigButton
                  type="button"
                  className="primary"
                  disabled={!!primary.disabled}
                  // Looks not ready until the step is filled in, and a press says what's missing.
                  style={step !== 'review' && !stepOk ? { opacity: 0.55 } : undefined}
                  onClick={primary.onClick}
                >
                  {primary.label}
                </BigButton>
              </Foot>
            </>
          )}
        </Inner>
      </Layout>
    </WindowWrapper>
  )
}

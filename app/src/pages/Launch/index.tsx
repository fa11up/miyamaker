import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import styled from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import { SmallButton, SplitMeter, TxSteps } from '@/components/LaunchKit'
import { BigButton, Chip, DisplayTitle, Eyebrow, Panel, StatusBox, Well } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import Pages from '@/constants/pages'
import type { LaunchForm, StepKey } from '@/miyamints/launch'
import {
  AUCTION_TIME_BUFFER_SECONDS,
  EMPTY_FORM,
  parseAlignmentPct,
  parseRoyaltyPct,
  parseVault,
  STEP_ORDER,
  txPlan,
  validateStep,
} from '@/miyamints/launch'
import { pctLabel } from '@/miyamints/split'
import { useLaunchChain, useRegistryRules, useVaultInfo } from '@/miyamints/useMiyamints'
import { useOpenManage } from '@/miyamints/useOpenManage'
import { validateAudioFile, validateImageFile } from '@/music/audio'
import { readAudioDuration } from '@/music/readDuration'
import { useOpenApp } from '@/music/useOpenApp'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import { bevel, color, font, space, text } from '@/theme/tokens'
import { resolveUri } from '@/utils/resolveUri'

import Preview, { priceLine, supplyLine, TYPE_LABEL } from './Preview'
import type { Pick } from './Steps'
import { AlignStep, ArtStep, SaleStep, TypeStep } from './Steps'
import { useLaunch } from './useLaunch'

const STEP_LABEL: Record<StepKey, string> = {
  type: 'Type',
  art: 'Artwork',
  sale: 'Price & supply',
  align: 'Community',
  review: 'Review',
}

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
  max-width: 1100px;
  margin: 0 auto;
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
  gap: 2px;
  li button {
    width: 100%;
    min-height: 36px;
    border: none;
    border-radius: 0;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    color: ${color.ink};
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
    color: ${color.shadow};
    cursor: default;
  }
  li button[aria-current='step'] {
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    font-weight: 700;
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    font-variant-numeric: tabular-nums;
  }
  [aria-current='step'] .n {
    background: ${color.accent};
    color: ${color.ink};
    box-shadow: none;
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
  margin: 0 -${space[3]} -${space[3]};
  padding: ${space[2]} ${space[3]} ${space[3]};
  background: ${color.face};
  box-shadow: inset 0 1px ${color.shadow}, inset 0 2px ${color.highlight};
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
  const openApp = useOpenApp()
  const openManage = useOpenManage()

  const net = useLaunchChain()
  const rules = useRegistryRules(net.chainId, net.addresses.registry)
  const launch = useLaunch()

  const [form, setForm] = useState<LaunchForm>(EMPTY_FORM)
  const [stepIdx, setStepIdx] = useState(0)
  const [shown, setShown] = useState<Partial<Record<StepKey, boolean>>>({})
  const [image, setImage] = useState<Pick>()
  const [audio, setAudio] = useState<Pick>()

  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (k === 'imageUri' || k === 'imageMode') launch.invalidate('image')
    if (k === 'audioUri' || k === 'audioMode') launch.invalidate('audio')
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
    if (!stepOk) return
    setStepIdx((i) => Math.min(i + 1, STEP_ORDER.length - 1))
  }

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
            ? { uri: form.audioUri.trim() }
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
    if (launch.instance && !launch.result) return { label: 'Retry the last step', onClick: create }
    if (form.type === 'auction')
      return { label: 'Create auction', onClick: create, disabled: launch.check.state === 'error' }
    if (form.type === 'editions')
      return { label: 'Create edition', onClick: create, disabled: launch.check.state === 'error' }
    return { label: 'Create collection', onClick: create, disabled: launch.check.state === 'error' }
  })()

  const plan = form.type ? txPlan(form.type) : []
  const needsAudio = form.type === 'editions' && form.editionKind === 'music'
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

  const statusChip = net.deployed ? (
    <Chip tone="ok">Live on {net.chain.name}</Chip>
  ) : (
    <Chip tone="warn">Opens soon</Chip>
  )

  const success = launch.result
  const royalty = parseRoyaltyPct(form.royaltyPct)

  return (
    <WindowWrapper>
      <TitleBar
        closeBtn
        onClose={(e) => {
          if (e.cancelable) e.stopPropagation()
          dispatch(closeWindow({ value: 'launch' }))
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
      <Layout ref={layoutRef} className={narrow ? 'narrow' : undefined} data-launch>
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
              <span>
                Launching opens soon. You can try every step now and see how collectors will see your work, but you
                cannot publish yet. The Create button turns on when launch opens.
              </span>
            </StatusBox>
          )}
          {net.wrongChain && (
            <StatusBox tone="error" role="alert">
              <span>Your wallet is on a network miya does not support. Switch to Ethereum.</span>
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
                <BigButton
                  type="button"
                  onClick={() =>
                    openManage({ chainId: success.chainId, address: success.instance, kind: success.type })
                  }
                >
                  Open in Manage
                </BigButton>
                <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
                  <SmallButton type="button" onClick={() => openApp('mint')}>
                    Open in Mint
                  </SmallButton>
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
                            <dt>Sale</dt>
                            <dd>
                              {form.phases.length} phase{form.phases.length > 1 ? 's' : ''}, first starts{' '}
                              {form.phases[0]?.start ? new Date(form.phases[0].start).toLocaleString() : 'right away'}
                            </dd>
                            <dt>Resale royalty</dt>
                            <dd>{royalty.ok ? pctLabel(royalty.bps) : '—'}</dd>
                          </>
                        )}
                        {form.type === 'auction' && (
                          <>
                            <dt>Length</dt>
                            <dd>
                              {form.durationHours} hours, late bids add {AUCTION_TIME_BUFFER_SECONDS / 60} minutes
                            </dd>
                          </>
                        )}
                        <dt>Network</dt>
                        <dd>{net.chain.name}</dd>
                        <dt>Vault</dt>
                        <dd>
                          {vaultName ? `Buys ${vaultName}` : 'Alignment vault'}{' '}
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
                          What happens next: {plan.length} wallet {plan.length > 1 ? 'prompts' : 'prompt'}
                          {form.imageMode === 'upload' ? ' + 1 upload' : ''}
                        </Eyebrow>
                        <Well style={{ padding: space[2] }}>
                          <TxSteps steps={pipeline} label="Launch progress" />
                        </Well>
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
                          <span>Confirm in your wallet, then wait for the network. Keep this window open.</span>
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
                <BigButton
                  type="button"
                  className="secondary back"
                  style={{ width: 'auto' }}
                  disabled={stepIdx === 0 || launch.running}
                  onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                >
                  Back
                </BigButton>
                <BigButton type="button" className="primary" disabled={!!primary.disabled} onClick={primary.onClick}>
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

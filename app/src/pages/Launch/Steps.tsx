import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import styled from 'styled-components/macro'

import ComputerIcon from '@/assets/computer.png'
import EditionsIcon from '@/assets/filepack-0.png'
import AuctionIcon from '@/assets/icon/auction.png'
import {
  DropWords,
  DropZone,
  Err,
  Field,
  Row2,
  Segmented,
  SmallButton,
  SplitMeter,
  Thumb,
} from '@/components/LaunchKit'
import MyUploads from '@/components/MyUploads'
import { Eyebrow, Well } from '@/components/Retro'
import type { FieldErrors, LaunchForm, LaunchType, PhaseForm } from '@/miyamints/launch'
import { EMPTY_PHASE, MAX_PHASES, parseAlignmentPct, phaseFieldsBad } from '@/miyamints/launch'
import { pctLabel } from '@/miyamints/split'
import type { PayToken } from '@/miyamints/tokens'
import { buildPrices, ETH, MAX_TOKENS, sameToken } from '@/miyamints/tokens'
import type { FileCheck } from '@/music/audio'
import { AUDIO_ACCEPT, formatDuration, IMAGE_ACCEPT } from '@/music/audio'
import { bevel, color, space, text } from '@/theme/tokens'
import { formatBytes } from '@/utils/formatBytes'

export type Pick = { file: File; check: FileCheck; url: string; duration?: number }

export type StepProps = {
  form: LaunchForm
  set: <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => void
  errors: FieldErrors
}

const Lead = styled.p`
  margin: 0;
  font-size: ${text.sm};
  line-height: 1.45;
  color: ${color.ink};
  max-width: 62ch;
`

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
`

/** The same room for a file however it is added, so switching between the three moves nothing below. */
const MediaSlot = styled.div`
  min-height: 152px;
  ${DropZone} {
    min-height: 130px;
    box-sizing: border-box;
  }
`

// ── 1. type ──────────────────────────────────────────────────────────────────

export const TypeCard = styled.button`
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: ${space[3]};
  align-items: start;
  text-align: left;
  padding: ${space[3]};
  border: none;
  border-radius: 0;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  cursor: pointer;
  font: inherit;
  img {
    width: 40px;
    height: 40px;
    image-rendering: pixelated;
    border: none;
    margin: 0;
  }
  b {
    display: block;
    font-size: ${text.md};
    margin-bottom: 2px;
  }
  span {
    font-size: ${text.sm};
    color: ${color.inkMuted};
    line-height: 1.4;
  }
  &:hover {
    background: ${color.faceLight};
  }
  &[aria-checked='true'] {
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    outline: 2px solid ${color.accent};
    outline-offset: -2px;
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
`

const TYPES: { id: LaunchType; title: string; body: string; icon: string }[] = [
  {
    id: 'drop',
    title: 'Fixed-price drop',
    body: 'Many pieces, one price. Example: 1,000 pictures at 0.01 ETH each.',
    icon: ComputerIcon,
  },
  {
    id: 'auction',
    title: 'Auction',
    body: 'One piece. People bid for a set time and the highest bid wins.',
    icon: AuctionIcon,
  },
  {
    id: 'editions',
    title: 'Editions',
    body: 'Copies of one artwork or song. Anyone can buy a copy at your price.',
    icon: EditionsIcon,
  },
]

export function TypeStep({ form, set, errors }: StepProps) {
  return (
    <Stack>
      <Lead>What do you want to sell? You can change this until you create it.</Lead>
      <div role="radiogroup" aria-label="Kind of collection" style={{ display: 'grid', gap: space[2] }}>
        {TYPES.map((t) => (
          <TypeCard
            key={t.id}
            type="button"
            role="radio"
            aria-checked={form.type === t.id}
            onClick={() => set('type', t.id)}
          >
            <img src={t.icon} alt="" />
            <div>
              <b>{t.title}</b>
              <span>{t.body}</span>
            </div>
          </TypeCard>
        ))}
      </div>
      {form.type === 'editions' && (
        <Field as="div">
          What is it?
          <Segmented role="group" aria-label="What the edition is">
            <SmallButton
              type="button"
              aria-pressed={form.editionKind === 'art'}
              onClick={() => set('editionKind', 'art')}
            >
              Artwork
            </SmallButton>
            <SmallButton
              type="button"
              aria-pressed={form.editionKind === 'music'}
              onClick={() => set('editionKind', 'music')}
            >
              Music track
            </SmallButton>
          </Segmented>
          <small>Music tracks play in miya radio and show up under Mint, Music.</small>
        </Field>
      )}
      <Err>{errors.type}</Err>
    </Stack>
  )
}

// ── 2. artwork & details ─────────────────────────────────────────────────────

function FilePick({
  label,
  accept,
  pick,
  onPick,
  hint,
  error,
  kind,
}: {
  label: string
  accept: string
  pick?: Pick
  onPick: (f: File | undefined) => void
  hint: string
  error?: string
  kind: 'image' | 'audio'
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <Field as="div">
      {label}
      <DropZone
        $over={over}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onPick(e.dataTransfer.files[0])
        }}
      >
        {kind === 'image' && <Thumb>{pick?.check.ok && <img src={pick.url} alt="Your artwork" />}</Thumb>}
        <div className="grow">
          {pick ? (
            <>
              {pick.file.name}
              <small>
                {formatBytes(pick.file.size)}
                {pick.duration ? ` · ${formatDuration(pick.duration)}` : ''}
              </small>
            </>
          ) : (
            <>
              <DropWords mouse="Drop a file here" touch="Choose a file" />
              <small>{hint}</small>
            </>
          )}
        </div>
        <SmallButton type="button" onClick={() => ref.current?.click()}>
          {pick ? 'Change' : 'Choose file'}
        </SmallButton>
        <input
          ref={ref}
          type="file"
          accept={accept}
          hidden
          aria-label={label}
          onChange={(e) => {
            onPick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </DropZone>
      <Err>{error}</Err>
    </Field>
  )
}

export function ArtStep({
  form,
  set,
  errors,
  image,
  audio,
  onImage,
  onAudio,
  requiredDone,
}: StepProps & {
  image?: Pick
  audio?: Pick
  onImage: (f?: File) => void
  onAudio: (f?: File) => void
  /** The name, ticker and art are in: the optional boxes can come out. */
  requiredDone: boolean
}) {
  const music = form.type === 'editions' && form.editionKind === 'music'
  const input = (k: keyof LaunchForm) => ({
    value: form[k] as string,
    'aria-invalid': !!errors[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  })
  return (
    <Stack>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: space[2],
          flexWrap: 'wrap',
        }}
      >
        <Lead>Add your art and say what it is.</Lead>
        <Segmented role="group" aria-label="How to add files">
          <SmallButton
            type="button"
            aria-pressed={form.imageMode === 'upload'}
            onClick={() => {
              set('fromUploads', false)
              set('imageMode', 'upload')
              set('audioMode', 'upload')
            }}
          >
            Upload a file
          </SmallButton>
          <SmallButton
            type="button"
            aria-pressed={form.fromUploads}
            onClick={() => {
              set('fromUploads', true)
              set('imageMode', 'link')
              set('audioMode', 'link')
            }}
          >
            Your uploads
          </SmallButton>
          <SmallButton
            type="button"
            aria-pressed={form.imageMode === 'link' && !form.fromUploads}
            onClick={() => {
              set('fromUploads', false)
              set('imageMode', 'link')
              set('audioMode', 'link')
            }}
          >
            Paste a link
          </SmallButton>
        </Segmented>
      </div>

      <MediaSlot>
        {form.fromUploads ? (
          <div>
            Artwork
            <MyUploads kind="image" value={form.imageUri} onPick={({ uri }) => set('imageUri', uri)} />
            <Err>{errors.image}</Err>
          </div>
        ) : form.imageMode === 'upload' ? (
          <FilePick
            kind="image"
            label="Artwork"
            accept={IMAGE_ACCEPT}
            pick={image}
            onPick={onImage}
            hint="PNG, JPG, GIF or WebP, up to 10 MB. Stored for good on Arweave."
            error={errors.image}
          />
        ) : (
          <Field>
            Artwork link
            <input {...input('imageUri')} placeholder="ipfs://… or ar://… or https://…" inputMode="url" />
            <small>A link that starts with ipfs://, ar:// or https://.</small>
            <Err>{errors.image}</Err>
          </Field>
        )}
      </MediaSlot>

      {music && (
        <MediaSlot>
          {form.fromUploads ? (
            <div>
              Track
              <MyUploads
                kind="audio"
                value={form.audioUri}
                onPick={({ uri, mime }) => {
                  set('audioUri', uri)
                  set('audioMime', mime || '')
                }}
              />
              <Err>{errors.audio}</Err>
            </div>
          ) : form.audioMode === 'upload' ? (
            <FilePick
              kind="audio"
              label="Track"
              accept={AUDIO_ACCEPT}
              pick={audio}
              onPick={onAudio}
              hint="MP3, WAV, OGG, FLAC or M4A, up to 50 MB."
              error={errors.audio}
            />
          ) : (
            <Field>
              Track link
              <input {...input('audioUri')} placeholder="ar://… or ipfs://…" inputMode="url" />
              <Err>{errors.audio}</Err>
            </Field>
          )}
        </MediaSlot>
      )}

      <Row2>
        <Field>
          {form.type === 'editions' ? 'Title' : 'Collection name'}
          <input {...input('name')} maxLength={64} placeholder={music ? 'Night Tone' : 'Miya Friends'} />
          <Err>{errors.name}</Err>
        </Field>
        {form.type !== 'editions' ? (
          <Field>
            Ticker
            <input
              {...input('symbol')}
              maxLength={10}
              placeholder="MIYA"
              style={{ textTransform: 'uppercase' }}
              autoCapitalize="characters"
            />
            <small>A short code wallets show next to the name.</small>
            <Err>{errors.symbol}</Err>
          </Field>
        ) : music ? (
          <Field>
            Artist
            <input {...input('artist')} maxLength={100} placeholder="Your artist name" />
            <Err>{errors.artist}</Err>
          </Field>
        ) : (
          <span />
        )}
      </Row2>
      {(requiredDone || form.description || form.website) && (
        <>
          <Field>
            Description (optional)
            <textarea {...input('description')} maxLength={1000} placeholder="What is this? Who made it?" />
            <Err>{errors.description}</Err>
          </Field>
          <Field>
            Website (optional)
            <input {...input('website')} placeholder="https://…" inputMode="url" />
            <Err>{errors.website}</Err>
          </Field>
        </>
      )}
    </Stack>
  )
}

// ── 3. price, supply, schedule ───────────────────────────────────────────────

export const PhaseBox = styled.fieldset`
  border: none;
  margin: 0;
  padding: ${space[3]};
  background: ${color.faceLight};
  box-shadow: ${bevel.sunken};
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  legend {
    float: left;
    width: 100%;
    padding: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: ${text.sm};
    font-weight: 700;
  }
`

const DURATIONS = [
  ['1', '1 hour'],
  ['6', '6 hours'],
  ['12', '12 hours'],
  ['24', '1 day'],
  ['48', '2 days'],
  ['72', '3 days'],
  ['168', '1 week'],
] as const

/**
 * Which tokens buyers can pay with (drops and editions). ETH is chosen to start; at least one stays chosen. Shown only
 * where there is more than one token to offer.
 */
function TokenChooser({
  tokens,
  chosen,
  onChange,
  error,
}: {
  tokens: readonly PayToken[]
  chosen: readonly string[]
  onChange: (next: string[]) => void
  error?: string
}) {
  if (tokens.length < 2) return null
  const on = (t: PayToken) => chosen.some((c) => sameToken(c, t.address))
  const toggle = (t: PayToken) => {
    const next = on(t) ? chosen.filter((c) => !sameToken(c, t.address)) : [...chosen, t.address.toLowerCase()]
    if (next.length && next.length <= MAX_TOKENS) onChange(next)
  }
  return (
    <Field as="div">
      <span>Buyers can pay with</span>
      <Segmented role="group" aria-label="Tokens buyers can pay with">
        {tokens.map((t) => (
          <SmallButton key={t.address} type="button" aria-pressed={on(t)} onClick={() => toggle(t)}>
            {t.symbol}
          </SmallButton>
        ))}
      </Segmented>
      <small>
        Set a price in each token you pick. You collect each token exactly as paid: nothing is converted, and there
        are no exchange rates.
      </small>
      <Err>{error}</Err>
    </Field>
  )
}

/** The accepted tokens, in the order offered. */
const acceptedOf = (form: LaunchForm, tokens: readonly PayToken[]) =>
  tokens.filter((t) => form.tokens.some((c) => sameToken(c, t.address)))

export function SaleStep({
  form,
  set,
  errors,
  tokens: offered,
  note,
}: StepProps & {
  tokens: readonly PayToken[]
  /** Something changed in the draft on its own (a token miya dropped was taken off): said at the top. */
  note?: string
}) {
  const [pickingFolder, setPickingFolder] = useState(false)
  const input = (k: keyof LaunchForm) => ({
    value: form[k] as string,
    'aria-invalid': !!errors[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  })
  const setPhase = (i: number, k: Exclude<keyof PhaseForm, 'prices'>, v: string) =>
    set(
      'phases',
      form.phases.map((p, n) => (n === i ? { ...p, [k]: v } : p)),
    )
  const setPhasePrice = (i: number, token: string, v: string) =>
    set(
      'phases',
      form.phases.map((p, n) => (n === i ? { ...p, prices: { ...p.prices, [token]: v } } : p)),
    )
  const accepted = acceptedOf(form, offered)
  const noted = note ? (
    <Well role="status" style={{ padding: space[2] }}>
      <small>{note}</small>
    </Well>
  ) : null
  const chooser = (
    <TokenChooser
      tokens={offered}
      chosen={form.tokens}
      onChange={(next) => set('tokens', next)}
      error={errors.tokens}
    />
  )

  if (form.type === 'auction') {
    const cur = offered.find((t) => sameToken(t.address, form.currency || ETH)) || offered[0]
    const sym = cur?.symbol || 'ETH'
    return (
      <Stack>
        <Lead>Set how the bidding works. The auction starts as soon as you create it.</Lead>
        {noted}
        {offered.length > 1 && (
          <Field>
            Bids are in
            <select
              value={(cur?.address || ETH).toLowerCase()}
              aria-invalid={!!errors.currency}
              onChange={(e) => {
                set('currency', e.target.value)
                // The ETH-sized default step means nothing in another token: ask for one.
                if (form.bidStep === '0.01' && e.target.value !== ETH) set('bidStep', '')
              }}
            >
              {offered.map((t) => (
                <option key={t.address} value={t.address.toLowerCase()}>
                  {t.symbol}
                </option>
              ))}
            </select>
            <small>
              One token for this auction house: the deposit, every bid and every refund are in it, and you are paid in it.
              It can&apos;t change later.
            </small>
            <Err>{errors.currency}</Err>
          </Field>
        )}
        <Row2>
          <Field>
            Starting bid ({sym})
            <input {...input('reserve')} inputMode="decimal" placeholder={sym === 'ETH' ? '0.1' : '100'} />
            <small>
              You pay this now as a deposit. You get it back when the piece sells. If nobody bids, miya keeps the
              deposit.
            </small>
            <Err>{errors.reserve}</Err>
          </Field>
          <Field>
            Auction length
            <select {...input('durationHours')}>
              {DURATIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <small>A bid in the last 5 minutes moves the end to 5 minutes after that bid.</small>
            <Err>{errors.durationHours}</Err>
          </Field>
        </Row2>
        <Field>
          Bid step ({sym})
          <input {...input('bidStep')} inputMode="decimal" placeholder={sym === 'ETH' ? '0.01' : '10'} />
          <small>Each new bid must beat the last one by at least this much.</small>
          <Err>{errors.bidStep}</Err>
        </Field>
      </Stack>
    )
  }

  if (form.type === 'editions') {
    const priced = buildPrices(form.editionPrices, accepted, { required: true, allowZero: false }).ok
    return (
      <Stack>
        <Lead>Set the price and how many copies can be bought.</Lead>
        {noted}
        {chooser}
        <Row2>
          {accepted.map((t) => (
            <Field key={t.address}>
              Price per copy ({t.symbol})
              <input
                value={form.editionPrices[t.address.toLowerCase()] || ''}
                inputMode="decimal"
                placeholder={t.symbol === 'ETH' ? '0.005' : t.decimals <= 8 && t.symbol.includes('BTC') ? '0.0002' : '10'}
                aria-invalid={!!errors.editionPrices}
                onChange={(e) => set('editionPrices', { ...form.editionPrices, [t.address.toLowerCase()]: e.target.value })}
              />
            </Field>
          ))}
          <Field>
            Number of copies
            <input {...input('editionSupply')} inputMode="numeric" placeholder="No limit" />
            <small>Leave empty for an open edition: no limit.</small>
            <Err>{errors.editionSupply}</Err>
          </Field>
        </Row2>
        <Err>{errors.editionPrices}</Err>
        {(priced || form.editionStart) && (
          <Field>
            Sale opens (optional)
            <input type="datetime-local" {...input('editionStart')} />
            <small>Leave empty to open as soon as you create it.</small>
            <Err>{errors.editionStart}</Err>
          </Field>
        )}
      </Stack>
    )
  }

  return (
    <Stack>
      <Lead>Set how many pieces there are, the price and when the sale runs.</Lead>
        {noted}
      {chooser}
      <Row2>
        <Field>
          Number of pieces
          <input {...input('supply')} inputMode="numeric" placeholder="1000" />
          <Err>{errors.supply}</Err>
        </Field>
        <Field>
          Pieces kept back
          <input {...input('ownerReserve')} inputMode="numeric" placeholder="None" />
          <small>
            Yours to give away for free. Buyers can&apos;t mint them, and this can&apos;t change after launch.
          </small>
          <Err>{errors.ownerReserve}</Err>
        </Field>
        <Field>
          Royalty on resales (%)
          <input {...input('royaltyPct')} inputMode="decimal" placeholder="5" />
          <small>Your cut when a piece is resold. 0 to 10.</small>
          <Err>{errors.royaltyPct}</Err>
        </Field>
      </Row2>
      {form.phases.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <PhaseBox key={i}>
          <legend>
            <span>{form.phases.length > 1 ? `Sale phase ${i + 1}` : 'Sale'}</span>
            {form.phases.length > 1 && (
              <SmallButton
                type="button"
                onClick={() =>
                  set(
                    'phases',
                    form.phases.filter((_, n) => n !== i),
                  )
                }
              >
                Remove
              </SmallButton>
            )}
          </legend>
          <Row2>
            {accepted.map((t) => (
              <Field key={t.address}>
                Price ({t.symbol})
                <input
                  value={p.prices[t.address.toLowerCase()] || ''}
                  aria-invalid={!!errors.phases && !!phaseFieldsBad(p, accepted).prices[t.address.toLowerCase()]}
                  inputMode="decimal"
                  placeholder={accepted.length > 1 ? 'Not sold in this token' : '0.01'}
                  onChange={(e) => setPhasePrice(i, t.address.toLowerCase(), e.target.value)}
                />
                <small>
                  {accepted.length > 1 ? 'Type 0 for free. Empty: this phase does not take it.' : 'Type 0 for a free mint.'}
                </small>
              </Field>
            ))}
            <Field>
              Limit per wallet
              <input
                value={p.maxPerWallet}
                aria-invalid={!!errors.phases && !!phaseFieldsBad(p, accepted).maxPerWallet}
                inputMode="numeric"
                placeholder="No limit"
                onChange={(e) => setPhase(i, 'maxPerWallet', e.target.value)}
              />
            </Field>
            <Field>
              Pieces for sale
              <input
                value={p.supplyCap}
                aria-invalid={!!errors.phases && !!phaseFieldsBad(p, accepted).supplyCap}
                inputMode="numeric"
                placeholder="No limit"
                onChange={(e) => setPhase(i, 'supplyCap', e.target.value)}
              />
              <small>The most this phase can sell.</small>
            </Field>
          </Row2>
          <Row2>
            <Field>
              Starts
              <input
                type="datetime-local"
                value={p.start}
                aria-invalid={!!errors.phases && !!phaseFieldsBad(p, accepted).start}
                onChange={(e) => setPhase(i, 'start', e.target.value)}
              />
              <small>Empty: right away.</small>
            </Field>
            <Field>
              Ends
              <input
                type="datetime-local"
                value={p.end}
                aria-invalid={!!errors.phases && !!phaseFieldsBad(p, accepted).end}
                onChange={(e) => setPhase(i, 'end', e.target.value)}
              />
              <small>Empty: runs until sold out.</small>
            </Field>
          </Row2>
        </PhaseBox>
      ))}
      <Err>{errors.phases}</Err>
      {form.phases.length < MAX_PHASES && (form.phases.length > 1 || Object.values(form.phases[0]?.prices || {}).some((v) => !!v.trim())) && (
        <div>
          <SmallButton type="button" onClick={() => set('phases', [...form.phases, { ...EMPTY_PHASE }])}>
            + Add a phase (for example an early price)
          </SmallButton>
        </div>
      )}
      <details>
        <summary style={{ cursor: 'pointer', fontSize: text.sm }}>Already have a metadata folder?</summary>
        <Field style={{ marginTop: space[2] }}>
          Metadata folder link (optional)
          <input {...input('revealUri')} placeholder="ipfs://…/" inputMode="url" />
          <small>
            Piece 1 reads &lt;link&gt;/1, piece 2 reads &lt;link&gt;/2. Until you add one, every piece shows your
            artwork. You can add it later in Manager.
          </small>
          <Err>{errors.revealUri}</Err>
        </Field>
        <div style={{ marginTop: space[2] }}>
          <SmallButton type="button" aria-expanded={pickingFolder} onClick={() => setPickingFolder((o) => !o)}>
            Choose from your folders
          </SmallButton>
          {pickingFolder && (
            <MyUploads kind="folder" value={form.revealUri} onPick={({ uri }) => set('revealUri', uri)} />
          )}
        </div>
      </details>
    </Stack>
  )
}

// ── 4. alignment ─────────────────────────────────────────────────────────────

export const VaultCard = styled.button`
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: ${space[3]};
  border: none;
  border-radius: 0;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  color: ${color.ink};
  font: inherit;
  cursor: pointer;
  b {
    font-size: ${text.md};
  }
  span {
    font-size: ${text.sm};
    color: ${color.inkMuted};
  }
  &[aria-checked='true'] {
    background: ${color.well};
    box-shadow: ${bevel.sunken};
    outline: 2px solid ${color.accent};
    outline-offset: -2px;
  }
`

const Slider = styled.input`
  width: 100%;
  accent-color: ${color.accent};
  height: 28px;
`

/** The vault share input, slider and split: only once the registry's rules are known. */
function SharePicker({
  form,
  set,
  errors,
  minAlignmentBps,
  protocolFeeBps,
  vaultName,
}: StepProps & { minAlignmentBps: number; protocolFeeBps: number; vaultName?: string }) {
  const align = parseAlignmentPct(form.alignmentPct, minAlignmentBps, protocolFeeBps)
  const maxPct = Math.floor((10_000 - protocolFeeBps) / 100)
  return (
    <Well style={{ padding: space[3], display: 'flex', flexDirection: 'column', gap: space[3] }}>
      <Field as="div">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] }}>
          <span>Share for the vault</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              aria-label="Share for the vault, in percent"
              value={form.alignmentPct}
              inputMode="decimal"
              aria-invalid={!!errors.alignmentPct}
              style={{ width: 72, textAlign: 'right' }}
              onChange={(e) => set('alignmentPct', e.target.value)}
            />
            %
          </span>
        </div>
        <Slider
          type="range"
          min={minAlignmentBps / 100}
          max={Math.min(50, maxPct)}
          step={0.5}
          value={align.ok ? align.bps / 100 : minAlignmentBps / 100}
          aria-label="Share for the vault"
          onChange={(e) => set('alignmentPct', e.target.value)}
        />
        <small>
          At least {pctLabel(minAlignmentBps)}. miya always keeps {pctLabel(protocolFeeBps)}. You keep the rest.
        </small>
        <Err>{errors.alignmentPct}</Err>
      </Field>
      <Eyebrow>Where the money goes</Eyebrow>
      <SplitMeter
        protocolBps={protocolFeeBps}
        alignmentBps={align.ok ? align.bps : minAlignmentBps}
        vaultName={vaultName}
      />
    </Well>
  )
}

export function AlignStep({
  form,
  set,
  errors,
  minAlignmentBps,
  protocolFeeBps,
  rulesFailed,
  defaultVault,
  customVault,
}: StepProps & {
  /** Undefined until the registry has been read. */
  minAlignmentBps?: number
  protocolFeeBps?: number
  rulesFailed?: boolean
  defaultVault: { label: string; symbol?: string; detail: ReactNode }
  customVault: { status: ReactNode }
}) {
  const vaultName = form.vaultChoice === 'default' ? defaultVault.symbol : undefined
  const rulesNote = rulesFailed
    ? "The minimum share and miya's fee couldn't be read from the network just now. Try again in a minute."
    : "Loading the minimum share and miya's fee…"
  return (
    <Stack>
      <Lead>
        Every sale is split three ways, in the token it was paid in: you, a community vault and miya.{' '}
        {minAlignmentBps !== undefined && protocolFeeBps !== undefined
          ? `At least ${minAlignmentBps / 100}% goes to the vault. `
          : ''}
        The default vault turns what it gets into INFER/IMD liquidity in one shared pool, in batches, and it stays
        there for good. The pool&apos;s trading fees are paid in INFER and IMD, and you can claim your part in Manager.
        {protocolFeeBps !== undefined && minAlignmentBps !== undefined ? ` miya keeps ${protocolFeeBps / 100}%.` : ''}
      </Lead>
      <small style={{ color: color.inkMuted }}>
        A vault cut below the vault&apos;s minimum is parked until the next sale, or until it is sent from Manager. ETH
        payouts arrive as WETH if your wallet can&apos;t take ETH.
      </small>
      <div role="radiogroup" aria-label="Community vault" style={{ display: 'grid', gap: space[2] }}>
        <VaultCard
          type="button"
          role="radio"
          aria-checked={form.vaultChoice === 'default'}
          onClick={() => set('vaultChoice', 'default')}
        >
          <b>{defaultVault.label}</b>
          <span>{defaultVault.detail}</span>
        </VaultCard>
        <VaultCard
          type="button"
          role="radio"
          aria-checked={form.vaultChoice === 'custom'}
          onClick={() => set('vaultChoice', 'custom')}
        >
          <b>Another vault</b>
          <span>Paste the address of a vault registered with miya.</span>
        </VaultCard>
      </div>
      {form.vaultChoice === 'custom' && (
        <Field>
          Vault address
          <input
            value={form.customVault}
            aria-invalid={!!errors.customVault}
            placeholder="0x…"
            onChange={(e) => set('customVault', e.target.value)}
            spellCheck={false}
          />
          <Err>{errors.customVault}</Err>
          {!errors.customVault && customVault.status}
        </Field>
      )}

      {minAlignmentBps === undefined || protocolFeeBps === undefined ? (
        <Well style={{ padding: space[3] }} role="status">
          <small>{rulesNote}</small>
        </Well>
      ) : (
        <SharePicker
          form={form}
          set={set}
          errors={errors}
          minAlignmentBps={minAlignmentBps}
          protocolFeeBps={protocolFeeBps}
          vaultName={vaultName}
        />
      )}
    </Stack>
  )
}

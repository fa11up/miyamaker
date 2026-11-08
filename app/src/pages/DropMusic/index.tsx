import { useConnectModal } from '@rainbow-me/rainbowkit'
import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled, { css, keyframes } from 'styled-components/macro'
import { useElementSize } from 'usehooks-ts'
import { formatEther } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import LoadingHourglass from '@/assets/loading_hourglass.gif'
import {
  CloseGuardBox,
  DropWords,
  DropZone as Drop,
  Err,
  Field,
  Row2,
  Segmented as Toggle,
  SmallButton,
  SplitMeter,
  STEP_DOT as DOT,
  Thumb as Cover,
  TxSteps,
  useCloseGuard,
} from '@/components/LaunchKit'
import { BigButton, Chip, Eyebrow, StatusBox, Well } from '@/components/Retro'
import TitleBar from '@/components/TitleBar'
import WindowWrapper from '@/components/WindowWrapper'
import { explorerUrl } from '@/config/wagmi'
import Pages from '@/constants/pages'
import { useRadio } from '@/context/RadioProvider'
import { burst } from '@/desktop/mints/confetti'
import { useReducedMotion } from '@/desktop/prefs'
import { pctLabel } from '@/miyamints/split'
import type { FileCheck } from '@/music/audio'
import {
  AUDIO_ACCEPT,
  AUDIO_TYPES,
  buildMusicMetadata,
  formatDuration,
  IMAGE_ACCEPT,
  MAX_AUDIO_BYTES,
  safeUri,
  validateAudioFile,
  validateImageFile,
} from '@/music/audio'
import { refusedWords, storageWords, storedBytes } from '@/music/creatorWords'
import { parseAlignmentPct, parsePriceEth, parseSupply } from '@/music/drop'
import { readAudioDuration } from '@/music/readDuration'
import { useAppDispatch } from '@/store/hooks'
import { closeWindow, minimizeWindow } from '@/store/windows/actions'
import { useFullscreen } from '@/store/windows/hooks'
import type { PageKey } from '@/store/windows/reducer'
import { bevel, color, font, space, text } from '@/theme/tokens'
import { formatBytes } from '@/utils/formatBytes'
import { FREE_BYTES } from '@/utils/fundAndUpload'
import { resolveUri } from '@/utils/resolveUri'
import { useStorageQuote } from '@/utils/useStorageQuote'

import StudioBoot from './Boot'
import ReleasePreview from './ReleasePreview'
import waterSkin from './skin/water.webp'
import type { StageStatus } from './Stage'
import Stage from './Stage'
import StationAdd from './StationAdd'
import type { ChainId } from './useDropMusic'
import { discardChoice, resumeWords } from '@/pages/Launch/resume'

import { STEPS, useDropMusic, useMusicChain } from './useDropMusic'
import { useStudioPlayer, useWaveformPeaks } from './useStudioPlayer'
import { brushedSilver, gel, y2k } from './y2k'

const pageId = 'dropmusic' as PageKey

const Layout = styled.div`
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  /* Fields come out as a step fills in: the scrollbar arriving must not nudge the page sideways. */
  scrollbar-gutter: stable;
  color: ${y2k.ink};
  background: #125cc4 url(${waterSkin}) 0 0 / 512px 512px;

  /* Everything in the session panel: pills and soft-edged wells instead of the OS's square bevels. */
  section button:not([role='tab']) {
    ${gel('#f4f7fd', '#b7c4dc', y2k.ink)}
    padding-left: 14px;
    padding-right: 14px;
  }
  section button:not([role='tab']):hover:not(:disabled) {
    ${gel('#d9f6ff', y2k.aqua, y2k.navy)}
  }
  section input:not([type='checkbox']):not([type='radio']),
  section textarea,
  section select {
    border: 1px solid ${y2k.silverLine};
    border-radius: 8px;
    box-shadow: inset 0 1px 3px rgba(11, 31, 92, 0.35);
  }
  section input[aria-invalid='true'],
  section textarea[aria-invalid='true'] {
    border-color: ${color.danger};
    box-shadow: inset 0 0 0 1px ${color.danger};
  }
  /* The chosen source looks chosen: the Y2K gel above would otherwise paint both the same. */
  section ${Toggle} button[aria-pressed='true'], section ${Toggle} button[aria-pressed='true']:hover:not(:disabled) {
    background: linear-gradient(#2f7fe0, #1450b0);
    color: #fff;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
  }
  && ${CloseGuardBox} {
    ${brushedSilver}
    border: 1px solid ${y2k.silverLine};
    border-radius: 14px;
    color: ${y2k.ink};
  }
  && ${CloseGuardBox} button {
    ${gel('#f4f7fd', '#b7c4dc', y2k.ink)}
    padding-left: 14px;
    padding-right: 14px;
  }
  && ${CloseGuardBox} button.keep {
    ${gel('#7ecbff', y2k.blue, '#ffffff')}
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, transparent 45%),
      linear-gradient(180deg, #2f73ee 0%, #1548c8 100%);
    text-shadow: 0 1px 1px rgba(11, 31, 92, 0.7);
  }
`

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[3]};
  max-width: 920px;
  margin: 0 auto;
  .narrow & {
    padding: ${space[2]};
    gap: ${space[2]};
  }
  /* Big windows: the stage stays in view on the left while the session scrolls on the right. */
  .wide & {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(360px, 1fr);
    grid-template-areas: 'head head' 'stage session';
    align-items: start;
    max-width: 1320px;
    > header {
      grid-area: head;
    }
    > .stage {
      grid-area: stage;
      position: sticky;
      top: 0;
    }
    > section {
      grid-area: session;
    }
  }
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${space[2]};
  p {
    margin: 2px 0 0;
    font-size: ${text.sm};
    color: #fff;
    text-shadow: 0 1px 2px #04205c, 0 0 4px #04205c;
    max-width: 60ch;
  }
`

const ChromeTitle = styled.h1`
  position: relative;
  display: inline-block;
  margin: 0;
  padding-right: 8px;
  font-family: ${font.display};
  font-size: 40px;
  font-weight: 400;
  font-style: italic;
  line-height: 1.15;
  letter-spacing: 0.01em;
  background: linear-gradient(180deg, #ffffff 0%, #dfe8f7 36%, #5c74a8 49%, #ffffff 53%, #9fc4ff 72%, #2a6bff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 1px ${y2k.navy};
  filter: drop-shadow(0 2px 0 rgba(11, 31, 92, 0.35)) drop-shadow(0 0 8px rgba(39, 211, 255, 0.6));
  .narrow & {
    font-size: 28px;
  }
`

const Burst = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  margin-left: ${space[1]};
  vertical-align: middle;
  transform: rotate(-12deg);
  font-family: ${font.ui};
  font-size: 13px;
  font-weight: 700;
  color: ${y2k.navy};
  background: ${y2k.lime};
  clip-path: polygon(
    50% 0,
    61% 18%,
    82% 7%,
    80% 30%,
    100% 36%,
    85% 52%,
    98% 72%,
    75% 74%,
    72% 96%,
    53% 83%,
    33% 98%,
    28% 75%,
    5% 76%,
    16% 55%,
    0 38%,
    21% 30%,
    17% 7%,
    39% 17%
  );
  .narrow & {
    display: none;
  }
`

const Json = styled.pre`
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-family: ${font.mono};
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-all;
`

/* ── the session: four channel strips (tabs) and the panel they open ───── */

const Session = styled.section`
  ${brushedSilver}
  border: 1px solid ${y2k.silverLine};
  border-radius: 14px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 #ffffff, 0 3px 10px rgba(11, 31, 92, 0.35);
  display: flex;
  flex-direction: column;
  min-width: 0;
`

const TabRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${space[1]};
  padding: ${space[2]};
  background: linear-gradient(180deg, #5f7bc0 0%, ${y2k.navy} 100%);
`

const Tab = styled.button<{ $led: string }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 40px;
  padding: 4px ${space[2]};
  ${gel('#f4f7fd', '#b7c4dc', y2k.ink)}
  font-size: ${text.xs};
  text-align: left;
  cursor: pointer;
  .n {
    flex: 0 0 auto;
    min-width: 20px;
    padding: 1px 4px;
    text-align: center;
    font-family: ${font.mono};
    font-size: 12px;
    font-weight: 700;
    line-height: 16px;
    border-radius: 999px;
    color: ${y2k.lcdText};
    background: ${y2k.lcd};
    text-shadow: 0 0 4px rgba(182, 255, 60, 0.7);
  }
  .l {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .led {
    margin-left: auto;
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $led }) => $led};
    box-shadow: inset -1px -1px rgba(0, 0, 0, 0.35), 0 0 6px ${({ $led }) => $led};
  }
  &:hover {
    ${gel('#d9f6ff', y2k.aqua, y2k.navy)}
  }
  &[aria-selected='true'] {
    ${gel('#7ecbff', y2k.blue, '#ffffff')}
    /* White text needs a darker body than the usual gloss. */
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, transparent 45%),
      linear-gradient(180deg, #2f73ee 0%, #1548c8 100%);
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(11, 31, 92, 0.7);
    z-index: 1;
  }
  &:focus-visible {
    outline: 1px dotted ${color.dark};
    outline-offset: -5px;
  }
  .narrow & {
    flex-direction: column;
    gap: 2px;
    padding: 4px 2px;
    text-align: center;
    .l {
      font-size: 11px;
      white-space: normal;
      line-height: 1.1;
    }
    .led {
      position: absolute;
      top: 5px;
      right: 5px;
      margin: 0;
    }
  }
`

const slideFrom = (dx: number) => keyframes`
  from { opacity: 0; transform: translateX(${dx}px) scale(0.98); }
  to { opacity: 1; transform: none; }
`

const StepPanel = styled.div<{ $dir: number; $still: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[4]};
  min-width: 0;
  ${({ $dir, $still }) =>
    !$still &&
    css`
      animation: ${slideFrom($dir * 28)} 320ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
    `}
  .narrow & {
    padding: ${space[3]};
  }
`

const pulse = keyframes`
  0%, 100% { box-shadow: ${bevel.raised}, 0 0 0 0 rgba(217, 122, 218, 0.0); }
  50% { box-shadow: ${bevel.raised}, 0 0 0 3px rgba(217, 122, 218, 0.65); }
`

const Footer = styled.div<{ $still: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${space[2]};
  margin-top: ${space[1]};
  .next.ready {
    background: ${color.faceLight};
    font-weight: 700;
    ${({ $still }) =>
      !$still &&
      css`
        animation: ${pulse} 1.6s ease-in-out infinite;
      `}
  }
`

const Missing = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  li {
    display: flex;
    gap: ${space[2]};
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
`

type Form = {
  title: string
  artist: string
  description: string
  genre: string
  bpm: string
  collectionName: string
  price: string
  supply: string
  alignment: string
  audioUri: string
  coverUri: string
  linkFormat: string
}

const EMPTY: Form = {
  title: '',
  artist: '',
  description: '',
  genre: '',
  bpm: '',
  collectionName: '',
  price: '',
  supply: '',
  alignment: '',
  audioUri: '',
  coverUri: '',
  linkFormat: 'mp3',
}

type AudioPick = { file: File; check: FileCheck; duration?: number; url: string; reading?: boolean; error?: string }
type CoverPick = { file: File; check: FileCheck; url: string }

type Section = 'track' | 'credits' | 'edition' | 'release'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'track', label: 'Track' },
  { id: 'credits', label: 'Cover & credits' },
  { id: 'edition', label: 'Price & split' },
  { id: 'release', label: 'Release' },
]

export default function DropMusicWindow() {
  const dispatch = useAppDispatch()
  const [fullscreen, toggleFullscreen] = useFullscreen(pageId)
  const radio = useRadio()
  const { isConnected, chain } = useAccount()
  const { openConnectModal } = useConnectModal()
  const music = useMusicChain()
  const { switchChain } = useSwitchChain()
  const drop = useDropMusic()
  const reduced = useReducedMotion()

  const [form, setForm] = useState<Form>(EMPTY)
  const [mode, setMode] = useState<'upload' | 'links'>('upload')
  const [audio, setAudio] = useState<AudioPick>()
  const [cover, setCover] = useState<CoverPick>()
  const [linkDuration, setLinkDuration] = useState<number>()
  const [linkError, setLinkError] = useState('')
  const [over, setOver] = useState<'audio' | 'cover'>()
  const [touched, setTouched] = useState(false)
  const [section, setSection] = useState<Section>('track')
  const [dir, setDir] = useState(1)
  const audioInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const [boot, setBoot] = useState<'playing' | 'reveal' | 'done'>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'done' : 'playing'
  )
  const sessionRef = useRef<HTMLElement>(null)

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Putting a track on the station runs from the Release tab, which holds its progress: it stays until that's done.
  const [stationBusy, setStationBusy] = useState(false)
  const [stationDone, setStationDone] = useState<{ key?: string; words: string }>()
  const go = (next: Section) => {
    if (stationBusy) return
    const from = SECTIONS.findIndex((s) => s.id === section)
    const to = SECTIONS.findIndex((s) => s.id === next)
    setDir(to >= from ? 1 : -1)
    setSection(next)
    // Release greys out until the form is right, so arriving there is what brings up the list of what is missing.
    if (next === 'release' && music.ready) setTouched(true)
    // Coming from a long panel: bring the tabs back into view so the new step starts at its top.
    const el = sessionRef.current
    const box = el?.closest('[data-scroll]')
    if (el && box && el.getBoundingClientRect().top < box.getBoundingClientRect().top) {
      el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    }
  }

  useEffect(() => {
    const min = music.minAlignmentBps
    if (!form.alignment && min) setForm((f) => ({ ...f, alignment: String(min / 100) }))
  }, [music.minAlignmentBps])

  useEffect(() => () => cover && URL.revokeObjectURL(cover.url), [cover])

  // Track details changed after the metadata JSON was uploaded: rebuild it on the next attempt.
  useEffect(() => {
    if (drop.uploaded.metadata) drop.invalidate('metadata')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, form.artist, form.description, form.genre, form.bpm, form.linkFormat])

  // A different source means different files: what went up from the old one mustn't be released.
  const changeMode = (next: 'upload' | 'links') => {
    if (next === mode) return
    drop.invalidate('audio')
    drop.invalidate('cover')
    setMode(next)
  }

  const pickAudio = async (file: File | undefined) => {
    if (!file || drop.running || drop.committed || stationBusy) return
    drop.invalidate('audio')
    const check = validateAudioFile(file)
    const url = URL.createObjectURL(file)
    const pick: AudioPick = { file, check, url, reading: check.ok }
    setAudio(pick)
    // Its error lives on the Track tab, wherever the file was dropped from.
    if (!check.ok) go('track')
    if (!form.title) setForm((f) => ({ ...f, title: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) }))
    if (!check.ok) return
    try {
      const duration = await readAudioDuration(file)
      setAudio((a) => (a?.file === file ? { ...a, duration, reading: false } : a))
    } catch (e) {
      // The raw reason is for the console only: the screen gets plain words and what to do next.
      console.warn('DropMusic: could not read the audio file', e)
      setAudio((a) =>
        a?.file === file
          ? {
              ...a,
              reading: false,
              error: "Couldn't read that audio file. Try another file (MP3, WAV, FLAC, OGG or M4A).",
            }
          : a
      )
    }
  }

  const pickCover = (file: File | undefined) => {
    if (!file || drop.running || drop.committed || stationBusy) return
    drop.invalidate('cover')
    const check = validateImageFile(file)
    setCover({ file, check, url: URL.createObjectURL(file) })
    if (!check.ok) go('credits')
  }

  /** Files dropped on the stage: pictures dress the jewel case, anything else is treated as the track. */
  const dropOnStage = (file: File) => {
    if (stationBusy) return
    if (/^image\//.test(file.type)) {
      setMode('upload')
      pickCover(file)
    } else {
      setMode('upload')
      pickAudio(file)
    }
  }

  // Editing the link makes any read on its way about the old one.
  const linkRead = useRef(0)
  useEffect(() => {
    linkRead.current += 1
    setLinkError('')
    setLinkDuration(undefined)
  }, [form.audioUri])

  // Links mode: read the duration from the linked file (only allowed schemes, resolved via the gateway).
  const checkLink = async () => {
    linkRead.current += 1
    const ticket = linkRead.current
    const isCurrent = () => ticket === linkRead.current
    setLinkError('')
    setLinkDuration(undefined)
    const uri = safeUri(form.audioUri)
    if (!uri) {
      setLinkError('Use an ipfs://, ar:// or https:// link.')
      return
    }

    const el = new Audio()
    el.preload = 'metadata'
    el.src = resolveUri(uri)
    await new Promise<void>((done) => {
      const t = setTimeout(() => {
        if (isCurrent()) setLinkError('Timed out reading the link.')
        done()
      }, 15_000)
      el.onloadedmetadata = () => {
        clearTimeout(t)
        if (isCurrent()) {
          if (Number.isFinite(el.duration) && el.duration > 0) setLinkDuration(el.duration)
          else setLinkError('Could not read the track length.')
        }

        done()
      }

      el.onerror = () => {
        clearTimeout(t)
        if (isCurrent()) setLinkError('Could not load that audio link.')
        done()
      }
    })
    el.removeAttribute('src')
  }

  const mime =
    mode === 'upload'
      ? audio?.check.ok
        ? audio.check.mime
        : ''
      : (AUDIO_TYPES[form.linkFormat]?.[0] as string | undefined) || ''
  const duration = mode === 'upload' ? audio?.duration : linkDuration

  const meta = (audioRef: string, coverRef: string) =>
    buildMusicMetadata({
      title: form.title,
      artist: form.artist,
      description: form.description,
      genre: form.genre,
      bpm: form.bpm,
      image: coverRef,
      audio: audioRef,
      mime,
      duration: duration ?? NaN,
    })

  const preview = useMemo(
    () =>
      meta(
        drop.uploaded.audio || (mode === 'links' ? form.audioUri : 'ar://pending-audio-upload'),
        drop.uploaded.cover || (mode === 'links' ? form.coverUri : 'ar://pending-cover-upload')
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, mode, mime, duration, drop.uploaded]
  )

  const price = parsePriceEth(form.price)
  const supply = parseSupply(form.supply)
  // The share rules come from the registry. Until they are read, nothing about them is said as fact or sent.
  const minBps = music.minAlignmentBps
  const feeBps = music.protocolFeeBps
  const rulesKnown = minBps !== undefined && feeBps !== undefined
  const align: ReturnType<typeof parseAlignmentPct> = rulesKnown
    ? parseAlignmentPct(form.alignment, minBps, feeBps)
    : {
        ok: false,
        error: music.rulesFailed
          ? "Couldn't read the vault share rules from the network. Try again in a minute."
          : 'Loading the vault share rules…',
      }
  const metaErrors = preview.ok ? {} : preview.errors
  const audioError =
    mode === 'upload'
      ? !audio
        ? 'Add an audio file.'
        : !audio.check.ok
        ? audio.check.error
        : audio.error
        ? audio.error
        : ''
      : ''
  const coverError = mode === 'upload' ? (!cover ? 'Add cover art.' : !cover.check.ok ? cover.check.error : '') : ''
  const fileError = audioError || coverError
  const valid = preview.ok && price.ok && supply.ok && align.ok && !fileError && !(audio?.reading && mode === 'upload')
  const done = !!drop.launched.editionId
  const collectionName =
    form.collectionName.trim() ||
    [form.artist.trim(), form.title.trim()].filter(Boolean).join(' - ').slice(0, 120) ||
    form.title.trim()

  // What each part of the session still needs, in plain words. Drives the tab lights and the Release checklist.
  const linkOk = !!safeUri(form.audioUri) && !!linkDuration
  const trackNeeds =
    mode === 'upload'
      ? audioError || (audio?.reading ? 'Still reading the track length…' : '')
      : !safeUri(form.audioUri)
      ? 'Paste an ipfs://, ar:// or https:// audio link.'
      : !linkDuration
      ? linkError || 'Check the audio link (click outside the box to read it).'
      : ''
  const creditsNeeds =
    coverError ||
    (mode === 'links' && metaErrors.image) ||
    metaErrors.title ||
    metaErrors.artist ||
    metaErrors.bpm ||
    ''
  const editionNeeds = (!price.ok && price.error) || (!supply.ok && supply.error) || (!align.ok && align.error) || ''
  const needs: Record<Section, string> = {
    track: trackNeeds,
    credits: creditsNeeds,
    edition: editionNeeds,
    release: '',
  }
  const sectionDone: Record<Section, boolean> = {
    track: !trackNeeds && (mode === 'upload' ? !!audio?.duration : linkOk),
    credits: !creditsNeeds,
    edition: !editionNeeds,
    release: done,
  }
  const led = (s: Section) =>
    sectionDone[s] ? DOT.done : touched && needs[s] ? DOT.error : s === section ? DOT.active : DOT.idle

  const submit = () => {
    setTouched(true)
    // The checklist on this tab says what is missing, with a button to each.
    if (!valid || !price.ok || !supply.ok || !align.ok) return

    drop.run({
      audioFile: mode === 'upload' ? audio?.file : undefined,
      audioUri: mode === 'links' ? safeUri(form.audioUri) : undefined,
      coverFile: mode === 'upload' ? cover?.file : undefined,
      coverUri: mode === 'links' ? safeUri(form.coverUri) : undefined,
      buildMetadata: (a, c) => {
        const r = meta(a, c)
        return r.ok ? r.metadata : null
      },
      collectionName,
      title: form.title.trim(),
      priceWei: price.wei,
      supply: supply.supply,
      model: supply.model,
      alignmentBps: align.bps,
    })
  }

  /* ── the studio player ── */
  const linkSrc = mode === 'links' && linkOk ? resolveUri(safeUri(form.audioUri) as string) : undefined
  const playerSrc = mode === 'upload' ? (audio?.check.ok && !audio.error ? audio.url : undefined) : linkSrc
  const player = useStudioPlayer(playerSrc, { analyse: mode === 'upload' })
  const peaks = useWaveformPeaks(mode === 'upload' && audio?.check.ok ? audio.file : undefined)
  const coverUrl =
    mode === 'upload'
      ? cover?.check.ok
        ? cover.url
        : undefined
      : safeUri(form.coverUri)
      ? resolveUri(safeUri(form.coverUri) as string)
      : undefined

  // One thing plays at a time: the studio hushes the radio, and handing over to the radio stops the studio.
  useEffect(() => {
    if (player.playing && radio.playing) radio.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.playing])

  const previewInRadio = () => {
    if (!audio?.check.ok) return
    player.pause()
    radio.playNow({
      id: `local:${audio.file.name}:${audio.file.size}:${audio.file.lastModified}`,
      title: form.title.trim() || audio.file.name,
      artist: form.artist.trim() || undefined,
      src: audio.url,
      artwork: undefined,
      duration: audio.duration,
      source: 'local',
    })
  }

  const playReleased = () => {
    const { instance, editionId } = drop.launched
    if (!instance || !editionId || !drop.uploaded.audio || !chain) return
    player.pause()
    radio.playNow({
      id: `onchain:${chain.id}:${instance.toLowerCase()}:${editionId}`,
      title: form.title.trim() || drop.title || 'Your track',
      artist: form.artist.trim() || undefined,
      src: drop.uploaded.audio,
      artwork: drop.uploaded.cover,
      duration,
      source: 'onchain',
      token: { chainId: chain.id, address: instance, tokenId: editionId.toString() },
    })
  }

  // The release moment: confetti from the stage (skipped under reduced motion by burst() itself).
  useEffect(() => {
    if (!done) return undefined
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return undefined
    burst({ x: r.left + r.width / 2, y: r.top + r.height * 0.55, count: 90, power: 760 })
    const t = setTimeout(() => burst({ x: r.left + r.width * 0.2, y: r.top + r.height * 0.6, angle: -70 }), 260)
    const t2 = setTimeout(() => burst({ x: r.left + r.width * 0.8, y: r.top + r.height * 0.6, angle: -110 }), 420)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
    }
  }, [done])

  // The vault is refused, the share rules aren't read yet, or the dry run failed: nothing is uploaded or paid for.
  const blocked = music.vaultRegistered === false || !rulesKnown || drop.check.state === 'error'
  const savedChoice = drop.saved ? discardChoice(drop.saved.progress, Date.now()) : 'no'

  const dryRun = () => {
    if (align.ok) drop.simulate(collectionName, align.bps)
  }

  // On arriving at Release, and when the settings change there. Launch does the same at Review.
  useEffect(() => {
    if (!(section === 'release' && music.ready && valid && !drop.launched.instance)) return undefined
    // Typing shouldn't send a request a key. A wait here is fine: pressing Release runs the check again regardless.
    const t = setTimeout(dryRun, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, music.ready, valid, collectionName, form.alignment, drop.launched.instance])

  // Only files not stored yet cost anything.
  const toStore = [
    ...(mode === 'upload' && audio?.check.ok && !drop.uploaded.audio ? [audio.file] : []),
    ...(mode === 'upload' && cover?.check.ok && !drop.uploaded.cover ? [cover.file] : []),
  ]
  const storage = useStorageQuote(
    storedBytes(
      toStore.map((f) => f.size),
      FREE_BYTES
    )
  )

  const hasDraft =
    !done &&
    (!!audio ||
      !!cover ||
      (Object.keys(EMPTY) as (keyof Form)[]).some(
        (k) => k !== 'alignment' && k !== 'linkFormat' && form[k] !== EMPTY[k]
      ))
  const guard = useCloseGuard({
    draft: hasDraft,
    running: drop.running || stationBusy,
    close: () => dispatch(closeWindow({ value: pageId })),
  })

  const action = (() => {
    if (!isConnected)
      return { label: 'Connect wallet', disabled: !openConnectModal, onClick: () => openConnectModal?.() }
    if (drop.running) return { label: 'Working… check your wallet', disabled: true, onClick: () => {} }
    if (done) return { label: 'Released', disabled: true, onClick: () => {} }
    // Something sent may still land: this only looks, and carries on as saved, whatever the form says now.
    if (drop.unsettled)
      return {
        label: drop.mayResend ? 'Check, then send again only if needed' : 'Check how it went',
        disabled: false,
        onClick: () => drop.run(),
      }
    if (drop.launched.instance) return { label: 'Finish: add the track', disabled: false, onClick: () => drop.run() }
    if (drop.committed) return { label: 'Check how it went', disabled: false, onClick: () => drop.run() }
    // A failed try keeps its uploads, so going again costs nothing more for storage.
    return { label: drop.error ? 'Retry release' : 'Release music', disabled: !valid || blocked, onClick: submit }
  })()

  const stationKey = mode === 'upload' ? audio?.url : form.audioUri
  const [layoutRef, { width }] = useElementSize()
  const narrow = width > 0 && width <= 600
  const wide = width >= 980
  const show = (msg?: string) => (touched ? msg : undefined)
  const explorer = explorerUrl(chain?.id)

  /* ── what the stage says ── */
  const hasTrack = mode === 'upload' ? !!audio?.check.ok : linkOk
  // A refused file also shows on the stage it may have been dropped on.
  const stageNotice =
    cover && !cover.check.ok
      ? refusedWords('cover', cover.check.error, 10)
      : audio && !audio.check.ok
      ? refusedWords('track', audio.check.error, MAX_AUDIO_BYTES / 1024 / 1024)
      : undefined
  const status: StageStatus = drop.running ? 'rec' : done ? 'onair' : music.ready ? 'ready' : 'soundcheck'
  const statusLabel =
    status === 'rec'
      ? 'Releasing. Follow the prompts in your wallet.'
      : status === 'onair'
      ? 'Released and on air.'
      : status === 'ready'
      ? `Live on ${music.cfg.name}.`
      : music.wrongChain
      ? 'Soundcheck: this network is not supported. You can still upload.'
      : 'Soundcheck: releasing opens soon. You can still upload.'
  const activeStep = STEPS.find((s) => drop.steps[s.id] === 'active')
  const priceWords = price.ok ? `${formatEther(price.wei)} ETH` : ''
  const supplyWords = supply.ok ? (supply.supply ? `edition of ${supply.supply}` : 'open edition') : ''
  const marquee = drop.running
    ? `recording · ${activeStep?.label || 'getting ready'} · follow your wallet`
    : done
    ? `released · edition #${drop.launched.editionId?.toString()} is live on ${
        chain?.name || music.cfg.name
      } · tune in on miya radio`
    : !hasTrack
    ? `choose a track · mp3 wav flac ogg m4a · up to ${MAX_AUDIO_BYTES / 1024 / 1024} MB`
    : [
        `${form.artist.trim() || 'unknown artist'} — ${form.title.trim() || 'untitled'}`,
        [form.genre.trim(), form.bpm.trim() && `${form.bpm.trim()} bpm`].filter(Boolean).join(' · '),
        [priceWords, supplyWords].filter(Boolean).join(' · '),
        status === 'soundcheck' ? 'soundcheck: uploads only for now' : '',
      ]
        .filter(Boolean)
        .join('  ★  ')
  const sticker = done
    ? { big: 'out', small: `now! #${drop.launched.editionId?.toString()}`, gold: true }
    : priceWords
    ? {
        big: formatEther((price as { wei: bigint }).wei),
        small: 'ETH',
        tiny: supply.ok && supply.supply ? `${supply.supply} only` : 'open',
      }
    : hasTrack
    ? { big: 'new', small: 'single' }
    : undefined
  const cardMeta = [
    formatDuration(duration),
    form.genre.trim(),
    supply.ok ? `0${supply.supply ? `/${supply.supply}` : ''} minted` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    let to = i
    if (delta) to = (i + delta + SECTIONS.length) % SECTIONS.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = SECTIONS.length - 1
    else return
    e.preventDefault()
    go((SECTIONS[to] as (typeof SECTIONS)[number]).id)
    tabRefs.current[to]?.focus()
  }

  const idx = SECTIONS.findIndex((s) => s.id === section)
  const prevSection = SECTIONS[idx - 1]
  const nextSection = SECTIONS[idx + 1]
  const footer = (
    <Footer $still={reduced}>
      {prevSection ? (
        <SmallButton type="button" disabled={stationBusy} onClick={() => go(prevSection.id)}>
          ← {prevSection.label}
        </SmallButton>
      ) : (
        <span />
      )}
      {nextSection && (
        <SmallButton
          type="button"
          className={`next${sectionDone[section] ? ' ready' : ''}`}
          onClick={() => go(nextSection.id)}
        >
          Next: {nextSection.label} →
        </SmallButton>
      )}
    </Footer>
  )

  return (
    <WindowWrapper skin="aqua">
      <TitleBar
        skin="aqua"
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
          dispatch(minimizeWindow({ value: pageId }))
        }}
      >
        {Pages.dropmusic?.label}
      </TitleBar>
      <Layout
        ref={layoutRef}
        data-scroll
        className={narrow ? 'narrow' : wide ? 'wide' : undefined}
        style={boot === 'done' ? undefined : { position: 'relative', overflow: 'hidden' }}
      >
        {guard.dialog}
        {boot !== 'done' && <StudioBoot onReveal={() => setBoot('reveal')} onDone={() => setBoot('done')} />}
        <Wrap style={boot === 'done' ? undefined : { opacity: boot === 'reveal' ? 1 : 0, visibility: boot === 'reveal' ? 'visible' : 'hidden', transition: 'opacity 0.3s linear' }}>
          <Head>
            <div>
              <ChromeTitle>Drop Music</ChromeTitle>
              <Burst aria-hidden="true">new!</Burst>
              <p>Release a track as a collectible. It plays in miya radio.</p>
            </div>
            {music.ready ? (
              <Chip tone="ok">Live on {music.cfg.name}</Chip>
            ) : (
              (music.wrongChain || music.deployed) && (
                <Chip tone="warn">{music.wrongChain ? 'Unsupported network' : 'Opens soon'}</Chip>
              )
            )}
            {!music.deployed && !music.wrongChain && (
              <StatusBox tone="info" role="status" style={{ flexBasis: '100%' }}>
                <span>Releasing opens soon. You can put your track on the community station now.</span>
              </StatusBox>
            )}
            {drop.saved && !drop.committed && !drop.running && (
              <StatusBox tone="info" role="status" style={{ flexBasis: '100%' }}>
                <span style={{ flex: 1 }}>
                  <b>{drop.saved.label || 'Your release'}</b> was under way when this window closed.{' '}
                  {resumeWords(drop.saved.progress, true, 'the track')}
                  {savedChoice === 'anyway'
                    ? " It has had no answer for a long time: discard it only if your wallet's activity shows it never went through."
                    : ''}
                </span>
                <SmallButton type="button" onClick={() => {
                    if (!drop.saved) return
                    go('release')
                    drop.resume(drop.saved)
                  }}>
                  Continue
                </SmallButton>
                {savedChoice !== 'no' && (
                  <SmallButton type="button" onClick={() => drop.saved && drop.discardSaved(drop.saved)}>
                    Discard
                  </SmallButton>
                )}
              </StatusBox>
            )}
          </Head>

          <div ref={stageRef} className="stage">
            <Stage
              status={status}
              statusLabel={statusLabel}
              marquee={marquee}
              // Nothing runs behind the boot, or it fights the boot for frames.
              reduced={reduced || boot !== 'done'}
              coverUrl={coverUrl}
              title={form.title.trim()}
              artist={form.artist.trim()}
              sticker={sticker}
              hasTrack={hasTrack}
              player={player}
              analysable={mode === 'upload'}
              peaks={peaks}
              duration={duration}
              busy={drop.running}
              onChooseTrack={() => audioInput.current?.click()}
              onChooseCover={() => {
                if (mode === 'links') go('credits')
                else coverInput.current?.click()
              }}
              onDropFile={dropOnStage}
              onSendToRadio={mode === 'upload' && audio?.check.ok ? previewInRadio : undefined}
              notice={stageNotice}
            />
          </div>

          <Session ref={sessionRef} aria-label="Release setup">
            <TabRow role="tablist" aria-label="Release setup">
              {SECTIONS.map((s, i) => (
                <Tab
                  key={s.id}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={`dm-tab-${s.id}`}
                  aria-controls={`dm-panel-${s.id}`}
                  aria-selected={section === s.id}
                  tabIndex={section === s.id ? 0 : -1}
                  disabled={stationBusy}
                  $led={led(s.id)}
                  onClick={() => go(s.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  <span className="n" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="l">{s.label}</span>
                  <span className="led" aria-hidden />
                  <span
                    style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
                  >
                    {sectionDone[s.id] ? ' (done)' : touched && needs[s.id] ? ' (needs attention)' : ''}
                  </span>
                </Tab>
              ))}
            </TabRow>

            <StepPanel
              key={section}
              $dir={dir}
              $still={reduced}
              role="tabpanel"
              id={`dm-panel-${section}`}
              aria-labelledby={`dm-tab-${section}`}
            >
              <fieldset disabled={drop.committed && !done} style={{ display: 'contents' }}>
              {section === 'track' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: space[2],
                      flexWrap: 'wrap',
                    }}
                  >
                    <Eyebrow>Your track</Eyebrow>
                    <Toggle role="group" aria-label="Source of files">
                      <SmallButton type="button" aria-pressed={mode === 'upload'} onClick={() => changeMode('upload')}>
                        Upload files
                      </SmallButton>
                      <SmallButton type="button" aria-pressed={mode === 'links'} onClick={() => changeMode('links')}>
                        Use links
                      </SmallButton>
                    </Toggle>
                  </div>

                  {mode === 'upload' ? (
                    <Drop
                      $over={over === 'audio'}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setOver('audio')
                      }}
                      onDragLeave={() => setOver(undefined)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setOver(undefined)
                        pickAudio(e.dataTransfer.files[0])
                      }}
                    >
                      <div className="grow">
                        {audio ? (
                          <>
                            {audio.file.name}
                            <small>
                              {formatBytes(audio.file.size)} ·{' '}
                              {audio.reading
                                ? 'reading length…'
                                : audio.duration
                                ? formatDuration(audio.duration)
                                : '—'}
                            </small>
                          </>
                        ) : (
                          <>
                            <DropWords mouse="Drop audio here" touch="Choose an audio file" />
                            <small>mp3, ogg, wav, m4a or flac · up to {MAX_AUDIO_BYTES / 1024 / 1024} MB</small>
                          </>
                        )}
                        <Err>{audio && !audio.check.ok ? audio.check.error : audio?.error}</Err>
                      </div>
                      <SmallButton type="button" onClick={() => audioInput.current?.click()}>
                        {audio ? 'Change' : 'Browse'}
                      </SmallButton>
                    </Drop>
                  ) : (
                    <>
                      <Field>
                        Audio link
                        <input
                          value={form.audioUri}
                          placeholder="ar://… or ipfs://…/track.mp3"
                          onChange={(e) => {
                            // The release must use this link, not whatever went up before it.
                            drop.invalidate('audio')
                            setLinkDuration(undefined)
                            set('audioUri')(e)
                          }}
                          onBlur={() => form.audioUri && checkLink()}
                        />
                        <small>
                          {linkDuration
                            ? `Length ${formatDuration(linkDuration)}. Press play on the stage to hear it.`
                            : 'The length is read from the link.'}
                        </small>
                        <Err>{linkError}</Err>
                      </Field>
                      <Field>
                        Format
                        <select value={form.linkFormat} onChange={set('linkFormat')}>
                          {Object.keys(AUDIO_TYPES).map((ext) => (
                            <option key={ext} value={ext}>
                              {ext}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  )}
                  {hasTrack && (
                    <small style={{ color: color.inkMuted, fontSize: text.xs }}>
                      Press play on the stage to hear it. The title comes from the file name; change it next.
                    </small>
                  )}
                  {footer}
                </>
              )}

              {section === 'credits' && (
                <>
                  {mode === 'upload' ? (
                    <Drop
                      $over={over === 'cover'}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setOver('cover')
                      }}
                      onDragLeave={() => setOver(undefined)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setOver(undefined)
                        pickCover(e.dataTransfer.files[0])
                      }}
                    >
                      <Cover>{cover?.check.ok && <img src={cover.url} alt="Cover preview" />}</Cover>
                      <div className="grow">
                        {cover ? cover.file.name : <DropWords mouse="Drop cover art here" touch="Choose cover art" />}
                        <small>
                          {cover ? formatBytes(cover.file.size) : 'Square png, jpg, gif or webp · up to 10 MB'}
                        </small>
                        <Err>{cover && !cover.check.ok ? cover.check.error : undefined}</Err>
                      </div>
                      <SmallButton type="button" onClick={() => coverInput.current?.click()}>
                        {cover ? 'Change' : 'Browse'}
                      </SmallButton>
                    </Drop>
                  ) : (
                    <Field>
                      Cover link
                      <input
                        value={form.coverUri}
                        placeholder="ar://… or ipfs://…"
                        onChange={(e) => {
                          drop.invalidate('cover')
                          set('coverUri')(e)
                        }}
                      />
                      <Err>{show(metaErrors.image)}</Err>
                    </Field>
                  )}
                  <Row2>
                    <Field>
                      Title*
                      <input
                        value={form.title}
                        maxLength={120}
                        onChange={set('title')}
                        aria-invalid={touched && !!metaErrors.title}
                      />
                      <Err>{show(metaErrors.title)}</Err>
                    </Field>
                    <Field>
                      Artist*
                      <input
                        value={form.artist}
                        maxLength={80}
                        onChange={set('artist')}
                        aria-invalid={touched && !!metaErrors.artist}
                      />
                      <Err>{show(metaErrors.artist)}</Err>
                    </Field>
                  </Row2>
                  {/* Once what is required is in; anything already typed stays, so its error can't hide. */}
                  {((form.title.trim() && form.artist.trim()) || form.genre || form.bpm || form.description) && (
                    <>
                      <Row2>
                        <Field>
                          Genre
                          <input value={form.genre} maxLength={40} onChange={set('genre')} placeholder="optional" />
                        </Field>
                        <Field>
                          BPM
                          <input
                            value={form.bpm}
                            inputMode="numeric"
                            maxLength={3}
                            onChange={set('bpm')}
                            placeholder="optional"
                            aria-invalid={!!metaErrors.bpm}
                          />
                          <Err>{metaErrors.bpm}</Err>
                        </Field>
                      </Row2>
                      <Field>
                        Description
                        <textarea
                          value={form.description}
                          maxLength={2000}
                          placeholder="optional"
                          onChange={set('description')}
                        />
                      </Field>
                    </>
                  )}
                  {footer}
                </>
              )}

              {section === 'edition' && (
                <>
                  <Field>
                    Collection name
                    <input
                      value={form.collectionName}
                      placeholder={collectionName || 'Artist - Title'}
                      maxLength={120}
                      onChange={set('collectionName')}
                    />
                  </Field>
                  <Row2>
                    <Field>
                      Price (ETH)*
                      <input
                        value={form.price}
                        inputMode="decimal"
                        placeholder="0.01"
                        onChange={set('price')}
                        aria-invalid={(!!form.price || touched) && !price.ok}
                      />
                      <Err>{form.price || touched ? (!price.ok ? price.error : undefined) : undefined}</Err>
                      {price.ok && <small>{formatEther(price.wei)} ETH per copy</small>}
                    </Field>
                    <Field>
                      Number of copies
                      <input value={form.supply} inputMode="numeric" placeholder="No limit" onChange={set('supply')} />
                      <Err>{!supply.ok ? supply.error : undefined}</Err>
                      {supply.ok && <small>{supply.supply ? `${supply.supply} copies` : 'Open edition'}</small>}
                    </Field>
                  </Row2>
                  <Field>
                    Share for the vault (%)
                    <input
                      value={form.alignment}
                      inputMode="decimal"
                      onChange={set('alignment')}
                      aria-invalid={!align.ok}
                    />
                    <Err>{!align.ok ? align.error : undefined}</Err>
                    <small>
                      {rulesKnown
                        ? `Part of each sale goes to the community vault (at least ${minBps / 100}%). miya keeps ${
                            feeBps / 100
                          }%. You keep the rest.`
                        : music.rulesFailed
                        ? "Part of each sale goes to the community vault. The minimum share and miya's fee couldn't be read just now."
                        : "Part of each sale goes to the community vault. Loading the minimum share and miya's fee…"}
                    </small>
                  </Field>
                  {rulesKnown && (
                    <SplitMeter protocolBps={feeBps} alignmentBps={align.ok ? align.bps : minBps} compact />
                  )}
                  {footer}
                </>
              )}

              {section === 'release' && (
                <>
                  <ReleasePreview
                    coverUrl={coverUrl}
                    title={form.title.trim()}
                    artist={form.artist.trim()}
                    meta={cardMeta}
                    mintLabel={priceWords ? `Mint · ${priceWords}` : 'Mint · set a price'}
                    facts={[
                      { label: 'Price', value: priceWords || 'not set' },
                      {
                        label: 'Copies',
                        value: supply.ok ? (supply.supply ? String(supply.supply) : 'No limit') : '—',
                      },
                      {
                        label: 'You keep',
                        value: align.ok
                          ? `${pctLabel(10_000 - align.bps - (feeBps ?? 0))} of each mint`
                          : '—',
                      },
                      { label: 'Network', value: music.cfg.name },
                    ]}
                  />

                  {touched && !valid && !drop.running && (
                    <StatusBox tone="error" role="alert">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: space[1] }}>A few things before it can go out:</div>
                        <Missing>
                          {SECTIONS.filter((s) => needs[s.id]).map((s) => (
                            <li key={s.id}>
                              <span>
                                <b>{s.label}:</b> {needs[s.id]}
                              </span>
                              <SmallButton type="button" onClick={() => go(s.id)}>
                                Fix it
                              </SmallButton>
                            </li>
                          ))}
                        </Missing>
                      </div>
                    </StatusBox>
                  )}

                  <Well>
                    <TxSteps
                      label="Release steps"
                      steps={STEPS.map((s) => ({
                        id: s.id,
                        label: `${s.label}${drop.steps[s.id] === 'skipped' ? ' (using link)' : ''}`,
                        state: drop.steps[s.id],
                        link:
                          s.id === 'deploy' && drop.launched.deployHash
                            ? `${explorer}/tx/${drop.launched.deployHash}`
                            : s.id === 'edition' && drop.launched.editionHash
                            ? `${explorer}/tx/${drop.launched.editionHash}`
                            : undefined,
                      }))}
                    />
                  </Well>

                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: text.xs }}>Token metadata preview</summary>
                    <Well style={{ marginTop: space[1] }}>
                      <Json>
                        {preview.ok
                          ? JSON.stringify(preview.metadata, null, 2)
                          : 'Fill in the track to preview metadata.'}
                      </Json>
                      {(drop.uploaded.audio || drop.uploaded.cover || drop.uploaded.metadata) && (
                        <Json style={{ marginTop: space[2] }}>
                          {[
                            drop.uploaded.audio && `audio ${drop.uploaded.audio}`,
                            drop.uploaded.cover && `cover ${drop.uploaded.cover}`,
                            drop.uploaded.metadata && `metadata ${drop.uploaded.metadata}`,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        </Json>
                      )}
                    </Well>
                  </details>

                  {storage.state !== 'none' && !done && (
                    <small style={{ fontSize: text.xs }}>{storageWords(storage)}</small>
                  )}

                  {music.ready && music.vaultRegistered === false && (
                    <StatusBox tone="error">
                      <span>Releasing is paused on this network. Nothing was charged.</span>
                    </StatusBox>
                  )}
                  {music.ready && music.vaultRegistered !== false && valid && !drop.running && !done && (
                    <>
                      {drop.check.state === 'checking' && (
                        <StatusBox tone="info" role="status">
                          <img src={LoadingHourglass} alt="" />
                          <span>Checking everything with the contract first…</span>
                        </StatusBox>
                      )}
                      {drop.check.state === 'ok' && !drop.error && !drop.launched.instance && (
                        <StatusBox tone="ok" role="status">
                          <span>Checked: the contract accepts these settings.</span>
                        </StatusBox>
                      )}
                      {drop.check.state === 'error' && !drop.launched.instance && (
                        <StatusBox tone="error" role="alert">
                          <span style={{ flex: 1 }}>{drop.check.message}</span>
                          <SmallButton type="button" onClick={dryRun}>
                            Check again
                          </SmallButton>
                        </StatusBox>
                      )}
                    </>
                  )}
                  {drop.running && (
                    <StatusBox tone="info" role="status">
                      <img src={LoadingHourglass} alt="" />
                      <span>{drop.note || 'Follow the prompts in your wallet.'} Keep this window open.</span>
                    </StatusBox>
                  )}
                  {drop.error && !drop.running && (
                    <StatusBox tone="error" role="alert">
                      <span>{drop.error}</span>
                    </StatusBox>
                  )}
                  {drop.committed && !done && !drop.running && drop.discard !== 'no' && (
                    <StatusBox tone="info" role="status">
                      <span style={{ flex: 1 }}>
                        {drop.discard === 'anyway'
                          ? "What was sent has had no answer for a long time, or your wallet replaced it. Start over only if your wallet's activity shows it never went through: it may still land."
                          : 'You can leave this one as it is and start a new release. The collection stays on the network.'}
                      </span>
                      <SmallButton
                        type="button"
                        onClick={() => {
                          drop.reset()
                          setTouched(false)
                        }}
                      >
                        Start over
                      </SmallButton>
                    </StatusBox>
                  )}
                  {(drop.uploaded.audio || drop.uploaded.metadata) && !done && (
                    <StatusBox tone="info">
                      <span>Your uploads are saved. You will not pay for them again.</span>
                    </StatusBox>
                  )}
                  {done && drop.launched.instance && (
                    <StatusBox tone="ok" role="status">
                      <span>
                        Released! Edition #{drop.launched.editionId?.toString()} of{' '}
                        <a href={`${explorer}/address/${drop.launched.instance}`} target="_blank" rel="noreferrer">
                          {drop.launched.instance.slice(0, 6)}…{drop.launched.instance.slice(-4)}
                        </a>
                        .{' '}
                        <SmallButton type="button" onClick={playReleased}>
                          Play in radio
                        </SmallButton>{' '}
                        <SmallButton
                          type="button"
                          onClick={() => {
                            drop.reset()
                            setForm({ ...EMPTY, alignment: form.alignment })
                            setAudio(undefined)
                            setCover(undefined)
                            setTouched(false)
                            go('track')
                          }}
                        >
                          New drop
                        </SmallButton>
                      </span>
                    </StatusBox>
                  )}
                  {/* Until editions open, a connected wallet's main button is the station's, below. */}
                  {(music.ready || !isConnected) && (
                    <BigButton type="button" disabled={action.disabled} onClick={action.onClick}>
                      {action.label}
                    </BigButton>
                  )}

                  {!music.ready && (
                    <StatusBox tone="info">
                      <span>
                        {music.wrongChain
                          ? 'Your wallet is on a network miya does not support.'
                          : music.deployed
                          ? `Connect a wallet on ${music.cfg.name} to release.`
                          : 'Releasing editions opens soon.'}
                      </span>
                    </StatusBox>
                  )}
                  {music.wrongChain && (
                    <BigButton type="button" onClick={() => switchChain({ chainId: music.cfg.chainId as ChainId })}>
                      Switch to {music.cfg.name}
                    </BigButton>
                  )}

                  <StationAdd
                    key={stationKey}
                    primary={!music.ready && !music.wrongChain}
                    title={form.title}
                    artist={form.artist}
                    duration={duration}
                    audioFile={mode === 'upload' && !audioError ? audio?.file : undefined}
                    coverFile={mode === 'upload' && cover?.check.ok ? cover.file : undefined}
                    audioUri={mode === 'links' ? safeUri(form.audioUri) : undefined}
                    coverUri={mode === 'links' ? safeUri(form.coverUri) : undefined}
                    store={drop.store}
                    stored={drop.uploaded}
                    storing={drop.note}
                    doneWords={stationDone?.key === stationKey ? stationDone?.words : undefined}
                    onDone={(words) => setStationDone({ key: stationKey, words })}
                    onBusy={setStationBusy}
                  />

                  {footer}
                </>
              )}
              </fieldset>
            </StepPanel>
          </Session>

          <input
            ref={audioInput}
            type="file"
            accept={AUDIO_ACCEPT}
            hidden
            aria-label="Audio file"
            onChange={(e) => {
              setMode('upload')
              pickAudio(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <input
            ref={coverInput}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            aria-label="Cover art file"
            onChange={(e) => {
              pickCover(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </Wrap>
      </Layout>
    </WindowWrapper>
  )
}

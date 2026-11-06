/**
 * miyatv channel registry. Add a channel by appending to CHANNELS; the TV, the channel list, the
 * chat room and the native-chat tab all read from here.
 *
 * Channel kinds:
 * - 'iframe'   — an official player that allows being framed (checked: no X-Frame-Options and no
 *                restrictive frame-ancestors). One or more `sources`; several sources = a creator picker.
 * - 'show'     — drawn by miyatv itself from live data: no outside player at all.
 * - 'native'   — our own HLS stream. TODO(native): play with hls.js (not a dependency yet) once we run
 *                our own streams; until then the TV shows a "no signal" card for this kind.
 *
 * Embed constraints, verified 2026-11-01 with `curl -sI` and in Chromium (Playwright):
 * - squeekchain.com: frame-ancestors 'none'. Its X broadcast has ended and it has no public stream, so the channel is a show.
 * - YouTube: /embed/<id> plays and its IFrame API sets volume and mute live. /embed/live_stream?channel= gives error 150,
 *   so `videoId` is a starting point: api/_lib/tvlive.ts finds the current stream when one restarts.
 * - player.kick.com/<slug> and kick.com/popout/<slug>/chat: no frame headers → both frame and work.
 * This file has no imports so `node --test` can load it directly (tests/miyatv.test.mts).
 */

export type KickSource = {
  provider: 'kick'
  /** Kick channel slug, as in https://kick.com/<slug>. */
  slug: string
  label: string
  /** True until the real slug is picked: the TV labels it as a placeholder. */
  placeholder?: boolean
}

export type XBroadcastSource = {
  provider: 'x-broadcast'
  /** The id in https://x.com/i/broadcasts/<id>. Changes every time the broadcaster starts a new stream. */
  broadcastId: string
  label: string
}

export type YouTubeSource = {
  provider: 'youtube'
  videoId: string
  label: string
}

export type Source = KickSource | XBroadcastSource | YouTubeSource

export type GuideSection = 'Sounds' | 'Nature' | 'Space' | 'Onchain' | 'Creators'
export const GUIDE_SECTIONS: GuideSection[] = ['Sounds', 'Nature', 'Space', 'Onchain', 'Creators']
export type ShowKind = 'radio' | 'squeek' | 'public'

export type ChannelLink = { label: string; href: string }

type ChannelBase = {
  /** Stable id, matching /^[a-z0-9][a-z0-9-]{0,47}$/. */
  id: string
  /** Channel number shown on the TV and reachable with the number keys. Unique, 1-99. */
  number: number
  name: string
  tagline: string
  description: string
  links: ChannelLink[]
  /** Where the printed guide lists it. */
  section: GuideSection
  /** Reserve the imdUSD markets side-panel slot for this channel. No odds are ever drawn over a player. */
  markets?: boolean
}

export type IframeChannel = ChannelBase & { kind: 'iframe'; sources: [Source, ...Source[]] }
export type ShowChannel = ChannelBase & { kind: 'show'; show: ShowKind }
/** TODO(native): our own streams. `hls` is the playlist URL; playback via hls.js is not wired up yet. */
export type NativeChannel = ChannelBase & { kind: 'native'; hls: string }

export type Channel = IframeChannel | ShowChannel | NativeChannel

export const CHANNELS: Channel[] = [
  {
    id: 'lofi',
    number: 1,
    kind: 'iframe',
    section: 'Sounds',
    name: 'Lofi Girl',
    tagline: 'Beats to relax and study to, around the clock.',
    description: 'The long-running lofi stream, through YouTube’s official player.',
    sources: [{ provider: 'youtube', videoId: 'rFZHOHl-L8A', label: 'Lofi Girl' }],
    links: [{ label: 'Lofi Girl on YouTube', href: 'https://www.youtube.com/@LofiGirl' }],
  },
  {
    id: 'miya-radio',
    number: 2,
    kind: 'show',
    show: 'radio',
    section: 'Sounds',
    name: 'miya radio',
    tagline: 'The community station, with a picture that grows out of the music.',
    description: 'Tracks people uploaded to miya radio. The visuals are generated live from the sound.',
    links: [],
  },
  {
    id: 'monterey',
    number: 3,
    kind: 'iframe',
    section: 'Nature',
    name: 'Monterey Bay',
    tagline: 'Live from the aquarium’s aviary.',
    description: 'A live cam from Monterey Bay Aquarium, through YouTube’s official player.',
    sources: [{ provider: 'youtube', videoId: 'AWJi0LgyA28', label: 'Aviary cam' }],
    links: [{ label: 'Monterey Bay Aquarium on YouTube', href: 'https://www.youtube.com/@MontereyBayAquarium' }],
  },
  {
    id: 'iss',
    number: 4,
    kind: 'iframe',
    section: 'Space',
    name: 'Space Station',
    tagline: 'Earth from the International Space Station, live.',
    description: 'NASA’s live views from the station, through YouTube’s official player.',
    sources: [{ provider: 'youtube', videoId: 'ROboUHfPUrU', label: 'NASA' }],
    links: [{ label: 'NASA on YouTube', href: 'https://www.youtube.com/@NASA' }],
  },
  {
    id: 'squeekchain',
    number: 5,
    kind: 'show',
    show: 'squeek',
    section: 'Onchain',
    name: 'squeekchain',
    tagline: 'A hamster runs the wheel, the wheel mines the chain.',
    description: 'The real wheel’s telemetry, live.',
    links: [{ label: 'squeekchain.com', href: 'https://squeekchain.com/' }],
  },
  {
    id: 'kick-imdusd',
    number: 6,
    kind: 'iframe',
    section: 'Creators',
    name: 'Kick',
    tagline: 'Creators live on Kick right now.',
    description: 'Kick creators, embedded with the official Kick player. Markets on these streams are coming soon.',
    // The page only ever offers whoever is on right now (api/_lib/tvkick.ts), these first when they're live. This list is
    // what the server asks about, never played as it stands. Picked 2026-11-01 to fit the market templates (chess results are settleable from public chess
    // casino streams. Kick follower counts then: xQc 1.47M, GMHikaru 214k, chessbrah 35k.
    sources: [
      { provider: 'kick', slug: 'xqc', label: 'xQc' },
      { provider: 'kick', slug: 'gmhikaru', label: 'GMHikaru' },
      { provider: 'kick', slug: 'chessbrah', label: 'chessbrah' },
    ],
    links: [{ label: 'kick.com', href: 'https://kick.com/' }],
    markets: true,
  },
  {
    id: 'public-access',
    number: 7,
    kind: 'show',
    show: 'public',
    section: 'Creators',
    name: 'Public Access',
    tagline: 'Milady Bootcamp, Bonkler Bots and NFT arbitrage, then your tapes. Send one in.',
    description: 'The station’s own tapes, then videos sent in by people here once the station has looked at them.',
    links: [],
  },
]

const ROOM_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const KICK_SLUG = /^[A-Za-z0-9_-]{1,64}$/
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const X_BROADCAST_ID = /^[A-Za-z0-9]{8,32}$/

/** The player URL for a source. */
export function embedSrc(source: Source): string {
  if (source.provider === 'kick') {
    return `https://player.kick.com/${encodeURIComponent(source.slug)}?autoplay=true&muted=false`
  }

  if (source.provider === 'youtube') return `https://www.youtube.com/embed/${encodeURIComponent(source.videoId)}`
  return `https://studio.x.com/embed/broadcast/${encodeURIComponent(source.broadcastId)}?dnt=true&lang=en`
}

/** miyatv chat is one room, whatever is on. */
export const CHAT_ROOM = 'miyatv'

export const CHAT_MIN = 222
export const CHAT_DEFAULT = 340
// Kick's player only offers mute and volume at 769px or wider. 770 for the glass, 12 for its trim, 8 for the drag
// gap, 16 for the cabinet's padding.
const SCREEN_NEEDS = 806

/** How wide chat is in a cabinet this wide: never so far that the picture loses its volume controls. */
export function clampChat(wanted: number, cabinetWidth: number): number {
  const max = Math.max(CHAT_MIN, cabinetWidth - SCREEN_NEEDS)
  return Math.round(Math.min(max, Math.max(CHAT_MIN, wanted)))
}

/** Where to watch the source on its own site. */
export function watchUrl(source: Source): string {
  if (source.provider === 'kick') return `https://kick.com/${encodeURIComponent(source.slug)}`
  if (source.provider === 'youtube') return `https://www.youtube.com/watch?v=${encodeURIComponent(source.videoId)}`
  return `https://x.com/i/broadcasts/${encodeURIComponent(source.broadcastId)}`
}

/** The words on the plate's link: where it goes, not just that it goes. */
export function watchLabel(source: Source): string {
  if (source.provider === 'kick') return 'Watch on Kick ↗'
  if (source.provider === 'youtube') return 'Watch on YouTube ↗'
  return 'Watch on X ↗'
}

/** The plate's link: the source being played, or a show's own site. */
export function plateLink(channel: Channel, source?: Source): { href: string; label: string } | undefined {
  if (source) return { href: watchUrl(source), label: watchLabel(source) }
  const site = channel.kind === 'show' ? channel.links[0] : undefined
  return site && { href: site.href, label: `${site.label} ↗` }
}

/**
 * Who stays on as the list of live streams changes: the one being watched, however the list reorders. With nobody chosen yet
 * that is the biggest. `ended` says the chosen one has really gone, the only time the picture changes by itself.
 */
export function pinnedSource(labels: string[], pinned?: string): { label?: string; ended: boolean } {
  if (!labels.length || (pinned && labels.includes(pinned))) return { label: pinned, ended: false }
  return { label: labels[0], ended: !!pinned }
}

export type NativeChat = { kind: 'iframe'; src: string; label: string }

/** A platform's own chat, where it can sit in our sidebar. Kick's popout chat frames fine (checked 2026-11-01). */
export function nativeChatFor(channel: Channel, source?: Source): NativeChat | undefined {
  if (channel.kind !== 'iframe' || source?.provider !== 'kick') return undefined
  return {
    kind: 'iframe',
    src: `https://kick.com/popout/${encodeURIComponent(source.slug)}/chat`,
    label: 'kick chat',
  }
}

/** Index of the channel `step` positions away, wrapping around like a real dial. */
export function stepChannel(count: number, index: number, step: number): number {
  if (count <= 0) return 0
  return (((index + step) % count) + count) % count
}

export function indexOfNumber(channels: Channel[], n: number): number {
  return channels.findIndex((c) => c.number === n)
}

/** Registry sanity checks; returns a list of problems (empty = valid). Run in tests. */
export function validateChannels(channels: Channel[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const numbers = new Set<number>()
  channels.forEach((c) => {
    if (!ROOM_ID.test(c.id)) problems.push(`${c.id}: id is not a valid chat room name`)
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`)
    ids.add(c.id)
    if (!Number.isInteger(c.number) || c.number < 1 || c.number > 99) problems.push(`${c.id}: number out of range`)
    if (numbers.has(c.number)) problems.push(`${c.id}: duplicate number ${c.number}`)
    numbers.add(c.number)
    c.links.forEach((l) => {
      if (!/^https:\/\//.test(l.href)) problems.push(`${c.id}: link ${l.href} is not https`)
    })
    if (c.kind !== 'iframe') return
    c.sources.forEach((s) => {
      if (s.provider === 'youtube' && !YOUTUBE_ID.test(s.videoId)) problems.push(`${c.id}: bad YouTube id ${s.videoId}`)
      if (s.provider === 'kick' && !KICK_SLUG.test(s.slug)) problems.push(`${c.id}: bad kick slug ${s.slug}`)
      if (s.provider === 'x-broadcast' && !X_BROADCAST_ID.test(s.broadcastId)) {
        problems.push(`${c.id}: bad X broadcast id ${s.broadcastId}`)
      }
    })
  })

  return problems
}

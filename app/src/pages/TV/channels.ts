/**
 * miyatv channel registry. Add a channel by appending to CHANNELS; the TV, the channel list, the
 * chat room and the native-chat tab all read from here.
 *
 * Channel kinds:
 * - 'iframe'   — an official player that allows being framed (checked: no X-Frame-Options and no
 *                restrictive frame-ancestors). One or more `sources`; several sources = a creator picker.
 * - 'external' — the site forbids framing (X-Frame-Options / frame-ancestors). We show a channel card
 *                that links out, with our chat beside it.
 * - 'native'   — our own HLS stream. TODO(native): play with hls.js (not a dependency yet) once we run
 *                our own streams; until then the TV shows a "no signal" card for this kind.
 *
 * Embed constraints, verified 2026-11-01 with `curl -sI` and in Chromium (Playwright):
 * - www.fishtank.live: X-Frame-Options SAMEORIGIN + frame-ancestors 'self' *.fishtank.live → blocked.
 * - squeekchain.com: frame-ancestors 'none'; x.com/i/broadcasts/<id>: SAMEORIGIN (…/embed: DENY) → blocked.
 *   X's official oEmbed for a broadcast (publish.x.com/oembed) renders <blockquote class="twitter-broadcast">
 *   which widgets.js turns into https://studio.x.com/embed/broadcast/<id> — that page sends
 *   `frame-ancestors *` and plays the live video in a sandboxed iframe. We frame it directly (no widgets.js).
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

export type Source = KickSource | XBroadcastSource

export type ChannelLink = { label: string; href: string }

type ChannelBase = {
  /** Stable id. Also the chat room name, so it must match /^[a-z0-9][a-z0-9-]{0,47}$/. */
  id: string
  /** Channel number shown on the TV and reachable with the number keys. Unique, 1-99. */
  number: number
  name: string
  tagline: string
  description: string
  links: ChannelLink[]
  /** Reserve the imdUSD markets side-panel slot for this channel. No odds are ever drawn over a player. */
  markets?: boolean
}

export type IframeChannel = ChannelBase & { kind: 'iframe'; sources: [Source, ...Source[]] }
export type ExternalChannel = ChannelBase & { kind: 'external'; href: string; cta: string }
/** TODO(native): our own streams. `hls` is the playlist URL; playback via hls.js is not wired up yet. */
export type NativeChannel = ChannelBase & { kind: 'native'; hls: string }

export type Channel = IframeChannel | ExternalChannel | NativeChannel

export const CHANNELS: Channel[] = [
  {
    id: 'fishtank',
    number: 1,
    kind: 'external',
    name: 'fish tank',
    tagline: 'reality, 24/7, on fishtank.live',
    description:
      'Contestants live in a house covered in cameras while viewers watch and meddle. fishtank.live only plays on its own site, so it opens in a new tab. Chat stays here.',
    href: 'https://www.fishtank.live/',
    cta: 'Watch on fishtank.live',
    links: [{ label: 'fishtank.live', href: 'https://www.fishtank.live/' }],
  },
  {
    id: 'squeekchain',
    number: 2,
    kind: 'iframe',
    name: 'squeekchain',
    tagline: 'the hamster-powered proof-of-work chain, live',
    description:
      'A hamster runs the wheel, the wheel mines $SQK. Streamed as an X broadcast through X’s official broadcast embed (studio.x.com allows framing).',
    sources: [{ provider: 'x-broadcast', broadcastId: '1qGoNYoyoRlKv', label: 'X broadcast' }],
    links: [
      { label: 'squeekchain.com', href: 'https://squeekchain.com/' },
      { label: 'broadcast on X', href: 'https://x.com/i/broadcasts/1qGoNYoyoRlKv' },
    ],
  },
  {
    id: 'kick-imdusd',
    number: 3,
    kind: 'iframe',
    name: 'kick · imdUSD markets',
    tagline: 'Kick streams with imdUSD markets (soon)',
    description: 'Kick creators, embedded with the official Kick player. Markets on these streams are coming soon.',
    // Picked 2026-11-01 to fit the market templates (chess results are settleable from public chess APIs); no
    // casino streams. Kick follower counts then: xQc 1.47M, GMHikaru 214k, chessbrah 35k.
    sources: [
      { provider: 'kick', slug: 'xqc', label: 'xQc' },
      { provider: 'kick', slug: 'gmhikaru', label: 'GMHikaru' },
      { provider: 'kick', slug: 'chessbrah', label: 'chessbrah' },
    ],
    links: [{ label: 'kick.com', href: 'https://kick.com/' }],
    markets: true,
  },
]

const ROOM_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const KICK_SLUG = /^[A-Za-z0-9_-]{1,64}$/
const X_BROADCAST_ID = /^[A-Za-z0-9]{8,32}$/

/** The player URL for a source. Muted autoplay so channel surfing doesn't blast audio. */
export function embedSrc(source: Source): string {
  if (source.provider === 'kick') {
    return `https://player.kick.com/${encodeURIComponent(source.slug)}?autoplay=true&muted=false`
  }

  return `https://studio.x.com/embed/broadcast/${encodeURIComponent(source.broadcastId)}?dnt=true&lang=en`
}

export const CHAT_MIN = 222
export const CHAT_DEFAULT = 340
// Kick's player only offers mute and volume at 769px or wider. 770 for the glass, 12 for its trim, 8 for the drag
// handle, 16 for the cabinet's padding.
const SCREEN_NEEDS = 806

/** How wide chat may be dragged in a cabinet this wide: never so far that the picture loses its volume controls. */
export function clampChat(wanted: number, cabinetWidth: number): number {
  const max = Math.max(CHAT_MIN, cabinetWidth - SCREEN_NEEDS)
  return Math.round(Math.min(max, Math.max(CHAT_MIN, wanted)))
}

/** Where to watch the source on its own site. */
export function watchUrl(source: Source): string {
  if (source.provider === 'kick') return `https://kick.com/${encodeURIComponent(source.slug)}`
  return `https://x.com/i/broadcasts/${encodeURIComponent(source.broadcastId)}`
}

export function hostOf(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, '')
  } catch {
    return href
  }
}

export type NativeChat = { kind: 'iframe'; src: string; label: string } | { kind: 'link'; href: string; label: string }

/**
 * The platform's own chat. Kick's popout chat frames fine (no frame headers, checked 2026-11-01);
 * X broadcasts and fishtank.live only link out.
 */
export function nativeChatFor(channel: Channel, source?: Source): NativeChat | undefined {
  if (channel.kind === 'external') return { kind: 'link', href: channel.href, label: `${hostOf(channel.href)} chat` }
  if (channel.kind === 'native' || !source) return undefined
  if (source.provider === 'kick') {
    return {
      kind: 'iframe',
      src: `https://kick.com/popout/${encodeURIComponent(source.slug)}/chat`,
      label: 'kick chat',
    }
  }

  return { kind: 'link', href: watchUrl(source), label: 'X chat' }
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
    if (c.kind === 'external' && !/^https:\/\//.test(c.href)) problems.push(`${c.id}: href is not https`)
    if (c.kind !== 'iframe') return
    c.sources.forEach((s) => {
      if (s.provider === 'kick' && !KICK_SLUG.test(s.slug)) problems.push(`${c.id}: bad kick slug ${s.slug}`)
      if (s.provider === 'x-broadcast' && !X_BROADCAST_ID.test(s.broadcastId)) {
        problems.push(`${c.id}: bad X broadcast id ${s.broadcastId}`)
      }
    })
  })

  return problems
}

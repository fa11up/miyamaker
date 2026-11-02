import Fren1 from 'assets/pet/fren/fren1.png'
import Fren2 from 'assets/pet/fren/fren2.png'
import Fren3 from 'assets/pet/fren/fren3.png'
import Fren4 from 'assets/pet/fren/fren4.png'
import Fren5 from 'assets/pet/fren/fren5.png'
import Fren6 from 'assets/pet/fren/fren6.png'
import Fren7 from 'assets/pet/fren/fren7.png'
import Fumo192 from 'assets/pet/fumo-192.png'
import Fumo192Webp from 'assets/pet/fumo-192.webp'
import Fumo320Webp from 'assets/pet/fumo-320.webp'

/**
 * Desktop pets. Each one is a transparent sprite (flipped with CSS, so one facing is enough) plus
 * what it says. Everything it does (walking, climbing icons, perching, poking the wave button,
 * surfing) is driven by its rendered size, so any entry here can do all of it.
 *
 * Pixel-art pets set `pixel`: the sprite is drawn at a whole-number scale with no smoothing.
 * A pet with `variants` has several looks; one is picked at random unless the user chose one.
 */
export interface PetVariant {
  id: string
  name: string
  src: string
  srcSet?: string
  /** native size in px (pixel art) */
  w: number
  h: number
}

export type PetReaction = 'surfStart' | 'surfEnd' | 'wipeout' | 'trick' | 'perch' | 'pokeOn' | 'pokeOff' | 'climb' | 'waveOn'

export interface PetDefinition {
  id: string
  name: string
  /** fallback PNG */
  src: string
  /** srcset for <img> (webp) */
  srcSet?: string
  /** intrinsic aspect ratio, width / height */
  aspect: number
  /** rendered height on desktop / phones, px (ignored for pixel art, which uses `pixel.scale`) */
  height: { desktop: number; mobile: number }
  /** pixel art: whole-number scale on desktop / phones, crisp edges */
  pixel?: { scale: { desktop: number; mobile: number } }
  variants?: PetVariant[]
  /** said when clicked */
  lines: string[]
  /** said when the cursor comes close */
  noticeLines?: string[]
  /** said when it wakes up */
  wakeLines?: string[]
  /** said while playing on the desktop; missing kinds use DEFAULT_REACTIONS */
  reactions?: Partial<Record<PetReaction, string[]>>
}

export const DEFAULT_REACTIONS: Record<PetReaction, string[]> = {
  surfStart: ["surf's up!", 'cowabunga', 'wave check'],
  surfEnd: ['tubular', 'good waves', 'gnarly'],
  wipeout: ['wipeout!', 'blub blub', 'glug'],
  trick: ['woo!', 'kickflip!', 'ollie!', '360!'],
  perch: ['nice view', 'comfy', 'up here!', ':3'],
  pokeOn: ['boop', 'splash!', 'wave go brrr'],
  pokeOff: ['no waves today?', 'boop?', 'hello? waves?'],
  climb: [],
  waveOn: ["surf's up!", 'waves!!', 'brb surfing'],
}

const FREN_VARIANTS: PetVariant[] = [
  { id: 'brute', name: 'Brute', src: Fren1, w: 29, h: 28 },
  { id: 'imp', name: 'Imp', src: Fren2, w: 17, h: 22 },
  { id: 'piggies', name: 'Piggies', src: Fren3, w: 43, h: 22 },
  { id: 'reaper', name: 'Reaper', src: Fren4, w: 28, h: 35 },
  { id: 'yeti', name: 'Yeti', src: Fren5, w: 25, h: 32 },
  { id: 'gator', name: 'Gator', src: Fren6, w: 29, h: 23 },
  { id: 'bones', name: 'Bones', src: Fren7, w: 27, h: 33 },
]

export const PETS: Record<string, PetDefinition> = {
  fumo: {
    id: 'fumo',
    name: 'Milady fumo',
    src: Fumo192,
    srcSet: `${Fumo192Webp} 1x, ${Fumo320Webp} 2x`,
    aspect: 238 / 403,
    height: { desktop: 104, mobile: 76 },
    lines: [
      'miya~',
      'gm fren',
      'stay milady',
      'wagmi',
      'network spirituality',
      'cute & based',
      'u r loved',
      'mint something nice',
      'sip... ah',
      ':3',
      'hehe',
      'remilia remilia',
    ],
    noticeLines: ['!', '?', 'oh hi', 'is that a cursor'],
    wakeLines: ['huh?', 'five more blocks...', 'mmh gm'],
  },
  fren: {
    id: 'fren',
    name: 'fren pet',
    src: Fren1,
    aspect: 29 / 28,
    height: { desktop: 84, mobile: 56 },
    pixel: { scale: { desktop: 3, mobile: 2 } },
    variants: FREN_VARIANTS,
    lines: [
      'feed me',
      'pet me',
      'gm fren',
      'hungy',
      'play with me?',
      'pls pet',
      'wen feed',
      'snack time?',
      'i love u fren',
      '*happy fren noises*',
      'level up?',
      'bonk',
    ],
    noticeLines: ['fren!', '!', 'feed?', 'hi hi'],
    wakeLines: ['mrrp?', 'gm fren', 'was napping...'],
    reactions: {
      perch: ['king of the hill', 'up here fren!', 'comfy'],
      pokeOn: ['boop!', 'splash!', 'beep boop'],
      surfEnd: ['again again', 'hungy now', 'tubular'],
    },
  },
}

export const DEFAULT_PET_ID = 'fumo'

export function getPet(id: string | undefined): PetDefinition {
  return (id && PETS[id]) || PETS[DEFAULT_PET_ID]!
}

export interface PetSprite {
  src: string
  srcSet?: string
  w: number
  h: number
  pixelated: boolean
  variant?: PetVariant
}

/** The sprite to draw for a pet: its variant (saved, else random) at the right size for the screen. */
export function petSprite(pet: PetDefinition, variantId: string | undefined, mobile: boolean, rand = Math.random): PetSprite {
  const variants = pet.variants || []
  const variant = variants.find((v) => v.id === variantId) || variants[Math.floor(rand() * variants.length)]
  if (pet.pixel && variant) {
    const scale = mobile ? pet.pixel.scale.mobile : pet.pixel.scale.desktop
    return { src: variant.src, srcSet: variant.srcSet, w: variant.w * scale, h: variant.h * scale, pixelated: true, variant }
  }

  const h = mobile ? pet.height.mobile : pet.height.desktop
  return {
    src: variant?.src || pet.src,
    srcSet: variant ? variant.srcSet : pet.srcSet,
    w: Math.round(h * pet.aspect),
    h,
    pixelated: !!pet.pixel,
    variant,
  }
}

/** The next variant after `current` (context menu "Next look"). */
export function nextVariant(pet: PetDefinition, current: string | undefined): PetVariant | undefined {
  const v = pet.variants
  if (!v || !v.length) return undefined
  const i = v.findIndex((x) => x.id === current)
  return v[(i + 1) % v.length]
}

export function reactionLines(pet: PetDefinition, kind: PetReaction): string[] {
  return pet.reactions?.[kind] || DEFAULT_REACTIONS[kind]
}

export function pickLine(lines: string[] | undefined, previous?: string): string {
  if (!lines || !lines.length) return ''
  if (lines.length === 1) return lines[0]!
  let line = previous
  while (line === previous) line = lines[Math.floor(Math.random() * lines.length)]
  return line || ''
}

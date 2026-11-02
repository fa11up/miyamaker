import Fumo192 from 'assets/pet/fumo-192.png'
import Fumo192Webp from 'assets/pet/fumo-192.webp'
import Fumo320Webp from 'assets/pet/fumo-320.webp'

/**
 * Desktop pets. Each one is a single transparent sprite (facing right is not required: the doll
 * is flipped with CSS) plus a few lines it says when poked. Animation is CSS/JS only, so a new pet
 * only needs art + lines.
 */
export interface PetDefinition {
  id: string
  name: string
  /** fallback PNG */
  src: string
  /** srcset for <picture>/<img> (webp) */
  srcSet?: string
  /** intrinsic aspect ratio, width / height */
  aspect: number
  /** rendered height on desktop / phones, px */
  height: { desktop: number; mobile: number }
  /** said when clicked */
  lines: string[]
  /** said when the cursor comes close */
  noticeLines?: string[]
  /** said when it wakes up */
  wakeLines?: string[]
}

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
  // 'fren': reserved for the fren pet character. Add its sprite to src/assets/pet/ and an entry here
  // ({ id: 'fren', name: 'fren', src, srcSet, aspect, height, lines }); the Display Properties
  // window lists every entry in this registry automatically.
}

export const DEFAULT_PET_ID = 'fumo'

export function getPet(id: string | undefined): PetDefinition {
  return (id && PETS[id]) || PETS[DEFAULT_PET_ID]!
}

export function pickLine(lines: string[] | undefined, previous?: string): string {
  if (!lines || !lines.length) return ''
  if (lines.length === 1) return lines[0]!
  let line = previous
  while (line === previous) line = lines[Math.floor(Math.random() * lines.length)]
  return line || ''
}

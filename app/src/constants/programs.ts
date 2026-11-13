import MiyaLogo from 'assets/134321870.png'
import CreateNew from 'assets/miyamints1.png?preset=thumbnail&resize=true'

import pfpEngineIcon from 'assets/pfp-engine-icon.png?preset=thumbnail&resize=true'

import Pages from '@/constants/pages'
import type { PageKey } from '@/store/windows/reducer'

export type DesktopApp = { id: PageKey; label: string; src: string | undefined }

/** The programs on the desktop, in its order. */
export const DESKTOP_ICONS: DesktopApp[] = [
  { id: 'mint', label: Pages.mint?.label || 'Mint', src: Pages.mint?.icon?.src },
  { id: 'swap', label: Pages.swap?.label || 'Trade', src: Pages.swap?.icon?.src },
  { id: 'home', label: 'miyanet', src: MiyaLogo },
  { id: 'launch', label: 'Launch', src: CreateNew[0]?.src },
  { id: 'manager', label: Pages.manager?.label || 'Manager', src: Pages.manager?.icon?.src },
  { id: 'auction', label: Pages.auction?.label || 'Auction', src: Pages.auction?.icon?.src },
  { id: 'uploader', label: Pages.uploader?.label || 'Upload', src: Pages.uploader?.icon?.src },
  { id: 'files', label: Pages.files?.label || 'My Files', src: Pages.files?.icon?.src },
  { id: 'display', label: 'Display', src: Pages.display?.icon?.src },
  { id: 'tv', label: Pages.tv?.label || 'miyatv', src: Pages.tv?.icon?.src },
  { id: 'radio', label: Pages.radio?.label || 'miya radio', src: Pages.radio?.icon?.src },
  { id: 'dropmusic', label: Pages.dropmusic?.label || 'Drop Music', src: Pages.dropmusic?.icon?.src },
  { id: 'music', label: Pages.music?.label || 'MiyaMusicMaker', src: Pages.music?.icon?.src },
  { id: 'miyakeys', label: Pages.miyakeys?.label || 'miyakeys', src: Pages.miyakeys?.icon?.src },
  { id: 'pfpEngine', label: 'Miya PFP Engine', src: Pages.pfpEngine?.icon?.src },
]

const pick = (ids: string[]) =>
  DESKTOP_ICONS.filter((app) => ids.includes(app.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))

/** How the Start menu sorts every program. */
export const PROGRAM_GROUPS: { label: string; apps: DesktopApp[] }[] = [
  { label: 'Collect', apps: pick(['mint', 'auction', 'swap']) },
  { label: 'Create', apps: pick(['launch', 'manager', 'uploader', 'dropmusic', 'music', 'miyakeys']) },
  { label: 'Entertainment', apps: pick(['tv', 'radio', 'home']) },
  { label: 'System', apps: pick(['files', 'display']) },
]

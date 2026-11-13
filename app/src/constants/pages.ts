import MiyaLogo from 'assets/134321870.png?preset=icon&resize=true'
import DisplayIcon from 'assets/computer.png?preset=icon&resize=true'
import ExecutableIcon from 'assets/create_new.png?preset=icon&resize=true'
import FilesIcon from 'assets/folder.png?preset=icon&resize=true'
import AuctionIcon from 'assets/icon/auction.png?preset=icon&resize=true'
import DropMusicIcon from 'assets/icon/drop_music.png?preset=icon&resize=true'
import MiyakeysIcon from 'assets/icon/miyakeys.png?preset=icon&resize=true'
import MusicIcon from 'assets/icon/music_maker.png?preset=icon&resize=true'
import RadioIcon from 'assets/icon/radio.png?preset=icon&resize=true'
import MintIcon from 'assets/launchpad_logo.png?preset=icon&resize=true'
import ManageIcon from 'assets/miya_website_logo_2-removebg-preview.png?preset=icon&resize=true'
import LaunchIcon from 'assets/miyamints1.png?preset=icon&resize=true'
import SwapIcon from 'assets/miyaswaps1.png?preset=icon&resize=true'
import TvIcon from 'assets/miyatv.png?preset=icon&resize=true'

import pfpEngineIcon from 'assets/pfp-engine-icon.png?preset=icon&resize=true'

export type Page = {
  id: string
  path: string
  label: string
  icon: ResizedImage | undefined
  minSize: {
    width: number
    height: number
  }
  /** Draws its own shape with no window behind it: only what it paints takes clicks. */
  shaped?: boolean
  /** Moves as one piece when dragged, without the trail of window copies. For windows too heavy to copy. */
  noTrail?: boolean
  /** Always opens at minSize and can't be dragged to another size (maximize still works). */
  fixedSize?: boolean
  /** Rounds the whole window to this radius, in px. */
  corner?: number
  /** On a phone, a window the size of its content over the desktop, not the whole screen. */
  phoneCard?: boolean
}

const Pages: Record<string, Page> = {
  home: {
    id: 'home',
    path: '/about',
    label: 'miyanet',
    icon: MiyaLogo[0],
    minSize: {
      width: 800,
      height: 720,
    },
  },
  mint: {
    id: 'mint',
    path: '/mint',
    label: 'Mint',
    icon: MintIcon[0],
    shaped: true,
    noTrail: true,
    minSize: {
      width: 476,
      height: 710,
    },
  },
  launch: {
    id: 'launch',
    path: '/launch',
    label: 'Launch',
    icon: LaunchIcon[0],
    minSize: {
      width: 920,
      height: 760,
    },
  },
  uploader: {
    id: 'uploader',
    path: '/upload',
    label: 'Infinite Upload',
    icon: ExecutableIcon[0],
    minSize: {
      width: 720,
      height: 500,
    },
  },
  manager: {
    id: 'manager',
    phoneCard: true,
    path: '/manage',
    label: 'Manager',
    icon: ManageIcon[0],
    minSize: {
      width: 720,
      height: 620,
    },
  },
  swap: {
    // Shown as "Trade" (was "miya swaps" at /swap). The id stays 'swap' so saved desktops keep the window;
    // /swap links redirect to /trade (src/pages/Swap/tradePath.ts).
    id: 'swap',
    path: '/trade',
    label: 'Trade',
    icon: SwapIcon[0],
    minSize: {
      width: 1120,
      height: 760,
    },
  },
  auction: {
    id: 'auction',
    path: '/auction',
    label: 'Auction',
    icon: AuctionIcon[0],
    minSize: {
      width: 800,
      height: 720,
    },
  },
  files: {
    id: 'files',
    path: '/files',
    label: 'My Files',
    icon: FilesIcon[0],
    minSize: {
      width: 640,
      height: 520,
    },
  },
  display: {
    id: 'display',
    phoneCard: true,
    path: '/display',
    label: 'Display Properties',
    icon: DisplayIcon[0],
    minSize: {
      width: 420,
      height: 460,
    },
  },
  tv: {
    id: 'tv',
    path: '/tv',
    label: 'miyaTV',
    icon: TvIcon[0],
    fixedSize: true,
    corner: 22,
    minSize: {
      width: 1240,
      height: 700,
    },
  },
  radio: {
    id: 'radio',
    path: '/radio',
    label: 'miya radio',
    icon: RadioIcon[0],
    shaped: true,
    minSize: {
      width: 540,
      height: 397,
    },
  },
  dropmusic: {
    id: 'dropmusic',
    path: '/drop-music',
    label: 'Drop Music',
    icon: DropMusicIcon[0],
    minSize: {
      width: 640,
      height: 700,
    },
  },
  music: {
    id: 'music',
    path: '/music',
    label: 'MiyaMusicMaker',
    icon: MusicIcon[0],
    // Draws inside a shadow root, which the drag trail's copies leave out, so it moves as one piece.
    noTrail: true,
    fixedSize: true,
    minSize: {
      width: 1180,
      height: 760,
    },
  },
  miyakeys: {
    id: 'miyakeys',
    path: '/miyakeys',
    label: 'miyakeys',
    icon: MiyakeysIcon[0],
    // A frame: the trail's copies would be blank, so it moves as one piece.
    noTrail: true,
    minSize: {
      width: 1240,
      height: 780,
    },
  },
  pfpEngine: {
    id: 'pfpEngine',
    path: '/apps/pfp-engine',
    label: 'Miya PFP Engine',
    icon: pfpEngineIcon[0],
    minSize: {
      width: 1024,
      height: 768,
    },
  },
}

export default Pages

import MiyaLogo from 'assets/134321870.png?preset=icon&resize=true'
import DisplayIcon from 'assets/computer.png?preset=icon&resize=true'
import ExecutableIcon from 'assets/create_new.png?preset=icon&resize=true'
import GearIcon from 'assets/executable_gear.png?preset=icon&resize=true'
import FilesIcon from 'assets/folder.png?preset=icon&resize=true'
import AuctionIcon from 'assets/icon/auction.png?preset=icon&resize=true'
import DropMusicIcon from 'assets/icon/drop_music.png?preset=icon&resize=true'
import RadioIcon from 'assets/icon/radio.png?preset=icon&resize=true'
import MintIcon from 'assets/launchpad_logo.png?preset=icon&resize=true'
import ManageIcon from 'assets/miya_website_logo_2-removebg-preview.png?preset=icon&resize=true'
import LaunchIcon from 'assets/miyamints1.png?preset=icon&resize=true'
import SwapIcon from 'assets/miyaswaps1.png?preset=icon&resize=true'
import TvIcon from 'assets/miyatv.png?preset=icon&resize=true'

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
  /** Always opens at minSize and can't be dragged to another size (maximize still works). */
  fixedSize?: boolean
  /** Rounds the whole window to this radius, in px. */
  corner?: number
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
    minSize: {
      width: 800,
      height: 720,
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
  components: {
    id: 'components',
    path: '/components',
    label: 'ComponentZ',
    icon: GearIcon[0],
    minSize: {
      width: 600,
      height: 475,
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
    label: 'miyatv',
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
  station: {
    id: 'station',
    path: '/station',
    label: 'Community station',
    icon: RadioIcon[0],
    minSize: {
      width: 640,
      height: 780,
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
}

export default Pages

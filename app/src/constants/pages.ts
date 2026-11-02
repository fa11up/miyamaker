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
      width: 600,
      height: 475,
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
    id: 'swap',
    path: '/swap',
    label: 'miya swaps',
    icon: SwapIcon[0],
    minSize: {
      width: 520,
      height: 720,
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
    minSize: {
      width: 1100,
      height: 700,
    },
  },
  radio: {
    id: 'radio',
    path: '/radio',
    label: 'miya radio',
    icon: RadioIcon[0],
    minSize: {
      width: 460,
      height: 600,
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

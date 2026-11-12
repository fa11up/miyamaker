/** Each app's code, by page id. The first call downloads it, and later ones return the same download. */
export const APP_LOADERS: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  launch: () => import('@/pages/Launch'),
  home: () => import('@/pages/Home'),
  uploader: () => import('@/pages/Uploader'),
  manager: () => import('@/pages/Manage'),
  auction: () => import('@/pages/Auction'),
  mint: () => import('@/pages/Mint'),
  swap: () => import('@/pages/Swap'),
  files: () => import('@/desktop/files/MyFiles'),
  display: () => import('@/desktop/display/DisplayProperties'),
  tv: () => import('@/pages/TV'),
  radio: () => import('@/pages/Radio'),
  dropmusic: () => import('@/pages/DropMusic'),
  music: () => import('@/pages/MusicMaker'),
  modkeys: () => import('@/pages/Modkeys'),
}

/** Starts an app downloading when someone is about to open it, so the window has its code by the time it's up. */
export function preloadApp(id: string) {
  APP_LOADERS[id]?.().catch(() => {
    // The window shows its own error if this is still failing when it opens.
  })
  // Mint's 3D body is its own download, and it's the first thing Mint needs.
  if (id === 'mint') import('@/pages/Mint/handheld/scene').catch(() => {})
}

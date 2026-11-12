/**
 * The portable desktop program (desktop/miyamusicmaker) serves the built site from this computer. It has no wallet and
 * no /api server, so publishing, minting, and the server's readers (video links) only work on miyamaker.com.
 * No imports, so `node --test` loads it.
 */

export const DESKTOP_PUBLISH_NOTE = 'Publishing and minting work on miyamaker.com, not in the desktop app.'
export const DESKTOP_VIDEO_NOTE = 'Video links work on miyamaker.com, not in the desktop app.'

/** True inside the desktop program. Electron keeps "Electron/<version>" in its user agent and main.js does not change it. */
export function isDesktopApp(agent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return /\bElectron\//.test(String(agent || ''))
}

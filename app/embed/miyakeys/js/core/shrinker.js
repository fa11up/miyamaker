import { validBuild } from './validBuild.js';
import { shareBaseURL, MAX_HASH } from './host.js';

/**
 * Longest share link this page hands out. A build without key images is a few KB (the largest possible one, every key
 * with a 64-character legend and its own colours, is under 100 KB); browsers refuse addresses over 2 MB and chat apps
 * cut far shorter ones, so a link is never allowed to grow towards that.
 */
export const MAX_SHARE_URL = 128 * 1024;

/** A build as base64 of its UTF-8 JSON (the format share links have always used). '' when it cannot be encoded. */
export function encodeState(stateObj) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(stateObj));
    /* In slices: String.fromCharCode(...bytes) on a big build would overflow the call stack. */
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch { return ''; }
}

/** A shared build from its #hash, rebuilt from the allowed fields (validBuild.js); null when it is not one. */
export function decodeState(str) {
  try {
    /* Bytes straight into a typed array and one UTF-8 decode: no per-character strings, so a large hash costs about
       its own size in memory instead of many times it. */
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const build = validBuild(JSON.parse(json));
    /* Nothing valid in it: not a build (the page says so rather than resetting to defaults). */
    return build && Object.keys(build).length ? build : null;
  } catch { return null; }
}

/** Whether a build has any key images (which links leave out). */
export function hasKeyImages(stateObj) {
  const pk = stateObj && stateObj.perKeyOverrides;
  if (!pk || typeof pk !== 'object') return false;
  return Object.keys(pk).some((id) => pk[id] && typeof pk[id] === 'object' && typeof pk[id].imageData === 'string' && pk[id].imageData !== '');
}

/**
 * A link that opens this build, or '' when it cannot be made or would be longer than MAX_SHARE_URL. Key images are
 * left out, as the gallery leaves them out: one image alone would make a link too long to open.
 */
export function shareURL(stateObj) {
  const build = validBuild(stateObj, { images: false });
  if (!build) return '';
  const enc = encodeState(build);
  if (!enc) return '';
  /* Inside miyaOS the window told this page its /miyakeys address (host.js): the link opens that window, which hands
     the hash back to this page. Standing alone, the link is this page. */
  const u = new URL(shareBaseURL());
  u.hash = enc;
  return u.href.length <= MAX_SHARE_URL ? u.href : '';
}

/** The build in this page's own address: a link opened standalone, or the one carried across a shell reload. A hash
 *  over host.js's MAX_HASH is refused before it is decoded (null), as one handed over by the window is. */
export function loadHash() {
  if (!window.location.hash || window.location.hash.length - 1 > MAX_HASH) return null;
  return decodeState(window.location.hash.slice(1));
}

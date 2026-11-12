import { validBuild } from './validBuild.js';
import { shareBaseURL } from './host.js';

export function encodeState(stateObj) {
  try {
    const json = JSON.stringify(stateObj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  } catch { return ''; }
}

/** A shared build from its #hash, rebuilt from the allowed fields (validBuild.js); null when it is not one. */
export function decodeState(str) {
  try {
    const json = decodeURIComponent(atob(str).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    const build = validBuild(JSON.parse(json));
    /* Nothing valid in it: not a build (the page says so rather than resetting to defaults). */
    return build && Object.keys(build).length ? build : null;
  } catch { return null; }
}

export function shareURL(stateObj) {
  const enc = encodeState(stateObj);
  if (!enc) return '';
  /* Inside miyaOS the window told this page its /miyakeys address (host.js): the link opens that window, which hands
     the hash back to this page. Standing alone, the link is this page. */
  const u = new URL(shareBaseURL());
  u.hash = enc;
  return u.href;
}

/** The build in this page's own address: a link opened standalone, or the one carried across a shell reload. */
export function loadHash() {
  if (!window.location.hash) return null;
  return decodeState(window.location.hash.slice(1));
}

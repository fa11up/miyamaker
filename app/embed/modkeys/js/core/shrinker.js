import { cleanSnap } from './cleanSnap.js';

export function encodeState(stateObj) {
  try {
    const json = JSON.stringify(stateObj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  } catch { return ''; }
}

export function decodeState(str) {
  try {
    const json = decodeURIComponent(atob(str).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return cleanSnap(JSON.parse(json));
  } catch { return null; }
}

export function shareURL(stateObj) {
  const enc = encodeState(stateObj);
  if (!enc) return '';
  /* Inside miyaOS this page is a frame of the Modkeys window: the link opens that window (/modkeys), which hands
     its hash back to this page. */
  let u = new URL(window.location.href);
  try {
    if (window.parent !== window) u = new URL('/modkeys', window.parent.location.href);
  } catch { /* not a same-origin parent: link to this page */ }
  u.hash = enc;
  return u.href;
}

export function loadHash() {
  if (!window.location.hash) return null;
  return decodeState(window.location.hash.slice(1));
}

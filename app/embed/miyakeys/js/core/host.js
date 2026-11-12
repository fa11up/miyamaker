/* The miyakeys window (app/src/pages/Miyakeys) shows this page in a sandboxed
 * frame with no allow-same-origin: the page has an opaque origin, cannot read
 * its parent, and its parent cannot reach into it. They talk by postMessage:
 *
 *   window → page  { type: 'miyakeys:init', shareBase, hash }  share links' address and the build to open
 *   window → page  { type: 'miyakeys:visible', visible }        minimised / restored
 *   page → window  { type: 'miyakeys:ready' }                   listening; send init
 *
 * The window says which site it is in the frame's address (?host=<origin>). A
 * message counts only when it comes from the parent window itself, from that
 * origin, and that origin is miyamaker.com or a local dev server. Everything in
 * a message is data: the hash is decoded and validated like any shared link. */

const SITE_ORIGINS = ['https://www.miyamaker.com', 'https://miyamaker.com'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
/** A shared build is a few KB; one with key images can be a few MB. */
const MAX_HASH = 16 * 1024 * 1024;

export function allowedHost(origin) {
  return typeof origin === 'string' && (SITE_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin));
}

/** The window's origin, when this page is its frame; null when the page stands alone (or the claim is not allowed). */
export function hostOrigin() {
  if (window.parent === window) return null;
  let claimed = null;
  try {
    claimed = new URLSearchParams(window.location.search).get('host');
  } catch { /* no query */ }
  return allowedHost(claimed) ? claimed : null;
}

let shareBase = null;

/** Where share links point: the window's /miyakeys inside miyaOS, this page when it stands alone. */
export function shareBaseURL() {
  return shareBase || window.location.href.split('#')[0];
}

/**
 * Listens to the window. `onBuild(hash)` gets the first init's build hash (once); `onVisible(bool)` every
 * minimise/restore. Returns a function that stops listening.
 */
export function listenToHost({ onBuild, onVisible }) {
  const host = hostOrigin();
  if (!host) return () => {};
  let gotInit = false;
  const onMessage = (ev) => {
    if (ev.source !== window.parent || ev.origin !== host) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'miyakeys:init') {
      if (typeof d.shareBase === 'string') {
        try {
          const u = new URL(d.shareBase);
          if (u.origin === host) shareBase = u.origin + u.pathname;
        } catch { /* keep the default */ }
      }
      if (!shareBase) shareBase = host + '/miyakeys';
      if (gotInit) return;
      gotInit = true;
      if (typeof d.hash === 'string' && d.hash.length > 0 && d.hash.length <= MAX_HASH) onBuild(d.hash.replace(/^#/, ''));
      return;
    }
    if (d.type === 'miyakeys:visible' && typeof d.visible === 'boolean') onVisible(d.visible);
  };
  window.addEventListener('message', onMessage);
  window.parent.postMessage({ type: 'miyakeys:ready' }, host);
  return () => window.removeEventListener('message', onMessage);
}

/* The miyakeys window (app/src/pages/Miyakeys) shows this page in a sandboxed
 * frame with no allow-same-origin: the page has an opaque origin, cannot read
 * its parent, and its parent cannot reach into it. They talk by postMessage:
 *
 *   window → page  { type: 'miyakeys:init', shareBase, hash }  share links' address and the build to open
 *   window → page  { type: 'miyakeys:visible', visible }        minimised / restored
 *   page → window  { type: 'miyakeys:ready' }                   listening; send init
 *   page → window  { type: 'miyakeys:activity', kind }          someone is using the page (a press, else once a second)
 *
 * Activity is how the desktop knows the person is still here: their keys and pointer stay inside this frame, so
 * without it the screensaver would start over a board being spun, and a click in here would not bring the window
 * to the front. It carries only what kind of input it was (pointerdown, drag, key, wheel), never where or which key.
 *
 * The window says which site it is in the frame's address (?host=<origin>). A
 * message counts only when it comes from the parent window itself, from that
 * origin, and that origin is miyamaker.com or a local dev server. Everything in
 * a message is data: the hash is decoded and validated like any shared link. */

const SITE_ORIGINS = ['https://www.miyamaker.com', 'https://miyamaker.com'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
/** A shared build is a few KB (a whole board of per-key edits, ~15 KB). Links carry no images, and no browser takes
 * an address much longer than this, so a longer one is refused before it is decoded. */
export const MAX_HASH = 2 * 1024 * 1024;
export const TOO_BIG = 'That shared build is too big to open. Ask for a new link.';
/** Activity goes to the window at most this often. */
export const ACTIVITY_MS = 1000;

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

/** `true` at most once per `ms`: the first call, then the first after `ms` have passed. */
export function throttle(ms, now = () => Date.now()) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < ms) return false;
    last = t;
    return true;
  };
}

/** What kind of activity an input event is, or null when it is not one (a pointer moving with no button held). */
export function activityKind(ev) {
  switch (ev.type) {
    case 'pointerdown': return 'pointerdown';
    case 'pointermove': return ev.buttons ? 'drag' : null;
    case 'keydown': return 'key';
    case 'wheel': return 'wheel';
    default: return null;
  }
}

/* Listened to in the capture phase and passive: activity is only noticed here, never handled (keys are app.js's). */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'];

/**
 * Listens to the window. `onBuild(hash)` gets the first init's build hash (once); `onVisible(bool)` every
 * minimise/restore; `onRefused(message)` (optional) a plain sentence when the build cannot be opened. Tells the
 * window about activity on the page. Returns a function that stops all of it.
 */
export function listenToHost({ onBuild, onVisible, onRefused = (msg) => console.warn(msg), now = () => Date.now() }) {
  const host = hostOrigin();
  if (!host) return () => {};
  const due = throttle(ACTIVITY_MS, now);
  const onActivity = (ev) => {
    const kind = activityKind(ev);
    // A press always goes (it brings the window to the front and closes its menus, and comes only as fast as a
    // finger); moves, keys and the wheel at most once a second.
    if (kind && (kind === 'pointerdown' || due())) window.parent.postMessage({ type: 'miyakeys:activity', kind }, host);
  };
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
      if (typeof d.hash !== 'string' || d.hash.length === 0) return;
      if (d.hash.length > MAX_HASH) onRefused(TOO_BIG);
      else onBuild(d.hash.replace(/^#/, ''));
      return;
    }
    if (d.type === 'miyakeys:visible' && typeof d.visible === 'boolean') onVisible(d.visible);
  };
  window.addEventListener('message', onMessage);
  const opts = { capture: true, passive: true };
  ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, opts));
  window.parent.postMessage({ type: 'miyakeys:ready' }, host);
  return () => {
    window.removeEventListener('message', onMessage);
    ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, opts));
  };
}

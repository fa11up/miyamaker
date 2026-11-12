/* Shell selection.
 *
 * TWO HOSTS, TWO OWNERSHIP MODELS — do not blur them:
 *
 * 1. STANDALONE (index.html): nothing owns the DOM, so selectShell() swaps
 *    the #mShellTpl template content in for #dShell when mobile. It MUST run
 *    before app.js is imported, because app.js's static import graph
 *    (scene.js, controls.js) captures #gl/#stage at module scope.
 *
 * 2. SPA (ModkeysPage.tsx): REACT owns the DOM. ModkeysPage renders the
 *    correct shell natively (isMobile computed synchronously at component
 *    init) and there is NO template and NO swap. Imperatively replacing
 *    React-owned nodes gets reverted by the next reconciliation — that was
 *    the v0.70/0.71 mobile failure: any re-render (e.g. wouter's
 *    useLocation subscription) resurrected the desktop shell, so the phone
 *    never showed .mShell no matter what mobile.css said.
 *
 * On the SPA, selectShell() therefore detects an already-rendered shell and
 * only toggles the html.mk-mobile class + boundary metadata.
 */

export const MOBILE_MQ = '(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))';

/* MOBILE_MQ, worked out from the page's width. A frame that has only just been made can answer the width half of
   the media query from its size before layout (miyaOS's miyakeys window got the phone shell at 1234px); innerWidth
   is current. Pointer type doesn't depend on size. */
export function wantsMobile() {
  const w = window.innerWidth;
  return w <= 768 || (w <= 1024 && window.matchMedia('(pointer: coarse)').matches);
}

export function selectShell() {
  const isMobile = wantsMobile();
  const mTpl = document.getElementById('mShellTpl');
  const alreadyMobile = !!document.querySelector('.mShell');

  if (!alreadyMobile && isMobile && mTpl) {
    /* standalone path: swap template content in for the desktop shell */
    const dApp = document.getElementById('dShell');
    const frag = mTpl.content.cloneNode(true);
    if (dApp) dApp.replaceWith(frag);
    else document.body.prepend(frag);
  }
  if (mTpl) mTpl.remove();

  document.documentElement.classList.toggle('mk-mobile', isMobile);
  document.documentElement.dataset.mkShell = isMobile ? 'mobile' : 'desktop';
  return isMobile;
}

export function isMobileShell() {
  return document.documentElement.classList.contains('mk-mobile');
}

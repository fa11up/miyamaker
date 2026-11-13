import * as THREE from 'three-miyakeys';
import gsap from 'gsap';

import { state, stateSlice } from './core/state.js';
import { registerSyncUI, setState, loadSnap, undo, redo, onPanelRender, effectiveColorway, applyLight } from './core/update.js';
import { rebuildBoard, buildKeys, preloadEmoji, syncKnobColorway } from './core/keyboard.js';
import { ctrl, setView, onKeyEditClick } from './core/controls.js';
import {
  renderer, scene, camera, root, knobGroup, cableGroup, wristGroup,
  matAlpha, matMod, matAccent, matCase, matStem,
  sRGB, applyPlateFinish, applyCapMaterial, uni, onRenderRequest,
} from './core/scene.js';
import { renderPanel, syncUI, showKeyEditor, hideKeyEditor, setupPanelEvents } from './ui/panels.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { openLibrary, openGallery, openSwitchesModal, openAccessories, closeModal, isModalOpen, openShareDialog, showLinkDialog, submitDialog } from './ui/modals.js';
import { isTextEntry } from './ui/textEntry.js';
import { PRESETS } from './data/presets.js';
import { COLORWAYS } from './data/colorways.js';
import { CASES, FINISHES, PLATES, SWITCHES } from './data/components.js';
import { layoutOf } from './data/layouts.js';
import { downloadKLE, copyKLE } from './export/kle.js';
import { downloadSVG } from './export/svg.js';
import { downloadSpec } from './export/spec.js';
import { exportPDF } from './export/pdf.js';
import { decodeState, encodeState, loadHash, shareURL, hasKeyImages, acceptCarry, carryName, MAX_SAVED_BUILDS } from './core/shrinker.js';
import { validBuild, validGalleryEntry } from './core/validBuild.js';
import { listenToHost, MAX_HASH, TOO_BIG } from './core/host.js';
import { showBootError } from './ui/bootError.js';
import { resetHistory, canUndo, canRedo } from './core/history.js';
import { wantsMobile } from './shell.js';

let animationId = null;
let cleanupFns = [];

/* The community gallery is MODKEYS's on nuroctane.xyz: builds shared here show up there, and the other way round.
   The page asks miyamaker.com's own Worker (api/_lib/miyakeys.ts), which forwards to nuroctane.xyz without the
   visitor's address or cookies and checks every build it hands back. Renaming and deleting stay on nuroctane.xyz. */
const GALLERY_API = '/api/miyakeys/gallery';
const GALLERY_TIMEOUT_MS = 10_000;

const MOBILE_MQ = '(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))';

/* Crossing the phone breakpoint reloads the frame into the other shell. The build (key images included) and "Your
   builds" ride across in the frame's window.name, which a reload keeps (history.state does not, in this sandboxed
   frame); it is emptied as soon as the new page starts. Any site can open this page with a window.name of its own, so
   a carry is read only after a reload, only when it is not huge, and with a nonce where the page has session storage
   (shrinker.js acceptCarry). The #hash gets the build without key images as a fallback, short enough for any browser.
   Undo history does not survive the reload, and the page says so. */
const NONCE_KEY = 'miyakeysCarryNonce';

/** The nonce kept for a carry: a string, null when none was kept, undefined when this page has no session storage. */
function keptNonce(keep) {
  try {
    const v = sessionStorage.getItem(NONCE_KEY);
    if (!keep) sessionStorage.removeItem(NONCE_KEY);
    return v;
  } catch {
    return undefined;
  }
}

function carryAcrossReload(savedBuilds) {
  const build = stateSlice();
  const enc = encodeState(validBuild(build, { images: false }) || {});
  try {
    history.replaceState(null, '', location.href.split('#')[0] + (enc ? '#' + enc : ''));
  } catch { /* the carry below still has the build */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(NONCE_KEY, nonce); } catch { /* no storage in the sandboxed frame: the reload check stands alone */ }
  try {
    window.name = carryName(nonce, { build, savedBuilds });
  } catch {
    /* too big to keep: the hash has the build without its images */
  }
}

/** What carryAcrossReload left, checked, once. window.name is always emptied, whatever was in it; with `keep` (the
 *  page is about to reload again) a carry this page wrote stays for the next load and anything else is still emptied. */
function takeCarry(keep = false) {
  let name = '';
  try { name = typeof window.name === 'string' ? window.name : ''; } catch { /* unreadable */ }
  let navType;
  try { navType = performance.getEntriesByType('navigation')[0]?.type; } catch { /* no timing: not a reload */ }
  const carry = acceptCarry(name, navType, keptNonce(keep));
  if (!keep || !carry) {
    try { window.name = ''; } catch { /* nothing to clear */ }
  }
  return carry;
}

export function mountModkeys() {
  /* Shell selection handled by shell.js before this module loads.
     Clean up the template element and bind the breakpoint reload. */
  const mTpl = document.getElementById('mShellTpl');
  if (mTpl) mTpl.remove();
  const boundaryQ = window.matchMedia(MOBILE_MQ);
  /* The other shell needs a fresh page; the build rides along in the hash so it survives the reload. */
  const inMobileShell = document.documentElement.classList.contains('mk-mobile');
  const onBoundary = () => {
    /* A new frame's media query can settle after the page has started; only a real crossing reloads. */
    if (wantsMobile() === inMobileShell) return;
    carryAcrossReload(savedBuilds);
    location.reload();
  };
  /* The page can change size between the shell choice and this listener: if it is now on the other side of the
     breakpoint, reload into the right shell before anything is built. */
  if (wantsMobile() !== inMobileShell) {
    takeCarry(true);
    location.reload();
    return;
  }
  /* Read (and window.name emptied) before anything else runs; applied in finishBoot once the board is up. */
  const carry = takeCarry();
  if (boundaryQ.addEventListener) {
    boundaryQ.addEventListener('change', onBoundary);
    cleanupFns.push(() => boundaryQ.removeEventListener('change', onBoundary));
  }

  registerSyncUI(syncUI);
  setupPanelEvents();

  /* sidebar nav */
  document.querySelectorAll('.snav button').forEach((btn) => {
    btn.addEventListener('click', () => renderPanel(btn.dataset.sec));
  });

  /* Builds shared from here are also kept in this list, in memory: they go when miyakeys closes (the frame has no
     storage of its own; a breakpoint reload carries them, see carryAcrossReload). Only builds the gallery took. */
  const savedBuilds = [];
  /* Thumbnails by id, { url, approx }. Featured and community builds apart, so a community entry can never show a
     featured build's picture; Maps, so no id reaches Object.prototype. */
  const presetThumbs = new Map();
  const communityThumbs = new Map();
  window.__MODKEYS__ = { savedBuilds, presetThumbs, communityThumbs, getState: stateSlice, loadState: loadBuildState };

  const nextName = () => 'Build ' + String(savedBuilds.length + 1).padStart(2, '0');

  /* "Share to gallery" asks first (modals.js): the build goes public on nuroctane.xyz and only nuroctane can take it
     down. Key images stay here: the gallery does not store them. */
  let sharing = false;
  let galleryGen = 0;
  async function shareBuild(rawName) {
    if (sharing) return { ok: false, message: 'Already sharing this build.' };
    sharing = true;
    try {
      const name = String(rawName || '').trim().slice(0, 40) || nextName();
      renderer.render(scene, camera);
      const snap = stateSlice();
      /* Kept in "Your builds" only once the gallery has taken it: a failed or repeated try adds nothing. */
      const mine = { name, snap, layout: state.layout, img: renderer.domElement.toDataURL('image/png') };
      let res;
      try {
        res = await fetch(GALLERY_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, snap: validBuild(snap, { images: false }) }),
          signal: AbortSignal.timeout(GALLERY_TIMEOUT_MS),
          credentials: 'omit',
        });
      } catch (e) {
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError'))
          return { ok: false, message: 'The gallery did not answer in time, so it may or may not have been shared. Open Gallery in a minute to check before trying again.' };
        return { ok: false, message: 'Gallery offline: not shared. Try again later.' };
      }
      if (res.ok) {
        savedBuilds.push(mine);
        /* Kept in memory, images and all: only the newest few stay. */
        const dropped = savedBuilds.length > MAX_SAVED_BUILDS;
        if (dropped) savedBuilds.splice(0, savedBuilds.length - MAX_SAVED_BUILDS);
        /* The next Gallery asks again, and a list already on its way (from before this share) is not kept. */
        galleryGen++;
        window.__MODKEYS__.galleryCache = undefined;
        return {
          ok: true,
          message: 'Shared to the community gallery. It is also in Your builds until you close miyakeys.' +
            (dropped ? ' Your builds keeps the newest ' + MAX_SAVED_BUILDS + ', so the oldest one there was let go.' : ''),
        };
      }
      if (res.status === 504)
        return { ok: false, message: 'The gallery did not answer in time, so it may or may not have been shared. Open Gallery in a minute to check before trying again.' };
      /* For a limit, an upstream failure or sharing being paused, the Worker's own `error` is plain words and says how
         long to wait (the site-wide limit can be up to an hour); the copy below is only for when it has none. */
      let said = '';
      if (res.status === 429 || res.status === 502 || res.status === 503) {
        try {
          const body = await res.json();
          said = typeof body?.error === 'string' ? body.error.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 200) : '';
        } catch { /* no words: the copy below */ }
      }
      if (said) return { ok: false, message: 'Not shared. ' + said };
      if (res.status === 429) return { ok: false, message: 'Too many shares just now: not shared. Try again in a minute.' };
      if (res.status === 503) return { ok: false, message: 'Sharing is paused just now: not shared. Try again later.' };
      return { ok: false, message: 'The gallery turned it down: not shared.' };
    } finally {
      sharing = false;
    }
  }
  window.__MODKEYS__.shareBuild = shareBuild;

  document.getElementById('saveBuild').addEventListener('click', () => openShareDialog(nextName()));

  /* view pills */
  document.getElementById('pills').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !b.dataset.view) return;
    setView(b.dataset.view);
  });

  /* toolbar */
  document.getElementById('toolHand').addEventListener('click', () => {
    state.tool = state.tool === 'pan' ? 'orbit' : 'pan';
    document.querySelectorAll('.toolbar button').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
  });
  document.getElementById('toolReset').addEventListener('click', () => {
    ctrl.theta = -0.58;
    ctrl.phi = 1.02;
    ctrl.radius = 10.6;
    ctrl.target.set(0, -0.08, 0);
    ctrl.vT = ctrl.vP = 0;
    setView('3d');
  });

  /* undo/redo/share */
  document.getElementById('toolUndo')?.addEventListener('click', () => {
    const ok = undo();
    if (!ok) toast('Nothing to undo');
  });
  document.getElementById('toolRedo')?.addEventListener('click', () => {
    const ok = redo();
    if (!ok) toast('Nothing to redo');
  });
  /* Links leave key images out, as the gallery does: one image would make a link too long for a browser to open. */
  document.getElementById('toolShare')?.addEventListener('click', async () => {
    const snap = stateSlice();
    const url = shareURL(snap);
    if (!url) { toast('This build is too long to fit in a link.'); return; }
    const imagesLeftOut = hasKeyImages(snap);
    try {
      await navigator.clipboard.writeText(url);
      toast(imagesLeftOut ? 'Share link copied. Key images aren\'t included in links.' : 'Share link copied');
    } catch {
      /* No clipboard here (a browser that keeps it from frames): show the link to copy by hand. */
      showLinkDialog(url, { imagesLeftOut });
    }
  });

  /* export buttons */
  document.getElementById('exportKLE').addEventListener('click', () => {
    downloadKLE();
  });
  document.getElementById('exportSVG').addEventListener('click', () => {
    downloadSVG();
  });
  document.getElementById('exportSpec').addEventListener('click', () => {
    downloadSpec();
  });
  document.getElementById('copyKLE')?.addEventListener('click', () => {
    copyKLE();
    toast('KLE layout copied to clipboard');
  });
  document.getElementById('exportPDF')?.addEventListener('click', () => {
    exportPDF().catch(() => toast('PDF export failed'));
  });

  /* theme */
  initTheme();

  /* top nav: was decorative markup with no handlers; now routes to the
     matching modal. Same wiring serves both shells. */
  document.getElementById('tnav')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-nav]');
    if (!b) return;
    document.querySelectorAll('#tnav button').forEach((x) => x.classList.toggle('on', x === b));
    const nav = b.dataset.nav;
    if (nav === 'builder') closeModal();
    else if (nav === 'gallery') openGallery();
    else if (nav === 'keycaps') openLibrary();
    else if (nav === 'switches') openSwitchesModal();
    else if (nav === 'accessories') openAccessories();
  });

  /* library open button */
  document.getElementById('panelBody').addEventListener('click', (ev) => {
    if (ev.target.closest('#libOpen')) openLibrary();
  });

  /* featured builds carousel (desktop shell only) */
  document.getElementById('builds')?.addEventListener('click', (ev) => {
    const card = ev.target.closest('.bcard');
    if (!card) return;
    const p = PRESETS.find((x) => x.id === card.dataset.id);
    if (!p) return;
    /* loadSnap clears leftover photo per-key colours / custom board tints */
    loadSnap(Object.assign({}, p.s), { selectedPreset: p.id });
    toast(p.name + ' loaded');
  });

  /* lazy gallery fetch
     Array (including []) = successful fetch, memoized.
     The array's `more` is true when the gallery has more builds than it sent (the newest 500 come).
     null = the gallery could not be read (offline, slow, or an answer that is not a gallery); not memoized, the
     next call retries. Only a real, empty list is "no community builds yet".
     galleryGen goes up when a share lands: a list fetched before that may not have the new build, so it is neither
     cached nor shown; it is asked for again. Calls while one fetch is on its way share it. */
  let inFlight = null;
  async function fetchGallery(gen) {
    try {
      const res = await fetch(GALLERY_API, { signal: AbortSignal.timeout(GALLERY_TIMEOUT_MS), credentials: 'omit' });
      if (!res.ok) throw new Error('gallery ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.templates)) throw new Error('not a gallery');
      /* The Worker checked these already; checked again here so a page served elsewhere is no weaker. */
      const gc = data.templates.map(validGalleryEntry).filter(Boolean);
      /* The Worker passes on the newest 500 at most and then says `more: true`: the gallery says it shows only those. */
      gc.more = data.more === true;
      if (gen === galleryGen) window.__MODKEYS__.galleryCache = gc;
      return gc;
    } catch {
      if (gen === galleryGen) window.__MODKEYS__.galleryCache = null;
      return null;
    }
  }
  window.__MODKEYS__.loadGallery = function loadGallery() {
    if (Array.isArray(window.__MODKEYS__.galleryCache)) return Promise.resolve(window.__MODKEYS__.galleryCache);
    if (inFlight && inFlight.gen === galleryGen) return inFlight.promise;
    const gen = galleryGen;
    const promise = fetchGallery(gen).then((list) => {
      if (inFlight && inFlight.promise === promise) inFlight = null;
      return gen === galleryGen ? list : loadGallery();
    });
    inFlight = { gen, promise };
    return promise;
  };

  /* Thumbnails for cards, drawn a few per frame (as many as fit in a short time budget) so a long gallery never
     freezes the page. `entries` are { id, snap }; each one lands in `store` as { url, approx } and `onThumb(id, thumb)`
     is called as it is drawn. Returns a function that stops the rest. */
  const THUMB_BUDGET_MS = 12;
  function thumbJob(entries, store, onThumb) {
    const todo = entries.filter((t) => t.snap && !store.has(t.id));
    let stopped = false;
    const step = () => {
      if (stopped || !todo.length) return;
      const save = beginThumbRender();
      const t0 = performance.now();
      try {
        /* At least one per frame, then as many as fit in the budget. */
        do {
          const t = todo.shift();
          try {
            const thumb = renderSnapThumb(t.snap, save);
            store.set(t.id, thumb);
            onThumb(t.id, thumb);
          } catch {
            /* thumbnail failed: the card keeps its colour swatch */
          }
        } while (todo.length && performance.now() - t0 < THUMB_BUDGET_MS);
      } finally {
        endThumbRender(save);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => { stopped = true; };
  }
  window.__MODKEYS__.renderThumbs = (entries, onThumb) => thumbJob(entries, communityThumbs, onThumb);

  /* key editor / Customize selection */
  onKeyEditClick((keyData) => {
    showKeyEditor(keyData, {
      multi: !!(keyData._multi || keyData._shiftKey),
      shiftKey: !!keyData._shiftKey,
    });
  });

  /* keyboard shortcuts */
  const keyHandler = (ev) => {
    requestRender();
    /* One Escape closes one thing: the dialog on top, else the phone Export menu, else it leaves the field being
       typed in (a legend, a colour), and only the next Escape closes the key editor. */
    if (ev.key === 'Escape') {
      const menu = document.getElementById('mExportMenu');
      if (isModalOpen()) {
        ev.preventDefault();
        closeModal();
      } else if (menu && menu.classList.contains('open')) {
        ev.preventDefault();
        closeExportMenu(true);
      } else if (isTextEntry(ev.target)) {
        const field = document.activeElement;
        if (field && field !== document.body && typeof field.blur === 'function') field.blur();
      } else {
        hideKeyEditor();
      }
      return;
    }
    /* Enter in a dialog's field presses its button: the frame's sandbox blocks form submission. */
    if (ev.key === 'Enter' && submitDialog(ev.target)) {
      ev.preventDefault();
      return;
    }
    if (isTextEntry(ev.target)) return;
    const mod = (ev.ctrlKey || ev.metaKey) && !ev.altKey;
    /* ev.key is 'Z' with Shift or Caps Lock on, so compare in lower case. Cmd+Shift+Z is redo on a Mac. On a layout
       without Latin letters (Russian, Greek, Hebrew…) ev.key is that script's letter: then the physical key counts. */
    const k = (ev.key || '').toLowerCase();
    const latin = /^[a-z]$/.test(k);
    const isZ = latin ? k === 'z' : ev.code === 'KeyZ';
    const isY = latin ? k === 'y' : ev.code === 'KeyY';
    if (mod && isZ && !ev.shiftKey) {
      ev.preventDefault();
      const ok = undo();
      if (!ok) toast('Nothing to undo');
      else toast('Undo');
    } else if (mod && (isY || (isZ && ev.shiftKey))) {
      ev.preventDefault();
      const ok = redo();
      if (!ok) toast('Nothing to redo');
      else toast('Redo');
    }
  };
  document.addEventListener('keydown', keyHandler);
  cleanupFns.push(() => document.removeEventListener('keydown', keyHandler));

  /* phone Export menu (mobile shell only); Escape closes it too (keyHandler) */
  function closeExportMenu(refocus) {
    const mMenu = document.getElementById('mExportMenu');
    const mToggle = document.getElementById('mExportToggle');
    if (!mMenu || !mMenu.classList.contains('open')) return;
    mMenu.classList.remove('open');
    mToggle?.setAttribute('aria-expanded', 'false');
    if (refocus) mToggle?.focus();
  }

  /* resize */
  const stage = document.getElementById('stage');
  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  cleanupFns.push(() => ro.disconnect());

  /* thumbnail generation helpers
     A thumbnail shows the build's own board: its layout, profile, legends (brand), colours, per-key edits, material,
     finish, case, plate, switches, extras and lighting. Keys are rebuilt for it only when they differ from what is on
     the board already, and never while the live board is exploded or has keys selected (rebuilding would drop
     that): then the card is marked "preview approximate". Everything is put back afterwards. */
  const keysOf = (s, images) => JSON.stringify([s.layout, s.profile, s.brand, s.colorway, s.customColors || null, s.perKeyOverrides || {}, images]);
  function beginThumbRender() {
    const r = stage.getBoundingClientRect();
    renderer.setPixelRatio(1);
    renderer.setSize(460, 272, false);
    camera.aspect = 460 / 272;
    camera.updateProjectionMatrix();
    const sc = { theta: ctrl.theta, phi: ctrl.phi, radius: ctrl.radius, ty: ctrl.target.y };
    ctrl.theta = -0.58;
    ctrl.phi = 1.02;
    ctrl.radius = 11.4;
    ctrl.target.y = -0.08;
    ctrl.apply();
    const uTime = uni.uTime.value;
    uni.uTime.value = 2.2;
    const snap = stateSlice();
    const liveKeys = keysOf(validBuild(snap, { images: false }) || {}, hasKeyImages(snap));
    return {
      r, sc, snap, uTime,
      pk: state.perKeyOverrides,
      liveKeys,
      built: liveKeys,
      builtLayout: state.layout,
      canRebuild: !state.exploded && !state.selectedKey && !(state.selectedKeys && state.selectedKeys.length),
    };
  }
  function endThumbRender(save) {
    /* The live map is put back as it was (it keeps its null prototype, perKey.js). */
    const { perKeyOverrides: _keep, ...rest } = save.snap;
    Object.assign(state, rest);
    state.perKeyOverrides = save.pk;
    ctrl.theta = save.sc.theta;
    ctrl.phi = save.sc.phi;
    ctrl.radius = save.sc.radius;
    ctrl.target.y = save.sc.ty;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(save.r.width, save.r.height, false);
    camera.aspect = save.r.width / save.r.height;
    camera.updateProjectionMatrix();
    if (save.built !== save.liveKeys) {
      if (save.builtLayout !== state.layout) rebuildBoard();
      else buildKeys();
    }
    /* The live build's own colours (custom roles included), surfaces and lighting, not the last thumbnail's. */
    const cw = effectiveColorway();
    if (cw) {
      matAlpha.color.copy(sRGB(cw.a.bg));
      matMod.color.copy(sRGB(cw.m.bg));
      matAccent.color.copy(sRGB(cw.x.bg));
    }
    syncKnobColorway();
    applyCapMaterial(state.material);
    setFinish(state.finish);
    matCase.color.copy(sRGB(state.caseCustomColor || CASES[state.caseColor].c));
    applyPlateFinish(state.plate, state.plateColor || PLATES[state.plate].c);
    matStem.color.copy(sRGB(state.switchColor || SWITCHES[state.sw].dot));
    setExtrasVisible(state.layout, state.extras);
    applyLight();
    /* setSize above cleared the canvas: the live board is drawn again now, in this same task, so it is never left
       blank between thumbnail batches (a queued frame would land only after the next batch has cleared it again). */
    ctrl.apply();
    uni.uTime.value = save.uTime;
    renderer.render(scene, camera);
    requestRender();
  }
  function setFinish(id) {
    const f = FINISHES[id];
    if (!f) return;
    matCase.metalness = f.metal;
    matCase.roughness = f.rough;
    matCase.clearcoat = f.cc;
  }
  function setExtrasVisible(layout, extras) {
    knobGroup.visible = !!(layoutOf(layout).knob && extras.knob);
    cableGroup.visible = !!extras.cable;
    wristGroup.visible = !!extras.wrist;
  }
  /** Draws one build (the same precedence as loadSnap: its own colours first, then its colourway; a field it does
   *  not have is the live build's, a tint it does not have is the default). Returns { url, approx }. */
  function renderSnapThumb(raw, save) {
    const b = validBuild(raw, { images: false }) || {};
    const live = save.snap;
    const keys = {
      layout: b.layout || live.layout,
      profile: b.profile || live.profile,
      brand: b.brand || live.brand,
      colorway: b.colorway || live.colorway,
      customColors: b.customColors || null,
      perKeyOverrides: b.perKeyOverrides || Object.create(null),
    };
    const extras = Object.assign({}, live.extras, b.extras);
    state.extras = extras;
    let approx = false;
    const want = keysOf(keys, false);
    if (want !== save.built) {
      if (save.canRebuild) {
        Object.assign(state, keys);
        if (keys.layout !== save.builtLayout) {
          rebuildBoard();
          save.builtLayout = keys.layout;
        } else buildKeys();
        save.built = want;
      } else approx = true;
    }
    if (!approx) {
      /* What the keys were built with is what the knob and legends use. */
      state.colorway = keys.colorway;
      state.customColors = keys.customColors;
    }
    const cw = keys.customColors || COLORWAYS[keys.colorway];
    if (cw) {
      matAlpha.color.copy(sRGB(cw.a.bg));
      matMod.color.copy(sRGB(cw.m.bg));
      matAccent.color.copy(sRGB(cw.x.bg));
    }
    if (!approx) syncKnobColorway();
    applyCapMaterial(b.material || live.material);
    setFinish(b.finish || live.finish);
    matCase.color.copy(sRGB(b.caseCustomColor || CASES[b.caseColor || live.caseColor].c));
    const pid = b.plate || live.plate;
    applyPlateFinish(pid, b.plateColor || PLATES[pid].c);
    matStem.color.copy(sRGB(b.switchColor || SWITCHES[b.sw || live.sw].dot));
    setExtrasVisible(save.builtLayout, extras);
    state.light = Object.assign({}, live.light, b.light);
    applyLight();
    renderer.render(scene, camera);
    return { url: renderer.domElement.toDataURL('image/png'), approx };
  }
  /* Featured builds: drawn after boot, a few per frame; each carousel card gets its picture as it lands. */
  function genThumbs() {
    const picture = (url) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      return img;
    };
    return thumbJob(PRESETS.map((p) => ({ id: p.id, snap: p.s })), presetThumbs, (id, thumb) => {
      const card = [...document.querySelectorAll('#builds .bcard')].find((c) => c.dataset.id === id);
      card?.querySelector('.img')?.replaceChildren(picture(thumb.url));
      /* and the Gallery's featured card, when it is open before every picture is drawn */
      const gal = [...document.querySelectorAll('#modalBody [data-gal]')].find((c) => c.dataset.gal === id);
      gal?.querySelector('.img')?.replaceWith(picture(thumb.url));
    });
  }

  /* Drawing, on demand. A frame is drawn when something changed: the camera moved or is still gliding, a tween is
     running (gsap), the build changed (setState → syncUI), the stage was resized, an image finished loading
     (requestRender from scene.js), or the person did something (input events below). The underglow's wave and
     breathe keep drawing while they animate, unless reduced motion is asked for (then they hold still at one moment).
     Nothing at all runs while the tab is hidden or the miyakeys window is minimised (host.js). */
  const timer = new THREE.Timer();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const STILL_TIME = 2.2;
  let hostVisible = true;
  let dirty = true;
  let lastPose = '';
  const running = () => !document.hidden && hostVisible;
  let undoShown = '';
  const undoToggle = () => {
    const u = canUndo();
    const r = canRedo();
    const shown = u + ',' + r;
    if (shown === undoShown) return;
    undoShown = shown;
    document.getElementById('toolUndo')?.toggleAttribute('disabled', !u);
    document.getElementById('toolRedo')?.toggleAttribute('disabled', !r);
  };
  const lightMoving = () =>
    !reducedMotion.matches && (state.light.mode === 'wave' || state.light.mode === 'breathe');
  /* A running tween on anything but a page element (the toast, the loader) moves the board. A delayed call has no
     element either: it is about to change the board. */
  const tweening = () => gsap.globalTimeline.getChildren(true, true, false).some((t) => {
    const targets = t.targets();
    return !targets.length || targets.some((x) => !(x instanceof Element));
  });
  function tick(now) {
    animationId = null;
    if (!running()) return;
    timer.update(now);
    let gliding = false;
    if (Math.abs(ctrl.vT) > 1e-4 || Math.abs(ctrl.vP) > 1e-4) {
      ctrl.theta += ctrl.vT;
      ctrl.phi += ctrl.vP;
      ctrl.vT *= 0.9;
      ctrl.vP *= 0.9;
      gliding = true;
    }
    ctrl.apply();
    const pose = ctrl.theta + ',' + ctrl.phi + ',' + ctrl.radius + ',' + ctrl.target.x + ',' + ctrl.target.y + ',' + ctrl.target.z;
    const moved = pose !== lastPose;
    lastPose = pose;
    const animating = lightMoving() || tweening();
    if (dirty || moved || gliding || animating) {
      dirty = false;
      uni.uTime.value = reducedMotion.matches ? STILL_TIME : timer.getElapsed();
      renderer.render(scene, camera);
      undoToggle();
      /* One more frame after any change, to see whether it has settled. */
      animationId = requestAnimationFrame(tick);
    }
  }
  function startLoop() {
    if (animationId === null && running()) animationId = requestAnimationFrame(tick);
  }
  function requestRender() {
    dirty = true;
    startLoop();
  }
  onRenderRequest(requestRender);
  registerSyncUI((skipPanel) => {
    syncUI(skipPanel);
    requestRender();
  });
  const onVisibility = () => requestRender();
  document.addEventListener('visibilitychange', onVisibility);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  reducedMotion.addEventListener?.('change', onVisibility);
  cleanupFns.push(() => reducedMotion.removeEventListener?.('change', onVisibility));
  /* The person doing something may change the board outside setState (per-key edits, the knob, hover, theme): draw.
     A pointer moving with no button held only wakes the loop, which draws if the camera or a tween moved. Keys are
     keyHandler's (one keydown listener). Capture phase and passive: noticed here, never handled. */
  const onInput = (ev) => {
    if (ev.type === 'pointermove' && !ev.buttons) startLoop();
    else requestRender();
  };
  const INPUT_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'click', 'input', 'change', 'keyup'];
  const inputOpts = { capture: true, passive: true };
  INPUT_EVENTS.forEach((type) => document.addEventListener(type, onInput, inputOpts));
  cleanupFns.push(() => INPUT_EVENTS.forEach((type) => document.removeEventListener(type, onInput, inputOpts)));

  /* A build handed over by the window (/miyakeys#<build>), applied once the board is up. The page's own #hash wins:
     that is the build carried across a shell reload, newer than the link the window was opened with. */
  let booted = false;
  let hostHash = null;
  function openHostBuild() {
    if (!booted || hostHash === null) return;
    const hash = hostHash;
    hostHash = null;
    if (window.location.hash) return;
    const snap = decodeState(hash);
    if (!snap) { toast('That shared build could not be opened'); return; }
    loadSnap(snap, { selectedPreset: null });
    resetHistory(stateSlice());
    requestRender();
  }
  cleanupFns.push(listenToHost({
    onBuild: (hash) => { hostHash = hash; openHostBuild(); },
    onVisible: (visible) => { hostVisible = visible; requestRender(); },
    onRefused: (message) => toast(message),
  }));

  /* boot */
  preloadEmoji();
  rebuildBoard();
  resize();
  ctrl.apply();
  startLoop();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        finishBoot();
      } catch (e) {
        showBootError(e);
      }
    });
  });

  function finishBoot() {
    /* A breakpoint reload's carry (carryAcrossReload): the build with its key images, and Your builds. */
    if (carry) savedBuilds.push(...carry.savedBuilds);
    const carried = carry && carry.build;
    if (carried) {
      loadSnap(carried, { selectedPreset: null });
      toast('Your build was kept. Undo history starts over after the window changes size.');
    } else if (window.location.hash.length - 1 > MAX_HASH) {
      /* The same cap as a hash handed over by the window (host.js): refused before it is decoded. */
      toast(TOO_BIG);
    } else if (window.location.hash) {
      /* restore shared URL: a bad one is said so, and the page goes on with its own build */
      try {
        const hashData = loadHash();
        if (hashData) {
          loadSnap(hashData, { selectedPreset: null });
          if (carry) toast('Your build was kept, without its key images. Undo history starts over after the window changes size.');
        } else toast('That shared build could not be opened');
      } catch (e) {
        console.error(e);
        toast('That shared build could not be opened');
      }
    }
    resetHistory(stateSlice());
    booted = true;
    openHostBuild();
    /* populate featured builds carousel (desktop shell only); pictures arrive from genThumbs */
    const buildsEl = document.getElementById('builds');
    if (buildsEl) buildsEl.innerHTML = PRESETS.map((p) =>
      `<button class="bcard" data-id="${p.id}">
         <div class="img" style="background:${COLORWAYS[p.s.colorway].a.bg}"></div>
         <div class="nm">${p.name}</div>
       </button>`
    ).join('');
    genThumbs();
    /* featured builds: the cards wrap into rows (no sideways scrolling inside a window), and the arrows step one row
       up or down */
    const btrack = document.getElementById('builds');
    const aL = document.getElementById('scrollL');
    const aR = document.getElementById('scrollR');
    if (btrack && aL && aR) {
      const step = () => {
        const card = btrack.querySelector('.bcard');
        return card ? card.offsetHeight + 14 : 160;
      };
      const syncArrows = () => {
        const max = btrack.scrollHeight - btrack.clientHeight;
        aL.disabled = btrack.scrollTop <= 2;
        aR.disabled = btrack.scrollTop >= max - 2;
      };
      const smooth = () => (reducedMotion.matches ? 'auto' : 'smooth');
      aL.addEventListener('click', () => btrack.scrollBy({ top: -step(), behavior: smooth() }));
      aR.addEventListener('click', () => btrack.scrollBy({ top: step(), behavior: smooth() }));
      btrack.addEventListener('scroll', syncArrows, { passive: true });
      window.addEventListener('resize', syncArrows);
      requestAnimationFrame(syncArrows);
    }

    /* mobile actions bar: proxy taps to the real (hidden on mobile)
       sidebar buttons so save/export logic stays defined in one place */
    const mMenu = document.getElementById('mExportMenu');
    const mToggle = document.getElementById('mExportToggle');
    if (mMenu && mToggle) {
      mToggle.setAttribute('aria-haspopup', 'true');
      mToggle.setAttribute('aria-expanded', 'false');
      mMenu.addEventListener('click', () => closeExportMenu(false));
      mToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = mMenu.classList.toggle('open');
        mToggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', (ev) => {
        if (mMenu.classList.contains('open') && !mMenu.contains(ev.target) && ev.target !== mToggle) {
          closeExportMenu(false);
        }
      });
    }
    onPanelRender(renderPanel);
    renderPanel('keycaps');
    syncUI();
    setView('3d');
    const rm = reducedMotion.matches;
    if (!rm) {
      gsap.from(root.scale, {
        x: 0.45 * 0.9, y: 0.45 * 0.9, z: 0.45 * 0.9,
        duration: 1.1, ease: 'power3.out',
      });
      gsap.from(root.rotation, {
        y: -0.4, duration: 1.3, ease: 'power3.out',
      });
    }
    gsap.to(document.getElementById('loader'), {
      opacity: 0, duration: rm ? 0.2 : 0.5,
      onComplete: () => document.getElementById('loader')?.remove(),
    });
    requestRender();
  }
}

function loadBuildState(buildState) {
  loadSnap(buildState, { selectedPreset: null });
  resetHistory(stateSlice());
  syncUI();
}

export function unmountModkeys() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}

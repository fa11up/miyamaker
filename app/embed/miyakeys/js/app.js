import * as THREE from 'three-miyakeys';
import gsap from 'gsap';

import { state, stateSlice } from './core/state.js';
import { registerSyncUI, setState, loadSnap, undo, redo, onPanelRender, effectiveColorway, applyLight } from './core/update.js';
import { rebuildBoard, preloadEmoji } from './core/keyboard.js';
import { ctrl, setView, onKeyEditClick } from './core/controls.js';
import {
  renderer, scene, camera, root,
  matAlpha, matMod, matAccent, matCase, matPlate, matStem,
  capMat, sRGB, applyPlateFinish, uni,
} from './core/scene.js';
import { renderPanel, syncUI, showKeyEditor, hideKeyEditor, setupPanelEvents } from './ui/panels.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { openLibrary, openGallery, openSwitchesModal, openAccessories, closeModal, isModalOpen, openShareDialog, showLinkDialog } from './ui/modals.js';
import { isTextEntry } from './ui/textEntry.js';
import { PRESETS } from './data/presets.js';
import { COLORWAYS } from './data/colorways.js';
import { CASES, PLATES, SWITCHES } from './data/components.js';
import { downloadKLE, copyKLE } from './export/kle.js';
import { downloadSVG } from './export/svg.js';
import { downloadSpec } from './export/spec.js';
import { exportPDF } from './export/pdf.js';
import { decodeState, encodeState, loadHash, shareURL } from './core/shrinker.js';
import { validBuild, validGalleryEntry } from './core/validBuild.js';
import { listenToHost } from './core/host.js';
import { showBootError } from './ui/bootError.js';
import { clearAllOverrides } from './core/perKey.js';
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
    const enc = encodeState(stateSlice());
    if (enc) history.replaceState(null, '', '#' + enc);
    location.reload();
  };
  /* The page can change size between the shell choice and this listener: if it is now on the other side of the
     breakpoint, reload into the right shell before anything is built. */
  if (wantsMobile() !== inMobileShell) {
    location.reload();
    return;
  }
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
     storage of its own). */
  const savedBuilds = [];
  const thumbs = {};
  window.__MODKEYS__ = { savedBuilds, thumbs, getState: stateSlice, loadState: loadBuildState };

  const nextName = () => 'Build ' + String(savedBuilds.length + 1).padStart(2, '0');

  /* "Share to gallery" asks first (modals.js): the build goes public on nuroctane.xyz and only nuroctane can take it
     down. Key images stay here: the gallery does not store them. */
  let sharing = false;
  async function shareBuild(rawName) {
    if (sharing) return { ok: false, message: 'Already sharing this build.' };
    sharing = true;
    try {
      const name = String(rawName || '').trim().slice(0, 40) || nextName();
      renderer.render(scene, camera);
      const snap = stateSlice();
      savedBuilds.push({ name, snap, layout: state.layout, img: renderer.domElement.toDataURL('image/png') });
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
          return { ok: false, message: 'The gallery did not answer in time, so it may or may not have been shared. Open Gallery in a minute to check. Your copy is kept until you close miyakeys.' };
        return { ok: false, message: 'Gallery offline: not shared. Your copy is kept until you close miyakeys.' };
      }
      if (res.ok) {
        window.__MODKEYS__.galleryCache = undefined; /* the next Gallery shows it */
        return { ok: true, message: 'Shared to the community gallery. Your copy is kept until you close miyakeys.' };
      }
      if (res.status === 504)
        return { ok: false, message: 'The gallery did not answer in time, so it may or may not have been shared. Open Gallery in a minute to check. Your copy is kept until you close miyakeys.' };
      if (res.status === 429) return { ok: false, message: 'Too many shares just now: not shared. Try again in a minute. Your copy is kept until you close miyakeys.' };
      return { ok: false, message: 'The gallery turned it down: not shared. Your copy is kept until you close miyakeys.' };
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
  document.getElementById('toolShare')?.addEventListener('click', async () => {
    const url = shareURL(stateSlice());
    if (!url) { toast('Could not create share link'); return; }
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied');
    } catch {
      /* No clipboard here (a browser that keeps it from frames): show the link to copy by hand. */
      showLinkDialog(url);
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

  /* lazy gallery fetch */
  window.__MODKEYS__.loadGallery = async function loadGallery() {
    /* Array (including []) = successful fetch, memoized.
       null = the gallery could not be read (offline, slow, or an answer that is not a gallery); not memoized, the
       next call retries. Only a real, empty list is "no community builds yet". */
    if (Array.isArray(window.__MODKEYS__.galleryCache)) return window.__MODKEYS__.galleryCache;
    try {
      const res = await fetch(GALLERY_API, { signal: AbortSignal.timeout(GALLERY_TIMEOUT_MS), credentials: 'omit' });
      if (!res.ok) throw new Error('gallery ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.templates)) throw new Error('not a gallery');
      /* The Worker checked these already; checked again here so a page served elsewhere is no weaker. */
      const gc = data.templates.map(validGalleryEntry).filter(Boolean);
      window.__MODKEYS__.galleryCache = gc;
      return gc;
    } catch {
      window.__MODKEYS__.galleryCache = null;
      return null;
    }
  };

  /* Thumbnails for gallery cards, a few per frame so a long gallery never freezes the page. `onThumb(id, url)` is
     called as each one is drawn; returns a function that stops the rest. */
  window.__MODKEYS__.renderThumbs = function renderThumbs(entries, onThumb) {
    const todo = entries.filter((t) => t.snap && !thumbs[t.id]);
    let stopped = false;
    const step = () => {
      if (stopped || !todo.length) return;
      const save = beginThumbRender();
      try {
        for (const t of todo.splice(0, 4)) {
          try {
            thumbs[t.id] = renderSnapThumb(t.snap);
            onThumb(t.id, thumbs[t.id]);
          } catch {
            /* thumbnail failed: the card keeps its colour swatch */
          }
        }
      } finally {
        endThumbRender(save);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => { stopped = true; };
  };

  /* key editor / Customize selection */
  onKeyEditClick((keyData) => {
    showKeyEditor(keyData, {
      multi: !!(keyData._multi || keyData._shiftKey),
      shiftKey: !!keyData._shiftKey,
    });
  });

  /* keyboard shortcuts */
  const keyHandler = (ev) => {
    /* One Escape closes one thing: the dialog on top, else the key editor (not while typing in it). */
    if (ev.key === 'Escape') {
      if (isModalOpen()) {
        ev.preventDefault();
        closeModal();
      } else if (!isTextEntry(ev.target)) {
        hideKeyEditor();
      }
      return;
    }
    if (isTextEntry(ev.target)) return;
    const mod = (ev.ctrlKey || ev.metaKey) && !ev.altKey;
    /* ev.key is 'Z' with Shift or Caps Lock on, so compare in lower case. Cmd+Shift+Z is redo on a Mac. */
    const k = (ev.key || '').toLowerCase();
    if (mod && k === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      const ok = undo();
      if (!ok) toast('Nothing to undo');
      else toast('Undo');
    } else if (mod && (k === 'y' || (k === 'z' && ev.shiftKey))) {
      ev.preventDefault();
      const ok = redo();
      if (!ok) toast('Nothing to redo');
      else toast('Redo');
    }
  };
  document.addEventListener('keydown', keyHandler);
  cleanupFns.push(() => document.removeEventListener('keydown', keyHandler));

  /* resize */
  const stage = document.getElementById('stage');
  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  cleanupFns.push(() => ro.disconnect());

  /* thumbnail generation helpers */
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
    uni.uTime.value = 2.2;
    return { r, sc, snap: stateSlice() };
  }
  function endThumbRender(save) {
    /* perKeyOverrides is untouched by a thumbnail, and the live map keeps its null prototype (perKey.js). */
    const { perKeyOverrides: _keep, ...rest } = save.snap;
    Object.assign(state, rest);
    ctrl.theta = save.sc.theta;
    ctrl.phi = save.sc.phi;
    ctrl.radius = save.sc.radius;
    ctrl.target.y = save.sc.ty;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(save.r.width, save.r.height, false);
    camera.aspect = save.r.width / save.r.height;
    camera.updateProjectionMatrix();
    const snap = save.snap;
    /* The live build's own colours (custom roles included) and lighting, not the last thumbnail's. */
    const cw = effectiveColorway();
    if (cw) {
      matAlpha.color.copy(sRGB(cw.a.bg));
      matMod.color.copy(sRGB(cw.m.bg));
      matAccent.color.copy(sRGB(cw.x.bg));
    }
    applyLight();
    if (snap.caseColor || snap.caseCustomColor !== undefined) {
      const cHex = snap.caseCustomColor || CASES[snap.caseColor || state.caseColor]?.c || CASES[state.caseColor].c;
      matCase.color.copy(sRGB(cHex));
    }
    if (snap.plate || snap.plateColor !== undefined) {
      const pid = snap.plate || state.plate;
      const phex = snap.plateColor !== undefined ? snap.plateColor : (state.plateColor || PLATES[pid].c);
      applyPlateFinish(pid, phex || PLATES[pid].c);
    }
    if (snap.sw || snap.switchColor !== undefined) {
      const sHex = snap.switchColor || SWITCHES[snap.sw || state.sw]?.dot || SWITCHES[state.sw].dot;
      matStem.color.copy(sRGB(sHex));
    }
  }
  function renderSnapThumb(s) {
    if (s.colorway) {
      const cw = COLORWAYS[s.colorway] || s.customColors;
      if (cw) {
        matAlpha.color.copy(sRGB(cw.a.bg));
        matMod.color.copy(sRGB(cw.m.bg));
        matAccent.color.copy(sRGB(cw.x.bg));
      }
    } else if (s.customColors) {
      const cc = s.customColors;
      matAlpha.color.copy(sRGB(cc.a.bg));
      matMod.color.copy(sRGB(cc.m.bg));
      if (cc.x && cc.x.bg) matAccent.color.copy(sRGB(cc.x.bg));
    }
    if (s.caseColor || s.caseCustomColor !== undefined) {
      const cHex = s.caseCustomColor || CASES[s.caseColor || state.caseColor]?.c || CASES[state.caseColor].c;
      matCase.color.copy(sRGB(cHex));
    }
    if (s.plate || s.plateColor !== undefined) {
      const pid = s.plate || state.plate;
      const phex = s.plateColor != null ? s.plateColor : (state.plateColor || PLATES[pid].c);
      applyPlateFinish(pid, phex || PLATES[pid].c);
    }
    if (s.sw || s.switchColor !== undefined) {
      const sHex = s.switchColor || SWITCHES[s.sw || state.sw]?.dot || SWITCHES[state.sw].dot;
      matStem.color.copy(sRGB(sHex));
    }
    if (s.light) {
      const modes = { wave: 0, static: 1, breathe: 2, off: 3 };
      Object.assign(state.light, s.light);
      uni.uColor.value.set(state.light.color);
      const m = modes[state.light.mode];
      uni.uMode.value = m !== undefined ? m : 3;
      uni.uBright.value = state.light.bright;
    }
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }
  function genThumbs() {
    const save = beginThumbRender();
    PRESETS.forEach((p) => {
      thumbs[p.id] = renderSnapThumb(p.s);
    });
    endThumbRender(save);
  }

  /* render loop: runs only while the page can be seen. It stops when the tab is hidden and when the miyakeys window
     is minimised (the window says so, host.js), and starts again when either comes back. */
  const clock = new THREE.Clock();
  /* Reduced motion: the underglow's wave and breathe hold still at one moment instead of cycling. */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const STILL_TIME = 2.2;
  let hostVisible = true;
  const running = () => !document.hidden && hostVisible;
  const undoToggle = () => {
    document.getElementById('toolUndo').toggleAttribute('disabled', !canUndo());
    document.getElementById('toolRedo').toggleAttribute('disabled', !canRedo());
  };
  function tick() {
    animationId = null;
    if (!running()) return;
    animationId = requestAnimationFrame(tick);
    uni.uTime.value = reducedMotion.matches ? STILL_TIME : clock.getElapsedTime();
    if (Math.abs(ctrl.vT) > 1e-4 || Math.abs(ctrl.vP) > 1e-4) {
      ctrl.theta += ctrl.vT;
      ctrl.phi += ctrl.vP;
      ctrl.vT *= 0.9;
      ctrl.vP *= 0.9;
    }
    ctrl.apply();
    renderer.render(scene, camera);
    undoToggle();
  }
  function startLoop() {
    if (animationId === null && running()) tick();
  }
  document.addEventListener('visibilitychange', startLoop);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', startLoop));

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
  }
  cleanupFns.push(listenToHost({
    onBuild: (hash) => { hostHash = hash; openHostBuild(); },
    onVisible: (visible) => { hostVisible = visible; startLoop(); },
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
    /* restore shared URL: a bad one is said so, and the page goes on with its own build */
    if (window.location.hash) {
      try {
        const hashData = loadHash();
        if (hashData) {
          loadSnap(hashData, { selectedPreset: null });
          resetHistory(stateSlice());
        } else toast('That shared build could not be opened');
      } catch (e) {
        console.error(e);
        toast('That shared build could not be opened');
      }
    }
    booted = true;
    openHostBuild();
    genThumbs();
    /* populate featured builds carousel (desktop shell only) */
    const buildsEl = document.getElementById('builds');
    if (buildsEl) buildsEl.innerHTML = PRESETS.map((p) =>
      `<button class="bcard" data-id="${p.id}">
         <div class="img" style="background:${COLORWAYS[p.s.colorway].a.bg}"><img src="${thumbs[p.id]}" alt=""></div>
         <div class="nm">${p.name}</div>
       </button>`
    ).join('');
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
      mMenu.addEventListener('click', () => mMenu.classList.remove('open'));
      mToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        mMenu.classList.toggle('open');
      });
      document.addEventListener('click', (ev) => {
        if (mMenu.classList.contains('open') && !mMenu.contains(ev.target) && ev.target !== mToggle) {
          mMenu.classList.remove('open');
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

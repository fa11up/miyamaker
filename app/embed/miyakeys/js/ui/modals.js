import { state } from '../core/state.js';
import { setState, loadSnap, effectiveColorway } from '../core/update.js';
import { LAYOUTS } from '../data/layouts.js';
import { COLORWAYS } from '../data/colorways.js';
import { CASES, FINISHES, PLATES, SWITCHES, MATERIALS, EXTRAS, PROFILES, LIGHT_COLORS } from '../data/components.js';
import { PRESETS } from '../data/presets.js';
import { toast } from './toast.js';
import { playKeyClick } from './sound.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const $ = (id) => document.getElementById(id);

/* Stops the gallery's thumbnail drawing when the modal closes or shows something else. */
let stopThumbs = null;
/* Counts what the modal has shown: an answer that arrives after the modal moved on (another Gallery, another dialog)
   is dropped instead of filling, or drawing thumbnails into, the newer one. */
let shown = 0;
/* Where focus was before the dialog opened; it goes back there on close. */
let opener = null;

/* While a dialog is open everything else on the page is inert (aria-modal alone does not keep Tab inside it): the
   shell, the key editor. The toast stays live so what a dialog's action says is still heard. Only what this set is
   put back. */
let madeInert = [];
function setPageInert(on) {
  if (!on) {
    madeInert.forEach((el) => { el.inert = false; });
    madeInert = [];
    return;
  }
  if (madeInert.length) return;
  for (const el of document.body.children) {
    if (el.id === 'modal' || el.id === 'toast' || el.tagName === 'SCRIPT' || el.tagName === 'TEMPLATE' || el.inert) continue;
    el.inert = true;
    madeInert.push(el);
  }
}

export function closeModal() {
  if (stopThumbs) { stopThumbs(); stopThumbs = null; }
  shown++;
  const wasOpen = isModalOpen();
  $('modal').classList.remove('open');
  setPageInert(false);
  syncNav('builder');
  if (wasOpen && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  opener = null;
}

export function isModalOpen() {
  return !!$('modal')?.classList.contains('open');
}

export function openModal(title, html) {
  if (stopThumbs) { stopThumbs(); stopThumbs = null; }
  shown++;
  const card = $('modal').querySelector('.modalCard');
  if (!isModalOpen()) opener = document.activeElement !== document.body ? document.activeElement : null;
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.add('open');
  setPageInert(true);
  /* Focus moves into the dialog (a dialog that wants a field focused does that after this). */
  if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
}

const cwName = (snap) => snap.customColors ? 'Custom' : (COLORWAYS[snap.colorway]?.name ?? 'Custom');

function syncNav(id) {
  document.querySelectorAll('#tnav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === id));
}

function presetPatch(p) {
  const s = p.s;
  return Object.assign({}, s, {
    colorway: s.colorway || state.colorway,
    caseColor: s.caseColor || state.caseColor,
    plate: s.plate || state.plate,
    sw: s.sw || state.sw,
    light: s.light ? Object.assign({}, state.light, s.light) : state.light,
    selectedPreset: p.id,
    /* wipe photo-match leftovers when loading a stock preset */
    perKeyOverrides: s.perKeyOverrides || {},
    customColors: s.customColors ?? null,
    caseCustomColor: s.caseCustomColor ?? null,
    plateColor: s.plateColor ?? null,
    switchColor: s.switchColor ?? null,
  });
}

export function openLibrary() {
  syncNav('keycaps');
  openModal('Keycap Library',
    '<div class="libGrid">' +
    Object.entries(COLORWAYS).map(([id, c]) =>
      `<button class="libCard ${state.colorway === id ? 'on' : ''}" data-lib="${id}">
        <div class="libCaps"><span style="background:${c.a.bg}"></span><span style="background:${c.m.bg}"></span><span style="background:${c.x.bg}"></span></div>
        <div class="nm">${c.name}</div><div class="tg">${c.tag}</div>
      </button>`,
    ).join('') + '</div>',
  );
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function thumbnailOrGradient(src, snap) {
  if (src) return `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
  // Community builds are visitor input: only plain hex colours reach the style.
  const a = snap?.customColors?.a?.bg;
  const m = snap?.customColors?.m?.bg;
  const cwGuess = HEX_COLOR.test(a) && HEX_COLOR.test(m)
    ? [a, m]
    : (COLORWAYS[snap?.colorway] ? [COLORWAYS[snap.colorway].a.bg, COLORWAYS[snap.colorway].m.bg] : ['#333', '#555']);
  return `<div class="img" style="background:linear-gradient(135deg,${cwGuess[0]} 50%,${cwGuess[1]} 50%)"></div>`;
}

/* A card's small line: the layout, and "preview approximate" when its picture could not show the build exactly
   (app.js renderSnapThumb). */
const communityTag = (t, thumb) =>
  [t.layout ? t.layout + '%' : '', thumb && thumb.approx ? 'preview approximate' : ''].filter(Boolean).join(' · ');

function communityCardHtml(t, thumbs) {
  const thumb = thumbs.get(t.id);
  return `<button type="button" class="galCard" data-community="${esc(t.id)}"><span class="thumb">${thumbnailOrGradient(thumb?.url, t.snap)}</span><div class="cap"><div class="nm">${esc(t.name)}</div><div class="tg">${esc(communityTag(t, thumb))}</div></div></button>`;
}

/** At most this many community cards: each one is a WebGL thumbnail. The rest are counted, not hidden silently. */
export const GALLERY_SHOWN = 60;

function showCommunityOffline(grid) {
  grid.innerHTML = '<div class="hint" style="grid-column:1/-1">Community gallery offline. <button class="linkish" id="galleryRetry">Retry</button></div>';
  document.getElementById('galleryRetry')?.addEventListener('click', () => openGallery());
}

/** The line under the community cards when not every build is shown: the page shows GALLERY_SHOWN at most, and the
 *  gallery itself sends only its newest 500 (`more`, app.js fetchGallery). Empty when everything is shown. */
export function galleryNote(shownCount, total, more) {
  const rest = ' The rest are on <a class="linkish" href="https://www.nuroctane.xyz/modkeys" target="_blank" rel="noopener">nuroctane.xyz/modkeys</a>.';
  let text;
  if (more) text = shownCount < total ? `Showing ${shownCount} of the newest ${total} builds.` : `Showing the newest ${total} builds.`;
  else if (shownCount < total) text = `Showing ${shownCount} of ${total} builds.`;
  else return '';
  return `<div class="hint" style="grid-column:1/-1">${text}${rest}</div>`;
}

export function openGallery() {
  syncNav('gallery');
  const { savedBuilds, presetThumbs } = window.__MODKEYS__ || { savedBuilds: [], presetThumbs: new Map() };
  let html = '<div class="secTitle">FEATURED</div><div class="galGrid">' +
    PRESETS.map((p) =>
      `<button class="galCard" data-gal="${p.id}">${thumbnailOrGradient(presetThumbs.get(p.id)?.url, p.s)}
        <div class="cap"><div class="nm">${esc(p.name)}</div><div class="tg">${esc(cwName(p.s))}</div></div></button>`,
    ).join('') + '</div>';
  html += `<div class="secTitle">COMMUNITY <a class="linkish" href="https://www.nuroctane.xyz/modkeys" target="_blank" rel="noopener">shared with nuroctane.xyz</a></div><div class="galGrid" id="communityGrid">` +
    '<div class="hint" style="grid-column:1/-1">Loading community builds...</div></div>';
  if (savedBuilds.length) {
    html += '<div class="secTitle">YOUR BUILDS</div><div class="galGrid">' +
      savedBuilds.map((b, i) =>
        `<button class="galCard" data-saved="${i}">${thumbnailOrGradient(b.img, b.snap)}
          <div class="cap"><div class="nm">${esc(b.name)}</div><div class="tg">${esc(cwName(b.snap))}</div></div></button>`,
      ).join('') + '</div>';
  } else {
    html += '<div class="secTitle">YOUR BUILDS</div><div class="hint" style="margin-bottom:16px">Builds you share with <strong>Share to gallery</strong> are kept here until you close miyakeys.</div>';
  }
  openModal('Gallery', html);
  const mine = shown;

  /* lazy-load the community section (the gallery on nuroctane.xyz, see GALLERY_API in app.js) */
  const lg = window.__MODKEYS__?.loadGallery;
  if (!lg) return;
  lg().then((community) => {
    if (mine !== shown || !$('modal').classList.contains('open')) return;
    const grid = document.getElementById('communityGrid');
    if (!grid) return;
    if (community === null) { showCommunityOffline(grid); return; }
    if (community.length === 0) {
      grid.innerHTML = '<div class="hint" style="grid-column:1/-1">No community builds yet. Be the first: press <strong>Share to gallery</strong>.</div>';
      return;
    }
    const { communityThumbs: th, renderThumbs } = window.__MODKEYS__ || { communityThumbs: new Map() };
    const list = community.slice(0, GALLERY_SHOWN);
    grid.innerHTML = list.map((t) => communityCardHtml(t, th)).join('') +
      galleryNote(list.length, community.length, community.more === true);
    /* Thumbnails are drawn a few at a time after the cards show (each card has its colours until then). Only one
       drawing at a time: any earlier one is stopped first. */
    if (renderThumbs) {
      if (stopThumbs) stopThumbs();
      stopThumbs = renderThumbs(list, (id, thumb) => {
        const card = [...grid.querySelectorAll('[data-community]')].find((c) => c.dataset.community === id);
        const slot = card?.querySelector('.thumb');
        if (slot) slot.innerHTML = thumbnailOrGradient(thumb.url, null);
        const tag = card?.querySelector('.tg');
        const t = list.find((e) => e.id === id);
        if (tag && t) tag.textContent = communityTag(t, thumb);
      });
    }
  }).catch(() => {
    if (mine !== shown) return;
    const grid = document.getElementById('communityGrid');
    if (grid) showCommunityOffline(grid);
  });
}

export function openSwitchesModal() {
  syncNav('switches');
  openModal('Switches',
    '<div class="libGrid">' +
    Object.entries(SWITCHES).map(([id, s]) =>
      `<button class="libCard ${state.sw === id ? 'on' : ''}" data-swm="${id}">
        <div class="libCaps"><span style="background:${s.dot}"></span></div>
        <div class="nm">${s.name}</div><div class="tg">${s.type} · ${s.force} · ${s.sound}</div>
      </button>`,
    ).join('') +
    '</div><div class="hint" style="margin-top:14px">Selecting a switch updates the live build. Click any key on the board to hear it.</div>',
  );
}

export function openAccessories() {
  syncNav('accessories');
  openModal('Accessories',
    '<div class="libGrid">' +
    Object.entries(EXTRAS).map(([id, e]) =>
      `<button class="libCard ${state.extras[id] ? 'on' : ''}" data-ext="${id}">
        <div class="nm">${e.name}</div><div class="tg">${e.tag}</div>
      </button>`,
    ).join('') + '</div>',
  );
}

/* "Share to gallery": says plainly where the build goes before anything is sent. No prompt(): the frame is
   sandboxed without modals, so the name is asked for here. */
export function openShareDialog(defaultName) {
  syncNav('builder');
  openModal('Share to gallery',
    `<form id="shareForm" class="shareForm">
      <p class="hint" style="margin-bottom:12px">This build goes <strong>public</strong> in the community gallery on
        <a class="linkish" href="https://www.nuroctane.xyz/modkeys" target="_blank" rel="noopener">nuroctane.xyz</a>,
        which miyakeys shares with MODKEYS. Anyone can see and load it, and only nuroctane can remove it.
        Key images are not shared.</p>
      <label class="glabel" for="shareName">NAME</label>
      <input class="keInput" id="shareName" type="text" maxlength="40" autocomplete="off" value="${esc(defaultName)}" style="width:100%;margin:6px 0 14px">
      <div class="shareRow">
        <button type="button" class="libBtn" id="shareCancel">Cancel</button>
        <button type="button" class="libBtn shareGo" id="shareGo">Share publicly</button>
      </div>
      <p class="hint" id="shareStatus" role="status" aria-live="polite" style="margin-top:12px"></p>
    </form>`,
  );
  const form = $('shareForm');
  const input = $('shareName');
  input?.focus();
  input?.select();
  $('shareCancel')?.addEventListener('click', closeModal);
  /* A button, not a form submit: the frame's sandbox (no allow-forms) blocks submission before any submit event, so
     a submit handler would never run. Enter in the name field presses it too (submitDialog, from app.js's keys). */
  $('shareGo')?.addEventListener('click', async () => {
    const go = $('shareGo');
    const share = window.__MODKEYS__?.shareBuild;
    if (!share || !go || go.disabled) return;
    go.disabled = true;
    go.textContent = 'Sharing…';
    const status = $('shareStatus');
    const result = await share(input?.value ?? '');
    /* The person may have closed the dialog or opened another while it was sending: then a toast says it. */
    if (!(status && $('shareForm') === form)) { toast(result.message); return; }
    status.textContent = result.message;
    go.textContent = result.ok ? 'Shared' : 'Share publicly';
    go.disabled = result.ok;
    const cancel = $('shareCancel');
    if (cancel && result.ok) cancel.textContent = 'Close';
  });
}

/** Enter in a dialog's text field: presses that dialog's main button. True when it did. */
export function submitDialog(target) {
  if (!target || target.id !== 'shareName' || !isModalOpen()) return false;
  $('shareGo')?.click();
  return true;
}

/** The share link, to copy by hand when the clipboard is not available here. */
export function showLinkDialog(url, { imagesLeftOut = false } = {}) {
  syncNav('builder');
  openModal('Share link',
    `<p class="hint" style="margin-bottom:10px">Copy this link to share the build. Anyone with it can open the build.${imagesLeftOut ? ' Key images aren\'t included in links.' : ''}</p>
     <input class="keInput" id="shareLink" type="text" readonly value="${esc(url)}" style="width:100%">`,
  );
  const input = $('shareLink');
  input?.focus();
  input?.select();
}

/* modal body event delegation */
$('modalBody')?.addEventListener('click', (ev) => {
  const lib = ev.target.closest('[data-lib]');
  if (lib) {
    setState({ colorway: lib.dataset.lib, selectedPreset: null });
    openLibrary();
    toast(COLORWAYS[lib.dataset.lib].name + ' applied');
    return;
  }
  const gal = ev.target.closest('[data-gal]');
  if (gal) {
    const p = PRESETS.find((x) => x.id === gal.dataset.gal);
    loadSnap(presetPatch(p), { selectedPreset: p.id });
    closeModal();
    toast(p.name + ' loaded');
    return;
  }
  const community = ev.target.closest('[data-community]');
  if (community) {
    const { galleryCache } = window.__MODKEYS__ || { galleryCache: [] };
    const t = (galleryCache || []).find((e) => e.id === community.dataset.community);
    if (t && t.snap) {
      loadSnap(t.snap, { selectedPreset: null });
      closeModal();
      toast(t.name + ' loaded');
    }
    return;
  }
  const sv = ev.target.closest('[data-saved]');
  if (sv) {
    const { savedBuilds } = window.__MODKEYS__ || { savedBuilds: [] };
    const b = savedBuilds[parseInt(sv.dataset.saved)];
    if (b && b.snap) {
      loadSnap(b.snap, { selectedPreset: null });
      closeModal();
      toast(b.name + ' loaded');
    }
    return;
  }
  const swm = ev.target.closest('[data-swm]');
  if (swm) {
    setState({ sw: swm.dataset.swm, selectedPreset: null });
    playKeyClick(SWITCHES[swm.dataset.swm].sound, state.material);
    openSwitchesModal();
    return;
  }
  const ext = ev.target.closest('[data-ext]');
  if (ext) {
    const e = {};
    e[ext.dataset.ext] = !state.extras[ext.dataset.ext];
    setState({ extras: e });
    openAccessories();
    return;
  }
});

/* top nav event delegation for modals */
$('tnav')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const id = b.dataset.nav;
  if (id === 'builder') { closeModal(); return; }
  if (id === 'gallery') openGallery();
  if (id === 'keycaps') openLibrary();
  if (id === 'switches') openSwitchesModal();
  if (id === 'accessories') openAccessories();
});

$('modalClose')?.addEventListener('click', closeModal);
$('modalBack')?.addEventListener('click', closeModal);
/* Escape is handled once, in app.js's key handler, so it closes only the dialog on top. */


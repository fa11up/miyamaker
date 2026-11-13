import * as THREE from 'three-miyakeys';
import { validBuild } from './validBuild.js';
import gsap from 'gsap';
import { state, stateSlice } from './state.js';
import { layoutOf } from '../data/layouts.js';
import { COLORWAYS } from '../data/colorways.js';
import { CASES, FINISHES, PLATES, SWITCHES, MATERIALS, PROFILES, GAP } from '../data/components.js';
import {
  renderer, scene, camera, root, caseGroup, capsGroup, knobGroup, cableGroup, wristGroup,
  keyGlowGroup, glowPlane,
  matAlpha, matMod, matAccent, matCase, matPlate, matStem, matKnob,
  capMats, applyPlateFinish, applyCapMaterial, uni, sRGB,
} from './scene.js';
import { rebuildBoard, buildKeys, refreshLegends, preloadEmoji, rebuildKnob, syncKnobColorway } from './keyboard.js';
import { setView } from './controls.js';
import {
  pushState, resetHistory, syncCurrent, isEmpty as historyEmpty, undo as undoHistory, redo as redoHistory,
} from './history.js';
import { clearPerKeyCapColors } from './perKey.js';

/* Panel re-render hook. panels.js statically imports this module, so a static
   import back would be circular; app.js (which imports both) registers the
   real renderPanel here at boot. Replaces a mixed dynamic/static import that
   tripped a Vite chunking warning. */
let panelRenderHook = null;
export function onPanelRender(fn) { panelRenderHook = fn; }


/* Called after undo/redo puts a build on screen (panels.js closes a key editor whose key the restored layout lacks).
   Registered by panels.js rather than imported, since panels.js imports this module. */
let restoredHook = null;
export function onBuildRestored(fn) { restoredHook = fn; }

/* Bumped whenever a whole build replaces the one on screen (a load or an undo/redo). Work that awaits something (an
   image upload) captures it first and drops its result if a different build is up by the time it lands. */
let buildGen = 0;
export function buildGeneration() { return buildGen; }

let _syncUI = null;
const RM = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function registerSyncUI(fn) {
  _syncUI = fn;
}

const modes = { wave: 0, static: 1, breathe: 2, off: 3 };

export function effectiveColorway() {
  if (state.customColors) {
    return {
      a: { bg: state.customColors.a.bg, fg: state.customColors.a.fg },
      m: { bg: state.customColors.m.bg, fg: state.customColors.m.fg },
      x: { bg: state.customColors.x.bg, fg: state.customColors.x.fg },
    };
  }
  return COLORWAYS[state.colorway];
}

export function applyLight() {
  /* wave is mode 0 — must use nullish coalescing, not || (0 is falsy). */
  const m = modes[state.light.mode];
  uni.uMode.value = m !== undefined ? m : 3;
  uni.uColor.value.set(state.light.color);
  uni.uBright.value = state.light.bright;
  const on = state.light.mode !== 'off';
  caseGroup.children.forEach((c) => {
    if (c.material && c.material !== matCase && c.material !== matPlate)
      c.visible = on;
  });
  /* glowPlane + keyGlow live on root, not caseGroup — hide them for Off too */
  glowPlane.visible = on;
  keyGlowGroup.visible = on;
}

function applyColors(cw) {
  matAlpha.color.copy(sRGB(cw.a.bg));
  matMod.color.copy(sRGB(cw.m.bg));
  matAccent.color.copy(sRGB(cw.x.bg));
  /* Knob follows accent when not per-key recoloured */
  syncKnobColorway();
}

/** Truthy object customColors (photo match / custom hex roles). */
function hasCustomColors(cc) {
  return !!(cc && typeof cc === 'object' && (cc.a || cc.m || cc.x));
}

/**
 * Prefer customColors over named colorway when both appear in a snap
 * (photo match leaves colorway id set while roles live in customColors).
 * Explicit customColors: null + colorway chip clears custom and applies stock.
 *
 * Global colorway / customColors changes strip per-key bg/fg (photo match)
 * unless the patch also carries perKeyOverrides (full snap load restores them).
 */
function applyColorwayFields(s, { instant = true } = {}) {
  if (s.brand !== undefined) state.brand = s.brand;

  const applyingGlobalColors =
    hasCustomColors(s.customColors) ||
    (s.colorway && COLORWAYS[s.colorway]) ||
    s.customColors === null;
  /* Only strip when this patch is a global recolour, not a full snap that
     already includes its own perKeyOverrides (photo gallery load). */
  const stripPhotoCaps =
    applyingGlobalColors && s.perKeyOverrides === undefined;
  let strippedCaps = false;
  if (stripPhotoCaps) {
    strippedCaps = clearPerKeyCapColors();
  }

  const afterColorwayVisual = () => {
    if (strippedCaps) {
      buildKeys();
      rebuildKnob();
    } else {
      refreshLegends();
      syncKnobColorway();
    }
  };

  if (hasCustomColors(s.customColors)) {
    if (instant) applyColors(s.customColors);
    else {
      tweenColor(matAlpha, s.customColors.a.bg);
      tweenColor(matMod, s.customColors.m.bg);
      tweenColor(matAccent, s.customColors.x.bg);
      gsap.delayedCall(0.26, () => syncKnobColorway());
    }
    state.customColors = s.customColors;
    if (s.colorway && COLORWAYS[s.colorway]) state.colorway = s.colorway;
    if (instant) afterColorwayVisual();
    else gsap.delayedCall(0.26, strippedCaps ? () => { buildKeys(); rebuildKnob(); } : () => { refreshLegends(); syncKnobColorway(); });
    if (instant && panelRenderHook) panelRenderHook(state.section);
    return;
  }

  if (s.colorway && COLORWAYS[s.colorway]) {
    const cw = COLORWAYS[s.colorway];
    if (instant) applyColors(cw);
    else {
      tweenColor(matAlpha, cw.a.bg);
      tweenColor(matMod, cw.m.bg);
      tweenColor(matAccent, cw.x.bg);
      gsap.delayedCall(0.26, () => syncKnobColorway());
    }
    state.colorway = s.colorway;
    /* clear custom on stock colorway apply (chip passes customColors: null) */
    if (s.customColors === null || s.customColors === undefined) {
      state.customColors = null;
    }
    if (instant) afterColorwayVisual();
    else gsap.delayedCall(0.26, strippedCaps ? () => { buildKeys(); rebuildKnob(); } : () => { refreshLegends(); syncKnobColorway(); });
    if (instant && panelRenderHook) panelRenderHook(state.section);
    return;
  }

  if (s.customColors === null) {
    state.customColors = null;
    if (COLORWAYS[state.colorway]) {
      if (instant) applyColors(COLORWAYS[state.colorway]);
      else {
        const cw = COLORWAYS[state.colorway];
        tweenColor(matAlpha, cw.a.bg);
        tweenColor(matMod, cw.m.bg);
        tweenColor(matAccent, cw.x.bg);
        gsap.delayedCall(0.26, () => syncKnobColorway());
      }
    }
    if (instant) afterColorwayVisual();
    else gsap.delayedCall(0.26, strippedCaps ? () => { buildKeys(); rebuildKnob(); } : () => { refreshLegends(); syncKnobColorway(); });
    return;
  }

  if (s.brand !== undefined) {
    if (instant) refreshLegends();
  }
}

/** Per-key bg/image etc. need mesh rebuild — legends alone are not enough. */
function applyPerKeyOverridesField(ov) {
  state.perKeyOverrides = ov && typeof ov === 'object' ? ov : Object.create(null);
  buildKeys();
}

function applyInstant(s) {
  applyColorwayFields(s, { instant: true });
  if (s.caseColor) {
    state.caseColor = s.caseColor;
    if (s.caseCustomColor === undefined) state.caseCustomColor = null;
  }
  if (s.caseCustomColor !== undefined) {
    state.caseCustomColor = s.caseCustomColor;
  }
  if (s.caseColor || s.caseCustomColor !== undefined) {
    const cHex = state.caseCustomColor || CASES[state.caseColor].c;
    matCase.color.copy(sRGB(cHex));
  }
  if (s.finish) {
    const f = FINISHES[s.finish];
    matCase.metalness = f.metal;
    matCase.roughness = f.rough;
    matCase.clearcoat = f.cc;
    state.finish = s.finish;
  }
  if (s.plate) {
    state.plate = s.plate;
    /* switching material type resets tint to that plate's default unless plateColor also provided */
    if (s.plateColor === undefined) state.plateColor = null;
  }
  if (s.plateColor !== undefined) {
    state.plateColor = s.plateColor;
  }
  if (s.plate || s.plateColor !== undefined) {
    applyPlateFinish(state.plate, state.plateColor || PLATES[state.plate].c);
  }
  if (s.sw) {
    state.sw = s.sw;
    if (s.switchColor === undefined) state.switchColor = null;
  }
  if (s.switchColor !== undefined) {
    state.switchColor = s.switchColor;
  }
  if (s.sw || s.switchColor !== undefined) {
    const sHex = state.switchColor || SWITCHES[state.sw].dot;
    matStem.color.copy(sRGB(sHex));
  }
  if (s.material) {
    applyCapMaterial(s.material);
    state.material = s.material;
  }
  if (s.light) {
    state.light = Object.assign({}, state.light, s.light);
    applyLight();
  }
  if (s.extras) {
    state.extras = Object.assign({}, state.extras, s.extras);
    knobGroup.visible = layoutOf(state.layout).knob && state.extras.knob;
    cableGroup.visible = state.extras.cable;
    wristGroup.visible = state.extras.wrist;
  }
  if (s.perKeyOverrides !== undefined) {
    applyPerKeyOverridesField(s.perKeyOverrides);
  }
}

function popKeys() {
  capsGroup.children.forEach((c) => {
    gsap.from(c.position, {
      y: c.userData.baseY + 0.5,
      duration: 0.6,
      ease: 'power3.out',
      delay: c.userData.col * 0.008 + c.userData.row * 0.03,
      overwrite: 'auto',
    });
  });
}

function tweenColor(mat, hex, d) {
  if (RM()) { mat.color.copy(sRGB(hex)); return; }
  const c = sRGB(hex);
  gsap.to(mat.color, {
    r: c.r, g: c.g, b: c.b,
    duration: d || 0.55,
    ease: 'power2.out',
    overwrite: 'auto',
  });
}

function apply3D(patch, animate) {
  if (!animate || RM()) {
    applyInstant(patch);
    /* layout rebuild includes buildKeys; avoid double work if already built for overrides */
    if (patch.layout) {
      state.layout = patch.layout;
      rebuildBoard();
    } else if (patch.profile) {
      state.profile = patch.profile;
      /* buildKeys if applyInstant did not already (no perKeyOverrides in patch) */
      if (patch.perKeyOverrides === undefined) buildKeys();
    }
    return;
  }
  applyColorwayFields(patch, { instant: false });
  if (patch.caseColor) {
    if (patch.caseCustomColor === undefined) state.caseCustomColor = null;
    const cHex = state.caseCustomColor || CASES[patch.caseColor].c;
    tweenColor(matCase, cHex);
  }
  if (patch.caseCustomColor !== undefined && !patch.caseColor) {
    const cHex = patch.caseCustomColor || CASES[state.caseColor].c;
    tweenColor(matCase, cHex);
  }
  if (patch.finish) {
    const f = FINISHES[patch.finish];
    gsap.to(matCase, { metalness: f.metal, roughness: f.rough, clearcoat: f.cc, duration: 0.5 });
  }
  if (patch.plate) {
    if (patch.plateColor === undefined) state.plateColor = null;
    const hex = state.plateColor || PLATES[patch.plate].c;
    tweenColor(matPlate, hex);
    applyPlateFinish(patch.plate, hex);
  }
  if (patch.plateColor !== undefined && !patch.plate) {
    const hex = patch.plateColor || PLATES[state.plate].c;
    tweenColor(matPlate, hex);
    applyPlateFinish(state.plate, hex);
  }
  if (patch.sw) {
    if (patch.switchColor === undefined) state.switchColor = null;
    const sHex = state.switchColor || SWITCHES[patch.sw].dot;
    tweenColor(matStem, sHex, 0.4);
  }
  if (patch.switchColor !== undefined && !patch.sw) {
    const sHex = patch.switchColor || SWITCHES[state.sw].dot;
    tweenColor(matStem, sHex, 0.4);
  }
  if (patch.material) {
    applyCapMaterial(patch.material);
  }
  if (patch.light) applyLight();
  if (patch.extras !== undefined) {
    knobGroup.visible = layoutOf(state.layout).knob && state.extras.knob;
    cableGroup.visible = state.extras.cable;
    wristGroup.visible = state.extras.wrist;
  }
  if (patch.profile) { buildKeys(); popKeys(); }
  if (patch.layout) {
    if (state.exploded) setView('3d');
    rebuildBoard();
    popKeys();
  } else if (patch.perKeyOverrides !== undefined) {
    applyPerKeyOverridesField(patch.perKeyOverrides);
  }
}

/**
 * One-shot load of a full build snap (gallery / share / saved).
 * Instant apply so customColors + per-key faces + board tints all stick.
 */
export function loadSnap(snap, opts = {}) {
  /* Only a build's own fields, each checked (validBuild.js): never view, tool, theme, section or selection. */
  const patch = validBuild(snap);
  if (!patch) return;
  buildGen++;
  patch.selectedPreset = opts.selectedPreset !== undefined ? opts.selectedPreset : null;
  /* Full snap: missing overrides must clear leftover photo colours from prior build */
  if (patch.perKeyOverrides === undefined) patch.perKeyOverrides = Object.create(null);
  if (patch.customColors === undefined) patch.customColors = null;
  if (patch.caseCustomColor === undefined) patch.caseCustomColor = null;
  if (patch.plateColor === undefined) patch.plateColor = null;
  if (patch.switchColor === undefined) patch.switchColor = null;
  setState(patch, { animate: false, skipPanel: !!opts.skipPanel });
}

/** Start history at the build on screen if nothing has been recorded yet (no shared link at boot). */
function ensureHistory() {
  if (historyEmpty()) resetHistory(state);
}

/** Record the build as it is now as one undo step (no-op when nothing changed). Per-key edits, which change
 *  state.perKeyOverrides in place, call this once per gesture (a click, or the 'change' after typing / dragging). */
export function commitHistory() {
  ensureHistory();
  pushState(state);
}

/* opts.history === false: a live preview step (slider drag); the gesture commits on 'change'. */
export function setState(patch, opts) {
  opts = opts || {};
  ensureHistory();
  if (patch.light) patch.light = Object.assign({}, state.light, patch.light);
  if (patch.extras) patch.extras = Object.assign({}, state.extras, patch.extras);
  Object.assign(state, patch);
  apply3D(patch, opts.animate !== false);
  /* History holds the state AFTER each change; the entry before it is what undo returns to. */
  if (opts.history !== false) pushState(state);
  if (_syncUI) _syncUI(opts.skipPanel);
}

/* A history entry is a build (history.js keeps only build fields), so it goes back through the same allowlist as
   any other build: undo restores the build, not the viewer's theme, tool or view. */
function restore(entry) {
  const snap = validBuild(entry);
  if (!snap) return false;
  buildGen++;
  Object.assign(state, snap);
  applyInstant(snap);
  if (snap.layout) rebuildBoard();
  else if (snap.profile) buildKeys();
  /* applyInstant already buildKeys when snap has perKeyOverrides */
  /* The entry becomes exactly what is now on screen, so the next undo/redo's commit sees no change. */
  syncCurrent(state);
  if (restoredHook) restoredHook();
  if (_syncUI) _syncUI();
  return true;
}

/* Both first record any live edit not yet committed (a tint being dragged, a legend still focused), so undo
   steps back from what is on screen and never drops it. */
export function undo() {
  commitHistory();
  const snap = undoHistory();
  if (!snap) return false;
  return restore(snap);
}

export function redo() {
  commitHistory();
  const snap = redoHistory();
  if (!snap) return false;
  return restore(snap);
}

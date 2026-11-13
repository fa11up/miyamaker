import { BUILD_FIELDS, isImageData, validBuild } from './validBuild.js';

/* Undo history. The stack holds builds and `pos` points at the one on screen: a change pushes the state AFTER it,
   undo steps back to the one before. Entries hold only a build's own fields (never view, tool, theme or selection)
   and never a key image: images live once in a table outside the stack (id -> data URL) and an entry names the id,
   so 50 entries of a board full of 4 MB images still hold each image once. */
const MAX = 50;
const stack = [];
let pos = -1;

const imageById = new Map();
const idByImage = new Map();
let nextImageId = 1;

/** The id for an image, or null when restore would drop it anyway (not a PNG/JPEG data URL, or too big). */
function internImage(dataUrl) {
  let id = idByImage.get(dataUrl);
  if (!id) {
    if (!isImageData(dataUrl)) return null;
    id = 'img' + nextImageId++;
    idByImage.set(dataUrl, id);
    imageById.set(id, dataUrl);
  }
  return id;
}

/* Drop images no entry names any more (after a trim, a reset or a new branch). */
function pruneImages() {
  const used = new Set();
  stack.forEach((e) => {
    const pk = e.perKeyOverrides;
    if (pk) Object.keys(pk).forEach((id) => { if (pk[id] && pk[id].imageRef) used.add(pk[id].imageRef); });
  });
  imageById.forEach((dataUrl, id) => {
    if (used.has(id)) return;
    imageById.delete(id);
    idByImage.delete(dataUrl);
  });
}

/* An image travels through validBuild as a tiny stand-in data URL that names its id (ids are base64-safe), so the
   allowlist sees an image there without scanning megabytes of base64 on every commit. */
const REF_PREFIX = 'data:image/png;base64,';

/**
 * A history entry for a build (the live state or a stateSlice()): the build exactly as a restore would put it on
 * screen. It goes through validBuild, the same allowlist restore applies, so an entry and the state restored from it
 * always compare equal (no dropped empty override, no stripped zero-width character, no reordered field reads as a
 * change). Key images are swapped for ids.
 */
export function snapshot(src) {
  const raw = {};
  BUILD_FIELDS.forEach((k) => {
    if (k !== 'perKeyOverrides' && src[k] !== undefined) raw[k] = src[k];
  });
  const pk = src.perKeyOverrides;
  if (pk && typeof pk === 'object') {
    raw.perKeyOverrides = {};
    Object.keys(pk).forEach((id) => {
      const o = pk[id];
      if (!o || typeof o !== 'object' || Array.isArray(o)) return;
      const copy = Object.assign({}, o);
      delete copy.imageData;
      if (typeof o.imageData === 'string') {
        const ref = internImage(o.imageData);
        if (ref) copy.imageData = REF_PREFIX + ref;
      }
      raw.perKeyOverrides[id] = copy;
    });
  }
  const out = validBuild(raw) || {};
  const outPk = {};
  const vpk = out.perKeyOverrides || {};
  Object.keys(vpk).forEach((id) => {
    const o = Object.assign({}, vpk[id]);
    if (typeof o.imageData === 'string') {
      o.imageRef = o.imageData.slice(REF_PREFIX.length);
      delete o.imageData;
    }
    outPk[id] = o;
  });
  out.perKeyOverrides = outPk;
  return out;
}

/** The build an entry stands for, with its key images put back (for the validated restore path). */
export function expand(entry) {
  if (!entry) return null;
  const out = Object.assign({}, entry);
  const pk = entry.perKeyOverrides;
  if (pk) {
    out.perKeyOverrides = {};
    Object.keys(pk).forEach((id) => {
      const copy = Object.assign({}, pk[id]);
      if (copy.imageRef) {
        const img = imageById.get(copy.imageRef);
        if (img) copy.imageData = img;
        delete copy.imageRef;
      }
      out.perKeyOverrides[id] = copy;
    });
  }
  return out;
}

/* Key order is not meaning: compare entries by a stringify with object keys sorted. */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const same = (a, b) => !!a && !!b && canonical(a) === canonical(b);

/** Record the build as it is now. No-op when nothing changed since the current entry. */
export function pushState(src) {
  const snap = snapshot(src);
  if (pos >= 0 && same(stack[pos], snap)) {
    pruneImages(); // snapshot may have taken in an image no entry keeps
    return false;
  }
  stack.length = pos + 1;
  stack.push(snap);
  if (stack.length > MAX) stack.shift();
  pos = stack.length - 1;
  pruneImages();
  return true;
}

/**
 * After a restore, make the current entry the build as it now is on screen. Restore can only add to an entry (a field
 * the entry lacks keeps its live value), so without this the next commit would see a "change", cut off redo and push
 * a duplicate, and undo would land on the same state forever.
 */
export function syncCurrent(src) {
  if (pos < 0) return;
  stack[pos] = snapshot(src);
  pruneImages();
}

export function undo() {
  if (pos <= 0) return null;
  pos--;
  return expand(stack[pos]);
}

export function redo() {
  if (pos >= stack.length - 1) return null;
  pos++;
  return expand(stack[pos]);
}

export function canUndo() {
  return pos > 0;
}

export function canRedo() {
  return pos < stack.length - 1;
}

export function isEmpty() {
  return pos < 0;
}

/** Start history over at this build (boot, a shared link, a loaded build). */
export function resetHistory(src) {
  stack.length = 0;
  stack.push(snapshot(src));
  pos = 0;
  pruneImages();
}

/** For tests: the raw entries and image table size. */
export function _debugHistory() {
  return { entries: stack.slice(), pos, images: imageById.size };
}

import { BUILD_FIELDS } from './validBuild.js';

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

function internImage(dataUrl) {
  let id = idByImage.get(dataUrl);
  if (!id) {
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

/** A history entry for a build (the live state or a stateSlice()): copied, with key images swapped for ids. */
export function snapshot(src) {
  const out = {};
  BUILD_FIELDS.forEach((k) => {
    if (k === 'perKeyOverrides' || src[k] === undefined) return;
    out[k] = JSON.parse(JSON.stringify(src[k]));
  });
  const pk = src.perKeyOverrides;
  out.perKeyOverrides = {};
  if (pk && typeof pk === 'object') {
    Object.keys(pk).forEach((id) => {
      const o = pk[id];
      if (!o || typeof o !== 'object') return;
      const copy = {};
      Object.keys(o).forEach((f) => {
        if (f === 'imageData') {
          if (typeof o.imageData === 'string') copy.imageRef = internImage(o.imageData);
        } else if (o[f] !== undefined) copy[f] = JSON.parse(JSON.stringify(o[f]));
      });
      out.perKeyOverrides[id] = copy;
    });
  }
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

const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** Record the build as it is now. No-op when nothing changed since the current entry. */
export function pushState(src) {
  const snap = snapshot(src);
  if (pos >= 0 && same(stack[pos], snap)) return false;
  stack.length = pos + 1;
  stack.push(snap);
  if (stack.length > MAX) stack.shift();
  pos = stack.length - 1;
  pruneImages();
  return true;
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

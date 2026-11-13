/**
 * Miya pfp engine — Web Server
 * Place at:  miya-pfp-engine/gui/server.js
 * Run:       node gui/server.js
 * Open:      http://localhost:3000
 */

'use strict';

const http      = require('http');
const fs        = require('fs');
const fsp       = require('fs').promises;
const path      = require('path');
const { spawn } = require('child_process');
const {
  generateImageFromImage,
  getProviderStatus,
  resetAiChefCancellation,
  stopAiChefGeneration,
} = require('../src/aiChefService.js');
const {
  reindexOutputFiles: reindexOutputFilesPairSafe,
  shuffleOutputFiles: shuffleOutputFilesPairSafe,
} = require('./outputReindex.js');
const phase2Ops = require('./phase2.js');
const manualMakerOps = require('./manualMaker.js');
const generalMetadataOps = require('./generalMetadata.js');
const editTraitOps = require('./editTrait.js');
const sessionFilesystem = require('../storage/session-server.js');

const PORT       = Number(process.env.PORT || 3000);
const ENGINE_DIR = path.resolve(__dirname, '..');
const LAYERS_DIR = path.join(ENGINE_DIR, 'layers');
const BUILD_DIR  = path.join(ENGINE_DIR, 'build');
const PHASE2_DIR = path.join(ENGINE_DIR, 'buildphase2');
const MANUAL_MAKER_DIR = path.join(ENGINE_DIR, 'manualmaker');
const EDIT_TRAIT_DIR = path.join(ENGINE_DIR, 'edittrait');
const CONFIG_DST = path.join(ENGINE_DIR, 'src', 'config.js');
const GUI_DIR    = __dirname;
const DEFAULT_LAYERS_DIR = path.join(ENGINE_DIR, 'assets', 'default-layers');
const OUTPUT_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const OUTPUT_IMAGE_RE = /\.(png|jpg|jpeg|webp|gif)$/i;
const RARITY_SETUP_PATH = path.join(ENGINE_DIR, 'rarity-setup.json');

if (!fs.existsSync(LAYERS_DIR)) fs.mkdirSync(LAYERS_DIR, { recursive: true });
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });

async function initializeDefaultLayers() {
  const marker = path.join(LAYERS_DIR, '.miya-workspace-initialized');
  if (fs.existsSync(marker)) return;

  const bundled = await fsp.readdir(DEFAULT_LAYERS_DIR, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (!bundled.some(entry => entry.isDirectory())) throw new Error('Bundled default Miya layers are missing');
  const current = await fsp.readdir(LAYERS_DIR);
  const hasProjectData = current.some(name => !['.gitkeep', '.order', '.DS_Store'].includes(name));
  if (!hasProjectData) {
    for (const entry of bundled) {
      if (entry.isDirectory()) {
        await fsp.cp(path.join(DEFAULT_LAYERS_DIR, entry.name), path.join(LAYERS_DIR, entry.name), { recursive: true, force: true });
      } else if (entry.name === '.order') {
        await fsp.copyFile(path.join(DEFAULT_LAYERS_DIR, entry.name), path.join(LAYERS_DIR, entry.name));
      }
    }
    console.log(`[layers] Installed ${bundled.filter(entry => entry.isDirectory()).length} bundled Miya default layer folders`);
  } else if (hasProjectData) {
    console.log('[layers] Kept existing project layers; default layers are not applied over user data');
  }
  await fsp.writeFile(marker, 'initialized\n', 'utf8');
}

// ── SSE ──────────────────────────────────────────────────────────
let genProcess = null;
let sseClients = [];
let aiChefStopRequested = false;

function broadcast(data) {
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  sseClients = sseClients.filter(r => { try { r.write(msg); return true; } catch { return false; } });
}

// ── HTTP helpers ─────────────────────────────────────────────────
function jsonRes(res, data, code) {
  code = code || 200;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function errRes(res, msg, code) { jsonRes(res, { error: msg }, code || 500); }

function safePath(base, rel) {
  if (!rel) return path.resolve(base);
  const resolved = path.resolve(base, rel);
  const baseResolved = path.resolve(base);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

function readBody(req, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (maxBytes && size > maxBytes) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, maxBytes = 0) {
  const buf = await readBody(req, maxBytes);
  return JSON.parse(buf.toString('utf8'));
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!m || !m[2]) throw new Error('Expected a base64 data URL');
  const mime = m[1] || 'application/octet-stream';
  return { mime, data: Buffer.from(m[3], 'base64') };
}

function editionFileName(edition, outputJPEG) {
  return outputImageNameForExt(edition, outputJPEG ? '.jpg' : '.png');
}

function outputImageNameForExt(edition, ext) {
  const n = String(parseInt(edition, 10));
  if (!/^\d+$/.test(n)) throw new Error('Invalid edition number');
  const cleanExt = String(ext || '.png').toLowerCase();
  const safeExt = OUTPUT_IMAGE_EXTS.includes(cleanExt) ? cleanExt : '.png';
  return n + safeExt;
}

async function ensureBuildDirs() {
  await fsp.mkdir(path.join(BUILD_DIR, 'images'), { recursive: true });
  await fsp.mkdir(path.join(BUILD_DIR, 'json'), { recursive: true });
}

async function readMetaFile(file) {
  const data = await fsp.readFile(file, 'utf8');
  const meta = JSON.parse(data);
  const attrs = meta.attributes || meta.properties?.attributes || [];
  return { meta, attrs };
}

function isAiInfusedMetadata(meta) {
  const attrs = meta?.attributes || meta?.properties?.attributes || [];
  return attrs.some(a => String(a.trait_type || a.name || '').toLowerCase() === 'ai' && /ai infused/i.test(String(a.value || '')))
    || /ai infused/i.test(String(meta?.name || ''));
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function sanitizeRaritySetup(setup) {
  const out = { version: 1, folders: {} };
  Object.entries(setup?.folders || {}).forEach(([folderName, folder]) => {
    const cleanFolder = String(folderName || '').trim();
    if (!cleanFolder) return;
    const entry = {
      chance: clampPercent(folder?.chance, 100),
      traits: {},
    };
    Object.entries(folder?.traits || {}).forEach(([traitName, weight]) => {
      const cleanTrait = String(traitName || '').trim();
      if (!cleanTrait) return;
      entry.traits[cleanTrait] = clampPercent(weight, 100);
    });
    out.folders[cleanFolder] = entry;
  });
  return out;
}

async function readRaritySetupFile() {
  try {
    return sanitizeRaritySetup(JSON.parse(await fsp.readFile(RARITY_SETUP_PATH, 'utf8')));
  } catch {
    return { version: 1, folders: {} };
  }
}

async function readConfiguredStartEdition() {
  try {
    const configText = await fsp.readFile(CONFIG_DST, 'utf8');
    const match = configText.match(/\bstartEditionFrom\s*=\s*(\d+)/);
    const n = match ? Number(match[1]) : 1;
    return Number.isSafeInteger(n) && n >= 0 ? n : 1;
  } catch {
    return 1;
  }
}

function cleanAssetName(name) {
  return String(name || '')
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/#.*$/, '')
    .trim() || 'Trait';
}

async function uniqueFilePath(dir, baseName, ext) {
  let n = 1;
  while (true) {
    const suffix = n === 1 ? '' : ' ' + n;
    const fileName = `${baseName}${suffix}${ext}`;
    const full = path.join(dir, fileName);
    try {
      await fsp.access(full);
      n++;
    } catch {
      return { full, fileName };
    }
  }
}

async function findBuildImageByEdition(edition) {
  const imageDir = path.join(BUILD_DIR, 'images');
  const files = await fsp.readdir(imageDir).catch(() => []);
  const match = files.find(f => numericOutputStem(f) === edition && OUTPUT_IMAGE_RE.test(f));
  if (!match) throw new Error(`Image for edition #${edition} not found`);
  return { full: path.join(imageDir, match), name: match, ext: path.extname(match).toLowerCase() };
}

function numericOutputStem(fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  if (!/^\d+$/.test(stem)) return null;
  const n = Number(stem);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function readOutputNumberState() {
  const imageDir = path.join(BUILD_DIR, 'images');
  const jsonDir = path.join(BUILD_DIR, 'json');
  const imageNumbers = new Set();
  const jsonNumbers = new Set();
  let highestImageNumber = 0;

  const imageFiles = await fsp.readdir(imageDir).catch(() => []);
  imageFiles.forEach(f => {
    if (!OUTPUT_IMAGE_RE.test(f)) return;
    const n = numericOutputStem(f);
    if (n === null) return;
    imageNumbers.add(n);
    highestImageNumber = Math.max(highestImageNumber, n);
  });

  const jsonFiles = await fsp.readdir(jsonDir).catch(() => []);
  jsonFiles.forEach(f => {
    if (!/\.json$/i.test(f)) return;
    const n = numericOutputStem(f);
    if (n !== null) jsonNumbers.add(n);
  });

  return { highestImageNumber, imageNumbers, jsonNumbers };
}

async function reserveNextOutputSlot(opts = {}) {
  await ensureBuildDirs();
  const imageDir = path.join(BUILD_DIR, 'images');
  const jsonDir = path.join(BUILD_DIR, 'json');
  const state = await readOutputNumberState();
  const outputExt = opts.outputExt || (opts.outputJPEG ? '.jpg' : '.png');
  let edition = Math.max(1, state.highestImageNumber + 1);

  while (state.imageNumbers.has(edition) || state.jsonNumbers.has(edition)) {
    edition++;
  }

  const imageName = outputImageNameForExt(edition, outputExt);
  const jsonName = edition + '.json';
  return {
    previousHighest: state.highestImageNumber,
    edition,
    imageName,
    imagePath: path.join(imageDir, imageName),
    jsonName,
    jsonPath: path.join(jsonDir, jsonName),
  };
}

function updateSavedOutputMetadata(meta, edition, imageName) {
  const out = (meta && typeof meta === 'object' && !Array.isArray(meta)) ? { ...meta } : {};
  const replaceNumberedImage = value => {
    if (typeof value !== 'string' || !value) return imageName;
    const replaced = value.replace(/(^|\/)(\d+)\.(png|jpg|jpeg|webp|gif)(?=($|[?#]))/i, `$1${imageName}`);
    return replaced;
  };

  if (Object.prototype.hasOwnProperty.call(out, 'edition')) out.edition = edition;

  if (typeof out.name === 'string' && out.name.trim()) {
    const replacedName = out.name.replace(/#\s*\d+\b/g, `#${edition}`);
    out.name = replacedName;
  } else {
    out.name = `#${edition}`;
  }

  out.image = replaceNumberedImage(out.image);
  return out;
}

let outputSaveLock = Promise.resolve();
async function withOutputSaveLock(fn) {
  const previous = outputSaveLock;
  let release;
  outputSaveLock = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function writeNewOutputPiece({ imageData, imageSourcePath, outputExt, metadata }) {
  return withOutputSaveLock(async () => {
    const slot = await reserveNextOutputSlot({ outputExt });
    const finalMeta = updateSavedOutputMetadata(metadata, slot.edition, slot.imageName);

    try {
      if (imageData) {
        await fsp.writeFile(slot.imagePath, imageData, { flag: 'wx' });
      } else if (imageSourcePath) {
        await fsp.copyFile(imageSourcePath, slot.imagePath, fs.constants.COPYFILE_EXCL);
      } else {
        throw new Error('No image data provided for output save');
      }
      await fsp.writeFile(slot.jsonPath, JSON.stringify(finalMeta, null, 2), { encoding: 'utf8', flag: 'wx' });
    } catch (e) {
      await fsp.rm(slot.imagePath, { force: true }).catch(() => {});
      await fsp.rm(slot.jsonPath, { force: true }).catch(() => {});
      throw e;
    }

    return { ...slot, metadata: finalMeta };
  });
}

function imageContentTypeFromExt(ext) {
  return ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

// ── Multipart parser ─────────────────────────────────────────────
// Correctly splits on \r\n--boundary and trims trailing \r\n from each body.
function parseMultipart(buf, boundary) {
  const results = [];
  const b = Buffer.from('\r\n--' + boundary);

  // Prepend \r\n so first part matches the same pattern
  const full = Buffer.concat([Buffer.from('\r\n'), buf]);
  let pos = 0;

  while (true) {
    const partStart = full.indexOf(b, pos);
    if (partStart < 0) break;

    const afterBound = partStart + b.length;

    // Check if this is the final boundary (followed by --)
    if (full.slice(afterBound, afterBound + 2).equals(Buffer.from('--'))) break;

    // Skip \r\n after boundary line
    const contentStart = afterBound + 2;

    // Find next boundary
    const nextBound = full.indexOf(b, contentStart);
    const partEnd   = nextBound < 0 ? full.length : nextBound;

    // Split headers from body at \r\n\r\n
    const headerEnd = full.indexOf('\r\n\r\n', contentStart);
    if (headerEnd < 0 || headerEnd >= partEnd) { pos = afterBound; continue; }

    const headerStr = full.slice(contentStart, headerEnd).toString('utf8');
    const bodyData  = full.slice(headerEnd + 4, partEnd);

    const cdLine    = (headerStr.match(/Content-Disposition:[^\r\n]*/i) || [''])[0];
    const nameMatch = cdLine.match(/\bname="([^"]+)"/);
    const fileMatch = cdLine.match(/\bfilename="([^"]+)"/);

    if (nameMatch && fileMatch) {
      results.push({ fieldName: nameMatch[1], fileName: fileMatch[1], data: bodyData });
    }

    if (nextBound < 0) break;
    pos = nextBound;
  }

  return results;
}

// ── Directory listing ────────────────────────────────────────────
async function listDir(dirPath, rel) {
  rel = rel || '';
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return []; }

  let dirs     = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
  const images = entries.filter(e => e.isFile() && /\.(png|jpg|jpeg|gif|webp)$/i.test(e.name));

  // Respect .order file at root level
  if (rel === '') {
    try {
      const raw   = await fsp.readFile(path.join(dirPath, '.order'), 'utf8');
      const order = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const byName = {};
      dirs.forEach(d => { byName[d.name] = d; });
      const ordered = order.filter(n => byName[n]).map(n => byName[n]);
      const rest    = dirs.filter(d => !order.includes(d.name));
      dirs = ordered.concat(rest);
    } catch { /* no order file */ }
  }

  const result = [];

  for (const e of dirs) {
    const rp = rel ? rel + '/' + e.name : e.name;
    result.push({
      name:     e.name,
      path:     rp,
      type:     'dir',
      children: await listDir(path.join(dirPath, e.name), rp),
    });
  }

  for (const e of images) {
    const rp = rel ? rel + '/' + e.name : e.name;
    let size = 0;
    try { size = (await fsp.stat(path.join(dirPath, e.name))).size; } catch {}
    result.push({ name: e.name, path: rp, type: 'file', size });
  }

  return result;
}

// ── Build listing ────────────────────────────────────────────────
async function listBuild() {
  const imgDir = path.join(BUILD_DIR, 'images');
  if (!fs.existsSync(imgDir)) return [];
  const files = await fsp.readdir(imgDir);
  return files
    .filter(f => parseOutputFileName(f, OUTPUT_IMAGE_EXTS))
    .sort((a, b) => {
      const na = parseOutputFileName(a, OUTPUT_IMAGE_EXTS)?.numeric;
      const nb = parseOutputFileName(b, OUTPUT_IMAGE_EXTS)?.numeric;
      return (!Number.isFinite(na) || !Number.isFinite(nb)) ? a.localeCompare(b) : na - nb;
    })
    .map(f => ({ name: f, path: 'images/' + f }));
}

function parseOutputFileName(fileName, allowedExts) {
  const original = String(fileName || '');
  const trimmed = original.trim();
  const match = trimmed.match(/^(.+?)(\.[^.\/\\\s]+)$/);
  if (!match) return null;
  const ext = match[2].toLowerCase();
  if (!allowedExts.includes(ext)) return null;
  const stem = match[1].trim();
  if (!stem) return null;
  const numeric = /^\d+$/.test(stem) ? parseInt(stem, 10) : null;
  return {
    fileName: original,
    stem,
    ext,
    numeric,
    normalizedName: stem + ext,
    needsCleanup: original !== stem + ext,
  };
}

function outputNameParts(fileName) {
  return parseOutputFileName(fileName, OUTPUT_IMAGE_EXTS);
}

function sortOutputParts(a, b) {
  if (a.numeric !== null && b.numeric !== null && a.numeric !== b.numeric) return a.numeric - b.numeric;
  if (a.numeric !== null && b.numeric === null) return -1;
  if (a.numeric === null && b.numeric !== null) return 1;
  return a.fileName.localeCompare(b.fileName);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceImageFilenameReferences(value, oldStem, oldImageName, newImageName) {
  if (typeof value !== 'string') return value;
  let next = value;
  next = next.replace(new RegExp(`(^|/)${escapeRegExp(oldImageName)}(?=($|[?#]))`, 'g'), `$1${newImageName}`);
  if (/^\d+$/.test(oldStem)) {
    next = next.replace(new RegExp(`(^|/)${oldStem}\\s*\\.(png|jpg|jpeg|webp|gif)(?=($|[?#]))`, 'i'), `$1${newImageName}`);
  }
  if (next === oldImageName) return newImageName;
  if (next.endsWith('/' + oldImageName)) return next.slice(0, -oldImageName.length) + newImageName;
  return next;
}

function replaceClearNameIndex(value, oldStem, newEdition) {
  if (typeof value !== 'string' || !/^\d+$/.test(String(oldStem))) return value;
  const oldIndex = String(oldStem);
  const next = value
    .replace(new RegExp(`#\\s*${escapeRegExp(oldIndex)}(?!\\d)`, 'g'), `#${newEdition}`)
    .replace(new RegExp(`(^|\\s)${escapeRegExp(oldIndex)}(?=\\s*$)`, 'g'), `$1${newEdition}`);
  return value === oldIndex ? String(newEdition) : next;
}

function updatedIndexFieldValue(value, oldStem, newEdition) {
  if (typeof value === 'number') return newEdition;
  if (typeof value === 'string' && value.trim() === String(oldStem)) return String(newEdition);
  return value;
}

function updateReindexedMetadata(meta, oldStem, oldImageName, newEdition, newImageName) {
  const out = { ...meta };
  ['edition', 'tokenId', 'token_id', 'id'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = updatedIndexFieldValue(out[key], oldStem, newEdition);
    }
  });
  if (Object.prototype.hasOwnProperty.call(out, 'name')) out.name = replaceClearNameIndex(out.name, oldStem, newEdition);
  if (Object.prototype.hasOwnProperty.call(out, 'image')) out.image = replaceImageFilenameReferences(out.image, oldStem, oldImageName, newImageName);
  return out;
}

function replaceFileNameReference(value, oldName, newName) {
  if (typeof value !== 'string' || !value) return value;
  if (value === oldName) return newName;
  return value.replace(new RegExp(`(^|/)${escapeRegExp(oldName)}(?=($|[?#]))`, 'g'), `$1${newName}`);
}

async function updateCleanedMetadataImageReferences(imageOps) {
  const jsonDir = path.join(BUILD_DIR, 'json');
  const warnings = [];
  let metadataUpdated = 0;
  if (!imageOps.length) return { metadataUpdated, warnings };

  const jsonFiles = (await fsp.readdir(jsonDir).catch(() => []))
    .filter(f => parseOutputFileName(f, ['.json']));
  for (const file of jsonFiles) {
    const full = path.join(jsonDir, file);
    try {
      const meta = JSON.parse(await fsp.readFile(full, 'utf8'));
      if (!Object.prototype.hasOwnProperty.call(meta, 'image')) continue;
      let image = meta.image;
      for (const op of imageOps) image = replaceFileNameReference(image, op.oldName, op.newName);
      if (image !== meta.image) {
        meta.image = image;
        await fsp.writeFile(full, JSON.stringify(meta, null, 2), 'utf8');
        metadataUpdated++;
      }
    } catch (e) {
      warnings.push(`Invalid JSON metadata in ${file}: ${e.message}`);
    }
  }
  return { metadataUpdated, warnings };
}

function buildOutputPairs(imageParts, jsonParts, warnings, logs) {
  const jsonByStem = new Map();
  jsonParts.forEach(part => {
    if (jsonByStem.has(part.stem)) {
      warnings.push(`Duplicate metadata for ${part.stem}; ${part.fileName} was left as an orphan`);
      logs.push({ level: 'warning', message: `Duplicate metadata for ${part.stem}: ${part.fileName}` });
      return;
    }
    jsonByStem.set(part.stem, part);
  });

  const usedJson = new Set();
  const pairs = imageParts.sort(sortOutputParts).map(image => {
    const json = jsonByStem.get(image.stem);
    if (json && !usedJson.has(json.fileName)) {
      usedJson.add(json.fileName);
      return { image, json };
    }
    warnings.push(`Missing metadata for ${image.fileName}`);
    logs.push({ level: 'warning', message: `Missing metadata for ${image.fileName}` });
    return { image, json: null };
  });

  jsonParts.forEach(json => {
    if (!usedJson.has(json.fileName)) {
      warnings.push(`Orphan metadata has no matching image: ${json.fileName}`);
      logs.push({ level: 'warning', message: `Orphan metadata: ${json.fileName}` });
    }
  });

  return pairs;
}

function planSafeRenameOp({ dir, type, oldName, newName, batchId, index, existingNames, plannedTargets }) {
  if (!newName || oldName === newName) return { op: null };
  const oldKey = oldName.toLowerCase();
  const newKey = newName.toLowerCase();
  if (plannedTargets.has(`${type}:${newKey}`)) {
    return { error: `Could not rename ${oldName}: another ${type} is already being renamed to ${newName}` };
  }
  if (newKey !== oldKey && existingNames.has(newKey)) {
    return { error: `Could not rename ${oldName}: ${newName} already exists` };
  }
  plannedTargets.add(`${type}:${newKey}`);
  return {
    op: {
      type,
      oldName,
      newName,
      oldFull: path.join(dir, oldName),
      tempFull: path.join(dir, `${batchId}_${type}_${index}${path.extname(newName)}`),
      finalFull: path.join(dir, newName),
    },
  };
}

async function runTwoPhaseCleanupOperations(operations, warnings, logs) {
  const failedPairs = new Set();
  for (const op of operations) {
    try {
      await fsp.rename(op.oldFull, op.tempFull);
    } catch (e) {
      failedPairs.add(op.pairId);
      warnings.push(`Could not prepare rename ${op.oldName}: ${e.message}`);
      logs.push({ level: 'error', message: `Could not prepare rename ${op.oldName}: ${e.message}` });
    }
  }

  for (const op of operations) {
    if (!failedPairs.has(op.pairId) || !op.tempFull) continue;
    await fsp.rename(op.tempFull, op.oldFull).catch(() => {});
  }

  const completed = [];
  for (const op of operations) {
    if (failedPairs.has(op.pairId)) continue;
    try {
      await fsp.rename(op.tempFull, op.finalFull);
      completed.push(op);
      logs.push({ level: 'success', message: `Fixed filename: ${op.oldName} -> ${op.newName}` });
    } catch (e) {
      failedPairs.add(op.pairId);
      warnings.push(`Could not finish rename ${op.oldName}: ${e.message}`);
      logs.push({ level: 'error', message: `Could not finish rename ${op.oldName}: ${e.message}` });
      await fsp.rename(op.tempFull, op.oldFull).catch(() => {});
    }
  }
  return completed.filter(op => !failedPairs.has(op.pairId));
}

async function readOutputInventory() {
  const imageDir = path.join(BUILD_DIR, 'images');
  const jsonDir = path.join(BUILD_DIR, 'json');
  const allImageFiles = await fsp.readdir(imageDir).catch(() => []);
  const allJsonFiles = await fsp.readdir(jsonDir).catch(() => []);
  const imageParts = allImageFiles.map(f => parseOutputFileName(f, OUTPUT_IMAGE_EXTS)).filter(Boolean);
  const jsonParts = allJsonFiles.map(f => parseOutputFileName(f, ['.json'])).filter(Boolean);
  return { imageDir, jsonDir, allImageFiles, allJsonFiles, imageParts, jsonParts };
}

function outputOpFailure(message, logs, warnings, errors, extra = {}) {
  errors.push(message);
  logs.push({ level: 'error', message });
  return { ok: false, error: message, warnings, errors, logs, ...extra };
}

function buildStrictOutputPairs(inventory, logs, warnings, errors) {
  const imageByStem = new Map();
  const jsonByStem = new Map();

  inventory.imageParts.forEach(image => {
    if (imageByStem.has(image.stem)) {
      const first = imageByStem.get(image.stem);
      errors.push(`Duplicate image number/stem "${image.stem}": ${first.fileName} and ${image.fileName}`);
    } else {
      imageByStem.set(image.stem, image);
    }
  });

  inventory.jsonParts.forEach(json => {
    if (jsonByStem.has(json.stem)) {
      const first = jsonByStem.get(json.stem);
      errors.push(`Duplicate metadata number/stem "${json.stem}": ${first.fileName} and ${json.fileName}`);
    } else {
      jsonByStem.set(json.stem, json);
    }
  });

  errors.forEach(message => logs.push({ level: 'error', message }));

  const pairs = [...imageByStem.values()].sort(sortOutputParts).map(image => {
    const json = jsonByStem.get(image.stem) || null;
    if (!json) {
      const warning = `Missing metadata for ${image.fileName}`;
      warnings.push(warning);
      logs.push({ level: 'warning', message: warning });
    }
    return { stem: image.stem, image, json };
  });

  const imageStems = new Set(pairs.map(pair => pair.stem));
  inventory.jsonParts.forEach(json => {
    if (!imageStems.has(json.stem)) {
      const warning = `Orphan metadata has no matching image: ${json.fileName}`;
      warnings.push(warning);
      logs.push({ level: 'warning', message: warning });
    }
  });

  logs.push({ level: 'info', message: `Built ${pairs.length} image/JSON pair(s)` });
  return pairs;
}

function addIncompletePairErrors(inventory, pairs, actionName, logs, errors) {
  const imageStems = new Set(inventory.imageParts.map(image => image.stem));
  pairs.forEach(pair => {
    if (pair.json) return;
    const message = `Cannot ${actionName} safely because ${pair.image.fileName} has no matching JSON metadata.`;
    errors.push(message);
    logs.push({ level: 'error', message });
  });
  inventory.jsonParts.forEach(json => {
    if (imageStems.has(json.stem)) return;
    const message = `Cannot ${actionName} safely because ${json.fileName} has no matching image.`;
    errors.push(message);
    logs.push({ level: 'error', message });
  });
}

function outputPairFinalName(pair, newEdition) {
  return {
    newEdition,
    newImageName: `${newEdition}${pair.image.ext.toLowerCase()}`,
    newJsonName: pair.json ? `${newEdition}.json` : null,
  };
}

function makePairRenameOperations(mappings, imageDir, jsonDir, batchId) {
  const operations = [];
  mappings.forEach((mapping, index) => {
    const imageOldFull = path.join(imageDir, mapping.imageOld);
    const imageFinalFull = path.join(imageDir, mapping.imageNew);
    if (path.resolve(imageOldFull) !== path.resolve(imageFinalFull)) {
      operations.push({
        type: 'image',
        pairIndex: index,
        oldName: mapping.imageOld,
        newName: mapping.imageNew,
        oldFull: imageOldFull,
        tempFull: path.join(imageDir, `${batchId}_img_${index}${path.extname(mapping.imageNew)}`),
        finalFull: imageFinalFull,
      });
    }

    if (!mapping.jsonOld || !mapping.jsonNew) return;
    const jsonOldFull = path.join(jsonDir, mapping.jsonOld);
    const jsonFinalFull = path.join(jsonDir, mapping.jsonNew);
    if (path.resolve(jsonOldFull) !== path.resolve(jsonFinalFull)) {
      operations.push({
        type: 'json',
        pairIndex: index,
        oldName: mapping.jsonOld,
        newName: mapping.jsonNew,
        oldFull: jsonOldFull,
        tempFull: path.join(jsonDir, `${batchId}_json_${index}.json`),
        finalFull: jsonFinalFull,
      });
    }
  });
  return operations;
}

async function preflightPairRenames(operations, logs, warnings, errors) {
  const oldPaths = new Set(operations.map(op => path.resolve(op.oldFull).toLowerCase()));
  const finalTargets = new Set();
  const tempTargets = new Set();

  for (const op of operations) {
    const finalKey = path.resolve(op.finalFull).toLowerCase();
    const tempKey = path.resolve(op.tempFull).toLowerCase();
    if (finalTargets.has(finalKey)) errors.push(`Rename collision: multiple files target ${op.newName}`);
    if (tempTargets.has(tempKey)) errors.push(`Temporary rename collision for ${op.oldName}`);
    finalTargets.add(finalKey);
    tempTargets.add(tempKey);

    try {
      await fsp.access(op.tempFull);
      errors.push(`Temporary path already exists: ${path.basename(op.tempFull)}`);
    } catch (e) {
      if (e.code !== 'ENOENT') errors.push(`Could not validate temporary path for ${op.oldName}: ${e.message}`);
    }

    try {
      await fsp.access(op.finalFull);
      if (!oldPaths.has(finalKey)) errors.push(`Final path already exists and is not part of this operation: ${op.newName}`);
    } catch (e) {
      if (e.code !== 'ENOENT') errors.push(`Could not validate final path for ${op.oldName}: ${e.message}`);
    }
  }

  errors.forEach(message => logs.push({ level: 'error', message }));
  return errors.length === 0;
}

async function movePairsToTemporary(operations, logs) {
  const moved = [];
  try {
    for (const op of operations) {
      await fsp.rename(op.oldFull, op.tempFull);
      moved.push(op);
    }
    return { ok: true, moved };
  } catch (e) {
    logs.push({ level: 'error', message: `Could not prepare pair rename: ${e.message}` });
    for (const op of moved.reverse()) await fsp.rename(op.tempFull, op.oldFull).catch(() => {});
    return { ok: false, error: e.message };
  }
}

async function movePairsToFinal(operations, logs) {
  const finalized = [];
  try {
    for (const op of operations) {
      await fsp.rename(op.tempFull, op.finalFull);
      finalized.push(op);
    }
    return { ok: true };
  } catch (e) {
    logs.push({ level: 'error', message: `Could not finish pair rename: ${e.message}` });
    for (const op of operations) {
      if (!finalized.includes(op)) await fsp.rename(op.tempFull, op.oldFull).catch(() => {});
    }
    for (const op of finalized.reverse()) await fsp.rename(op.finalFull, op.oldFull).catch(() => {});
    return { ok: false, error: e.message };
  }
}

async function cleanupOutputFilenames() {
  await ensureBuildDirs();
  const { imageDir, jsonDir, allImageFiles, allJsonFiles, imageParts, jsonParts } = await readOutputInventory();
  const warnings = [];
  const logs = [{ level: 'info', message: 'Checking output filename spacing' }];
  const renames = [];
  const imageExisting = new Set(allImageFiles.map(f => f.toLowerCase()));
  const jsonExisting = new Set(allJsonFiles.map(f => f.toLowerCase()));
  const plannedTargets = new Set();
  const operations = [];
  const batchId = `.__cleanup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pairs = buildOutputPairs(imageParts, jsonParts, warnings, logs);
  let opIndex = 0;

  pairs.forEach((pair, pairIndex) => {
    const pairOps = [];
    const pairErrors = [];
    const imagePlan = planSafeRenameOp({
      dir: imageDir,
      type: 'image',
      oldName: pair.image.fileName,
      newName: pair.image.normalizedName,
      batchId,
      index: opIndex++,
      existingNames: imageExisting,
      plannedTargets,
    });
    if (imagePlan.error) pairErrors.push(imagePlan.error);
    if (imagePlan.op) pairOps.push({ ...imagePlan.op, pairId: `piece-${pairIndex}` });

    if (pair.json) {
      const jsonPlan = planSafeRenameOp({
        dir: jsonDir,
        type: 'json',
        oldName: pair.json.fileName,
        newName: pair.json.normalizedName,
        batchId,
        index: opIndex++,
        existingNames: jsonExisting,
        plannedTargets,
      });
      if (jsonPlan.error) pairErrors.push(jsonPlan.error);
      if (jsonPlan.op) pairOps.push({ ...jsonPlan.op, pairId: `piece-${pairIndex}` });
    }

    if (pairErrors.length) {
      pairErrors.forEach(msg => {
        warnings.push(msg);
        logs.push({ level: 'warning', message: msg });
      });
      return;
    }
    operations.push(...pairOps);
  });

  jsonParts
    .filter(json => !imageParts.some(image => image.stem === json.stem))
    .forEach((json, index) => {
      const jsonPlan = planSafeRenameOp({
        dir: jsonDir,
        type: 'json',
        oldName: json.fileName,
        newName: json.normalizedName,
        batchId,
        index: opIndex++,
        existingNames: jsonExisting,
        plannedTargets,
      });
      if (jsonPlan.error) {
        warnings.push(jsonPlan.error);
        logs.push({ level: 'warning', message: jsonPlan.error });
      } else if (jsonPlan.op) {
        operations.push({ ...jsonPlan.op, pairId: `orphan-json-${index}` });
      }
    });

  const completed = await runTwoPhaseCleanupOperations(operations, warnings, logs);
  completed.forEach(op => renames.push(`${op.oldName} -> ${op.newName}`));
  const imageOps = completed.filter(op => op.type === 'image');
  const metadataRefs = await updateCleanedMetadataImageReferences(imageOps);
  metadataRefs.warnings.forEach(w => logs.push({ level: 'warning', message: w }));
  if (!completed.length) logs.push({ level: 'info', message: 'No filename spacing issues found' });

  return {
    cleanupRenamed: renames.length,
    cleanupImageRenamed: completed.filter(op => op.type === 'image').length,
    cleanupMetadataRenamed: completed.filter(op => op.type === 'json').length,
    cleanupMetadataUpdated: metadataRefs.metadataUpdated,
    cleanupRenames: renames,
    warnings: [...warnings, ...metadataRefs.warnings],
    logs,
  };
}

function shuffledEditions(count) {
  const values = Array.from({ length: count }, (_, index) => index + 1);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

async function randomizeOutputOrder() {
  await ensureBuildDirs();
  const warnings = [];
  const errors = [];
  const logs = [
    { level: 'info', message: 'Randomize Output Order started' },
    { level: 'info', message: 'Scanning build/images and metadata folder' },
    { level: 'info', message: 'Building image/JSON pairs' },
  ];
  const renames = [];

  const { imageDir, jsonDir, imageParts, jsonParts } = await readOutputInventory();
  const inventory = { imageParts, jsonParts };
  const pairs = buildStrictOutputPairs(inventory, logs, warnings, errors);
  addIncompletePairErrors(inventory, pairs, 'randomize', logs, errors);
  if (errors.length) {
    return outputOpFailure('Cannot randomize safely because output pairing is ambiguous. Operation aborted.', logs, warnings, errors, {
      pairsProcessed: 0,
      imagesRenamed: 0,
      jsonRenamed: 0,
      renames,
    });
  }

  if (!pairs.length) {
    warnings.push('Output image folder is empty; nothing to randomize.');
    logs.push({ level: 'warning', message: 'Output image folder is empty; nothing to randomize' });
    return {
      ok: true,
      pairsProcessed: 0,
      imagesRenamed: 0,
      jsonRenamed: 0,
      metadataUpdated: 0,
      warnings,
      errors,
      renames,
      logs,
    };
  }

  logs.push({ level: 'info', message: 'Creating shuffle mapping' });
  const assignedNumbers = shuffledEditions(pairs.length);
  const mappings = pairs.map((pair, index) => {
    const newEdition = assignedNumbers[index];
    const finalNames = outputPairFinalName(pair, newEdition);
    return {
      oldStem: pair.image.stem,
      oldNumber: pair.image.numeric,
      newNumber: newEdition,
      imageOld: pair.image.fileName,
      imageNew: finalNames.newImageName,
      jsonOld: pair.json?.fileName || null,
      jsonNew: finalNames.newJsonName,
      newEdition,
      newImageName: finalNames.newImageName,
    };
  });

  mappings.slice(0, 25).forEach(mapping => {
    if (mapping.jsonOld) {
      logs.push({ level: 'info', message: `Shuffle mapping: ${mapping.imageOld} + ${mapping.jsonOld} -> ${mapping.imageNew} + ${mapping.jsonNew}` });
    } else {
      logs.push({ level: 'warning', message: `Shuffle mapping: ${mapping.imageOld} -> ${mapping.imageNew} (metadata missing)` });
    }
  });
  if (mappings.length > 25) {
    logs.push({ level: 'debug', message: `Shuffle mapping log trimmed: ${mappings.length - 25} additional pair(s)` });
  }

  const batchId = `.__shuffle_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const operations = makePairRenameOperations(mappings.map(mapping => ({
    imageOld: mapping.imageOld,
    imageNew: mapping.imageNew,
    jsonOld: mapping.jsonOld,
    jsonNew: mapping.jsonNew,
  })), imageDir, jsonDir, batchId);

  logs.push({ level: 'info', message: 'Validating pair-safe rename plan' });
  const preflightOk = await preflightPairRenames(operations, logs, warnings, errors);
  if (!preflightOk) {
    return outputOpFailure('Cannot randomize safely because rename validation failed. Operation aborted.', logs, warnings, errors, {
      pairsProcessed: 0,
      imagesRenamed: 0,
      jsonRenamed: 0,
      renames,
    });
  }

  logs.push({ level: 'info', message: 'Renaming output pairs to temporary files' });
  const toTemp = await movePairsToTemporary(operations, logs);
  if (!toTemp.ok) {
    return outputOpFailure(`Cannot randomize safely because temporary rename failed: ${toTemp.error}`, logs, warnings, errors, {
      pairsProcessed: 0,
      imagesRenamed: 0,
      jsonRenamed: 0,
      renames,
    });
  }

  logs.push({ level: 'info', message: 'Renaming output pairs to randomized final names' });
  const toFinal = await movePairsToFinal(operations, logs);
  if (!toFinal.ok) {
    return outputOpFailure(`Cannot randomize safely because final rename failed: ${toFinal.error}`, logs, warnings, errors, {
      pairsProcessed: 0,
      imagesRenamed: 0,
      jsonRenamed: 0,
      renames,
    });
  }

  let metadataUpdated = 0;
  logs.push({ level: 'info', message: 'Updating metadata content' });
  for (const mapping of mappings) {
    if (!mapping.jsonOld || !mapping.jsonNew) continue;
    const source = path.join(jsonDir, mapping.jsonNew);
    try {
      const meta = JSON.parse(await fsp.readFile(source, 'utf8'));
      const updated = updateReindexedMetadata(meta, mapping.oldStem, mapping.imageOld, mapping.newEdition, mapping.newImageName);
      await fsp.writeFile(source, JSON.stringify(updated, null, 2), 'utf8');
      metadataUpdated++;
      logs.push({ level: 'success', message: `Metadata updated: ${mapping.jsonNew}` });
    } catch (e) {
      const warning = `Metadata content could not be updated for ${mapping.jsonNew}: ${e.message}`;
      warnings.push(warning);
      logs.push({ level: 'warning', message: warning });
    }
  }

  operations.forEach(op => {
    if (op.oldName !== op.newName) {
      renames.push(`${op.oldName} -> ${op.newName}`);
      logs.push({ level: 'success', message: `Randomized ${op.oldName} -> ${op.newName}` });
    }
  });
  logs.push({ level: 'success', message: `Randomize complete: ${pairs.length} pair(s) shuffled` });

  return {
    ok: true,
    pairsProcessed: pairs.length,
    imagesRenamed: operations.filter(op => op.type === 'image' && op.oldName !== op.newName).length,
    jsonRenamed: operations.filter(op => op.type === 'json' && op.oldName !== op.newName).length,
    metadataUpdated,
    warnings,
    errors,
    renames,
    logs,
  };
}

async function deleteOutputPairFiles(pair, inventory, logs) {
  const warnings = [];
  const errors = [];
  let deletedImages = 0;
  let deletedJson = 0;
  const pairLabel = pair.json
    ? `${pair.image.fileName} + ${pair.json.fileName}`
    : `${pair.image.fileName} + missing metadata`;
  logs.push({ level: 'info', message: `Deleting pair: ${pairLabel}` });

  try {
    await fsp.rm(path.join(inventory.imageDir, pair.image.fileName));
    deletedImages++;
    logs.push({ level: 'success', message: `Deleted image: ${pair.image.fileName}` });
  } catch (e) {
    const message = `Failed deleting image ${pair.image.fileName}: ${e.message}`;
    errors.push(message);
    logs.push({ level: 'error', message });
  }

  if (pair.json) {
    try {
      await fsp.rm(path.join(inventory.jsonDir, pair.json.fileName));
      deletedJson++;
      logs.push({ level: 'success', message: `Deleted metadata: ${pair.json.fileName}` });
    } catch (e) {
      const message = `Failed deleting metadata ${pair.json.fileName}: ${e.message}`;
      errors.push(message);
      logs.push({ level: 'error', message });
    }
  } else {
    const warning = `Missing metadata for ${pair.image.fileName}`;
    warnings.push(warning);
    logs.push({ level: 'warning', message: warning });
  }

  return { deletedImages, deletedJson, warnings, errors };
}

async function readOutputPairsForAction(logs) {
  await ensureBuildDirs();
  const warnings = [];
  const errors = [];
  const inventory = await readOutputInventory();
  const pairs = buildStrictOutputPairs(inventory, logs, warnings, errors);
  return { inventory, pairs, warnings, errors, logs };
}

// ── Server ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u  = new URL(req.url, 'http://localhost:' + PORT);
  const p  = u.pathname;

  try {

    // ── index.html ──────────────────────────────────────────────
    if (req.method === 'GET' && p === '/') {
      const html = await fsp.readFile(path.join(GUI_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html); return;
    }

    if (req.method === 'GET' && p.startsWith('/storage/')) {
      const relative = p.slice('/storage/'.length);
      if (!['filesystem.js', 'recent.js', 'sessions.js'].includes(relative)) { res.writeHead(404); res.end('Not found'); return; }
      const file = path.join(ENGINE_DIR, 'storage', relative);
      const script = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(script); return;
    }

    if (req.method === 'GET' && p === '/api/session/export') {
      const workspace = await sessionFilesystem.buildSessionFilePackage(ENGINE_DIR);
      jsonRes(res, { ok: true, workspace }); return;
    }

    if (req.method === 'POST' && p === '/api/session/restore') {
      const body = await readJSON(req, 410 * 1024 * 1024);
      const result = await sessionFilesystem.restoreSessionFiles(ENGINE_DIR, body);
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/session/new') {
      jsonRes(res, await sessionFilesystem.resetWorkspace(ENGINE_DIR)); return;
    }

    // ── SSE log stream ──────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/log-stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.push(res);
      req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
      return;
    }

    // ── Server status ───────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/status') {
      jsonRes(res, {
        ok: true,
        engineDir:    ENGINE_DIR,
        layersDir:    LAYERS_DIR,
        buildDir:     BUILD_DIR,
        configPath:   CONFIG_DST,
        engineExists: fs.existsSync(path.join(ENGINE_DIR, 'index.js')),
      }); return;
    }

    // ── Rarity setup persistence ───────────────────────────────
    if (req.method === 'GET' && p === '/api/rarity-setup') {
      jsonRes(res, { ok: true, setup: await readRaritySetupFile() }); return;
    }

    if (req.method === 'POST' && p === '/api/rarity-setup') {
      const body = await readJSON(req);
      const setup = sanitizeRaritySetup(body.setup || body);
      await fsp.writeFile(RARITY_SETUP_PATH, JSON.stringify(setup, null, 2), 'utf8');
      jsonRes(res, { ok: true, setup, path: RARITY_SETUP_PATH }); return;
    }

    // ── AI Chef provider status ────────────────────────────────
    if (req.method === 'GET' && p === '/api/ai-chef/status') {
      jsonRes(res, { ok: true, ...(await getProviderStatus()) }); return;
    }

    if (req.method === 'POST' && p === '/api/ai-chef/stop') {
      aiChefStopRequested = true;
      const stopped = stopAiChefGeneration('AI Chef generation stopped by user');
      jsonRes(res, {
        ok: true,
        status: 'stopping',
        stopped,
        logs: [
          { level: 'warning', message: 'Stop requested for AI Chef generation' },
          { level: 'info', message: 'Queued AI Chef items will be skipped' },
          { level: 'info', message: `DiffusionBee active jobs cancelled: ${stopped.diffusionbee.activeJobsCancelled}; process(es) signalled: ${stopped.diffusionbee.processesSignalled}` },
        ],
      }); return;
    }

    // ── List layers ─────────────────────────────────────────────
    if (req.method === 'GET' && p === '/api/layers') {
      jsonRes(res, { layers: await listDir(LAYERS_DIR) }); return;
    }

    // ── Create folder ───────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/layers/folder') {
      const body = await readJSON(req);
      if (!body.path) { errRes(res, 'path required'); return; }
      await fsp.mkdir(safePath(LAYERS_DIR, body.path), { recursive: true });
      jsonRes(res, { ok: true }); return;
    }

    // ── Delete file or folder ───────────────────────────────────
    if (req.method === 'DELETE' && p === '/api/layers') {
      const body   = await readJSON(req);
      const target = safePath(LAYERS_DIR, body.path);
      const stat   = await fsp.stat(target);
      if (stat.isDirectory()) await fsp.rm(target, { recursive: true, force: true });
      else                    await fsp.unlink(target);
      jsonRes(res, { ok: true }); return;
    }

    // ── Rename ──────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/layers/rename') {
      const body = await readJSON(req);
      await fsp.rename(safePath(LAYERS_DIR, body.from), safePath(LAYERS_DIR, body.to));
      jsonRes(res, { ok: true }); return;
    }

    // ── Save layer order ────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/layers/reorder') {
      const body = await readJSON(req);
      await fsp.writeFile(path.join(LAYERS_DIR, '.order'), (body.order || []).join('\n'), 'utf8');
      jsonRes(res, { ok: true }); return;
    }

    // ── Upload files ─────────────────────────────────────────────
    // Query params:
    //   folder      = destination subfolder inside layers/ (default: root)
    //   collection  = 1  → strip first path segment (collection-of-folders mode)
    if (req.method === 'POST' && p === '/api/layers/upload') {
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;,]+))/);
      if (!bm) { errRes(res, 'Missing multipart boundary'); return; }
      const boundary    = bm[1] || bm[2];
      const rawBuf      = await readBody(req);
      const parts       = parseMultipart(rawBuf, boundary);
      const isCollection = u.searchParams.get('collection') === '1';
      const folderParam  = u.searchParams.get('folder') || '';
      const targetRoot   = safePath(LAYERS_DIR, folderParam);
      await fsp.mkdir(targetRoot, { recursive: true });

      let count = 0;
      for (const part of parts) {
        // Use fieldName as relative path when it's not the generic 'files' key.
        // Client sends webkitRelativePath as fieldName for folder uploads.
        let relPath = (part.fieldName && part.fieldName !== 'files')
          ? part.fieldName.replace(/\\/g, '/')
          : part.fileName;

        // Collection mode: strip the top-most folder segment
        // e.g. "MyCollection/Background/blue.png" → "Background/blue.png"
        if (isCollection) {
          const idx = relPath.indexOf('/');
          if (idx > 0) relPath = relPath.slice(idx + 1);
        }

        const segs     = relPath.split('/');
        const fileName = segs.pop();
        if (!fileName || !/\.(png|jpg|jpeg|gif|webp)$/i.test(fileName)) continue;

        let destDir = targetRoot;
        if (segs.length > 0) {
          destDir = path.join(targetRoot, segs.join(path.sep));
          await fsp.mkdir(destDir, { recursive: true });
        }

        await fsp.writeFile(path.join(destDir, fileName), part.data);
        count++;
      }

      console.log(`[upload] ${count} file(s) → ${targetRoot}${isCollection ? ' (collection mode)' : ''}`);
      jsonRes(res, { ok: true, count }); return;
    }

    // ── Serve layer image ───────────────────────────────────────
    if (req.method === 'GET' && p === '/api/layer-image') {
      const rel  = u.searchParams.get('path');
      const full = safePath(LAYERS_DIR, rel);
      const data = await fsp.readFile(full);
      const ext  = path.extname(full).toLowerCase();
      const mime = imageContentTypeFromExt(ext);
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=60' });
      res.end(data); return;
    }

    // ── Manual Maker exports ───────────────────────────────────
    if (req.method === 'POST' && p === '/api/manual-maker/save') {
      const body = await readJSON(req);
      const kind = String(body.kind || 'manual').toLowerCase();
      if (kind === 'meme') {
        const result = await manualMakerOps.saveManualMakerMeme({
          manualMakerDir: MANUAL_MAKER_DIR,
          imageDataUrl: body.imageDataUrl || body.imageData,
        });
        jsonRes(res, result); return;
      }
      const result = await manualMakerOps.saveManualMakerOutput({
        manualMakerDir: MANUAL_MAKER_DIR,
        imageDataUrl: body.imageDataUrl || body.imageData,
        metadata: body.metadata || {},
      });
      jsonRes(res, result); return;
    }

    // ── Edit Trait isolated saves ──────────────────────────────
    if (req.method === 'POST' && p === '/api/edit-trait/save-config') {
      const body = await readJSON(req);
      const result = await editTraitOps.saveEditTraitConfig({
        editTraitDir: EDIT_TRAIT_DIR,
        setup: body.setup || body,
        scope: body.scope || 'selected',
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/edit-trait/save-preview') {
      const body = await readJSON(req);
      const result = await editTraitOps.saveEditTraitPreview({
        editTraitDir: EDIT_TRAIT_DIR,
        imageDataUrl: body.imageDataUrl || body.imageData,
      });
      jsonRes(res, result); return;
    }

    // ── AI Chef: create AI-infused trait variants ───────────────
    if (req.method === 'POST' && p === '/api/ai-chef/traits') {
      const body = await readJSON(req);
      const prompt = String(body.prompt || '').trim();
      const items = Array.isArray(body.items) ? body.items : [];
      if (!prompt) { errRes(res, 'Prompt required', 400); return; }
      if (!items.length) { errRes(res, 'At least one trait is required', 400); return; }

      aiChefStopRequested = false;
      resetAiChefCancellation();
      const results = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (aiChefStopRequested) {
          results.push({ ok: false, cancelled: true, skipped: true, source: item.path || '', error: 'Skipped after Stop Generation' });
          continue;
        }
        let targetFull = '';
        try {
          const rel = String(item.path || '');
          if (!rel) throw new Error('Trait path required');
          const sourceFull = safePath(LAYERS_DIR, rel);
          const stat = await fsp.stat(sourceFull);
          if (!stat.isFile()) throw new Error('Trait source is not a file');
          const ext = path.extname(sourceFull).toLowerCase() || '.png';
          const sourceName = cleanAssetName(path.basename(sourceFull));
          const targetDir = path.dirname(sourceFull);
          const target = await uniqueFilePath(targetDir, `${sourceName} AI infused`, ext);
          targetFull = target.full;
          const generated = await generateImageFromImage({
            inputImagePath: sourceFull,
            prompt,
            mode: 'trait',
            outputPath: target.full,
            metadata: { sourcePath: rel, layer: item.layer || path.dirname(rel) },
            options: body.options || {},
          });
          results.push({
            ok: true,
            source: rel,
            path: path.relative(LAYERS_DIR, target.full).replace(/\\/g, '/'),
            name: target.fileName,
            provider: generated.provider,
            fallbackReason: generated.metadata?.aiChef?.fallbackReason || '',
          });
        } catch (e) {
          if (targetFull && (aiChefStopRequested || /cancel|stop/i.test(e.message))) {
            await fsp.rm(targetFull, { force: true }).catch(() => {});
          }
          results.push({ ok: false, source: item.path || '', cancelled: aiChefStopRequested || /cancel|stop/i.test(e.message), error: e.message });
        }
        if (aiChefStopRequested) {
          for (let j = index + 1; j < items.length; j++) {
            results.push({ ok: false, cancelled: true, skipped: true, source: items[j].path || '', error: 'Skipped after Stop Generation' });
          }
          break;
        }
      }
      jsonRes(res, { ok: true, results }); return;
    }

    // ── AI Chef: create AI-infused full generated pieces ────────
    if (req.method === 'POST' && p === '/api/ai-chef/pieces') {
      const body = await readJSON(req);
      const prompt = String(body.prompt || '').trim();
      const items = Array.isArray(body.items) ? body.items : [];
      if (!prompt) { errRes(res, 'Prompt required', 400); return; }
      if (!items.length) { errRes(res, 'At least one edition is required', 400); return; }
      await ensureBuildDirs();

      aiChefStopRequested = false;
      resetAiChefCancellation();
      const results = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (aiChefStopRequested) {
          results.push({ ok: false, cancelled: true, skipped: true, sourceEdition: item.edition, error: 'Skipped after Stop Generation' });
          continue;
        }
        try {
          const sourceEdition = parseInt(item.edition, 10);
          if (!Number.isFinite(sourceEdition)) throw new Error('Edition number required');
          const sourceImage = await findBuildImageByEdition(sourceEdition);
          const sourceJson = path.join(BUILD_DIR, 'json', sourceEdition + '.json');
          const { meta } = await readMetaFile(sourceJson);

          const outputExt = sourceImage.ext === '.jpg' || sourceImage.ext === '.jpeg' ? '.jpg' : '.png';
          const tmpDir = path.join(BUILD_DIR, 'tmp');
          await fsp.mkdir(tmpDir, { recursive: true });
          const tmpFull = path.join(tmpDir, `ai-chef-piece-${Date.now()}-${Math.random().toString(36).slice(2)}${outputExt}`);
          let generated;
          try {
            generated = await generateImageFromImage({
              inputImagePath: sourceImage.full,
              prompt,
              mode: 'piece',
              outputPath: tmpFull,
              metadata: { sourceEdition, sourceImage: sourceImage.name },
              options: body.options || {},
            });
          } catch (e) {
            await fsp.rm(tmpFull, { force: true }).catch(() => {});
            throw e;
          }

          const attrs = Array.isArray(meta.attributes) ? [...meta.attributes] : [];
          attrs.push({ trait_type: 'AI', value: 'AI infused' });
          const newMeta = {
            ...meta,
            name: meta.name ? `${meta.name} AI infused` : 'AI infused',
            image: meta.image || '',
            ai_source_edition: sourceEdition,
            ai_prompt: prompt,
            attributes: attrs,
          };
          const saved = await writeNewOutputPiece({
            imageSourcePath: tmpFull,
            outputExt,
            metadata: newMeta,
          }).finally(() => fsp.rm(tmpFull, { force: true }).catch(() => {}));
          results.push({
            ok: true,
            sourceEdition,
            edition: saved.edition,
            image: 'images/' + saved.imageName,
            json: 'json/' + saved.jsonName,
            imageName: saved.imageName,
            jsonName: saved.jsonName,
            previousHighest: saved.previousHighest,
            provider: generated.provider,
            fallbackReason: generated.metadata?.aiChef?.fallbackReason || '',
          });
        } catch (e) {
          results.push({ ok: false, sourceEdition: item.edition, cancelled: aiChefStopRequested || /cancel|stop/i.test(e.message), error: e.message });
        }
        if (aiChefStopRequested) {
          for (let j = index + 1; j < items.length; j++) {
            results.push({ ok: false, cancelled: true, skipped: true, sourceEdition: items[j].edition, error: 'Skipped after Stop Generation' });
          }
          break;
        }
      }
      jsonRes(res, { ok: true, results }); return;
    }

    // ── Write config.js ─────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/config') {
      const body = await readJSON(req);
      await fsp.mkdir(path.dirname(CONFIG_DST), { recursive: true });
      await fsp.writeFile(CONFIG_DST, body.content, 'utf8');
      jsonRes(res, { ok: true, path: CONFIG_DST }); return;
    }

    // ── Run engine ──────────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/generate') {
      if (genProcess) { errRes(res, 'Already running', 409); return; }
      jsonRes(res, { ok: true });
      broadcast({ type: 'start', message: '▶ Starting generation...' });
      genProcess = spawn('node', ['index.js'], { cwd: ENGINE_DIR });
      genProcess.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => broadcast({ type: 'stdout', message: l })));
      genProcess.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => broadcast({ type: 'stderr', message: l })));
      genProcess.on('close', code => {
        genProcess = null;
        broadcast({ type: code === 0 ? 'done' : 'error', message: code === 0 ? '✔ Generation complete!' : '✘ Exited with code ' + code });
      });
      genProcess.on('error', e => { genProcess = null; broadcast({ type: 'error', message: '✘ ' + e.message }); });
      return;
    }

    // ── Stop engine ─────────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/generate/stop') {
      if (genProcess) { genProcess.kill(); genProcess = null; broadcast({ type: 'error', message: '⏹ Stopped by user.' }); }
      jsonRes(res, { ok: true }); return;
    }

    // ── Generation status ───────────────────────────────────────
    if (req.method === 'GET' && p === '/api/generate/status') {
      jsonRes(res, { running: genProcess !== null }); return;
    }

    // ── Reindex remaining generated output files ────────────────
    if (req.method === 'POST' && p === '/api/output/reindex') {
      const result = await reindexOutputFilesPairSafe({
        buildDir: BUILD_DIR,
        startIndex: await readConfiguredStartEdition(),
      });
      jsonRes(res, result, result.ok === false ? 409 : 200); return;
    }

    // ── Randomize generated output order pair-safely ───────────
    if (req.method === 'POST' && p === '/api/output/randomize-order') {
      const result = await shuffleOutputFilesPairSafe({
        buildDir: BUILD_DIR,
        startIndex: await readConfiguredStartEdition(),
      });
      jsonRes(res, result, result.ok === false ? 409 : 200); return;
    }

    // ── List build images ───────────────────────────────────────
    if (req.method === 'GET' && p === '/api/build') {
      jsonRes(res, { images: await listBuild() }); return;
    }

    // ── Save one generated edition ──────────────────────────────
    if (req.method === 'POST' && p === '/api/build/save') {
      const body = await readJSON(req);
      await ensureBuildDirs();
      const parsed = parseDataUrl(body.imageData);
      const meta = body.metadata || {};
      const outputExt = /jpe?g/i.test(parsed.mime) ? '.jpg' : '.png';
      const saved = await writeNewOutputPiece({
        imageData: parsed.data,
        outputExt,
        metadata: meta,
      });
      jsonRes(res, {
        ok: true,
        edition: saved.edition,
        image: 'images/' + saved.imageName,
        json: 'json/' + saved.jsonName,
        imageName: saved.imageName,
        jsonName: saved.jsonName,
        previousHighest: saved.previousHighest,
      }); return;
    }

    // ── Delete generated edition ────────────────────────────────
    if (req.method === 'DELETE' && p === '/api/build/edition') {
      const body = await readJSON(req);
      const edition = parseInt(body.edition, 10);
      if (!Number.isFinite(edition)) { errRes(res, 'edition required', 400); return; }
      const logs = [{ level: 'info', message: `Delete output #${edition} started` }];
      const pairState = await readOutputPairsForAction(logs);
      if (pairState.errors.length) {
        jsonRes(res, outputOpFailure('Cannot delete safely because output pairing is ambiguous. Operation aborted.', logs, pairState.warnings, pairState.errors), 409);
        return;
      }
      const pair = pairState.pairs.find(p => p.image.numeric === edition);
      if (!pair) {
        const message = `Output image #${edition} was not found`;
        jsonRes(res, outputOpFailure(message, logs, pairState.warnings, pairState.errors), 404);
        return;
      }
      const deleted = await deleteOutputPairFiles(pair, pairState.inventory, logs);
      const warnings = [...pairState.warnings, ...deleted.warnings];
      const errors = [...pairState.errors, ...deleted.errors];
      logs.push({
        level: errors.length ? 'warning' : 'success',
        message: `Delete output #${edition} complete: ${deleted.deletedImages} image(s), ${deleted.deletedJson} metadata file(s) deleted`,
      });
      jsonRes(res, {
        ok: errors.length === 0,
        deletedImages: deleted.deletedImages,
        deletedJson: deleted.deletedJson,
        warnings,
        errors,
        logs,
      }, errors.length ? 500 : 200); return;
    }

    // ── Delete all generated output images and metadata ─────────
    if (req.method === 'DELETE' && p === '/api/build/all') {
      await ensureBuildDirs();
      const imageDir = path.join(BUILD_DIR, 'images');
      const jsonDir = path.join(BUILD_DIR, 'json');
      const imageFiles = (await fsp.readdir(imageDir).catch(() => []))
        .filter(f => OUTPUT_IMAGE_RE.test(f));
      const jsonFiles = (await fsp.readdir(jsonDir).catch(() => []))
        .filter(f => /\.json$/i.test(f));
      await Promise.all([
        ...imageFiles.map(f => fsp.rm(path.join(imageDir, f), { force: true })),
        ...jsonFiles.map(f => fsp.rm(path.join(jsonDir, f), { force: true })),
      ]);
      jsonRes(res, { ok: true, deletedImages: imageFiles.length, deletedJson: jsonFiles.length }); return;
    }

    // ── Delete only original/non-AI generated output ────────────
    if (req.method === 'DELETE' && p === '/api/build/originals') {
      const logs = [{ level: 'info', message: 'Delete Originals started' }];
      const pairState = await readOutputPairsForAction(logs);
      logs.push({
        level: 'info',
        message: `Scanning generated outputs: ${pairState.inventory.imageParts.length} image(s), ${pairState.inventory.jsonParts.length} metadata file(s)`,
      });
      if (pairState.errors.length) {
        jsonRes(res, outputOpFailure('Cannot delete originals safely because output pairing is ambiguous. Operation aborted.', logs, pairState.warnings, pairState.errors), 409);
        return;
      }

      const originalPairs = [];
      let keptAiImages = 0;
      for (const pair of pairState.pairs) {
        let isAi = false;
        if (pair.json) {
          try {
            const meta = JSON.parse(await fsp.readFile(path.join(pairState.inventory.jsonDir, pair.json.fileName), 'utf8'));
            isAi = isAiInfusedMetadata(meta);
          } catch (e) {
            logs.push({ level: 'warning', message: `Could not parse metadata ${pair.json.fileName}; treating ${pair.image.fileName} as original` });
          }
        } else {
          logs.push({ level: 'warning', message: `${pair.image.fileName} has no metadata; treating as original` });
        }
        if (isAi) keptAiImages++;
        else originalPairs.push(pair);
      }

      logs.push({ level: 'info', message: `Found ${originalPairs.length} original output pair(s)` });
      let deletedImages = 0;
      let deletedJson = 0;
      const warnings = [...pairState.warnings];
      const errors = [...pairState.errors];
      for (const pair of originalPairs) {
        const deleted = await deleteOutputPairFiles(pair, pairState.inventory, logs);
        deletedImages += deleted.deletedImages;
        deletedJson += deleted.deletedJson;
        warnings.push(...deleted.warnings);
        errors.push(...deleted.errors);
      }
      logs.push({
        level: errors.length ? 'warning' : 'success',
        message: `Delete Originals complete: ${deletedImages} image(s), ${deletedJson} metadata file(s) deleted`,
      });
      jsonRes(res, {
        ok: errors.length === 0,
        deletedImages,
        deletedJson,
        keptAiImages,
        warnings,
        errors,
        logs,
      }, errors.length ? 500 : 200); return;
    }

    // ── Replace generated image and/or metadata ─────────────────
    if (req.method === 'POST' && p === '/api/build/replace') {
      const body = await readJSON(req);
      const edition = parseInt(body.edition, 10);
      if (!Number.isFinite(edition)) { errRes(res, 'edition required', 400); return; }
      await ensureBuildDirs();
      if (body.imageData) {
        const parsed = parseDataUrl(body.imageData);
        const outputJPEG = /jpe?g/i.test(parsed.mime);
        const imageName = editionFileName(edition, outputJPEG);
        const imageDir = path.join(BUILD_DIR, 'images');
        const files = await fsp.readdir(imageDir).catch(() => []);
        await Promise.all(files
          .filter(f => parseInt(f, 10) === edition)
          .map(f => fsp.rm(path.join(imageDir, f), { force: true })));
        await fsp.writeFile(path.join(imageDir, imageName), parsed.data);
      }
      if (body.metadata) {
        const meta = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
        await fsp.writeFile(path.join(BUILD_DIR, 'json', edition + '.json'), JSON.stringify(meta, null, 2), 'utf8');
      }
      jsonRes(res, { ok: true }); return;
    }

    // ── Bulk edit generated metadata ────────────────────────────
    if (req.method === 'GET' && p === '/api/build/metadata-schema-count') {
      jsonRes(res, await generalMetadataOps.countGeneralMetadataTargets({ buildDir: BUILD_DIR, phase2Dir: PHASE2_DIR })); return;
    }

    if (req.method === 'POST' && p === '/api/build/bulk-edit') {
      const body = await readJSON(req);
      await ensureBuildDirs();
      let customFields = {};
      if (body.customFields) customFields = typeof body.customFields === 'string' ? JSON.parse(body.customFields) : body.customFields;
      if (body.generalMetadata) {
        const result = await generalMetadataOps.restructureGeneralMetadataTargets({
          buildDir: BUILD_DIR,
          phase2Dir: PHASE2_DIR,
          settings: {
            namePrefix: body.namePrefix,
            description: body.description,
            externalUrl: body.externalUrl,
            imageBaseUri: body.imageBaseUri || body.baseUri,
            fallbackExt: body.fallbackExt,
          },
        });
        jsonRes(res, result, result.ok ? 200 : 207); return;
      }

      const jsonDir = path.join(BUILD_DIR, 'json');
      const files = (await fsp.readdir(jsonDir).catch(() => [])).filter(f => /\.json$/i.test(f));
      let updated = 0;
      for (const f of files) {
        const edition = parseInt(f, 10);
        if (!Number.isFinite(edition)) continue;
        const full = path.join(jsonDir, f);
        const meta = JSON.parse(await fsp.readFile(full, 'utf8'));
        if (body.namePrefix !== undefined) meta.name = `${body.namePrefix} #${edition}`;
        if (body.description !== undefined) meta.description = body.description;
        if (body.baseUri !== undefined) {
          meta.image = `${String(body.baseUri).replace(/\/$/, '')}/${edition}.png`;
        }
        Object.assign(meta, customFields);
        await fsp.writeFile(full, JSON.stringify(meta, null, 2), 'utf8');
        updated++;
      }
      jsonRes(res, { ok: true, updated }); return;
    }

    // ── Serve build image ───────────────────────────────────────
    if (req.method === 'GET' && p === '/api/build/image') {
      const rel  = u.searchParams.get('path');
      const full = safePath(BUILD_DIR, rel);
      const data = await fsp.readFile(full);
      const ext  = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': imageContentTypeFromExt(ext),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(data); return;
    }

    // ── Serve build image by edition, regardless of extension ───
    if (req.method === 'GET' && p === '/api/build/edition-image') {
      const edition = parseInt(u.searchParams.get('edition'), 10);
      if (!Number.isFinite(edition)) { errRes(res, 'edition required', 400); return; }
      const imageDir = path.join(BUILD_DIR, 'images');
      const files = await fsp.readdir(imageDir).catch(() => []);
      const match = files.find(f => {
        const part = parseOutputFileName(f, OUTPUT_IMAGE_EXTS);
        return part && part.numeric === edition;
      });
      if (!match) { errRes(res, 'Image not found', 404); return; }
      const full = path.join(imageDir, match);
      const data = await fsp.readFile(full);
      const ext = path.extname(match).toLowerCase();
      res.writeHead(200, {
        'Content-Type': imageContentTypeFromExt(ext),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(data); return;
    }

    // ── Serve build metadata JSON ───────────────────────────────
    if (req.method === 'GET' && p === '/api/build/meta') {
      const n    = u.searchParams.get('n');
      const full = path.join(BUILD_DIR, 'json', n + '.json');
      const base = path.join(BUILD_DIR, 'json');
      if (!full.startsWith(base)) { errRes(res, 'Blocked', 403); return; }
      const data = await fsp.readFile(full, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(data); return;
    }

    // ── Serve all build metadata JSON (bulk — for rarity analysis) ──
    if (req.method === 'GET' && p === '/api/build/all-meta') {
      const jsonDir = path.join(BUILD_DIR, 'json');
      if (!fs.existsSync(jsonDir)) { jsonRes(res, { metas: [] }); return; }
      const files = (await fsp.readdir(jsonDir)).filter(f => parseOutputFileName(f, ['.json']));
      const results = await Promise.all(files.map(async f => {
        const part = parseOutputFileName(f, ['.json']);
        const num = part?.numeric;
        if (!Number.isFinite(num)) return null;
        try {
          const { meta, attrs } = await readMetaFile(path.join(jsonDir, f));
          return { edition: num, attributes: attrs, meta };
        } catch { return null; }
      }));
      jsonRes(res, { metas: results.filter(Boolean).sort((a,b) => a.edition - b.edition) }); return;
    }

    // ── Phase 2 isolated postproduction workspace ───────────────
    if (req.method === 'GET' && p === '/api/phase2') {
      const collection = await phase2Ops.listPhase2Collection({ phase2Dir: PHASE2_DIR });
      const hasWorkingCopy = await phase2Ops.hasPhase2WorkingCopy({ phase2Dir: PHASE2_DIR });
      jsonRes(res, {
        ...collection,
        hasWorkingCopy,
        folder: 'buildphase2',
      }); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/sync') {
      const result = await phase2Ops.syncFromOutput({ buildDir: BUILD_DIR, phase2Dir: PHASE2_DIR });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/refresh-from-main') {
      const result = await phase2Ops.refreshFromCurrentMain({ buildDir: BUILD_DIR, phase2Dir: PHASE2_DIR });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/reindex') {
      const result = await phase2Ops.reindexPhase2Files({ phase2Dir: PHASE2_DIR, startIndex: 1 });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/shuffle') {
      const result = await phase2Ops.shufflePhase2Files({ phase2Dir: PHASE2_DIR, startIndex: 1 });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/manual-reorder') {
      const body = await readJSON(req);
      const result = await phase2Ops.manualReorderPhase2({
        phase2Dir: PHASE2_DIR,
        draggedEdition: body.draggedEdition,
        beforeEdition: body.beforeEdition,
        targetPosition: body.targetPosition,
        startIndex: 1,
      });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/delete-marked') {
      const body = await readJSON(req);
      const result = await phase2Ops.deletePhase2Editions({ phase2Dir: PHASE2_DIR, editions: body.editions || [] });
      jsonRes(res, result); return;
    }

    if (req.method === 'DELETE' && p === '/api/phase2/all') {
      const result = await phase2Ops.deleteAllPhase2Output({ phase2Dir: PHASE2_DIR });
      jsonRes(res, result); return;
    }

    if (req.method === 'GET' && p === '/api/phase2/all-meta') {
      const result = await phase2Ops.readPhase2Metadata({ phase2Dir: PHASE2_DIR });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/batch-traits/add') {
      const body = await readJSON(req);
      const result = await phase2Ops.batchAddTraitToPhase2Json({
        phase2Dir: PHASE2_DIR,
        editions: body.editions || [],
        trait: body.trait || {},
      });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/batch-traits/delete') {
      const body = await readJSON(req);
      const result = await phase2Ops.batchDeleteTraitFromPhase2Json({
        phase2Dir: PHASE2_DIR,
        editions: body.editions || [],
        trait: body.trait || {},
      });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/piece-trait/update') {
      const body = await readJSON(req);
      const result = await phase2Ops.updatePhase2PieceTrait({
        phase2Dir: PHASE2_DIR,
        edition: body.edition,
        attrIndex: body.attrIndex,
        trait: body.trait || {},
      });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/piece-trait/delete') {
      const body = await readJSON(req);
      const result = await phase2Ops.deletePhase2PieceTrait({
        phase2Dir: PHASE2_DIR,
        edition: body.edition,
        attrIndex: body.attrIndex,
      });
      jsonRes(res, result, result.ok ? 200 : 207); return;
    }

    if (req.method === 'GET' && p === '/api/phase2/image') {
      const rel = u.searchParams.get('path');
      const full = safePath(PHASE2_DIR, rel);
      const data = await fsp.readFile(full);
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': imageContentTypeFromExt(ext),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(data); return;
    }

    if (req.method === 'GET' && p === '/api/phase2/trait-asset') {
      const rel = String(u.searchParams.get('path') || '').replace(/^buildphase2[\\/]/, '');
      const full = safePath(PHASE2_DIR, rel);
      const data = await fsp.readFile(full);
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': imageContentTypeFromExt(ext),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(data); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/trait-assets/upload') {
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;,]+))/);
      if (!bm) { errRes(res, 'Missing multipart boundary', 400); return; }
      const parts = parseMultipart(await readBody(req), bm[1] || bm[2]);
      const file = parts.find(part => /\.(png|jpg|jpeg|gif|webp)$/i.test(part.fileName || ''));
      if (!file) { errRes(res, 'No supported trait image uploaded', 400); return; }
      const saved = await phase2Ops.saveTraitAssetBuffer({
        phase2Dir: PHASE2_DIR,
        folder: 'traits/source',
        fileName: cleanAssetName(file.fileName),
        data: file.data,
        ext: path.extname(file.fileName).toLowerCase() || '.png',
      });
      jsonRes(res, { ok: true, ...saved }); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/trait-assets/save-data-url') {
      const body = await readJSON(req);
      const saved = await phase2Ops.saveTraitAssetDataUrl({
        phase2Dir: PHASE2_DIR,
        folder: body.folder || 'traits/edited',
        fileName: body.fileName || 'phase2-trait',
        dataUrl: body.dataUrl,
      });
      jsonRes(res, { ok: true, ...saved }); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/save-composited-image') {
      const body = await readJSON(req);
      const saved = await phase2Ops.savePhase2CompositedImage({
        phase2Dir: PHASE2_DIR,
        edition: body.edition,
        dataUrl: body.dataUrl,
      });
      jsonRes(res, { ok: true, ...saved }); return;
    }

    if (req.method === 'GET' && p === '/api/phase2/extra-traits') {
      const result = await phase2Ops.readExtraTraits({ phase2Dir: PHASE2_DIR });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/extra-traits') {
      const body = await readJSON(req);
      const result = await phase2Ops.writeExtraTraits({ phase2Dir: PHASE2_DIR, extraTraits: body.extraTraits || [] });
      jsonRes(res, { ok: true, ...result }); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/delete-extra-trait') {
      const body = await readJSON(req);
      const result = await phase2Ops.deleteExtraTraitFromLibrary({
        phase2Dir: PHASE2_DIR,
        traitId: body.traitId,
        removeFromJson: !!body.removeFromJson,
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/apply-extra-traits') {
      const body = await readJSON(req);
      const result = await phase2Ops.applyExtraTraits({
        phase2Dir: PHASE2_DIR,
        editions: body.editions || [],
        traitIds: body.traitIds || null,
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/remove-extra-traits') {
      const body = await readJSON(req);
      const result = await phase2Ops.removeExtraTraitsFromEditions({
        phase2Dir: PHASE2_DIR,
        editions: body.editions || [],
        traitIds: body.traitIds || null,
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'GET' && p === '/api/phase2/rarity') {
      const result = await phase2Ops.analyzePhase2Rarity({ phase2Dir: PHASE2_DIR });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/target-preview') {
      const body = await readJSON(req);
      const result = await phase2Ops.previewTraitTarget({
        phase2Dir: PHASE2_DIR,
        trait: body.trait,
        mode: body.mode,
        targetValue: body.targetValue,
        targetTraitType: body.targetTraitType,
        targetTraitValue: body.targetTraitValue,
        selectedEditions: body.selectedEditions || [],
        avoidDuplicates: body.avoidDuplicates !== false,
        seed: body.seed || '',
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/target-apply') {
      const body = await readJSON(req);
      const result = await phase2Ops.applyTargetedTrait({
        phase2Dir: PHASE2_DIR,
        trait: body.trait,
        mode: body.mode,
        targetValue: body.targetValue,
        targetTraitType: body.targetTraitType,
        targetTraitValue: body.targetTraitValue,
        selectedEditions: body.selectedEditions || [],
        avoidDuplicates: body.avoidDuplicates !== false,
        seed: body.seed || '',
      });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/ai-trait-suggestions') {
      const body = await readJSON(req);
      const result = phase2Ops.generateTraitSuggestions({ prompt: body.prompt || '', count: body.count || 8 });
      jsonRes(res, result); return;
    }

    if (req.method === 'POST' && p === '/api/phase2/ai-chef/image') {
      const body = await readJSON(req);
      const prompt = String(body.prompt || '').trim();
      if (!prompt) { errRes(res, 'Prompt required', 400); return; }
      await phase2Ops.ensurePhase2Dirs(PHASE2_DIR);
      const inputSaved = body.inputDataUrl
        ? await phase2Ops.saveTraitAssetDataUrl({
            phase2Dir: PHASE2_DIR,
            folder: 'traits/previews',
            fileName: body.inputName || 'phase2-ai-input',
            dataUrl: body.inputDataUrl,
          })
        : null;
      const inputRel = inputSaved?.path || String(body.inputPath || '').replace(/^buildphase2[\\/]/, '');
      if (!inputRel) { errRes(res, 'Phase 2 AI Chef input required', 400); return; }
      const inputFull = safePath(PHASE2_DIR, inputRel);
      const target = await phase2Ops.saveTraitAssetDataUrl({
        phase2Dir: PHASE2_DIR,
        folder: 'traits/generated',
        fileName: body.outputName || 'phase2-ai-output',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }).catch(async () => null);
      let outputFull;
      let outputRel;
      if (target) {
        outputRel = target.path;
        outputFull = safePath(PHASE2_DIR, outputRel);
        await fsp.rm(outputFull, { force: true }).catch(() => {});
      } else {
        const placeholder = await phase2Ops.saveTraitAssetBuffer({
          phase2Dir: PHASE2_DIR,
          folder: 'traits/generated',
          fileName: body.outputName || 'phase2-ai-output',
          data: Buffer.from(''),
          ext: '.png',
        });
        outputRel = placeholder.path;
        outputFull = safePath(PHASE2_DIR, outputRel);
        await fsp.rm(outputFull, { force: true }).catch(() => {});
      }
      const generated = await generateImageFromImage({
        inputImagePath: inputFull,
        prompt,
        mode: 'phase2-trait',
        outputPath: outputFull,
        metadata: { phase2: true, input: inputRel },
        options: body.options || {},
      });
      jsonRes(res, {
        ok: true,
        path: outputRel,
        provider: generated.provider,
        fallbackReason: generated.metadata?.aiChef?.fallbackReason || '',
      }); return;
    }

    res.writeHead(404); res.end('Not found');

  } catch (e) {
    console.error('[' + req.method + ' ' + p + ']', e.message);
    try { errRes(res, e.message); } catch {}
  }
});

initializeDefaultLayers().then(() => server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log(  '  ║      Miya pfp engine — Web Server       ║');
  console.log(  '  ╠══════════════════════════════════════════╣');
  console.log( '  ║  Open:  http://localhost:' + PORT + '             ║');
  console.log( '  ║  Root:  ' + ENGINE_DIR.slice(0, 32).padEnd(32) + '  ║');
  console.log(  '  ╚══════════════════════════════════════════╝\n');
})).catch(error => {
  console.error('[layers] Could not initialize the workspace:', error.message);
  process.exitCode = 1;
});

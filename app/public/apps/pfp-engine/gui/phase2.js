'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const outputFileOps = require('./outputReindex');

const SUPPORTED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const EXTRA_TRAITS_FILE = 'extra_traits.json';
const MAIN_PHASE2_MAP_FILE = 'main_phase2_map.json';
const PHASE2_TRAIT_FOLDERS = ['traits/source', 'traits/edited', 'traits/generated', 'traits/previews'];
const STABLE_ID_FIELDS = ['original_id', 'source_id', 'uuid', 'dna', 'hash', 'asset_hash', 'image_hash', 'edition_uuid'];

function log(logs, level, message) {
  logs.push({ level, message });
}

function imageContentTypeFromExt(ext) {
  return ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Blocked unsafe Phase 2 operation: target path is outside buildphase2.');
  }
  return target;
}

function safePhase2Path(phase2Dir, ...parts) {
  return assertInside(phase2Dir, path.join(phase2Dir, ...parts));
}

function assertInsidePhase2Json(jsonDir, targetPath) {
  const base = path.resolve(jsonDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Blocked unsafe Phase 2 Batch Trait operation: target path is outside buildphase2/json.');
  }
  return target;
}

function phase2FileOpLogs(operationName, result) {
  const rewrite = message => String(message || '')
    .replace(/Reindex Output/g, 'Reindex Phase 2')
    .replace(/Shuffle Output Order/g, 'Shuffle Phase 2')
    .replace(/^Reindex mapping:/, 'Reindex Phase 2 mapping:')
    .replace(/^Shuffle mapping:/, 'Shuffle Phase 2 mapping:')
    .replace(/output folders/g, 'Phase 2 folders')
    .replace(/numeric output pairs/g, 'numeric Phase 2 pairs')
    .replace(/complete numeric output pair/g, 'complete numeric Phase 2 pair')
    .replace(/non-output/g, 'non-Phase 2');
  const logs = [
    { level: 'info', message: `${operationName} started.` },
    ...(result.logs || []).map(row => ({
      level: row.level || 'info',
      message: rewrite(row.message || row),
    })),
  ];
  logs.push({
    level: result.ok ? 'success' : 'error',
    message: result.ok
      ? `${operationName} complete: ${result.pairsProcessed || 0} pair(s) processed.`
      : `${operationName} failed: ${result.error || 'Unknown error'}`,
  });
  return logs;
}

function parseNumericFile(fileName, allowedExts) {
  const ext = path.extname(fileName).toLowerCase();
  if (!allowedExts.includes(ext)) return null;
  const stem = path.basename(fileName, path.extname(fileName));
  if (!/^\d+$/.test(stem)) return null;
  const index = Number(stem);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { index, stem, fileName, ext };
}

async function ensurePhase2Dirs(phase2Dir) {
  await fsp.mkdir(safePhase2Path(phase2Dir, 'images'), { recursive: true });
  await fsp.mkdir(safePhase2Path(phase2Dir, 'json'), { recursive: true });
  for (const folder of PHASE2_TRAIT_FOLDERS) {
    await fsp.mkdir(safePhase2Path(phase2Dir, ...folder.split('/')), { recursive: true });
  }
}

async function fileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stableIdFromMetadata(meta) {
  for (const field of STABLE_ID_FIELDS) {
    const value = meta && meta[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return `${field}:${String(value).trim()}`;
    }
  }
  return '';
}

async function stableIdForPair(pair, meta = null) {
  return stableIdFromMetadata(meta) || `image_sha256:${await fileHash(pair.imagePath)}`;
}

async function readPhase2Map({ phase2Dir }) {
  const mapPath = safePhase2Path(phase2Dir, MAIN_PHASE2_MAP_FILE);
  try {
    const raw = await fsp.readFile(mapPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updatedAt: parsed.updatedAt || '',
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, items: [], updatedAt: '' };
    return { version: 1, items: [], updatedAt: '', warning: `Could not parse ${MAIN_PHASE2_MAP_FILE}: ${e.message}` };
  }
}

async function writePhase2Map({ phase2Dir, map }) {
  await fsp.mkdir(phase2Dir, { recursive: true });
  const mapPath = safePhase2Path(phase2Dir, MAIN_PHASE2_MAP_FILE);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: Array.isArray(map.items) ? map.items : [],
  };
  const tmp = safePhase2Path(phase2Dir, `.${MAIN_PHASE2_MAP_FILE}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fsp.rename(tmp, mapPath);
  return payload;
}

function mapByStableId(map) {
  return new Map((map.items || []).filter(item => item && item.stableId).map(item => [String(item.stableId), item]));
}

function mapByPhase2Edition(map) {
  const byEdition = new Map();
  for (const item of map.items || []) {
    const edition = Number(item.phase2Edition);
    if (Number.isSafeInteger(edition) && item.stableId) byEdition.set(edition, item);
  }
  return byEdition;
}

function mapByMainEdition(map) {
  const byEdition = new Map();
  for (const item of map.items || []) {
    const edition = Number(item.mainEdition);
    if (Number.isSafeInteger(edition) && item.stableId) byEdition.set(edition, item);
  }
  return byEdition;
}

function attrIdentity(attr) {
  return `${String(attr?.trait_type || '')}\u0000${String(attr?.value ?? '')}`;
}

function getAttributes(meta) {
  return Array.isArray(meta?.attributes) ? meta.attributes : [];
}

function mergeAttributesPreservingPhase2(mainAttributes, phase2Attributes) {
  const main = Array.isArray(mainAttributes) ? mainAttributes : [];
  const seen = new Set(main.map(attrIdentity));
  const extras = [];
  for (const attr of Array.isArray(phase2Attributes) ? phase2Attributes : []) {
    const key = attrIdentity(attr);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(attr);
  }
  return { attributes: [...main, ...extras], extrasPreserved: extras.length };
}

function replaceImageFileName(imageValue, fileName) {
  const current = String(imageValue || '');
  if (!current) return fileName;
  if (/[^/\\?#]+\.(png|jpg|jpeg|webp|gif)(?=([?#].*)?$)/i.test(current)) {
    return current.replace(/[^/\\?#]+\.(png|jpg|jpeg|webp|gif)(?=([?#].*)?$)/i, fileName);
  }
  return current.endsWith('/') ? current + fileName : current + '/' + fileName;
}

function buildPhase2JsonFromMain({ mainMeta, phase2Meta, imageName }) {
  const merged = mergeAttributesPreservingPhase2(getAttributes(mainMeta), getAttributes(phase2Meta));
  return {
    json: {
      name: mainMeta?.name || '',
      description: mainMeta?.description || '',
      external_url: mainMeta?.external_url || '',
      image: replaceImageFileName(mainMeta?.image, imageName),
      attributes: merged.attributes,
    },
    extrasPreserved: merged.extrasPreserved,
  };
}

async function readPairMetadata(pair, warnings, label) {
  try {
    return JSON.parse(await fsp.readFile(pair.jsonPath, 'utf8'));
  } catch (e) {
    warnings.push(`${label} ${pair.jsonName}: ${e.message}`);
    return null;
  }
}

async function collectMainItems({ buildDir, logs }) {
  const imageDir = path.join(buildDir, 'images');
  const jsonDir = path.join(buildDir, 'json');
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  const warnings = [...scan.warnings];
  const items = [];
  for (const pair of scan.pairs) {
    const meta = await readPairMetadata(pair, warnings, 'Output');
    if (!meta) continue;
    const imageHash = await fileHash(pair.imagePath);
    const stableId = stableIdFromMetadata(meta) || `image_sha256:${imageHash}`;
    items.push({ ...pair, stableId, meta, attributes: getAttributes(meta), imageHash });
  }
  log(logs, 'info', `Found ${scan.pairs.length} main Output pair(s).`);
  return { items, warnings, ignoredFiles: scan.ignoredFiles };
}

async function collectPhase2Items({ phase2Dir, map, logs }) {
  const imageDir = safePhase2Path(phase2Dir, 'images');
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  const warnings = [...scan.warnings];
  const byPhaseEdition = mapByPhase2Edition(map);
  const byMainEdition = mapByMainEdition(map);
  const items = [];
  for (const pair of scan.pairs) {
    const meta = await readPairMetadata(pair, warnings, 'Phase 2');
    if (!meta) continue;
    const mapped = byPhaseEdition.get(pair.oldIndex) || byMainEdition.get(pair.oldIndex) || null;
    const imageHash = await fileHash(pair.imagePath);
    const stableId = mapped?.stableId || stableIdFromMetadata(meta) || `image_sha256:${imageHash}`;
    const mainImageHash = mapped?.mainImageHash || '';
    const phase2ImageEdited = mapped?.phase2ImageEdited === true || (mainImageHash && imageHash !== mainImageHash);
    items.push({ ...pair, stableId, meta, attributes: getAttributes(meta), imageHash, phase2ImageEdited, mapped });
  }
  log(logs, 'info', `Found ${scan.pairs.length} Phase 2 pair(s).`);
  return { items, warnings, ignoredFiles: scan.ignoredFiles };
}

async function directoryHasFiles(dir) {
  try {
    return (await fsp.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

function addNumericFile(map, parsed, kind, warnings) {
  const previous = map.get(parsed.index);
  if (previous) {
    warnings.push(`Duplicate numeric ${kind} basename ${parsed.index}: ${previous.fileName} and ${parsed.fileName}. Skipped ${parsed.fileName}.`);
    return;
  }
  map.set(parsed.index, parsed);
}

async function scanOutputPairs({ imageDir, jsonDir }) {
  const warnings = [];
  const ignoredFiles = [];
  const imageFiles = await fsp.readdir(imageDir).catch(() => []);
  const jsonFiles = await fsp.readdir(jsonDir).catch(() => []);
  const imageByIndex = new Map();
  const jsonByIndex = new Map();

  for (const fileName of imageFiles) {
    const parsed = parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS);
    if (parsed) addNumericFile(imageByIndex, parsed, 'image', warnings);
    else if (!fileName.startsWith('.')) ignoredFiles.push(`images/${fileName}`);
  }

  for (const fileName of jsonFiles) {
    const parsed = parseNumericFile(fileName, ['.json']);
    if (parsed) addNumericFile(jsonByIndex, parsed, 'JSON', warnings);
    else if (!fileName.startsWith('.')) ignoredFiles.push(`json/${fileName}`);
  }

  const indexes = [...new Set([...imageByIndex.keys(), ...jsonByIndex.keys()])].sort((a, b) => a - b);
  const pairs = [];

  for (const oldIndex of indexes) {
    const image = imageByIndex.get(oldIndex) || null;
    const json = jsonByIndex.get(oldIndex) || null;
    if (image && json) {
      pairs.push({
        oldIndex,
        imageExt: image.ext,
        imageName: image.fileName,
        jsonName: json.fileName,
        imagePath: path.join(imageDir, image.fileName),
        jsonPath: path.join(jsonDir, json.fileName),
      });
    } else if (image) {
      warnings.push(`${image.fileName} has no matching ${oldIndex}.json`);
    } else if (json) {
      warnings.push(`${json.fileName} has no matching image`);
    }
  }

  return { pairs, warnings, ignoredFiles, imageFiles, jsonFiles, imageByIndex, jsonByIndex };
}

async function listPhase2Collection({ phase2Dir }) {
  const imageDir = path.join(phase2Dir, 'images');
  const jsonDir = path.join(phase2Dir, 'json');
  const exists = fs.existsSync(imageDir) && fs.existsSync(jsonDir);
  if (!exists) {
    return { exists: false, images: [], warnings: [], ignoredFiles: [] };
  }
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  return {
    exists: true,
    images: scan.pairs.map(pair => ({ name: pair.imageName, path: `images/${pair.imageName}`, edition: pair.oldIndex })),
    warnings: scan.warnings,
    ignoredFiles: scan.ignoredFiles,
  };
}

async function syncFromOutput({ buildDir, phase2Dir }) {
  const logs = [];
  log(logs, 'info', 'Syncing Phase 2 from Output...');
  const sourceImageDir = path.join(buildDir, 'images');
  const sourceJsonDir = path.join(buildDir, 'json');
  const phase2ImageDir = safePhase2Path(phase2Dir, 'images');
  const phase2JsonDir = safePhase2Path(phase2Dir, 'json');
  const scan = await scanOutputPairs({ imageDir: sourceImageDir, jsonDir: sourceJsonDir });

  await fsp.mkdir(phase2Dir, { recursive: true });
  await fsp.rm(phase2ImageDir, { recursive: true, force: true });
  await fsp.rm(phase2JsonDir, { recursive: true, force: true });
  await ensurePhase2Dirs(phase2Dir);

  let copiedImages = 0;
  let copiedJson = 0;
  const mapItems = [];
  for (const pair of scan.pairs) {
    await fsp.copyFile(pair.imagePath, path.join(phase2ImageDir, pair.imageName));
    copiedImages++;
    await fsp.copyFile(pair.jsonPath, path.join(phase2JsonDir, pair.jsonName));
    copiedJson++;
    let meta = null;
    try {
      meta = JSON.parse(await fsp.readFile(pair.jsonPath, 'utf8'));
    } catch {}
    const imageHash = await fileHash(pair.imagePath);
    const stableId = stableIdFromMetadata(meta) || `image_sha256:${imageHash}`;
    mapItems.push({
      stableId,
      mainEdition: pair.oldIndex,
      phase2Edition: pair.oldIndex,
      mainImageHash: imageHash,
      phase2ImageHash: imageHash,
      phase2ImageEdited: false,
      deletedInPhase2: false,
    });
  }
  await writePhase2Map({ phase2Dir, map: { items: mapItems } });

  scan.warnings.forEach(message => log(logs, 'warning', message));
  if (scan.ignoredFiles.length) log(logs, 'debug', `Ignored ${scan.ignoredFiles.length} non-output file(s) while syncing.`);
  log(logs, 'info', `Created ${MAIN_PHASE2_MAP_FILE} with ${mapItems.length} item(s).`);
  log(logs, 'success', `Copied ${copiedImages} images and ${copiedJson} JSON files into buildphase2/`);
  return {
    ok: true,
    copiedImages,
    copiedJson,
    warnings: scan.warnings,
    ignoredFiles: scan.ignoredFiles,
    logs,
  };
}

async function deletePhase2Editions({ phase2Dir, editions }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  if (!cleanEditions.length) {
    log(logs, 'warning', 'No Phase 2 items are marked.');
    return { ok: true, deletedImages: 0, deletedJson: 0, warnings: ['No Phase 2 items are marked.'], logs };
  }

  const imageDir = safePhase2Path(phase2Dir, 'images');
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  const currentMap = await readPhase2Map({ phase2Dir });
  if (currentMap.warning) log(logs, 'warning', currentMap.warning);
  const byStable = mapByStableId(currentMap);
  const byPhaseEdition = mapByPhase2Edition(currentMap);
  const pairByIndex = new Map(scan.pairs.map(pair => [pair.oldIndex, pair]));
  let deletedImages = 0;
  let deletedJson = 0;
  let deletedTracked = 0;
  const warnings = [...scan.warnings];

  for (const edition of cleanEditions) {
    const pair = pairByIndex.get(edition);
    if (!pair) {
      const warning = `Phase 2 #${edition} was not found or is missing a paired image/JSON file.`;
      warnings.push(warning);
      log(logs, 'warning', warning);
      continue;
    }
    const meta = await readPairMetadata(pair, warnings, 'Phase 2');
    const mapped = byPhaseEdition.get(edition);
    const imageHash = await fileHash(pair.imagePath);
    const stableId = mapped?.stableId || stableIdFromMetadata(meta) || `image_sha256:${imageHash}`;
    const record = byStable.get(stableId) || {
      stableId,
      mainEdition: mapped?.mainEdition || edition,
      phase2Edition: edition,
      mainImageHash: mapped?.mainImageHash || '',
      phase2ImageHash: imageHash,
      phase2ImageEdited: mapped?.phase2ImageEdited === true,
    };
    record.phase2Edition = edition;
    record.deletedInPhase2 = true;
    record.deletedAt = new Date().toISOString();
    byStable.set(stableId, record);
    deletedTracked++;
    await fsp.rm(assertInside(phase2Dir, pair.imagePath), { force: true });
    deletedImages++;
    await fsp.rm(assertInside(phase2Dir, pair.jsonPath), { force: true });
    deletedJson++;
  }

  await writePhase2Map({ phase2Dir, map: { items: [...byStable.values()] } });
  if (deletedTracked) log(logs, 'info', `Recorded ${deletedTracked} Phase 2 deleted stable ID(s).`);
  log(logs, 'success', `Deleted ${deletedImages} marked Phase 2 item(s).`);
  return { ok: true, deletedImages, deletedJson, warnings, logs };
}

async function deleteAllPhase2Output({ phase2Dir }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const imageDir = safePhase2Path(phase2Dir, 'images');
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  const currentMap = await readPhase2Map({ phase2Dir });
  if (currentMap.warning) log(logs, 'warning', currentMap.warning);
  const byStable = mapByStableId(currentMap);
  const byPhaseEdition = mapByPhase2Edition(currentMap);
  let deletedTracked = 0;
  for (const pair of scan.pairs) {
    const meta = await readPairMetadata(pair, [], 'Phase 2');
    const mapped = byPhaseEdition.get(pair.oldIndex);
    const imageHash = await fileHash(pair.imagePath);
    const stableId = mapped?.stableId || stableIdFromMetadata(meta) || `image_sha256:${imageHash}`;
    const record = byStable.get(stableId) || {
      stableId,
      mainEdition: mapped?.mainEdition || pair.oldIndex,
      phase2Edition: pair.oldIndex,
      mainImageHash: mapped?.mainImageHash || '',
      phase2ImageHash: imageHash,
      phase2ImageEdited: mapped?.phase2ImageEdited === true,
    };
    record.phase2Edition = pair.oldIndex;
    record.deletedInPhase2 = true;
    record.deletedAt = new Date().toISOString();
    byStable.set(stableId, record);
    deletedTracked++;
  }
  const imageFiles = (await fsp.readdir(imageDir).catch(() => []))
    .filter(fileName => parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS));
  const jsonFiles = (await fsp.readdir(jsonDir).catch(() => []))
    .filter(fileName => parseNumericFile(fileName, ['.json']));

  for (const fileName of imageFiles) await fsp.rm(safePhase2Path(phase2Dir, 'images', fileName), { force: true });
  for (const fileName of jsonFiles) await fsp.rm(safePhase2Path(phase2Dir, 'json', fileName), { force: true });

  await writePhase2Map({ phase2Dir, map: { items: [...byStable.values()] } });
  if (deletedTracked) log(logs, 'info', `Recorded ${deletedTracked} Phase 2 deleted stable ID(s).`);
  log(logs, 'success', 'Deleted all Phase 2 images and JSON metadata. Extra traits were preserved.');
  return { ok: true, deletedImages: imageFiles.length, deletedJson: jsonFiles.length, logs };
}

async function updatePhase2MapForMappings({ phase2Dir, mappings, logs }) {
  if (!Array.isArray(mappings) || !mappings.length) return;
  const map = await readPhase2Map({ phase2Dir });
  if (map.warning) log(logs, 'warning', map.warning);
  const byPhaseEdition = mapByPhase2Edition(map);
  let updated = 0;
  for (const mapping of mappings) {
    const record = byPhaseEdition.get(Number(mapping.oldIndex));
    if (!record) continue;
    record.phase2Edition = Number(mapping.newIndex);
    record.deletedInPhase2 = false;
    updated++;
  }
  if (updated) {
    await writePhase2Map({ phase2Dir, map });
    log(logs, 'info', `Updated ${MAIN_PHASE2_MAP_FILE} for ${updated} Phase 2 filename mapping(s).`);
  }
}

async function reindexPhase2Files({ phase2Dir, startIndex = 1 }) {
  await ensurePhase2Dirs(phase2Dir);
  const imageDir = safePhase2Path(phase2Dir, 'images');
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const result = await outputFileOps.reindexOutputFiles({ imageDir, jsonDir, startIndex });
  const logs = phase2FileOpLogs('Reindex Phase 2', result);
  if (result.ok) await updatePhase2MapForMappings({ phase2Dir, mappings: result.mappings || [], logs });
  return {
    ...result,
    logs,
  };
}

async function shufflePhase2Files({ phase2Dir, startIndex = 1, assignedIndexes = null, random = Math.random }) {
  await ensurePhase2Dirs(phase2Dir);
  const imageDir = safePhase2Path(phase2Dir, 'images');
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const result = await outputFileOps.shuffleOutputFiles({ imageDir, jsonDir, startIndex, assignedIndexes, random });
  const logs = phase2FileOpLogs('Shuffle Phase 2', result);
  if (result.ok) await updatePhase2MapForMappings({ phase2Dir, mappings: result.mappings || [], logs });
  return {
    ...result,
    logs,
  };
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function phase2ReorderIdentity(meta) {
  const copy = JSON.parse(JSON.stringify(meta || {}));
  delete copy.image;
  delete copy.name;
  delete copy.edition;
  delete copy.tokenId;
  delete copy.token_id;
  delete copy.id;
  return JSON.stringify(copy);
}

function phase2ImageFileNameFromReference(value) {
  if (typeof value !== 'string') return null;
  const clean = value.split(/[?#]/)[0];
  const base = path.basename(clean);
  return parseNumericFile(base, SUPPORTED_IMAGE_EXTS) ? base : null;
}

function buildManualReorderPlan({ imageDir, jsonDir, pairs, draggedEdition, beforeEdition, targetPosition = null, startIndex = 1 }) {
  const dragged = Number(draggedEdition);
  const before = Number(beforeEdition);
  if (!Number.isSafeInteger(dragged)) throw new Error('Invalid dragged Phase 2 edition.');

  const sortedPairs = [...pairs].sort((a, b) => a.oldIndex - b.oldIndex);
  const oldOffset = sortedPairs.findIndex(pair => pair.oldIndex === dragged);
  if (oldOffset < 0) throw new Error(`Phase 2 piece #${dragged} was not found.`);

  const draggedPair = sortedPairs[oldOffset];
  const withoutDragged = sortedPairs.filter(pair => pair.oldIndex !== dragged);
  let insertOffset;
  if (targetPosition !== null && targetPosition !== undefined && targetPosition !== '') {
    const position = Number(targetPosition);
    if (!Number.isSafeInteger(position)) throw new Error('Invalid manual reorder target position.');
    insertOffset = Math.max(0, Math.min(withoutDragged.length, position - startIndex));
  } else {
    if (!Number.isSafeInteger(before)) throw new Error('Invalid drop target Phase 2 edition.');
    if (dragged === before) throw new Error('Dragged Phase 2 piece and drop target are the same.');
    if (!sortedPairs.some(pair => pair.oldIndex === before)) throw new Error(`Phase 2 drop target #${before} was not found.`);
    insertOffset = withoutDragged.findIndex(pair => pair.oldIndex === before);
    if (insertOffset < 0) throw new Error(`Phase 2 drop target #${before} was not found after planning.`);
  }
  withoutDragged.splice(insertOffset, 0, draggedPair);

  const batchId = `.__phase2_reorder_${process.pid}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const plannedPairs = withoutDragged.map((pair, offset) => {
    const newIndex = startIndex + offset;
    const finalImageName = `${newIndex}${pair.imageExt}`;
    const finalJsonName = `${newIndex}.json`;
    return {
      ...pair,
      oldImageName: pair.imageName,
      oldJsonName: pair.jsonName,
      newIndex,
      finalImageName,
      finalJsonName,
      finalImagePath: path.join(imageDir, finalImageName),
      finalJsonPath: path.join(jsonDir, finalJsonName),
      tempImageName: `${batchId}_${pair.oldIndex}${pair.imageExt}`,
      tempJsonName: `${batchId}_${pair.oldIndex}.json`,
      tempImagePath: path.join(imageDir, `${batchId}_${pair.oldIndex}${pair.imageExt}`),
      tempJsonPath: path.join(jsonDir, `${batchId}_${pair.oldIndex}.json`),
    };
  });

  return {
    operationName: 'Manual Phase 2 reorder',
    imageDir,
    jsonDir,
    startIndex,
    batchId,
    draggedEdition: dragged,
    beforeEdition: Number.isSafeInteger(before) ? before : null,
    oldPosition: oldOffset + startIndex,
    newPosition: withoutDragged.findIndex(pair => pair.oldIndex === dragged) + startIndex,
    pairs: plannedPairs,
  };
}

async function preflightManualReorderPlan(plan, logs, warnings, errors) {
  await fsp.access(plan.imageDir, fs.constants.R_OK | fs.constants.W_OK);
  await fsp.access(plan.jsonDir, fs.constants.R_OK | fs.constants.W_OK);

  const originalPaths = new Set();
  const finalPaths = new Set();
  const tempPaths = new Set();

  for (const pair of plan.pairs) {
    originalPaths.add(path.resolve(pair.imagePath).toLowerCase());
    originalPaths.add(path.resolve(pair.jsonPath).toLowerCase());
  }

  for (const pair of plan.pairs) {
    const imagePaths = [
      ['source image', pair.imagePath],
      ['temporary image', pair.tempImagePath],
      ['final image', pair.finalImagePath],
    ];
    const jsonPaths = [
      ['source JSON', pair.jsonPath],
      ['temporary JSON', pair.tempJsonPath],
      ['final JSON', pair.finalJsonPath],
    ];
    for (const [label, filePath] of imagePaths) {
      try {
        assertInside(plan.imageDir, filePath);
      } catch {
        errors.push(`Blocked unsafe Phase 2 reorder: ${label} path is outside buildphase2/images.`);
      }
    }
    for (const [label, filePath] of jsonPaths) {
      try {
        assertInside(plan.jsonDir, filePath);
      } catch {
        errors.push(`Blocked unsafe Phase 2 reorder: ${label} path is outside buildphase2/json.`);
      }
    }
  }

  for (const pair of plan.pairs) {
    if (!(await fileExists(pair.imagePath))) errors.push(`Missing Phase 2 image before reorder: ${pair.oldImageName}`);
    if (!(await fileExists(pair.jsonPath))) errors.push(`Missing Phase 2 JSON before reorder: ${pair.oldJsonName}`);

    for (const [label, filePath] of [
      ['image', pair.finalImagePath],
      ['JSON', pair.finalJsonPath],
    ]) {
      const key = path.resolve(filePath).toLowerCase();
      if (finalPaths.has(key)) errors.push(`Duplicate final Phase 2 ${label} target: ${path.basename(filePath)}`);
      finalPaths.add(key);
      if ((await fileExists(filePath)) && !originalPaths.has(key)) {
        errors.push(`Final Phase 2 ${label} target would overwrite unrelated file: ${path.basename(filePath)}`);
      }
    }

    for (const [label, filePath] of [
      ['image', pair.tempImagePath],
      ['JSON', pair.tempJsonPath],
    ]) {
      const key = path.resolve(filePath).toLowerCase();
      if (tempPaths.has(key)) errors.push(`Duplicate temporary Phase 2 ${label} target: ${path.basename(filePath)}`);
      tempPaths.add(key);
      if (await fileExists(filePath)) errors.push(`Temporary Phase 2 ${label} file already exists: ${path.basename(filePath)}`);
    }

    try {
      pair.originalJsonText = await fsp.readFile(pair.jsonPath, 'utf8');
      pair.originalJson = JSON.parse(pair.originalJsonText);
      pair.identityBefore = phase2ReorderIdentity(pair.originalJson);
      pair.attributesBefore = JSON.stringify(pair.originalJson.attributes);
    } catch (e) {
      errors.push(`Invalid Phase 2 JSON before reorder: ${pair.oldJsonName}: ${e.message}`);
    }
  }

  if (errors.length) errors.forEach(message => log(logs, 'error', message));
  else log(logs, 'info', 'Manual Phase 2 reorder preflight validation passed.');
  return !errors.length;
}

async function renamePhase2ReorderOperations(operations, logs, phaseLabel) {
  const completed = [];
  try {
    for (const op of operations) {
      await fsp.rename(op.from, op.to);
      completed.push(op);
      log(logs, 'debug', `${phaseLabel}: ${path.basename(op.from)} -> ${path.basename(op.to)}`);
    }
  } catch (e) {
    log(logs, 'error', `${phaseLabel} failed: ${e.message}`);
    for (const op of completed.reverse()) {
      await fsp.rename(op.to, op.from).catch(rollbackError => {
        log(logs, 'error', `Rollback failed for ${path.basename(op.to)}: ${rollbackError.message}`);
      });
    }
    throw e;
  }
}

function manualReorderPhaseOneOperations(plan) {
  return plan.pairs.flatMap(pair => [
    { from: pair.imagePath, to: pair.tempImagePath },
    { from: pair.jsonPath, to: pair.tempJsonPath },
  ]);
}

function manualReorderPhaseTwoOperations(plan) {
  return plan.pairs.flatMap(pair => [
    { from: pair.tempImagePath, to: pair.finalImagePath },
    { from: pair.tempJsonPath, to: pair.finalJsonPath },
  ]);
}

async function rollbackPhase2ReorderMoves(moves, logs, label) {
  const batchId = `.__phase2_reorder_rollback_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const prepared = [];
  for (const move of moves) {
    if (path.resolve(move.from) === path.resolve(move.to)) continue;
    if (!(await fileExists(move.from))) continue;
    const temp = path.join(path.dirname(move.from), `${batchId}_${prepared.length}${path.extname(move.from)}`);
    try {
      await fsp.rename(move.from, temp);
      prepared.push({ ...move, temp });
    } catch (e) {
      log(logs, 'error', `${label} rollback prepare failed for ${path.basename(move.from)}: ${e.message}`);
    }
  }

  for (const move of prepared) {
    try {
      await fsp.rename(move.temp, move.to);
    } catch (e) {
      log(logs, 'error', `${label} rollback restore failed for ${path.basename(move.to)}: ${e.message}`);
      await fsp.rename(move.temp, move.from).catch(rollbackError => {
        log(logs, 'error', `${label} rollback could not return ${path.basename(move.temp)}: ${rollbackError.message}`);
      });
    }
  }
}

async function rollbackManualReorderTemporaryToOriginal(plan, logs) {
  const moves = plan.pairs.flatMap(pair => [
    { from: pair.tempJsonPath, to: pair.jsonPath },
    { from: pair.tempImagePath, to: pair.imagePath },
  ]);
  await rollbackPhase2ReorderMoves(moves, logs, 'Manual Phase 2 reorder temp');
}

async function rollbackManualReorderFinalToOriginal(plan, logs) {
  const moves = plan.pairs.flatMap(pair => [
    { from: pair.finalJsonPath, to: pair.jsonPath },
    { from: pair.finalImagePath, to: pair.imagePath },
  ]);
  await rollbackPhase2ReorderMoves(moves, logs, 'Manual Phase 2 reorder final');
  for (const pair of plan.pairs) {
    if (pair.originalJsonText !== undefined) {
      await fsp.writeFile(pair.jsonPath, pair.originalJsonText, 'utf8').catch(e => {
        log(logs, 'error', `Could not restore original Phase 2 JSON ${pair.oldJsonName}: ${e.message}`);
      });
    }
  }
}

async function updateManualReorderMetadata(plan, logs) {
  let metadataUpdated = 0;
  for (const pair of plan.pairs) {
    const raw = await fsp.readFile(pair.finalJsonPath, 'utf8');
    const meta = JSON.parse(raw);
    const updated = outputFileOps.updateSafeMetadataFields(meta, pair);
    await writePhase2JsonSafely(plan.jsonDir, pair.finalJsonPath, updated);
    metadataUpdated++;
  }
  log(logs, 'info', `Updated JSON metadata for ${metadataUpdated} Phase 2 pair(s).`);
  return metadataUpdated;
}

async function validateManualReorder(plan, logs, warnings, errors) {
  const scan = await scanOutputPairs({ imageDir: plan.imageDir, jsonDir: plan.jsonDir });
  for (const message of scan.warnings) {
    const failure = `Phase 2 manual reorder validation warning treated as failure: ${message}`;
    errors.push(failure);
  }

  const imageByIndex = scan.imageByIndex;
  const jsonByIndex = scan.jsonByIndex;
  const pairByNewIndex = new Map();
  for (const pair of plan.pairs) {
    if (pairByNewIndex.has(pair.newIndex)) errors.push(`Duplicate planned final index: ${pair.newIndex}`);
    pairByNewIndex.set(pair.newIndex, pair);
  }

  for (let offset = 0; offset < plan.pairs.length; offset++) {
    const expectedIndex = plan.startIndex + offset;
    const pair = pairByNewIndex.get(expectedIndex);
    if (!pair) {
      errors.push(`Missing planned Phase 2 pair for final index ${expectedIndex}`);
      continue;
    }
    const finalImage = imageByIndex.get(expectedIndex);
    const finalJson = jsonByIndex.get(expectedIndex);
    if (!finalImage) errors.push(`Missing final Phase 2 image for index ${expectedIndex}`);
    if (!finalJson) errors.push(`Missing final Phase 2 JSON for index ${expectedIndex}`);
    if (finalImage && finalImage.fileName !== pair.finalImageName) {
      errors.push(`Final Phase 2 image extension mismatch for ${expectedIndex}: expected ${pair.finalImageName}, found ${finalImage.fileName}`);
    }
    if (!finalJson) continue;

    let meta;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(plan.jsonDir, finalJson.fileName), 'utf8'));
    } catch (e) {
      errors.push(`Final Phase 2 JSON is invalid: ${finalJson.fileName}: ${e.message}`);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(meta, 'image')) {
      const imageFile = phase2ImageFileNameFromReference(meta.image);
      if (imageFile && imageFile !== pair.finalImageName) {
        errors.push(`Expected ${finalJson.fileName} to point to ${pair.finalImageName}, but image field points to ${imageFile}.`);
      }
    }
    if (phase2ReorderIdentity(meta) !== pair.identityBefore) {
      errors.push(`Pair identity changed for ${finalJson.fileName}; attributes or unrelated metadata were modified.`);
    }
    if (JSON.stringify(meta.attributes) !== pair.attributesBefore) {
      errors.push(`Attributes changed unexpectedly for ${finalJson.fileName}.`);
    }
  }

  if (scan.pairs.length !== plan.pairs.length) {
    errors.push(`Final Phase 2 pair count changed: expected ${plan.pairs.length}, found ${scan.pairs.length}.`);
  }

  errors.forEach(message => log(logs, 'error', message));
  if (!errors.length) log(logs, 'success', 'Manual Phase 2 reorder final validation passed.');
  else warnings.push(...scan.warnings);
  return { ok: !errors.length, errors, warnings };
}

function manualReorderFailure(message, logs, warnings, errors, extra = {}) {
  if (!errors.includes(message)) errors.push(message);
  log(logs, 'error', message);
  return { ok: false, error: message, logs, warnings, errors, ...extra };
}

async function manualReorderPhase2({ phase2Dir, draggedEdition, beforeEdition = null, targetPosition = null, startIndex = 1 }) {
  const logs = [];
  const warnings = [];
  const errors = [];
  log(logs, 'info', `Manual Phase 2 reorder requested: #${draggedEdition} -> ${targetPosition ? `position #${targetPosition}` : `before #${beforeEdition}`}.`);

  try {
    await fsp.mkdir(safePhase2Path(phase2Dir, 'images'), { recursive: true });
    await fsp.mkdir(safePhase2Path(phase2Dir, 'json'), { recursive: true });
    const imageDir = safePhase2Path(phase2Dir, 'images');
    const jsonDir = safePhase2Path(phase2Dir, 'json');
    const scan = await scanOutputPairs({ imageDir, jsonDir });
    warnings.push(...scan.warnings);
    for (const message of scan.warnings) log(logs, 'warning', message);
    if (!scan.pairs.length) {
      return manualReorderFailure('No complete Phase 2 image/JSON pairs found to reorder.', logs, warnings, errors);
    }

    const cleanStartIndex = Number.isSafeInteger(Number(startIndex)) ? Number(startIndex) : 1;
    const plan = buildManualReorderPlan({
      imageDir,
      jsonDir,
      pairs: scan.pairs,
      draggedEdition,
      beforeEdition,
      targetPosition,
      startIndex: cleanStartIndex,
    });
    const affectedPairs = plan.pairs.filter(pair => pair.oldIndex !== pair.newIndex).length;
    if (!affectedPairs) {
      log(logs, 'info', 'Manual Phase 2 reorder did not change the current order.');
      return {
        ok: true,
        pairsProcessed: 0,
        affectedPairs: 0,
        metadataUpdated: 0,
        oldPosition: plan.oldPosition,
        newPosition: plan.newPosition,
        warnings,
        errors,
        logs,
      };
    }

    log(logs, 'info', `Manual Phase 2 reorder requested: #${plan.draggedEdition} position #${plan.oldPosition} -> position #${plan.newPosition}.`);
    log(logs, 'info', `Reorder plan built: ${affectedPairs} affected pair(s), ${plan.pairs.length} total pair(s).`);
    for (const pair of plan.pairs) {
      if (pair.oldImageName !== pair.finalImageName || pair.oldJsonName !== pair.finalJsonName) {
        log(logs, 'info', `Manual reorder mapping: ${pair.oldImageName} + ${pair.oldJsonName} -> ${pair.finalImageName} + ${pair.finalJsonName}`);
      }
    }

    const preflightOk = await preflightManualReorderPlan(plan, logs, warnings, errors);
    if (!preflightOk) {
      return manualReorderFailure('Manual Phase 2 reorder failed validation before rename. Operation aborted.', logs, warnings, errors);
    }

    await renamePhase2ReorderOperations(manualReorderPhaseOneOperations(plan), logs, 'Manual Phase 2 reorder phase 1');
    try {
      await renamePhase2ReorderOperations(manualReorderPhaseTwoOperations(plan), logs, 'Manual Phase 2 reorder phase 2');
    } catch (e) {
      await rollbackManualReorderTemporaryToOriginal(plan, logs);
      throw e;
    }
    log(logs, 'success', 'Renamed Phase 2 pairs using safe temp rename.');

    let metadataUpdated = 0;
    try {
      metadataUpdated = await updateManualReorderMetadata(plan, logs);
    } catch (e) {
      log(logs, 'error', `Manual Phase 2 reorder metadata update failed: ${e.message}`);
      await rollbackManualReorderFinalToOriginal(plan, logs);
      return manualReorderFailure(`Manual Phase 2 reorder failed while updating metadata: ${e.message}`, logs, warnings, errors, {
        pairsProcessed: plan.pairs.length,
        affectedPairs,
      });
    }

    const validationErrors = [];
    const validation = await validateManualReorder(plan, logs, warnings, validationErrors);
    if (!validation.ok) {
      await rollbackManualReorderFinalToOriginal(plan, logs);
      const detail = validationErrors.slice(0, 5).join('; ');
      return manualReorderFailure(
        `Phase 2 manual reorder validation failed: ${detail || 'Unknown validation error'}. Rollback completed.`,
        logs,
        warnings,
        validationErrors,
        { pairsProcessed: plan.pairs.length, affectedPairs, metadataUpdated, validation }
      );
    }

    const mappings = plan.pairs.map(pair => ({
      oldIndex: pair.oldIndex,
      newIndex: pair.newIndex,
      oldImageName: pair.oldImageName,
      oldJsonName: pair.oldJsonName,
      finalImageName: pair.finalImageName,
      finalJsonName: pair.finalJsonName,
    }));
    await updatePhase2MapForMappings({ phase2Dir, mappings, logs });
    log(logs, 'success', `Manual Phase 2 reorder complete: ${affectedPairs} affected pair(s), ${metadataUpdated} metadata file(s) updated.`);

    return {
      ok: true,
      pairsProcessed: plan.pairs.length,
      affectedPairs,
      metadataUpdated,
      oldPosition: plan.oldPosition,
      newPosition: plan.newPosition,
      mappings,
      validation,
      warnings,
      errors,
      logs,
    };
  } catch (e) {
    return manualReorderFailure(`Manual Phase 2 reorder failed: ${e.message}`, logs, warnings, errors);
  }
}

async function refreshFromCurrentMain({ buildDir, phase2Dir }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const warnings = [];
  const errors = [];
  log(logs, 'info', 'Refresh From Current State of Main started.');
  log(logs, 'info', 'Stable identity strategy: metadata stable fields, then image hash, then existing Phase 2 map.');

  const phase2ImageDir = safePhase2Path(phase2Dir, 'images');
  const phase2JsonDir = safePhase2Path(phase2Dir, 'json');
  const currentMap = await readPhase2Map({ phase2Dir });
  if (currentMap.warning) {
    warnings.push(currentMap.warning);
    log(logs, 'warning', currentMap.warning);
  }
  const mappedByStable = mapByStableId(currentMap);
  const deletedByStable = new Map((currentMap.items || [])
    .filter(item => item?.deletedInPhase2 && item.stableId)
    .map(item => [String(item.stableId), item]));

  const main = await collectMainItems({ buildDir, logs });
  const phase2 = await collectPhase2Items({ phase2Dir, map: currentMap, logs });
  warnings.push(...main.warnings, ...phase2.warnings);
  warnings.forEach(message => log(logs, 'warning', message));

  const mainItems = [];
  const seenMainStable = new Set();
  for (const item of main.items) {
    if (seenMainStable.has(item.stableId)) {
      const warning = `Ambiguous main Output stable identity skipped for #${item.oldIndex}: ${item.stableId}`;
      warnings.push(warning);
      log(logs, 'warning', warning);
      continue;
    }
    seenMainStable.add(item.stableId);
    mainItems.push(item);
  }

  const phaseByStable = new Map();
  for (const item of phase2.items) {
    if (phaseByStable.has(item.stableId)) {
      const warning = `Ambiguous Phase 2 stable identity skipped for #${item.oldIndex}: ${item.stableId}`;
      warnings.push(warning);
      log(logs, 'warning', warning);
      continue;
    }
    phaseByStable.set(item.stableId, item);
  }

  const desired = [];
  let skippedDeleted = 0;
  let extrasPreserved = 0;
  let visualEditsPreserved = 0;
  let itemsAdded = 0;
  let itemsRenamed = 0;
  let imagesCopiedFromMain = 0;

  for (const mainItem of mainItems) {
    const deletedRecord = deletedByStable.get(mainItem.stableId);
    if (deletedRecord) {
      deletedRecord.mainEdition = mainItem.oldIndex;
      skippedDeleted++;
      continue;
    }
    const phaseItem = phaseByStable.get(mainItem.stableId) || null;
    const preservePhase2Image = !!phaseItem?.phase2ImageEdited;
    const finalImageExt = preservePhase2Image ? phaseItem.imageExt : mainItem.imageExt;
    const finalImageName = `${mainItem.oldIndex}${finalImageExt}`;
    const finalJsonName = `${mainItem.oldIndex}.json`;
    const built = buildPhase2JsonFromMain({
      mainMeta: mainItem.meta,
      phase2Meta: phaseItem?.meta || null,
      imageName: finalImageName,
    });
    extrasPreserved += built.extrasPreserved;
    if (preservePhase2Image) visualEditsPreserved++;
    if (!phaseItem) itemsAdded++;
    else if (phaseItem.oldIndex !== mainItem.oldIndex || phaseItem.imageName !== finalImageName || phaseItem.jsonName !== finalJsonName) itemsRenamed++;
    if (!preservePhase2Image) imagesCopiedFromMain++;
    desired.push({
      stableId: mainItem.stableId,
      mainItem,
      phaseItem,
      preservePhase2Image,
      finalIndex: mainItem.oldIndex,
      finalImageName,
      finalJsonName,
      finalJson: built.json,
    });
  }

  const desiredStable = new Set(desired.map(item => item.stableId));
  const itemsRemoved = phase2.items.filter(item => !desiredStable.has(item.stableId)).length;

  const phaseCompleteImageNames = new Set(phase2.items.map(item => item.imageName));
  const phaseCompleteJsonNames = new Set(phase2.items.map(item => item.jsonName));
  const allPhaseImageNames = new Set((await fsp.readdir(phase2ImageDir).catch(() => []))
    .filter(fileName => parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS))
    .map(fileName => fileName));
  const allPhaseJsonNames = new Set((await fsp.readdir(phase2JsonDir).catch(() => []))
    .filter(fileName => parseNumericFile(fileName, ['.json']))
    .map(fileName => fileName));
  const finalImageNames = new Set();
  const finalJsonNames = new Set();

  for (const item of desired) {
    if (finalImageNames.has(item.finalImageName)) errors.push(`Duplicate planned Phase 2 image target: ${item.finalImageName}`);
    if (finalJsonNames.has(item.finalJsonName)) errors.push(`Duplicate planned Phase 2 JSON target: ${item.finalJsonName}`);
    finalImageNames.add(item.finalImageName);
    finalJsonNames.add(item.finalJsonName);
    if (allPhaseImageNames.has(item.finalImageName) && !phaseCompleteImageNames.has(item.finalImageName)) {
      errors.push(`Cannot refresh safely because ${item.finalImageName} already exists as an incomplete Phase 2 image.`);
    }
    if (allPhaseJsonNames.has(item.finalJsonName) && !phaseCompleteJsonNames.has(item.finalJsonName)) {
      errors.push(`Cannot refresh safely because ${item.finalJsonName} already exists as an incomplete Phase 2 JSON file.`);
    }
  }

  log(logs, 'info', `Dry run: ${mainItems.length} main pair(s), ${phase2.items.length} Phase 2 pair(s), ${itemsAdded} to add, ${itemsRemoved} to remove, ${itemsRenamed} to rename/reindex, ${skippedDeleted} skipped because deleted in Phase 2.`);
  log(logs, 'info', `Dry run: ${extrasPreserved} Phase 2 extra attribute(s) preserved, ${visualEditsPreserved} visual edit(s) preserved.`);

  if (errors.length) {
    errors.forEach(message => log(logs, 'error', message));
    return { ok: false, error: errors[0], errors, warnings, logs };
  }

  const batchId = `.__phase2_refresh_${process.pid}_${Date.now()}`;
  const tempByStable = new Map();
  const createdPaths = [];
  const usedTempImages = new Set();
  const consumedPhaseImageTemps = [];
  const oldPhaseRecords = phase2.items.map(item => ({
    item,
    tempImagePath: safePhase2Path(phase2Dir, 'images', `${batchId}_${item.oldIndex}${item.imageExt}`),
    tempJsonPath: safePhase2Path(phase2Dir, 'json', `${batchId}_${item.oldIndex}.json`),
  }));

  try {
    for (const record of oldPhaseRecords) {
      await fsp.rename(record.item.imagePath, record.tempImagePath);
      await fsp.rename(record.item.jsonPath, record.tempJsonPath);
      tempByStable.set(record.item.stableId, record);
    }

    for (let i = 0; i < desired.length; i++) {
      const item = desired[i];
      const finalImagePath = safePhase2Path(phase2Dir, 'images', item.finalImageName);
      const finalJsonPath = safePhase2Path(phase2Dir, 'json', item.finalJsonName);
      if (item.preservePhase2Image && tempByStable.has(item.stableId)) {
        const record = tempByStable.get(item.stableId);
        await fsp.rename(record.tempImagePath, finalImagePath);
        usedTempImages.add(record.tempImagePath);
        consumedPhaseImageTemps.push({ record, finalImagePath });
      } else {
        const tempCopy = safePhase2Path(phase2Dir, 'images', `${batchId}_copy_${i}${item.mainItem.imageExt}`);
        await fsp.copyFile(item.mainItem.imagePath, tempCopy);
        createdPaths.push(tempCopy);
        await fsp.rename(tempCopy, finalImagePath);
        createdPaths.push(finalImagePath);
      }
      const tempJson = safePhase2Path(phase2Dir, 'json', `${batchId}_json_${i}.json`);
      await fsp.writeFile(tempJson, JSON.stringify(item.finalJson, null, 2), 'utf8');
      createdPaths.push(tempJson);
      await fsp.rename(tempJson, finalJsonPath);
      createdPaths.push(finalJsonPath);
    }

    const nextMapItems = [];
    for (const item of desired) {
      const finalImagePath = safePhase2Path(phase2Dir, 'images', item.finalImageName);
      const phase2ImageHash = await fileHash(finalImagePath);
      const previous = mappedByStable.get(item.stableId) || {};
      nextMapItems.push({
        stableId: item.stableId,
        mainEdition: item.mainItem.oldIndex,
        phase2Edition: item.finalIndex,
        mainImageHash: item.mainItem.imageHash,
        phase2ImageHash,
        phase2ImageEdited: item.preservePhase2Image || phase2ImageHash !== item.mainItem.imageHash || previous.phase2ImageEdited === true,
        deletedInPhase2: false,
      });
    }
    for (const record of deletedByStable.values()) {
      nextMapItems.push({ ...record, deletedInPhase2: true });
    }
    await writePhase2Map({ phase2Dir, map: { items: nextMapItems } });

    for (const record of oldPhaseRecords) {
      if (!usedTempImages.has(record.tempImagePath)) await fsp.rm(record.tempImagePath, { force: true });
      await fsp.rm(record.tempJsonPath, { force: true });
    }

    const validationScan = await scanOutputPairs({ imageDir: phase2ImageDir, jsonDir: phase2JsonDir });
    validationScan.warnings.forEach(message => log(logs, 'warning', message));
    log(logs, 'success', `Refresh From Current State of Main completed: ${itemsAdded} added, ${itemsRemoved} removed, ${itemsRenamed} renamed/reindexed, ${skippedDeleted} skipped as Phase 2-deleted.`);
    log(logs, 'success', `Preserved ${extrasPreserved} Phase 2 extra attribute(s) and ${visualEditsPreserved} Phase 2 visual edit(s).`);
    log(logs, 'success', `Final validation: ${validationScan.pairs.length} complete Phase 2 pair(s).`);
    return {
      ok: true,
      mainPairsFound: mainItems.length,
      phase2PairsFound: phase2.items.length,
      added: itemsAdded,
      removedMissingFromMain: itemsRemoved,
      renamed: itemsRenamed,
      skippedDeleted,
      extraAttributesPreserved: extrasPreserved,
      visualEditsPreserved,
      imagesCopiedFromMain,
      warnings,
      errors,
      logs,
    };
  } catch (e) {
    errors.push(e.message);
    log(logs, 'error', `Refresh From Current State of Main failed during file operation: ${e.message}`);
    for (const filePath of createdPaths.reverse()) {
      await fsp.rm(filePath, { force: true }).catch(() => {});
    }
    for (const move of consumedPhaseImageTemps.reverse()) {
      try {
        await fsp.access(move.finalImagePath);
        await fsp.rename(move.finalImagePath, move.record.item.imagePath);
      } catch {}
    }
    for (const record of oldPhaseRecords) {
      await fsp.mkdir(path.dirname(record.item.imagePath), { recursive: true }).catch(() => {});
      await fsp.mkdir(path.dirname(record.item.jsonPath), { recursive: true }).catch(() => {});
      try {
        await fsp.access(record.tempImagePath);
        await fsp.rename(record.tempImagePath, record.item.imagePath);
      } catch {}
      try {
        await fsp.access(record.tempJsonPath);
        await fsp.rename(record.tempJsonPath, record.item.jsonPath);
      } catch {}
    }
    log(logs, 'warning', 'Original Phase 2 filenames were restored where possible.');
    return { ok: false, error: e.message, errors, warnings, logs };
  }
}

async function readPhase2Metadata({ phase2Dir }) {
  const jsonDir = path.join(phase2Dir, 'json');
  const imageDir = path.join(phase2Dir, 'images');
  if (!fs.existsSync(jsonDir)) return { metas: [], warnings: [] };
  const scan = await scanOutputPairs({ imageDir, jsonDir });
  const metas = [];
  const warnings = [...scan.warnings];

  for (const pair of scan.pairs) {
    try {
      const meta = JSON.parse(await fsp.readFile(pair.jsonPath, 'utf8'));
      const attrs = meta.attributes || meta.properties?.attributes || [];
      metas.push({ edition: pair.oldIndex, attributes: attrs, meta });
    } catch (e) {
      warnings.push(`Could not parse ${pair.jsonName}: ${e.message}`);
    }
  }

  return { metas: metas.sort((a, b) => a.edition - b.edition), warnings };
}

async function readExtraTraits({ phase2Dir }) {
  await fsp.mkdir(phase2Dir, { recursive: true });
  const filePath = safePhase2Path(phase2Dir, EXTRA_TRAITS_FILE);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { extraTraits: Array.isArray(parsed.extraTraits) ? parsed.extraTraits : [] };
  } catch (e) {
    if (e.code === 'ENOENT') {
      const empty = { extraTraits: [] };
      await fsp.writeFile(filePath, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }
    throw e;
  }
}

function normalizeExtraTrait(trait, index) {
  const traitType = String(trait.trait_type || '').trim();
  const value = String(trait.value || '').trim();
  if (!traitType || !value) return null;
  const id = String(trait.id || `${traitType}-${value}-${index}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || `trait_${index}`;
  return {
    id,
    trait_type: traitType,
    value,
    enabled: trait.enabled !== false,
    selected: trait.selected === true,
    layer: trait.layer ? String(trait.layer) : '',
    overlayImage: trait.overlayImage ? String(trait.overlayImage) : '',
    notes: trait.notes ? String(trait.notes) : '',
    asset: normalizeTraitAsset(trait.asset),
    transform: normalizeTraitTransform(trait.transform),
  };
}

function normalizePhase2RelPath(value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const rel = text.startsWith('buildphase2/') ? text.slice('buildphase2/'.length) : text;
  if (!rel || rel.includes('..')) return '';
  return rel;
}

function normalizeTraitAsset(asset = {}) {
  return {
    sourcePath: normalizePhase2RelPath(asset.sourcePath),
    editedPath: normalizePhase2RelPath(asset.editedPath),
    generatedPath: normalizePhase2RelPath(asset.generatedPath),
    previewPath: normalizePhase2RelPath(asset.previewPath),
    hasTransparency: asset.hasTransparency === true,
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTraitTransform(transform = {}) {
  return {
    x: numberOr(transform.x, 0),
    y: numberOr(transform.y, 0),
    scale: numberOr(transform.scale, 1),
    rotation: numberOr(transform.rotation, 0),
    opacity: Math.max(0, Math.min(1, numberOr(transform.opacity, 1))),
  };
}

async function writeExtraTraits({ phase2Dir, extraTraits }) {
  await fsp.mkdir(phase2Dir, { recursive: true });
  const seen = new Set();
  const normalized = [];
  (Array.isArray(extraTraits) ? extraTraits : []).forEach((trait, index) => {
    const clean = normalizeExtraTrait(trait, index + 1);
    if (!clean || seen.has(clean.id)) return;
    seen.add(clean.id);
    normalized.push(clean);
  });
  const payload = { extraTraits: normalized };
  await fsp.writeFile(safePhase2Path(phase2Dir, EXTRA_TRAITS_FILE), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function phase2RelativePath(phase2Dir, filePath) {
  const full = assertInside(phase2Dir, filePath);
  return path.relative(path.resolve(phase2Dir), full).replace(/\\/g, '/');
}

function safeAssetName(name, fallback = 'phase2-trait') {
  const base = String(name || fallback)
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
  return base;
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match || !match[2]) throw new Error('Expected a base64 data URL');
  return {
    mime: match[1] || 'application/octet-stream',
    data: Buffer.from(match[3], 'base64'),
  };
}

function imageExtFromMime(mime, fallback = '.png') {
  const clean = String(mime || '').toLowerCase();
  if (clean.includes('jpeg') || clean.includes('jpg')) return '.jpg';
  if (clean.includes('webp')) return '.webp';
  if (clean.includes('gif')) return '.gif';
  if (clean.includes('png')) return '.png';
  return fallback;
}

async function uniquePhase2AssetPath({ phase2Dir, folder, fileName, ext = '.png' }) {
  const folderParts = normalizePhase2RelPath(folder).split('/').filter(Boolean);
  const dir = safePhase2Path(phase2Dir, ...folderParts);
  await fsp.mkdir(dir, { recursive: true });
  const cleanExt = SUPPORTED_IMAGE_EXTS.includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : '.png';
  const base = safeAssetName(fileName);
  let count = 1;
  while (true) {
    const suffix = count === 1 ? '' : `_${count}`;
    const full = path.join(dir, `${base}${suffix}${cleanExt}`);
    assertInside(phase2Dir, full);
    try {
      await fsp.access(full);
      count++;
    } catch {
      return full;
    }
  }
}

async function saveTraitAssetDataUrl({ phase2Dir, folder = 'traits/source', fileName = 'phase2-trait', dataUrl }) {
  await ensurePhase2Dirs(phase2Dir);
  const parsed = dataUrlToBuffer(dataUrl);
  const full = await uniquePhase2AssetPath({
    phase2Dir,
    folder,
    fileName,
    ext: imageExtFromMime(parsed.mime, '.png'),
  });
  await fsp.writeFile(full, parsed.data, { flag: 'wx' });
  return { ok: true, path: phase2RelativePath(phase2Dir, full), fileName: path.basename(full) };
}

async function saveTraitAssetBuffer({ phase2Dir, folder = 'traits/source', fileName = 'phase2-trait', data, ext = '.png' }) {
  await ensurePhase2Dirs(phase2Dir);
  const full = await uniquePhase2AssetPath({ phase2Dir, folder, fileName, ext });
  await fsp.writeFile(full, data, { flag: 'wx' });
  return { ok: true, path: phase2RelativePath(phase2Dir, full), fileName: path.basename(full) };
}

async function findPhase2ImageByEdition({ phase2Dir, edition }) {
  const n = Number(edition);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid Phase 2 edition number');
  const imageDir = safePhase2Path(phase2Dir, 'images');
  const files = await fsp.readdir(imageDir).catch(() => []);
  const match = files
    .map(fileName => parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS))
    .filter(Boolean)
    .find(file => file.index === n);
  if (!match) throw new Error(`Phase 2 image for #${n} not found`);
  return { edition: n, name: match.fileName, ext: match.ext, path: safePhase2Path(phase2Dir, 'images', match.fileName) };
}

async function savePhase2CompositedImage({ phase2Dir, edition, dataUrl }) {
  await ensurePhase2Dirs(phase2Dir);
  const image = await findPhase2ImageByEdition({ phase2Dir, edition });
  const parsed = dataUrlToBuffer(dataUrl);
  const temp = safePhase2Path(phase2Dir, 'images', `.__phase2_composite_${image.edition}_${Date.now()}${image.ext}`);
  await fsp.writeFile(temp, parsed.data);
  try {
    await fsp.rename(temp, image.path);
  } catch (e) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw e;
  }
  const map = await readPhase2Map({ phase2Dir });
  const byPhaseEdition = mapByPhase2Edition(map);
  const record = byPhaseEdition.get(image.edition);
  if (record) {
    record.phase2ImageEdited = true;
    record.phase2ImageHash = await fileHash(image.path);
    await writePhase2Map({ phase2Dir, map });
  }
  return { ok: true, edition: image.edition, imageName: image.name };
}

function hasTrait(attributes, trait) {
  return attributes.some(attr =>
    String(attr.trait_type || attr.name || '') === String(trait.trait_type) &&
    String(attr.value ?? '') === String(trait.value)
  );
}

function attributeTraitType(attr) {
  return String(attr?.trait_type || attr?.name || '');
}

function cleanTraitForApply(trait) {
  const traitType = String(trait?.trait_type || '').trim();
  const value = String(trait?.value || '').trim();
  if (!traitType || !value) return null;
  return { trait_type: traitType, value };
}

async function appendTraitsToEditions({ phase2Dir, editions, traits }) {
  await ensurePhase2Dirs(phase2Dir);
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  const cleanTraits = (traits || []).map(cleanTraitForApply).filter(Boolean);
  const logs = [];
  let updated = 0;
  let skippedMissing = 0;
  let skippedDuplicates = 0;
  let traitsApplied = 0;

  if (!cleanEditions.length) {
    log(logs, 'warning', 'No target Phase 2 items were selected.');
    return { ok: true, updated, skippedMissing, skippedDuplicates, traitsApplied, logs };
  }
  if (!cleanTraits.length) {
    log(logs, 'warning', 'No valid trait was selected.');
    return { ok: true, updated, skippedMissing, skippedDuplicates, traitsApplied, logs };
  }

  const jsonDir = safePhase2Path(phase2Dir, 'json');
  for (const edition of cleanEditions) {
    const jsonPath = safePhase2Path(phase2Dir, 'json', `${edition}.json`);
    try {
      const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      if (!Array.isArray(meta.attributes)) meta.attributes = [];
      let changed = false;
      for (const trait of cleanTraits) {
        if (hasTrait(meta.attributes, trait)) {
          skippedDuplicates++;
          continue;
        }
        meta.attributes.push({ trait_type: trait.trait_type, value: trait.value });
        traitsApplied++;
        changed = true;
      }
      if (changed) {
        await fsp.writeFile(assertInside(jsonDir, jsonPath), JSON.stringify(meta, null, 2), 'utf8');
        updated++;
      }
    } catch (e) {
      skippedMissing++;
      log(logs, 'warning', `Could not update Phase 2 #${edition}: ${e.message}`);
    }
  }

  return { ok: true, updated, skippedMissing, skippedDuplicates, traitsApplied, logs };
}

async function writePhase2JsonSafely(jsonDir, filePath, meta) {
  const full = assertInsidePhase2Json(jsonDir, filePath);
  const tmp = path.join(jsonDir, `.__phase2_json_tmp_${process.pid}_${Date.now()}_${path.basename(filePath)}`);
  assertInsidePhase2Json(jsonDir, tmp);
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
  await fsp.rename(tmp, full);
}

async function batchAddTraitToPhase2Json({ phase2Dir, editions, trait }) {
  const logs = [];
  const warnings = [];
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  await fsp.mkdir(jsonDir, { recursive: true });
  const cleanTrait = cleanTraitForApply(trait);
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  if (!cleanEditions.length) {
    log(logs, 'warning', 'No Phase 2 items are marked.');
    return { ok: true, processed: 0, updated: 0, added: 0, replaced: 0, unchanged: 0, duplicateTypeCleaned: 0, skipped: 0, warnings: ['No Phase 2 items are marked.'], logs };
  }
  if (!cleanTrait) {
    log(logs, 'warning', 'No valid trait was provided.');
    return { ok: true, processed: cleanEditions.length, updated: 0, added: 0, replaced: 0, unchanged: 0, duplicateTypeCleaned: 0, skipped: cleanEditions.length, warnings: ['No valid trait was provided.'], logs };
  }
  let updated = 0;
  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  let duplicateTypeCleaned = 0;
  let skipped = 0;
  for (const edition of cleanEditions) {
    const jsonPath = safePhase2Path(phase2Dir, 'json', `${edition}.json`);
    try {
      const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      if (!Array.isArray(meta.attributes)) meta.attributes = [];
      const firstMatchIndex = meta.attributes.findIndex(attr => attributeTraitType(attr) === cleanTrait.trait_type);
      if (firstMatchIndex === -1) {
        meta.attributes.push({ trait_type: cleanTrait.trait_type, value: cleanTrait.value });
        await writePhase2JsonSafely(jsonDir, jsonPath, meta);
        updated++;
        added++;
        continue;
      }

      const first = meta.attributes[firstMatchIndex];
      const wasExact = String(first.value ?? '') === cleanTrait.value;
      const cleanedAttributes = [];
      let seenEditedType = false;
      let removedDuplicateType = 0;
      for (const attr of meta.attributes) {
        if (attributeTraitType(attr) !== cleanTrait.trait_type) {
          cleanedAttributes.push(attr);
          continue;
        }
        if (!seenEditedType) {
          cleanedAttributes.push({ ...attr, trait_type: cleanTrait.trait_type, value: cleanTrait.value });
          seenEditedType = true;
        } else {
          removedDuplicateType++;
        }
      }
      meta.attributes = cleanedAttributes;
      if (removedDuplicateType) duplicateTypeCleaned += removedDuplicateType;

      if (wasExact && !removedDuplicateType) {
        unchanged++;
        continue;
      }

      await writePhase2JsonSafely(jsonDir, jsonPath, meta);
      updated++;
      if (wasExact) unchanged++;
      else replaced++;
    } catch (e) {
      skipped++;
      const warning = `Could not add/replace trait in Phase 2 #${edition}: ${e.message}`;
      warnings.push(warning);
      log(logs, 'warning', warning);
    }
  }

  log(logs, updated ? 'success' : 'warning', `Add/Replace trait ${cleanTrait.trait_type}: ${cleanTrait.value} completed for ${cleanEditions.length} marked item(s). Added: ${added}, Replaced: ${replaced}, Already unchanged: ${unchanged}, Duplicate ${cleanTrait.trait_type} entries cleaned: ${duplicateTypeCleaned}.`);
  if (skipped) log(logs, 'warning', `Skipped ${skipped} Phase 2 JSON file(s).`);
  return { ok: true, processed: cleanEditions.length, updated, added, replaced, unchanged, duplicateTypeCleaned, skipped, warnings, logs };
}

async function batchDeleteTraitFromPhase2Json({ phase2Dir, editions, trait }) {
  const logs = [];
  const warnings = [];
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  await fsp.mkdir(jsonDir, { recursive: true });
  const cleanTrait = cleanTraitForApply(trait);
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  if (!cleanEditions.length) {
    log(logs, 'warning', 'No Phase 2 items are marked.');
    return { ok: true, updated: 0, notFoundSkipped: 0, skipped: 0, warnings: ['No Phase 2 items are marked.'], logs };
  }
  if (!cleanTrait) {
    log(logs, 'warning', 'No valid trait was provided.');
    return { ok: true, updated: 0, notFoundSkipped: 0, skipped: cleanEditions.length, warnings: ['No valid trait was provided.'], logs };
  }
  let updated = 0;
  let removed = 0;
  let notFoundSkipped = 0;
  let skipped = 0;
  for (const edition of cleanEditions) {
    const jsonPath = safePhase2Path(phase2Dir, 'json', `${edition}.json`);
    try {
      const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      const attrs = Array.isArray(meta.attributes) ? meta.attributes : [];
      const before = attrs.length;
      meta.attributes = attrs.filter(attr => !isExactTraitMatch(attr, cleanTrait));
      const removedHere = before - meta.attributes.length;
      if (!removedHere) {
        notFoundSkipped++;
        continue;
      }
      await writePhase2JsonSafely(jsonDir, jsonPath, meta);
      updated++;
      removed += removedHere;
    } catch (e) {
      skipped++;
      const warning = `Could not delete trait from Phase 2 #${edition}: ${e.message}`;
      warnings.push(warning);
      log(logs, 'warning', warning);
    }
  }

  log(logs, updated ? 'success' : 'warning', `Deleted trait ${cleanTrait.trait_type}: ${cleanTrait.value} from ${updated} marked Phase 2 item(s). Skipped ${notFoundSkipped} item(s) where trait was not found.`);
  if (skipped) log(logs, 'warning', `Skipped ${skipped} Phase 2 JSON file(s).`);
  return { ok: true, updated, removed, notFoundSkipped, skipped, warnings, logs };
}

function validateSingleTraitEdit(meta, attrIndex, cleanTrait) {
  if (!Array.isArray(meta.attributes)) meta.attributes = [];
  if (!Number.isSafeInteger(attrIndex) || attrIndex < 0 || attrIndex >= meta.attributes.length) {
    throw new Error('Selected trait row was not found.');
  }
  for (let i = 0; i < meta.attributes.length; i++) {
    if (i === attrIndex) continue;
    const attr = meta.attributes[i];
    if (attributeTraitType(attr) !== cleanTrait.trait_type) continue;
    if (String(attr.value ?? '') === cleanTrait.value) {
      throw new Error('This piece already has that exact trait_type + value.');
    }
    throw new Error('This piece already has a trait with this trait_type. Use Batch Trait Editor Add / Replace if you want to replace trait values.');
  }
}

async function updatePhase2PieceTrait({ phase2Dir, edition, attrIndex, trait }) {
  const logs = [];
  const warnings = [];
  const n = Number(edition);
  const cleanIndex = Number(attrIndex);
  const cleanTrait = cleanTraitForApply(trait);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid Phase 2 edition number.');
  if (!Number.isSafeInteger(cleanIndex)) throw new Error('Invalid trait row index.');
  if (!cleanTrait) throw new Error('Trait Type and Value are required.');

  const jsonDir = safePhase2Path(phase2Dir, 'json');
  await fsp.mkdir(jsonDir, { recursive: true });
  const jsonPath = safePhase2Path(phase2Dir, 'json', `${n}.json`);
  const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
  if (!Array.isArray(meta.attributes)) meta.attributes = [];
  validateSingleTraitEdit(meta, cleanIndex, cleanTrait);
  const oldAttr = meta.attributes[cleanIndex] || {};
  const oldTrait = { trait_type: oldAttr.trait_type || oldAttr.name || '', value: oldAttr.value ?? '' };
  meta.attributes[cleanIndex] = { ...oldAttr, trait_type: cleanTrait.trait_type, value: cleanTrait.value };
  if ('name' in meta.attributes[cleanIndex] && !('trait_type' in oldAttr)) delete meta.attributes[cleanIndex].name;
  await writePhase2JsonSafely(jsonDir, jsonPath, meta);
  log(logs, 'success', `Edited Phase 2 piece #${n} trait: ${oldTrait.trait_type}: ${oldTrait.value} -> ${cleanTrait.trait_type}: ${cleanTrait.value}.`);
  return { ok: true, edition: n, attrIndex: cleanIndex, oldTrait, newTrait: cleanTrait, warnings, logs };
}

async function deletePhase2PieceTrait({ phase2Dir, edition, attrIndex }) {
  const logs = [];
  const warnings = [];
  const n = Number(edition);
  const cleanIndex = Number(attrIndex);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid Phase 2 edition number.');
  if (!Number.isSafeInteger(cleanIndex)) throw new Error('Invalid trait row index.');

  const jsonDir = safePhase2Path(phase2Dir, 'json');
  await fsp.mkdir(jsonDir, { recursive: true });
  const jsonPath = safePhase2Path(phase2Dir, 'json', `${n}.json`);
  const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
  if (!Array.isArray(meta.attributes)) meta.attributes = [];
  if (cleanIndex < 0 || cleanIndex >= meta.attributes.length) throw new Error('Selected trait row was not found.');
  const oldAttr = meta.attributes[cleanIndex] || {};
  const deletedTrait = { trait_type: oldAttr.trait_type || oldAttr.name || '', value: oldAttr.value ?? '' };
  meta.attributes.splice(cleanIndex, 1);
  await writePhase2JsonSafely(jsonDir, jsonPath, meta);
  log(logs, 'success', `Deleted Phase 2 piece #${n} trait: ${deletedTrait.trait_type}: ${deletedTrait.value}.`);
  return { ok: true, edition: n, attrIndex: cleanIndex, deletedTrait, warnings, logs };
}

async function applyExtraTraits({ phase2Dir, editions, traitIds = null }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  if (!cleanEditions.length) {
    log(logs, 'warning', 'No Phase 2 pieces are marked.');
    return { ok: true, updated: 0, skipped: 0, traitsApplied: 0, logs, warning: 'No Phase 2 pieces are marked.' };
  }

  const { extraTraits } = await readExtraTraits({ phase2Dir });
  const traitIdSet = Array.isArray(traitIds) && traitIds.length ? new Set(traitIds.map(String)) : null;
  if (!traitIdSet) {
    log(logs, 'warning', 'No extra traits selected. Select one or more traits in the Extra Traits tab first.');
    return { ok: true, updated: 0, skipped: cleanEditions.length, traitsApplied: 0, logs, warning: 'No extra traits selected.' };
  }

  const selectedTraits = extraTraits.filter(trait => traitIdSet.has(String(trait.id)));
  const disabledTraits = selectedTraits.filter(trait => trait.enabled === false);
  disabledTraits.forEach(trait => log(logs, 'warning', `Skipped disabled selected trait ${trait.trait_type}: ${trait.value}`));
  const activeTraits = selectedTraits.filter(trait => trait.enabled !== false);
  if (!activeTraits.length) {
    log(logs, 'warning', 'No selected enabled Phase 2 extra traits are active.');
    return { ok: true, updated: 0, skipped: cleanEditions.length, traitsApplied: 0, disabledSkipped: disabledTraits.length, logs, warning: 'No selected enabled Phase 2 extra traits are active.' };
  }

  const applied = await appendTraitsToEditions({ phase2Dir, editions: cleanEditions, traits: activeTraits });
  logs.push(...applied.logs);
  log(logs, applied.updated ? 'success' : 'warning', `Applied ${activeTraits.length} selected enabled extra trait(s) to ${applied.updated} Phase 2 JSON file(s); ${applied.skippedDuplicates} duplicate trait(s) skipped.`);
  return {
    ok: true,
    updated: applied.updated,
    skipped: applied.skippedMissing,
    duplicateSkipped: applied.skippedDuplicates,
    traitsApplied: applied.traitsApplied,
    activeTraits: activeTraits.length,
    disabledSkipped: disabledTraits.length,
    logs,
  };
}

function isExactTraitMatch(attr, trait) {
  return String(attr?.trait_type || '') === String(trait.trait_type) &&
    String(attr?.value ?? '') === String(trait.value);
}

async function removeTraitsFromPhase2Json({ phase2Dir, editions = null, traits }) {
  await ensurePhase2Dirs(phase2Dir);
  const cleanTraits = (traits || []).map(cleanTraitForApply).filter(Boolean);
  const logs = [];
  let updated = 0;
  let filesChecked = 0;
  let traitsRemoved = 0;
  let skippedMissing = 0;
  let skippedNotPresent = 0;

  if (!cleanTraits.length) {
    log(logs, 'warning', 'No Phase 2 trait selected for removal.');
    return { ok: true, updated, filesChecked, traitsRemoved, skippedMissing, skippedNotPresent, logs };
  }

  const jsonDir = safePhase2Path(phase2Dir, 'json');
  let targets = [];
  if (Array.isArray(editions)) {
    const cleanEditions = [...new Set(editions.map(n => Number(n)).filter(Number.isSafeInteger))];
    targets = cleanEditions.map(edition => ({ edition, jsonPath: safePhase2Path(phase2Dir, 'json', `${edition}.json`) }));
  } else {
    const files = (await fsp.readdir(jsonDir).catch(() => []))
      .map(fileName => parseNumericFile(fileName, ['.json']))
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);
    targets = files.map(file => ({ edition: file.index, jsonPath: safePhase2Path(phase2Dir, 'json', file.fileName) }));
  }

  for (const target of targets) {
    filesChecked++;
    try {
      const meta = JSON.parse(await fsp.readFile(target.jsonPath, 'utf8'));
      if (!Array.isArray(meta.attributes)) {
        skippedNotPresent++;
        continue;
      }
      const before = meta.attributes.length;
      meta.attributes = meta.attributes.filter(attr => !cleanTraits.some(trait => isExactTraitMatch(attr, trait)));
      const removed = before - meta.attributes.length;
      if (!removed) {
        skippedNotPresent++;
        continue;
      }
      await fsp.writeFile(assertInside(jsonDir, target.jsonPath), JSON.stringify(meta, null, 2), 'utf8');
      updated++;
      traitsRemoved += removed;
    } catch (e) {
      skippedMissing++;
      log(logs, 'warning', `Could not remove trait from Phase 2 #${target.edition}: ${e.message}`);
    }
  }

  return { ok: true, updated, filesChecked, traitsRemoved, skippedMissing, skippedNotPresent, logs };
}

async function removeExtraTraitsFromEditions({ phase2Dir, editions, traitIds = null }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const cleanEditions = [...new Set((editions || []).map(n => Number(n)).filter(Number.isSafeInteger))];
  if (!cleanEditions.length) {
    log(logs, 'warning', 'No Phase 2 items are marked.');
    return { ok: true, updated: 0, traitsRemoved: 0, logs, warning: 'No Phase 2 items are marked.' };
  }
  const traitIdSet = Array.isArray(traitIds) && traitIds.length ? new Set(traitIds.map(String)) : null;
  if (!traitIdSet) {
    log(logs, 'warning', 'No Phase 2 trait selected for removal.');
    return { ok: true, updated: 0, traitsRemoved: 0, logs, warning: 'No Phase 2 trait selected for removal.' };
  }

  const { extraTraits } = await readExtraTraits({ phase2Dir });
  const selectedTraits = extraTraits.filter(trait => traitIdSet.has(String(trait.id)));
  const protectedSkipped = [...traitIdSet].filter(id => !extraTraits.some(trait => String(trait.id) === id)).length;
  if (protectedSkipped) {
    log(logs, 'warning', 'This trait is not a Phase 2 extra trait. Original collection traits are protected.');
  }
  if (!selectedTraits.length) {
    log(logs, 'warning', 'No removable Phase 2 extra trait was selected.');
    return { ok: true, updated: 0, traitsRemoved: 0, protectedSkipped, logs, warning: 'No removable Phase 2 extra trait was selected.' };
  }

  const removed = await removeTraitsFromPhase2Json({ phase2Dir, editions: cleanEditions, traits: selectedTraits });
  logs.push(...removed.logs);
  log(logs, removed.updated ? 'success' : 'warning', `Removed ${selectedTraits.length} selected Phase 2 trait(s) from ${removed.updated} marked item(s).`);
  return {
    ok: true,
    updated: removed.updated,
    filesChecked: removed.filesChecked,
    traitsRemoved: removed.traitsRemoved,
    skippedMissing: removed.skippedMissing,
    skippedNotPresent: removed.skippedNotPresent,
    protectedSkipped,
    logs,
  };
}

async function deleteExtraTraitFromLibrary({ phase2Dir, traitId, removeFromJson = false }) {
  await ensurePhase2Dirs(phase2Dir);
  const logs = [];
  const id = String(traitId || '');
  const { extraTraits } = await readExtraTraits({ phase2Dir });
  const trait = extraTraits.find(row => String(row.id) === id);
  if (!trait) {
    log(logs, 'warning', 'This trait is not a Phase 2 extra trait. Original collection traits are protected.');
    return { ok: false, error: 'This trait is not a Phase 2 extra trait. Original collection traits are protected.', extraTraits, logs };
  }

  const remaining = extraTraits.filter(row => String(row.id) !== id);
  const saved = await writeExtraTraits({ phase2Dir, extraTraits: remaining });
  let cleanup = null;
  if (removeFromJson) {
    cleanup = await removeTraitsFromPhase2Json({ phase2Dir, editions: null, traits: [trait] });
    logs.push(...cleanup.logs);
    log(logs, 'success', `Deleted trait ${trait.trait_type}: ${trait.value} from library and removed it from ${cleanup.updated} Phase 2 JSON file(s).`);
  } else {
    log(logs, 'success', `Deleted trait ${trait.trait_type}: ${trait.value} from Phase 2 library only.`);
  }

  return {
    ok: true,
    extraTraits: saved.extraTraits,
    removedTrait: trait,
    cleanup,
    logs,
  };
}

async function hasPhase2WorkingCopy({ phase2Dir }) {
  return (await directoryHasFiles(path.join(phase2Dir, 'images'))) || (await directoryHasFiles(path.join(phase2Dir, 'json')));
}

function traitKey(traitType, value) {
  return `${String(traitType || 'Unknown')}::${String(value ?? '—')}`;
}

async function readValidPhase2JsonFiles({ phase2Dir }) {
  const jsonDir = safePhase2Path(phase2Dir, 'json');
  const files = (await fsp.readdir(jsonDir).catch(() => []))
    .map(fileName => parseNumericFile(fileName, ['.json']))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  const metas = [];
  const warnings = [];

  for (const file of files) {
    const jsonPath = safePhase2Path(phase2Dir, 'json', file.fileName);
    try {
      const meta = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      metas.push({
        edition: file.index,
        fileName: file.fileName,
        jsonPath,
        meta,
        attributes: Array.isArray(meta.attributes) ? meta.attributes : [],
      });
    } catch (e) {
      warnings.push(`Invalid Phase 2 JSON skipped: ${file.fileName}: ${e.message}`);
    }
  }

  return { metas, warnings };
}

function analyzePhase2RarityFromMetas(metas, warnings = []) {
  const traitCounts = new Map();
  const total = metas.length;
  for (const row of metas) {
    for (const attr of row.attributes || []) {
      const traitType = String(attr.trait_type || attr.name || 'Unknown');
      const value = String(attr.value ?? '—');
      const key = traitKey(traitType, value);
      if (!traitCounts.has(key)) traitCounts.set(key, { trait_type: traitType, value, count: 0, percentage: 0 });
      traitCounts.get(key).count++;
    }
  }
  const traits = [...traitCounts.values()]
    .map(row => ({ ...row, percentage: total ? Math.round(row.count / total * 10000) / 100 : 0 }))
    .sort((a, b) => a.trait_type.localeCompare(b.trait_type) || b.count - a.count || a.value.localeCompare(b.value));

  return { total, traits, warnings };
}

async function analyzePhase2Rarity({ phase2Dir }) {
  const { metas, warnings } = await readValidPhase2JsonFiles({ phase2Dir });
  return analyzePhase2RarityFromMetas(metas, warnings);
}

function parseEditionRange(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return [];
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return Array.from({ length: hi - lo + 1 }, (_, index) => lo + index);
}

function parseEditionList(value) {
  return [...new Set(String(value || '')
    .split(/[,\s]+/)
    .map(part => Number(part.trim()))
    .filter(Number.isSafeInteger))];
}

function deterministicShuffle(values, seed = '') {
  const out = [...values];
  let state = 2166136261;
  for (const ch of String(seed || 'phase2')) {
    state ^= ch.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function targetCandidateRows({ metas, mode, targetValue, targetTraitType, targetTraitValue, selectedEditions, applyingTrait, avoidDuplicates = true, seed = '' }) {
  const editionSet = new Set(metas.map(row => row.edition));
  const hasTargetTrait = row => hasTrait(row.attributes || [], { trait_type: targetTraitType, value: targetTraitValue });
  let rows = [];

  if (mode === 'marked') {
    const selected = new Set((selectedEditions || []).map(Number).filter(Number.isSafeInteger));
    rows = metas.filter(row => selected.has(row.edition));
  } else if (mode === 'range') {
    const wanted = new Set(parseEditionRange(targetValue));
    rows = metas.filter(row => wanted.has(row.edition));
  } else if (mode === 'list') {
    const wanted = new Set(parseEditionList(targetValue));
    rows = metas.filter(row => wanted.has(row.edition));
  } else if (mode === 'hasTrait') {
    rows = metas.filter(hasTargetTrait);
  } else if (mode === 'notHasTrait') {
    rows = metas.filter(row => !hasTargetTrait(row));
  } else if (mode === 'randomCount' || mode === 'randomPercentage') {
    let candidates = metas;
    if (avoidDuplicates && applyingTrait) candidates = candidates.filter(row => !hasTrait(row.attributes || [], applyingTrait));
    const total = candidates.length;
    const count = mode === 'randomCount'
      ? Math.max(0, Math.min(total, Math.floor(Number(targetValue) || 0)))
      : Math.max(0, Math.min(total, Math.round(total * Math.max(0, Number(String(targetValue).replace('%', '')) || 0) / 100)));
    rows = deterministicShuffle(candidates, seed).slice(0, count);
  } else if (mode === 'lowestRarity' || mode === 'highestRarity') {
    return { rows: [], placeholder: `${mode === 'lowestRarity' ? 'Lowest' : 'Highest'} Rarity targeting is not implemented yet.` };
  } else {
    rows = [];
  }

  return { rows: rows.filter(row => editionSet.has(row.edition)), placeholder: '' };
}

async function previewTraitTarget({ phase2Dir, trait, mode, targetValue, targetTraitType, targetTraitValue, selectedEditions, avoidDuplicates = true, seed = '' }) {
  const logs = [];
  const cleanTrait = cleanTraitForApply(trait);
  if (!cleanTrait) {
    log(logs, 'warning', 'No valid target trait selected.');
    return { ok: true, editions: [], count: 0, updateCount: 0, duplicateCount: 0, impact: null, logs, warning: 'No valid target trait selected.' };
  }
  const { metas, warnings } = await readValidPhase2JsonFiles({ phase2Dir });
  warnings.forEach(message => log(logs, 'warning', message));
  if (!metas.length) {
    log(logs, 'warning', 'No Phase 2 metadata found. Sync From Output first.');
    return { ok: true, editions: [], count: 0, updateCount: 0, duplicateCount: 0, impact: null, logs, warning: 'No Phase 2 metadata found. Sync From Output first.' };
  }
  const resolved = targetCandidateRows({ metas, mode, targetValue, targetTraitType, targetTraitValue, selectedEditions, applyingTrait: cleanTrait, avoidDuplicates, seed });
  if (resolved.placeholder) {
    log(logs, 'warning', resolved.placeholder);
    return { ok: true, editions: [], count: 0, updateCount: 0, duplicateCount: 0, impact: null, logs, warning: resolved.placeholder };
  }
  const allCurrent = metas.filter(row => hasTrait(row.attributes || [], cleanTrait)).length;
  const duplicateCount = resolved.rows.filter(row => hasTrait(row.attributes || [], cleanTrait)).length;
  const updateCount = resolved.rows.length - duplicateCount;
  const afterCount = allCurrent + updateCount;
  const impact = {
    trait: cleanTrait,
    total: metas.length,
    currentCount: allCurrent,
    currentPercentage: metas.length ? Math.round(allCurrent / metas.length * 10000) / 100 : 0,
    targetCount: resolved.rows.length,
    updateCount,
    duplicateCount,
    afterCount,
    afterPercentage: metas.length ? Math.round(afterCount / metas.length * 10000) / 100 : 0,
  };
  const editions = resolved.rows.map(row => row.edition).sort((a, b) => a - b);
  log(logs, 'info', `Preview target pieces: ${editions.length} Phase 2 item(s), ${updateCount} will be updated.`);
  return { ok: true, editions, count: editions.length, updateCount, duplicateCount, impact, logs };
}

async function applyTargetedTrait({ phase2Dir, trait, mode, targetValue, targetTraitType, targetTraitValue, selectedEditions, avoidDuplicates = true, seed = '' }) {
  const preview = await previewTraitTarget({ phase2Dir, trait, mode, targetValue, targetTraitType, targetTraitValue, selectedEditions, avoidDuplicates, seed });
  const logs = [...(preview.logs || [])];
  if (!preview.ok || !preview.updateCount) {
    log(logs, 'warning', preview.warning || 'No Phase 2 item(s) need this trait.');
    return { ...preview, updated: 0, skippedDuplicates: preview.duplicateCount || 0, logs };
  }
  const cleanTrait = cleanTraitForApply(trait);
  const applied = await appendTraitsToEditions({ phase2Dir, editions: preview.editions, traits: [cleanTrait] });
  logs.push(...applied.logs);
  log(logs, 'success', `Applied targeted trait ${cleanTrait.trait_type}: ${cleanTrait.value} to ${applied.updated} Phase 2 item(s).`);
  log(logs, 'info', `Skipped ${applied.skippedDuplicates} item(s) because the trait already existed.`);
  const rarity = await analyzePhase2Rarity({ phase2Dir });
  const updatedRow = rarity.traits.find(row => row.trait_type === cleanTrait.trait_type && row.value === cleanTrait.value);
  if (updatedRow) {
    log(logs, 'success', `Updated rarity distribution: ${cleanTrait.trait_type}: ${cleanTrait.value} = ${updatedRow.count} / ${rarity.total} (${updatedRow.percentage.toFixed(2)}%).`);
  }
  return {
    ok: true,
    editions: preview.editions,
    impact: preview.impact,
    updated: applied.updated,
    skippedDuplicates: applied.skippedDuplicates,
    skippedMissing: applied.skippedMissing,
    rarity,
    logs,
  };
}

function generateTraitSuggestions({ prompt, count = 8 }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('Prompt required');
  const max = Math.max(1, Math.min(50, Number(count) || 8));
  const words = cleanPrompt
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length > 2 && !/^(create|generate|traits?|with|for|the|and|this|collection|rare|postproduction)$/i.test(word));
  const seeds = words.length ? words : ['Neon', 'Glitch', 'Chrome', 'Aura', 'Signal', 'Pulse', 'Prism', 'Holo'];
  const suffixes = ['Glow', 'Aura', 'Overlay', 'Bloom', 'Signal', 'Trace', 'Halo', 'Stamp', 'Mist', 'Spark'];
  const suggestions = [];
  for (let i = 0; suggestions.length < max; i++) {
    const seed = seeds[i % seeds.length];
    const suffix = suffixes[Math.floor(i / seeds.length) % suffixes.length];
    const value = `${seed.charAt(0).toUpperCase()}${seed.slice(1)} ${suffix}`.replace(/\s+/g, ' ').trim();
    const traitType = /overlay|text|stamp/i.test(cleanPrompt) ? 'Overlay' : 'Postproduction';
    if (!suggestions.some(row => row.trait_type === traitType && row.value === value)) {
      suggestions.push({
        id: `${traitType}_${value}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''),
        trait_type: traitType,
        value,
        enabled: true,
      });
    }
  }
  return { ok: true, suggestions, provider: 'phase2-local-trait-chef' };
}

module.exports = {
  SUPPORTED_IMAGE_EXTS,
  EXTRA_TRAITS_FILE,
  imageContentTypeFromExt,
  parseNumericFile,
  ensurePhase2Dirs,
  scanOutputPairs,
  listPhase2Collection,
  syncFromOutput,
  refreshFromCurrentMain,
  deletePhase2Editions,
  deleteAllPhase2Output,
  reindexPhase2Files,
  shufflePhase2Files,
  manualReorderPhase2,
  readPhase2Metadata,
  readExtraTraits,
  writeExtraTraits,
  saveTraitAssetDataUrl,
  saveTraitAssetBuffer,
  savePhase2CompositedImage,
  findPhase2ImageByEdition,
  batchAddTraitToPhase2Json,
  batchDeleteTraitFromPhase2Json,
  updatePhase2PieceTrait,
  deletePhase2PieceTrait,
  applyExtraTraits,
  removeExtraTraitsFromEditions,
  deleteExtraTraitFromLibrary,
  analyzePhase2Rarity,
  previewTraitTarget,
  applyTargetedTrait,
  generateTraitSuggestions,
  hasPhase2WorkingCopy,
};

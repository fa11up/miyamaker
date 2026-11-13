'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function log(logs, level, message) {
  logs.push({ level, message });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNumericBasename(fileName) {
  return /^\d+$/.test(path.basename(String(fileName || ''), path.extname(String(fileName || ''))));
}

function parseNumericFile(fileName, allowedExts) {
  const ext = path.extname(fileName).toLowerCase();
  if (!allowedExts.includes(ext)) return null;
  const stem = path.basename(fileName, path.extname(fileName));
  if (!/^\d+$/.test(stem)) return null;
  const index = Number(stem);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return {
    index,
    stem,
    fileName,
    ext,
  };
}

function addToIndexMap(map, info, type, errors) {
  const previous = map.get(info.index);
  if (previous) {
    errors.push(`Duplicate numeric ${type} basename "${info.index}": ${previous.fileName} and ${info.fileName}`);
    return;
  }
  map.set(info.index, info);
}

async function scanOutputPairs({ imageDir, jsonDir, logs, warnings, errors }) {
  const imageFiles = await fsp.readdir(imageDir);
  const jsonFiles = await fsp.readdir(jsonDir);
  const imageByIndex = new Map();
  const jsonByIndex = new Map();
  const ignoredImages = [];
  const ignoredJson = [];

  for (const fileName of imageFiles) {
    const parsed = parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS);
    if (parsed) addToIndexMap(imageByIndex, parsed, 'image', errors);
    else if (!fileName.startsWith('.')) ignoredImages.push(fileName);
  }

  for (const fileName of jsonFiles) {
    const parsed = parseNumericFile(fileName, ['.json']);
    if (parsed) addToIndexMap(jsonByIndex, parsed, 'JSON', errors);
    else if (!fileName.startsWith('.')) ignoredJson.push(fileName);
  }

  const indexes = [...new Set([...imageByIndex.keys(), ...jsonByIndex.keys()])].sort((a, b) => a - b);
  const pairs = [];
  const incomplete = [];

  for (const oldIndex of indexes) {
    const image = imageByIndex.get(oldIndex) || null;
    const json = jsonByIndex.get(oldIndex) || null;
    if (image && json) {
      pairs.push({
        oldIndex,
        imageExt: image.ext,
        oldImageName: image.fileName,
        oldJsonName: json.fileName,
        imagePath: path.join(imageDir, image.fileName),
        jsonPath: path.join(jsonDir, json.fileName),
      });
      continue;
    }

    const warning = image
      ? `Skipped incomplete pair: ${image.fileName} has no matching ${oldIndex}.json`
      : `Skipped incomplete pair: ${json.fileName} has no matching image`;
    warnings.push(warning);
    log(logs, 'warning', warning);
    incomplete.push({ oldIndex, image, json, warning });
  }

  ignoredImages.forEach(fileName => log(logs, 'debug', `Ignored non-output image file: ${fileName}`));
  ignoredJson.forEach(fileName => log(logs, 'debug', `Ignored non-output JSON file: ${fileName}`));
  log(logs, 'info', `Found ${pairs.length} complete numeric output pair(s)`);

  return {
    imageFiles,
    jsonFiles,
    imageByIndex,
    jsonByIndex,
    pairs,
    incomplete,
    ignoredImages,
    ignoredJson,
  };
}

function buildReindexPlan({ imageDir, jsonDir, pairs, startIndex = 1 }) {
  const batchId = `.__reindex_tmp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const sortedPairs = [...pairs].sort((a, b) => a.oldIndex - b.oldIndex);
  const plannedPairs = sortedPairs.map((pair, offset) => {
    const newIndex = startIndex + offset;
    const finalImageName = `${newIndex}${pair.imageExt}`;
    const finalJsonName = `${newIndex}.json`;
    return {
      ...pair,
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
    operationName: 'Reindex',
    imageDir,
    jsonDir,
    startIndex,
    batchId,
    pairs: plannedPairs,
  };
}

function shuffledIndexes(count, startIndex = 1, random = Math.random) {
  const values = Array.from({ length: count }, (_, index) => startIndex + index);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  if (values.length > 1 && values.every((value, index) => value === startIndex + index)) {
    values.push(values.shift());
  }
  return values;
}

function normalizeAssignedIndexes(count, startIndex, assignedIndexes, random) {
  if (!assignedIndexes) return shuffledIndexes(count, startIndex, random);
  if (!Array.isArray(assignedIndexes) || assignedIndexes.length !== count) {
    throw new Error(`Shuffle test indexes must contain ${count} value(s)`);
  }
  const expected = new Set(Array.from({ length: count }, (_, index) => startIndex + index));
  const seen = new Set();
  assignedIndexes.forEach(value => {
    const index = Number(value);
    if (!Number.isSafeInteger(index) || !expected.has(index) || seen.has(index)) {
      throw new Error('Shuffle indexes must be a unique permutation of the final edition range');
    }
    seen.add(index);
  });
  return assignedIndexes.map(Number);
}

function buildShufflePlan({ imageDir, jsonDir, pairs, startIndex = 1, assignedIndexes = null, random = Math.random }) {
  const batchId = `.__shuffle_tmp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const sortedPairs = [...pairs].sort((a, b) => a.oldIndex - b.oldIndex);
  const newIndexes = normalizeAssignedIndexes(sortedPairs.length, startIndex, assignedIndexes, random);
  const plannedPairs = sortedPairs.map((pair, offset) => {
    const newIndex = newIndexes[offset];
    const finalImageName = `${newIndex}${pair.imageExt}`;
    const finalJsonName = `${newIndex}.json`;
    return {
      ...pair,
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
    operationName: 'Shuffle',
    imageDir,
    jsonDir,
    startIndex,
    batchId,
    pairs: plannedPairs,
  };
}

function pairIdentity(meta) {
  const copy = JSON.parse(JSON.stringify(meta));
  delete copy.image;
  delete copy.name;
  delete copy.edition;
  delete copy.tokenId;
  delete copy.token_id;
  delete copy.id;
  return JSON.stringify(copy);
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function preflightReindexPlan(plan, logs, warnings, errors) {
  const operationName = plan.operationName || 'Reindex';
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
    const checks = [
      ['image', pair.imagePath],
      ['JSON', pair.jsonPath],
    ];
    for (const [label, filePath] of checks) {
      if (!(await fileExists(filePath))) errors.push(`Missing ${label} before ${operationName.toLowerCase()}: ${path.basename(filePath)}`);
    }

    const targets = [
      ['image', pair.finalImagePath],
      ['JSON', pair.finalJsonPath],
    ];
    for (const [label, filePath] of targets) {
      const key = path.resolve(filePath).toLowerCase();
      if (finalPaths.has(key)) errors.push(`Duplicate final ${label} target: ${path.basename(filePath)}`);
      finalPaths.add(key);
      if ((await fileExists(filePath)) && !originalPaths.has(key)) {
        errors.push(`Final ${label} target would overwrite unrelated file: ${path.basename(filePath)}`);
      }
    }

    const temps = [
      ['image', pair.tempImagePath],
      ['JSON', pair.tempJsonPath],
    ];
    for (const [label, filePath] of temps) {
      const key = path.resolve(filePath).toLowerCase();
      if (tempPaths.has(key)) errors.push(`Duplicate temporary ${label} target: ${path.basename(filePath)}`);
      tempPaths.add(key);
      if (await fileExists(filePath)) errors.push(`Temporary ${label} file already exists: ${path.basename(filePath)}`);
    }

    try {
      pair.originalJsonText = await fsp.readFile(pair.jsonPath, 'utf8');
      pair.originalJson = JSON.parse(pair.originalJsonText);
      pair.identityBefore = pairIdentity(pair.originalJson);
    } catch (e) {
      errors.push(`Invalid JSON metadata in ${pair.oldJsonName}: ${e.message}`);
    }
  }

  errors.forEach(message => log(logs, 'error', message));
  if (!errors.length) log(logs, 'info', `${operationName} preflight validation passed`);
  return errors.length === 0;
}

async function renameWithRollback(operations, logs, phaseLabel) {
  const completed = [];
  try {
    for (const op of operations) {
      await fsp.rename(op.from, op.to);
      completed.push(op);
      log(logs, 'debug', `${phaseLabel}: ${path.basename(op.from)} -> ${path.basename(op.to)}`);
    }
  } catch (e) {
    log(logs, 'error', `${phaseLabel} failed at ${path.basename(operations[completed.length]?.from || '')}: ${e.message}`);
    for (const op of completed.reverse()) {
      await fsp.rename(op.to, op.from).catch(rollbackError => {
        log(logs, 'error', `Rollback failed for ${path.basename(op.to)}: ${rollbackError.message}`);
      });
    }
    throw e;
  }
}

function phaseOneOperations(plan) {
  return plan.pairs.flatMap(pair => [
    { from: pair.imagePath, to: pair.tempImagePath },
    { from: pair.jsonPath, to: pair.tempJsonPath },
  ]);
}

function phaseTwoOperations(plan) {
  return plan.pairs.flatMap(pair => [
    { from: pair.tempImagePath, to: pair.finalImagePath },
    { from: pair.tempJsonPath, to: pair.finalJsonPath },
  ]);
}

async function rollbackMovesWithTemps(moves, batchId, logs, label) {
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

async function rollbackTemporaryToOriginal(plan, logs) {
  const batchId = `.__rollback_tmp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const moves = plan.pairs.flatMap(pair => [
    { from: pair.tempJsonPath, to: pair.jsonPath },
    { from: pair.tempImagePath, to: pair.imagePath },
  ]);
  await rollbackMovesWithTemps(moves, batchId, logs, plan.operationName || 'Output');
}

async function rollbackFinalToOriginal(plan, logs) {
  const batchId = `.__rollback_final_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const moves = plan.pairs.flatMap(pair => [
    { from: pair.finalJsonPath, to: pair.jsonPath },
    { from: pair.finalImagePath, to: pair.imagePath },
  ]);
  await rollbackMovesWithTemps(moves, batchId, logs, plan.operationName || 'Output');

  for (const pair of plan.pairs) {
    if (pair.originalJsonText !== undefined) {
      await fsp.writeFile(pair.jsonPath, pair.originalJsonText, 'utf8').catch(e => {
        log(logs, 'error', `Could not restore original JSON ${pair.oldJsonName}: ${e.message}`);
      });
    }
  }
}

function replaceImageReference(value, pair) {
  if (typeof value !== 'string') return value;
  const oldName = escapeRegExp(pair.oldImageName);
  const newName = pair.finalImageName;
  if (value === pair.oldImageName) return newName;
  const replacedOldName = value.replace(new RegExp(`(^|[/\\\\])${oldName}(?=($|[?#]))`, 'g'), `$1${newName}`);
  if (replacedOldName !== value) return replacedOldName;

  const match = value.match(/^(.*[/\\\\])?([^/\\\\?#]+)([?#].*)?$/);
  if (!match) return value;
  const prefix = match[1] || '';
  const fileName = match[2] || '';
  const suffix = match[3] || '';
  if (!parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS)) return value;
  return `${prefix}${newName}${suffix}`;
}

function replaceNameIndex(value, pair) {
  if (typeof value !== 'string') return value;
  const oldIndex = escapeRegExp(String(pair.oldIndex));
  const newIndex = String(pair.newIndex);
  if (value.trim() === String(pair.oldIndex)) return newIndex;
  return value
    .replace(new RegExp(`(#\\s*)${oldIndex}(?!\\d)`, 'g'), `$1${newIndex}`)
    .replace(new RegExp(`\\b((?:No\\.?|Edition|Token)\\s*#?\\s*)${oldIndex}\\b`, 'gi'), (_match, prefix) => `${prefix}${newIndex}`);
}

function updateIndexField(value, newIndex) {
  if (typeof value === 'number' && Number.isFinite(value)) return newIndex;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return String(newIndex);
  return value;
}

function updateSafeMetadataFields(meta, pair) {
  const out = { ...meta };
  ['edition', 'tokenId', 'token_id', 'id'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = updateIndexField(out[key], pair.newIndex);
    }
  });
  if (Object.prototype.hasOwnProperty.call(out, 'image')) out.image = replaceImageReference(out.image, pair);
  if (Object.prototype.hasOwnProperty.call(out, 'name')) out.name = replaceNameIndex(out.name, pair);
  return out;
}

async function updatePlanMetadata(plan, logs) {
  let metadataUpdated = 0;
  try {
    for (const pair of plan.pairs) {
      const raw = await fsp.readFile(pair.finalJsonPath, 'utf8');
      const meta = JSON.parse(raw);
      const updated = updateSafeMetadataFields(meta, pair);
      await fsp.writeFile(pair.finalJsonPath, JSON.stringify(updated, null, 2), 'utf8');
      metadataUpdated++;
      log(logs, 'success', `Metadata updated: ${pair.finalJsonName}`);
    }
    return metadataUpdated;
  } catch (e) {
    log(logs, 'error', `Metadata update failed: ${e.message}`);
    await rollbackFinalToOriginal(plan, logs);
    throw e;
  }
}

function imageFileNameFromReference(value) {
  if (typeof value !== 'string') return null;
  const clean = value.split(/[?#]/)[0];
  const base = path.basename(clean);
  return parseNumericFile(base, SUPPORTED_IMAGE_EXTS) ? base : null;
}

async function validateReindex(plan, scanBefore, logs, warnings, errors) {
  const operationName = plan.operationName || 'Reindex';
  const imageFiles = await fsp.readdir(plan.imageDir);
  const jsonFiles = await fsp.readdir(plan.jsonDir);
  const imageByIndex = new Map();
  const jsonByIndex = new Map();

  for (const fileName of imageFiles) {
    const parsed = parseNumericFile(fileName, SUPPORTED_IMAGE_EXTS);
    if (parsed) addToIndexMap(imageByIndex, parsed, 'final image', errors);
  }
  for (const fileName of jsonFiles) {
    const parsed = parseNumericFile(fileName, ['.json']);
    if (parsed) addToIndexMap(jsonByIndex, parsed, 'final JSON', errors);
  }

  for (const incomplete of scanBefore.incomplete) {
    const name = incomplete.image?.fileName || incomplete.json?.fileName;
    const dir = incomplete.image ? plan.imageDir : plan.jsonDir;
    if (!(await fileExists(path.join(dir, name)))) {
      errors.push(`Incomplete file was touched unexpectedly: ${name}`);
    }
  }

  const validAfter = [...imageByIndex.keys()].filter(index => jsonByIndex.has(index)).length;
  if (validAfter !== plan.pairs.length) {
    errors.push(`Valid pair count changed: before ${plan.pairs.length}, after ${validAfter}`);
  }

  const pairByNewIndex = new Map();
  for (const pair of plan.pairs) {
    if (pairByNewIndex.has(pair.newIndex)) {
      errors.push(`Duplicate planned final index: ${pair.newIndex}`);
    }
    pairByNewIndex.set(pair.newIndex, pair);
  }

  for (let offset = 0; offset < plan.pairs.length; offset++) {
    const expectedIndex = plan.startIndex + offset;
    const pair = pairByNewIndex.get(expectedIndex);
    if (!pair) {
      errors.push(`Missing planned final pair for index ${expectedIndex}`);
      continue;
    }
    const finalImage = imageByIndex.get(expectedIndex);
    const finalJson = jsonByIndex.get(expectedIndex);
    if (!finalImage) errors.push(`Missing final image for index ${expectedIndex}`);
    if (!finalJson) errors.push(`Missing final JSON for index ${expectedIndex}`);
    if (finalImage && finalImage.fileName !== pair.finalImageName) {
      errors.push(`Final image extension changed unexpectedly for ${expectedIndex}: expected ${pair.finalImageName}, found ${finalImage.fileName}`);
    }
    if (!finalJson) continue;

    let meta;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(plan.jsonDir, finalJson.fileName), 'utf8'));
    } catch (e) {
      errors.push(`Final JSON is invalid: ${finalJson.fileName}: ${e.message}`);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(meta, 'image')) {
      const imageFile = imageFileNameFromReference(meta.image);
      if (imageFile && imageFile !== pair.finalImageName) {
        errors.push(`${finalJson.fileName} image field points to ${imageFile} instead of ${pair.finalImageName}`);
      }
    }

    if (pairIdentity(meta) !== pair.identityBefore) {
      errors.push(`Pair identity changed for ${finalJson.fileName}; traits or unrelated metadata were modified`);
    }
  }

  const expectedIndexes = new Set(plan.pairs.map(pair => pair.newIndex));
  for (const index of imageByIndex.keys()) {
    if (!jsonByIndex.has(index)) warnings.push(`Final validation warning: ${imageByIndex.get(index).fileName} has no matching JSON`);
    if (index >= plan.startIndex && index < plan.startIndex + plan.pairs.length && !expectedIndexes.has(index)) {
      errors.push(`Unexpected numeric image index inside reindexed range: ${index}`);
    }
  }
  for (const index of jsonByIndex.keys()) {
    if (!imageByIndex.has(index)) warnings.push(`Final validation warning: ${jsonByIndex.get(index).fileName} has no matching image`);
  }

  errors.forEach(message => log(logs, 'error', message));
  warnings.slice(-20).forEach(message => {
    if (/Final validation warning/.test(message)) log(logs, 'warning', message);
  });
  if (!errors.length) log(logs, 'success', `${operationName} final validation passed`);

  return { ok: errors.length === 0, errors, warnings };
}

function failureResult(message, logs, warnings, errors, extra = {}) {
  if (!errors.includes(message)) errors.push(message);
  log(logs, 'error', message);
  return { ok: false, error: message, warnings, errors, logs, ...extra };
}

function detailedValidationFailure(operationName, validationErrors) {
  const details = validationErrors.slice(0, 5).join('; ');
  const more = validationErrors.length > 5 ? `; +${validationErrors.length - 5} more` : '';
  return details
    ? `${operationName} failed final validation: ${details}${more}. Original filenames were restored where possible.`
    : `${operationName} failed final validation. Original filenames were restored where possible.`;
}

async function reindexOutputFiles({ buildDir, imageDir, jsonDir, startIndex = 1 } = {}) {
  const logs = [];
  const warnings = [];
  const errors = [];
  const renames = [];

  try {
    if (!buildDir && (!imageDir || !jsonDir)) {
      return failureResult('Cannot reindex: buildDir or imageDir/jsonDir is required', logs, warnings, errors);
    }

    const resolvedImageDir = imageDir || path.join(buildDir, 'images');
    const resolvedJsonDir = jsonDir || path.join(buildDir, 'json');
    const cleanStartIndex = Number.isSafeInteger(Number(startIndex)) ? Number(startIndex) : 1;

    log(logs, 'info', 'Reindex Output started');
    log(logs, 'info', `Scanning output folders from start index ${cleanStartIndex}`);

    await fsp.access(resolvedImageDir, fs.constants.R_OK | fs.constants.W_OK);
    await fsp.access(resolvedJsonDir, fs.constants.R_OK | fs.constants.W_OK);

    const scan = await scanOutputPairs({
      imageDir: resolvedImageDir,
      jsonDir: resolvedJsonDir,
      logs,
      warnings,
      errors,
    });

    if (errors.length) {
      return failureResult('Reindex failed validation before rename. Operation aborted.', logs, warnings, errors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
      });
    }

    if (!scan.pairs.length) {
      warnings.push('No complete numeric output pairs found; nothing to reindex.');
      log(logs, 'warning', 'No complete numeric output pairs found; nothing to reindex.');
      return {
        ok: true,
        imagesFound: 0,
        pairsProcessed: 0,
        imagesRenamed: 0,
        metadataRenamed: 0,
        metadataUpdated: 0,
        cleanupRenamed: 0,
        cleanupImageRenamed: 0,
        cleanupMetadataRenamed: 0,
        cleanupMetadataUpdated: 0,
        cleanupRenames: [],
        warnings,
        errors,
        renames,
        logs,
      };
    }

    const plan = buildReindexPlan({
      imageDir: resolvedImageDir,
      jsonDir: resolvedJsonDir,
      pairs: scan.pairs,
      startIndex: cleanStartIndex,
    });

    for (const pair of plan.pairs) {
      log(logs, 'info', `Reindex mapping: ${pair.oldImageName} + ${pair.oldJsonName} -> ${pair.finalImageName} + ${pair.finalJsonName}`);
    }

    const preflightOk = await preflightReindexPlan(plan, logs, warnings, errors);
    if (!preflightOk) {
      return failureResult('Reindex failed validation before rename. Operation aborted.', logs, warnings, errors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
      });
    }

    await renameWithRollback(phaseOneOperations(plan), logs, 'Reindex phase 1');
    try {
      await renameWithRollback(phaseTwoOperations(plan), logs, 'Reindex phase 2');
    } catch (e) {
      await rollbackTemporaryToOriginal(plan, logs);
      throw e;
    }
    const metadataUpdated = await updatePlanMetadata(plan, logs);

    for (const pair of plan.pairs) {
      if (pair.oldImageName !== pair.finalImageName) renames.push(`${pair.oldImageName} -> ${pair.finalImageName}`);
      if (pair.oldJsonName !== pair.finalJsonName) renames.push(`${pair.oldJsonName} -> ${pair.finalJsonName}`);
    }

    const validationErrors = [];
    const validation = await validateReindex(plan, scan, logs, warnings, validationErrors);
    if (!validation.ok) {
      await rollbackFinalToOriginal(plan, logs);
      return failureResult(detailedValidationFailure('Reindex', validationErrors), logs, warnings, validationErrors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
        pairsProcessed: plan.pairs.length,
        renames,
      });
    }

    const imagesRenamed = plan.pairs.filter(pair => pair.oldImageName !== pair.finalImageName).length;
    const metadataRenamed = plan.pairs.filter(pair => pair.oldJsonName !== pair.finalJsonName).length;
    const summary = warnings.length
      ? `Reindex completed with warnings: ${plan.pairs.length} pair(s) reindexed, ${scan.incomplete.length} incomplete skipped.`
      : `Reindex completed successfully: ${plan.pairs.length} pair(s) reindexed.`;
    log(logs, warnings.length ? 'warning' : 'success', summary);

    return {
      ok: true,
      imagesFound: scan.imageByIndex.size,
      metadataFound: scan.jsonByIndex.size,
      pairsProcessed: plan.pairs.length,
      incompleteSkipped: scan.incomplete.length,
      imagesRenamed,
      metadataRenamed,
      metadataUpdated,
      cleanupRenamed: 0,
      cleanupImageRenamed: 0,
      cleanupMetadataRenamed: 0,
      cleanupMetadataUpdated: 0,
      cleanupRenames: [],
      warnings,
      errors,
      renames,
      mappings: plan.pairs.map(pair => ({
        oldIndex: pair.oldIndex,
        newIndex: pair.newIndex,
        oldImageName: pair.oldImageName,
        oldJsonName: pair.oldJsonName,
        finalImageName: pair.finalImageName,
        finalJsonName: pair.finalJsonName,
      })),
      validation,
      logs,
    };
  } catch (e) {
    return failureResult(`Reindex failed: ${e.message}`, logs, warnings, errors);
  }
}

async function shuffleOutputFiles({ buildDir, imageDir, jsonDir, startIndex = 1, assignedIndexes = null, random = Math.random } = {}) {
  const logs = [];
  const warnings = [];
  const errors = [];
  const renames = [];

  try {
    if (!buildDir && (!imageDir || !jsonDir)) {
      return failureResult('Cannot shuffle: buildDir or imageDir/jsonDir is required', logs, warnings, errors);
    }

    const resolvedImageDir = imageDir || path.join(buildDir, 'images');
    const resolvedJsonDir = jsonDir || path.join(buildDir, 'json');
    const cleanStartIndex = Number.isSafeInteger(Number(startIndex)) ? Number(startIndex) : 1;

    log(logs, 'info', 'Shuffle Output Order started');
    log(logs, 'info', `Scanning numeric output pairs from start index ${cleanStartIndex}`);

    await fsp.access(resolvedImageDir, fs.constants.R_OK | fs.constants.W_OK);
    await fsp.access(resolvedJsonDir, fs.constants.R_OK | fs.constants.W_OK);

    const scan = await scanOutputPairs({
      imageDir: resolvedImageDir,
      jsonDir: resolvedJsonDir,
      logs,
      warnings,
      errors,
    });

    if (errors.length) {
      return failureResult('Shuffle failed validation before rename. Operation aborted.', logs, warnings, errors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
      });
    }

    if (!scan.pairs.length) {
      warnings.push('No complete numeric output pairs found; nothing to shuffle.');
      log(logs, 'warning', 'No complete numeric output pairs found; nothing to shuffle.');
      return {
        ok: true,
        imagesFound: 0,
        metadataFound: scan.jsonByIndex.size,
        pairsProcessed: 0,
        imagesRenamed: 0,
        metadataRenamed: 0,
        jsonRenamed: 0,
        metadataUpdated: 0,
        warnings,
        errors,
        renames,
        logs,
      };
    }

    const plan = buildShufflePlan({
      imageDir: resolvedImageDir,
      jsonDir: resolvedJsonDir,
      pairs: scan.pairs,
      startIndex: cleanStartIndex,
      assignedIndexes,
      random,
    });

    for (const pair of plan.pairs) {
      log(logs, 'info', `Shuffle mapping: ${pair.oldImageName} + ${pair.oldJsonName} -> ${pair.finalImageName} + ${pair.finalJsonName}`);
    }

    const preflightOk = await preflightReindexPlan(plan, logs, warnings, errors);
    if (!preflightOk) {
      return failureResult('Shuffle failed validation before rename. Operation aborted.', logs, warnings, errors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
      });
    }

    await renameWithRollback(phaseOneOperations(plan), logs, 'Shuffle phase 1');
    try {
      await renameWithRollback(phaseTwoOperations(plan), logs, 'Shuffle phase 2');
    } catch (e) {
      await rollbackTemporaryToOriginal(plan, logs);
      throw e;
    }
    const metadataUpdated = await updatePlanMetadata(plan, logs);

    for (const pair of plan.pairs) {
      if (pair.oldImageName !== pair.finalImageName) renames.push(`${pair.oldImageName} -> ${pair.finalImageName}`);
      if (pair.oldJsonName !== pair.finalJsonName) renames.push(`${pair.oldJsonName} -> ${pair.finalJsonName}`);
    }

    const validationErrors = [];
    const validation = await validateReindex(plan, scan, logs, warnings, validationErrors);
    if (!validation.ok) {
      await rollbackFinalToOriginal(plan, logs);
      return failureResult(detailedValidationFailure('Shuffle', validationErrors), logs, warnings, validationErrors, {
        imagesFound: scan.imageByIndex.size,
        metadataFound: scan.jsonByIndex.size,
        pairsProcessed: plan.pairs.length,
        renames,
      });
    }

    const imagesRenamed = plan.pairs.filter(pair => pair.oldImageName !== pair.finalImageName).length;
    const metadataRenamed = plan.pairs.filter(pair => pair.oldJsonName !== pair.finalJsonName).length;
    const summary = warnings.length
      ? `Shuffle completed with warnings: ${plan.pairs.length} pair(s) shuffled, ${scan.incomplete.length} incomplete skipped.`
      : `Shuffle completed successfully: ${plan.pairs.length} pair(s) shuffled.`;
    log(logs, warnings.length ? 'warning' : 'success', summary);

    return {
      ok: true,
      imagesFound: scan.imageByIndex.size,
      metadataFound: scan.jsonByIndex.size,
      pairsProcessed: plan.pairs.length,
      incompleteSkipped: scan.incomplete.length,
      imagesRenamed,
      metadataRenamed,
      jsonRenamed: metadataRenamed,
      metadataUpdated,
      warnings,
      errors,
      renames,
      mappings: plan.pairs.map(pair => ({
        oldIndex: pair.oldIndex,
        newIndex: pair.newIndex,
        oldImageName: pair.oldImageName,
        oldJsonName: pair.oldJsonName,
        finalImageName: pair.finalImageName,
        finalJsonName: pair.finalJsonName,
      })),
      validation,
      logs,
    };
  } catch (e) {
    return failureResult(`Shuffle failed: ${e.message}`, logs, warnings, errors);
  }
}

module.exports = {
  SUPPORTED_IMAGE_EXTS,
  isNumericBasename,
  parseNumericFile,
  scanOutputPairs,
  buildReindexPlan,
  buildShufflePlan,
  preflightReindexPlan,
  updateSafeMetadataFields,
  validateReindex,
  reindexOutputFiles,
  shuffleOutputFiles,
};

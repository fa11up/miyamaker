'use strict';

const fsp = require('fs').promises;
const path = require('path');

const IMAGE_RE = /\.(png|jpg|jpeg|webp|gif)$/i;

function numericStem(fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  if (!/^\d+$/.test(stem)) return null;
  const n = Number(stem);
  return Number.isSafeInteger(n) ? n : null;
}

function normalizeSettings(settings = {}) {
  return {
    namePrefix: String(settings.namePrefix ?? '').trim() || 'NFT',
    description: String(settings.description ?? ''),
    externalUrl: String(settings.externalUrl ?? ''),
    imageBaseUri: String(settings.imageBaseUri ?? settings.baseUri ?? '').trim(),
    fallbackExt: String(settings.fallbackExt || '.png').replace(/^\./, '').toLowerCase() || 'png',
  };
}

function joinImageUri(baseUri, fileName) {
  const base = String(baseUri || '').trim();
  if (!base) return fileName;
  return base.endsWith('/') ? base + fileName : base + '/' + fileName;
}

function buildImageUri(edition, ext, settings) {
  const cleanExt = String(ext || settings.fallbackExt || 'png').replace(/^\./, '').toLowerCase() || 'png';
  return joinImageUri(settings.imageBaseUri, `${edition}.${cleanExt}`);
}

function extractAttributes(meta) {
  if (Array.isArray(meta?.attributes)) return meta.attributes;
  if (Array.isArray(meta?.properties?.attributes)) return meta.properties.attributes;
  return [];
}

function hasAttributeArray(meta) {
  return Array.isArray(meta?.attributes) || Array.isArray(meta?.properties?.attributes);
}

function buildOekakiMetadata(meta, edition, imageExt, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  return {
    name: `${settings.namePrefix} #${edition}`,
    description: settings.description,
    external_url: settings.externalUrl,
    image: buildImageUri(edition, imageExt, settings),
    attributes: extractAttributes(meta),
  };
}

async function readImageExtsFromDir(imageDir) {
  const files = await fsp.readdir(imageDir).catch(() => []);
  const byEdition = new Map();
  files.forEach(file => {
    if (!IMAGE_RE.test(file)) return;
    const n = numericStem(file);
    if (n === null || byEdition.has(n)) return;
    byEdition.set(n, path.extname(file).toLowerCase());
  });
  return byEdition;
}

async function readImageExts(buildDir) {
  return readImageExtsFromDir(path.join(buildDir, 'images'));
}

function imageExtFromMetadata(meta, fallbackExt) {
  const match = String(meta?.image || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match && IMAGE_RE.test('.' + match[1]) ? '.' + match[1].toLowerCase() : fallbackExt;
}

async function writeJsonSafely(filePath, data) {
  const tmp = `${filePath}.__schema_tmp_${process.pid}_${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

async function countBuildMetadata({ buildDir }) {
  const jsonDir = path.join(buildDir, 'json');
  const files = (await fsp.readdir(jsonDir).catch(() => []))
    .filter(file => /\.json$/i.test(file) && numericStem(file) !== null);
  return { ok: true, count: files.length };
}

async function countGeneralMetadataTargets({ buildDir, phase2Dir }) {
  const output = await countBuildMetadata({ buildDir });
  const phase2JsonDir = phase2Dir ? path.join(phase2Dir, 'json') : '';
  const phase2Files = phase2JsonDir
    ? (await fsp.readdir(phase2JsonDir).catch(() => []))
      .filter(file => /\.json$/i.test(file) && numericStem(file) !== null)
    : [];
  return {
    ok: true,
    count: output.count + phase2Files.length,
    outputCount: output.count,
    phase2Count: phase2Files.length,
    phase2MissingOrEmpty: phase2Files.length === 0,
  };
}

async function restructureMetadataTarget({ label, displayJsonDir, jsonDir, imageDir, backupParentDir, backupName, settings, stamp }) {
  const files = (await fsp.readdir(jsonDir).catch(() => []))
    .filter(file => /\.json$/i.test(file) && numericStem(file) !== null)
    .sort((a, b) => numericStem(a) - numericStem(b));
  const normalized = normalizeSettings(settings);
  const imageExts = await readImageExtsFromDir(imageDir);
  const backupDir = path.join(backupParentDir, backupName.replace('{stamp}', stamp));
  const warnings = [];
  const logs = [
    { level: 'info', message: `Found ${files.length} ${label} JSON file(s) in ${displayJsonDir}.` },
  ];
  let updated = 0;
  let skipped = 0;
  let noAttributes = 0;

  if (files.length) {
    await fsp.mkdir(backupDir, { recursive: true });
    logs.push({ level: 'info', message: `Backup created: ${path.relative(path.dirname(backupParentDir), backupDir).replace(/\\/g, '/')}` });
  }

  for (const file of files) {
    const edition = numericStem(file);
    const full = path.join(jsonDir, file);
    try {
      await fsp.copyFile(full, path.join(backupDir, file));
      const meta = JSON.parse(await fsp.readFile(full, 'utf8'));
      const attrs = extractAttributes(meta);
      if (!hasAttributeArray(meta)) {
        noAttributes++;
        warnings.push(`${label} ${file}: no attributes array found; wrote attributes: []`);
      }
      const ext = imageExts.get(edition) || imageExtFromMetadata(meta, '.' + normalized.fallbackExt);
      const next = buildOekakiMetadata(meta, edition, ext, normalized);
      await writeJsonSafely(full, next);
      updated++;
    } catch (e) {
      skipped++;
      warnings.push(`${label} ${file}: ${e.message}`);
    }
  }

  logs.push({ level: warnings.length ? 'warning' : 'success', message: `Updated ${updated} ${label} JSON file(s) to Oekaki-style schema. Attributes preserved.` });
  if (skipped) logs.push({ level: 'warning', message: `Skipped ${skipped} ${label} JSON file(s).` });
  if (noAttributes) logs.push({ level: 'warning', message: `${noAttributes} ${label} JSON file(s) had no attributes array.` });

  return {
    ok: skipped === 0,
    label,
    found: files.length,
    updated,
    skipped,
    warnings,
    logs,
    backupDir: files.length ? path.relative(path.dirname(backupParentDir), backupDir).replace(/\\/g, '/') : '',
    noAttributes,
  };
}

async function restructureBuildMetadata({ buildDir, settings }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logs = [
    { level: 'info', message: 'General Metadata schema refresh started.' },
  ];
  const target = await restructureMetadataTarget({
    label: 'Output',
    displayJsonDir: 'build/json',
    jsonDir: path.join(buildDir, 'json'),
    imageDir: path.join(buildDir, 'images'),
    backupParentDir: buildDir,
    backupName: 'json_backup_before_schema_refresh_{stamp}',
    settings,
    stamp,
  });
  logs.push(...target.logs);

  return {
    ok: target.ok,
    found: target.found,
    updated: target.updated,
    skipped: target.skipped,
    warnings: target.warnings,
    logs,
    backupDir: target.backupDir,
    targets: { output: target },
  };
}

async function restructureGeneralMetadataTargets({ buildDir, phase2Dir, settings }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = await restructureMetadataTarget({
    label: 'Output',
    displayJsonDir: 'build/json',
    jsonDir: path.join(buildDir, 'json'),
    imageDir: path.join(buildDir, 'images'),
    backupParentDir: buildDir,
    backupName: 'json_backup_before_metadata_refresh_{stamp}',
    settings,
    stamp,
  });
  const phase2 = await restructureMetadataTarget({
    label: 'Phase 2',
    displayJsonDir: 'buildphase2/json',
    jsonDir: path.join(phase2Dir, 'json'),
    imageDir: path.join(phase2Dir, 'images'),
    backupParentDir: phase2Dir,
    backupName: 'json_backup_before_metadata_refresh_{stamp}',
    settings,
    stamp,
  });
  const warnings = [...output.warnings, ...phase2.warnings];
  const skipped = output.skipped + phase2.skipped;
  const updated = output.updated + phase2.updated;
  const found = output.found + phase2.found;
  const logs = [
    { level: 'info', message: 'General Metadata refresh started.' },
    ...output.logs,
    ...(phase2.found ? phase2.logs : [{ level: 'warning', message: 'Phase 2 metadata folder not found or empty. Only main Output metadata will be refreshed.' }]),
    {
      level: skipped ? 'warning' : 'success',
      message: `Updated ${output.updated} Output JSON file(s) and ${phase2.updated} Phase 2 JSON file(s). Attributes preserved.`,
    },
  ];

  if (phase2.updated) {
    logs.push({ level: 'success', message: 'Phase 2 extra traits preserved in attributes.' });
  }

  return {
    ok: skipped === 0,
    found,
    updated,
    skipped,
    warnings,
    logs,
    outputFound: output.found,
    phase2Found: phase2.found,
    outputUpdated: output.updated,
    phase2Updated: phase2.updated,
    outputSkipped: output.skipped,
    phase2Skipped: phase2.skipped,
    phase2MissingOrEmpty: phase2.found === 0,
    backupDir: output.backupDir,
    phase2BackupDir: phase2.backupDir,
    targets: { output, phase2 },
  };
}

module.exports = {
  buildImageUri,
  buildOekakiMetadata,
  countGeneralMetadataTargets,
  countBuildMetadata,
  extractAttributes,
  joinImageUri,
  normalizeSettings,
  restructureBuildMetadata,
  restructureGeneralMetadataTargets,
};

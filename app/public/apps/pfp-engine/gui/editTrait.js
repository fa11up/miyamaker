'use strict';

const fsp = require('fs').promises;
const path = require('path');

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Blocked unsafe Edit Trait operation: target path is outside edittrait.');
  }
  return target;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match || !match[2]) throw new Error('Expected a base64 data URL');
  return {
    mime: match[1] || 'application/octet-stream',
    data: Buffer.from(match[3], 'base64'),
  };
}

async function ensureEditTraitDirs(editTraitDir) {
  const root = assertInside(path.dirname(editTraitDir), editTraitDir);
  const configsDir = assertInside(root, path.join(root, 'configs'));
  const previewsDir = assertInside(root, path.join(root, 'previews'));
  await fsp.mkdir(configsDir, { recursive: true });
  await fsp.mkdir(previewsDir, { recursive: true });
  return { root, configsDir, previewsDir };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeSetup(setup) {
  const cleanTransform = source => ({
    x: Number(source?.x) || 0,
    y: Number(source?.y) || 0,
    scale: Number.isFinite(Number(source?.scale)) ? Number(source.scale) : 1,
    rotation: Number(source?.rotation) || 0,
    opacity: Number.isFinite(Number(source?.opacity)) ? Number(source.opacity) : 1,
    visible: source?.visible !== false,
  });
  const normalizeOne = item => ({
    layerName: String(item?.layerName || ''),
    traitName: String(item?.traitName || ''),
    sourcePath: String(item?.sourcePath || ''),
    transform: cleanTransform(item?.transform),
  });
  if (Array.isArray(setup?.items)) return { version: 1, savedAt: new Date().toISOString(), items: setup.items.map(normalizeOne).filter(i => i.layerName && i.sourcePath) };
  return { version: 1, savedAt: new Date().toISOString(), item: normalizeOne(setup) };
}

async function saveEditTraitConfig({ editTraitDir, setup, scope }) {
  const dirs = await ensureEditTraitDirs(editTraitDir);
  const prefix = scope === 'all' ? 'edittrait_all' : 'edittrait_selected';
  const fileName = `${prefix}_${stamp()}.json`;
  const full = assertInside(dirs.root, path.join(dirs.configsDir, fileName));
  const clean = sanitizeSetup(setup || {});
  await fsp.writeFile(full, JSON.stringify(clean, null, 2), 'utf8');
  return {
    ok: true,
    fileName,
    path: path.relative(path.dirname(dirs.root), full).replace(/\\/g, '/'),
  };
}

async function saveEditTraitPreview({ editTraitDir, imageDataUrl }) {
  const dirs = await ensureEditTraitDirs(editTraitDir);
  const parsed = parseDataUrl(imageDataUrl);
  if (!/^image\/png$/i.test(parsed.mime)) throw new Error('Edit Trait previews must be PNG data URLs');
  const fileName = `edittrait_preview_${stamp()}.png`;
  const full = assertInside(dirs.root, path.join(dirs.previewsDir, fileName));
  await fsp.writeFile(full, parsed.data);
  return {
    ok: true,
    fileName,
    path: path.relative(path.dirname(dirs.root), full).replace(/\\/g, '/'),
  };
}

module.exports = {
  assertInside,
  ensureEditTraitDirs,
  saveEditTraitConfig,
  saveEditTraitPreview,
};

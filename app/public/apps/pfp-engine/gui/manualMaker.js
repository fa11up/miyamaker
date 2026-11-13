'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const MANUAL_IMAGE_RE = /^manual_(\d{3,})\.png$/i;
const MEME_IMAGE_RE = /^meme_(\d{3,})\.png$/i;

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Blocked unsafe Manual Maker operation: target path is outside manualmaker.');
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

async function ensureManualMakerDirs(manualMakerDir) {
  const root = assertInside(path.dirname(manualMakerDir), manualMakerDir);
  const imagesDir = assertInside(root, path.join(root, 'images'));
  const jsonDir = assertInside(root, path.join(root, 'json'));
  const memesDir = assertInside(root, path.join(root, 'memes'));
  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.mkdir(jsonDir, { recursive: true });
  await fsp.mkdir(memesDir, { recursive: true });
  return { root, imagesDir, jsonDir, memesDir };
}

async function nextNumberedName(dir, prefix, re) {
  const files = await fsp.readdir(dir).catch(() => []);
  const used = new Set();
  files.forEach(file => {
    const match = file.match(re);
    if (match) used.add(Number(match[1]));
  });
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}_${String(n).padStart(3, '0')}.png`;
}

function sanitizeMetadata(metadata, imageName) {
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    name: String(meta.name || 'Manual Maker #1'),
    description: String(meta.description || ''),
    external_url: String(meta.external_url || ''),
    image: imageName,
    attributes: Array.isArray(meta.attributes) ? meta.attributes : [],
  };
}

async function saveManualMakerOutput({ manualMakerDir, imageDataUrl, metadata }) {
  const dirs = await ensureManualMakerDirs(manualMakerDir);
  const parsed = parseDataUrl(imageDataUrl);
  if (!/^image\/png$/i.test(parsed.mime)) throw new Error('Manual Maker exports must be PNG data URLs');
  const imageName = await nextNumberedName(dirs.imagesDir, 'manual', MANUAL_IMAGE_RE);
  const jsonName = imageName.replace(/\.png$/i, '.json');
  const imagePath = assertInside(dirs.root, path.join(dirs.imagesDir, imageName));
  const jsonPath = assertInside(dirs.root, path.join(dirs.jsonDir, jsonName));
  const finalMeta = sanitizeMetadata(metadata, imageName);
  await fsp.writeFile(imagePath, parsed.data);
  await fsp.writeFile(jsonPath, JSON.stringify(finalMeta, null, 2), 'utf8');
  return {
    ok: true,
    imageName,
    jsonName,
    image: path.relative(path.dirname(dirs.root), imagePath).replace(/\\/g, '/'),
    json: path.relative(path.dirname(dirs.root), jsonPath).replace(/\\/g, '/'),
  };
}

async function saveManualMakerMeme({ manualMakerDir, imageDataUrl }) {
  const dirs = await ensureManualMakerDirs(manualMakerDir);
  const parsed = parseDataUrl(imageDataUrl);
  if (!/^image\/png$/i.test(parsed.mime)) throw new Error('Manual Maker meme exports must be PNG data URLs');
  const imageName = await nextNumberedName(dirs.memesDir, 'meme', MEME_IMAGE_RE);
  const imagePath = assertInside(dirs.root, path.join(dirs.memesDir, imageName));
  await fsp.writeFile(imagePath, parsed.data);
  return {
    ok: true,
    imageName,
    image: path.relative(path.dirname(dirs.root), imagePath).replace(/\\/g, '/'),
  };
}

module.exports = {
  assertInside,
  ensureManualMakerDirs,
  saveManualMakerOutput,
  saveManualMakerMeme,
};

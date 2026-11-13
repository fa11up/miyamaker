'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  ensureManualMakerDirs,
  saveManualMakerOutput,
  saveManualMakerMeme,
} = require('../gui/manualMaker.js');

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'manual-maker-test-'));
  const manualMakerDir = path.join(root, 'manualmaker');
  const buildDir = path.join(root, 'build');
  await fsp.mkdir(buildDir, { recursive: true });
  await fsp.writeFile(path.join(buildDir, 'untouched.json'), '{"ok":true}', 'utf8');

  await ensureManualMakerDirs(manualMakerDir);
  assert.strictEqual(await exists(path.join(manualMakerDir, 'images')), true, 'images dir created');
  assert.strictEqual(await exists(path.join(manualMakerDir, 'json')), true, 'json dir created');
  assert.strictEqual(await exists(path.join(manualMakerDir, 'memes')), true, 'memes dir created');

  const metadata = {
    name: 'Manual Maker Preview',
    image: 'manual_preview.png',
    attributes: [{ trait_type: 'Background', value: 'Roadside' }],
  };
  const first = await saveManualMakerOutput({ manualMakerDir, imageDataUrl: ONE_PIXEL_PNG, metadata });
  assert.strictEqual(first.image, 'manualmaker/images/manual_001.png');
  assert.strictEqual(first.json, 'manualmaker/json/manual_001.json');
  assert.strictEqual(await exists(path.join(manualMakerDir, 'images', 'manual_001.png')), true);
  const savedMeta = JSON.parse(await fsp.readFile(path.join(manualMakerDir, 'json', 'manual_001.json'), 'utf8'));
  assert.strictEqual(savedMeta.image, 'manual_001.png');
  assert.deepStrictEqual(savedMeta.attributes, metadata.attributes);

  const second = await saveManualMakerOutput({ manualMakerDir, imageDataUrl: ONE_PIXEL_PNG, metadata });
  assert.strictEqual(second.image, 'manualmaker/images/manual_002.png');

  const meme = await saveManualMakerMeme({ manualMakerDir, imageDataUrl: ONE_PIXEL_PNG });
  assert.strictEqual(meme.image, 'manualmaker/memes/meme_001.png');
  assert.strictEqual(await exists(path.join(manualMakerDir, 'memes', 'meme_001.png')), true);

  assert.strictEqual(await fsp.readFile(path.join(buildDir, 'untouched.json'), 'utf8'), '{"ok":true}');
  assert.strictEqual(await exists(path.join(root, 'build', 'phase2')), false, 'build/phase2 was not created');

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS Manual Maker save helper isolates exports in manualmaker/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

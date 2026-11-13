'use strict';

const assert = require('assert');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  ensureEditTraitDirs,
  saveEditTraitConfig,
  saveEditTraitPreview,
} = require('../gui/editTrait.js');

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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edit-trait-test-'));
  const editTraitDir = path.join(root, 'edittrait');
  const layersDir = path.join(root, 'layers');
  const buildDir = path.join(root, 'build');
  await fsp.mkdir(layersDir, { recursive: true });
  await fsp.mkdir(buildDir, { recursive: true });
  await fsp.writeFile(path.join(layersDir, 'source.png'), 'source');
  await fsp.writeFile(path.join(buildDir, 'untouched.txt'), 'build');

  await ensureEditTraitDirs(editTraitDir);
  assert.strictEqual(await exists(path.join(editTraitDir, 'configs')), true);
  assert.strictEqual(await exists(path.join(editTraitDir, 'previews')), true);

  const setup = {
    layerName: 'Overlay',
    traitName: 'Love Text',
    sourcePath: 'Overlay/Love Text.png',
    transform: { x: 10, y: 20, scale: 1.25, rotation: 12, opacity: 0.8, visible: true },
  };
  const savedConfig = await saveEditTraitConfig({ editTraitDir, setup, scope: 'selected' });
  assert.match(savedConfig.path, /^edittrait\/configs\/edittrait_selected_/);
  const config = JSON.parse(await fsp.readFile(path.join(root, savedConfig.path), 'utf8'));
  assert.strictEqual(config.item.layerName, 'Overlay');
  assert.strictEqual(config.item.transform.scale, 1.25);

  const all = await saveEditTraitConfig({ editTraitDir, scope: 'all', setup: { items: [setup] } });
  assert.match(all.path, /^edittrait\/configs\/edittrait_all_/);

  const preview = await saveEditTraitPreview({ editTraitDir, imageDataUrl: ONE_PIXEL_PNG });
  assert.match(preview.path, /^edittrait\/previews\/edittrait_preview_/);
  assert.strictEqual(await exists(path.join(root, preview.path)), true);

  assert.strictEqual(await fsp.readFile(path.join(layersDir, 'source.png'), 'utf8'), 'source');
  assert.strictEqual(await fsp.readFile(path.join(buildDir, 'untouched.txt'), 'utf8'), 'build');

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS Edit Trait saves configs/previews only inside edittrait/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

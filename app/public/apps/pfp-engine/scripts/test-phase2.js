'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const phase2 = require('../gui/phase2.js');

async function makeDirs() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pfp-phase2-'));
  const buildDir = path.join(root, 'build');
  const phase2Dir = path.join(root, 'buildphase2');
  await fsp.mkdir(path.join(buildDir, 'images'), { recursive: true });
  await fsp.mkdir(path.join(buildDir, 'json'), { recursive: true });
  return { root, buildDir, phase2Dir };
}

async function writeOutputPair(dirs, index, ext = '.png') {
  await fsp.writeFile(path.join(dirs.buildDir, 'images', `${index}${ext}`), `image-${index}`);
  await fsp.writeFile(path.join(dirs.buildDir, 'json', `${index}.json`), JSON.stringify({
    name: `NFT #${index}`,
    edition: index,
    image: `${index}${ext}`,
    attributes: [
      { trait_type: 'Background', value: `BG ${index}` },
    ],
  }, null, 2));
}

async function writeCurrentOutputPairs(dirs, specs) {
  await fsp.rm(path.join(dirs.buildDir, 'images'), { recursive: true, force: true });
  await fsp.rm(path.join(dirs.buildDir, 'json'), { recursive: true, force: true });
  await fsp.mkdir(path.join(dirs.buildDir, 'images'), { recursive: true });
  await fsp.mkdir(path.join(dirs.buildDir, 'json'), { recursive: true });
  for (const spec of specs) {
    const ext = spec.ext || '.png';
    await fsp.writeFile(path.join(dirs.buildDir, 'images', `${spec.edition}${ext}`), spec.imageContent);
    await fsp.writeFile(path.join(dirs.buildDir, 'json', `${spec.edition}.json`), JSON.stringify({
      name: `NFT #${spec.edition}`,
      description: 'Current main',
      external_url: 'https://example.test/',
      image: `${spec.edition}${ext}`,
      attributes: spec.attributes || [{ trait_type: 'Background', value: `BG ${spec.source}` }],
    }, null, 2));
  }
}

async function snapshotFiles(rootDir) {
  const out = {};
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(rootDir, full).replace(/\\/g, '/')] = await fsp.readFile(full, 'utf8');
    }
  }
  await walk(rootDir);
  return out;
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function withFixture(fn) {
  const dirs = await makeDirs();
  try {
    await fn(dirs);
  } finally {
    await fsp.rm(dirs.root, { recursive: true, force: true });
  }
}

async function testPhase2SyncAndApplyDoesNotTouchOutput() {
  await withFixture(async dirs => {
    await writeOutputPair(dirs, 1);
    await writeOutputPair(dirs, 2, '.webp');
    await fsp.writeFile(path.join(dirs.buildDir, 'images', 'preview.png'), 'preview');
    await fsp.writeFile(path.join(dirs.buildDir, 'json', 'metadata.json'), '{"collection":"keep"}');
    await fsp.mkdir(dirs.phase2Dir, { recursive: true });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'extra_traits.json'), JSON.stringify({
      extraTraits: [{ id: 'existing', trait_type: 'Postproduction', value: 'Existing', enabled: false }],
    }, null, 2));

    const originalOne = await fsp.readFile(path.join(dirs.buildDir, 'json', '1.json'), 'utf8');
    const originalTwo = await fsp.readFile(path.join(dirs.buildDir, 'json', '2.json'), 'utf8');
    const result = await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });

    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.strictEqual(result.copiedImages, 2);
    assert.strictEqual(result.copiedJson, 2);
    assert(await fsp.stat(path.join(dirs.phase2Dir, 'images', '1.png')));
    assert(await fsp.stat(path.join(dirs.phase2Dir, 'images', '2.webp')));
    assert(await fsp.stat(path.join(dirs.phase2Dir, 'json', '1.json')));
    assert.deepStrictEqual(await readJson(path.join(dirs.phase2Dir, 'extra_traits.json')), {
      extraTraits: [{ id: 'existing', trait_type: 'Postproduction', value: 'Existing', enabled: false }],
    });

    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [{ id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true }],
    });
    const noSelection = await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [1] });
    const applied = await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [1], traitIds: ['glow'] });
    const appliedAgain = await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [1], traitIds: ['glow'] });

    assert.strictEqual(noSelection.updated, 0);
    assert(noSelection.warning.includes('No extra traits selected'));
    assert.strictEqual(applied.updated, 1);
    assert.strictEqual(appliedAgain.updated, 0);
    const phase2One = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    const phase2Two = await readJson(path.join(dirs.phase2Dir, 'json', '2.json'));
    assert.deepStrictEqual(phase2One.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 1', 'Postproduction:Glow']);
    assert.deepStrictEqual(phase2Two.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 2']);
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '1.json'), 'utf8'), originalOne);
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '2.json'), 'utf8'), originalTwo);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2DeleteMarkedAndDeleteAllAreIsolated() {
  await withFixture(async dirs => {
    await writeOutputPair(dirs, 1);
    await writeOutputPair(dirs, 2);
    await writeOutputPair(dirs, 3);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [{ id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true }],
    });
    const outputTwo = await fsp.readFile(path.join(dirs.buildDir, 'json', '2.json'), 'utf8');

    const deletedMarked = await phase2.deletePhase2Editions({ phase2Dir: dirs.phase2Dir, editions: [2] });
    assert.strictEqual(deletedMarked.deletedImages, 1);
    assert.strictEqual(deletedMarked.deletedJson, 1);
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'images', '2.png')), false);
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'json', '2.json')), false);
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '2.json'), 'utf8'), outputTwo);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'images', '2.png')), true);

    const deletedAll = await phase2.deleteAllPhase2Output({ phase2Dir: dirs.phase2Dir });
    assert.strictEqual(deletedAll.deletedImages, 2);
    assert.strictEqual(deletedAll.deletedJson, 2);
    assert.strictEqual((await fsp.readdir(path.join(dirs.phase2Dir, 'images'))).length, 0);
    assert.strictEqual((await fsp.readdir(path.join(dirs.phase2Dir, 'json'))).length, 0);
    assert.deepStrictEqual(await readJson(path.join(dirs.phase2Dir, 'extra_traits.json')), {
      extraTraits: [{
        id: 'glow',
        trait_type: 'Postproduction',
        value: 'Glow',
        enabled: true,
        selected: false,
        layer: '',
        overlayImage: '',
        notes: '',
        asset: { sourcePath: '', editedPath: '', generatedPath: '', previewPath: '', hasTransparency: false },
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      }],
    });
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2SelectedDisabledAndTargeting() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3, 4, 5]) await writeOutputPair(dirs, index);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    const originalThree = await fsp.readFile(path.join(dirs.buildDir, 'json', '3.json'), 'utf8');
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [
        { id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true },
        { id: 'stamp', trait_type: 'Overlay', value: 'Love Text', enabled: true },
        { id: 'off', trait_type: 'Postproduction', value: 'Disabled', enabled: false },
      ],
    });

    const applied = await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [1, 2], traitIds: ['glow', 'stamp', 'off'] });
    assert.strictEqual(applied.updated, 2);
    assert.strictEqual(applied.disabledSkipped, 1);
    const one = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert.deepStrictEqual(one.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 1', 'Postproduction:Glow', 'Overlay:Love Text']);

    const preview = await phase2.previewTraitTarget({
      phase2Dir: dirs.phase2Dir,
      trait: { trait_type: 'Overlay', value: 'Rare Stamp' },
      mode: 'range',
      targetValue: '3-5',
    });
    assert.deepStrictEqual(preview.editions, [3, 4, 5]);
    assert.strictEqual(preview.impact.updateCount, 3);

    const targeted = await phase2.applyTargetedTrait({
      phase2Dir: dirs.phase2Dir,
      trait: { trait_type: 'Overlay', value: 'Rare Stamp' },
      mode: 'hasTrait',
      targetTraitType: 'Background',
      targetTraitValue: 'BG 3',
    });
    assert.strictEqual(targeted.updated, 1);
    const three = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    assert(three.attributes.some(a => a.trait_type === 'Overlay' && a.value === 'Rare Stamp'));
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '3.json'), 'utf8'), originalThree);

    const rarity = await phase2.analyzePhase2Rarity({ phase2Dir: dirs.phase2Dir });
    const rareStamp = rarity.traits.find(row => row.trait_type === 'Overlay' && row.value === 'Rare Stamp');
    assert.strictEqual(rareStamp.count, 1);
    assert.strictEqual(rareStamp.percentage, 20);
  });
}

async function testPhase2ReindexAndShufflePreserveTraits() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 5, 9]) await writeOutputPair(dirs, index);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [{ id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true }],
    });
    await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [5], traitIds: ['glow'] });
    const outputFive = await fsp.readFile(path.join(dirs.buildDir, 'json', '5.json'), 'utf8');

    const reindexed = await phase2.reindexPhase2Files({ phase2Dir: dirs.phase2Dir });
    assert.strictEqual(reindexed.ok, true, JSON.stringify(reindexed, null, 2));
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'images', '3.png')), true);
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'json', '3.json')), true);
    const three = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    assert.strictEqual(three.edition, 3);
    assert.strictEqual(three.image, '3.png');
    assert(three.attributes.some(a => a.trait_type === 'Background' && a.value === 'BG 5'));
    assert(three.attributes.some(a => a.trait_type === 'Postproduction' && a.value === 'Glow'));
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '5.json'), 'utf8'), outputFive);

    const shuffled = await phase2.shufflePhase2Files({
      phase2Dir: dirs.phase2Dir,
      assignedIndexes: [2, 1, 4, 3],
    });
    assert.strictEqual(shuffled.ok, true, JSON.stringify(shuffled, null, 2));
    const four = await readJson(path.join(dirs.phase2Dir, 'json', '4.json'));
    assert.strictEqual(four.edition, 4);
    assert.strictEqual(four.image, '4.png');
    assert(four.attributes.some(a => a.trait_type === 'Background' && a.value === 'BG 5'));
    assert(four.attributes.some(a => a.trait_type === 'Postproduction' && a.value === 'Glow'));
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '5.json'), 'utf8'), outputFive);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2TraitRemovalAndLibraryCleanup() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3]) await writeOutputPair(dirs, index);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    const originalOne = await fsp.readFile(path.join(dirs.buildDir, 'json', '1.json'), 'utf8');
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [
        { id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true },
        { id: 'stamp', trait_type: 'Overlay', value: 'Love Text', enabled: true },
      ],
    });
    await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [1, 2], traitIds: ['glow', 'stamp'] });

    const removedMarked = await phase2.removeExtraTraitsFromEditions({ phase2Dir: dirs.phase2Dir, editions: [1], traitIds: ['glow'] });
    assert.strictEqual(removedMarked.updated, 1);
    const one = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert(!one.attributes.some(a => a.trait_type === 'Postproduction' && a.value === 'Glow'));
    assert(one.attributes.some(a => a.trait_type === 'Overlay' && a.value === 'Love Text'));

    const protectedRemoval = await phase2.removeExtraTraitsFromEditions({ phase2Dir: dirs.phase2Dir, editions: [1], traitIds: ['background'] });
    assert.strictEqual(protectedRemoval.updated, 0);
    assert.strictEqual(protectedRemoval.protectedSkipped, 1);

    const libraryOnly = await phase2.deleteExtraTraitFromLibrary({ phase2Dir: dirs.phase2Dir, traitId: 'stamp', removeFromJson: false });
    assert.strictEqual(libraryOnly.ok, true);
    const oneAfterLibraryOnly = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert(oneAfterLibraryOnly.attributes.some(a => a.trait_type === 'Overlay' && a.value === 'Love Text'));

    const cleanup = await phase2.deleteExtraTraitFromLibrary({ phase2Dir: dirs.phase2Dir, traitId: 'glow', removeFromJson: true });
    assert.strictEqual(cleanup.ok, true);
    assert.strictEqual(cleanup.cleanup.updated, 1);
    const two = await readJson(path.join(dirs.phase2Dir, 'json', '2.json'));
    assert(!two.attributes.some(a => a.trait_type === 'Postproduction' && a.value === 'Glow'));
    assert(two.attributes.some(a => a.trait_type === 'Overlay' && a.value === 'Love Text'));
    assert.deepStrictEqual((await readJson(path.join(dirs.phase2Dir, 'extra_traits.json'))).extraTraits, []);
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'json', '1.json'), 'utf8'), originalOne);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2TraitAssetSetupAndImageWriteAreIsolated() {
  await withFixture(async dirs => {
    await writeOutputPair(dirs, 1);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    const originalOutputImage = await fsp.readFile(path.join(dirs.buildDir, 'images', '1.png'), 'utf8');
    const source = await phase2.saveTraitAssetDataUrl({
      phase2Dir: dirs.phase2Dir,
      folder: 'traits/source',
      fileName: 'glow',
      dataUrl: 'data:image/png;base64,aW1hZ2UtZGF0YQ==',
    });
    const edited = await phase2.saveTraitAssetDataUrl({
      phase2Dir: dirs.phase2Dir,
      folder: 'traits/edited',
      fileName: 'glow-edited',
      dataUrl: 'data:image/png;base64,ZWRpdGVkLWltYWdl',
    });
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [{
        id: 'glow',
        trait_type: 'Overlay',
        value: 'Glow',
        enabled: true,
        asset: { sourcePath: source.path, editedPath: edited.path, hasTransparency: true },
        transform: { x: 120, y: 45, scale: 1.25, rotation: 12, opacity: 0.72 },
      }],
    });
    const traits = await phase2.readExtraTraits({ phase2Dir: dirs.phase2Dir });
    assert.strictEqual(traits.extraTraits[0].asset.sourcePath, 'traits/source/glow.png');
    assert.strictEqual(traits.extraTraits[0].asset.editedPath, 'traits/edited/glow-edited.png');
    assert.strictEqual(traits.extraTraits[0].asset.hasTransparency, true);
    assert.deepStrictEqual(traits.extraTraits[0].transform, { x: 120, y: 45, scale: 1.25, rotation: 12, opacity: 0.72 });

    const savedImage = await phase2.savePhase2CompositedImage({
      phase2Dir: dirs.phase2Dir,
      edition: 1,
      dataUrl: 'data:image/png;base64,Y29tcG9zaXRlZA==',
    });
    assert.strictEqual(savedImage.ok, true);
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'images', '1.png'), 'utf8'), 'composited');
    assert.strictEqual(await fsp.readFile(path.join(dirs.buildDir, 'images', '1.png'), 'utf8'), originalOutputImage);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2RefreshFromCurrentMainMergesAndPreservesWork() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3]) await writeOutputPair(dirs, index);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    await phase2.writeExtraTraits({
      phase2Dir: dirs.phase2Dir,
      extraTraits: [{ id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true }],
    });
    await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [2], traitIds: ['glow'] });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'images', '2.png'), 'phase2-edited-image-2');

    const deleted = await phase2.deletePhase2Editions({ phase2Dir: dirs.phase2Dir, editions: [3] });
    assert.strictEqual(deleted.deletedImages, 1);
    assert.strictEqual(deleted.deletedJson, 1);

    await writeCurrentOutputPairs(dirs, [
      { edition: 1, source: 2, imageContent: 'image-2' },
      { edition: 2, source: 3, imageContent: 'image-3' },
      { edition: 3, source: 4, ext: '.webp', imageContent: 'image-4' },
    ]);
    const outputBeforeRefresh = await snapshotFiles(dirs.buildDir);
    const extraTraitsBefore = await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8');

    const refreshed = await phase2.refreshFromCurrentMain({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    assert.strictEqual(refreshed.ok, true, JSON.stringify(refreshed, null, 2));
    assert.strictEqual(refreshed.added, 1);
    assert.strictEqual(refreshed.removedMissingFromMain, 1);
    assert.strictEqual(refreshed.skippedDeleted, 1);
    assert.strictEqual(refreshed.extraAttributesPreserved, 1);
    assert.strictEqual(refreshed.visualEditsPreserved, 1);

    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'images', '1.png'), 'utf8'), 'phase2-edited-image-2');
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'images', '2.png')), false, 'Phase 2-deleted item is not recreated');
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'json', '2.json')), false, 'Phase 2-deleted JSON is not recreated');
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'images', '3.webp'), 'utf8'), 'image-4');

    const phase2One = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert.deepStrictEqual(Object.keys(phase2One), ['name', 'description', 'external_url', 'image', 'attributes']);
    assert.strictEqual(phase2One.name, 'NFT #1');
    assert.strictEqual(phase2One.image, '1.png');
    assert.deepStrictEqual(phase2One.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 2', 'Postproduction:Glow']);

    const phase2Three = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    assert.strictEqual(phase2Three.image, '3.webp');
    assert.deepStrictEqual(phase2Three.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 4']);

    assert.deepStrictEqual(await snapshotFiles(dirs.buildDir), outputBeforeRefresh, 'main Output is read-only during Phase 2 refresh');
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8'), extraTraitsBefore);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2BatchTraitEditorJsonOnlyAddDelete() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3]) await writeOutputPair(dirs, index);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'extra_traits.json'), JSON.stringify({
      extraTraits: [{ id: 'keep', trait_type: 'Postproduction', value: 'Keep', enabled: true }],
    }, null, 2));
    const buildBefore = await snapshotFiles(dirs.buildDir);
    const phaseImagesBefore = await snapshotFiles(path.join(dirs.phase2Dir, 'images'));
    const extraTraitsBefore = await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8');

    const twoBefore = await readJson(path.join(dirs.phase2Dir, 'json', '2.json'));
    twoBefore.attributes.push({ trait_type: 'Core', value: 'Otaku-Light' });
    twoBefore.attributes.push({ trait_type: 'Core', value: 'Otaku-Duplicate' });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'json', '2.json'), JSON.stringify(twoBefore, null, 2), 'utf8');
    const threeBefore = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    threeBefore.attributes.push({ trait_type: 'Core', value: 'Otaku-Dark' });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'json', '3.json'), JSON.stringify(threeBefore, null, 2), 'utf8');

    const added = await phase2.batchAddTraitToPhase2Json({
      phase2Dir: dirs.phase2Dir,
      editions: [1, 2, 3],
      trait: { trait_type: 'Core', value: 'Otaku-Dark' },
    });
    assert.strictEqual(added.ok, true);
    assert.strictEqual(added.updated, 2);
    assert.strictEqual(added.added, 1);
    assert.strictEqual(added.replaced, 1);
    assert.strictEqual(added.unchanged, 1);
    assert.strictEqual(added.duplicateTypeCleaned, 1);
    const addedAgain = await phase2.batchAddTraitToPhase2Json({
      phase2Dir: dirs.phase2Dir,
      editions: [1, 2, 3],
      trait: { trait_type: 'Core', value: 'Otaku-Dark' },
    });
    assert.strictEqual(addedAgain.updated, 0);
    assert.strictEqual(addedAgain.unchanged, 3);

    const oneAfterAdd = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert.deepStrictEqual(oneAfterAdd.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 1', 'Core:Otaku-Dark']);
    assert.strictEqual(oneAfterAdd.name, 'NFT #1');
    assert.strictEqual(oneAfterAdd.image, '1.png');
    const twoAfterAdd = await readJson(path.join(dirs.phase2Dir, 'json', '2.json'));
    assert.deepStrictEqual(twoAfterAdd.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 2', 'Core:Otaku-Dark']);

    const deleted = await phase2.batchDeleteTraitFromPhase2Json({
      phase2Dir: dirs.phase2Dir,
      editions: [1, 2, 3],
      trait: { trait_type: 'Core', value: 'Otaku-Dark' },
    });
    assert.strictEqual(deleted.ok, true);
    assert.strictEqual(deleted.updated, 3);
    assert.strictEqual(deleted.notFoundSkipped, 0);
    const oneAfterDelete = await readJson(path.join(dirs.phase2Dir, 'json', '1.json'));
    assert.deepStrictEqual(oneAfterDelete.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 1']);
    const threeAfterDelete = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    assert.deepStrictEqual(threeAfterDelete.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 3']);
    const deletedAgain = await phase2.batchDeleteTraitFromPhase2Json({
      phase2Dir: dirs.phase2Dir,
      editions: [1, 2, 3],
      trait: { trait_type: 'Core', value: 'Otaku-Dark' },
    });
    assert.strictEqual(deletedAgain.updated, 0);
    assert.strictEqual(deletedAgain.notFoundSkipped, 3);

    assert.deepStrictEqual(await snapshotFiles(dirs.buildDir), buildBefore, 'main Output is untouched by batch trait editor');
    assert.deepStrictEqual(await snapshotFiles(path.join(dirs.phase2Dir, 'images')), phaseImagesBefore, 'Phase 2 images are untouched by batch trait editor');
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8'), extraTraitsBefore);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2SinglePieceTraitEditIsJsonOnlyAndDuplicateSafe() {
  await withFixture(async dirs => {
    await writeOutputPair(dirs, 1);
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    const jsonPath = path.join(dirs.phase2Dir, 'json', '1.json');
    const meta = await readJson(jsonPath);
    meta.description = 'keep me';
    meta.external_url = 'https://example.test/1';
    meta.attributes = [
      { trait_type: 'Background', value: 'Toshokan' },
      { trait_type: 'Eyes', value: 'Blue' },
      { trait_type: 'Mouth', value: 'Flat' },
    ];
    await fsp.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf8');
    await fsp.writeFile(path.join(dirs.phase2Dir, 'extra_traits.json'), JSON.stringify({ extraTraits: [] }, null, 2));
    const buildBefore = await snapshotFiles(dirs.buildDir);
    const phaseImagesBefore = await snapshotFiles(path.join(dirs.phase2Dir, 'images'));
    const extraTraitsBefore = await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8');

    const edited = await phase2.updatePhase2PieceTrait({
      phase2Dir: dirs.phase2Dir,
      edition: 1,
      attrIndex: 1,
      trait: { trait_type: 'Eyes', value: 'Simply Blue' },
    });
    assert.strictEqual(edited.ok, true);
    const afterEdit = await readJson(jsonPath);
    assert.strictEqual(afterEdit.description, 'keep me');
    assert.strictEqual(afterEdit.external_url, 'https://example.test/1');
    assert.deepStrictEqual(afterEdit.attributes.map(a => `${a.trait_type}:${a.value}`), [
      'Background:Toshokan',
      'Eyes:Simply Blue',
      'Mouth:Flat',
    ]);

    await assert.rejects(
      () => phase2.updatePhase2PieceTrait({
        phase2Dir: dirs.phase2Dir,
        edition: 1,
        attrIndex: 2,
        trait: { trait_type: 'Eyes', value: 'Green' },
      }),
      /already has a trait with this trait_type/
    );
    await assert.rejects(
      () => phase2.updatePhase2PieceTrait({
        phase2Dir: dirs.phase2Dir,
        edition: 1,
        attrIndex: 2,
        trait: { trait_type: 'Eyes', value: 'Simply Blue' },
      }),
      /already has that exact trait_type \+ value/
    );

    const deleted = await phase2.deletePhase2PieceTrait({ phase2Dir: dirs.phase2Dir, edition: 1, attrIndex: 1 });
    assert.strictEqual(deleted.ok, true);
    const afterDelete = await readJson(jsonPath);
    assert.deepStrictEqual(afterDelete.attributes.map(a => `${a.trait_type}:${a.value}`), [
      'Background:Toshokan',
      'Mouth:Flat',
    ]);

    assert.deepStrictEqual(await snapshotFiles(dirs.buildDir), buildBefore, 'main Output is untouched by single-piece trait editor');
    assert.deepStrictEqual(await snapshotFiles(path.join(dirs.phase2Dir, 'images')), phaseImagesBefore, 'Phase 2 images are untouched by single-piece trait editor');
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8'), extraTraitsBefore);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function testPhase2ManualReorderRenumbersPairsSafely() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3, 4]) await writeOutputPair(dirs, index);
    await writeOutputPair(dirs, 5, '.webp');
    await phase2.syncFromOutput({ buildDir: dirs.buildDir, phase2Dir: dirs.phase2Dir });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'extra_traits.json'), JSON.stringify({
      extraTraits: [{ id: 'glow', trait_type: 'Postproduction', value: 'Glow', enabled: true }],
    }, null, 2));
    await phase2.applyExtraTraits({ phase2Dir: dirs.phase2Dir, editions: [5], traitIds: ['glow'] });
    await fsp.writeFile(path.join(dirs.phase2Dir, 'images', '5.webp'), 'phase2-edited-image-5');
    const buildBefore = await snapshotFiles(dirs.buildDir);
    const extraTraitsBefore = await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8');

    const result = await phase2.manualReorderPhase2({
      phase2Dir: dirs.phase2Dir,
      draggedEdition: 5,
      targetPosition: 2,
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.strictEqual(result.affectedPairs, 4);
    assert.strictEqual(result.metadataUpdated, 5);

    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'images', '2.webp')), true);
    assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'json', '2.json')), true);
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'images', '2.webp'), 'utf8'), 'phase2-edited-image-5');
    const two = await readJson(path.join(dirs.phase2Dir, 'json', '2.json'));
    assert.strictEqual(two.name, 'NFT #2');
    assert.strictEqual(two.edition, 2);
    assert.strictEqual(two.image, '2.webp');
    assert.deepStrictEqual(two.attributes.map(a => `${a.trait_type}:${a.value}`), [
      'Background:BG 5',
      'Postproduction:Glow',
    ]);

    const three = await readJson(path.join(dirs.phase2Dir, 'json', '3.json'));
    assert.strictEqual(three.name, 'NFT #3');
    assert.strictEqual(three.edition, 3);
    assert.strictEqual(three.image, '3.png');
    assert.deepStrictEqual(three.attributes.map(a => `${a.trait_type}:${a.value}`), ['Background:BG 2']);

    for (const index of [1, 2, 3, 4, 5]) {
      const imageFiles = (await fsp.readdir(path.join(dirs.phase2Dir, 'images'))).filter(file => file.startsWith(`${index}.`));
      assert.strictEqual(imageFiles.length, 1, `Expected one image for final Phase 2 #${index}`);
      assert.strictEqual(fs.existsSync(path.join(dirs.phase2Dir, 'json', `${index}.json`)), true);
    }
    assert.deepStrictEqual(await snapshotFiles(dirs.buildDir), buildBefore, 'main Output is untouched by manual Phase 2 reorder');
    assert.strictEqual(await fsp.readFile(path.join(dirs.phase2Dir, 'extra_traits.json'), 'utf8'), extraTraitsBefore);
    assert.strictEqual(fs.existsSync(path.join(dirs.buildDir, 'phase2')), false);
  });
}

async function run() {
  const tests = [
    testPhase2SyncAndApplyDoesNotTouchOutput,
    testPhase2DeleteMarkedAndDeleteAllAreIsolated,
    testPhase2SelectedDisabledAndTargeting,
    testPhase2ReindexAndShufflePreserveTraits,
    testPhase2TraitRemovalAndLibraryCleanup,
    testPhase2TraitAssetSetupAndImageWriteAreIsolated,
    testPhase2RefreshFromCurrentMainMergesAndPreservesWork,
    testPhase2BatchTraitEditorJsonOnlyAddDelete,
    testPhase2SinglePieceTraitEditIsJsonOnlyAndDuplicateSafe,
    testPhase2ManualReorderRenumbersPairsSafely,
  ];
  for (const test of tests) {
    await test();
    console.log(`PASS ${test.name}`);
  }
  console.log('All Phase 2 tests passed');
}

run().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});

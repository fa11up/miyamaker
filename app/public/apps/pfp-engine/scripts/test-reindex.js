'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const {
  reindexOutputFiles,
  shuffleOutputFiles,
} = require('../gui/outputReindex.js');

async function makeTempBuild() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pfp-reindex-'));
  const buildDir = path.join(root, 'build');
  await fsp.mkdir(path.join(buildDir, 'images'), { recursive: true });
  await fsp.mkdir(path.join(buildDir, 'json'), { recursive: true });
  return { root, buildDir, imageDir: path.join(buildDir, 'images'), jsonDir: path.join(buildDir, 'json') };
}

async function writePair(dirs, index, ext = '.png') {
  await fsp.writeFile(path.join(dirs.imageDir, `${index}${ext}`), `image-${index}${ext}`);
  await fsp.writeFile(path.join(dirs.jsonDir, `${index}.json`), JSON.stringify({
    name: `NFT #${index}`,
    edition: index,
    tokenId: index,
    token_id: String(index),
    id: index,
    image: `${index}${ext}`,
    attributes: [
      { trait_type: 'Original Index', value: String(index) },
    ],
    debugOriginalIndex: index,
  }, null, 2));
}

async function readJson(dirs, index) {
  return JSON.parse(await fsp.readFile(path.join(dirs.jsonDir, `${index}.json`), 'utf8'));
}

async function names(dir) {
  return (await fsp.readdir(dir)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
    return a.localeCompare(b);
  });
}

async function withFixture(fn) {
  const dirs = await makeTempBuild();
  try {
    await fn(dirs);
  } finally {
    await fsp.rm(dirs.root, { recursive: true, force: true });
  }
}

async function testGappedReindex() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3, 4, 5, 8, 13, 33]) await writePair(dirs, index);
    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });

    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png', '8.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json', '4.json', '5.json', '6.json', '7.json', '8.json']);

    const seven = await readJson(dirs, 7);
    assert.strictEqual(seven.debugOriginalIndex, 13);
    assert.strictEqual(seven.image, '7.png');
    assert.strictEqual(seven.edition, 7);
    assert.strictEqual(seven.tokenId, 7);
    assert.strictEqual(seven.token_id, '7');
    assert.strictEqual(seven.id, 7);
    assert.strictEqual(seven.name, 'NFT #7');
    assert.strictEqual(seven.attributes[0].value, '13');

    const eight = await readJson(dirs, 8);
    assert.strictEqual(eight.debugOriginalIndex, 33);
    assert.strictEqual(eight.image, '8.png');
    assert.strictEqual(eight.edition, 8);
    assert.strictEqual(eight.name, 'NFT #8');
    assert.strictEqual(eight.attributes[0].value, '33');

    assert(result.logs.some(row => row.message === 'Reindex mapping: 13.png + 13.json -> 7.png + 7.json'));
    assert(result.logs.some(row => row.message === 'Reindex mapping: 33.png + 33.json -> 8.png + 8.json'));
  });
}

async function testAlreadyContinuous() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 3]) await writePair(dirs, index);
    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });

    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png', '3.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json']);
    const two = await readJson(dirs, 2);
    assert.strictEqual(two.debugOriginalIndex, 2);
    assert.strictEqual(two.attributes[0].value, '2');
    assert.strictEqual(two.image, '2.png');
  });
}

async function testMissingJsonSkipped() {
  await withFixture(async dirs => {
    await writePair(dirs, 1);
    await fsp.writeFile(path.join(dirs.imageDir, '2.png'), 'image-2');

    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });
    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert(result.warnings.some(w => /2\.png has no matching 2\.json/.test(w)));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json']);
    const one = await readJson(dirs, 1);
    assert.strictEqual(one.debugOriginalIndex, 1);
    assert.strictEqual(one.image, '1.png');
  });
}

async function testMixedExtensions() {
  await withFixture(async dirs => {
    await writePair(dirs, 1, '.png');
    await writePair(dirs, 4, '.webp');
    await writePair(dirs, 9, '.jpg');

    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });
    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.webp', '3.jpg']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json']);

    const two = await readJson(dirs, 2);
    assert.strictEqual(two.debugOriginalIndex, 4);
    assert.strictEqual(two.image, '2.webp');
    assert.strictEqual(two.attributes[0].value, '4');

    const three = await readJson(dirs, 3);
    assert.strictEqual(three.debugOriginalIndex, 9);
    assert.strictEqual(three.image, '3.jpg');
    assert.strictEqual(three.attributes[0].value, '9');
  });
}

async function testReindexIgnoresNonNumericFiles() {
  await withFixture(async dirs => {
    for (const index of [1, 3, 8]) await writePair(dirs, index);
    await fsp.writeFile(path.join(dirs.imageDir, 'preview.png'), 'preview-image');
    await fsp.writeFile(path.join(dirs.imageDir, 'banner.jpg'), 'banner-image');
    await fsp.writeFile(path.join(dirs.jsonDir, 'metadata.json'), JSON.stringify({ collection: 'keep' }));
    await fsp.writeFile(path.join(dirs.jsonDir, '_metadata.json'), JSON.stringify({ hidden: true }));

    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });
    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png', '3.png', 'banner.jpg', 'preview.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json', '_metadata.json', 'metadata.json']);

    const two = await readJson(dirs, 2);
    const three = await readJson(dirs, 3);
    assert.strictEqual(two.debugOriginalIndex, 3);
    assert.strictEqual(two.image, '2.png');
    assert.strictEqual(two.attributes[0].value, '3');
    assert.strictEqual(three.debugOriginalIndex, 8);
    assert.strictEqual(three.image, '3.png');
    assert.strictEqual(three.attributes[0].value, '8');
    assert.strictEqual(await fsp.readFile(path.join(dirs.imageDir, 'preview.png'), 'utf8'), 'preview-image');
    assert.strictEqual(await fsp.readFile(path.join(dirs.imageDir, 'banner.jpg'), 'utf8'), 'banner-image');
    assert.deepStrictEqual(JSON.parse(await fsp.readFile(path.join(dirs.jsonDir, 'metadata.json'), 'utf8')), { collection: 'keep' });
    assert.deepStrictEqual(JSON.parse(await fsp.readFile(path.join(dirs.jsonDir, '_metadata.json'), 'utf8')), { hidden: true });
  });
}

async function testReindexRepairsStaleNumericImageReferences() {
  await withFixture(async dirs => {
    await writePair(dirs, 1, '.png');
    await writePair(dirs, 3, '.webp');

    const onePath = path.join(dirs.jsonDir, '1.json');
    const threePath = path.join(dirs.jsonDir, '3.json');
    const one = JSON.parse(await fsp.readFile(onePath, 'utf8'));
    const three = JSON.parse(await fsp.readFile(threePath, 'utf8'));
    one.image = 'ipfs://NewUriToReplace/5001.png';
    three.image = './images/9003.webp?cache=1';
    await fsp.writeFile(onePath, JSON.stringify(one, null, 2), 'utf8');
    await fsp.writeFile(threePath, JSON.stringify(three, null, 2), 'utf8');

    const result = await reindexOutputFiles({ buildDir: dirs.buildDir, startIndex: 1 });
    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));

    const finalOne = await readJson(dirs, 1);
    const finalTwo = await readJson(dirs, 2);
    assert.strictEqual(finalOne.debugOriginalIndex, 1);
    assert.strictEqual(finalOne.image, 'ipfs://NewUriToReplace/1.png');
    assert.strictEqual(finalOne.attributes[0].value, '1');
    assert.strictEqual(finalTwo.debugOriginalIndex, 3);
    assert.strictEqual(finalTwo.image, './images/2.webp?cache=1');
    assert.strictEqual(finalTwo.attributes[0].value, '3');
  });
}

async function testShufflePreservesPairsAndIgnoresNonNumericFiles() {
  await withFixture(async dirs => {
    for (const index of [1, 2, 8, 13]) await writePair(dirs, index);
    await fsp.writeFile(path.join(dirs.imageDir, 'preview.png'), 'preview');
    await fsp.writeFile(path.join(dirs.jsonDir, 'metadata.json'), '{"collection":"test"}');

    const result = await shuffleOutputFiles({
      buildDir: dirs.buildDir,
      startIndex: 1,
      assignedIndexes: [2, 4, 1, 3],
    });

    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png', '3.png', '4.png', 'preview.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json', '4.json', 'metadata.json']);

    const one = await readJson(dirs, 1);
    assert.strictEqual(one.debugOriginalIndex, 8);
    assert.strictEqual(one.image, '1.png');
    assert.strictEqual(one.edition, 1);
    assert.strictEqual(one.name, 'NFT #1');
    assert.strictEqual(one.attributes[0].value, '8');

    const three = await readJson(dirs, 3);
    assert.strictEqual(three.debugOriginalIndex, 13);
    assert.strictEqual(three.image, '3.png');
    assert.strictEqual(three.edition, 3);
    assert.strictEqual(three.name, 'NFT #3');
    assert.strictEqual(three.attributes[0].value, '13');

    assert.strictEqual(await fsp.readFile(path.join(dirs.imageDir, 'preview.png'), 'utf8'), 'preview');
    assert.deepStrictEqual(JSON.parse(await fsp.readFile(path.join(dirs.jsonDir, 'metadata.json'), 'utf8')), { collection: 'test' });
    assert(result.logs.some(row => row.message === 'Shuffle mapping: 13.png + 13.json -> 3.png + 3.json'));
  });
}

async function testShuffleMixedExtensions() {
  await withFixture(async dirs => {
    await writePair(dirs, 1, '.png');
    await writePair(dirs, 4, '.webp');
    await writePair(dirs, 9, '.jpg');

    const result = await shuffleOutputFiles({
      buildDir: dirs.buildDir,
      startIndex: 1,
      assignedIndexes: [2, 3, 1],
    });

    assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.jpg', '2.png', '3.webp']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '2.json', '3.json']);

    const one = await readJson(dirs, 1);
    assert.strictEqual(one.debugOriginalIndex, 9);
    assert.strictEqual(one.image, '1.jpg');
    assert.strictEqual(one.attributes[0].value, '9');

    const three = await readJson(dirs, 3);
    assert.strictEqual(three.debugOriginalIndex, 4);
    assert.strictEqual(three.image, '3.webp');
    assert.strictEqual(three.attributes[0].value, '4');
  });
}

async function testShuffleStopsBeforeCollidingWithIncompletePair() {
  await withFixture(async dirs => {
    await writePair(dirs, 1);
    await writePair(dirs, 4);
    await fsp.writeFile(path.join(dirs.imageDir, '2.png'), 'orphan-image-2');

    const result = await shuffleOutputFiles({
      buildDir: dirs.buildDir,
      startIndex: 1,
      assignedIndexes: [2, 1],
    });

    assert.strictEqual(result.ok, false, JSON.stringify(result, null, 2));
    assert(result.errors.some(e => /overwrite unrelated file: 2\.png/.test(e)));
    assert.deepStrictEqual(await names(dirs.imageDir), ['1.png', '2.png', '4.png']);
    assert.deepStrictEqual(await names(dirs.jsonDir), ['1.json', '4.json']);
    assert.strictEqual(await fsp.readFile(path.join(dirs.imageDir, '2.png'), 'utf8'), 'orphan-image-2');
    const one = await readJson(dirs, 1);
    const four = JSON.parse(await fsp.readFile(path.join(dirs.jsonDir, '4.json'), 'utf8'));
    assert.strictEqual(one.debugOriginalIndex, 1);
    assert.strictEqual(four.debugOriginalIndex, 4);
  });
}

async function run() {
  const tests = [
    testGappedReindex,
    testAlreadyContinuous,
    testMissingJsonSkipped,
    testMixedExtensions,
    testReindexIgnoresNonNumericFiles,
    testReindexRepairsStaleNumericImageReferences,
    testShufflePreservesPairsAndIgnoresNonNumericFiles,
    testShuffleMixedExtensions,
    testShuffleStopsBeforeCollidingWithIncompletePair,
  ];

  for (const test of tests) {
    await test();
    console.log(`PASS ${test.name}`);
  }
  console.log('All Output file tool tests passed');
}

run().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});

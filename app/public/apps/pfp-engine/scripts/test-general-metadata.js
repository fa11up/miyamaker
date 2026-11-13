'use strict';

const assert = require('assert');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  buildOekakiMetadata,
  countBuildMetadata,
  countGeneralMetadataTargets,
  restructureBuildMetadata,
  restructureGeneralMetadataTargets,
} = require('../gui/generalMetadata.js');

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'general-metadata-test-'));
  const buildDir = path.join(root, 'build');
  const phase2Dir = path.join(root, 'buildphase2');
  const phase2Json = path.join(phase2Dir, 'json');
  const phase2Image = path.join(phase2Dir, 'images', '1.png');
  const phase2Traits = path.join(phase2Dir, 'extra_traits.json');
  await fsp.mkdir(path.join(buildDir, 'images'), { recursive: true });
  await fsp.mkdir(path.join(buildDir, 'json'), { recursive: true });
  await fsp.mkdir(phase2Json, { recursive: true });
  await fsp.mkdir(path.join(phase2Dir, 'images'), { recursive: true });

  await fsp.writeFile(path.join(buildDir, 'images', '1.webp'), 'fake-image');
  await fsp.writeFile(path.join(buildDir, 'json', '1.json'), JSON.stringify({
    name: 'Old #1',
    description: 'old',
    image: 'old.png',
    symbol: 'OLD',
    seller_fee_basis_points: 1000,
    collection: { name: 'Old' },
    dna: 'remove-me',
    attributes: [{ trait_type: 'Original Index', value: '1' }],
  }, null, 2));
  await fsp.writeFile(path.join(buildDir, 'json', '2.json'), JSON.stringify({
    name: 'Old #2',
    properties: { attributes: [{ trait_type: 'Converted', value: 'Yes' }] },
    extra: true,
  }, null, 2));
  await fsp.writeFile(path.join(buildDir, 'json', 'bad.json'), '{nope', 'utf8');
  await fsp.writeFile(phase2Image, 'phase2-image-original');
  await fsp.writeFile(phase2Traits, JSON.stringify({ extraTraits: [{ trait_type: 'Postproduction', value: 'Glow' }] }, null, 2), 'utf8');
  const phase2TraitsBefore = await fsp.readFile(phase2Traits, 'utf8');
  const phase2ImageBefore = await fsp.readFile(phase2Image, 'utf8');
  await fsp.writeFile(path.join(phase2Json, '1.json'), JSON.stringify({
    name: 'Old Phase 2 #1',
    description: 'old phase 2',
    external_url: 'https://old.example/',
    image: 'ipfs://old/1.png',
    edition: 1,
    attributes: [
      { trait_type: 'Background', value: 'Toshokan' },
      { trait_type: 'Postproduction', value: 'Glow' },
      { trait_type: 'Overlay', value: 'Love Text' },
    ],
  }, null, 2), 'utf8');

  assert.strictEqual((await countBuildMetadata({ buildDir })).count, 2);
  const counts = await countGeneralMetadataTargets({ buildDir, phase2Dir });
  assert.strictEqual(counts.outputCount, 2);
  assert.strictEqual(counts.phase2Count, 1);

  const result = await restructureBuildMetadata({
    buildDir,
    settings: {
      namePrefix: 'Oekaki',
      description: 'Neo-chibi aesthetic enthusiast network cohesion lainpilled artisanal AI generative synthesis NFTS',
      externalUrl: 'https://www.oekakimaker.net/',
      imageBaseUri: 'ipfs://CID/',
      fallbackExt: 'png',
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.found, 2);
  assert.strictEqual(result.updated, 2);
  assert.strictEqual(await exists(path.join(root, result.backupDir, '1.json')), true, 'backup copy exists');

  const meta1 = JSON.parse(await fsp.readFile(path.join(buildDir, 'json', '1.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(meta1), ['name', 'description', 'external_url', 'image', 'attributes']);
  assert.deepStrictEqual(meta1, buildOekakiMetadata({
    attributes: [{ trait_type: 'Original Index', value: '1' }],
  }, 1, '.webp', {
    namePrefix: 'Oekaki',
    description: 'Neo-chibi aesthetic enthusiast network cohesion lainpilled artisanal AI generative synthesis NFTS',
    externalUrl: 'https://www.oekakimaker.net/',
    imageBaseUri: 'ipfs://CID/',
    fallbackExt: 'png',
  }));
  assert.strictEqual(meta1.image, 'ipfs://CID/1.webp');
  assert.deepStrictEqual(meta1.attributes, [{ trait_type: 'Original Index', value: '1' }]);
  assert.strictEqual(meta1.dna, undefined);
  assert.strictEqual(meta1.symbol, undefined);

  const meta2 = JSON.parse(await fsp.readFile(path.join(buildDir, 'json', '2.json'), 'utf8'));
  assert.deepStrictEqual(meta2.attributes, [{ trait_type: 'Converted', value: 'Yes' }]);
  assert.strictEqual(meta2.image, 'ipfs://CID/2.png');

  const phase2 = JSON.parse(await fsp.readFile(path.join(phase2Json, '1.json'), 'utf8'));
  assert.strictEqual(phase2.name, 'Old Phase 2 #1', 'legacy single-target helper leaves Phase 2 untouched');

  const combined = await restructureGeneralMetadataTargets({
    buildDir,
    phase2Dir,
    settings: {
      namePrefix: 'Oekaki',
      description: 'Neo-chibi aesthetic enthusiast network cohesion lainpilled artisanal AI generative synthesis NFTS',
      externalUrl: 'https://www.oekakimaker.net/',
      imageBaseUri: 'ipfs://CID/',
      fallbackExt: 'png',
    },
  });

  assert.strictEqual(combined.outputFound, 2);
  assert.strictEqual(combined.phase2Found, 1);
  assert.strictEqual(combined.outputUpdated, 2);
  assert.strictEqual(combined.phase2Updated, 1);

  const phase2Updated = JSON.parse(await fsp.readFile(path.join(phase2Json, '1.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(phase2Updated), ['name', 'description', 'external_url', 'image', 'attributes']);
  assert.strictEqual(phase2Updated.name, 'Oekaki #1');
  assert.strictEqual(phase2Updated.description, 'Neo-chibi aesthetic enthusiast network cohesion lainpilled artisanal AI generative synthesis NFTS');
  assert.strictEqual(phase2Updated.external_url, 'https://www.oekakimaker.net/');
  assert.strictEqual(phase2Updated.image, 'ipfs://CID/1.png');
  assert.deepStrictEqual(phase2Updated.attributes, [
    { trait_type: 'Background', value: 'Toshokan' },
    { trait_type: 'Postproduction', value: 'Glow' },
    { trait_type: 'Overlay', value: 'Love Text' },
  ]);
  assert.strictEqual(phase2Updated.edition, undefined);
  assert.strictEqual(await fsp.readFile(phase2Traits, 'utf8'), phase2TraitsBefore);
  assert.strictEqual(await fsp.readFile(phase2Image, 'utf8'), phase2ImageBefore);

  await fsp.rm(root, { recursive: true, force: true });
  console.log('PASS General Metadata schema refresh updates Output and Phase 2 while preserving attributes');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

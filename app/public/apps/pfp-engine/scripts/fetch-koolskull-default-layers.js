#!/usr/bin/env node
'use strict';

// Rebuild the bundled, output-resolution copy of the public MiyaMaker layers.
// Run on macOS: node scripts/fetch-koolskull-default-layers.js
// `sips` caps images at the engine's 512px output size while preserving alpha.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ORIGIN = 'https://koolskull.com';
const ROOT_URL = `${ORIGIN}/miyamaker/layers/`;
const DEST = path.resolve(__dirname, '..', 'assets', 'default-layers');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_EDGE = '512';
const CONCURRENCY = 4;
const ROOT_LAYER_ORDER = ['BG', 'Body', 'Eyes', 'Nose', 'Mouth', 'Hair', 'Mask', 'Hat', 'Top', 'Hand', 'Earrings', 'Overlay'];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchImage(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function rowsFrom(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const link = row.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const icon = link[2].match(/alt="\[?(Directory|IMG)\]?"/i);
    if (!icon) continue;
    const label = link[2].replace(/<[^>]*>/g, '').trim();
    const sizeCells = [...row.matchAll(/<td data-sort="(\d+)">/gi)];
    rows.push({ href: link[1], label, kind: icon[1].toLowerCase(), bytes: Number(sizeCells.at(-1)?.[1] || 0) });
  }
  return rows;
}

function safeRelative(url) {
  const pathname = decodeURIComponent(new URL(url, ORIGIN).pathname);
  const prefix = '/miyamaker/layers/';
  if (!pathname.startsWith(prefix)) throw new Error(`Refusing a path outside the layers directory: ${pathname}`);
  const relative = pathname.slice(prefix.length);
  const segments = relative.split('/');
  if (!relative || segments.some(part => !part || part === '.' || part === '..' || part.includes(path.sep))) throw new Error(`Unsafe layer path: ${relative}`);
  return relative;
}

async function crawl(url, imageList, seenDirectories, skippedZeroByte) {
  const directory = new URL(url, ORIGIN).href;
  if (seenDirectories.has(directory)) return;
  seenDirectories.add(directory);
  const rows = rowsFrom(await fetchText(directory));
  for (const row of rows) {
    const target = new URL(row.href, directory).href;
    if (new URL(target).origin !== ORIGIN) continue;
    if (row.kind === 'directory') await crawl(target.endsWith('/') ? target : `${target}/`, imageList, seenDirectories, skippedZeroByte);
    else if (row.kind === 'img' && IMAGE_EXT.test(row.label)) {
      if (row.bytes > 0) imageList.push({ url: target, relative: safeRelative(target), sourceBytes: row.bytes });
      else skippedZeroByte.push(target);
    }
  }
}

async function main() {
  await fs.mkdir(DEST, { recursive: true });
  const images = [];
  const skippedZeroByte = [];
  const visitedDirectories = new Set();
  await crawl(ROOT_URL, images, visitedDirectories, skippedZeroByte);
  images.sort((a, b) => a.relative.localeCompare(b.relative));
  if (!images.length) throw new Error('No non-empty layer images were found.');
  const sourceTotal = images.reduce((sum, image) => sum + image.sourceBytes, 0);
  if (process.argv.includes('--list-only')) {
    process.stdout.write(`Found ${images.length} images in ${visitedDirectories.size} directories (${(sourceTotal / 1048576).toFixed(1)} MB source).\n`);
    for (const image of images) process.stdout.write(`${image.relative}\t${image.sourceBytes}\n`);
    return;
  }
  await fs.writeFile(path.join(DEST, '.order'), `${ROOT_LAYER_ORDER.join('\n')}\n`);

  const manifest = { source: ROOT_URL, maxImageEdge: Number(MAX_EDGE), generatedAt: new Date().toISOString(), images: [] };
  let nextIndex = 0;
  const failures = [];
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= images.length) return;
    const image = images[index];
    const destination = path.join(DEST, image.relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporarySource = path.join(os.tmpdir(), `miya-kool-${process.pid}-${index}${path.extname(image.relative)}`);
    const temporaryOutput = `${destination}.resize-tmp`;
    try {
      const existing = await fs.stat(destination).catch(() => null);
      if (existing?.isFile() && existing.size > 0) {
        manifest.images.push({ path: image.relative, source: image.url, sourceBytes: image.sourceBytes, bundledBytes: existing.size });
        continue;
      }
      const source = await fetchImage(image.url);
      if (!source.length) { skippedZeroByte.push(image.url); continue; }
      await fs.writeFile(temporarySource, source);
      await run('sips', ['-Z', MAX_EDGE, temporarySource, '--out', temporaryOutput]);
      await fs.rename(temporaryOutput, destination);
      const stat = await fs.stat(destination);
      manifest.images.push({ path: image.relative, source: image.url, sourceBytes: source.length, bundledBytes: stat.size });
      process.stdout.write(`[${index + 1}/${images.length}] ${image.relative} (${Math.round(stat.size / 1024)} KB)\n`);
      } catch (error) {
        failures.push({ path: image.relative, error: error.message });
        process.stderr.write(`Failed ${image.relative}: ${error.message}\n`);
    } finally {
      await fs.rm(temporarySource, { force: true });
      await fs.rm(temporaryOutput, { force: true });
    }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (failures.length) throw new Error(`${failures.length} layer image(s) could not be downloaded or resized`);
  manifest.images.sort((a, b) => a.path.localeCompare(b.path));
  await fs.writeFile(path.resolve(DEST, '..', 'default-layers.manifest.json'), `${JSON.stringify({ ...manifest, skippedZeroByte }, null, 2)}\n`);
  const total = manifest.images.reduce((sum, image) => sum + image.bundledBytes, 0);
  process.stdout.write(`Saved ${manifest.images.length} images (${(total / 1048576).toFixed(1)} MB); skipped ${skippedZeroByte.length} empty listing entries.\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });

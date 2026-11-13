'use strict';

const fsp = require('fs').promises;
const path = require('path');

const SESSION_VERSION = 1;
const SESSION_PREFIXES = ['layers/', 'build/', 'buildphase2/', 'manualmaker/', 'edittrait/'];
const SESSION_FILES = ['src/config.js', 'rarity-setup.json'];
const WORKSPACE_DIRS = ['layers', 'build', 'buildphase2', 'manualmaker', 'edittrait'];
const IMAGE_RE = /\.(png|jpg|jpeg|webp|gif)$/i;

function cleanRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid session file path');
  if (!SESSION_FILES.includes(normalized) && !SESSION_PREFIXES.some(prefix => normalized.startsWith(prefix))) throw new Error(`Session cannot write outside the project workspace: ${normalized}`);
  return normalized;
}

async function walkFiles(root, dir = root) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function buildSessionFilePackage(engineDir) {
  const files = [];
  for (const folder of WORKSPACE_DIRS) {
    for (const full of await walkFiles(path.join(engineDir, folder))) {
      const relativePath = path.relative(engineDir, full).split(path.sep).join('/');
      files.push({ path: relativePath, data: (await fsp.readFile(full)).toString('base64') });
    }
  }
  for (const relativePath of SESSION_FILES) {
    try { files.push({ path: relativePath, data: (await fsp.readFile(path.join(engineDir, relativePath))).toString('base64') }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const thumbnail = files.find(item => /^build\/images\//.test(item.path) && IMAGE_RE.test(item.path)) || files.find(item => /^layers\//.test(item.path) && IMAGE_RE.test(item.path));
  return { version: SESSION_VERSION, files, thumbnailPath: thumbnail?.path || '' };
}

function validateSessionPackage(session) {
  if (!session || session.format !== 'miya-pfp-engine-session' || session.version !== SESSION_VERSION) throw new Error('This is not a supported Miya pfp engine session file.');
  if (!Array.isArray(session.workspace?.files)) throw new Error('Session is missing its workspace files.');
  let totalBytes = 0;
  const seen = new Set();
  const files = session.workspace.files.map(file => {
    const relativePath = cleanRelativePath(file?.path);
    if (seen.has(relativePath)) throw new Error(`Duplicate file in session: ${relativePath}`);
    seen.add(relativePath);
    const data = String(file?.data || '');
    if (data && !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(`Invalid file data: ${relativePath}`);
    totalBytes += Math.floor(data.length * 3 / 4);
    if (totalBytes > 300 * 1024 * 1024) throw new Error('Session is larger than the 300 MB restore limit.');
    return { path: relativePath, data };
  });
  return { ...session, workspace: { ...session.workspace, files } };
}

async function restoreSessionFiles(engineDir, session) {
  const clean = validateSessionPackage(session);
  const suffix = `.miya-stage-${process.pid}-${Date.now()}`;
  const stages = new Map();
  const backups = new Map();
  const fileTargets = [];
  for (const folder of WORKSPACE_DIRS) {
    const stage = path.join(engineDir, `${folder}${suffix}`);
    await fsp.mkdir(stage, { recursive: true });
    stages.set(folder, stage);
  }
  for (const item of clean.workspace.files) {
    const relativePath = cleanRelativePath(item.path);
    const folder = relativePath.split('/')[0];
    const data = Buffer.from(item.data, 'base64');
    if (WORKSPACE_DIRS.includes(folder)) {
      const full = path.resolve(stages.get(folder), relativePath.slice(folder.length + 1));
      if (!full.startsWith(stages.get(folder) + path.sep)) throw new Error('Blocked unsafe session path');
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, data);
    } else {
      const full = path.join(engineDir, relativePath);
      const staged = `${full}${suffix}`;
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(staged, data);
      fileTargets.push({ full, staged });
    }
  }
  try {
    for (const folder of WORKSPACE_DIRS) {
      const current = path.join(engineDir, folder);
      const backup = `${current}${suffix}.backup`;
      await fsp.rename(current, backup).catch(error => { if (error.code !== 'ENOENT') throw error; });
      backups.set(current, backup);
      await fsp.rename(stages.get(folder), current);
    }
    for (const item of fileTargets) {
      const backup = `${item.full}${suffix}.backup`;
      await fsp.rename(item.full, backup).catch(error => { if (error.code !== 'ENOENT') throw error; });
      backups.set(item.full, backup);
      await fsp.rename(item.staged, item.full);
    }
  } catch (error) {
    for (const [current, backup] of [...backups.entries()].reverse()) {
      await fsp.rm(current, { recursive: true, force: true }).catch(() => {});
      await fsp.rename(backup, current).catch(() => {});
    }
    throw error;
  } finally {
    for (const stage of stages.values()) await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    for (const item of fileTargets) await fsp.rm(item.staged, { force: true }).catch(() => {});
  }
  for (const backup of backups.values()) await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
  await fsp.writeFile(path.join(engineDir, 'layers', '.miya-workspace-initialized'), 'restored\n', 'utf8');
  return { ok: true, files: clean.workspace.files.length };
}

async function resetWorkspace(engineDir) {
  for (const folder of WORKSPACE_DIRS) {
    const full = path.join(engineDir, folder);
    await fsp.rm(full, { recursive: true, force: true });
    await fsp.mkdir(full, { recursive: true });
  }
  await fsp.writeFile(path.join(engineDir, 'layers', '.gitkeep'), '', 'utf8');
  await fsp.writeFile(path.join(engineDir, 'layers', '.miya-workspace-initialized'), 'empty-project\n', 'utf8');
  await fsp.writeFile(path.join(engineDir, 'rarity-setup.json'), JSON.stringify({ version: 1, folders: {} }, null, 2), 'utf8');
  return { ok: true };
}

module.exports = { buildSessionFilePackage, restoreSessionFiles, resetWorkspace };

(function () {
  'use strict';

  if (!/^\/apps\/pfp-engine(?:\/|$)/.test(location.pathname)) return;

  const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
  const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const FALLBACK_ORDER = ['BG', 'Body', 'Eyes', 'Nose', 'Mouth', 'Hair', 'Mask', 'Hat', 'Top', 'Hand', 'Earrings', 'Overlay'];
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const LS = {
    hidden: 'miyaPfp.hiddenDefaults.v1',
    cleared: 'miyaPfp.defaultsCleared.v1',
    order: 'miyaPfp.order.v1',
    renames: 'miyaPfp.renames.v1',
    empty: 'miyaPfp.emptyFolders.v1',
    rarity: 'miyaPfp.raritySetup.v1',
  };
  const originalFetch = window.fetch.bind(window);
  const base = appBase();
  const manifestUrl = new URL('assets/default-layers.manifest.json', base).href;
  const orderUrl = new URL('assets/default-layers/.order', base).href;
  const assetBase = new URL('assets/default-layers/', base).href;

  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  let defaultImages = new Map();
  let uploaded = new Map();
  let objectUrls = new Map();
  let hiddenDefaults = new Set(readStore(LS.hidden, []));
  let defaultsCleared = readStore(LS.cleared, false) === true;
  let customOrder = readStore(LS.order, null);
  let defaultOrder = FALLBACK_ORDER.slice();
  let defaultRenames = readStore(LS.renames, {});
  let emptyFolders = new Set(readStore(LS.empty, []));
  let db = null;
  let memoryOnly = false;

  function appBase() {
    const url = new URL(document.baseURI);
    if (url.pathname.endsWith('/')) return url.href;
    if (/\/[^/]*\.[^/]*$/.test(url.pathname)) url.pathname = url.pathname.replace(/[^/]*$/, '');
    else url.pathname += '/';
    return url.href;
  }

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(segment => segment && segment !== '.' && segment !== '..')
      .join('/');
  }

  function encodePath(value) {
    return normalizePath(value).split('/').map(encodeURIComponent).join('/');
  }

  function nameOf(path) {
    return normalizePath(path).split('/').pop() || '';
  }

  function mimeFor(path) {
    const ext = nameOf(path).split('.').pop().toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
  }

  function json(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function setLoading(loading, message) {
    const box = document.getElementById('default-layers-loading');
    if (box) box.style.display = loading ? 'block' : 'none';
    const text = document.getElementById('default-layers-loading-text');
    if (text && message) text.textContent = message;
  }

  function openDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open('miya-pfp-layer-files', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('files')) database.createObjectStore('files', { keyPath: 'path' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  function dbGetAll() {
    if (!db) return Promise.resolve([]);
    return new Promise(resolve => {
      const transaction = db.transaction('files', 'readonly');
      const request = transaction.objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  function dbPutMany(records) {
    if (!db || !records.length) return Promise.resolve();
    return new Promise(resolve => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');
      records.forEach(record => store.put(record));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  function dbDeleteMany(paths) {
    if (!db || !paths.length) return Promise.resolve();
    return new Promise(resolve => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');
      paths.forEach(path => store.delete(path));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  function applyRenames(path) {
    let current = normalizePath(path);
    for (let i = 0; i < 5; i++) {
      let changed = false;
      for (const [from, to] of Object.entries(defaultRenames)) {
        const cleanFrom = normalizePath(from);
        if (!cleanFrom) continue;
        if (current === cleanFrom) { current = normalizePath(to); changed = true; break; }
        if (current.startsWith(cleanFrom + '/')) { current = normalizePath(to) + current.slice(cleanFrom.length); changed = true; break; }
      }
      if (!changed) break;
    }
    return normalizePath(current);
  }

  function reverseRenames(path) {
    let current = normalizePath(path);
    for (let i = 0; i < 5; i++) {
      let changed = false;
      for (const [from, to] of Object.entries(defaultRenames)) {
        const cleanFrom = normalizePath(from);
        const cleanTo = normalizePath(to);
        if (!cleanTo) continue;
        if (current === cleanTo) { current = cleanFrom; changed = true; break; }
        if (current.startsWith(cleanTo + '/')) { current = cleanFrom + current.slice(cleanTo.length); changed = true; break; }
      }
      if (!changed) break;
    }
    return normalizePath(current);
  }

  function pathCandidates(path) {
    const candidates = [path];
    for (const candidate of [applyRenames(path), reverseRenames(path)]) {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }
    return candidates;
  }

  function isDefaultHidden(path) {
    for (const hidden of hiddenDefaults) {
      const clean = normalizePath(hidden);
      if (!clean) continue;
      if (path === clean || path.startsWith(clean + '/')) return true;
    }
    return false;
  }

  function defaultUrl(path) {
    return assetBase + encodePath(path);
  }

  function urlFor(path) {
    const record = uploaded.get(path);
    if (!record) return '';
    let url = objectUrls.get(path);
    if (!url) {
      url = URL.createObjectURL(record.blob);
      objectUrls.set(path, url);
    }
    return url;
  }

  function imageUrl(rawPath) {
    const path = normalizePath(rawPath);
    if (!path) return TRANSPARENT;
    const candidates = pathCandidates(path);
    for (const candidate of candidates) {
      if (uploaded.has(candidate)) return urlFor(candidate);
    }
    for (const candidate of candidates) {
      if (defaultImages.has(candidate) && !defaultsCleared && !isDefaultHidden(candidate)) return defaultUrl(candidate);
    }
    return TRANSPARENT;
  }

  function buildTree() {
    const dirs = new Map();
    const roots = [];
    const rootFiles = [];
    const seenFiles = new Set();

    function addDir(path) {
      const segments = normalizePath(path).split('/').filter(Boolean);
      for (let i = 0; i < segments.length; i++) {
        const dirPath = segments.slice(0, i + 1).join('/');
        let node = dirs.get(dirPath);
        if (!node) {
          node = { name: segments[i], path: dirPath, type: 'dir', children: [] };
          dirs.set(dirPath, node);
          if (i === 0) roots.push(node);
          else {
            const parent = dirs.get(segments.slice(0, i).join('/'));
            if (parent) parent.children.push(node);
          }
        }
      }
      return dirs.get(normalizePath(path));
    }

    function addFile(path, size) {
      const clean = normalizePath(path);
      if (!clean || seenFiles.has(clean)) return;
      const segments = clean.split('/').filter(Boolean);
      const name = segments.pop();
      if (!name) return;
      seenFiles.add(clean);
      if (!segments.length) {
        rootFiles.push({ name, path: clean, type: 'file', size: Number(size) || 0 });
        return;
      }
      const parent = addDir(segments.join('/'));
      if (parent) parent.children.push({ name, path: clean, type: 'file', size: Number(size) || 0 });
    }

    for (const [path, size] of defaultImages) {
      if (defaultsCleared) break;
      const renamed = applyRenames(path);
      if (isDefaultHidden(renamed)) continue;
      addFile(renamed, size);
    }
    for (const [path, record] of uploaded) addFile(path, record.size);
    for (const path of emptyFolders) addDir(path);

    function sortChildren(node) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      node.children.forEach(child => { if (child.type === 'dir') sortChildren(child); });
    }
    roots.forEach(sortChildren);

    const order = Array.isArray(customOrder) && customOrder.length ? customOrder : defaultOrder;
    roots.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    rootFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return roots.concat(rootFiles);
  }

  function stats() {
    const tree = buildTree();
    let traits = 0;
    const walk = nodes => (nodes || []).forEach(node => {
      if (node.type === 'file') traits++;
      else walk(node.children);
    });
    walk(tree);
    return {
      layers: tree.filter(node => node.type === 'dir').length,
      traits,
      uploads: uploaded.size,
      defaults: defaultImages.size,
      hidden: hiddenDefaults.size,
      cleared: defaultsCleared,
    };
  }

  async function deletePath(rawPath) {
    const path = normalizePath(rawPath);
    if (!path) return;
    const removed = [];
    for (const key of uploaded.keys()) {
      if (key === path || key.startsWith(path + '/')) removed.push(key);
    }
    if (removed.length) {
      await dbDeleteMany(removed);
      removed.forEach(key => {
        uploaded.delete(key);
        const url = objectUrls.get(key);
        if (url) { URL.revokeObjectURL(url); objectUrls.delete(key); }
      });
    }
    for (const folder of [...emptyFolders]) {
      if (folder === path || folder.startsWith(path + '/')) emptyFolders.delete(folder);
    }
    writeStore(LS.empty, [...emptyFolders]);
    hiddenDefaults.add(path);
    writeStore(LS.hidden, [...hiddenDefaults]);
  }

  async function renamePath(rawFrom, rawTo) {
    const from = normalizePath(rawFrom);
    const to = normalizePath(rawTo);
    if (!from || !to) throw new Error('Invalid rename path');
    const renames = { ...defaultRenames };
    let matched = false;
    for (const [key, value] of Object.entries(renames)) {
      if (value === from || value.startsWith(from + '/')) {
        renames[key] = to + value.slice(from.length);
        matched = true;
      }
    }
    if (!matched) renames[from] = to;
    defaultRenames = renames;
    writeStore(LS.renames, defaultRenames);
    hiddenDefaults = new Set([...hiddenDefaults].map(applyRenames));
    writeStore(LS.hidden, [...hiddenDefaults]);
    emptyFolders = new Set([...emptyFolders].map(path => {
      if (path === from || path.startsWith(from + '/')) return normalizePath(to + path.slice(from.length));
      return path;
    }));
    writeStore(LS.empty, [...emptyFolders]);
    if (Array.isArray(customOrder)) {
      customOrder = customOrder.map(name => (name === from ? to : name));
      writeStore(LS.order, customOrder);
    }
    const moves = [];
    for (const [path, record] of uploaded) {
      if (path === from || path.startsWith(from + '/')) moves.push([path, normalizePath(to + path.slice(from.length)), record]);
    }
    if (moves.length) {
      await dbPutMany(moves.map(([, next, record]) => ({ ...record, path: next })));
      await dbDeleteMany(moves.map(([previous]) => previous));
      moves.forEach(([previous, next, record]) => {
        uploaded.delete(previous);
        const oldUrl = objectUrls.get(previous);
        if (oldUrl) { URL.revokeObjectURL(oldUrl); objectUrls.delete(previous); }
        const nextUrl = objectUrls.get(next);
        if (nextUrl) { URL.revokeObjectURL(nextUrl); objectUrls.delete(next); }
        uploaded.set(next, { ...record, path: next });
      });
    }
  }

  async function imageResponse(url) {
    const path = normalizePath(url.searchParams.get('path') || '');
    if (!path) return new Response('Not found', { status: 404 });
    const candidates = pathCandidates(path);
    for (const candidate of candidates) {
      const record = uploaded.get(candidate);
      if (!record) continue;
      return new Response(record.blob, {
        status: 200,
        headers: { 'Content-Type': record.blob.type || mimeFor(candidate), 'Cache-Control': 'no-cache' },
      });
    }
    for (const candidate of candidates) {
      if (defaultImages.has(candidate) && !defaultsCleared && !isDefaultHidden(candidate)) {
        const response = await originalFetch(defaultUrl(candidate), { cache: 'no-cache' });
        if (response.ok) return response;
      }
    }
    return new Response('Not found', { status: 404 });
  }

  async function handleUpload(url, init) {
    const body = init.body;
    if (!body || typeof body.entries !== 'function') return 0;
    const isCollection = url.searchParams.get('collection') === '1';
    const folderParam = normalizePath(url.searchParams.get('folder') || '');
    const records = new Map();
    for (const [field, value] of body.entries()) {
      if (!value || typeof value === 'string') continue;
      const fileName = value.name || nameOf(field) || 'upload.png';
      let relative = field && field !== 'files' ? String(field).replace(/\\/g, '/') : fileName;
      if (isCollection) {
        const slash = relative.indexOf('/');
        if (slash > 0) relative = relative.slice(slash + 1);
      }
      const full = normalizePath((folderParam ? folderParam + '/' : '') + relative);
      const segments = full.split('/').filter(Boolean);
      const name = segments.pop();
      if (!name || !IMAGE_EXT.test(name)) continue;
      const path = segments.concat(name).join('/');
      records.set(path, {
        path,
        blob: value,
        name,
        size: value.size || 0,
        lastModified: value.lastModified || Date.now(),
        uploadedAt: Date.now(),
      });
    }
    const list = [...records.values()];
    if (!list.length) return 0;
    await dbPutMany(list);
    list.forEach(record => {
      const url = objectUrls.get(record.path);
      if (url) { URL.revokeObjectURL(url); objectUrls.delete(record.path); }
      uploaded.set(record.path, record);
    });
    return list.length;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(data, path) {
    const binary = atob(String(data || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeFor(path) });
  }

  function revokeAllUploads() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  async function exportSession() {
    const files = [];
    for (const [path, record] of uploaded) {
      files.push({ path: 'layers/' + path, data: await blobToBase64(record.blob) });
    }
    const rarity = readStore(LS.rarity, null);
    if (rarity) {
      files.push({ path: 'rarity-setup.json', data: btoa(unescape(encodeURIComponent(JSON.stringify(rarity)))) });
    }
    const thumbnail = files.find(file => /^layers\/.*\.(png|jpe?g|webp|gif)$/i.test(file.path));
    return { version: 1, files, thumbnailPath: thumbnail ? thumbnail.path : '' };
  }

  async function restoreSession(body) {
    const workspace = body && body.workspace && Array.isArray(body.workspace.files) ? body.workspace.files : [];
    const current = [...uploaded.keys()];
    if (current.length) {
      await dbDeleteMany(current);
      revokeAllUploads();
      uploaded.clear();
    }
    const records = [];
    for (const item of workspace) {
      const full = normalizePath(item && item.path);
      if (!full) continue;
      if (full === 'rarity-setup.json') {
        try { writeStore(LS.rarity, JSON.parse(decodeURIComponent(escape(atob(String(item.data || '')))))); } catch {}
        continue;
      }
      if (!full.startsWith('layers/')) continue;
      const path = full.slice('layers/'.length);
      if (!IMAGE_EXT.test(path)) continue;
      const blob = base64ToBlob(item.data, path);
      records.push({ path, blob, name: nameOf(path), size: blob.size, lastModified: Date.now(), uploadedAt: Date.now() });
    }
    if (records.length) {
      await dbPutMany(records);
      records.forEach(record => uploaded.set(record.path, record));
    }
    return records.length;
  }

  async function resetSession() {
    const current = [...uploaded.keys()];
    if (current.length) {
      await dbDeleteMany(current);
      revokeAllUploads();
      uploaded.clear();
    }
    defaultsCleared = false;
    writeStore(LS.cleared, false);
    hiddenDefaults.clear();
    writeStore(LS.hidden, []);
    defaultRenames = {};
    writeStore(LS.renames, {});
    emptyFolders.clear();
    writeStore(LS.empty, []);
    customOrder = null;
    try { localStorage.removeItem(LS.order); } catch {}
    try { localStorage.removeItem(LS.rarity); } catch {}
  }

  async function readJsonBody(init) {
    if (!init || typeof init.body !== 'string' || !init.body) return {};
    try { return JSON.parse(init.body); } catch { return {}; }
  }

  async function handleApi(url, input, init) {
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/api/status') {
      return json({
        ok: true,
        miyaos: true,
        engineDir: 'Bundled layers (browser store)',
        layersDir: 'assets/default-layers + browser uploads',
        buildDir: 'Browser-only previews',
        configPath: 'In-browser state',
        engineExists: false,
      });
    }

    if (path === '/api/layers') {
      if (method === 'GET') {
        await ready;
        return json({ layers: buildTree() });
      }
      if (method === 'DELETE') {
        const body = await readJsonBody(init);
        await deletePath(body.path);
        return json({ ok: true });
      }
      return json({ ok: false, error: 'Unsupported method' }, 405);
    }

    if (path === '/api/layers/upload' && method === 'POST') {
      await ready;
      const count = await handleUpload(url, init);
      return json({ ok: true, count });
    }

    if (path === '/api/layers/reorder' && method === 'POST') {
      const body = await readJsonBody(init);
      customOrder = Array.isArray(body.order) ? body.order.map(String) : [];
      writeStore(LS.order, customOrder);
      return json({ ok: true });
    }

    if (path === '/api/layers/folder' && method === 'POST') {
      const body = await readJsonBody(init);
      const folder = normalizePath(body.path);
      if (folder) {
        emptyFolders.add(folder);
        writeStore(LS.empty, [...emptyFolders]);
      }
      return json({ ok: true });
    }

    if (path === '/api/layers/rename' && method === 'POST') {
      const body = await readJsonBody(init);
      await renamePath(body.from, body.to);
      return json({ ok: true });
    }

    if (path === '/api/session/export' && method === 'GET') {
      await ready;
      return json({ ok: true, workspace: await exportSession() });
    }

    if (path === '/api/session/restore' && method === 'POST') {
      const body = await readJsonBody(init);
      await ready;
      const count = await restoreSession(body);
      return json({ ok: true, files: count });
    }

    if (path === '/api/session/new' && method === 'POST') {
      await ready;
      await resetSession();
      return json({ ok: true });
    }

    if (path === '/api/rarity-setup') {
      if (method === 'GET') return json({ setup: readStore(LS.rarity, { version: 1, folders: {} }) });
      const body = await readJsonBody(init);
      writeStore(LS.rarity, body || { version: 1, folders: {} });
      return json({ ok: true, setup: body });
    }

    if (path === '/api/layer-image') return imageResponse(url);

    return json({ ok: false, error: 'This action needs the local Node engine, which is not available inside MiyaOS.' }, 501);
  }

  window.fetch = function (input, init) {
    let url;
    try {
      const raw = typeof input === 'string' ? input : (input instanceof URL ? input.href : input && input.url);
      url = new URL(raw, location.href);
    } catch {
      return originalFetch(input, init);
    }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    return handleApi(url, input, init || {}).catch(error => json({ ok: false, error: error && error.message ? error.message : String(error) }, 500));
  };

  const NativeEventSource = window.EventSource;
  class MiyaLogStream {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.onmessage = null;
      this.onerror = null;
      this.onopen = null;
      this._listeners = { message: [] };
      setTimeout(() => {
        if (this.readyState === 2) return;
        if (this.onopen) this.onopen({ type: 'open' });
        const event = { data: JSON.stringify({ type: 'connected' }) };
        if (this.onmessage) this.onmessage(event);
        this._listeners.message.forEach(listener => listener(event));
      }, 0);
    }
    addEventListener(type, listener) { (this._listeners[type] || (this._listeners[type] = [])).push(listener); }
    removeEventListener(type, listener) { this._listeners[type] = (this._listeners[type] || []).filter(item => item !== listener); }
    close() { this.readyState = 2; }
  }
  window.EventSource = function (url, config) {
    if (String(url).includes('/api/log-stream')) return new MiyaLogStream(url);
    if (NativeEventSource) return new NativeEventSource(url, config);
    return new MiyaLogStream(url);
  };

  async function init() {
    try {
      setLoading(true, 'Loading default layers…');
      db = await openDb();
      if (!db) memoryOnly = true;
      if (db) {
        try {
          const records = await dbGetAll();
          records.forEach(record => { if (record && record.path) uploaded.set(normalizePath(record.path), record); });
        } catch {}
      }
      try {
        const response = await originalFetch(manifestUrl, { cache: 'no-cache' });
        if (response.ok) {
          const manifest = await response.json();
          (manifest.images || []).forEach(image => {
            const path = normalizePath(image.path);
            if (path) defaultImages.set(path, Number(image.bundledBytes) || 0);
          });
        }
      } catch {}
      try {
        const response = await originalFetch(orderUrl, { cache: 'no-cache' });
        if (response.ok) {
          const names = (await response.text()).split(/\r?\n/).map(name => name.trim()).filter(Boolean);
          if (names.length) defaultOrder = names;
        }
      } catch {}
      setLoading(true, `${defaultImages.size} bundled traits ready`);
    } finally {
      resolveReady();
    }
  }

  window.MiyaLayerStore = {
    ready,
    imageUrl,
    buildTree,
    stats,
    defaultsHidden: () => defaultsCleared,
    hideDefaults: () => { defaultsCleared = true; writeStore(LS.cleared, true); },
    restoreDefaults: () => {
      defaultsCleared = false;
      writeStore(LS.cleared, false);
      hiddenDefaults.clear();
      writeStore(LS.hidden, []);
    },
    memoryOnly: () => memoryOnly,
  };

  init();
})();
